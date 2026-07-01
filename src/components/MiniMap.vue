<script setup>
import { ref } from 'vue';

const props = defineProps({
  categories: { type: Array, required: true },
  zones: { type: Array, required: true },
  seatZones: { type: Array, required: true },
  contentWidth: { type: Number, default: 1400 },
  contentHeight: { type: Number, default: 660 },
  viewport: { type: Object, required: true }, // { left, top, width, height } en coordonnées du plan (px non zoomés)
});
const emit = defineEmits(['navigate']);

const MAP_W = 170;
const MAP_H = 95;
const mapBoxRef = ref(null);

function scaleX(v) { return (v / props.contentWidth) * MAP_W; }
function scaleY(v) { return (v / props.contentHeight) * MAP_H; }

function catById(id) {
  return props.categories.find((c) => c.id === id) || { color: '#999999' };
}

function clientToContent(ev) {
  const rect = mapBoxRef.value.getBoundingClientRect();
  const ratioX = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
  const ratioY = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
  return { x: ratioX * props.contentWidth, y: ratioY * props.contentHeight };
}

let dragging = false;

function onMapPointerDown(ev) {
  ev.preventDefault();
  dragging = true;
  ev.target.setPointerCapture(ev.pointerId);
  emit('navigate', clientToContent(ev));
}
function onMapPointerMove(ev) {
  if (!dragging) return;
  emit('navigate', clientToContent(ev));
}
function onMapPointerUp() {
  dragging = false;
}
</script>

<template>
  <div class="absolute bottom-3 right-3 bg-white/95 backdrop-blur border border-gray-200 rounded-xl shadow-lg p-2 select-none">
    <p class="text-[9px] font-bold text-gray-400 tracking-wide mb-1 px-0.5">VUE D'ENSEMBLE</p>
    <div
      ref="mapBoxRef"
      class="relative bg-[#EBEFF5] rounded-md overflow-hidden cursor-crosshair"
      :style="{ width: MAP_W + 'px', height: MAP_H + 'px' }"
      @pointerdown="onMapPointerDown"
      @pointermove="onMapPointerMove"
      @pointerup="onMapPointerUp"
    >
      <div
        v-for="z in zones" :key="'mz-' + z.id"
        class="absolute rounded-sm"
        :style="{
          left: scaleX(z.left) + 'px', top: scaleY(z.top) + 'px',
          width: Math.max(2, scaleX(z.width)) + 'px', height: Math.max(2, scaleY(z.height)) + 'px',
          background: catById(z.categoryId).color,
        }"
      ></div>
      <div
        v-for="sz in seatZones" :key="'msz-' + sz.id"
        class="absolute rounded-sm"
        :style="{
          left: scaleX(sz.left) + 'px', top: scaleY(sz.top) + 'px',
          width: Math.max(2, scaleX(sz.cols * (sz.seatSize + 4))) + 'px',
          height: Math.max(2, scaleY(sz.rows * (sz.seatSize + 4))) + 'px',
          background: catById(sz.categoryId).color,
        }"
      ></div>

      <!-- Rectangle de viewport (zone actuellement visible) -->
      <div
        class="absolute border-2 border-red-500 bg-red-500/10 rounded-[2px] pointer-events-none"
        :style="{
          left: scaleX(viewport.left) + 'px', top: scaleY(viewport.top) + 'px',
          width: Math.min(MAP_W * 0.35, scaleX(viewport.width)) + 'px',
          height: Math.min(MAP_H * 0.35, scaleY(viewport.height)) + 'px',
        }"
      ></div>
    </div>
  </div>
</template>
