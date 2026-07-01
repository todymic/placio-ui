<script setup>
import { ref, reactive, watch, computed, onMounted, nextTick } from 'vue';
import { adminApi } from '../services/adminApi';
import { computeSeatLabel, computeAxisLabel, ROW_FORMATS, COL_FORMATS, DIRECTIONS } from '../../services/seatLabel';
import { FREE_ZONE_ICONS, FREE_ZONE_PATTERNS, iconById, patternStyle } from '../../services/icons';

const props = defineProps({
  venueId: { type: String, required: true },
  categories: { type: Array, required: true },
});
const emit = defineEmits(['changed']);

const zones = ref([]);
const seatRows = ref([]);
const freeZones = ref([]);
const tableZones = ref([]);
const tableSections = ref([]);
const loading = ref(true);

// selected = { kind: 'zone' | 'seatRow' | 'freeZone' | 'seat', id, rowId?, seatId?, seatInfo? }
const selected = ref(null);
// Multi-sélection de sièges : clés "rowId|r-c"
const multiSelected = reactive(new Set());
const bulkCategoryChoice = ref('');

const canvasRef = ref(null);
const canvasContainerRef = ref(null);

// ---- Zoom + Pan (translate libre) ----
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.15;
const zoom = ref(1);
const panX = ref(40);
const panY = ref(40);
const scrollerRef = ref(null);

function setZoom(next) {
  const el = scrollerRef.value;
  const prev = zoom.value;
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  if (!el) { zoom.value = clamped; return; }
  const rect = el.getBoundingClientRect();
  const cx = rect.width  / 2;
  const cy = rect.height / 2;
  // point fixe = centre du container
  panX.value = cx - (cx - panX.value) * (clamped / prev);
  panY.value = cy - (cy - panY.value) * (clamped / prev);
  zoom.value = clamped;
}
function zoomIn()    { setZoom(zoom.value + ZOOM_STEP); }
function zoomOut()   { setZoom(zoom.value - ZOOM_STEP); }
function zoomReset() { zoom.value = 1; panX.value = 40; panY.value = 40; }

function onWheel(ev) {
  ev.preventDefault();
  const el = scrollerRef.value;
  if (!el) return;
  const prev = zoom.value;
  const factor = ev.deltaY < 0 ? 1.12 : 0.9;
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev * factor));
  const rect = el.getBoundingClientRect();
  // point fixe = position de la souris dans le container
  const mx = ev.clientX - rect.left;
  const my = ev.clientY - rect.top;
  panX.value = mx - (mx - panX.value) * (next / prev);
  panY.value = my - (my - panY.value) * (next / prev);
  zoom.value = next;
}

const drag = reactive({ active: false, mode: null, kind: null, id: null, offsetX: 0, offsetY: 0, startW: 0, startH: 0, startX: 0, startY: 0 });
const pan = reactive({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 });

function startPan(ev) {
  if (ev.button !== 0) return;
  ev.preventDefault();
  pan.active = true;
  pan.startX = ev.clientX; pan.startY = ev.clientY;
  pan.originX = panX.value; pan.originY = panY.value;
  ev.target.setPointerCapture(ev.pointerId);
  window.addEventListener('pointermove', onPan);
  window.addEventListener('pointerup', stopPan);
  window.addEventListener('pointercancel', stopPan);
}
function onPan(ev) {
  if (!pan.active) return;
  panX.value = pan.originX + (ev.clientX - pan.startX);
  panY.value = pan.originY + (ev.clientY - pan.startY);
}
function stopPan() {
  pan.active = false;
  window.removeEventListener('pointermove', onPan);
  window.removeEventListener('pointerup', stopPan);
  window.removeEventListener('pointercancel', stopPan);
}



// Statuts de sièges modifiés localement depuis l'éditeur (démo — non persistés en base)
const seatStatusOverrides = reactive({});

const CANVAS_PAD = 400;

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

const canvasHeight = computed(() => {
  let max = 600;
  for (const z of zones.value)      max = Math.max(max, (z.top  || 0) + (z.height || 70)  + CANVAS_PAD);
  for (const r of seatRows.value)   max = Math.max(max, (r.top  || 0) + (r.rows || 1) * ((r.seatSize || 22) + 4) + 30 + CANVAS_PAD);
  for (const f of freeZones.value)  max = Math.max(max, (f.top  || 0) + (f.height || 50)  + CANVAS_PAD);
  for (const t of tableZones.value) max = Math.max(max, (t.top  || 0) + tableZoneSize(t)   + CANVAS_PAD);
  for (const ts of tableSections.value) max = Math.max(max, (ts.top || 0) + tableSectionUnitSize(ts) + 24 + CANVAS_PAD);
  return max;
});

const canvasWidth = computed(() => {
  let max = 900;
  for (const z of zones.value)      max = Math.max(max, (z.left  || 0) + (z.width  || 200) + CANVAS_PAD);
  for (const r of seatRows.value)   max = Math.max(max, (r.left  || 0) + (r.cols || 1) * ((r.shape === 'rounded' ? (r.seatSize || 22) * 1.5 : (r.seatSize || 22)) + 4) + 28 + CANVAS_PAD);
  for (const f of freeZones.value)  max = Math.max(max, (f.left  || 0) + (f.width  || 100) + CANVAS_PAD);
  for (const t of tableZones.value) max = Math.max(max, (t.left  || 0) + tableZoneSize(t)   + CANVAS_PAD);
  for (const ts of tableSections.value) max = Math.max(max, (ts.left || 0) + tableSectionWidth(ts) + CANVAS_PAD);
  return max;
});

function initZCounter() {
  const all = [...zones.value, ...seatRows.value, ...freeZones.value, ...tableZones.value, ...tableSections.value];
  zCounter.value = all.reduce((max, o) => Math.max(max, o.zIndex || 0), 0);
}

async function load() {
  loading.value = true;
  zones.value = await adminApi.listZones(props.venueId);
  seatRows.value = await adminApi.listSeatRows(props.venueId);
  freeZones.value = await adminApi.listFreeZones(props.venueId);
  tableZones.value = await adminApi.listTableZones(props.venueId);
  tableSections.value = await adminApi.listTableSections(props.venueId);
  initZCounter();
  loading.value = false;
  emit('changed');
}
watch(() => props.venueId, load, { immediate: true });

function catById(id) {
  return props.categories.find((c) => c.id === id) || { color: '#999999', name: '—' };
}

function seatGrid(row) {
  const seats = [];
  const naming = { rowFormat: row.rowFormat, rowDirection: row.rowDirection, colFormat: row.colFormat, colDirection: row.colDirection };
  const disabledSeats = row.disabledSeats || [];
  const overrides = row.categoryOverrides || {};
  const section = row.section || row.label || row.id;
  for (let r = 0; r < row.rows; r++) {
    for (let c = 0; c < row.cols; c++) {
      const posKey = `${r}-${c}`;
      const isDisabled = disabledSeats.includes(posKey);
      const rowLabel = computeAxisLabel(r, row.rows, naming.rowFormat, naming.rowDirection);
      const colLabel = computeAxisLabel(c, row.cols, naming.colFormat, naming.colDirection);
      // Clé unique et lisible : section-rangée-siège
      const key = `${section}-${rowLabel}-${colLabel}`;
      seats.push({
        key, r, c, posKey,
        rowLabel, colLabel,
        label: computeSeatLabel(r, c, row.rows, row.cols, naming),
        categoryId: overrides[posKey] || row.categoryId,
        status: isDisabled ? 'disabled' : (seatStatusOverrides[`${row.id}-${posKey}`] || 'available'),
      });
    }
  }
  return seats;
}

function tableSeats(t) {
  const section = t.section || t.label || t.id;
  const disabled = t.disabledSeats || [];
  return Array.from({ length: t.seatCount || 6 }, (_, i) => ({
    index: i,
    key: `${section}-${i + 1}`,
    status: disabled.includes(i) ? 'disabled' : (seatStatusOverrides[`tz:${t.id}|${i}`] || 'available'),
    categoryId: t.categoryId,
  }));
}

function tableSectionSeats(ts) {
  const section = ts.section || ts.label || ts.id;
  const disabled = ts.disabledSeats || [];
  const seats = [];
  for (let ti = 0; ti < (ts.tableCount || 3); ti++) {
    for (let si = 0; si < (ts.seatsPerTable || 6); si++) {
      const disabledKey = `${ti}-${si}`;
      seats.push({
        tableIndex: ti, seatIndex: si,
        key: `${section}-${ti + 1}-${si + 1}`,
        status: disabled.includes(disabledKey) ? 'disabled' : (seatStatusOverrides[`tse:${ts.id}|${ti}-${si}`] || 'available'),
        categoryId: ts.categoryId,
      });
    }
  }
  return seats;
}

// Computed: all seat keys (for duplicate detection)
const allSeatKeys = computed(() => {
  const keys = [];
  for (const r of seatRows.value) {
    const section = r.section || r.label || r.id;
    const disabled = r.disabledSeats || [];
    for (let row = 0; row < (r.rows || 0); row++) {
      for (let col = 0; col < (r.cols || 0); col++) {
        if (disabled.includes(`${row}-${col}`)) continue;
        const rl = computeAxisLabel(row, r.rows, r.rowFormat, r.rowDirection);
        const cl = computeAxisLabel(col, r.cols, r.colFormat, r.colDirection);
        keys.push(`${section}-${rl}-${cl}`);
      }
    }
  }
  for (const t of tableZones.value) {
    const section = t.section || t.label || t.id;
    const disabled = t.disabledSeats || [];
    for (let i = 0; i < (t.seatCount || 6); i++) {
      if (!disabled.includes(i)) keys.push(`${section}-${i + 1}`);
    }
  }
  for (const ts of tableSections.value) {
    const section = ts.section || ts.label || ts.id;
    const disabled = ts.disabledSeats || [];
    for (let ti = 0; ti < (ts.tableCount || 3); ti++) {
      for (let si = 0; si < (ts.seatsPerTable || 6); si++) {
        if (!disabled.includes(`${ti}-${si}`)) keys.push(`${section}-${ti + 1}-${si + 1}`);
      }
    }
  }
  return keys;
});

