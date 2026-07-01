<script setup>
import { ref, reactive, onMounted, watch, nextTick } from 'vue';
import MiniMap from './MiniMap.vue';
import { iconById, patternStyle } from '../services/icons';

const props = defineProps({
  categories: { type: Array, required: true },
  zones: { type: Array, required: true },
  seatZones: { type: Array, required: true },
  freeZones: { type: Array, required: true },
  activeCategory: { type: String, default: null },
  isSeatSelected: { type: Function, required: true },
});

const emit = defineEmits(['zone-click', 'seat-click']);

const CONTENT_W = 1400;
const CONTENT_H = 660;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.15;

const zoom = ref(1);
const viewportEl = ref(null);
const viewport = reactive({ left: 0, top: 0, width: CONTENT_W, height: CONTENT_H });
const panning = reactive({ active: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });

function catById(id) {
  return props.categories.find((c) => c.id === id) || { color: '#999999' };
}
function isDimmed(categoryId) {
  return props.activeCategory && props.activeCategory !== categoryId;
}

function updateViewport() {
  const el = viewportEl.value;
  if (!el) return;
  viewport.left = el.scrollLeft / zoom.value;
  viewport.top = el.scrollTop / zoom.value;
  viewport.width = el.clientWidth / zoom.value;
  viewport.height = el.clientHeight / zoom.value;
}

function setZoom(next) {
  const el = viewportEl.value;
  const prev = zoom.value;
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  if (!el) { zoom.value = clamped; return; }
  const centerX = (el.scrollLeft + el.clientWidth / 2) / prev;
  const centerY = (el.scrollTop + el.clientHeight / 2) / prev;
  zoom.value = clamped;
  nextTick(() => {
    el.scrollLeft = centerX * clamped - el.clientWidth / 2;
    el.scrollTop = centerY * clamped - el.clientHeight / 2;
    updateViewport();
  });
}

function zoomIn() { setZoom(zoom.value + ZOOM_STEP); }
function zoomOut() { setZoom(zoom.value - ZOOM_STEP); }
function zoomReset() { setZoom(1); }

function navigateTo({ x, y }) {
  const el = viewportEl.value;
  if (!el) return;
  el.scrollLeft = Math.max(0, x * zoom.value - el.clientWidth / 2);
  el.scrollTop = Math.max(0, y * zoom.value - el.clientHeight / 2);
  updateViewport();
}

function startPan(ev) {
  const el = viewportEl.value;
  if (!el) return;
  panning.active = true;
  panning.startX = ev.clientX;
  panning.startY = ev.clientY;
  panning.scrollLeft = el.scrollLeft;
  panning.scrollTop = el.scrollTop;
  window.addEventListener('pointermove', onPan);
  window.addEventListener('pointerup', stopPan);
}
function onPan(ev) {
  if (!panning.active) return;
  const el = viewportEl.value;
  if (!el) return;
  el.scrollLeft = panning.scrollLeft - (ev.clientX - panning.startX);
  el.scrollTop = panning.scrollTop - (ev.clientY - panning.startY);
  updateViewport();
}
function stopPan() {
  panning.active = false;
  window.removeEventListener('pointermove', onPan);
  window.removeEventListener('pointerup', stopPan);
}

onMounted(() => {
  updateViewport();
  window.addEventListener('resize', updateViewport);
});
watch(zoom, () => nextTick(updateViewport));
</script>

