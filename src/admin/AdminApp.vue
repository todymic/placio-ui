<script setup>
import { ref, watch } from 'vue';
import { adminApi } from './services/adminApi';
import { auth } from './services/auth.js';

import LoginView from './components/LoginView.vue';
import CategoryManager from './components/CategoryManager.vue';
import PlanEditor from './components/PlanEditor.vue';
import ZoneManager from './components/ZoneManager.vue';
import SeatRowManager from './components/SeatRowManager.vue';
import PreviewPlan from './components/PreviewPlan.vue';

// ---- Auth ----
const isLoggedIn = auth.loggedIn;
function onLoggedIn() { isLoggedIn.value = true; }
function logout() { auth.clear(); }

// ---- Nav ----
const currentPage = ref('plans'); // plans | editor | events | apikeys | profile

// ---- Plans list ----
const plans = ref([]);
const loadingPlans = ref(false);
const newPlanName = ref('');
const newPlanSlug = ref('');
const creatingPlan = ref(false);
const planError = ref('');

// Auto-generate slug from name
watch(newPlanName, (v) => {
  newPlanSlug.value = v
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
});

async function loadPlans() {
  loadingPlans.value = true;
  plans.value = await adminApi.listVenues();
  loadingPlans.value = false;
}

async function createPlan() {
  if (!newPlanName.value.trim()) return;
  planError.value = '';
  creatingPlan.value = true;
  try {
    await adminApi.createVenue({ name: newPlanName.value });
    newPlanName.value = '';
    newPlanSlug.value = '';
    await loadPlans();
  } catch (e) {
    planError.value = e.message;
  } finally {
    creatingPlan.value = false;
  }
}

async function deletePlan(plan) {
  if (!confirm(`Supprimer le plan "${plan.name}" ?`)) return;
  try {
    await adminApi.deleteVenue(plan.id);
    await loadPlans();
  } catch (e) {
    planError.value = e.message;
  }
}

// inline rename
const editingPlan = ref(null);
const editingName = ref('');
function startRename(plan) { editingPlan.value = plan; editingName.value = plan.name; }
async function saveName(plan) {
  if (!editingName.value.trim()) return;
  await adminApi.updateVenue(plan.id, { name: editingName.value });
  editingPlan.value = null;
  await loadPlans();
}

// ---- Editor ----
const selectedPlan = ref(null);
const activeTab = ref('editor');
const categories = ref([]);
const zones = ref([]);
const seatRows = ref([]);
const freeZones = ref([]);
const tableZones = ref([]);
const tableSections = ref([]);

const editorTabs = [
  { id: 'categories', label: 'Catégories' },
  { id: 'editor',     label: 'Éditeur du plan' },
  { id: 'zones',      label: 'Zones' },
  { id: 'seatRows',   label: 'Rangées de sièges' },
  { id: 'preview',    label: 'Aperçu' },
];

async function openEditor(plan) {
  selectedPlan.value = plan;
  activeTab.value = 'editor';
  currentPage.value = 'editor';
  await refreshAll();
}

function backToPlans() {
  currentPage.value = 'plans';
  selectedPlan.value = null;
}

async function refreshAll() {
  if (!selectedPlan.value) return;
  const id = selectedPlan.value.id;
  categories.value = await adminApi.listCategories(id);
  zones.value      = await adminApi.listZones(id);
  seatRows.value   = await adminApi.listSeatRows(id);
  freeZones.value  = await adminApi.listFreeZones(id);
  tableZones.value = await adminApi.listTableZones(id);
  tableSections.value = await adminApi.listTableSections(id);
}

async function onChildChanged() { await refreshAll(); }

