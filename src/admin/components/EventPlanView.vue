<script setup>
import { ref, reactive, computed, onMounted, nextTick, watch } from 'vue';
import { computeSeatLabel, computeAxisLabel } from '../../services/seatLabel';
import { iconById } from '../../services/icons';
import MiniMap from '../../components/MiniMap.vue';

const props = defineProps({
  categories:    { type: Array,  required: true },
  zones:         { type: Array,  default: () => [] },
  seatRows:      { type: Array,  default: () => [] },
  freeZones:     { type: Array,  default: () => [] },
  tableZones:    { type: Array,  default: () => [] },
  tableSections: { type: Array,  default: () => [] },
  // event seat statuses: { [seatKey]: 'available'|'booked'|'hold'|'canceled' }
  seatStatusMap: { type: Object, default: () => ({}) },
  // 'view' = tooltip only | 'select' = click to select
  mode:          { type: String, default: 'view' },
  // selected seat keys (Set)
  selectedSeats: { type: Object, default: () => new Set() },
  // 'status' = libre↔vendu | 'for-sale' = en vente↔hors vente | null = générique
  context:       { type: String, default: null },
});
const emit = defineEmits(['toggle-seat']);

function catById(id) {
  return props.categories.find((c) => c.id === id) || { color: '#9ca3af', name: '—' };
}

const STATUS_LABELS = {
  available: 'Libre',
  booked:    'Réservé',
  hold:      'En attente',
  canceled:  'Hors vente',
};

function eventStatus(seatKey) {
  return props.seatStatusMap[seatKey] || 'available';
}

// Calcule l'état visuel du siège (une seule source de vérité)
function seatVisualState(seatKey, planStatus) {
  if (planStatus === 'disabled') return 'disabled';
  if (planStatus === 'deleted')  return 'deleted';
  const es       = eventStatus(seatKey);
  const selected = props.selectedSeats.has(seatKey);
  if (selected) {
    if (props.context === 'status') {
      if (es === 'available') return 'sel-to-booked';    // libre → vendu : creux
      if (es === 'booked')    return 'sel-to-available'; // vendu → libre : plein vif
    }
    if (props.context === 'for-sale') {
      if (es === 'canceled')  return 'sel-to-available'; // hors vente → en vente : plein vif
      if (es === 'available') return 'sel-to-canceled';  // en vente → hors vente : plein vif + croix
    }
    return 'sel-default';
  }
  if (es === 'canceled') return 'canceled';
  if (es === 'booked')   return 'booked';
  if (es === 'hold')     return 'hold';
  return 'available';
}

function seatBg(seatKey, categoryId, planStatus) {
  const color = catById(categoryId).color;
  switch (seatVisualState(seatKey, planStatus)) {
    case 'disabled':        return '#eef0f2';
    case 'deleted':         return 'transparent';
    case 'sel-to-booked':   return 'transparent';   // creux
    case 'sel-to-available':return color;            // plein vif
    case 'sel-to-canceled': return color;            // plein vif + croix
    case 'sel-default':     return '#6366f1';
    case 'available':       return color + '35';     // couleur claire
    case 'booked':          return color;            // couleur vive
    case 'canceled':        return '#f3f4f6';        // gris clair
    case 'hold':            return '#fef3c7';
    default:                return color + '35';
  }
}

function seatFg(seatKey, categoryId, planStatus) {
  const color = catById(categoryId).color;
  switch (seatVisualState(seatKey, planStatus)) {
    case 'disabled':        return '#9ca3af';
    case 'deleted':         return 'transparent';
    case 'sel-to-booked':   return color;   // texte couleur catégorie sur fond transparent
    case 'sel-to-available':return '#fff';
    case 'sel-to-canceled': return '#fff';
    case 'sel-default':     return '#fff';
    case 'available':       return color;   // texte couleur catégorie sur fond clair
    case 'booked':          return '#fff';
    case 'canceled':        return '#9ca3af';
    case 'hold':            return '#d97706';
    default:                return color;
  }
}

function seatBorderStyle(seatKey, planStatus, categoryId) {
  const color = catById(categoryId).color;
  switch (seatVisualState(seatKey, planStatus)) {
    case 'disabled':
    case 'deleted':          return {};
    case 'sel-to-booked':    return { border: `2.5px solid ${color}`, boxShadow: `0 0 0 3px ${color}44` };
    case 'sel-to-available': return { border: `2.5px solid ${color}`, boxShadow: `0 0 0 3px ${color}44` };
    case 'sel-to-canceled':  return { border: `2.5px solid ${color}`, boxShadow: `0 0 0 3px ${color}44` };
    case 'sel-default':      return { border: `2.5px solid #fff`, boxShadow: `0 0 0 3px #6366f1` };
    default:                 return {};
  }
}

