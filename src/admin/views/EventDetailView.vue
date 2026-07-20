<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { adminApi } from '../services/adminApi.js';

import { computeAxisLabel } from '../../services/seatLabel.js';
import EventPlanView from '../components/EventPlanView.vue';

const route  = useRoute();
const router = useRouter();

const eventId      = computed(() => route.params.id);
const isEmbed      = computed(() => route.query.embed === 'true');
const event        = ref(null);
const eventDetail  = ref(null);
const categories   = ref([]);
const loading      = ref(false);
const activeTab    = ref(route.query.embed === 'true' ? 'status' : 'summary');
const selectedSeats = ref(new Set());
const updating     = ref(false);

const TABS = [
  { id: 'summary',    label: 'Résumé' },
  { id: 'status',     label: 'Statuts' },
  { id: 'for-sale',   label: 'Pour la vente' },
  { id: 'categories', label: 'Catégories' },
];

async function load() {
  loading.value = true;
  try {
    eventDetail.value = await adminApi.getEvent(eventId.value);
    event.value = eventDetail.value;
    if (eventDetail.value?.chartId) {
      categories.value = await adminApi.listCategories(eventDetail.value.chartId);
    }
  } finally { loading.value = false; }
}

let mercureSource = null;
let pollInterval = null;

async function pollSeats() {
  try {
    const data = await adminApi.getEventSeats(eventId.value);
    const indexed = data.seats || {};
    const seats = Object.entries(indexed).map(([seatKey, s]) => ({ seatKey, status: s.status }));
    eventDetail.value = { ...eventDetail.value, seats };
  } catch (_) {}
}

function applyChanges(data) {
  // Normalise les deux formats : [{seatKey,status}] ou {seatKeys:[],status:''}
  const changes = Array.isArray(data)
    ? data
    : (data.seatKeys || []).map(k => ({ seatKey: k, status: data.status }));
  const updated = { ...eventDetail.value };
  const seats = [...(updated.seats || [])];
  for (const change of changes) {
    const existing = seats.find(s => s.seatKey === change.seatKey);
    if (existing) { existing.status = change.status; }
    else { seats.push({ seatKey: change.seatKey, status: change.status }); }
  }
  updated.seats = seats;
  eventDetail.value = updated;
}

function connectSSE() {
  const url = new URL('/.well-known/mercure', window.location.origin);
  url.searchParams.append('topic', `event/${eventId.value}/seats`);
  mercureSource = new EventSource(url.toString());
  mercureSource.onmessage = (e) => {
    try { applyChanges(JSON.parse(e.data)); } catch (_) {}
  };
  mercureSource.onerror = () => {
    mercureSource?.close();
    mercureSource = null;
    setTimeout(connectSSE, 3000);
  };
}

onMounted(async () => {
  await load();
  connectSSE();
  pollInterval = setInterval(pollSeats, 2000);
});

onUnmounted(() => {
  mercureSource?.close();
  clearInterval(pollInterval);
});

const seatStatusMap = computed(() => {
  if (!eventDetail.value) return {};
  const map = {};
  for (const s of eventDetail.value.seats || []) map[s.seatKey] = s.status;
  return map;
});

function buildSeats(chartObjects) {
  if (!chartObjects?.length) return [];
  const all = [];
  for (const obj of chartObjects) {
    const type = obj._type;
    if (type === 'seatRow') {
      const section = obj.section || obj.label || obj.id || 'S';
      const rows = obj.rows || 1, cols = obj.cols || 1;
      const disabled = obj.disabledSeats || [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const posKey = `${r}-${c}`;
          if (disabled.includes(posKey)) continue;
          const rowLabel = computeAxisLabel(r, rows, obj.rowFormat || 'A-Z', obj.rowDirection || 'normal');
          const colLabel = computeAxisLabel(c, cols, obj.colFormat || '1-9', obj.colDirection || 'normal');
          all.push({ key: `${section}-${rowLabel}-${colLabel}`, section, categoryId: obj.categoryId });
        }
      }
    } else if (type === 'tableSection') {
      const section = obj.section || obj.label || obj.id || 'TS';
      const totalTables = (obj.tableCount || 3) * (obj.tableRows || 1);
      const spt = obj.seatsPerTable || 6;
      const disabled = obj.disabledSeats || [];
      const deleted  = obj.deletedSeats  || [];
      const deletedTables = obj.deletedTables || [];
      for (let ti = 0; ti < totalTables; ti++) {
        if (deletedTables.includes(ti)) continue;
        for (let si = 0; si < spt; si++) {
          const posKey = `${ti}-${si}`;
          if (disabled.includes(posKey) || deleted.includes(posKey)) continue;
          all.push({ key: `${section}-${ti+1}-${si+1}`, section, categoryId: obj.categoryId });
        }
      }
    } else if (type === 'tableZone') {
      const section = obj.section || obj.label || obj.id || 'T';
      const seatCount = obj.seatCount || 6;
      const disabled = obj.disabledSeats || [];
      for (let i = 0; i < seatCount; i++) {
        if (disabled.includes(i)) continue;
        all.push({ key: `${section}-${i+1}`, section, categoryId: obj.categoryId });
      }
    }
  }
  return all;
}