const duplicateKeys = computed(() => {
  const counts = {};
  for (const k of allSeatKeys.value) counts[k] = (counts[k] || 0) + 1;
  return Object.keys(counts).filter(k => counts[k] > 1);
});

const anomalies = computed(() => {
  const issues = [];

  if (duplicateKeys.value.length > 0) {
    issues.push({ type: 'duplicate', label: `${duplicateKeys.value.length} siège(s) en doublon`, keys: duplicateKeys.value });
  }

  const missingSection = [
    ...seatRows.value.filter(x => !x.section).map(x => ({ id: x.id, kind: 'seatRow', label: x.label || x.id })),
    ...tableZones.value.filter(x => !x.section).map(x => ({ id: x.id, kind: 'tableZone', label: x.label || x.id })),
    ...tableSections.value.filter(x => !x.section).map(x => ({ id: x.id, kind: 'tableSection', label: x.label || x.id })),
  ];
  if (missingSection.length > 0) {
    issues.push({ type: 'section', label: `${missingSection.length} élément(s) sans section définie`, items: missingSection });
  }

  const missingCategory = [
    ...seatRows.value.filter(x => !x.categoryId).map(x => ({ id: x.id, kind: 'seatRow', label: x.section || x.label || x.id })),
    ...tableZones.value.filter(x => !x.categoryId).map(x => ({ id: x.id, kind: 'tableZone', label: x.section || x.label || x.id })),
    ...tableSections.value.filter(x => !x.categoryId).map(x => ({ id: x.id, kind: 'tableSection', label: x.section || x.label || x.id })),
  ];
  if (missingCategory.length > 0) {
    issues.push({ type: 'category', label: `${missingCategory.length} élément(s) sans catégorie définie`, items: missingCategory });
  }

  return issues;
});

function findObjectByKey(key) {
  for (const r of seatRows.value) {
    const section = r.section || r.label || r.id;
    const disabled = r.disabledSeats || [];
    for (let row = 0; row < (r.rows || 0); row++) {
      for (let col = 0; col < (r.cols || 0); col++) {
        if (disabled.includes(`${row}-${col}`)) continue;
        const rl = computeAxisLabel(row, r.rows, r.rowFormat, r.rowDirection);
        const cl = computeAxisLabel(col, r.cols, r.colFormat, r.colDirection);
        if (`${section}-${rl}-${cl}` === key) return { kind: 'seatRow', obj: r };
      }
    }
  }
  for (const t of tableZones.value) {
    const section = t.section || t.label || t.id;
    const disabled = t.disabledSeats || [];
    for (let i = 0; i < (t.seatCount || 6); i++) {
      if (!disabled.includes(i) && `${section}-${i + 1}` === key) return { kind: 'tableZone', obj: t };
    }
  }
  for (const ts of tableSections.value) {
    const section = ts.section || ts.label || ts.id;
    const disabled = ts.disabledSeats || [];
    for (let ti = 0; ti < (ts.tableCount || 3); ti++) {
      for (let si = 0; si < (ts.seatsPerTable || 6); si++) {
        if (!disabled.includes(`${ti}-${si}`) && `${section}-${ti + 1}-${si + 1}` === key) return { kind: 'tableSection', obj: ts };
      }
    }
  }
  return null;
}

function selectAnomalyItem(anomaly, item = null) {
  if (anomaly.type === 'duplicate') {
    const key = item?.key ?? anomaly.keys?.[0];
    if (!key) return;
    const found = findObjectByKey(key);
    if (!found) return;
    if (found.kind === 'seatRow') selectSeatRow(found.obj);
    else if (found.kind === 'tableZone') selectTableZone(found.obj);
    else selectTableSection(found.obj);
  } else {
    const target = item ?? anomaly.items?.[0];
    if (!target) return;
    if (target.kind === 'seatRow') { const r = seatRows.value.find(x => x.id === target.id); if (r) selectSeatRow(r); }
    else if (target.kind === 'tableZone') { const t = tableZones.value.find(x => x.id === target.id); if (t) selectTableZone(t); }
    else { const ts = tableSections.value.find(x => x.id === target.id); if (ts) selectTableSection(ts); }
  }
}

const canSave = computed(() => anomalies.value.length === 0);

const selectedZone = computed(() => selected.value?.kind === 'zone' ? zones.value.find((z) => z.id === selected.value.id) : null);
const selectedSeatRow = computed(() => selected.value?.kind === 'seatRow' ? seatRows.value.find((r) => r.id === selected.value.id) : null);
const selectedFreeZone = computed(() => selected.value?.kind === 'freeZone' ? freeZones.value.find((f) => f.id === selected.value.id) : null);
const selectedTableZone = computed(() => selected.value?.kind === 'tableZone' ? tableZones.value.find((t) => t.id === selected.value.id) : null);
const selectedTableSection = computed(() => selected.value?.kind === 'tableSection' ? tableSections.value.find((ts) => ts.id === selected.value.id) : null);
const selectedTableSectionSeat = computed(() => {
  if (selected.value?.kind !== 'tableSectionSeat') return null;
  const ts = tableSections.value.find((x) => x.id === selected.value.tsId);
  if (!ts) return null;
  return { ts, ...selected.value.seatInfo };
});
const selectedSeat = computed(() => {
  if (selected.value?.kind !== 'seat') return null;
  const row = seatRows.value.find((r) => r.id === selected.value.rowId);
  if (!row) return null;
  return { row, ...selected.value.seatInfo };
});
const selectedTableSeat = computed(() => {
  if (selected.value?.kind !== 'tableSeat') return null;
  const t = tableZones.value.find((x) => x.id === selected.value.tableId);
  if (!t) return null;
  return { table: t, ...selected.value.seatInfo };
});

function selectZone(z) { selected.value = { kind: 'zone', id: z.id }; multiSelected.clear(); }
function selectSeatRow(r) { selected.value = { kind: 'seatRow', id: r.id }; multiSelected.clear(); }
function selectFreeZone(f) { selected.value = { kind: 'freeZone', id: f.id }; multiSelected.clear(); }
function selectTableZone(t) { selected.value = { kind: 'tableZone', id: t.id }; multiSelected.clear(); }
function selectTableSection(ts) { selected.value = { kind: 'tableSection', id: ts.id }; multiSelected.clear(); }
function selectTableSectionSeat(ts, seat) {
  selected.value = { kind: 'tableSectionSeat', tsId: ts.id, seatInfo: seat };
  multiSelected.clear();
}
function selectSeat(row, seat) {
  selected.value = { kind: 'seat', rowId: row.id, seatId: seat.key, seatInfo: seat };
  multiSelected.clear();
}
function selectTableSeat(t, seat) {
  selected.value = { kind: 'tableSeat', tableId: t.id, seatInfo: seat };
  multiSelected.clear();
}
function deselect() { selected.value = null; multiSelected.clear(); }

// ---------- Clic sur un siège : sélection simple ou multiple (Ctrl/Cmd ou Shift) ----------
function onSeatClick(row, seat, ev) {
  if (ev.ctrlKey || ev.metaKey || ev.shiftKey) {
    selected.value = null;
    const key = `${row.id}|${seat.posKey}`;
    if (multiSelected.has(key)) multiSelected.delete(key); else multiSelected.add(key);
  } else {
    selectSeat(row, seat);
  }
}
function isMultiSelected(row, seat) {
  return multiSelected.has(`${row.id}|${seat.posKey}`);
}
function onTableSeatClick(t, seat, ev) {
  if (ev.ctrlKey || ev.metaKey || ev.shiftKey) {
    selected.value = null;
    const key = `tz:${t.id}|${seat.index}`;
    if (multiSelected.has(key)) multiSelected.delete(key); else multiSelected.add(key);
  } else {
    selectTableSeat(t, seat);
  }
}
function isMultiSelectedTableSeat(t, seat) {
  return multiSelected.has(`tz:${t.id}|${seat.index}`);
}
function onTableSectionSeatClick(ts, seat, ev) {
  if (ev.ctrlKey || ev.metaKey || ev.shiftKey) {
    selected.value = null;
    const key = `tse:${ts.id}|${seat.tableIndex}-${seat.seatIndex}`;
    if (multiSelected.has(key)) multiSelected.delete(key); else multiSelected.add(key);
  } else {
    selectTableSectionSeat(ts, seat);
  }
}
function isMultiSelectedTableSectionSeat(ts, seat) {
  return multiSelected.has(`tse:${ts.id}|${seat.tableIndex}-${seat.seatIndex}`);
}

// ---------- Déplacement (zones, blocs de sièges, zones libres) ----------
const zCounter = ref(1);
function bringToFront(item) {
  item.zIndex = ++zCounter.value;
}

function startDrag(ev, kind, item) {
  ev.preventDefault();
  ev.stopPropagation();
  bringToFront(item);
  if (kind === 'zone') selectZone(item);
  else if (kind === 'seatRow') selectSeatRow(item);
  else if (kind === 'tableZone') selectTableZone(item);
  else if (kind === 'tableSection') selectTableSection(item);
  else selectFreeZone(item);
  const canvasRect = canvasRef.value.getBoundingClientRect();
  const z = zoom.value;
  drag.active = true;
  drag.mode = 'move';
  drag.kind = kind;
  drag.id = item.id;
  drag.offsetX = (ev.clientX - canvasRect.left) / z - item.left;
  drag.offsetY = (ev.clientY - canvasRect.top)  / z - item.top;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', stopDrag);
}

