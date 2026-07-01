<script setup>
import { ref, reactive, computed, onMounted, nextTick, watch } from 'vue';
import { computeSeatLabel, computeAxisLabel } from '../../services/seatLabel';
import { iconById, patternStyle } from '../../services/icons';
import MiniMap from '../../components/MiniMap.vue';

const props = defineProps({
  categories: { type: Array, required: true },
  zones:      { type: Array, required: true },
  seatRows:   { type: Array, required: true },
  freeZones:  { type: Array, default: () => [] },
  tableZones:    { type: Array, default: () => [] },
  tableSections: { type: Array, default: () => [] },
});

function tableZoneSize(t) {
  return (t.tableSize || 30) + 2 * (t.seatSize || 15) + 16;
}
function tableSectionUnitSize(ts) {
  return (ts.tableSize || 30) + 2 * (ts.seatSize || 15) + 16;
}
function tableSectionWidth(ts) {
  const unit = tableSectionUnitSize(ts);
  return (ts.tableCount || 3) * unit + ((ts.tableCount || 3) - 1) * (ts.tableSpacing || 20);
}
function buildTableSectionSeats(ts) {
  const section = ts.section || ts.label || ts.id;
  const disabled = ts.disabledSeats || [];
  const seats = [];
  for (let ti = 0; ti < (ts.tableCount || 3); ti++) {
    for (let si = 0; si < (ts.seatsPerTable || 6); si++) {
      seats.push({
        tableIndex: ti, seatIndex: si,
        id: `${section}-${ti + 1}-${si + 1}`,
        label: String(si + 1),
        rowLabel: `T${ti + 1}`, colLabel: String(si + 1),
        section,
        categoryId: ts.categoryId,
        status: disabled.includes(`${ti}-${si}`) ? 'disabled' : 'available',
      });
    }
  }
  return seats;
}

function buildTableSeats(t) {
  const section = t.section || t.label || t.id;
  const disabled = t.disabledSeats || [];
  return Array.from({ length: t.seatCount || 6 }, (_, i) => ({
    index: i,
    id: `${section}-${i + 1}`,
    label: String(i + 1),
    rowLabel: '—',
    colLabel: String(i + 1),
    section,
    categoryId: t.categoryId,
    status: disabled.includes(i) ? 'disabled' : 'available',
  }));
}

// ---- Tooltip / seat info ----
const hoveredSeat  = ref(null);
const selectedSeat = ref(null);

function catById(id) {
  return props.categories.find((c) => c.id === id) || { color: '#999999', name: '—' };
}

function buildSeats(row) {
  const seats = [];
  const disabled = row.disabledSeats || [];
  const overrides = row.categoryOverrides || {};
  const section = row.section || row.label || row.id;
  for (let r = 0; r < row.rows; r++) {
    for (let c = 0; c < row.cols; c++) {
      const posKey = `${r}-${c}`;
      const rowLabel = computeAxisLabel(r, row.rows, row.rowFormat, row.rowDirection);
      const colLabel = computeAxisLabel(c, row.cols, row.colFormat, row.colDirection);
      seats.push({
        id: `${section}-${rowLabel}-${colLabel}`,
        posKey,
        label:    computeSeatLabel(r, c, row.rows, row.cols, row),
        rowLabel, colLabel, section,
        categoryId: overrides[posKey] || row.categoryId,
        status: disabled.includes(posKey) ? 'disabled' : 'available',
      });
    }
  }
  return seats;
}