const allSeats = computed(() => buildSeats(eventDetail.value?.publishedSnapshot || []));

const stats = computed(() => {
  const total    = allSeats.value.length;
  const booked   = allSeats.value.filter(s => seatStatusMap.value[s.key] === 'booked').length;
  const hold     = allSeats.value.filter(s => seatStatusMap.value[s.key] === 'hold').length;
  const canceled = allSeats.value.filter(s => seatStatusMap.value[s.key] === 'canceled').length;
  const avail    = total - booked - hold - canceled;
  return { total, booked, hold, canceled, avail };
});

const categoryStats = computed(() => {
  const map = {};
  for (const s of allSeats.value) {
    const catId = s.categoryId || 'none';
    if (!map[catId]) map[catId] = { total: 0, booked: 0 };
    map[catId].total++;
    if (seatStatusMap.value[s.key] === 'booked') map[catId].booked++;
  }
  return map;
});

function catById(id) {
  return categories.value.find(c => c.id === id) || { color: '#9ca3af', name: 'Sans catégorie' };
}

const hasPublishedSnapshot = computed(() => !!eventDetail.value?.publishedSnapshot?.length);

const planObjects = computed(() => {
  const zones = [], seatRows = [], freeZones = [], tableZones = [], tableSections = [];
  for (const o of eventDetail.value?.publishedSnapshot || []) {
    if (o._type === 'zone')                zones.push(o);
    else if (o._type === 'seatRow')        seatRows.push(o);
    else if (o._type === 'freeZone')       freeZones.push(o);
    else if (o._type === 'tableZone')      tableZones.push(o);
    else if (o._type === 'tableSection')   tableSections.push(o);
  }
  return { zones, seatRows, freeZones, tableZones, tableSections };
});

function toggleSeat(key) {
  const s = new Set(selectedSeats.value);
  if (s.has(key)) s.delete(key); else s.add(key);
  selectedSeats.value = s;
}
function selectAll() {
  let keys;
  if (activeTab.value === 'status') {
    // onglet statuts : exclure les sièges hors-vente
    keys = allSeats.value.filter(s => seatStatusMap.value[s.key] !== 'canceled').map(s => s.key);
  } else if (activeTab.value === 'for-sale') {
    // onglet vente : exclure les sièges vendus
    keys = allSeats.value.filter(s => seatStatusMap.value[s.key] !== 'booked').map(s => s.key);
  } else {
    keys = allSeats.value.map(s => s.key);
  }
  selectedSeats.value = new Set(keys);
}
function selectNone()   { selectedSeats.value = new Set(); }
function selectBooked() { selectedSeats.value = new Set(allSeats.value.filter(s => seatStatusMap.value[s.key] === 'booked').map(s => s.key)); }
function selectAvail()  { selectedSeats.value = new Set(allSeats.value.filter(s => (seatStatusMap.value[s.key] || 'available') === 'available').map(s => s.key)); }

// Présence de chaque statut dans la sélection
const hasSelectedAvailable = computed(() =>
  [...selectedSeats.value].some(k => (seatStatusMap.value[k] || 'available') === 'available')
);
const hasSelectedBooked = computed(() =>
  [...selectedSeats.value].some(k => seatStatusMap.value[k] === 'booked')
);
const hasSelectedCanceled = computed(() =>
  [...selectedSeats.value].some(k => seatStatusMap.value[k] === 'canceled')
);

