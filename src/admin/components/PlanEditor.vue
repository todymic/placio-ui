<script setup>
import { ref, reactive, watch, computed, onMounted, nextTick } from 'vue';
import { adminApi } from '../services/adminApi';
import { computeSeatLabel, computeAxisLabel, ROW_FORMATS, COL_FORMATS, DIRECTIONS } from '../../services/seatLabel';
import { FREE_ZONE_ICONS, FREE_ZONE_PATTERNS, iconById, patternStyle } from '../../services/icons';
import PreviewPlan from './PreviewPlan.vue';

const props = defineProps({
  venueId: { type: String, required: true },
  planStatus: { type: String, default: 'draft' },
  planPendingChanges: { type: Boolean, default: false },
  planName: { type: String, default: '' },
});
const emit = defineEmits(['changed']);

const categories = ref([]);
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
const showProps = ref(false);
const showInfoTooltip = ref(false);
// Auto-ouvre le panneau propriétés sur mobile quand un élément est sélectionné
watch(selected, (v) => { if (v && window.innerWidth < 1024) showProps.value = true; });

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

const LOD_THRESHOLD = 0.5;
const isLod = computed(() => zoom.value < LOD_THRESHOLD);

function itemShowBadge(item) {
  return isLod.value || !!item.badgeVisible;
}

const drag = reactive({ active: false, mode: null, kind: null, id: null, offsetX: 0, offsetY: 0, startW: 0, startH: 0, startX: 0, startY: 0 });
const pan = reactive({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 });

let panWasDrag = false;

function startPan(ev) {
  if (ev.button !== 0) return;
  ev.preventDefault();
  panWasDrag = false;
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
  const dx = ev.clientX - pan.startX, dy = ev.clientY - pan.startY;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) panWasDrag = true;
  panX.value = pan.originX + dx;
  panY.value = pan.originY + dy;
}
function stopPan() {
  pan.active = false;
  window.removeEventListener('pointermove', onPan);
  window.removeEventListener('pointerup', stopPan);
  window.removeEventListener('pointercancel', stopPan);
}

function onScrollerClick(ev) {
  if (zoom.value >= 0.5 || panWasDrag) return;
  const rect = scrollerRef.value.getBoundingClientRect();
  const cx = (ev.clientX - rect.left - panX.value) / zoom.value;
  const cy = (ev.clientY - rect.top  - panY.value) / zoom.value;
  const newZoom = 1.5;
  panX.value = rect.width  / 2 - cx * newZoom;
  panY.value = rect.height / 2 - cy * newZoom;
  zoom.value = newZoom;
}



// Statuts de sièges modifiés localement depuis l'éditeur (démo — non persistés en base)
const seatStatusOverrides = reactive({});

const CANVAS_PAD = 400;

function tableZoneSize(t) {
  return (t.tableSize || 30) + 2 * (t.seatSize || 15) + 16;
}
const TS_PAD = 4; // inner padding inside tableSection border
function tableSectionUnitSize(ts) {
  return (ts.tableSize || 30) + 2 * (ts.seatSize || 15) + 16;
}
function tableSectionWidth(ts) {
  const unit = tableSectionUnitSize(ts);
  return (ts.tableCount || 3) * unit + ((ts.tableCount || 3) - 1) * (ts.tableSpacing ?? 2) + 2 * TS_PAD;
}
function tableSectionHeight(ts) {
  const rows = ts.tableRows || 1;
  const unit = tableSectionUnitSize(ts);
  return rows * unit + (rows - 1) * (ts.tableSpacing ?? 2) + 2 * TS_PAD;
}

const canvasHeight = computed(() => {
  let max = 600;
  for (const z of zones.value)      max = Math.max(max, (z.top  || 0) + (z.height || 70)  + CANVAS_PAD);
  for (const r of seatRows.value)   max = Math.max(max, (r.top  || 0) + (r.rows || 1) * ((r.seatSize || 22) + 4) + 30 + CANVAS_PAD);
  for (const f of freeZones.value)  max = Math.max(max, (f.top  || 0) + (f.height || 50)  + CANVAS_PAD);
  for (const t of tableZones.value) max = Math.max(max, (t.top  || 0) + tableZoneSize(t)   + CANVAS_PAD);
  for (const ts of tableSections.value) max = Math.max(max, (ts.top || 0) + tableSectionHeight(ts) + CANVAS_PAD);
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

const loadError = ref('');

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const [cats, zs, srs, fzs, tzs, tss] = await Promise.all([
      adminApi.listCategories(props.venueId),
      adminApi.listZones(props.venueId),
      adminApi.listSeatRows(props.venueId),
      adminApi.listFreeZones(props.venueId),
      adminApi.listTableZones(props.venueId),
      adminApi.listTableSections(props.venueId),
    ]);
    categories.value = cats;
    zones.value = zs;
    seatRows.value = srs;
    freeZones.value = fzs;
    tableZones.value = tzs;
    tableSections.value = tss;
    initZCounter();
    emit('changed');
  } catch (e) {
    loadError.value = e.message || 'Erreur de chargement';
  } finally {
    loading.value = false;
  }
}

// ---- Gestion des catégories inline ----
const showCatPanel = ref(false);
const catBtnRef = ref(null);
const catPanelStyle = ref({});

function toggleCatPanel() {
  if (!showCatPanel.value) {
    const rect = catBtnRef.value?.getBoundingClientRect();
    if (rect) {
      catPanelStyle.value = { top: (rect.bottom + 6) + 'px', left: rect.left + 'px' };
    }
  }
  showCatPanel.value = !showCatPanel.value;
  catFormOpen.value = false;
  catError.value = '';
}

const catForm = ref({ name: '', color: '#2554c7' });
const catEditing = ref(null);
const catSaving = ref(false);
const catError = ref('');
const catFormOpen = ref(false);

function openCatCreate() {
  catEditing.value = null;
  catForm.value = { name: '', color: '#2554c7' };
  catFormOpen.value = true;
}
function openCatEdit(c) {
  catEditing.value = c;
  catForm.value = { name: c.name, color: c.color };
  catFormOpen.value = true;
}
async function saveCat() {
  if (!catForm.value.name.trim()) return;
  catSaving.value = true;
  const payload = { name: catForm.value.name.trim().toUpperCase(), color: catForm.value.color };
  if (catEditing.value) {
    await adminApi.updateCategory(catEditing.value.id, payload, props.venueId, catEditing.value.key);
  } else {
    await adminApi.createCategory(props.venueId, payload);
  }
  catSaving.value = false;
  catFormOpen.value = false;
  categories.value = await adminApi.listCategories(props.venueId);
  emit('changed');
}
// ---- Toast ----
const toast = ref(null); // { message, type: 'success'|'error'|'info', timeout }
let toastTimer = null;
function showToast(message, type = 'success', duration = 3000) {
  clearTimeout(toastTimer);
  toast.value = { message, type };
  toastTimer = setTimeout(() => { toast.value = null; }, duration);
}

// ---- Suppressions de catégories en attente (effectives uniquement à la publication) ----
const pendingCatDeletions = reactive(new Set()); // Set<categoryId>

function removeCat(c) {
  catError.value = '';
  pendingCatDeletions.add(c.id);
  isDirty.value = true;
  showToast(`Catégorie « ${c.name} » marquée pour suppression — sera définitive à la prochaine publication.`, 'info', 4000);
}

function cancelCatDeletion(c) {
  pendingCatDeletions.delete(c.id);
}

async function flushPendingCatDeletions() {
  for (const id of pendingCatDeletions) {
    const cat = categories.value.find(c => c.id === id);
    if (cat) {
      try { await adminApi.deleteCategory(id, props.venueId, cat.key); } catch (_) {}
    }
  }
  pendingCatDeletions.clear();
  categories.value = await adminApi.listCategories(props.venueId);
}
watch(() => props.venueId, load, { immediate: true });

function catById(id) {
  return categories.value.find((c) => c.id === id) || { color: '#999999', name: '—' };
}