// ---- Canvas dynamic size ----
const CANVAS_PAD = 150;
const canvasWidth = computed(() => {
  let max = 900;
  for (const z of props.zones)     max = Math.max(max, (z.left || 0) + (z.width  || 200) + CANVAS_PAD);
  for (const r of props.seatRows)  max = Math.max(max, (r.left || 0) + (r.cols || 1) * ((r.shape === 'rounded' ? (r.seatSize || 22) * 1.5 : (r.seatSize || 22)) + 4) + 28 + CANVAS_PAD);
  for (const f of props.freeZones) max = Math.max(max, (f.left || 0) + (f.width || 100) + CANVAS_PAD);
  for (const t of props.tableZones) max = Math.max(max, (t.left || 0) + tableZoneSize(t) + CANVAS_PAD);
  for (const ts of props.tableSections) max = Math.max(max, (ts.left || 0) + tableSectionWidth(ts) + CANVAS_PAD);
  return max;
});
const canvasHeight = computed(() => {
  let max = 600;
  for (const z of props.zones)     max = Math.max(max, (z.top || 0) + (z.height || 70)  + CANVAS_PAD);
  for (const r of props.seatRows)  max = Math.max(max, (r.top || 0) + (r.rows || 1) * ((r.seatSize || 22) + 4) + 30 + CANVAS_PAD);
  for (const f of props.freeZones) max = Math.max(max, (f.top || 0) + (f.height || 50) + CANVAS_PAD);
  for (const t of props.tableZones) max = Math.max(max, (t.top || 0) + tableZoneSize(t) + CANVAS_PAD);
  for (const ts of props.tableSections) max = Math.max(max, (ts.top || 0) + tableSectionUnitSize(ts) + 24 + CANVAS_PAD);
  return max;
});

// ---- Zoom / pan (translate libre) ----
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.15;
const zoom = ref(1);
const panX = ref(40);
const panY = ref(40);
const viewportEl = ref(null);
const viewport = reactive({ left: 0, top: 0, width: 900, height: 500 });
const panning = reactive({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 });

function updateViewport() {
  const el = viewportEl.value;
  if (!el) return;
  viewport.left   = -panX.value / zoom.value;
  viewport.top    = -panY.value / zoom.value;
  viewport.width  = el.clientWidth  / zoom.value;
  viewport.height = el.clientHeight / zoom.value;
}

function setZoom(next) {
  const el = viewportEl.value;
  const prev = zoom.value;
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  if (!el) { zoom.value = clamped; return; }
  const rect = el.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  panX.value = cx - (cx - panX.value) * (clamped / prev);
  panY.value = cy - (cy - panY.value) * (clamped / prev);
  zoom.value = clamped;
  updateViewport();
}
function zoomIn()    { setZoom(zoom.value + ZOOM_STEP); }
function zoomOut()   { setZoom(zoom.value - ZOOM_STEP); }
function zoomReset() { zoom.value = 1; panX.value = 40; panY.value = 40; updateViewport(); }

function onWheel(ev) {
  ev.preventDefault();
  const el = viewportEl.value;
  if (!el) return;
  const prev = zoom.value;
  const factor = ev.deltaY < 0 ? 1.12 : 0.9;
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev * factor));
  const rect = el.getBoundingClientRect();
  const mx = ev.clientX - rect.left;
  const my = ev.clientY - rect.top;
  panX.value = mx - (mx - panX.value) * (next / prev);
  panY.value = my - (my - panY.value) * (next / prev);
  zoom.value = next;
  updateViewport();
}

function startPan(ev) {
  if (ev.button !== 0) return;
  panning.active = true;
  panning.startX = ev.clientX; panning.startY = ev.clientY;
  panning.originX = panX.value; panning.originY = panY.value;
  ev.target.setPointerCapture(ev.pointerId);
  window.addEventListener('pointermove', onPan);
  window.addEventListener('pointerup', stopPan);
  window.addEventListener('pointercancel', stopPan);
}
function onPan(ev) {
  if (!panning.active) return;
  panX.value = panning.originX + (ev.clientX - panning.startX);
  panY.value = panning.originY + (ev.clientY - panning.startY);
  updateViewport();
}
function stopPan() {
  panning.active = false;
  window.removeEventListener('pointermove', onPan);
  window.removeEventListener('pointerup', stopPan);
  window.removeEventListener('pointercancel', stopPan);
}

function navigateTo({ x, y }) {
  const el = viewportEl.value;
  if (!el) return;
  panX.value = el.clientWidth  / 2 - x * zoom.value;
  panY.value = el.clientHeight / 2 - y * zoom.value;
  updateViewport();
}

// ---- Seat interactions ----
function onSeatHover(ev, row, seat) {
  if (seat.status === 'disabled') { hoveredSeat.value = null; return; }
  hoveredSeat.value = { seat, row, x: ev.clientX, y: ev.clientY };
}
function onSeatLeave() { hoveredSeat.value = null; }
function onSeatClick(row, seat) {
  if (seat.status === 'disabled') return;
  if (selectedSeat.value?.seat.id === seat.id) { selectedSeat.value = null; return; }
  selectedSeat.value = { seat, row };
}