<template>
  <div class="flex-1 min-w-0 bg-white rounded-2xl shadow-sm relative" style="min-height: 640px">

    <!-- Contrôles de zoom -->
    <div class="absolute top-3 right-3 z-10 flex flex-col bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
      <button @click="zoomIn" class="w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-100 text-lg font-bold border-b border-gray-100">+</button>
      <button @click="zoomReset" class="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-gray-100 text-[10px] font-semibold border-b border-gray-100">{{ Math.round(zoom * 100) }}%</button>
      <button @click="zoomOut" class="w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-100 text-lg font-bold">−</button>
    </div>

    <div ref="viewportEl" class="overflow-auto max-w-full rounded-2xl" style="max-height: 640px; height: 640px; width: 100%; max-width: 1100px;" :class="panning.active ? 'cursor-grabbing' : ''" @scroll="updateViewport">
      <div :style="{ width: CONTENT_W * zoom + 'px', height: CONTENT_H * zoom + 'px' }">
        <div
          class="relative cursor-grab plan-canvas"
          :style="{ width: CONTENT_W + 'px', height: CONTENT_H + 'px', transform: `scale(${zoom})`, transformOrigin: '0 0' }"
          @pointerdown.self="startPan"
        >

          <!-- Zones génériques (tribunes) -->
          <div
            v-for="z in zones"
            :key="z.id"
            class="zone-block absolute rounded-lg border flex flex-col items-center justify-center text-center px-2 cursor-pointer select-none"
            :class="[isDimmed(z.categoryId) ? 'opacity-30' : '', z.shape === 'pill' ? 'rounded-full' : '']"
            :style="{
              top: z.top + 'px',
              left: z.left + 'px',
              width: z.width + 'px',
              height: z.height + 'px',
              background: catById(z.categoryId).color + '14',
              borderColor: catById(z.categoryId).color + '55',
            }"
            @click="emit('zone-click', z)"
          >
            <p class="font-bold" :style="{ color: catById(z.categoryId).color, fontSize: (z.labelFontSize || 11) + 'px' }">{{ z.label }}</p>
            <p class="text-gray-400" :style="{ fontSize: Math.max(8, (z.labelFontSize || 11) - 2) + 'px' }">{{ z.capacity }} places</p>
          </div>

          <!-- Zones libres (scène, portes, sanitaires, zones inaccessibles…) -->
          <div
            v-for="fz in freeZones"
            :key="fz.id"
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

          <!-- Blocs de sièges nominatifs -->
          <div
            v-for="sz in seatZones"
            :key="sz.id"
            class="absolute seat-block"
            :class="isDimmed(sz.categoryId) ? 'opacity-30' : ''"
            :style="{ top: sz.top + 'px', left: sz.left + 'px' }"
          >
            <!-- Badge de rangée façon billetterie (ex: R12) -->
            <div v-if="sz.blockNumber" class="row-badge" :style="{ color: catById(sz.categoryId).color }">
              R{{ sz.blockNumber }}
            </div>

            <div class="seat-block-card">
              <div class="grid gap-1.5" :style="{ gridTemplateColumns: `repeat(${sz.cols}, minmax(${sz.shape === 'rounded' ? sz.seatSize * 1.5 : sz.seatSize}px, auto))` }">
                <button
                  v-for="seat in sz.seats"
                  :key="seat.id"
                  type="button"
                  class="seat flex items-center justify-center leading-none font-semibold select-none"
                  :class="[seat.status === 'sold' || seat.status === 'disabled' ? 'sold' : '', sz.shape === 'rounded' ? 'seat-rounded' : '']"
                  :title="`Siège ${seat.label}` + (seat.status === 'sold' ? ' (vendu)' : seat.status === 'disabled' ? ' (indisponible)' : '')"
                  :style="{
                    height: sz.seatSize + 'px',
                    minWidth: sz.shape === 'rounded' ? (sz.seatSize * 1.5) + 'px' : sz.seatSize + 'px',
                    padding: sz.shape === 'rounded' ? '0 6px' : 0,
                    fontSize: Math.max(8, Math.floor(sz.seatSize * 0.4)) + 'px',
                    borderRadius: sz.shape === 'round' ? '50%' : sz.shape === 'rounded' ? '10px' : '4px',
                    color: seat.status === 'disabled' ? '#9ca3af' : '#fff',
                    background: seat.status === 'sold' ? '#9ca3af' : seat.status === 'disabled' ? '#eef0f2' : (isSeatSelected(seat.id) ? '#111827' : catById(seat.categoryId).color),
                    border: seat.status === 'disabled' ? '1px solid #d8dade' : 'none',
                  }"
                  @click="seat.status !== 'disabled' && emit('seat-click', sz, seat)"
                >{{ seat.label }}</button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>

    <MiniMap
      :categories="categories"
      :zones="zones"
      :seat-zones="seatZones"
      :content-width="CONTENT_W"
      :content-height="CONTENT_H"
      :viewport="viewport"
      @navigate="navigateTo"
    />
  </div>
</template>

<style scoped>
/* Fond "papier quadrillé" crème + carte du bloc de sièges, façon maquette fournie */
.plan-canvas {
  background-color: #fbfaf8;
  background-image: radial-gradient(#e7ddc9 1px, transparent 1px);
  background-size: 16px 16px;
}
.seat-block {
  padding-top: 14px;
}
.seat-block-card {
  background: #fffaf2;
  border: 1px solid #f3e2c7;
  border-radius: 22px;
  padding: 14px;
}
.row-badge {
  position: absolute;
  top: -4px;
  left: 50%;
  transform: translate(-50%, -50%);
  background: #fff;
  border: 1px solid #f0d9b5;
  border-radius: 999px;
  padding: 2px 12px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  z-index: 2;
}
.seat-rounded {
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}
</style>