// ---------- Redimensionnement (zones + zones libres), par côté ----------
function startResize(ev, kind, item, side) {
  ev.preventDefault();
  ev.stopPropagation();
  if (kind === 'zone') selectZone(item); else selectFreeZone(item);
  drag.active = true;
  drag.mode = 'resize';
  drag.side = side;
  drag.kind = kind;
  drag.id = item.id;
  drag.startW = item.width;
  drag.startH = item.height;
  drag.startLeft = item.left;
  drag.startTop = item.top;
  drag.startX = ev.clientX;
  drag.startY = ev.clientY;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', stopDrag);
}

// ---------- Redimensionnement dynamique d'un bloc de sièges, par côté ----------
// Côté gauche/droit -> ajoute/retire des COLONNES (sièges par rang) · côté haut/bas -> ajoute/retire des RANGÉES
function startResizeSeatRow(ev, row, side) {
  ev.preventDefault();
  ev.stopPropagation();
  selectSeatRow(row);
  drag.active = true;
  drag.mode = 'resizeSeatRow';
  drag.side = side;
  drag.kind = 'seatRow';
  drag.id = row.id;
  drag.baseRows = row.rows;
  drag.baseCols = row.cols;
  drag.cellSize = (row.seatSize || 18) + 6;
  drag.startX = ev.clientX;
  drag.startY = ev.clientY;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', stopDrag);
}

function listFor(kind) {
  if (kind === 'zone') return zones.value;
  if (kind === 'freeZone') return freeZones.value;
  if (kind === 'tableZone') return tableZones.value;
  if (kind === 'tableSection') return tableSections.value;
  return seatRows.value;
}

function onPointerMove(ev) {
  if (!drag.active) return;
  const z = zoom.value;
  if (drag.mode === 'move') {
    const canvasRect = canvasRef.value.getBoundingClientRect();
    let newLeft = Math.max(0, Math.round((ev.clientX - canvasRect.left) / z - drag.offsetX));
    let newTop  = Math.max(0, Math.round((ev.clientY - canvasRect.top)  / z - drag.offsetY));
    const item = listFor(drag.kind).find((x) => x.id === drag.id);
    if (item) { item.left = newLeft; item.top = newTop; }
  } else if (drag.mode === 'resize') {
    const item = listFor(drag.kind).find((x) => x.id === drag.id);
    if (item) {
      const dx = (ev.clientX - drag.startX) / z;
      const dy = (ev.clientY - drag.startY) / z;
      if (drag.side === 'right') {
        item.width = Math.max(40, Math.round(drag.startW + dx));
      } else if (drag.side === 'left') {
        const newW = Math.max(40, Math.round(drag.startW - dx));
        item.left = Math.max(0, Math.round(drag.startLeft + (drag.startW - newW)));
        item.width = newW;
      } else if (drag.side === 'bottom') {
        item.height = Math.max(30, Math.round(drag.startH + dy));
      } else if (drag.side === 'top') {
        const newH = Math.max(30, Math.round(drag.startH - dy));
        item.top = Math.max(0, Math.round(drag.startTop + (drag.startH - newH)));
        item.height = newH;
      }
    }
  } else if (drag.mode === 'resizeSeatRow') {
    const item = seatRows.value.find((x) => x.id === drag.id);
    if (item) {
      const dx = (ev.clientX - drag.startX) / z;
      const dy = (ev.clientY - drag.startY) / z;
      if (drag.side === 'right') {
        item.cols = Math.max(1, drag.baseCols + Math.round(dx / drag.cellSize));
      } else if (drag.side === 'left') {
        item.cols = Math.max(1, drag.baseCols - Math.round(dx / drag.cellSize));
      } else if (drag.side === 'bottom') {
        item.rows = Math.max(1, drag.baseRows + Math.round(dy / drag.cellSize));
      } else if (drag.side === 'top') {
        item.rows = Math.max(1, drag.baseRows - Math.round(dy / drag.cellSize));
      }
    }
  }
}

async function stopDrag() {
  if (!drag.active) return;
  const mode = drag.mode, kind = drag.kind, id = drag.id;
  drag.active = false;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', stopDrag);

  const item = listFor(kind).find((x) => x.id === id);
  if (!item) return;

  if (mode === 'move') {
    if (kind === 'zone') await adminApi.updateZone(item.id, { top: item.top, left: item.left }, props.venueId);
    else if (kind === 'freeZone') await adminApi.updateFreeZone(item.id, { top: item.top, left: item.left }, props.venueId);
    else if (kind === 'tableZone') await adminApi.updateTableZone(item.id, { top: item.top, left: item.left }, props.venueId);
    else if (kind === 'tableSection') await adminApi.updateTableSection(item.id, { top: item.top, left: item.left }, props.venueId);
    else await adminApi.updateSeatRow(item.id, { top: item.top, left: item.left }, props.venueId);
  } else if (mode === 'resize') {
    if (kind === 'zone') await adminApi.updateZone(item.id, { width: item.width, height: item.height, top: item.top, left: item.left }, props.venueId);
    else await adminApi.updateFreeZone(item.id, { width: item.width, height: item.height, top: item.top, left: item.left }, props.venueId);
  } else if (mode === 'resizeSeatRow') {
    await adminApi.updateSeatRow(item.id, { rows: item.rows, cols: item.cols }, props.venueId);
  }
  emit('changed');
}

// ---------- Ajout ----------
async function addZone() {
  if (props.categories.length === 0) return;
  const z = await adminApi.createZone(props.venueId, {
    label: 'Nouvelle zone', categoryId: props.categories[0].id,
    top: 40, left: 40, width: 200, height: 70, capacity: 50, shape: 'rect', labelFontSize: 11,
  });
  zones.value.push(z);
  selectZone(z);
  emit('changed');
}
async function addSeatRow() {
  if (props.categories.length === 0) return;
  const nextNumber = seatRows.value.reduce((max, r) => Math.max(max, r.blockNumber || 0), 0) + 1;
  const r = await adminApi.createSeatRow(props.venueId, {
    section: '', label: 'Nouveau bloc', categoryId: props.categories[0].id,
    top: 40, left: 40, rows: 3, cols: 6, shape: 'rounded', seatSize: 22,
  });
  seatRows.value.push(r);
  selectSeatRow(r);
  emit('changed');
}
async function addFreeZone() {
  const fz = await adminApi.createFreeZone(props.venueId, {
    label: 'Zone libre', icon: 'none', color: '#6b7280', pattern: 'solid',
    top: 40, left: 300, width: 110, height: 50, labelFontSize: 10,
  });
  freeZones.value.push(fz);
  selectFreeZone(fz);
  emit('changed');
}
async function addTableSection() {
  if (props.categories.length === 0) return;
  const ts = await adminApi.createTableSection(props.venueId, {
    section: '', label: 'Section de tables', tableCount: 3, seatsPerTable: 6,
    tableSize: 30, seatSize: 15, tableSpacing: 20,
    categoryId: props.categories[0].id,
    top: 80, left: 80, rowLabelFontSize: 10, disabledSeats: [],
  });
  tableSections.value.push(ts);
  selectTableSection(ts);
  emit('changed');
}
async function addTableZone() {
  if (props.categories.length === 0) return;
  const t = await adminApi.createTableZone(props.venueId, {
    section: '', label: 'Table', seatCount: 6,
    tableSize: 30, seatSize: 15,
    categoryId: props.categories[0].id,
    top: 80, left: 200, rowLabelFontSize: 10, disabledSeats: [],
  });
  tableZones.value.push(t);
  selectTableZone(t);
  emit('changed');
}

// ---------- Édition via panneau latéral ----------
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistSelected, 350);
}
async function persistSelected() {
  if (selectedZone.value) {
    const z = selectedZone.value;
    await adminApi.updateZone(z.id, {
      label: z.label, categoryId: z.categoryId, shape: z.shape,
      width: Number(z.width), height: Number(z.height), capacity: Number(z.capacity),
      labelFontSize: Number(z.labelFontSize),
    }, props.venueId);
  } else if (selectedSeatRow.value) {
    const r = selectedSeatRow.value;
    await adminApi.updateSeatRow(r.id, {
      section: r.section, label: r.label, categoryId: r.categoryId,
      rows: Number(r.rows), cols: Number(r.cols),
      shape: r.shape, seatSize: Number(r.seatSize),
      rowFormat: r.rowFormat, rowDirection: r.rowDirection,
      colFormat: r.colFormat, colDirection: r.colDirection,
      rowLabelFontSize: Number(r.rowLabelFontSize),
    }, props.venueId);
  } else if (selectedFreeZone.value) {
    const f = selectedFreeZone.value;
    await adminApi.updateFreeZone(f.id, {
      label: f.label, icon: f.icon, color: f.color, pattern: f.pattern,
      width: Number(f.width), height: Number(f.height), labelFontSize: Number(f.labelFontSize),
    }, props.venueId);
  } else if (selectedTableZone.value) {
    const t = selectedTableZone.value;
    await adminApi.updateTableZone(t.id, {
      section: t.section, label: t.label, categoryId: t.categoryId,
      seatCount: Number(t.seatCount), tableSize: Number(t.tableSize),
      seatSize: Number(t.seatSize), rowLabelFontSize: Number(t.rowLabelFontSize),
      disabledSeats: t.disabledSeats || [],
    }, props.venueId);
  } else if (selectedTableSection.value) {
    const ts = selectedTableSection.value;
    await adminApi.updateTableSection(ts.id, {
      section: ts.section, label: ts.label, categoryId: ts.categoryId,
      tableCount: Number(ts.tableCount), seatsPerTable: Number(ts.seatsPerTable),
      tableSize: Number(ts.tableSize), seatSize: Number(ts.seatSize),
      tableSpacing: Number(ts.tableSpacing), rowLabelFontSize: Number(ts.rowLabelFontSize),
      disabledSeats: ts.disabledSeats || [],
    }, props.venueId);
  }
  emit('changed');
}