// Indique si on doit afficher une croix sur ce siège
function showCross(seatKey, planStatus) {
  const state = seatVisualState(seatKey, planStatus);
  return state === 'canceled' || state === 'sel-to-canceled';
}

function crossColor(seatKey, categoryId, planStatus) {
  const state = seatVisualState(seatKey, planStatus);
  if (state === 'sel-to-canceled') return '#fff';          // croix blanche sur fond vif
  return catById(categoryId).color;                         // croix couleur catégorie sur fond gris
}

function isSeatClickable(seat) {
  if (props.mode !== 'select') return false;
  if (seat.planStatus === 'disabled' || seat.planStatus === 'deleted') return false;
  const es = eventStatus(seat.seatKey);
  if (props.context === 'status'   && es === 'canceled') return false;
  if (props.context === 'for-sale' && es === 'booked')   return false;
  return true;
}

// ---- Geometry helpers ----
const TS_PAD = 4;
function tableZoneSize(t)       { return (t.tableSize || 30) + 2 * (t.seatSize || 15) + 16; }
function tableSectionUnitSize(ts) { return (ts.tableSize || 30) + 2 * (ts.seatSize || 15) + 16; }
function tableSectionWidth(ts)  {
  const unit = tableSectionUnitSize(ts);
  return (ts.tableCount || 3) * unit + ((ts.tableCount || 3) - 1) * (ts.tableSpacing ?? 2) + 2 * TS_PAD;
}
function tableSectionHeight(ts) {
  const rows = ts.tableRows || 1;
  const unit = tableSectionUnitSize(ts);
  return rows * unit + (rows - 1) * (ts.tableSpacing ?? 2) + 2 * TS_PAD;
}

// ---- Build seats ----
function buildSeats(row) {
  const seats = [];
  const disabled  = row.disabledSeats  || [];
  const deleted   = row.deletedSeats   || [];
  const overrides = row.categoryOverrides || {};
  const section   = row.section || row.label || row.id;
  for (let r = 0; r < row.rows; r++) {
    for (let c = 0; c < row.cols; c++) {
      const posKey   = `${r}-${c}`;
      const isDeleted  = deleted.includes(posKey);
      const isDisabled = !isDeleted && disabled.includes(posKey);
      const rowLabel = computeAxisLabel(r, row.rows, row.rowFormat, row.rowDirection);
      const colLabel = computeAxisLabel(c, row.cols, row.colFormat, row.colDirection);
      const seatKey  = `${section}-${rowLabel}-${colLabel}`;
      seats.push({
        seatKey, posKey,
        label:    computeSeatLabel(r, c, row.rows, row.cols, row),
        rowLabel, colLabel, section,
        categoryId: overrides[posKey] || row.categoryId,
        planStatus: isDeleted ? 'deleted' : isDisabled ? 'disabled' : 'available',
      });
    }
  }
  return seats;
}

function buildTableSeats(t) {
  const section  = t.section || t.label || t.id;
  const disabled = t.disabledSeats || [];
  return Array.from({ length: t.seatCount || 6 }, (_, i) => ({
    seatKey:    `${section}-${i + 1}`,
    index: i,
    label: String(i + 1),
    rowLabel: t.section || t.label || '—',
    colLabel: String(i + 1),
    section,
    categoryId:  t.categoryId,
    planStatus:  disabled.includes(i) ? 'disabled' : 'available',
  }));
}

function buildTableSectionSeats(ts) {
  const section  = ts.section || ts.label || ts.id;
  const disabled = ts.disabledSeats || [];
  const deleted  = ts.deletedSeats  || [];
  const seatsOverrides = ts.tableSeatsOverrides || {};
  const totalTables    = (ts.tableCount || 3) * (ts.tableRows || 1);
  const seats = [];
  for (let ti = 0; ti < totalTables; ti++) {
    const spt = seatsOverrides[ti] !== undefined ? Number(seatsOverrides[ti]) : (ts.seatsPerTable || 6);
    for (let si = 0; si < spt; si++) {
      const posKey     = `${ti}-${si}`;
      const isDeleted  = deleted.includes(posKey);
      const isDisabled = !isDeleted && disabled.includes(posKey);
      seats.push({
        seatKey:    `${section}-${ti + 1}-${si + 1}`,
        tableIndex: ti, seatIndex: si, seatsCount: spt,
        label: String(si + 1),
        rowLabel: `T${ti + 1}`, colLabel: String(si + 1), section,
        categoryId: ts.categoryId,
        planStatus: isDeleted ? 'deleted' : isDisabled ? 'disabled' : 'available',
      });
    }
  }
  return seats;
}