// ---- Nav items ----
const navItems = [
  {
    label: 'Accueil', page: 'home',
    icon: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>',
    action: () => { backToPlans(); currentPage.value = 'home'; },
    active: () => currentPage.value === 'home',
  },
  {
    label: 'Plans', page: 'plans',
    icon: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/></svg>',
    action: () => { backToPlans(); currentPage.value = 'plans'; },
    active: () => ['plans', 'editor'].includes(currentPage.value),
  },
  {
    label: 'Événements', page: 'events',
    icon: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>',
    action: () => { currentPage.value = 'events'; },
    active: () => currentPage.value === 'events',
  },
  {
    label: 'Clés API', page: 'apikeys',
    icon: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>',
    action: () => { currentPage.value = 'apikeys'; },
    active: () => currentPage.value === 'apikeys',
  },
  {
    label: 'Profil', page: 'profile',
    icon: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>',
    action: () => { currentPage.value = 'profile'; },
    active: () => currentPage.value === 'profile',
  },
];

// Load plans on mount
watch(isLoggedIn, (v) => { if (v) loadPlans(); }, { immediate: true });
</script>

<template>
  <LoginView v-if="!isLoggedIn" @logged-in="onLoggedIn" />

  <div v-else class="min-h-screen flex flex-col bg-gray-100">

    <!-- Header -->
    <header class="h-14 bg-white border-b border-gray-200 flex items-center px-6 shrink-0 z-10">
      <span class="text-xl font-bold text-gray-900 flex-1 text-center">Placio</span>
      <div class="flex items-center gap-3 ml-auto">
        <span class="text-sm text-gray-500 flex items-center gap-1">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
          Backoffice
        </span>
        <button @click="logout" class="px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition">
          Déconnexion
        </button>
      </div>
    </header>

    <div class="flex flex-1 min-h-0">

      <!-- Sidebar -->
      <aside class="w-14 md:w-40 lg:w-48 shrink-0 bg-gray-900 text-gray-300 flex flex-col py-4">
        <nav class="flex flex-col gap-1 px-1.5">
          <button v-for="item in navItems" :key="item.page"
            @click="item.action()"
            class="flex items-center gap-2.5 px-2 py-2.5 rounded-lg text-sm transition w-full"
            :class="item.active() ? 'bg-gray-700 text-white' : 'hover:bg-gray-800 text-gray-400'"
            :title="item.label"
          >
            <span class="shrink-0 w-5 h-5 flex items-center justify-center" v-html="item.icon"></span>
            <span class="hidden md:block truncate">{{ item.label }}</span>
          </button>
        </nav>
      </aside>

      <!-- Main content -->
      <main class="flex-1 min-h-0 flex flex-col overflow-hidden"
        :class="currentPage !== 'editor' ? 'p-8 overflow-auto' : ''"
      >

        <!-- ===== PAGE : PLANS ===== -->
        <template v-if="currentPage === 'plans'">
          <h2 class="text-2xl font-bold text-gray-900 mb-1">Plans</h2>
          <p class="text-sm text-gray-500 mb-6">Créez et gérez les plans de salle.</p>

          <p v-if="planError" class="text-xs text-red-500 bg-red-50 p-2 rounded-lg mb-4">{{ planError }}</p>

          <!-- Nouveau plan -->
          <div class="bg-white rounded-xl border border-gray-200 p-5 mb-6">
            <h3 class="font-semibold text-gray-800 mb-4">Nouveau plan</h3>
            <div class="flex gap-3">
              <input
                v-model="newPlanName"
                type="text" placeholder="Nom du plan"
                @keyup.enter="createPlan"
                class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
              />
              <input
                v-model="newPlanSlug"
                type="text" placeholder="slug-plan"
                class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-400 bg-gray-50 focus:outline-none"
                readonly
              />
              <button
                :disabled="!newPlanName.trim() || creatingPlan"
                @click="createPlan"
                class="px-5 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-semibold transition"
              >{{ creatingPlan ? 'Création…' : 'Créer le plan' }}</button>
            </div>
          </div>

          <!-- Liste des plans -->
          <div class="bg-white rounded-xl border border-gray-200 p-5">
            <h3 class="font-semibold text-gray-800 mb-4">Liste des plans</h3>
            <div v-if="loadingPlans" class="text-sm text-gray-400 py-4 text-center">Chargement…</div>
            <div v-else-if="plans.length === 0" class="text-sm text-gray-400 py-4 text-center">Aucun plan pour le moment.</div>
            <div v-else class="flex flex-col gap-3">
              <div
                v-for="plan in plans" :key="plan.id"
                class="flex items-center justify-between p-4 rounded-lg border border-gray-100 hover:border-gray-200"
              >
                <div>
                  <template v-if="editingPlan?.id === plan.id">
                    <input
                      v-model="editingName"
                      @keyup.enter="saveName(plan)"
                      @blur="saveName(plan)"
                      class="font-semibold text-gray-800 border-b border-gray-400 focus:outline-none"
                      autofocus
                    />
                  </template>
                  <template v-else>
                    <p class="font-semibold text-gray-800">{{ plan.name }}</p>
                  </template>
                  <p class="text-xs text-gray-400 mt-0.5">Slug: {{ plan.slug }}</p>
                  <p v-if="plan.updatedAt" class="text-xs text-gray-400">Mis à jour: {{ new Date(plan.updatedAt).toLocaleString('fr-FR') }}</p>
                </div>
                <div class="flex gap-2">
                  <button @click="openEditor(plan)" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition">
                    Éditer le plan
                  </button>
                  <button @click="startRename(plan)" class="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-semibold transition">
                    Modifier
                  </button>
                  <button @click="deletePlan(plan)" class="px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition">
                    Supprimer
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- ===== PAGE : ÉDITEUR ===== -->
        <template v-else-if="currentPage === 'editor' && selectedPlan">
          <!-- Breadcrumb + Tabs -->
          <div class="px-6 pt-4 pb-3 shrink-0 bg-gray-100 border-b border-gray-200">
            <div class="flex items-center gap-2 mb-3 text-sm">
              <button @click="backToPlans" class="text-indigo-600 hover:underline">Plans</button>
              <span class="text-gray-400">/</span>
              <span class="font-semibold text-gray-800">{{ selectedPlan.name }}</span>
            </div>
            <div class="flex gap-2">
              <button
                v-for="t in editorTabs" :key="t.id"
                @click="activeTab = t.id"
                class="px-4 py-2 rounded-lg text-sm font-semibold transition"
                :class="activeTab === t.id ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'"
              >{{ t.label }}</button>
            </div>
          </div>

          <!-- Component zone — fills remaining height -->
          <div class="flex-1 min-h-0 overflow-hidden p-2">
            <CategoryManager v-if="activeTab === 'categories'"     :venue-id="selectedPlan.id" @changed="onChildChanged" />
            <PlanEditor      v-else-if="activeTab === 'editor'"    :venue-id="selectedPlan.id" :categories="categories" @changed="onChildChanged" class="h-full" />
            <ZoneManager     v-else-if="activeTab === 'zones'"     :venue-id="selectedPlan.id" :categories="categories" @changed="onChildChanged" />
            <SeatRowManager  v-else-if="activeTab === 'seatRows'"  :venue-id="selectedPlan.id" :categories="categories" @changed="onChildChanged" />
            <PreviewPlan     v-else-if="activeTab === 'preview'"   :categories="categories" :zones="zones" :seat-rows="seatRows" :free-zones="freeZones" :table-zones="tableZones" :table-sections="tableSections" />
          </div>
        </template>

        <!-- ===== PAGES PLACEHOLDER ===== -->
        <template v-else>
          <h2 class="text-2xl font-bold text-gray-900 mb-2 capitalize">{{ currentPage }}</h2>
          <div class="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400 text-sm">
            Cette section est en cours de développement.
          </div>
        </template>

      </main>
    </div>
  </div>
</template>