async function removeSelected() {
  if (selectedZone.value) {
    const z = selectedZone.value;
    if (!confirm(`Supprimer "${z.label}" ?`)) return;
    await adminApi.deleteZone(z.id, props.venueId);
    zones.value = zones.value.filter((x) => x.id !== z.id);
  } else if (selectedSeatRow.value) {
    const r = selectedSeatRow.value;
    if (!confirm(`Supprimer "${r.label}" ?`)) return;
    await adminApi.deleteSeatRow(r.id, props.venueId);
    seatRows.value = seatRows.value.filter((x) => x.id !== r.id);
  } else if (selectedFreeZone.value) {
    const f = selectedFreeZone.value;
    if (!confirm(`Supprimer "${f.label}" ?`)) return;
    await adminApi.deleteFreeZone(f.id, props.venueId);
    freeZones.value = freeZones.value.filter((x) => x.id !== f.id);
  } else if (selectedTableZone.value) {
    const t = selectedTableZone.value;
    if (!confirm(`Supprimer la table "${t.section || t.label}" ?`)) return;
    await adminApi.deleteTableZone(t.id, props.venueId);
    tableZones.value = tableZones.value.filter((x) => x.id !== t.id);
  } else if (selectedTableSection.value) {
    const ts = selectedTableSection.value;
    if (!confirm(`Supprimer la section "${ts.section || ts.label}" ?`)) return;
    await adminApi.deleteTableSection(ts.id, props.venueId);
    tableSections.value = tableSections.value.filter((x) => x.id !== ts.id);
  }
  deselect();
  emit('changed');
}

// ---------- Action sur le siège sélectionné (démo locale : statut vendu) ----------
function toggleSelectedSeatStatus() {
  const s = selected.value;
  if (!s || s.kind !== 'seat') return;
  const current = seatStatusOverrides[s.seatId] || 'available';
  seatStatusOverrides[s.seatId] = current === 'sold' ? 'available' : 'sold';
  s.seatInfo.status = seatStatusOverrides[s.seatId];
}

// ---------- Activer/désactiver un siège (persisté) ----------
async function toggleSelectedSeatDisabled() {
  const s = selected.value;
  if (!s || s.kind !== 'seat') return;
  const row = seatRows.value.find((r) => r.id === s.rowId);
  if (!row) return;
  const list = row.disabledSeats ? [...row.disabledSeats] : [];
  const idx = list.indexOf(s.seatInfo.posKey);
  if (idx >= 0) list.splice(idx, 1); else list.push(s.seatInfo.posKey);
  row.disabledSeats = list;
  s.seatInfo.status = idx >= 0 ? (seatStatusOverrides[s.seatId] || 'available') : 'disabled';
  await adminApi.updateSeatRow(row.id, { disabledSeats: list }, props.venueId);
  emit('changed');
}

async function toggleSelectedTableSeatDisabled() {
  const s = selectedTableSeat.value;
  if (!s) return;
  const t = tableZones.value.find((x) => x.id === s.table.id);
  if (!t) return;
  const list = new Set(t.disabledSeats || []);
  if (list.has(s.index)) { list.delete(s.index); } else { list.add(s.index); }
  t.disabledSeats = [...list];
  s.status = list.has(s.index) ? 'disabled' : 'available';
  await adminApi.updateTableZone(t.id, { disabledSeats: t.disabledSeats }, props.venueId);
  emit('changed');
}

async function toggleSelectedTableSectionSeatDisabled() {
  const s = selectedTableSectionSeat.value;
  if (!s) return;
  const ts = tableSections.value.find((x) => x.id === s.ts.id);
  if (!ts) return;
  const posKey = `${s.tableIndex}-${s.seatIndex}`;
  const list = new Set(ts.disabledSeats || []);
  if (list.has(posKey)) { list.delete(posKey); } else { list.add(posKey); }
  ts.disabledSeats = [...list];
  s.status = list.has(posKey) ? 'disabled' : 'available';
  await adminApi.updateTableSection(ts.id, { disabledSeats: ts.disabledSeats }, props.venueId);
  emit('changed');
}

// ---------- Actions groupées (multi-sélection de sièges) ----------
function splitMultiSelection() {
  const rowGroups = new Map();    // rowId -> [posKey...]
  const tableGroups = new Map();  // tableId -> [index (number)...]
  const tsGroups = new Map();     // tsId -> ['ti-si'...]
  for (const key of multiSelected) {
    if (key.startsWith('tse:')) {
      const [tsId, posPart] = key.slice(4).split('|');
      if (!tsGroups.has(tsId)) tsGroups.set(tsId, []);
      tsGroups.get(tsId).push(posPart);
    } else if (key.startsWith('tz:')) {
      const [tableId, idx] = key.slice(3).split('|');
      if (!tableGroups.has(tableId)) tableGroups.set(tableId, []);
      tableGroups.get(tableId).push(Number(idx));
    } else {
      const [rowId, posKey] = key.split('|');
      if (!rowGroups.has(rowId)) rowGroups.set(rowId, []);
      rowGroups.get(rowId).push(posKey);
    }
  }
  return { rowGroups, tableGroups, tsGroups };
}

async function bulkSetDisabled(disabled) {
  const { rowGroups, tableGroups, tsGroups } = splitMultiSelection();
  for (const [rowId, posKeys] of rowGroups) {
    const row = seatRows.value.find((r) => r.id === rowId);
    if (!row) continue;
    const list = new Set(row.disabledSeats || []);
    posKeys.forEach((pk) => (disabled ? list.add(pk) : list.delete(pk)));
    row.disabledSeats = [...list];
    await adminApi.updateSeatRow(rowId, { disabledSeats: row.disabledSeats }, props.venueId);
  }
  for (const [tableId, indices] of tableGroups) {
    const t = tableZones.value.find((x) => x.id === tableId);
    if (!t) continue;
    const list = new Set(t.disabledSeats || []);
    indices.forEach((i) => (disabled ? list.add(i) : list.delete(i)));
    t.disabledSeats = [...list];
    await adminApi.updateTableZone(tableId, { disabledSeats: t.disabledSeats }, props.venueId);
  }
  for (const [tsId, posParts] of tsGroups) {
    const ts = tableSections.value.find((x) => x.id === tsId);
    if (!ts) continue;
    const list = new Set(ts.disabledSeats || []);
    posParts.forEach((p) => (disabled ? list.add(p) : list.delete(p)));
    ts.disabledSeats = [...list];
    await adminApi.updateTableSection(tsId, { disabledSeats: ts.disabledSeats }, props.venueId);
  }
  emit('changed');
}

function bulkSetStatus(status) {
  for (const key of multiSelected) {
    if (key.startsWith('tse:') || key.startsWith('tz:')) {
      seatStatusOverrides[key] = status;
    } else {
      const [rowId, posKey] = key.split('|');
      seatStatusOverrides[`${rowId}-${posKey}`] = status;
    }
  }
}

async function bulkChangeCategory() {
  if (!bulkCategoryChoice.value) return;
  const { rowGroups } = splitMultiSelection();
  for (const [rowId, posKeys] of rowGroups) {
    const row = seatRows.value.find((r) => r.id === rowId);
    if (!row) continue;
    const overrides = { ...(row.categoryOverrides || {}) };
    posKeys.forEach((pk) => { overrides[pk] = bulkCategoryChoice.value; });
    row.categoryOverrides = overrides;
    await adminApi.updateSeatRow(rowId, { categoryOverrides: overrides }, props.venueId);
  }
  emit('changed');
}

function clearMultiSelection() {
  multiSelected.clear();
  bulkCategoryChoice.value = '';
}

// ---------- Sauvegarde explicite ----------
const saving = ref(false);
const saveError = ref('');
const saveSuccess = ref(false);