// ---- Tooltip ----
const hoveredSeat    = ref(null);
const hoveredSeatKey = ref(null);
function onSeatHover(ev, parentObj, seat) {
  if (seat.planStatus === 'disabled' || seat.planStatus === 'deleted') return;
  hoveredSeat.value    = { seat, x: ev.clientX, y: ev.clientY };
  hoveredSeatKey.value = seat.seatKey;
}
function onSeatLeave() { hoveredSeat.value = null; hoveredSeatKey.value = null; }

function onSeatClick(seat) {
  if (!isSeatClickable(seat)) return;
  emit('toggle-seat', seat.seatKey);
}

// ---- Canvas size ----
const CANVAS_PAD = 150;
const canvasWidth = computed(() => {
  let max = 900;
  for (const z  of props.zones)         max = Math.max(max, (z.left  || 0) + (z.width  || 200) + CANVAS_PAD);
  for (const r  of props.seatRows)      max = Math.max(max, (r.left  || 0) + (r.cols || 1) * ((r.shape === 'rounded' ? (r.seatSize || 22) * 1.5 : (r.seatSize || 22)) + 4) + 28 + CANVAS_PAD);
  for (const f  of props.freeZones)     max = Math.max(max, (f.left  || 0) + (f.width  || 100) + CANVAS_PAD);
  for (const t  of props.tableZones)    max = Math.max(max, (t.left  || 0) + tableZoneSize(t) + CANVAS_PAD);
  for (const ts of props.tableSections) max = Math.max(max, (ts.left || 0) + tableSectionWidth(ts) + CANVAS_PAD);
  return max;
});
const canvasHeight = computed(() => {
  let max = 600;
  for (const z  of props.zones)         max = Math.max(max, (z.top  || 0) + (z.height || 70)  + CANVAS_PAD);
  for (const r  of props.seatRows)      max = Math.max(max, (r.top  || 0) + (r.rows || 1) * ((r.seatSize || 22) + 4) + 30 + CANVAS_PAD);
  for (const f  of props.freeZones)     max = Math.max(max, (f.top  || 0) + (f.height || 50)  + CANVAS_PAD);
  for (const t  of props.tableZones)    max = Math.max(max, (t.top  || 0) + tableZoneSize(t)  + CANVAS_PAD);
  for (const ts of props.tableSections) max = Math.max(max, (ts.top || 0) + tableSectionHeight(ts) + CANVAS_PAD);
  return max;
});

// ---- Zoom / pan ----
const ZOOM_MIN = 0.1, ZOOM_MAX = 2, ZOOM_STEP = 0.15;
const zoom = ref(1);
const panX = ref(40);
const panY = ref(40);
const viewportEl = ref(null);
const panning = reactive({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 });

function setZoom(next) {
  const el = viewportEl.value;
  const prev = zoom.value;
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  if (!el) { zoom.value = clamped; return; }
  const rect = el.getBoundingClientRect();
  panX.value = rect.width / 2 - (rect.width / 2 - panX.value) * (clamped / prev);
  panY.value = rect.height / 2 - (rect.height / 2 - panY.value) * (clamped / prev);
  zoom.value = clamped;
}
function zoomIn()    { setZoom(zoom.value + ZOOM_STEP); }
function zoomOut()   { setZoom(zoom.value - ZOOM_STEP); }
function zoomReset() { zoom.value = 1; panX.value = 40; panY.value = 40; }

function onWheel(ev) {
  ev.preventDefault();
  const el = viewportEl.value;
  if (!el) return;
  const prev = zoom.value;
  const factor = ev.deltaY < 0 ? 1.12 : 0.9;
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev * factor));
  const rect = el.getBoundingClientRect();
  panX.value = (ev.clientX - rect.left) - ((ev.clientX - rect.left) - panX.value) * (next / prev);
  panY.value = (ev.clientY - rect.top)  - ((ev.clientY - rect.top)  - panY.value) * (next / prev);
  zoom.value = next;
}