onMounted(() => { nextTick(updateViewport); });
watch(zoom, () => nextTick(updateViewport));
</script>

<template>
  <div class="bg-white rounded-2xl shadow-sm p-5 flex flex-col min-h-0 h-full">
    <div class="flex items-center justify-between mb-1 shrink-0">
      <h3 class="font-bold text-gray-800">Aperçu du plan</h3>
      <div class="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
        <button @click="zoomOut"   class="w-7 h-7 flex items-center justify-center text-gray-600 hover:bg-white rounded-md text-lg font-bold transition">−</button>
        <button @click="zoomReset" class="px-2 h-7 flex items-center justify-center text-gray-500 hover:bg-white rounded-md text-xs font-semibold transition min-w-[44px]">{{ Math.round(zoom * 100) }}%</button>
        <button @click="zoomIn"    class="w-7 h-7 flex items-center justify-center text-gray-600 hover:bg-white rounded-md text-lg font-bold transition">+</button>
      </div>
    </div>
    <p class="text-xs text-gray-400 mb-3 shrink-0">Rendu identique à ce que verra le client. Survolez un siège pour les infos, cliquez pour le sélectionner.</p>

    <div class="flex gap-4 flex-1 min-h-0 overflow-hidden">
      <!-- Canvas -->
      <div
        ref="viewportEl"
        class="overflow-hidden flex-1 min-w-0 rounded-xl relative bg-gray-400"
        :class="panning.active ? 'cursor-grabbing' : 'cursor-grab'"
        style="touch-action: none;"
        @wheel.prevent="onWheel"
        @pointerdown="startPan"
      >
          <div
            class="absolute plan-canvas shadow-xl"
            :style="{ width: canvasWidth + 'px', height: canvasHeight + 'px', transform: `translate(${panX}px, ${panY}px) scale(${zoom})`, transformOrigin: '0 0' }"
          >

            <!-- Zones génériques -->
            <div
              v-for="z in zones" :key="z.id"
              class="absolute rounded-lg border flex flex-col items-center justify-center text-center px-2 select-none"
              :class="z.shape === 'pill' ? 'rounded-full' : ''"
              :style="{
                top: z.top + 'px', left: z.left + 'px', width: z.width + 'px', height: z.height + 'px',
                background: catById(z.categoryId).color + '14',
                borderColor: catById(z.categoryId).color + '55',
              }"
            >
              <p class="font-bold" :style="{ color: catById(z.categoryId).color, fontSize: (z.labelFontSize || 11) + 'px' }">{{ z.label }}</p>
              <p class="text-gray-400" :style="{ fontSize: Math.max(8, (z.labelFontSize || 11) - 2) + 'px' }">{{ z.capacity }} places</p>
            </div>

            <!-- Zones libres -->
            <div
              v-for="fz in freeZones" :key="fz.id"
              class="absolute rounded-lg flex flex-col items-center justify-center text-center gap-0.5 select-none pointer-events-none"
              :style="{
                top: fz.top + 'px', left: fz.left + 'px', width: fz.width + 'px', height: fz.height + 'px',
                ...patternStyle(fz.pattern, fz.color),
                border: `1px solid ${fz.color}40`,
              }"
            >
              <span v-if="iconById(fz.icon).emoji" style="line-height:1" :style="{ fontSize: Math.max(12, fz.height * 0.32) + 'px' }">{{ iconById(fz.icon).emoji }}</span>
              <span class="font-bold uppercase tracking-wide" :style="{ color: fz.color, fontSize: (fz.labelFontSize || 10) + 'px' }">{{ fz.label }}</span>
            </div>

            <!-- Tables rondes -->
            <div
              v-for="t in tableZones" :key="t.id"
              class="absolute select-none"
              :style="{
                top: t.top + 'px', left: t.left + 'px',
                width: tableZoneSize(t) + 'px', height: tableZoneSize(t) + 'px',
                zIndex: t.zIndex || 1,
              }"
            >
              <template v-for="seat in buildTableSeats(t)" :key="seat.index">
                <button
                  type="button"
                  class="absolute flex items-center justify-center text-white font-bold rounded-full"
                  :class="[
                    seat.status === 'disabled' ? 'cursor-default' : 'cursor-pointer',
                    selectedSeat?.seat.id === seat.id ? 'ring-2 ring-offset-1 ring-gray-900' : '',
                  ]"
                  :style="{
                    width: (t.seatSize || 15) + 'px', height: (t.seatSize || 15) + 'px',
                    fontSize: Math.max(6, Math.floor((t.seatSize || 15) * 0.42)) + 'px',
                    background: seat.status === 'disabled' ? '#eef0f2'
                      : selectedSeat?.seat.id === seat.id ? '#111827'
                      : catById(t.categoryId).color,
                    border: seat.status === 'disabled' ? '1px solid #d8dade' : 'none',
                    color: seat.status === 'disabled' ? '#9ca3af' : '#fff',
                    left: (tableZoneSize(t) / 2 + ((t.tableSize || 30) / 2 + (t.seatSize || 15) / 2 + 8) * Math.cos((2 * Math.PI * seat.index) / (t.seatCount || 6) - Math.PI / 2) - (t.seatSize || 15) / 2) + 'px',
                    top:  (tableZoneSize(t) / 2 + ((t.tableSize || 30) / 2 + (t.seatSize || 15) / 2 + 8) * Math.sin((2 * Math.PI * seat.index) / (t.seatCount || 6) - Math.PI / 2) - (t.seatSize || 15) / 2) + 'px',
                  }"
                  @mouseenter="onSeatHover($event, t, seat)"
                  @mouseleave="onSeatLeave"
                  @click.stop="onSeatClick(t, seat)"
                >{{ (t.seatSize || 15) >= 14 ? seat.label : '' }}</button>
              </template>
              <div
                class="absolute rounded-full flex items-center justify-center"
                :style="{
                  width: (t.tableSize || 30) + 'px', height: (t.tableSize || 30) + 'px',
                  left: (tableZoneSize(t) - (t.tableSize || 30)) / 2 + 'px',
                  top:  (tableZoneSize(t) - (t.tableSize || 30)) / 2 + 'px',
                  background: catById(t.categoryId).color + '22',
                  border: `2px solid ${catById(t.categoryId).color}88`,
                }"
              >
                <span class="font-bold text-center leading-tight"
                  :style="{ color: catById(t.categoryId).color, fontSize: (t.rowLabelFontSize || 10) + 'px' }">
                  {{ t.section || catById(t.categoryId).name }}
                </span>
              </div>
            </div>

            <!-- Blocs de sièges -->
            <div
              v-for="row in seatRows" :key="row.id"
              class="absolute seat-block select-none"
              :style="{ top: row.top + 'px', left: row.left + 'px' }"
            >
              <!-- Badge = nom de la catégorie -->
              <div class="row-badge"
                :style="{
                  color: catById(row.categoryId).color,
                  borderColor: catById(row.categoryId).color + '55',
                  fontSize: (row.rowLabelFontSize || 10) + 'px',
                }">
                {{ row.section || catById(row.categoryId).name }}
              </div>
              <div class="seat-block-card"
                :style="{
                  background: catById(row.categoryId).color + '14',
                  borderColor: catById(row.categoryId).color + '55',
                }">
                <div class="grid gap-1.5"
                  :style="{ gridTemplateColumns: `repeat(${row.cols}, minmax(${row.shape === 'rounded' ? (row.seatSize || 22) * 1.5 : (row.seatSize || 22)}px, auto))` }">
                  <button
                    v-for="seat in buildSeats(row)" :key="seat.id"
                    type="button"
                    class="seat flex items-center justify-center leading-none font-semibold"
                    :class="[
                      seat.status === 'disabled' ? 'seat-disabled' : '',
                      row.shape === 'rounded' ? 'seat-rounded' : '',
                      selectedSeat?.seat.id === seat.id ? 'ring-2 ring-offset-1 ring-gray-900' : '',
                    ]"
                    :style="{
                      height: (row.seatSize || 22) + 'px',
                      minWidth: row.shape === 'rounded' ? ((row.seatSize || 22) * 1.5) + 'px' : (row.seatSize || 22) + 'px',
                      padding: row.shape === 'rounded' ? '0 6px' : '0',
                      fontSize: Math.max(8, Math.floor((row.seatSize || 22) * 0.4)) + 'px',
                      borderRadius: row.shape === 'round' ? '50%' : row.shape === 'rounded' ? '10px' : '4px',
                      color: seat.status === 'disabled' ? '#9ca3af' : '#fff',
                      background: seat.status === 'disabled' ? '#eef0f2'
                        : selectedSeat?.seat.id === seat.id ? '#111827'
                        : catById(seat.categoryId).color,
                      border: seat.status === 'disabled' ? '1px solid #d8dade' : 'none',
                    }"
                    @mouseenter="onSeatHover($event, row, seat)"
                    @mouseleave="onSeatLeave"
                    @click.stop="onSeatClick(row, seat)"
                  >{{ (row.seatSize || 22) >= 14 ? seat.label : '' }}</button>
                </div>
              </div>
            </div>

            <!-- Sections de tables -->
            <div
              v-for="ts in tableSections" :key="ts.id"
              class="absolute select-none"
              :style="{
                top: ts.top + 'px', left: ts.left + 'px',
                width: tableSectionWidth(ts) + 'px',
                height: tableSectionUnitSize(ts) + 24 + 'px',
                zIndex: ts.zIndex || 1,
                border: `2px dashed ${catById(ts.categoryId).color}70`,
                borderRadius: '14px',
              }"
            >
              <template v-for="ti in (ts.tableCount || 3)" :key="ti">
                <template v-for="seat in buildTableSectionSeats(ts).filter(s => s.tableIndex === ti - 1)" :key="seat.tableIndex + '-' + seat.seatIndex">
                  <button
                    type="button"
                    class="absolute flex items-center justify-center text-white font-bold rounded-full"
                    :class="[
                      seat.status === 'disabled' ? 'cursor-default' : 'cursor-pointer',
                      selectedSeat?.seat.id === seat.id ? 'ring-2 ring-offset-1 ring-gray-900' : '',
                    ]"
                    :style="{
                      width: (ts.seatSize || 15) + 'px', height: (ts.seatSize || 15) + 'px',
                      fontSize: Math.max(6, Math.floor((ts.seatSize || 15) * 0.42)) + 'px',
                      background: seat.status === 'disabled' ? '#eef0f2'
                        : selectedSeat?.seat.id === seat.id ? '#111827'
                        : catById(ts.categoryId).color,
                      border: seat.status === 'disabled' ? '1px solid #d8dade' : 'none',
                      color: seat.status === 'disabled' ? '#9ca3af' : '#fff',
                      left: ((ti - 1) * (tableSectionUnitSize(ts) + (ts.tableSpacing || 20)) + tableSectionUnitSize(ts) / 2 + ((ts.tableSize || 30) / 2 + (ts.seatSize || 15) / 2 + 8) * Math.cos((2 * Math.PI * seat.seatIndex) / (ts.seatsPerTable || 6) - Math.PI / 2) - (ts.seatSize || 15) / 2) + 'px',
                      top:  (24 + tableSectionUnitSize(ts) / 2 + ((ts.tableSize || 30) / 2 + (ts.seatSize || 15) / 2 + 8) * Math.sin((2 * Math.PI * seat.seatIndex) / (ts.seatsPerTable || 6) - Math.PI / 2) - (ts.seatSize || 15) / 2) + 'px',
                    }"
                    @mouseenter="onSeatHover($event, ts, seat)"
                    @mouseleave="onSeatLeave"
                    @click.stop="onSeatClick(ts, seat)"
                  >{{ (ts.seatSize || 15) >= 14 ? seat.label : '' }}</button>
                </template>
                <div
                  class="absolute rounded-full flex items-center justify-center pointer-events-none"
                  :style="{
                    width: (ts.tableSize || 30) + 'px', height: (ts.tableSize || 30) + 'px',
                    left: ((ti - 1) * (tableSectionUnitSize(ts) + (ts.tableSpacing || 20)) + (tableSectionUnitSize(ts) - (ts.tableSize || 30)) / 2) + 'px',
                    top:  (24 + (tableSectionUnitSize(ts) - (ts.tableSize || 30)) / 2) + 'px',
                    background: catById(ts.categoryId).color + '22',
                    border: `2px solid ${catById(ts.categoryId).color}88`,
                  }"
                >
                  <span class="font-bold leading-tight pointer-events-none"
                    :style="{ color: catById(ts.categoryId).color, fontSize: Math.max(6, (ts.rowLabelFontSize || 10) - 2) + 'px' }">
                    T{{ ti }}
                  </span>
                </div>
              </template>
            </div>

            <div v-if="zones.length === 0 && seatRows.length === 0 && freeZones.length === 0 && tableZones.length === 0 && tableSections.length === 0"
              class="absolute inset-0 flex items-center justify-center text-gray-400 text-sm pointer-events-none">
              Aucun élément défini pour ce plan.
            </div>
          </div>

        <!-- Mini-plan -->
        <MiniMap
          :categories="categories"
          :zones="zones"
          :seat-zones="seatRows"
          :content-width="canvasWidth"
          :content-height="canvasHeight"
          :viewport="viewport"
          @navigate="navigateTo"
        />
      </div>

      <!-- Panneau info siège sélectionné -->
      <div v-if="selectedSeat" class="w-48 shrink-0 bg-gray-50 border border-gray-100 rounded-xl p-4 text-sm flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full shrink-0" :style="{ background: catById(selectedSeat.seat.categoryId).color }"></span>
          <span class="font-bold text-gray-800">Siège {{ selectedSeat.seat.label }}</span>
        </div>
        <dl class="flex flex-col gap-1 text-xs">
          <div class="flex justify-between"><dt class="text-gray-400">Section</dt><dd class="font-medium text-gray-700">{{ selectedSeat.row.section || selectedSeat.row.label }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-400">Catégorie</dt><dd class="font-medium" :style="{ color: catById(selectedSeat.seat.categoryId).color }">{{ catById(selectedSeat.seat.categoryId).name }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-400">Statut</dt>
            <dd class="font-medium" :class="selectedSeat.seat.status === 'available' ? 'text-green-600' : 'text-amber-600'">
              {{ selectedSeat.seat.status === 'available' ? 'Disponible' : 'Désactivé' }}
            </dd>
          </div>
        </dl>
        <button @click="selectedSeat = null" class="mt-auto text-xs text-gray-400 hover:text-gray-600">Fermer</button>
      </div>
    </div>

    <!-- Tooltip hover -->
    <Teleport to="body">
      <div
        v-if="hoveredSeat"
        class="fixed z-50 pointer-events-none shadow-xl rounded-xl overflow-hidden"
        style="min-width: 180px; background:#fff; border:1px solid #e5e7eb;"
        :style="{ left: hoveredSeat.x + 16 + 'px', top: hoveredSeat.y - 30 + 'px' }"
      >
        <div class="flex divide-x divide-gray-100 px-1 pt-2 pb-1">
          <div class="flex-1 flex flex-col items-center px-2">
            <span class="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">Section</span>
            <span class="text-sm font-bold text-gray-900 mt-0.5">{{ hoveredSeat.seat.section || catById(hoveredSeat.seat.categoryId).name }}</span>
          </div>
          <div class="flex-1 flex flex-col items-center px-2">
            <span class="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">Rangée</span>
            <span class="text-sm font-bold text-gray-900 mt-0.5">{{ hoveredSeat.seat.rowLabel || '—' }}</span>
          </div>
          <div class="flex-1 flex flex-col items-center px-2">
            <span class="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">Siège</span>
            <span class="text-sm font-bold text-gray-900 mt-0.5">{{ hoveredSeat.seat.colLabel || hoveredSeat.seat.label }}</span>
          </div>
        </div>
        <div
          class="flex items-center justify-center gap-2 px-3 py-1.5 mt-1 text-white text-xs font-bold"
          :style="{ background: catById(hoveredSeat.seat.categoryId).color }"
        >
          <span>{{ catById(hoveredSeat.seat.categoryId).name }}</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.plan-canvas {
  background-color: #ffffff;
}
.seat-block {
  padding-top: 14px;
}
.seat-block-card {
  border: 1px solid transparent;
  border-radius: 22px;
  padding: 14px;
}
.row-badge {
  position: absolute;
  top: -4px;
  left: 50%;
  transform: translate(-50%, -50%);
  background: #fff;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 2px 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  z-index: 2;
  white-space: nowrap;
}
.seat {
  cursor: pointer;
  transition: filter 0.1s;
}
.seat:hover:not(.seat-disabled) {
  filter: brightness(1.15);
}
.seat-disabled {
  cursor: not-allowed;
}
.seat-rounded {
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}
</style>