async function saveAll() {
  if (!canSave.value) return;
  saveError.value = '';
  saveSuccess.value = false;
  saving.value = true;
  try {
    await adminApi.saveAllObjects(props.venueId, zones.value, seatRows.value, freeZones.value, props.categories, tableZones.value, tableSections.value);
    saveSuccess.value = true;
    emit('changed');
    setTimeout(() => { saveSuccess.value = false; }, 2500);
  } catch (e) {
    saveError.value = e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="flex gap-4 h-full min-h-0 overflow-hidden">

    <div class="flex-1 min-w-0 bg-white rounded-2xl shadow-sm p-4 flex flex-col min-h-0">
      <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 class="font-bold text-gray-800">Éditeur du plan</h3>
        <div class="flex gap-2">
          <button :disabled="categories.length===0" @click="addZone"
            class="text-xs font-semibold bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 disabled:opacity-40">
            + Zone
          </button>
          <button :disabled="categories.length===0" @click="addSeatRow"
            class="text-xs font-semibold bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 disabled:opacity-40">
            + Bloc de sièges
          </button>
          <button @click="addFreeZone" class="text-xs font-semibold bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-200">
            + Zone libre
          </button>
          <button :disabled="categories.length===0" @click="addTableZone"
            class="text-xs font-semibold bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-40">
            + Table
          </button>
          <button :disabled="categories.length===0" @click="addTableSection"
            class="text-xs font-semibold bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-40">
            + Section de tables
          </button>
          <button :disabled="saving || !canSave" @click="saveAll"
            class="text-xs font-semibold bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            :title="!canSave ? 'Corrigez les anomalies avant de sauvegarder' : ''">
            {{ saving ? 'Enregistrement…' : 'Sauvegarder' }}
          </button>
          <!-- Contrôles zoom -->
          <div class="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5 ml-1">
            <button @click="zoomOut" class="w-7 h-7 flex items-center justify-center text-gray-600 hover:bg-white rounded-md text-base font-bold transition">−</button>
            <button @click="zoomReset" class="px-1.5 h-7 flex items-center justify-center text-gray-500 hover:bg-white rounded-md text-[10px] font-semibold transition min-w-[40px]">{{ Math.round(zoom * 100) }}%</button>
            <button @click="zoomIn"  class="w-7 h-7 flex items-center justify-center text-gray-600 hover:bg-white rounded-md text-base font-bold transition">+</button>
          </div>
        </div>
      </div>
      <p v-if="saveSuccess" class="text-xs text-green-600 bg-green-50 p-2 rounded-lg mb-2">Plan enregistré avec succès.</p>
      <p v-if="categories.length===0" class="text-xs text-amber-600 mb-2">Créez d'abord au moins une catégorie.</p>

      <!-- Panneau d'anomalies -->
      <div v-if="anomalies.length > 0" class="mb-3 rounded-xl border border-red-200 bg-red-50 overflow-hidden">
        <div class="flex items-center gap-2 px-3 py-2 bg-red-100 border-b border-red-200">
          <span class="text-red-600 font-bold text-xs">⚠ Anomalies détectées — sauvegarde bloquée</span>
        </div>
        <ul class="px-3 py-2 flex flex-col gap-2">
          <li v-for="a in anomalies" :key="a.type">
            <button
              class="text-xs text-red-700 font-semibold hover:text-red-900 hover:underline text-left w-full"
              @click="selectAnomalyItem(a)"
            >• {{ a.label }}</button>

            <!-- Duplicate keys list -->
            <ul v-if="a.keys && a.keys.length" class="mt-1 ml-3 flex flex-col gap-0.5">
              <li v-for="k in a.keys.slice(0, 8)" :key="k">
                <button
                  class="font-mono text-[10px] text-red-500 hover:text-red-700 hover:underline text-left"
                  @click="selectAnomalyItem(a, { key: k })"
                >{{ k }}</button>
              </li>
              <li v-if="a.keys.length > 8" class="text-[10px] text-red-400">… et {{ a.keys.length - 8 }} autre(s)</li>
            </ul>

            <!-- Missing section/category items list -->
            <ul v-if="a.items && a.items.length" class="mt-1 ml-3 flex flex-col gap-0.5">
              <li v-for="item in a.items" :key="item.id">
                <button
                  class="text-[10px] text-red-500 hover:text-red-700 hover:underline text-left flex items-center gap-1"
                  @click="selectAnomalyItem(a, item)"
                >
                  <span class="font-mono">{{ item.label }}</span>
                  <span class="text-red-300 italic">
                    {{ item.kind === 'seatRow' ? '(bloc)' : item.kind === 'tableZone' ? '(table)' : '(section de tables)' }}
                  </span>
                </button>
              </li>
            </ul>
          </li>
        </ul>
      </div>
      <p v-if="saveError" class="text-xs text-red-500 bg-red-50 p-2 rounded-lg mb-2">{{ saveError }}</p>
      <p class="text-xs text-gray-400 mb-3">
        Glissez pour déplacer · tirez un bord pour redimensionner (sur un bloc de sièges : gauche/droit = sièges par
        rang, haut/bas = rangées) · cliquez un siège pour le sélectionner, <strong>Ctrl/Cmd-clic</strong> ou
        <strong>Maj-clic</strong> pour en sélectionner plusieurs.
      </p>

      <!-- Barre d'actions groupées -->
      <div v-if="multiSelected.size > 0" class="mb-3 p-3 rounded-lg bg-gray-900 text-white flex items-center flex-wrap gap-2 text-xs">
        <span class="font-semibold">{{ multiSelected.size }} siège(s) sélectionné(s)</span>
        <button @click="bulkSetDisabled(true)" class="px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 font-semibold">Désactiver la sélection</button>
        <button @click="bulkSetDisabled(false)" class="px-3 py-1.5 rounded-md bg-gray-700 hover:bg-gray-600 font-semibold">Réactiver la sélection</button>
        <span class="border-l border-gray-600 h-5 mx-1"></span>
        <button @click="bulkSetStatus('sold')" class="px-3 py-1.5 rounded-md bg-gray-500 hover:bg-gray-400 font-semibold">Marquer vendus</button>
        <button @click="bulkSetStatus('available')" class="px-3 py-1.5 rounded-md bg-green-600 hover:bg-green-500 font-semibold">Marquer disponibles</button>
        <span class="border-l border-gray-600 h-5 mx-1"></span>
        <select v-model="bulkCategoryChoice" class="px-2 py-1.5 rounded-md text-gray-800 text-xs">
          <option value="" disabled>Changer catégorie…</option>
          <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <button @click="bulkChangeCategory" :disabled="!bulkCategoryChoice" class="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 font-semibold disabled:opacity-40">Appliquer</button>
        <button @click="clearMultiSelection" class="ml-auto px-3 py-1.5 rounded-md bg-gray-700 hover:bg-gray-600 font-semibold">Tout désélectionner</button>
      </div>

      <div v-if="loading" class="text-sm text-gray-400 py-10 text-center">Chargement…</div>

      <div v-else ref="scrollerRef"
        class="overflow-hidden rounded-xl flex-1 min-h-0 bg-gray-400 relative"
        :class="pan.active ? 'cursor-grabbing' : 'cursor-grab'"
        style="touch-action: none;"
        @wheel.prevent="onWheel"
        @pointerdown="startPan"
      >
        <div ref="canvasRef" class="absolute bg-white shadow-xl"
          :style="{
            width: canvasWidth + 'px', height: canvasHeight + 'px',
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }"
          @pointerdown.self="deselect">

          <!-- Zones génériques -->
          <div
            v-for="z in zones" :key="z.id"
            class="absolute rounded-lg border flex flex-col items-center justify-center text-center px-2 cursor-move select-none"
            :class="[z.shape === 'pill' ? 'rounded-full' : '', selected && selected.kind==='zone' && selected.id===z.id ? 'ring-2 ring-gray-900' : '']"
            :style="{
              top: z.top + 'px', left: z.left + 'px', width: z.width + 'px', height: z.height + 'px',
              background: catById(z.categoryId).color + '20',
              borderColor: catById(z.categoryId).color + '70',
              zIndex: z.zIndex || 1,
            }"
            @pointerdown="startDrag($event, 'zone', z)"
          >
            <p class="font-bold pointer-events-none" :style="{ color: catById(z.categoryId).color, fontSize: (z.labelFontSize || 11) + 'px' }">{{ z.label }}</p>
            <p class="text-gray-400 pointer-events-none" :style="{ fontSize: Math.max(8, (z.labelFontSize || 11) - 2) + 'px' }">{{ z.capacity }} places</p>
            <template v-if="z.shape !== 'pill'">
              <div class="absolute left-2 right-2 -top-1 h-2 cursor-ns-resize" @pointerdown="startResize($event, 'zone', z, 'top')"></div>
              <div class="absolute left-2 right-2 -bottom-1 h-2 cursor-ns-resize" @pointerdown="startResize($event, 'zone', z, 'bottom')"></div>
              <div class="absolute top-2 bottom-2 -left-1 w-2 cursor-ew-resize" @pointerdown="startResize($event, 'zone', z, 'left')"></div>
              <div class="absolute top-2 bottom-2 -right-1 w-2 cursor-ew-resize" @pointerdown="startResize($event, 'zone', z, 'right')"></div>
            </template>
          </div>

          <!-- Zones libres (scène, portes, sanitaires, zones inaccessibles…) -->
          <div
            v-for="fz in freeZones" :key="fz.id"
            class="absolute rounded-lg flex flex-col items-center justify-center text-center gap-0.5 cursor-move select-none"
            :class="selected && selected.kind==='freeZone' && selected.id===fz.id ? 'ring-2 ring-gray-900' : ''"
            :style="{
              top: fz.top + 'px', left: fz.left + 'px', width: fz.width + 'px', height: fz.height + 'px',
              ...patternStyle(fz.pattern, fz.color),
              border: `1px solid ${fz.color}55`,
              zIndex: fz.zIndex || 1,
            }"
            @pointerdown="startDrag($event, 'freeZone', fz)"
          >
            <span v-if="iconById(fz.icon).emoji" class="pointer-events-none" style="line-height:1" :style="{ fontSize: Math.max(12, fz.height * 0.3) + 'px' }">{{ iconById(fz.icon).emoji }}</span>
            <span class="font-bold uppercase pointer-events-none" :style="{ color: fz.color, fontSize: (fz.labelFontSize || 10) + 'px' }">{{ fz.label }}</span>
            <div class="absolute left-2 right-2 -top-1 h-2 cursor-ns-resize" @pointerdown="startResize($event, 'freeZone', fz, 'top')"></div>
            <div class="absolute left-2 right-2 -bottom-1 h-2 cursor-ns-resize" @pointerdown="startResize($event, 'freeZone', fz, 'bottom')"></div>
            <div class="absolute top-2 bottom-2 -left-1 w-2 cursor-ew-resize" @pointerdown="startResize($event, 'freeZone', fz, 'left')"></div>
            <div class="absolute top-2 bottom-2 -right-1 w-2 cursor-ew-resize" @pointerdown="startResize($event, 'freeZone', fz, 'right')"></div>
          </div>

          <!-- Tables rondes avec sièges autour -->
          <div
            v-for="t in tableZones" :key="t.id"
            class="absolute cursor-move select-none"
            :style="{
              top: t.top + 'px', left: t.left + 'px',
              width: tableZoneSize(t) + 'px', height: tableZoneSize(t) + 'px',
              zIndex: t.zIndex || 1,
            }"
            @pointerdown="startDrag($event, 'tableZone', t)"
          >
            <!-- Sièges autour de la table (positionnés absolument) -->
            <template v-for="seat in tableSeats(t)" :key="seat.index">
              <div
                class="absolute flex items-center justify-center text-white font-bold rounded-full"
                style="pointer-events: auto; cursor: pointer;"
                :class="[
                  selected && selected.kind==='tableSeat' && selected.tableId===t.id && selected.seatInfo?.index===seat.index ? 'ring-2 ring-offset-1 ring-gray-900' : '',
                  isMultiSelectedTableSeat(t, seat) ? 'ring-2 ring-offset-1 ring-blue-500' : '',
                ]"
                :style="{
                  width: (t.seatSize || 15) + 'px', height: (t.seatSize || 15) + 'px',
                  fontSize: Math.max(6, Math.floor((t.seatSize || 15) * 0.42)) + 'px',
                  background: seat.status === 'disabled' ? '#eef0f2' : catById(t.categoryId).color,
                  border: seat.status === 'disabled' ? '1px solid #d8dade' : 'none',
                  color: seat.status === 'disabled' ? '#9ca3af' : '#fff',
                  left: (tableZoneSize(t) / 2 + ((t.tableSize || 30) / 2 + (t.seatSize || 15) / 2 + 8) * Math.cos((2 * Math.PI * seat.index) / (t.seatCount || 6) - Math.PI / 2) - (t.seatSize || 15) / 2) + 'px',
                  top:  (tableZoneSize(t) / 2 + ((t.tableSize || 30) / 2 + (t.seatSize || 15) / 2 + 8) * Math.sin((2 * Math.PI * seat.index) / (t.seatCount || 6) - Math.PI / 2) - (t.seatSize || 15) / 2) + 'px',
                }"
                @pointerdown.stop
                @click.stop="onTableSeatClick(t, seat, $event)"
              >{{ (t.seatSize || 15) >= 14 ? seat.index + 1 : '' }}</div>
            </template>
            <!-- Table ronde au centre -->
            <div
              class="absolute rounded-full flex items-center justify-center pointer-events-none"
              :style="{
                width: (t.tableSize || 30) + 'px', height: (t.tableSize || 30) + 'px',
                left: (tableZoneSize(t) - (t.tableSize || 30)) / 2 + 'px',
                top:  (tableZoneSize(t) - (t.tableSize || 30)) / 2 + 'px',
                background: catById(t.categoryId).color + '22',
                border: `2px solid ${catById(t.categoryId).color}88`,
                outline: selected && selected.kind==='tableZone' && selected.id===t.id ? `2px solid ${catById(t.categoryId).color}` : 'none',
                outlineOffset: '3px',
              }"
            >
              <span class="font-bold text-center leading-tight pointer-events-none"
                :style="{ color: catById(t.categoryId).color, fontSize: (t.rowLabelFontSize || 10) + 'px' }">
                {{ t.section || catById(t.categoryId).name }}
              </span>
            </div>
          </div>

          <!-- Sections de tables (groupes de tables circulaires) -->
          <div
            v-for="ts in tableSections" :key="ts.id"
            class="absolute cursor-move select-none"
            :style="{
              top: ts.top + 'px', left: ts.left + 'px',
              width: tableSectionWidth(ts) + 'px',
              height: tableSectionUnitSize(ts) + 24 + 'px',
              zIndex: ts.zIndex || 1,
              border: `2px dashed ${catById(ts.categoryId).color}70`,
              borderRadius: '14px',
              outline: selected && selected.kind==='tableSection' && selected.id===ts.id ? `2px solid ${catById(ts.categoryId).color}` : 'none',
              outlineOffset: '3px',
            }"
            @pointerdown="startDrag($event, 'tableSection', ts)"
          >
            <!-- Badge section -->
            <div class="editor-row-badge pointer-events-none"
              :style="{ color: catById(ts.categoryId).color, borderColor: catById(ts.categoryId).color + '55', fontSize: (ts.rowLabelFontSize || 10) + 'px' }">
              {{ ts.section || catById(ts.categoryId).name }}
            </div>
            <!-- Une table par index -->
            <template v-for="ti in (ts.tableCount || 3)" :key="ti">
              <template v-for="seat in tableSectionSeats(ts).filter(s => s.tableIndex === ti - 1)" :key="seat.tableIndex + '-' + seat.seatIndex">
                <div
                  class="absolute flex items-center justify-center text-white font-bold rounded-full"
                  style="pointer-events: auto; cursor: pointer;"
                  :class="[
                    selected && selected.kind==='tableSectionSeat' && selected.tsId===ts.id && selected.seatInfo?.tableIndex===seat.tableIndex && selected.seatInfo?.seatIndex===seat.seatIndex ? 'ring-2 ring-offset-1 ring-gray-900' : '',
                    isMultiSelectedTableSectionSeat(ts, seat) ? 'ring-2 ring-offset-1 ring-blue-500' : '',
                  ]"
                  :style="{
                    width: (ts.seatSize || 15) + 'px', height: (ts.seatSize || 15) + 'px',
                    fontSize: Math.max(6, Math.floor((ts.seatSize || 15) * 0.42)) + 'px',
                    background: seat.status === 'disabled' ? '#eef0f2' : catById(ts.categoryId).color,
                    border: seat.status === 'disabled' ? '1px solid #d8dade' : 'none',
                    color: seat.status === 'disabled' ? '#9ca3af' : '#fff',
                    left: ((ti - 1) * (tableSectionUnitSize(ts) + (ts.tableSpacing || 20)) + tableSectionUnitSize(ts) / 2 + ((ts.tableSize || 30) / 2 + (ts.seatSize || 15) / 2 + 8) * Math.cos((2 * Math.PI * seat.seatIndex) / (ts.seatsPerTable || 6) - Math.PI / 2) - (ts.seatSize || 15) / 2) + 'px',
                    top:  (24 + tableSectionUnitSize(ts) / 2 + ((ts.tableSize || 30) / 2 + (ts.seatSize || 15) / 2 + 8) * Math.sin((2 * Math.PI * seat.seatIndex) / (ts.seatsPerTable || 6) - Math.PI / 2) - (ts.seatSize || 15) / 2) + 'px',
                  }"
                  @pointerdown.stop
                  @click.stop="onTableSectionSeatClick(ts, seat, $event)"
                >{{ (ts.seatSize || 15) >= 14 ? seat.seatIndex + 1 : '' }}</div>
              </template>
              <!-- Table circle -->
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
                <span class="font-bold text-center leading-tight pointer-events-none"
                  :style="{ color: catById(ts.categoryId).color, fontSize: Math.max(6, (ts.rowLabelFontSize || 10) - 2) + 'px' }">
                  T{{ ti }}
                </span>
              </div>
            </template>
          </div>

          <!-- Blocs de sièges nominatifs -->
          <div
            v-for="row in seatRows" :key="row.id"
            class="absolute cursor-move select-none"
            :style="{ top: row.top + 'px', left: row.left + 'px', zIndex: row.zIndex || 1 }"
            @pointerdown="startDrag($event, 'seatRow', row)"
          >
            <!-- Badge catégorie du bloc -->
            <div class="editor-row-badge pointer-events-none"
              :style="{ color: catById(row.categoryId).color, borderColor: catById(row.categoryId).color + '55', fontSize: (row.rowLabelFontSize || 10) + 'px' }">
              {{ row.section || catById(row.categoryId).name }}
            </div>
            <!-- Carte dont la couleur suit la catégorie -->
            <div class="editor-seat-card pointer-events-none" style="pointer-events:none"
              :style="{
                background: catById(row.categoryId).color + '14',
                borderColor: catById(row.categoryId).color + '55',
                outline: selected && selected.kind==='seatRow' && selected.id===row.id ? `2px solid ${catById(row.categoryId).color}` : 'none',
                outlineOffset: '2px',
              }">
              <div class="grid gap-1.5"
                :style="{ gridTemplateColumns: `repeat(${row.cols}, minmax(${row.shape === 'rounded' ? (row.seatSize || 22) * 1.5 : (row.seatSize || 22)}px, auto))` }">
                <div
                  v-for="seat in seatGrid(row)" :key="seat.key"
                  class="flex items-center justify-center text-white font-semibold leading-none cursor-pointer"
                  style="pointer-events:auto"
                  :class="[
                    selected && selected.kind==='seat' && selected.seatId===seat.key ? 'ring-2 ring-offset-1 ring-gray-900' : '',
                    isMultiSelected(row, seat) ? 'ring-2 ring-offset-1 ring-blue-500' : '',
                  ]"
                  :style="{
                    height: (row.seatSize || 22) + 'px',
                    minWidth: row.shape === 'rounded' ? ((row.seatSize || 22) * 1.5) + 'px' : (row.seatSize || 22) + 'px',
                    padding: row.shape === 'rounded' ? '0 6px' : '0',
                    fontSize: Math.max(6, Math.floor((row.seatSize || 22) * 0.42)) + 'px',
                    borderRadius: row.shape === 'round' ? '50%' : row.shape === 'rounded' ? '10px' : '4px',
                    background: seat.status === 'sold' ? '#9ca3af' : seat.status === 'disabled' ? '#eef0f2' : catById(seat.categoryId).color,
                    color: seat.status === 'disabled' ? '#9ca3af' : '#fff',
                    opacity: seat.status === 'sold' ? 0.55 : 1,
                    border: seat.status === 'disabled' ? '1px solid #d8dade' : 'none',
                  }"
                  @pointerdown.stop
                  @click.stop="onSeatClick(row, seat, $event)"
                >{{ (row.seatSize || 22) >= 14 ? seat.label : '' }}</div>
              </div>
            </div>

            <div class="absolute left-2 right-2 -top-1 h-2 cursor-ns-resize" @pointerdown="startResizeSeatRow($event, row, 'top')"></div>
            <div class="absolute left-2 right-2 -bottom-1 h-2 cursor-ns-resize" @pointerdown="startResizeSeatRow($event, row, 'bottom')"></div>
            <div class="absolute top-2 bottom-2 -left-1 w-2 cursor-ew-resize" @pointerdown="startResizeSeatRow($event, row, 'left')"></div>
            <div class="absolute top-2 bottom-2 -right-1 w-2 cursor-ew-resize" @pointerdown="startResizeSeatRow($event, row, 'right')"></div>
          </div>

          <div v-if="zones.length===0 && seatRows.length===0 && freeZones.length===0 && tableZones.length===0 && tableSections.length===0" class="absolute inset-0 flex items-center justify-center text-gray-400 text-sm pointer-events-none">
            Cliquez sur "+ Zone", "+ Bloc de sièges", "+ Zone libre", "+ Table" ou "+ Section de tables" pour commencer.
          </div>
        </div>
      </div>
    </div>

    <!-- Panneau latéral de configuration -->
    <div class="w-56 lg:w-72 shrink-0 bg-white rounded-2xl shadow-sm p-4 overflow-y-auto text-sm">
      <h3 class="font-bold text-gray-800 mb-3">Propriétés</h3>

      <div v-if="!selected && multiSelected.size === 0" class="text-sm text-gray-400 py-6 text-center">
        Sélectionnez un élément du plan.
      </div>
      <div v-else-if="multiSelected.size > 0" class="text-sm text-gray-500 py-4">
        {{ multiSelected.size }} siège(s) sélectionné(s). Utilisez la barre d'actions au-dessus du plan pour les
        désactiver ou changer leur catégorie en une fois.
      </div>

      <!-- Propriétés d'une zone -->
      <div v-else-if="selectedZone" class="flex flex-col gap-3">
        <div>
          <label class="text-xs font-semibold text-gray-500">Libellé</label>
          <input v-model="selectedZone.label" @input="scheduleSave"
            class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400" />
        </div>
        <div>
          <label class="text-xs font-semibold text-gray-500">Catégorie</label>
          <select v-model="selectedZone.categoryId" @change="scheduleSave"
            class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400">
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div>
          <label class="text-xs font-semibold text-gray-500">Forme</label>
          <select v-model="selectedZone.shape" @change="scheduleSave"
            class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400">
            <option value="rect">Rectangle</option>
            <option value="pill">Arrondie</option>
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-semibold text-gray-500">Largeur</label>
            <input v-model="selectedZone.width" @input="scheduleSave" type="number"
              class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Hauteur</label>
            <input v-model="selectedZone.height" @input="scheduleSave" type="number"
              class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>
        <div>
          <label class="text-xs font-semibold text-gray-500">Capacité</label>
          <input v-model="selectedZone.capacity" @input="scheduleSave" type="number" min="1"
            class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
        <div>
          <label class="text-xs font-semibold text-gray-500">Taille de police du libellé (px)</label>
          <input v-model="selectedZone.labelFontSize" @input="scheduleSave" type="number" min="6" max="24"
            class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
        <p class="text-[11px] text-gray-300">Position : {{ Math.round(selectedZone.left) }}, {{ Math.round(selectedZone.top) }} · tirez un bord de la zone sur le plan pour la redimensionner de ce côté</p>
        <button @click="removeSelected" class="w-full mt-2 py-2 rounded-lg bg-red-50 text-red-500 text-sm font-semibold hover:bg-red-100">
          Supprimer cette zone
        </button>
      </div>

      <!-- Propriétés d'une zone libre -->
      <div v-else-if="selectedFreeZone" class="flex flex-col gap-3">
        <div>
          <label class="text-xs font-semibold text-gray-500">Libellé</label>
          <input v-model="selectedFreeZone.label" @input="scheduleSave"
            class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400" />
        </div>
        <div>
          <label class="text-xs font-semibold text-gray-500">Icône</label>
          <select v-model="selectedFreeZone.icon" @change="scheduleSave" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm">
            <option v-for="i in FREE_ZONE_ICONS" :key="i.id" :value="i.id">{{ i.emoji ? i.emoji + ' ' : '' }}{{ i.label }}</option>
          </select>
        </div>
        <div>
          <label class="text-xs font-semibold text-gray-500">Couleur</label>
          <div class="flex items-center gap-2 mt-1">
            <input v-model="selectedFreeZone.color" @input="scheduleSave" type="color" class="w-10 h-9 rounded border border-gray-200 cursor-pointer" />
            <input v-model="selectedFreeZone.color" @input="scheduleSave" type="text" class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>
        <div>
          <label class="text-xs font-semibold text-gray-500">Motif de fond</label>
          <select v-model="selectedFreeZone.pattern" @change="scheduleSave" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm">
            <option v-for="p in FREE_ZONE_PATTERNS" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-semibold text-gray-500">Largeur</label>
            <input v-model="selectedFreeZone.width" @input="scheduleSave" type="number" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Hauteur</label>
            <input v-model="selectedFreeZone.height" @input="scheduleSave" type="number" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>
        <div>
          <label class="text-xs font-semibold text-gray-500">Taille de police du libellé (px)</label>
          <input v-model="selectedFreeZone.labelFontSize" @input="scheduleSave" type="number" min="6" max="24" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
        <p class="text-[11px] text-gray-300">Zone non liée à une catégorie (scène, porte, sanitaires, zone inaccessible…). Tirez un bord pour redimensionner.</p>
        <button @click="removeSelected" class="w-full mt-2 py-2 rounded-lg bg-red-50 text-red-500 text-sm font-semibold hover:bg-red-100">
          Supprimer cette zone libre
        </button>
      </div>

      <!-- Propriétés d'une section de tables -->
      <div v-else-if="selectedTableSection" class="flex flex-col gap-3">
        <div>
          <label class="text-xs font-semibold text-gray-500">Section</label>
          <input v-model="selectedTableSection.section" @input="scheduleSave" placeholder="ex. VIP-TABLES"
            class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400" />
          <p class="text-[10px] text-gray-400 mt-0.5">Préfixe des sièges (section-table-siège, ex. VIP-1-1)</p>
        </div>
        <div>
          <label class="text-xs font-semibold text-gray-500">Catégorie</label>
          <select v-model="selectedTableSection.categoryId" @change="scheduleSave"
            class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400">
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-semibold text-gray-500">Nb. tables</label>
            <input v-model="selectedTableSection.tableCount" @input="scheduleSave" type="number" min="1" max="20"
              class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Sièges / table</label>
            <input v-model="selectedTableSection.seatsPerTable" @input="scheduleSave" type="number" min="2" max="20"
              class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Taille table (px)</label>
            <input v-model="selectedTableSection.tableSize" @input="scheduleSave" type="number" min="20" max="200"
              class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Taille siège (px)</label>
            <input v-model="selectedTableSection.seatSize" @input="scheduleSave" type="number" min="10" max="50"
              class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Écart tables (px)</label>
            <input v-model="selectedTableSection.tableSpacing" @input="scheduleSave" type="number" min="0" max="100"
              class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Taille badge (px)</label>
            <input v-model="selectedTableSection.rowLabelFontSize" @input="scheduleSave" type="number" min="6" max="24"
              class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>
        <p class="text-xs text-gray-400">{{ (selectedTableSection.tableCount || 3) * (selectedTableSection.seatsPerTable || 6) }} sièges au total</p>
        <button @click="removeSelected" class="w-full mt-2 py-2 rounded-lg bg-red-50 text-red-500 text-sm font-semibold hover:bg-red-100">
          Supprimer cette section
        </button>
      </div>

      <!-- Propriétés d'une table ronde -->
      <div v-else-if="selectedTableZone" class="flex flex-col gap-3">
        <div>
          <label class="text-xs font-semibold text-gray-500">Section</label>
          <input v-model="selectedTableZone.section" @input="scheduleSave" placeholder="ex. TABLE-VIP"
            class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400" />
          <p class="text-[10px] text-gray-400 mt-0.5">Identifiant unique — préfixe des sièges (section-1, section-2…)</p>
        </div>
        <div>
          <label class="text-xs font-semibold text-gray-500">Catégorie</label>
          <select v-model="selectedTableZone.categoryId" @change="scheduleSave"
            class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400">
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div>
          <label class="text-xs font-semibold text-gray-500">Nombre de sièges</label>
          <input v-model="selectedTableZone.seatCount" @input="scheduleSave" type="number" min="2" max="20"
            class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-semibold text-gray-500">Taille table (px)</label>
            <input v-model="selectedTableZone.tableSize" @input="scheduleSave" type="number" min="30" max="200"
              class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Taille siège (px)</label>
            <input v-model="selectedTableZone.seatSize" @input="scheduleSave" type="number" min="10" max="50"
              class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>
        <div>
          <label class="text-xs font-semibold text-gray-500">Taille du badge (px)</label>
          <input v-model="selectedTableZone.rowLabelFontSize" @input="scheduleSave" type="number" min="6" max="24"
            class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
        <button @click="removeSelected" class="w-full mt-2 py-2 rounded-lg bg-red-50 text-red-500 text-sm font-semibold hover:bg-red-100">
          Supprimer cette table
        </button>
      </div>

      <!-- Propriétés d'un bloc de sièges -->
      <div v-else-if="selectedSeatRow" class="flex flex-col gap-3">
        <div>
          <label class="text-xs font-semibold text-gray-500">Section</label>
          <input v-model="selectedSeatRow.section" @input="scheduleSave" placeholder="ex. TRIBUNE-NORD"
            class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400" />
          <p class="text-[10px] text-gray-400 mt-0.5">Identifiant unique — préfixe des clés de sièges (section-rangée-siège)</p>
        </div>
        <div>
          <label class="text-xs font-semibold text-gray-500">Catégorie</label>
          <select v-model="selectedSeatRow.categoryId" @change="scheduleSave"
            class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400">
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-semibold text-gray-500">Rangs</label>
            <input v-model="selectedSeatRow.rows" @input="scheduleSave" type="number" min="1" max="40"
              class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Sièges / rang</label>
            <input v-model="selectedSeatRow.cols" @input="scheduleSave" type="number" min="1" max="60"
              class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Forme des sièges</label>
            <select v-model="selectedSeatRow.shape" @change="scheduleSave" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm">
              <option value="square">Carré</option>
              <option value="rounded">Rectangle arrondi</option>
              <option value="round">Rond</option>
            </select>
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Taille (px)</label>
            <input v-model="selectedSeatRow.seatSize" @input="scheduleSave" type="number" min="10" max="40"
              class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>

        <div>
          <label class="text-xs font-semibold text-gray-500">Taille du badge (px)</label>
          <input v-model="selectedSeatRow.rowLabelFontSize" @input="scheduleSave" type="number" min="6" max="24"
            class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>

        <div class="border-t border-gray-100 pt-3">
          <p class="text-xs font-bold text-gray-700 mb-2">Nommage des rangées</p>
          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="text-[11px] text-gray-500">Format</label>
              <select v-model="selectedSeatRow.rowFormat" @change="scheduleSave" class="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs">
                <option v-for="f in ROW_FORMATS" :key="f.id" :value="f.id">{{ f.label }}</option>
              </select>
            </div>
            <div>
              <label class="text-[11px] text-gray-500">Sens</label>
              <select v-model="selectedSeatRow.rowDirection" @change="scheduleSave" class="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs">
                <option v-for="d in DIRECTIONS" :key="d.id" :value="d.id">{{ d.label }}</option>
              </select>
            </div>
          </div>

          <p class="text-xs font-bold text-gray-700 mb-2">Nommage des colonnes</p>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-[11px] text-gray-500">Format</label>
              <select v-model="selectedSeatRow.colFormat" @change="scheduleSave" class="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs">
                <option v-for="f in COL_FORMATS" :key="f.id" :value="f.id">{{ f.label }}</option>
              </select>
            </div>
            <div>
              <label class="text-[11px] text-gray-500">Sens</label>
              <select v-model="selectedSeatRow.colDirection" @change="scheduleSave" class="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs">
                <option v-for="d in DIRECTIONS" :key="d.id" :value="d.id">{{ d.label }}</option>
              </select>
            </div>
          </div>
        </div>

        <p class="text-xs text-gray-400">
          {{ Number(selectedSeatRow.rows) * Number(selectedSeatRow.cols) || 0 }} sièges · aperçu :
          <strong>{{ computeSeatLabel(0, 0, selectedSeatRow.rows, selectedSeatRow.cols, selectedSeatRow) }}</strong>…
        </p>
        <p class="text-[11px] text-gray-300">Astuce : tirez le bord gauche/droit du bloc pour ajouter/retirer des sièges par rang, et le bord haut/bas pour ajouter/retirer des rangées. Ctrl/Cmd-clic ou Maj-clic sur plusieurs sièges pour une action groupée.</p>
        <button @click="removeSelected" class="w-full mt-2 py-2 rounded-lg bg-red-50 text-red-500 text-sm font-semibold hover:bg-red-100">
          Supprimer ce bloc
        </button>
      </div>

      <!-- Propriétés d'un siège individuel -->
      <div v-else-if="selectedSeat" class="flex flex-col gap-3">
        <div class="flex items-center gap-2 mb-1">
          <span class="w-3 h-3 rounded-sm" :style="{ background: catById(selectedSeat.categoryId).color }"></span>
          <p class="font-bold text-gray-800">Siège {{ selectedSeat.label }}</p>
        </div>
        <dl class="text-sm flex flex-col gap-1.5">
          <div class="flex justify-between"><dt class="text-gray-400">Section</dt><dd class="font-medium text-gray-700">{{ selectedSeat.row.section || selectedSeat.row.label }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-400">Rangée</dt><dd class="font-medium text-gray-700">{{ selectedSeat.rowLabel }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-400">Colonne</dt><dd class="font-medium text-gray-700">{{ selectedSeat.colLabel }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-400">Catégorie</dt><dd class="font-medium text-gray-700">{{ catById(selectedSeat.categoryId).name }}</dd></div>
          <div class="flex justify-between items-center"><dt class="text-gray-400">Statut</dt>
            <dd>
              <span class="px-2 py-0.5 rounded-full text-xs font-semibold"
                :class="{
                  'bg-gray-200 text-gray-600': selectedSeat.status === 'sold',
                  'bg-amber-50 text-amber-600': selectedSeat.status === 'disabled',
                  'bg-green-50 text-green-600': selectedSeat.status === 'available',
                }">
                {{ selectedSeat.status === 'sold' ? 'Vendu' : selectedSeat.status === 'disabled' ? 'Désactivé' : 'Disponible' }}
              </span>
            </dd>
          </div>
        </dl>
        <div>
          <label class="text-xs font-semibold text-gray-500">Changer la catégorie de ce siège</label>
          <select :value="selectedSeat.categoryId" @change="async (e) => {
              const row = seatRows.find(r => r.id === selectedSeat.row.id);
              const overrides = { ...(row.categoryOverrides || {}) };
              overrides[selectedSeat.posKey] = e.target.value;
              row.categoryOverrides = overrides;
              selectedSeat.categoryId = e.target.value;
              await adminApi.updateSeatRow(row.id, { categoryOverrides: overrides }, venueId);
              emit('changed');
            }"
            class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm">
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <button v-if="selectedSeat.status !== 'disabled'" @click="toggleSelectedSeatStatus" class="w-full mt-1 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200">
          Marquer {{ selectedSeat.status === 'sold' ? 'disponible' : 'vendu' }}
        </button>
        <button @click="toggleSelectedSeatDisabled"
          class="w-full py-2 rounded-lg text-sm font-semibold"
          :class="selectedSeat.status === 'disabled' ? 'bg-green-50 text-green-600 hover:bg-green-100' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'">
          {{ selectedSeat.status === 'disabled' ? 'Réactiver ce siège' : 'Désactiver ce siège (non sélectionnable)' }}
        </button>
        <p class="text-[11px] text-gray-300">Le statut "vendu" reste une démonstration locale. La catégorie et le statut désactivé sont persistés.</p>
      </div>

      <!-- Propriétés d'un siège de section de tables -->
      <div v-else-if="selectedTableSectionSeat" class="flex flex-col gap-3">
        <div class="flex items-center gap-2 mb-1">
          <span class="w-3 h-3 rounded-full" :style="{ background: catById(selectedTableSectionSeat.ts.categoryId).color }"></span>
          <p class="font-bold text-gray-800">Table {{ selectedTableSectionSeat.tableIndex + 1 }} · Siège {{ selectedTableSectionSeat.seatIndex + 1 }}</p>
        </div>
        <dl class="text-sm flex flex-col gap-1.5">
          <div class="flex justify-between"><dt class="text-gray-400">Section</dt><dd class="font-medium text-gray-700">{{ selectedTableSectionSeat.ts.section || selectedTableSectionSeat.ts.label }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-400">Catégorie</dt><dd class="font-medium text-gray-700">{{ catById(selectedTableSectionSeat.ts.categoryId).name }}</dd></div>
          <div class="flex justify-between items-center"><dt class="text-gray-400">Statut</dt>
            <dd><span class="px-2 py-0.5 rounded-full text-xs font-semibold"
              :class="selectedTableSectionSeat.status === 'disabled' ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'">
              {{ selectedTableSectionSeat.status === 'disabled' ? 'Désactivé' : 'Disponible' }}
            </span></dd>
          </div>
        </dl>
        <button @click="toggleSelectedTableSectionSeatDisabled"
          class="w-full py-2 rounded-lg text-sm font-semibold"
          :class="selectedTableSectionSeat.status === 'disabled' ? 'bg-green-50 text-green-600 hover:bg-green-100' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'">
          {{ selectedTableSectionSeat.status === 'disabled' ? 'Réactiver ce siège' : 'Désactiver ce siège' }}
        </button>
      </div>

      <!-- Propriétés d'un siège de table individuel -->
      <div v-else-if="selectedTableSeat" class="flex flex-col gap-3">
        <div class="flex items-center gap-2 mb-1">
          <span class="w-3 h-3 rounded-full" :style="{ background: catById(selectedTableSeat.table.categoryId).color }"></span>
          <p class="font-bold text-gray-800">Siège {{ selectedTableSeat.index + 1 }}</p>
        </div>
        <dl class="text-sm flex flex-col gap-1.5">
          <div class="flex justify-between"><dt class="text-gray-400">Section</dt><dd class="font-medium text-gray-700">{{ selectedTableSeat.table.section || selectedTableSeat.table.label }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-400">Catégorie</dt><dd class="font-medium text-gray-700">{{ catById(selectedTableSeat.table.categoryId).name }}</dd></div>
          <div class="flex justify-between items-center"><dt class="text-gray-400">Statut</dt>
            <dd>
              <span class="px-2 py-0.5 rounded-full text-xs font-semibold"
                :class="{
                  'bg-amber-50 text-amber-600': selectedTableSeat.status === 'disabled',
                  'bg-green-50 text-green-600': selectedTableSeat.status !== 'disabled',
                }">
                {{ selectedTableSeat.status === 'disabled' ? 'Désactivé' : 'Disponible' }}
              </span>
            </dd>
          </div>
        </dl>
        <button @click="toggleSelectedTableSeatDisabled"
          class="w-full py-2 rounded-lg text-sm font-semibold"
          :class="selectedTableSeat.status === 'disabled' ? 'bg-green-50 text-green-600 hover:bg-green-100' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'">
          {{ selectedTableSeat.status === 'disabled' ? 'Réactiver ce siège' : 'Désactiver ce siège' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-seat-card {
  border: 1px solid transparent;
  border-radius: 22px;
  padding: 14px;
}
.editor-row-badge {
  position: relative;
  width: fit-content;
  margin: 0 auto -8px auto;
  background: #fff;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 2px 12px;
  font-weight: 700;
  z-index: 2;
  left: 50%;
  transform: translateX(-50%);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
</style>