let panWasDrag = false;

function startPan(ev) {
  if (ev.button !== 0) return;
  panWasDrag = false;
  panning.active = true;
  panning.startX = ev.clientX; panning.startY = ev.clientY;
  panning.originX = panX.value; panning.originY = panY.value;
  window.addEventListener('pointermove', onPan);
  window.addEventListener('pointerup', stopPan);
}
function onPan(ev) {
  if (!panning.active) return;
  const dx = ev.clientX - panning.startX, dy = ev.clientY - panning.startY;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) panWasDrag = true;
  panX.value = panning.originX + dx;
  panY.value = panning.originY + dy;
}
function stopPan() {
  panning.active = false;
  window.removeEventListener('pointermove', onPan);
  window.removeEventListener('pointerup', stopPan);
}

function onViewportClick(ev) {
  if (zoom.value >= 0.5 || panWasDrag) return;
  const rect = viewportEl.value.getBoundingClientRect();
  const cx = (ev.clientX - rect.left - panX.value) / zoom.value;
  const cy = (ev.clientY - rect.top  - panY.value) / zoom.value;
  const newZoom = 1.5;
  panX.value = rect.width  / 2 - cx * newZoom;
  panY.value = rect.height / 2 - cy * newZoom;
  zoom.value = newZoom;
}
function navigateTo({ x, y }) {
  const el = viewportEl.value;
  if (!el) return;
  panX.value = el.clientWidth  / 2 - x * zoom.value;
  panY.value = el.clientHeight / 2 - y * zoom.value;
}

const LOD_THRESHOLD = 0.5;
const isLod = computed(() => zoom.value < LOD_THRESHOLD);

function contentBounds() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (l, t, w, h) => { minX = Math.min(minX, l); minY = Math.min(minY, t); maxX = Math.max(maxX, l + w); maxY = Math.max(maxY, t + h); };
  for (const z  of props.zones)         add(z.left||0, z.top||0, z.width||200, z.height||70);
  for (const r  of props.seatRows)      add(r.left||0, r.top||0, (r.cols||1)*((r.seatSize||22)+4)+28, (r.rows||1)*((r.seatSize||22)+4)+30);
  for (const f  of props.freeZones)     add(f.left||0, f.top||0, f.width||100, f.height||50);
  for (const t  of props.tableZones)    add(t.left||0, t.top||0, tableZoneSize(t), tableZoneSize(t));
  for (const ts of props.tableSections) add(ts.left||0, ts.top||0, tableSectionWidth(ts), tableSectionHeight(ts));
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function fitToView() {
  const el = viewportEl.value;
  if (!el) return;
  const b = contentBounds();
  if (!b) return;
  const pad = 40;
  const vw = el.clientWidth;
  const vh = el.clientHeight;
  const z = Math.min((vw - pad * 2) / b.w, (vh - pad * 2) / b.h, 1);
  zoom.value = Math.max(ZOOM_MIN, z);
  panX.value = (vw - b.w * zoom.value) / 2 - b.x * zoom.value;
  panY.value = (vh - b.h * zoom.value) / 2 - b.y * zoom.value;
}

onMounted(() => nextTick(fitToView));