async function applyStatus(status) {
  if (!selectedSeats.value.size) return;
  // N'applique qu'aux sièges dont le statut change réellement
  let keys = [...selectedSeats.value];
  if (activeTab.value === 'status') {
    if (status === 'booked')    keys = keys.filter(k => (seatStatusMap.value[k] || 'available') === 'available');
    if (status === 'available') keys = keys.filter(k => seatStatusMap.value[k] === 'booked');
  } else if (activeTab.value === 'for-sale') {
    if (status === 'available') keys = keys.filter(k => seatStatusMap.value[k] === 'canceled');
    if (status === 'canceled')  keys = keys.filter(k => (seatStatusMap.value[k] || 'available') === 'available');
  }
  if (!keys.length) return;
  updating.value = true;
  try {
    await adminApi.bulkUpdateEventSeats(eventId.value, keys, status);
    eventDetail.value = await adminApi.getEvent(eventId.value);
    selectedSeats.value = new Set();
  } finally { updating.value = false; }
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- Header -->
    <div class="px-6 pt-4 pb-3 shrink-0 bg-gray-100 border-b border-gray-200">
      <div v-if="!isEmbed" class="flex flex-wrap items-center gap-x-2 gap-y-1 mb-3 text-sm">
        <router-link to="/events" class="flex items-center gap-1 text-indigo-600 hover:underline shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
          </svg>
          Événements
        </router-link>
        <span class="text-gray-400">/</span>
        <span class="font-semibold text-gray-800 truncate max-w-[160px] sm:max-w-none">{{ event?.title || '…' }}</span>
        <span v-if="event?.chartName" class="text-xs text-gray-400 hidden sm:inline">— {{ event.chartName }}</span>
      </div>
      <div class="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        <button v-for="tab in TABS" :key="tab.id"
          @click="activeTab = tab.id; selectedSeats = new Set()"
          class="px-3 py-2 rounded-lg text-sm font-semibold transition whitespace-nowrap shrink-0"
          :class="activeTab === tab.id ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'">
          {{ tab.label }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="flex-1 flex items-center justify-center text-gray-400">Chargement…</div>

    <div v-else-if="eventDetail" class="flex-1 min-h-0 flex flex-col">

      <!-- Stats bar — toujours visible -->
      <div class="bg-white border-b border-gray-200 px-4 py-3 shrink-0">
        <div class="flex justify-between text-xs text-gray-500 mb-1">
          <span>{{ stats.booked }} vendus</span>
          <span>{{ stats.total }} places au total · ID : <span class="font-mono">{{ eventDetail.identifier }}</span></span>
        </div>
        <div class="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div class="h-full bg-green-500 rounded-full transition-all"
            :style="{ width: stats.total ? (stats.booked / stats.total * 100) + '%' : '0%' }"></div>
        </div>
        <div class="flex gap-4 mt-1.5 text-xs">
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-green-500 inline-block"></span>{{ stats.booked }} vendus</span>
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>{{ stats.hold }} en attente</span>
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-gray-200 inline-block border border-gray-300"></span>{{ stats.avail }} libres</span>
        </div>
      </div>

      <div class="flex-1 min-h-0 p-4 flex flex-col">

      <!-- SUMMARY -->
      <div v-if="activeTab === 'summary'" class="flex flex-col gap-4 h-full min-h-0">
        <div v-if="!hasPublishedSnapshot" class="flex items-center justify-center flex-1 text-sm text-gray-400">
          Le plan n'a pas encore été publié — publiez-le depuis l'éditeur pour l'afficher ici.
        </div>
        <div v-else class="flex-1 min-h-0">
          <EventPlanView :categories="categories" v-bind="planObjects" :seat-status-map="seatStatusMap" mode="view" />
        </div>
      </div>

      <!-- STATUS -->
      <div v-else-if="activeTab === 'status'" class="flex flex-col gap-3 h-full min-h-0">
        <div class="flex items-center gap-3 flex-wrap shrink-0">
          <span class="text-sm text-gray-600 font-medium">{{ selectedSeats.size }} siège(s) sélectionné(s)</span>
          <button @click="selectAll"    class="text-xs px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50">Tout</button>
          <button @click="selectNone"   class="text-xs px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50">Aucun</button>
          <button @click="selectBooked" class="text-xs px-2.5 py-1 rounded border border-green-200 text-green-700 hover:bg-green-50">Vendus</button>
          <button @click="selectAvail"  class="text-xs px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50">Libres</button>
          <div class="ml-auto flex gap-2">
            <button :disabled="!selectedSeats.size || updating || !hasSelectedAvailable" @click="applyStatus('booked')"
              class="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-40">
              Marquer vendus
            </button>
            <button :disabled="!selectedSeats.size || updating || !hasSelectedBooked" @click="applyStatus('available')"
              class="px-3 py-1.5 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-semibold disabled:opacity-40">
              Marquer libres
            </button>
          </div>
        </div>
        <div v-if="!hasPublishedSnapshot" class="flex items-center justify-center flex-1 text-sm text-gray-400">
          Le plan n'a pas encore été publié — publiez-le depuis l'éditeur pour gérer les statuts.
        </div>
        <div v-else class="flex-1 min-h-0">
          <EventPlanView :categories="categories" v-bind="planObjects" :seat-status-map="seatStatusMap"
            :selected-seats="selectedSeats" mode="select" context="status" @toggle-seat="toggleSeat" />
        </div>
      </div>

      <!-- FOR SALE -->
      <div v-else-if="activeTab === 'for-sale'" class="flex flex-col gap-3 h-full min-h-0">
        <div class="flex items-center gap-3 flex-wrap shrink-0">
          <span class="text-sm text-gray-600 font-medium">{{ selectedSeats.size }} siège(s) sélectionné(s)</span>
          <button @click="selectAll"  class="text-xs px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50">Tout</button>
          <button @click="selectNone" class="text-xs px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50">Aucun</button>
          <div class="ml-auto flex gap-2">
            <button :disabled="!selectedSeats.size || updating || !hasSelectedCanceled" @click="applyStatus('available')"
              class="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-40">
              Mettre en vente
            </button>
            <button :disabled="!selectedSeats.size || updating || !hasSelectedAvailable" @click="applyStatus('canceled')"
              class="px-3 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 text-red-600 text-sm font-semibold disabled:opacity-40">
              Marquer indisponible
            </button>
          </div>
        </div>
        <div v-if="!hasPublishedSnapshot" class="flex items-center justify-center flex-1 text-sm text-gray-400">
          Le plan n'a pas encore été publié — publiez-le depuis l'éditeur pour gérer la vente.
        </div>
        <div v-else class="flex-1 min-h-0">
          <EventPlanView :categories="categories" v-bind="planObjects" :seat-status-map="seatStatusMap"
            :selected-seats="selectedSeats" mode="select" context="for-sale" @toggle-seat="toggleSeat" />
        </div>
      </div>

      <!-- CATEGORIES -->
      <div v-else-if="activeTab === 'categories'" class="flex gap-4 h-full min-h-0 overflow-hidden">
        <!-- Plan coloré par catégorie -->
        <div class="flex-1 min-w-0 min-h-0 overflow-hidden">
          <div v-if="!hasPublishedSnapshot" class="flex items-center justify-center h-full text-sm text-gray-400">
            Le plan n'a pas encore été publié.
          </div>
          <EventPlanView v-else
            class="h-full"
            :categories="categories"
            v-bind="planObjects"
            :seat-status-map="{}"
            :selected-seats="new Set()"
            mode="view"
            context="categories"
          />
        </div>
        <!-- Légendes + stats -->
        <div class="w-64 shrink-0 flex flex-col gap-3 overflow-y-auto py-1 pr-1">
          <p v-if="!Object.keys(categoryStats).length" class="text-gray-400 text-sm">Aucune donnée.</p>
          <div v-for="(stat, catId) in categoryStats" :key="catId"
            class="bg-white border border-gray-200 rounded-xl p-3">
            <div class="flex items-center gap-2 mb-2">
              <span class="w-3 h-3 rounded-full shrink-0" :style="{ background: catById(catId).color }"></span>
              <span class="font-semibold text-gray-800 text-sm truncate flex-1">{{ catById(catId).name }}</span>
            </div>
            <div class="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1.5">
              <div class="h-full rounded-full transition-all"
                :style="{ width: stat.total ? (stat.booked / stat.total * 100) + '%' : '0%', background: catById(catId).color }"></div>
            </div>
            <div class="flex justify-between text-[11px] text-gray-400">
              <span>{{ stat.booked }} vendus</span>
              <span>{{ stat.total - stat.booked }} libres / {{ stat.total }}</span>
            </div>
          </div>
        </div>
      </div>

      </div><!-- fin contenu onglets -->
    </div><!-- fin eventDetail -->
  </div>
</template>