function seatGrid(row) {
  const seats = [];
  const naming = { rowFormat: row.rowFormat, rowDirection: row.rowDirection, colFormat: row.colFormat, colDirection: row.colDirection };
  const disabledSeats = row.disabledSeats || [];
  const deletedSeats  = row.deletedSeats  || [];
  const overrides = row.categoryOverrides || {};
  const section = row.section || row.label || row.id;
  for (let r = 0; r < row.rows; r++) {
    for (let c = 0; c < row.cols; c++) {
      const posKey = `${r}-${c}`;
      const isDeleted  = deletedSeats.includes(posKey);
      const isDisabled = !isDeleted && disabledSeats.includes(posKey);
      const rowLabel = computeAxisLabel(r, row.rows, naming.rowFormat, naming.rowDirection);
      const colLabel = computeAxisLabel(c, row.cols, naming.colFormat, naming.colDirection);
      const key = `${section}-${rowLabel}-${colLabel}`;
      seats.push({
        key, r, c, posKey,
        rowLabel, colLabel,
        label: computeSeatLabel(r, c, row.rows, row.cols, naming),
        categoryId: overrides[posKey] || row.categoryId,
        status: isDeleted ? 'deleted' : isDisabled ? 'disabled' : (seatStatusOverrides[`${row.id}-${posKey}`] || 'available'),
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
  const deleted  = ts.deletedSeats  || [];
  const cols = ts.tableCount || 3;
  const rows = ts.tableRows || 1;
  const totalTables = cols * rows;
  const seatsOverrides = ts.tableSeatsOverrides || {};
  const rotOverrides   = ts.tableRotationOverrides || {};
  const seats = [];
  for (let ti = 0; ti < totalTables; ti++) {
    const seatsCount = seatsOverrides[ti] !== undefined ? Number(seatsOverrides[ti]) : (ts.seatsPerTable || 6);
    const rotRad = ((rotOverrides[ti] || 0) * Math.PI) / 180;
    for (let si = 0; si < seatsCount; si++) {
      const posKey = `${ti}-${si}`;
      const isDeleted  = deleted.includes(posKey);
      const isDisabled = !isDeleted && disabled.includes(posKey);
      seats.push({
        tableIndex: ti, seatIndex: si, seatsCount, rotRad,
        key: `${section}-${ti + 1}-${si + 1}`,
        status: isDeleted ? 'deleted' : isDisabled ? 'disabled' : (seatStatusOverrides[`tse:${ts.id}|${ti}-${si}`] || 'available'),
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
    const totalTables = (ts.tableCount || 3) * (ts.tableRows || 1);
    for (let ti = 0; ti < totalTables; ti++) {
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

const anomaliesOpen = ref(true);
const hoveredTableSection = ref(null);
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

  // catégories valides = existantes ET non marquées pour suppression
  const catIds = new Set(categories.value.filter(c => !pendingCatDeletions.has(c.id)).map(c => c.id));
  const missingCategory = [
    ...seatRows.value.filter(x => !x.categoryId || !catIds.has(x.categoryId)).map(x => ({ id: x.id, kind: 'seatRow', label: x.section || x.label || x.id })),
    ...tableZones.value.filter(x => !x.categoryId || !catIds.has(x.categoryId)).map(x => ({ id: x.id, kind: 'tableZone', label: x.section || x.label || x.id })),
    ...tableSections.value.filter(x => !x.categoryId || !catIds.has(x.categoryId)).map(x => ({ id: x.id, kind: 'tableSection', label: x.section || x.label || x.id })),
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
const selectedTableSectionTable = computed(() => {
  if (selected.value?.kind !== 'tableSectionTable') return null;
  const ts = tableSections.value.find((x) => x.id === selected.value.tsId);
  if (!ts) return null;
  return { ts, tableIndex: selected.value.tableIndex };
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
function selectTableSectionTable(ts, tableIndex) { selected.value = { kind: 'tableSectionTable', tsId: ts.id, tableIndex }; multiSelected.clear(); }
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
  if (ev.button !== 0) return;
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
  drag.moved = false;
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
  drag.moved = false;
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
  drag.moved = false;
  drag.cellSize = (row.seatSize || 18) + 6;
  drag.startX = ev.clientX;
  drag.startY = ev.clientY;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', stopDrag);
}

function startResizeTableSection(ev, ts, side) {
  if (ev.button !== 0) return;
  ev.preventDefault();
  ev.stopPropagation();
  selectTableSection(ts);
  drag.active = true;
  drag.mode = 'resizeTableSection';
  drag.side = side;
  drag.kind = 'tableSection';
  drag.id = ts.id;
  drag.baseTables = ts.tableCount || 3;
  drag.baseTableRows = ts.tableRows || 1;
  drag.startLeft = ts.left;
  drag.startTop = ts.top;
  drag.startW = tableSectionWidth(ts);
  drag.startH = tableSectionHeight(ts);
  drag.moved = false;
  drag.hCellSize = tableSectionUnitSize(ts) + (ts.tableSpacing ?? 2);
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
  drag.moved = true;
  const z = zoom.value;
  if (drag.mode === 'move') {
    const canvasRect = canvasRef.value.getBoundingClientRect();
    let newLeft = Math.max(0, Math.round((ev.clientX - canvasRect.left) / z - drag.offsetX));
    let newTop  = Math.max(0, Math.round((ev.clientY - canvasRect.top)  / z - drag.offsetY));
    const item = listFor(drag.kind).find((x) => x.id === drag.id);
    if (item) { item.left = newLeft; item.top = newTop; }
    // Détection de survol d'une tableSection lors du drag d'une tableZone
    if (drag.kind === 'tableZone' && item) {
      const tzSize = tableZoneSize(item);
      const tzCX = item.left + tzSize / 2;
      const tzCY = item.top  + tzSize / 2;
      hoveredTableSection.value = tableSections.value.find((ts) =>
        tzCX >= ts.left && tzCX <= ts.left + tableSectionWidth(ts) &&
        tzCY >= ts.top  && tzCY <= ts.top  + tableSectionHeight(ts)
      ) ?? null;
    } else {
      hoveredTableSection.value = null;
    }
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
  } else if (drag.mode === 'resizeTableSection') {
    const item = tableSections.value.find((x) => x.id === drag.id);
    if (item) {
      const dx = (ev.clientX - drag.startX) / z;
      const dy = (ev.clientY - drag.startY) / z;
      if (drag.side === 'right') {
        item.tableCount = Math.max(1, drag.baseTables + Math.round(dx / drag.hCellSize));
      } else if (drag.side === 'left') {
        const newCount = Math.max(1, drag.baseTables - Math.round(dx / drag.hCellSize));
        item.left = Math.max(0, Math.round(drag.startLeft + drag.startW - tableSectionWidth(item)));
        item.tableCount = newCount;
      } else if (drag.side === 'bottom') {
        item.tableRows = Math.max(1, drag.baseTableRows + Math.round(dy / drag.hCellSize));
      } else if (drag.side === 'top') {
        const newRows = Math.max(1, drag.baseTableRows - Math.round(dy / drag.hCellSize));
        item.top = Math.max(0, Math.round(drag.startTop + drag.startH - tableSectionHeight({ ...item, tableRows: newRows })));
        item.tableRows = newRows;
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
  if (!item || !drag.moved) { hoveredTableSection.value = null; return; }
  isDirty.value = true;

  // Fusion d'une tableZone dans une tableSection survolée
  if (mode === 'move' && kind === 'tableZone' && hoveredTableSection.value) {
    const ts = hoveredTableSection.value;
    hoveredTableSection.value = null;
    const unit = tableSectionUnitSize(ts);
    const newIndex = (ts.tableCount || 3); // index 0-based de la nouvelle table
    const dropXInSection = item.left - ts.left;
    const rawSpacing = newIndex > 0
      ? (dropXInSection - TS_PAD - newIndex * unit) / newIndex
      : (ts.tableSpacing ?? 2);
    ts.tableSpacing = Math.max(0, Math.round(rawSpacing));
    // Hérite catégorie et section de la tableZone si la section n'en a pas
    if (!ts.categoryId && item.categoryId) ts.categoryId = item.categoryId;
    if (!ts.section && item.section) ts.section = item.section;
    // Copie du nombre de sièges si différent du défaut de la section
    if (item.seatCount && item.seatCount !== (ts.seatsPerTable || 6)) {
      if (!ts.tableSeatsOverrides) ts.tableSeatsOverrides = {};
      ts.tableSeatsOverrides[newIndex] = item.seatCount;
    }
    ts.tableCount = newIndex + 1;
    tableZones.value = tableZones.value.filter((x) => x.id !== item.id);
    await adminApi.deleteTableZone(item.id, props.venueId);
    await adminApi.updateTableSection(ts.id, {
      tableCount: ts.tableCount,
      tableSpacing: ts.tableSpacing,
      tableSeatsOverrides: ts.tableSeatsOverrides || {},
      categoryId: ts.categoryId,
      section: ts.section,
    }, props.venueId);
    emit('changed');
    return;
  }
  hoveredTableSection.value = null;

  if (mode === 'move') {
    if (kind === 'zone') await adminApi.updateZone(item.id, { top: item.top, left: item.left }, props.venueId);
    else if (kind === 'freeZone') await adminApi.updateFreeZone(item.id, { top: item.top, left: item.left }, props.venueId);
    else if (kind === 'tableZone') await adminApi.updateTableZone(item.id, { top: item.top, left: item.left }, props.venueId);
    else if (kind === 'tableSection') await adminApi.updateTableSection(item.id, { top: item.top, left: item.left }, props.venueId);
    else await adminApi.updateSeatRow(item.id, { top: item.top, left: item.left }, props.venueId);
  } else if (mode === 'resize') {
    if (kind === 'zone') await adminApi.updateZone(item.id, { width: item.width, height: item.height, top: item.top, left: item.left }, props.venueId);
    else await adminApi.updateFreeZone(item.id, { width: item.width, height: item.height, top: item.top, left: item.left }, props.venueId);
  } else if (mode === 'resizeTableSection') {
    await adminApi.updateTableSection(item.id, { tableCount: item.tableCount, tableRows: item.tableRows || 1, top: item.top, left: item.left }, props.venueId);
  } else if (mode === 'resizeSeatRow') {
    await adminApi.updateSeatRow(item.id, { rows: item.rows, cols: item.cols }, props.venueId);
  }
  emit('changed');
}

// ---------- Ajout ----------
async function addZone() {
  if (categories.value.length === 0) return;
  const z = await adminApi.createZone(props.venueId, {
    label: 'Nouvelle zone', categoryId: categories.value[0].id,
    top: 40, left: 40, width: 200, height: 70, capacity: 50, shape: 'rect', labelFontSize: 11,
  });
  zones.value.push(z);
  selectZone(z);
  isDirty.value = true;
  emit('changed');
}
async function addSeatRow() {
  if (categories.value.length === 0) return;
  const nextNumber = seatRows.value.reduce((max, r) => Math.max(max, r.blockNumber || 0), 0) + 1;
  const r = await adminApi.createSeatRow(props.venueId, {
    section: '', label: 'Nouveau bloc', categoryId: categories.value[0].id,
    top: 40, left: 40, rows: 3, cols: 6, shape: 'rounded', seatSize: 22,
  });
  seatRows.value.push(r);
  selectSeatRow(r);
  isDirty.value = true;
  emit('changed');
}
async function addFreeZone() {
  const fz = await adminApi.createFreeZone(props.venueId, {
    label: 'Zone libre', icon: 'none', color: '#6b7280', pattern: 'solid',
    top: 40, left: 300, width: 110, height: 50, labelFontSize: 10,
  });
  freeZones.value.push(fz);
  selectFreeZone(fz);
  isDirty.value = true;
  emit('changed');
}
async function addTableSection() {
  if (categories.value.length === 0) return;
  const ts = await adminApi.createTableSection(props.venueId, {
    section: '', label: 'Section de tables', tableCount: 3, seatsPerTable: 6,
    tableRows: 1, tableSize: 30, seatSize: 13, seatLabelFontSize: 9, tableSpacing: 20,
    categoryId: categories.value[0].id,
    top: 80, left: 80, rowLabelFontSize: 10, disabledSeats: [],
  });
  tableSections.value.push(ts);
  selectTableSection(ts);
  isDirty.value = true;
  emit('changed');
}
async function addTableZone() {
  if (categories.value.length === 0) return;
  const t = await adminApi.createTableZone(props.venueId, {
    section: '', label: 'Table', seatCount: 6,
    tableSize: 30, seatSize: 13, seatLabelFontSize: 9,
    categoryId: categories.value[0].id,
    top: 80, left: 200, rowLabelFontSize: 10, disabledSeats: [],
  });
  tableZones.value.push(t);
  selectTableZone(t);
  isDirty.value = true;
  emit('changed');
}

// ---------- Édition via panneau latéral ----------
let saveTimer = null;
function scheduleSave() {
  isDirty.value = true;
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
      badgeVisible: !!r.badgeVisible,
      deletedSeats: r.deletedSeats || [],
    }, props.venueId);
  } else if (selectedFreeZone.value) {
    const f = selectedFreeZone.value;
    await adminApi.updateFreeZone(f.id, {
      label: f.label, icon: f.icon, color: f.color, pattern: f.pattern,
      textColor: f.textColor || null, iconSize: f.iconSize ? Number(f.iconSize) : null,
      width: Number(f.width), height: Number(f.height), labelFontSize: Number(f.labelFontSize),
    }, props.venueId);
  } else if (selectedTableZone.value) {
    const t = selectedTableZone.value;
    await adminApi.updateTableZone(t.id, {
      section: t.section, label: t.label, categoryId: t.categoryId,
      seatCount: Number(t.seatCount), tableSize: Number(t.tableSize),
      seatSize: Number(t.seatSize), seatLabelFontSize: Number(t.seatLabelFontSize || 9),
      tableLabelFontSize: Number(t.tableLabelFontSize || 13),
      rowLabelFontSize: Number(t.rowLabelFontSize), rotation: Number(t.rotation || 0),
      disabledSeats: t.disabledSeats || [],
    }, props.venueId);
  } else if (selectedTableSection.value) {
    const ts = selectedTableSection.value;
    await adminApi.updateTableSection(ts.id, {
      section: ts.section, label: ts.label, categoryId: ts.categoryId,
      tableCount: Number(ts.tableCount), tableRows: Number(ts.tableRows || 1), seatsPerTable: Number(ts.seatsPerTable),
      tableSize: Number(ts.tableSize), seatSize: Number(ts.seatSize),
      seatLabelFontSize: Number(ts.seatLabelFontSize || 9),
      tableLabelFontSize: Number(ts.tableLabelFontSize || 13),
      tableSpacing: Number(ts.tableSpacing), rowLabelFontSize: Number(ts.rowLabelFontSize),
      rotation: Number(ts.rotation || 0),
      badgeVisible: !!ts.badgeVisible,
      disabledSeats: ts.disabledSeats || [],
      deletedSeats: ts.deletedSeats || [],
      tableSeatsOverrides: ts.tableSeatsOverrides || {},
      tableRotationOverrides: ts.tableRotationOverrides || {},
      deletedTables: ts.deletedTables || [],
    }, props.venueId);
  }
  emit('changed');
}

function resetFreeZone() {
  const f = selectedFreeZone.value;
  if (!f) return;
  f.color = '#6b7280';
  f.textColor = '#000000';
  f.icon = 'none';
  f.iconSize = null;
  f.pattern = 'solid';
  f.labelFontSize = 10;
  scheduleSave();
}

async function removeSelected() {
  if (selectedZone.value) {
    const z = selectedZone.value;
    await adminApi.deleteZone(z.id, props.venueId);
    zones.value = zones.value.filter((x) => x.id !== z.id);
  } else if (selectedSeatRow.value) {
    const r = selectedSeatRow.value;
    await adminApi.deleteSeatRow(r.id, props.venueId);
    seatRows.value = seatRows.value.filter((x) => x.id !== r.id);
  } else if (selectedFreeZone.value) {
    const f = selectedFreeZone.value;
    await adminApi.deleteFreeZone(f.id, props.venueId);
    freeZones.value = freeZones.value.filter((x) => x.id !== f.id);
  } else if (selectedTableZone.value) {
    const t = selectedTableZone.value;
    await adminApi.deleteTableZone(t.id, props.venueId);
    tableZones.value = tableZones.value.filter((x) => x.id !== t.id);
  } else if (selectedTableSection.value) {
    const ts = selectedTableSection.value;
    await adminApi.deleteTableSection(ts.id, props.venueId);
    tableSections.value = tableSections.value.filter((x) => x.id !== ts.id);
  }
  deselect();
  isDirty.value = true;
  emit('changed');
}

// ---------- Action sur le siège sélectionné (démo locale : statut vendu) ----------
function toggleSelectedSeatStatus() {
  const s = selected.value;
  if (!s || s.kind !== 'seat') return;
  const current = seatStatusOverrides[s.seatId] || 'available';
  seatStatusOverrides[s.seatId] = current === 'sold' ? 'available' : 'sold';
  s.seatInfo.status = seatStatusOverrides[s.seatId];
  isDirty.value = true;
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
  isDirty.value = true;
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
  isDirty.value = true;
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
  isDirty.value = true;
  emit('changed');
}

async function deleteSeat() {
  const s = selected.value;
  if (!s || s.kind !== 'seat') return;
  const row = seatRows.value.find((r) => r.id === s.rowId);
  if (!row) return;
  const list = [...(row.deletedSeats || [])];
  if (!list.includes(s.seatInfo.posKey)) list.push(s.seatInfo.posKey);
  row.deletedSeats = list;
  s.seatInfo.status = 'deleted';
  await adminApi.updateSeatRow(row.id, { deletedSeats: list }, props.venueId);
  isDirty.value = true;
  emit('changed');
  deselect();
}

async function deleteTableSectionSeat() {
  const s = selectedTableSectionSeat.value;
  if (!s) return;
  const ts = tableSections.value.find((x) => x.id === s.ts.id);
  if (!ts) return;
  const posKey = `${s.tableIndex}-${s.seatIndex}`;
  const list = new Set(ts.deletedSeats || []);
  list.add(posKey);
  ts.deletedSeats = [...list];
  await adminApi.updateTableSection(ts.id, { deletedSeats: ts.deletedSeats }, props.venueId);
  isDirty.value = true;
  emit('changed');
  deselect();
}

async function disableTableSectionTable() {
  const s = selectedTableSectionSeat.value;
  if (!s) return;
  const ts = tableSections.value.find((x) => x.id === s.ts.id);
  if (!ts) return;
  const count = (ts.tableSeatsOverrides?.[s.tableIndex] !== undefined) ? Number(ts.tableSeatsOverrides[s.tableIndex]) : (ts.seatsPerTable || 6);
  const list = new Set(ts.disabledSeats || []);
  for (let si = 0; si < count; si++) list.add(`${s.tableIndex}-${si}`);
  ts.disabledSeats = [...list];
  await adminApi.updateTableSection(ts.id, { disabledSeats: ts.disabledSeats }, props.venueId);
  isDirty.value = true;
  emit('changed');
  deselect();
}

// Actions sur une table entière sélectionnée via son cercle
async function toggleTableDisabled() {
  const sel = selectedTableSectionTable.value;
  if (!sel) return;
  const { ts, tableIndex } = sel;
  const count = (ts.tableSeatsOverrides?.[tableIndex] !== undefined) ? Number(ts.tableSeatsOverrides[tableIndex]) : (ts.seatsPerTable || 6);
  const deleted = new Set(ts.deletedSeats || []);
  const disabled = new Set(ts.disabledSeats || []);
  // Vérifie si tous les sièges actifs (non supprimés) sont déjà désactivés
  const activeKeys = [];
  for (let si = 0; si < count; si++) {
    const key = `${tableIndex}-${si}`;
    if (!deleted.has(key)) activeKeys.push(key);
  }
  const allDisabled = activeKeys.every((k) => disabled.has(k));
  if (allDisabled) {
    activeKeys.forEach((k) => disabled.delete(k));
  } else {
    activeKeys.forEach((k) => disabled.add(k));
  }
  ts.disabledSeats = [...disabled];
  await adminApi.updateTableSection(ts.id, { disabledSeats: ts.disabledSeats }, props.venueId);
  isDirty.value = true;
  emit('changed');
}

async function deleteEntireTable() {
  const sel = selectedTableSectionTable.value;
  if (!sel) return;
  const { ts, tableIndex } = sel;
  const count = (ts.tableSeatsOverrides?.[tableIndex] !== undefined) ? Number(ts.tableSeatsOverrides[tableIndex]) : (ts.seatsPerTable || 6);
  const seats = new Set(ts.deletedSeats || []);
  for (let si = 0; si < count; si++) seats.add(`${tableIndex}-${si}`);
  ts.deletedSeats = [...seats];
  const tables = new Set(ts.deletedTables || []);
  tables.add(tableIndex);
  ts.deletedTables = [...tables];
  await adminApi.updateTableSection(ts.id, { deletedSeats: ts.deletedSeats, deletedTables: ts.deletedTables }, props.venueId);
  isDirty.value = true;
  emit('changed');
  deselect();
}

function updateTableSeatsCount(seatsCount) {
  const sel = selectedTableSectionTable.value;
  if (!sel) return;
  const { ts, tableIndex } = sel;
  if (!ts.tableSeatsOverrides) ts.tableSeatsOverrides = {};
  ts.tableSeatsOverrides[tableIndex] = Number(seatsCount);
  scheduleSave();
}

function updateTableRotation(deg) {
  const sel = selectedTableSectionTable.value;
  if (!sel) return;
  const { ts, tableIndex } = sel;
  if (!ts.tableRotationOverrides) ts.tableRotationOverrides = {};
  ts.tableRotationOverrides[tableIndex] = Number(deg);
  scheduleSave();
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
// ---------- Nom modifiable ----------
const localName = ref(props.planName);
const savingName = ref(false);
watch(() => props.planName, (v) => { localName.value = v; });
async function saveName() {
  const n = localName.value.trim();
  if (!n || n === props.planName) return;
  savingName.value = true;
  try { await adminApi.updateVenue(props.venueId, { name: n }); emit('changed'); } catch (_) {}
  savingName.value = false;
}

const _isDirtyFlag = ref(props.planPendingChanges);
const isDirty = computed({
  get: () => _isDirtyFlag.value || pendingCatDeletions.size > 0,
  set: (v) => { _isDirtyFlag.value = v; },
});

watch(() => props.planPendingChanges, (v) => {
  if (v) _isDirtyFlag.value = true;
});

watch(isDirty, async (dirty) => {
  if (dirty) {
    try { await adminApi.markVenuePendingChanges(props.venueId); } catch (_) {}
  }
}, { immediate: false });

const showPreview = ref(false);


async function saveAll() {
  if (!canSave.value) return;
  saveError.value = '';
  saveSuccess.value = false;
  saving.value = true;
  try {
    const activeCats = categories.value.filter(c => !pendingCatDeletions.has(c.id));
    await adminApi.saveAllObjects(props.venueId, zones.value, seatRows.value, freeZones.value, activeCats, tableZones.value, tableSections.value);
    await Promise.all([
      adminApi.publishVenue(props.venueId),
      adminApi.updateVenueStatus(props.venueId, 'published'),
    ]);
    // Suppressions définitives uniquement après publication réussie
    await flushPendingCatDeletions();
    saveSuccess.value = true;
    isDirty.value = false;
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
  <div class="flex gap-4 h-full min-h-0 overflow-hidden relative">

    <div class="flex-1 min-w-0 bg-white rounded-2xl shadow-sm p-3 sm:p-4 flex flex-col min-h-0">
      <!-- Toolbar -->
      <div class="flex items-center gap-2 mb-2 overflow-x-auto pb-1 scrollbar-thin shrink-0">
        <div class="flex items-center gap-1.5 shrink-0">
          <span
            class="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
            :class="{
              'bg-yellow-100 text-yellow-700': props.planStatus === 'draft',
              'bg-green-100 text-green-600':  props.planStatus === 'published',
              'bg-gray-100 text-gray-500':    props.planStatus === 'archived',
            }"
          >{{ { draft: 'Brouillon', published: 'Publié', archived: 'Archivé' }[props.planStatus] }}</span>
          <span v-if="isDirty" class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 shrink-0 hidden sm:inline">
            Modif. non sauvegardées
          </span>
        </div>
        <!-- Nom du plan -->
        <input
          v-model="localName"
          class="min-w-0 flex-1 text-sm font-semibold text-gray-800 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none px-1 py-0.5 transition truncate"
          :title="localName"
          @blur="saveName"
          @keydown.enter.prevent="$event.target.blur()"
        />
        <!-- Catégories -->
        <div class="shrink-0">
          <button ref="catBtnRef" @click="toggleCatPanel"
            class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold transition"
            :class="showCatPanel ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'">
            <span class="flex gap-0.5">
              <span v-for="c in categories.slice(0, 5)" :key="c.id"
                class="inline-block w-3 h-3 rounded-full border border-white/60"
                :style="{ background: c.color }"></span>
              <span v-if="categories.length === 0" class="text-gray-400 italic text-[10px]">Aucune</span>
            </span>
            <span class="hidden sm:inline">Catégories</span>
            <svg class="w-3 h-3 text-gray-400 transition-transform" :class="showCatPanel ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
          </button>
        </div>

        <!-- Panel catégories — Teleport sur body pour éviter le clipping overflow -->
        <Teleport to="body">
          <div v-if="showCatPanel"
            class="fixed z-[9999] w-72 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
            :style="catPanelStyle"
            @click.stop>
            <div class="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <span class="text-xs font-bold text-gray-700">Catégories</span>
              <button @click="openCatCreate"
                class="text-[10px] font-semibold bg-gray-900 text-white px-2 py-1 rounded-md hover:bg-gray-700">
                + Ajouter
              </button>
            </div>
            <p v-if="catError" class="text-[10px] text-red-500 px-3 pt-2">{{ catError }}</p>
            <div v-if="categories.length === 0 && !catFormOpen" class="px-3 py-4 text-xs text-gray-400 text-center">
              Aucune catégorie — créez-en une pour commencer.
            </div>
            <ul v-else-if="!catFormOpen" class="max-h-52 overflow-y-auto divide-y divide-gray-50">
              <li v-for="c in categories" :key="c.id"
                class="flex items-center gap-2 px-3 py-2"
                :class="pendingCatDeletions.has(c.id) ? 'bg-red-50' : 'hover:bg-gray-50'">
                <span class="w-4 h-4 rounded-full shrink-0 border border-gray-200 transition-opacity"
                  :class="pendingCatDeletions.has(c.id) ? 'opacity-30' : ''"
                  :style="{ background: c.color }"></span>
                <span class="flex-1 text-xs font-semibold truncate"
                  :class="pendingCatDeletions.has(c.id) ? 'text-red-400 line-through' : 'text-gray-800'">
                  {{ c.name }}
                </span>
                <template v-if="pendingCatDeletions.has(c.id)">
                  <span class="text-[10px] text-red-400 italic shrink-0">à supprimer</span>
                  <button @click="cancelCatDeletion(c)" title="Annuler la suppression"
                    class="w-6 h-6 flex items-center justify-center rounded hover:bg-red-100 text-red-400 hover:text-red-600 text-xs">↩</button>
                </template>
                <template v-else>
                  <button @click="openCatEdit(c)" class="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 text-xs">✎</button>
                  <button @click="removeCat(c)" class="w-6 h-6 flex items-center justify-center rounded hover:bg-red-50 text-gray-300 hover:text-red-500 text-xs">✕</button>
                </template>
              </li>
            </ul>
            <!-- Formulaire ajout/édition -->
            <form v-if="catFormOpen" @submit.prevent="saveCat" class="px-3 py-3 flex flex-col gap-2">
              <div class="flex items-center gap-2">
                <input type="color" v-model="catForm.color" class="w-8 h-8 rounded cursor-pointer border border-gray-200 shrink-0" />
                <input v-model="catForm.name" placeholder="Nom de la catégorie" autofocus
                  class="flex-1 text-xs border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
              </div>
              <div class="flex gap-2">
                <button type="submit" :disabled="catSaving"
                  class="flex-1 text-xs font-semibold bg-gray-900 text-white py-1.5 rounded-md hover:bg-gray-700 disabled:opacity-50">
                  {{ catSaving ? '…' : (catEditing ? 'Enregistrer' : 'Créer') }}
                </button>
                <button type="button" @click="catFormOpen = false"
                  class="flex-1 text-xs font-semibold bg-gray-100 text-gray-600 py-1.5 rounded-md hover:bg-gray-200">
                  Annuler
                </button>
              </div>
            </form>
          </div>
          <!-- Overlay invisible pour fermer au clic extérieur -->
          <div v-if="showCatPanel" class="fixed inset-0 z-[9998]" @click="showCatPanel = false" />

          <!-- Toast notifications -->
          <Transition name="toast">
            <div v-if="toast"
              class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10001] px-4 py-2.5 rounded-xl shadow-xl text-sm font-semibold text-white pointer-events-none"
              :class="toast.type === 'error' ? 'bg-red-500' : 'bg-gray-900'">
              {{ toast.message }}
            </div>
          </Transition>
        </Teleport>

        <div class="flex gap-1.5 shrink-0">
          <!-- + Bloc de sièges -->
          <button :disabled="categories.length===0" @click="addSeatRow" title="+ Bloc de sièges"
            class="text-xs font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 flex items-center gap-1.5 px-2 py-1.5 sm:px-2.5">
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0"/>
            </svg>
            <span class="hidden sm:inline whitespace-nowrap">Sièges</span>
          </button>
          <!-- + Zone libre -->
          <button @click="addFreeZone" title="+ Zone libre"
            class="text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-1.5 px-2 py-1.5 sm:px-2.5">
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" stroke-width="2" fill="none"/>
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v8M8 12h8"/>
            </svg>
            <span class="hidden sm:inline whitespace-nowrap">Zone</span>
          </button>
          <!-- + Table -->
          <button :disabled="categories.length===0" @click="addTableZone" title="+ Table"
            class="text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-40 flex items-center gap-1.5 px-2 py-1.5 sm:px-2.5">
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <circle cx="12" cy="12" r="4" stroke="currentColor" fill="none"/>
              <circle cx="12" cy="4"  r="1.5" fill="currentColor"/>
              <circle cx="12" cy="20" r="1.5" fill="currentColor"/>
              <circle cx="4"  cy="12" r="1.5" fill="currentColor"/>
              <circle cx="20" cy="12" r="1.5" fill="currentColor"/>
            </svg>
            <span class="hidden sm:inline whitespace-nowrap">Table</span>
          </button>
          <!-- + Section de tables -->
          <button :disabled="categories.length===0" @click="addTableSection" title="+ Section de tables"
            class="text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-40 flex items-center gap-1.5 px-2 py-1.5 sm:px-2.5">
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <rect x="2" y="7" width="8" height="5" rx="1.5" fill="none" stroke="currentColor"/>
              <rect x="14" y="7" width="8" height="5" rx="1.5" fill="none" stroke="currentColor"/>
              <rect x="2" y="15" width="8" height="5" rx="1.5" fill="none" stroke="currentColor"/>
              <rect x="14" y="15" width="8" height="5" rx="1.5" fill="none" stroke="currentColor"/>
            </svg>
            <span class="hidden sm:inline whitespace-nowrap">Section</span>
          </button>
        </div>
        <div class="flex gap-1.5 ml-auto shrink-0">
          <!-- Publier -->
          <button :disabled="saving || !canSave" @click="saveAll" title="Publier"
            class="text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5 px-2 py-1.5 sm:px-3"
            :title="!canSave ? 'Corrigez les anomalies avant de publier' : 'Publier'">
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <span class="hidden sm:inline whitespace-nowrap">{{ saving ? 'Publication…' : 'Publier' }}</span>
          </button>
          <!-- Aperçu -->
          <button @click="showPreview = !showPreview" title="Aperçu"
            class="text-xs font-semibold rounded-lg flex items-center gap-1.5 px-2 py-1.5 sm:px-2.5 transition"
            :class="showPreview ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'">
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
            </svg>
            <span class="hidden sm:inline whitespace-nowrap">Aperçu</span>
          </button>
          <!-- Info tooltip (mobile) -->
          <div class="relative">
            <button @click="showInfoTooltip = !showInfoTooltip" title="Aide"
              class="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </button>
            <div v-if="showInfoTooltip"
              class="absolute right-0 top-10 z-30 w-72 bg-gray-900 text-gray-200 text-xs rounded-xl p-3 shadow-xl leading-relaxed"
              @click.stop>
              <button @click="showInfoTooltip = false" class="float-right text-gray-400 hover:text-white ml-2 leading-none">✕</button>
              Glissez pour <strong class="text-white">déplacer</strong> · tirez un bord pour <strong class="text-white">redimensionner</strong> (bloc de sièges : gauche/droit = sièges par rang, haut/bas = rangées) · cliquez un siège pour le <strong class="text-white">sélectionner</strong>, <strong class="text-white">Ctrl/Cmd-clic</strong> ou <strong class="text-white">Maj-clic</strong> pour en sélectionner plusieurs.
            </div>
          </div>
          <!-- Toggle propriétés (mobile) -->
          <button @click="showProps = !showProps" title="Propriétés"
            class="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200 transition"
            :class="showProps ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-600'">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
          <!-- Zoom -->
          <div class="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
            <button @click="zoomOut" class="w-6 h-6 flex items-center justify-center text-gray-600 hover:bg-white rounded-md font-bold transition">−</button>
            <button @click="zoomReset" class="px-1 h-6 flex items-center justify-center text-gray-500 hover:bg-white rounded-md text-[10px] font-semibold transition min-w-[36px]">{{ Math.round(zoom * 100) }}%</button>
            <button @click="zoomIn"  class="w-6 h-6 flex items-center justify-center text-gray-600 hover:bg-white rounded-md font-bold transition">+</button>
          </div>
        </div>
      </div>
      <p v-if="saveSuccess" class="text-xs text-green-600 bg-green-50 p-2 rounded-lg mb-2">Plan enregistré avec succès.</p>

      <!-- Panneau d'anomalies -->
      <div v-if="anomalies.length > 0" class="mb-3 rounded-xl border border-red-200 bg-red-50 overflow-hidden">
        <button class="flex items-center justify-between w-full gap-2 px-3 py-2 bg-red-100 border-b border-red-200 hover:bg-red-200 transition-colors" @click="anomaliesOpen = !anomaliesOpen">
          <span class="text-red-600 font-bold text-xs">⚠ Anomalies détectées — sauvegarde bloquée</span>
          <svg class="w-3.5 h-3.5 text-red-500 shrink-0 transition-transform" :class="anomaliesOpen ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"/></svg>
        </button>
        <ul v-if="anomaliesOpen" class="px-3 py-2 flex flex-col gap-2 max-h-40 overflow-y-auto">
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

      <!-- Barre d'actions groupées -->
      <div v-if="multiSelected.size > 0" class="mb-3 p-3 rounded-lg bg-gray-900 text-white flex items-center flex-wrap gap-2 text-xs">
        <span class="font-semibold">{{ multiSelected.size }} siège(s) sélectionné(s)</span>
        <span class="border-l border-gray-600 h-5 mx-1"></span>
        <select v-model="bulkCategoryChoice" class="px-2 py-1.5 rounded-md text-gray-800 text-xs">
          <option value="" disabled>Changer catégorie…</option>
          <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <button @click="bulkChangeCategory" :disabled="!bulkCategoryChoice" class="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 font-semibold disabled:opacity-40">Appliquer</button>
        <button @click="clearMultiSelection" class="ml-auto px-3 py-1.5 rounded-md bg-gray-700 hover:bg-gray-600 font-semibold">Tout désélectionner</button>
      </div>

      <div v-if="loading" class="text-sm text-gray-400 py-10 text-center">Chargement…</div>
      <div v-else-if="loadError" class="text-sm text-red-500 py-10 text-center">{{ loadError }}</div>

      <PreviewPlan v-else-if="showPreview"
        :categories="categories"
        :zones="zones"
        :seat-rows="seatRows"
        :free-zones="freeZones"
        :table-zones="tableZones"
        :table-sections="tableSections"
        class="flex-1 min-h-0 rounded-xl overflow-hidden"
      />

      <div v-else ref="scrollerRef"
        class="overflow-hidden rounded-xl flex-1 min-h-0 bg-gray-400 relative"
        :class="pan.active ? 'cursor-grabbing' : 'cursor-grab'"
        style="touch-action: none;"
        @wheel.prevent="onWheel"
        @pointerdown="startPan($event); showInfoTooltip = false; showCatPanel = false"
        @click="onScrollerClick"
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
              background: fz.color,
              border: `1px solid ${fz.color}55`,
              zIndex: fz.zIndex || 1,
            }"
            @pointerdown="startDrag($event, 'freeZone', fz)"
          >
            <span v-if="iconById(fz.icon).emoji" class="pointer-events-none" style="line-height:1" :style="{ fontSize: (fz.iconSize || Math.max(12, fz.height * 0.3)) + 'px' }">{{ iconById(fz.icon).emoji }}</span>
            <span class="font-bold uppercase pointer-events-none" :style="{ color: fz.textColor || '#000000', fontSize: (fz.labelFontSize || 10) + 'px' }">{{ fz.label }}</span>
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
              transform: `rotate(${t.rotation || 0}deg)`,
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
                  fontSize: (t.seatLabelFontSize || 9) + 'px',
                  background: seat.status === 'disabled' ? '#eef0f2' : catById(t.categoryId).color,
                  border: seat.status === 'disabled' ? '1px solid #d8dade' : 'none',
                  color: seat.status === 'disabled' ? '#9ca3af' : '#fff',
                  left: (tableZoneSize(t) / 2 + ((t.tableSize || 30) / 2 + (t.seatSize || 15) / 2) * Math.cos((2 * Math.PI * seat.index) / (t.seatCount || 6) - Math.PI / 2) - (t.seatSize || 15) / 2) + 'px',
                  top:  (tableZoneSize(t) / 2 + ((t.tableSize || 30) / 2 + (t.seatSize || 15) / 2) * Math.sin((2 * Math.PI * seat.index) / (t.seatCount || 6) - Math.PI / 2) - (t.seatSize || 15) / 2) + 'px',
                }"
                @pointerdown.stop
                @click.stop="onTableSeatClick(t, seat, $event)"
              >{{ seat.index + 1 }}</div>
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
                :style="{ color: catById(t.categoryId).color, fontSize: (t.tableLabelFontSize || 13) + 'px' }">
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
              height: tableSectionHeight(ts) + 'px',
              zIndex: ts.zIndex || 1,
              background: catById(ts.categoryId).color + '14',
              border: `1px solid ${catById(ts.categoryId).color}55`,
              borderRadius: '10px',
              outline: hoveredTableSection?.id === ts.id
                ? `3px dashed ${catById(ts.categoryId).color}`
                : selected && selected.kind==='tableSection' && selected.id===ts.id ? `2px solid ${catById(ts.categoryId).color}` : 'none',
              outlineOffset: '2px',
              transform: `rotate(${ts.rotation || 0}deg)`,
            }"
            @pointerdown="startDrag($event, 'tableSection', ts)"
          >
            <!-- Badge LOD centré -->
            <div v-if="itemShowBadge(ts)"
              class="lod-section-badge"
              :style="{
                color: catById(ts.categoryId).color,
                borderColor: catById(ts.categoryId).color + '55',
                fontSize: (ts.rowLabelFontSize || 10) + 'px',
              }">
              {{ ts.section || catById(ts.categoryId).name }}
            </div>

            <!-- Grille de tables : tableRows rangées × tableCount colonnes -->
            <div :class="itemShowBadge(ts) ? 'lod-blur' : ''">
              <template v-for="ri in (ts.tableRows || 1)" :key="'r' + ri">
                <template v-for="ci in (ts.tableCount || 3)" :key="'r' + ri + 'c' + ci">
                  <!-- Index global de la table (0-based) -->
                  <template v-if="!(ts.deletedTables || []).includes((ri - 1) * (ts.tableCount || 3) + (ci - 1))">
                  <template v-for="seat in tableSectionSeats(ts).filter(s => s.tableIndex === (ri - 1) * (ts.tableCount || 3) + (ci - 1))" :key="seat.tableIndex + '-' + seat.seatIndex">

                    <div
                      v-if="seat.status !== 'deleted'"
                      class="absolute flex items-center justify-center text-white font-bold rounded-full"
                      style="pointer-events: auto; cursor: pointer;"
                      :class="[
                        selected && selected.kind==='tableSectionSeat' && selected.tsId===ts.id && selected.seatInfo?.tableIndex===seat.tableIndex && selected.seatInfo?.seatIndex===seat.seatIndex ? 'ring-2 ring-offset-1 ring-gray-900' : '',
                        isMultiSelectedTableSectionSeat(ts, seat) ? 'ring-2 ring-offset-1 ring-blue-500' : '',
                      ]"
                      :style="{
                        width: (ts.seatSize || 15) + 'px', height: (ts.seatSize || 15) + 'px',
                        fontSize: (ts.seatLabelFontSize || 9) + 'px',
                        background: seat.status === 'disabled' ? '#eef0f2' : catById(ts.categoryId).color,
                        border: seat.status === 'disabled' ? '1px solid #d8dade' : 'none',
                        color: seat.status === 'disabled' ? '#9ca3af' : '#fff',
                        left: (TS_PAD + (ci - 1) * (tableSectionUnitSize(ts) + (ts.tableSpacing ?? 2)) + tableSectionUnitSize(ts) / 2 + ((ts.tableSize || 30) / 2 + (ts.seatSize || 15) / 2) * Math.cos((2 * Math.PI * seat.seatIndex) / seat.seatsCount - Math.PI / 2 + seat.rotRad) - (ts.seatSize || 15) / 2) + 'px',
                        top:  (TS_PAD + (ri - 1) * (tableSectionUnitSize(ts) + (ts.tableSpacing ?? 2)) + tableSectionUnitSize(ts) / 2 + ((ts.tableSize || 30) / 2 + (ts.seatSize || 15) / 2) * Math.sin((2 * Math.PI * seat.seatIndex) / seat.seatsCount - Math.PI / 2 + seat.rotRad) - (ts.seatSize || 15) / 2) + 'px',
                      }"
                      @pointerdown.stop
                      @click.stop="onTableSectionSeatClick(ts, seat, $event)"
                    >{{ seat.seatIndex + 1 }}</div>
                  </template>
                  <!-- Table circle (cliquable pour sélectionner la table) -->
                  <div
                    class="absolute rounded-full flex items-center justify-center cursor-pointer"
                    style="pointer-events: auto;"
                    :style="{
                      width: (ts.tableSize || 30) + 'px', height: (ts.tableSize || 30) + 'px',
                      left: (TS_PAD + (ci - 1) * (tableSectionUnitSize(ts) + (ts.tableSpacing ?? 2)) + (tableSectionUnitSize(ts) - (ts.tableSize || 30)) / 2) + 'px',
                      top:  (TS_PAD + (ri - 1) * (tableSectionUnitSize(ts) + (ts.tableSpacing ?? 2)) + (tableSectionUnitSize(ts) - (ts.tableSize || 30)) / 2) + 'px',
                      background: catById(ts.categoryId).color + '22',
                      border: selected && selected.kind === 'tableSectionTable' && selected.tsId === ts.id && selected.tableIndex === ((ri - 1) * (ts.tableCount || 3) + (ci - 1))
                        ? `3px solid ${catById(ts.categoryId).color}`
                        : `2px solid ${catById(ts.categoryId).color}88`,
                      boxShadow: selected && selected.kind === 'tableSectionTable' && selected.tsId === ts.id && selected.tableIndex === ((ri - 1) * (ts.tableCount || 3) + (ci - 1))
                        ? `0 0 0 2px #fff, 0 0 0 4px ${catById(ts.categoryId).color}`
                        : 'none',
                    }"
                    @pointerdown.stop
                    @click.stop="selectTableSectionTable(ts, (ri - 1) * (ts.tableCount || 3) + (ci - 1))"
                  >
                    <span class="font-bold text-center leading-tight pointer-events-none"
                      :style="{ color: catById(ts.categoryId).color, fontSize: (ts.tableLabelFontSize || 13) + 'px' }">
                      T{{ (ri - 1) * (ts.tableCount || 3) + ci }}
                    </span>
                  </div>
                  </template><!-- /v-if deletedTables -->
                </template>
              </template>
            </div>
            <!-- Handles de resize tableSection -->
            <div class="absolute left-4 right-4 -bottom-1 h-2 cursor-ns-resize" style="pointer-events:auto" @pointerdown.stop="startResizeTableSection($event, ts, 'bottom')"></div>
            <div class="absolute left-4 right-4 -top-1 h-2 cursor-ns-resize" style="pointer-events:auto" @pointerdown.stop="startResizeTableSection($event, ts, 'top')"></div>
            <div class="absolute top-4 bottom-4 -left-1 w-2 cursor-ew-resize" style="pointer-events:auto" @pointerdown.stop="startResizeTableSection($event, ts, 'left')"></div>
            <div class="absolute top-4 bottom-4 -right-1 w-2 cursor-ew-resize" style="pointer-events:auto" @pointerdown.stop="startResizeTableSection($event, ts, 'right')"></div>
          </div>

          <!-- Blocs de sièges nominatifs -->
          <div
            v-for="row in seatRows" :key="row.id"
            class="absolute cursor-move select-none"
            :style="{ top: row.top + 'px', left: row.left + 'px', zIndex: row.zIndex || 1 }"
            @pointerdown="startDrag($event, 'seatRow', row)"
          >
            <!-- Carte dont la couleur suit la catégorie -->
            <div class="editor-seat-card pointer-events-none" style="pointer-events:none"
              :style="{
                background: catById(row.categoryId).color + '14',
                borderColor: catById(row.categoryId).color + '55',
                outline: selected && selected.kind==='seatRow' && selected.id===row.id ? `2px solid ${catById(row.categoryId).color}` : 'none',
                outlineOffset: '2px',
                position: 'relative',
              }">
              <!-- Badge LOD centré -->
              <div v-if="itemShowBadge(row)"
                class="lod-section-badge"
                :style="{
                  color: catById(row.categoryId).color,
                  borderColor: catById(row.categoryId).color + '55',
                  fontSize: (row.rowLabelFontSize || 10) + 'px',
                }">
                {{ row.section || catById(row.categoryId).name }}
              </div>
              <div class="grid gap-1.5"
                :class="itemShowBadge(row) ? 'lod-blur' : ''"
                :style="{ gridTemplateColumns: `repeat(${row.cols}, minmax(${row.shape === 'rounded' ? (row.seatSize || 22) * 1.5 : (row.seatSize || 22)}px, auto))` }">
                <div
                  v-for="seat in seatGrid(row)" :key="seat.key"
                  class="flex items-center justify-center text-white font-semibold leading-none"
                  :class="seat.status === 'deleted' ? '' : 'cursor-pointer'"
                  :style="{
                    height: (row.seatSize || 22) + 'px',
                    minWidth: row.shape === 'rounded' ? ((row.seatSize || 22) * 1.5) + 'px' : (row.seatSize || 22) + 'px',
                    padding: row.shape === 'rounded' ? '0 6px' : '0',
                    fontSize: Math.max(6, Math.floor((row.seatSize || 22) * 0.42)) + 'px',
                    borderRadius: row.shape === 'round' ? '50%' : row.shape === 'rounded' ? '10px' : '4px',
                    visibility: seat.status === 'deleted' ? 'hidden' : 'visible',
                    background: seat.status === 'sold' ? '#9ca3af' : seat.status === 'disabled' ? '#eef0f2' : catById(seat.categoryId).color,
                    color: seat.status === 'disabled' ? '#9ca3af' : '#fff',
                    opacity: seat.status === 'sold' ? 0.55 : 1,
                    border: seat.status === 'disabled' ? '1px solid #d8dade' : 'none',
                    outline: selected && selected.kind==='seat' && selected.seatId===seat.key ? '2px solid #111' : isMultiSelected(row, seat) ? '2px solid #3b82f6' : 'none',
                    outlineOffset: '1px',
                  }"
                  style="pointer-events:auto"
                  @pointerdown.stop
                  @click.stop="seat.status !== 'deleted' && onSeatClick(row, seat, $event)"
                >{{ (row.seatSize || 22) >= 14 && seat.status !== 'deleted' ? seat.label : '' }}</div>
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
    <!-- Mobile: overlay absolu depuis le haut -->
    <!-- Desktop: colonne à droite -->
    <div
      class="bg-white rounded-2xl shadow-sm p-4 overflow-y-auto text-sm transition-all"
      :class="[
        'lg:relative lg:w-72 lg:shrink-0 lg:flex lg:flex-col',
        showProps
          ? 'absolute inset-y-0 right-0 z-20 w-64 shadow-xl lg:shadow-sm'
          : 'hidden lg:flex'
      ]"
    >
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-gray-800">Propriétés</h3>
        <button @click="showProps = false"
          class="lg:hidden w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

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
          <label class="text-xs font-semibold text-gray-500">Taille icône (px)</label>
          <input v-model="selectedFreeZone.iconSize" @input="scheduleSave" type="number" min="10" max="120" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
        <div>
          <label class="text-xs font-semibold text-gray-500">Couleur de fond</label>
          <div class="flex items-center gap-2 mt-1">
            <input v-model="selectedFreeZone.color" @input="scheduleSave" type="color" class="w-10 h-9 rounded border border-gray-200 cursor-pointer" />
            <input v-model="selectedFreeZone.color" @input="scheduleSave" type="text" class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>
        <div>
          <label class="text-xs font-semibold text-gray-500">Couleur du texte</label>
          <div class="flex items-center gap-2 mt-1">
            <input :value="selectedFreeZone.textColor || '#000000'" @input="selectedFreeZone.textColor = $event.target.value; scheduleSave()" type="color" class="w-10 h-9 rounded border border-gray-200 cursor-pointer" />
            <input :value="selectedFreeZone.textColor || '#000000'" @input="selectedFreeZone.textColor = $event.target.value; scheduleSave()" type="text" class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
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
        <div class="flex gap-2 mt-2">
          <button @click="resetFreeZone" class="flex-1 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm font-semibold hover:bg-gray-200">
            Réinitialiser
          </button>
          <button @click="removeSelected" class="flex-1 py-2 rounded-lg bg-red-50 text-red-500 text-sm font-semibold hover:bg-red-100">
            Supprimer
          </button>
        </div>
      </div>

      <!-- Propriétés d'une table individuelle dans une section -->
      <div v-else-if="selectedTableSectionTable" class="flex flex-col gap-3">
        <div>
          <p class="text-xs font-bold text-gray-700">
            Table T{{ selectedTableSectionTable.tableIndex + 1 }}
            <span class="font-normal text-gray-400 ml-1">dans {{ selectedTableSectionTable.ts.section || selectedTableSectionTable.ts.label }}</span>
          </p>
        </div>
        <div>
          <label class="text-xs font-semibold text-gray-500">Nombre de sièges</label>
          <input
            :value="(selectedTableSectionTable.ts.tableSeatsOverrides?.[selectedTableSectionTable.tableIndex] !== undefined)
              ? selectedTableSectionTable.ts.tableSeatsOverrides[selectedTableSectionTable.tableIndex]
              : (selectedTableSectionTable.ts.seatsPerTable || 6)"
            @input="updateTableSeatsCount($event.target.value)"
            type="number" min="1" max="20"
            class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </div>
        <div>
          <label class="text-xs font-semibold text-gray-500">Rotation (°)</label>
          <div class="flex items-center gap-2 mt-1">
            <input
              :value="selectedTableSectionTable.ts.tableRotationOverrides?.[selectedTableSectionTable.tableIndex] || 0"
              @input="updateTableRotation($event.target.value)"
              type="range" min="0" max="359" step="1"
              class="flex-1 accent-indigo-500" />
            <input
              :value="selectedTableSectionTable.ts.tableRotationOverrides?.[selectedTableSectionTable.tableIndex] || 0"
              @input="updateTableRotation($event.target.value)"
              type="number" min="0" max="359"
              class="w-16 px-2 py-2 border border-gray-200 rounded-lg text-sm text-center" />
          </div>
        </div>
        <div class="flex flex-col gap-2 mt-1">
          <button @click="deleteEntireTable"
            class="w-full py-2 rounded-lg bg-red-50 text-red-500 text-sm font-semibold hover:bg-red-100">
            Supprimer la table
          </button>
        </div>
        <button @click="selectTableSection(selectedTableSectionTable.ts)"
          class="text-xs text-indigo-500 hover:underline text-left">
          ← Retour à la section
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
        <div class="flex items-center justify-between">
          <label class="text-xs font-semibold text-gray-500">Afficher section</label>
          <button
            @click="selectedTableSection.badgeVisible = !selectedTableSection.badgeVisible; scheduleSave()"
            class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200"
            :class="selectedTableSection.badgeVisible ? 'bg-indigo-500' : 'bg-gray-200'"
          >
            <span class="inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200"
              :class="selectedTableSection.badgeVisible ? 'translate-x-4' : 'translate-x-0'" />
          </button>
        </div>
        <div v-if="selectedTableSection.badgeVisible">
          <label class="text-xs font-semibold text-gray-500">Taille badge (px)</label>
          <input v-model="selectedTableSection.rowLabelFontSize" @input="scheduleSave" type="number" min="6" max="24"
            class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
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
            <label class="text-xs font-semibold text-gray-500">Taille nom table (px)</label>
            <input v-model="selectedTableSection.tableLabelFontSize" @input="scheduleSave" type="number" min="6" max="24"
              class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Écart tables (px)</label>
            <input v-model="selectedTableSection.tableSpacing" @input="scheduleSave" type="number" min="0" max="100"
              class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Taille n° siège (px)</label>
            <input v-model="selectedTableSection.seatLabelFontSize" @input="scheduleSave" type="number" min="0" max="24"
              class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>
        <div>
          <label class="text-xs font-semibold text-gray-500">Rotation (°)</label>
          <div class="flex items-center gap-2 mt-1">
            <input v-model="selectedTableSection.rotation" @input="scheduleSave" type="range" min="0" max="359" step="1"
              class="flex-1 accent-indigo-500" />
            <input v-model="selectedTableSection.rotation" @input="scheduleSave" type="number" min="0" max="359"
              class="w-16 px-2 py-2 border border-gray-200 rounded-lg text-sm text-center" />
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
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-semibold text-gray-500">Taille nom table (px)</label>
            <input v-model="selectedTableZone.tableLabelFontSize" @input="scheduleSave" type="number" min="6" max="24"
              class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Taille n° siège (px)</label>
            <input v-model="selectedTableZone.seatLabelFontSize" @input="scheduleSave" type="number" min="0" max="24"
              class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>
        <div>
          <label class="text-xs font-semibold text-gray-500">Rotation (°)</label>
          <div class="flex items-center gap-2 mt-1">
            <input v-model="selectedTableZone.rotation" @input="scheduleSave" type="range" min="0" max="359" step="1"
              class="flex-1 accent-indigo-500" />
            <input v-model="selectedTableZone.rotation" @input="scheduleSave" type="number" min="0" max="359"
              class="w-16 px-2 py-2 border border-gray-200 rounded-lg text-sm text-center" />
          </div>
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
        <div class="flex items-center justify-between">
          <label class="text-xs font-semibold text-gray-500">Afficher section</label>
          <button
            @click="selectedSeatRow.badgeVisible = !selectedSeatRow.badgeVisible; scheduleSave()"
            class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200"
            :class="selectedSeatRow.badgeVisible ? 'bg-indigo-500' : 'bg-gray-200'"
          >
            <span class="inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200"
              :class="selectedSeatRow.badgeVisible ? 'translate-x-4' : 'translate-x-0'" />
          </button>
        </div>
        <div v-if="selectedSeatRow.badgeVisible">
          <label class="text-xs font-semibold text-gray-500">Taille du badge (px)</label>
          <input v-model="selectedSeatRow.rowLabelFontSize" @input="scheduleSave" type="number" min="6" max="24"
            class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
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
        <button @click="deleteSeat" class="w-full py-2 rounded-lg bg-red-50 text-red-500 text-sm font-semibold hover:bg-red-100">
          Supprimer ce siège
        </button>
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
        </dl>
        <button @click="deleteTableSectionSeat" class="w-full py-2 rounded-lg bg-red-50 text-red-500 text-sm font-semibold hover:bg-red-100">
          Supprimer ce siège
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
        </dl>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-seat-card {
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 6px;
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
.lod-blur {
  filter: blur(2px);
  opacity: 0.5;
  transition: filter 0.2s, opacity 0.2s;
  pointer-events: none;
}
.lod-section-badge {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: #fff;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 2px 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
  z-index: 3;
  white-space: nowrap;
  pointer-events: none;
}
.toast-enter-active, .toast-leave-active { transition: opacity 0.2s, transform 0.2s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
</style>