watch([() => props.seatRows, () => props.zones, () => props.tableSections, () => props.tableZones], () => {
  nextTick(fitToView);
}, { once: true });
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- Zoom controls -->
    <div class="flex items-center justify-between mb-2 shrink-0 px-1">
      <!-- Legend (masquée en mode catégories) -->
      <div v-if="context !== 'categories'" class="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
        <span class="flex items-center gap-1">
          <span class="w-3 h-3 rounded-full inline-block" style="background:#a78bfa55"></span>Libre
        </span>
        <span class="flex items-center gap-1">
          <span class="w-3 h-3 rounded-full inline-block" style="background:#a78bfa"></span>Vendu
        </span>
        <span class="flex items-center gap-1 relative">
          <span class="w-3 h-3 rounded-full inline-block relative" style="background:#f3f4f6">
            <svg viewBox="0 0 10 10" fill="none" class="absolute inset-0 w-full h-full"><line x1="2" y1="2" x2="8" y2="8" stroke="#a78bfa" stroke-width="2.2" stroke-linecap="round"/><line x1="8" y1="2" x2="2" y2="8" stroke="#a78bfa" stroke-width="2.2" stroke-linecap="round"/></svg>
          </span>Hors vente
        </span>
      </div>
      <div class="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
        <button @click="zoomOut"   class="w-7 h-7 flex items-center justify-center text-gray-600 hover:bg-white rounded-md text-lg font-bold">−</button>
        <button @click="zoomReset" class="px-2 h-7 text-gray-500 hover:bg-white rounded-md text-xs font-semibold min-w-[44px]">{{ Math.round(zoom * 100) }}%</button>
        <button @click="zoomIn"    class="w-7 h-7 flex items-center justify-center text-gray-600 hover:bg-white rounded-md text-lg font-bold">+</button>
      </div>
    </div>

    <!-- Canvas viewport -->
    <div
      ref="viewportEl"
      class="flex-1 min-h-0 overflow-hidden rounded-xl relative bg-gray-400"
      :class="panning.active ? 'cursor-grabbing' : 'cursor-grab'"
      style="touch-action: none;"
      @wheel.prevent="onWheel"
      @pointerdown="startPan"
      @click="onViewportClick"
    >
      <div
        class="absolute bg-white shadow-xl"
        :style="{ width: canvasWidth + 'px', height: canvasHeight + 'px', transform: `translate(${panX}px,${panY}px) scale(${zoom})`, transformOrigin: '0 0' }"
      >
        <!-- Zones -->
        <div v-for="z in zones" :key="z.id"
          class="absolute rounded-lg border flex flex-col items-center justify-center text-center px-2 select-none"
          :style="{ top: z.top+'px', left: z.left+'px', width: z.width+'px', height: z.height+'px', background: catById(z.categoryId).color+'14', borderColor: catById(z.categoryId).color+'55' }">
          <p class="font-bold" :style="{ color: catById(z.categoryId).color, fontSize: (z.labelFontSize||11)+'px' }">{{ z.label }}</p>
          <p class="text-gray-400" :style="{ fontSize: Math.max(8,(z.labelFontSize||11)-2)+'px' }">{{ z.capacity }} places</p>
        </div>

        <!-- Zones libres -->
        <div v-for="fz in freeZones" :key="fz.id"
          class="absolute rounded-lg flex flex-col items-center justify-center text-center gap-0.5 select-none pointer-events-none"
          :style="{ top: fz.top+'px', left: fz.left+'px', width: fz.width+'px', height: fz.height+'px', background: fz.color, border: `1px solid ${fz.color}40` }">
          <span v-if="iconById(fz.icon).emoji" :style="{ fontSize: (fz.iconSize||Math.max(12,fz.height*0.32))+'px' }">{{ iconById(fz.icon).emoji }}</span>
          <span class="font-bold uppercase tracking-wide" :style="{ color: fz.textColor||'#000', fontSize: (fz.labelFontSize||10)+'px' }">{{ fz.label }}</span>
        </div>

        <!-- Tables rondes -->
        <div v-for="t in tableZones" :key="t.id"
          class="absolute select-none"
          :style="{ top: t.top+'px', left: t.left+'px', width: tableZoneSize(t)+'px', height: tableZoneSize(t)+'px', transform: `rotate(${t.rotation||0}deg)` }">
          <template v-for="seat in buildTableSeats(t)" :key="seat.index">
            <div class="absolute flex items-center justify-center font-bold rounded-full transition-all overflow-hidden"
              :class="isSeatClickable(seat) ? 'cursor-pointer' : 'cursor-default'"
              :style="{
                width: (t.seatSize||15)+'px', height: (t.seatSize||15)+'px',
                fontSize: (t.seatLabelFontSize||9)+'px',
                background: seatBg(seat.seatKey, seat.categoryId, seat.planStatus),
                color: seatFg(seat.seatKey, seat.categoryId, seat.planStatus),
                left: (tableZoneSize(t)/2 + ((t.tableSize||30)/2+(t.seatSize||15)/2)*Math.cos((2*Math.PI*seat.index)/(t.seatCount||6)-Math.PI/2)-(t.seatSize||15)/2)+'px',
                top:  (tableZoneSize(t)/2 + ((t.tableSize||30)/2+(t.seatSize||15)/2)*Math.sin((2*Math.PI*seat.index)/(t.seatCount||6)-Math.PI/2)-(t.seatSize||15)/2)+'px',
                ...seatBorderStyle(seat.seatKey, seat.planStatus, seat.categoryId),
              }"
              @mouseenter="onSeatHover($event, t, seat)"
              @mouseleave="onSeatLeave"
              @click.stop="onSeatClick(seat)"
            >
              <svg v-if="showCross(seat.seatKey, seat.planStatus)" viewBox="0 0 10 10" fill="none" class="absolute inset-0 w-full h-full pointer-events-none" style="padding:20%">
                <line x1="1" y1="1" x2="9" y2="9" :stroke="crossColor(seat.seatKey, seat.categoryId, seat.planStatus)" stroke-width="2" stroke-linecap="round"/>
                <line x1="9" y1="1" x2="1" y2="9" :stroke="crossColor(seat.seatKey, seat.categoryId, seat.planStatus)" stroke-width="2" stroke-linecap="round"/>
              </svg>
              <span v-else>{{ seat.label }}</span>
            </div>
          </template>
          <div class="absolute rounded-full flex items-center justify-center pointer-events-none"
            :style="{ width:(t.tableSize||30)+'px', height:(t.tableSize||30)+'px', left:(tableZoneSize(t)-(t.tableSize||30))/2+'px', top:(tableZoneSize(t)-(t.tableSize||30))/2+'px', background:catById(t.categoryId).color+'22', border:`2px solid ${catById(t.categoryId).color}88` }">
            <span class="font-bold" :style="{ color:catById(t.categoryId).color, fontSize:(t.tableLabelFontSize||13)+'px' }">{{ t.section||catById(t.categoryId).name }}</span>
          </div>
        </div>

        <!-- Blocs de sièges -->
        <div v-for="row in seatRows" :key="row.id"
          class="absolute select-none"
          :style="{ top: row.top+'px', left: row.left+'px', paddingTop: '14px' }">
          <div v-if="isLod" class="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white border rounded-full px-3 py-0.5 text-xs font-bold whitespace-nowrap z-10"
            :style="{ color: catById(row.categoryId).color, borderColor: catById(row.categoryId).color+'55' }">
            {{ row.section || catById(row.categoryId).name }}
          </div>
          <div class="rounded-lg p-1.5" :class="isLod ? 'opacity-50 blur-[2px]' : ''"
            :style="{ background: catById(row.categoryId).color+'14', border: `1px solid ${catById(row.categoryId).color}55` }">
            <div class="grid gap-1.5"
              :style="{ gridTemplateColumns: `repeat(${row.cols}, minmax(${row.shape==='rounded'?(row.seatSize||22)*1.5:(row.seatSize||22)}px, auto))` }">
              <div v-for="seat in buildSeats(row)" :key="seat.seatKey"
                class="relative flex items-center justify-center leading-none font-semibold transition-all overflow-hidden"
                :class="[
                  seat.planStatus==='disabled' ? 'cursor-not-allowed' : (isSeatClickable(seat) ? 'cursor-pointer' : 'cursor-default'),
                ]"
                :style="{
                  height: (row.seatSize||22)+'px',
                  minWidth: row.shape==='rounded' ? ((row.seatSize||22)*1.5)+'px' : (row.seatSize||22)+'px',
                  padding: row.shape==='rounded' ? '0 6px' : '0',
                  fontSize: Math.max(8,Math.floor((row.seatSize||22)*0.4))+'px',
                  borderRadius: row.shape==='round' ? '50%' : row.shape==='rounded' ? '10px' : '4px',
                  visibility: seat.planStatus==='deleted' ? 'hidden' : 'visible',
                  background: seatBg(seat.seatKey, seat.categoryId, seat.planStatus),
                  color: seatFg(seat.seatKey, seat.categoryId, seat.planStatus),
                  ...seatBorderStyle(seat.seatKey, seat.planStatus, seat.categoryId),
                }"
                @mouseenter="seat.planStatus!=='deleted' && onSeatHover($event, row, seat)"
                @mouseleave="onSeatLeave"
                @click.stop="onSeatClick(seat)"
              >
                <svg v-if="showCross(seat.seatKey, seat.planStatus)" viewBox="0 0 10 10" fill="none" class="absolute inset-0 w-full h-full pointer-events-none" style="padding:20%">
                  <line x1="1" y1="1" x2="9" y2="9" :stroke="crossColor(seat.seatKey, seat.categoryId, seat.planStatus)" stroke-width="2" stroke-linecap="round"/>
                  <line x1="9" y1="1" x2="1" y2="9" :stroke="crossColor(seat.seatKey, seat.categoryId, seat.planStatus)" stroke-width="2" stroke-linecap="round"/>
                </svg>
                <span v-else>{{ (row.seatSize||22) >= 14 && seat.planStatus!=='deleted' ? seat.label : '' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Sections de tables -->
        <div v-for="ts in tableSections" :key="ts.id"
          class="absolute select-none"
          :style="{
            top: ts.top+'px', left: ts.left+'px',
            width: tableSectionWidth(ts)+'px', height: tableSectionHeight(ts)+'px',
            background: catById(ts.categoryId).color+'14',
            border: `1px solid ${catById(ts.categoryId).color}55`,
            borderRadius: '10px',
            transform: `rotate(${ts.rotation||0}deg)`,
          }">
          <div v-if="isLod" class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white border rounded-full px-3 py-0.5 text-xs font-bold whitespace-nowrap z-10 pointer-events-none"
            :style="{ color: catById(ts.categoryId).color, borderColor: catById(ts.categoryId).color+'55' }">
            {{ ts.section || catById(ts.categoryId).name }}
          </div>
          <div :class="isLod ? 'opacity-50 blur-[2px] pointer-events-none' : ''">
            <template v-for="ri in (ts.tableRows||1)" :key="'r'+ri">
              <template v-for="ci in (ts.tableCount||3)" :key="'r'+ri+'c'+ci">
                <template v-if="!(ts.deletedTables||[]).includes((ri-1)*(ts.tableCount||3)+(ci-1))">
                  <template v-for="seat in buildTableSectionSeats(ts).filter(s=>s.tableIndex===(ri-1)*(ts.tableCount||3)+(ci-1))" :key="seat.tableIndex+'-'+seat.seatIndex">
                    <div v-if="seat.planStatus!=='deleted'"
                      class="absolute flex items-center justify-center font-bold rounded-full transition-all overflow-hidden"
                      :class="isSeatClickable(seat) ? 'cursor-pointer' : 'cursor-default'"
                      :style="{
                        width:(ts.seatSize||15)+'px', height:(ts.seatSize||15)+'px',
                        fontSize:(ts.seatLabelFontSize||9)+'px',
                        background: seatBg(seat.seatKey, seat.categoryId, seat.planStatus),
                        color: seatFg(seat.seatKey, seat.categoryId, seat.planStatus),
                        left: (TS_PAD+(ci-1)*(tableSectionUnitSize(ts)+(ts.tableSpacing??2))+tableSectionUnitSize(ts)/2+((ts.tableSize||30)/2+(ts.seatSize||15)/2)*Math.cos((2*Math.PI*seat.seatIndex)/seat.seatsCount-Math.PI/2)-(ts.seatSize||15)/2)+'px',
                        top:  (TS_PAD+(ri-1)*(tableSectionUnitSize(ts)+(ts.tableSpacing??2))+tableSectionUnitSize(ts)/2+((ts.tableSize||30)/2+(ts.seatSize||15)/2)*Math.sin((2*Math.PI*seat.seatIndex)/seat.seatsCount-Math.PI/2)-(ts.seatSize||15)/2)+'px',
                        ...seatBorderStyle(seat.seatKey, seat.planStatus, seat.categoryId),
                      }"
                      @mouseenter="onSeatHover($event, ts, seat)"
                      @mouseleave="onSeatLeave"
                      @click.stop="onSeatClick(seat)"
                    >
                      <svg v-if="showCross(seat.seatKey, seat.planStatus)" viewBox="0 0 10 10" fill="none" class="absolute inset-0 w-full h-full pointer-events-none" style="padding:20%">
                        <line x1="1" y1="1" x2="9" y2="9" :stroke="crossColor(seat.seatKey, seat.categoryId, seat.planStatus)" stroke-width="2" stroke-linecap="round"/>
                        <line x1="9" y1="1" x2="1" y2="9" :stroke="crossColor(seat.seatKey, seat.categoryId, seat.planStatus)" stroke-width="2" stroke-linecap="round"/>
                      </svg>
                      <span v-else>{{ seat.label }}</span>
                    </div>
                  </template>
                  <!-- Table circle -->
                  <div class="absolute rounded-full flex items-center justify-center pointer-events-none"
                    :style="{
                      width:(ts.tableSize||30)+'px', height:(ts.tableSize||30)+'px',
                      left:(TS_PAD+(ci-1)*(tableSectionUnitSize(ts)+(ts.tableSpacing??2))+(tableSectionUnitSize(ts)-(ts.tableSize||30))/2)+'px',
                      top:(TS_PAD+(ri-1)*(tableSectionUnitSize(ts)+(ts.tableSpacing??2))+(tableSectionUnitSize(ts)-(ts.tableSize||30))/2)+'px',
                      background:catById(ts.categoryId).color+'22',
                      border:`2px solid ${catById(ts.categoryId).color}88`,
                    }">
                    <span class="font-bold leading-tight" :style="{ color:catById(ts.categoryId).color, fontSize:(ts.tableLabelFontSize||13)+'px' }">T{{ (ri-1)*(ts.tableCount||3)+ci }}</span>
                  </div>
                </template>
              </template>
            </template>
          </div>
        </div>

        <div v-if="!zones.length && !seatRows.length && !freeZones.length && !tableZones.length && !tableSections.length"
          class="absolute inset-0 flex items-center justify-center text-gray-400 text-sm pointer-events-none">
          Aucun élément dans ce plan.
        </div>
      </div>

      <!-- Mini-map -->
      <MiniMap
        v-if="zoom > 1"
        :categories="categories"
        :zones="zones"
        :seat-zones="seatRows"
        :content-width="canvasWidth"
        :content-height="canvasHeight"
        :pan-x="panX"
        :pan-y="panY"
        :zoom="zoom"
        :viewport-pixel-w="viewportEl ? viewportEl.clientWidth : 900"
        :viewport-pixel-h="viewportEl ? viewportEl.clientHeight : 500"
        @navigate="navigateTo"
      />
    </div>
  </div>

  <!-- Tooltip -->
  <Teleport to="body">
    <div v-if="hoveredSeat"
      class="fixed z-50 pointer-events-none shadow-xl rounded-xl overflow-hidden bg-white border border-gray-100"
      style="min-width:200px;"
      :style="{ left: hoveredSeat.x+16+'px', top: hoveredSeat.y-30+'px' }">
      <!-- Header: section / table / siège -->
      <div class="flex divide-x divide-gray-100 px-1 pt-2 pb-1">
        <div class="flex-1 flex flex-col items-center px-2">
          <span class="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">Section</span>
          <span class="text-sm font-bold text-gray-900 mt-0.5">{{ hoveredSeat.seat.section || catById(hoveredSeat.seat.categoryId).name }}</span>
        </div>
        <div class="flex-1 flex flex-col items-center px-2">
          <span class="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">Table</span>
          <span class="text-sm font-bold text-gray-900 mt-0.5">{{ hoveredSeat.seat.rowLabel || '—' }}</span>
        </div>
        <div class="flex-1 flex flex-col items-center px-2">
          <span class="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">Siège</span>
          <span class="text-sm font-bold text-gray-900 mt-0.5">{{ hoveredSeat.seat.colLabel || hoveredSeat.seat.label }}</span>
        </div>
      </div>
      <!-- Catégorie -->
      <div class="flex items-center gap-2 px-3 py-1.5 text-white text-xs font-bold"
        :style="{ background: catById(hoveredSeat.seat.categoryId).color }">
        <span class="w-2 h-2 rounded-full bg-white/40 inline-block"></span>
        <span>{{ catById(hoveredSeat.seat.categoryId).name }}</span>
      </div>
      <!-- Statut événement -->
      <div class="flex items-center gap-2 px-3 py-1.5 border-t border-gray-100">
        <svg v-if="eventStatus(hoveredSeat.seat.seatKey)==='booked'" class="w-3.5 h-3.5 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
        <svg v-else-if="eventStatus(hoveredSeat.seat.seatKey)==='hold'" class="w-3.5 h-3.5 text-amber-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/></svg>
        <svg v-else-if="eventStatus(hoveredSeat.seat.seatKey)==='canceled'" class="w-3.5 h-3.5 text-red-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>
        <span v-else class="w-3.5 h-3.5 flex items-center justify-center">
          <span class="w-2 h-2 rounded-full border-2 border-gray-400 inline-block"></span>
        </span>
        <span class="text-xs font-semibold"
          :class="{
            'text-green-600': eventStatus(hoveredSeat.seat.seatKey)==='booked',
            'text-amber-500': eventStatus(hoveredSeat.seat.seatKey)==='hold',
            'text-red-400':   eventStatus(hoveredSeat.seat.seatKey)==='canceled',
            'text-gray-500':  eventStatus(hoveredSeat.seat.seatKey)==='available',
          }">
          {{ STATUS_LABELS[eventStatus(hoveredSeat.seat.seatKey)] }}
        </span>
      </div>
    </div>
  </Teleport>
</template>
