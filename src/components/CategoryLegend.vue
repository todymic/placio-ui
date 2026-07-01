<script setup>
import { formatPrice } from '../services/format';

const props = defineProps({
  categories: { type: Array, required: true },
  activeCategory: { type: String, default: null },
});

const emit = defineEmits(['toggle']);
</script>

<template>
  <div class="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 py-3 flex gap-2 overflow-x-auto">
    <button
      v-for="c in categories"
      :key="c.id"
      @click="emit('toggle', c.id)"
      class="flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold whitespace-nowrap transition"
      :class="activeCategory === c.id ? 'border-current shadow-sm' : 'border-gray-200 text-gray-700'"
      :style="activeCategory === c.id ? { color: c.color } : {}"
    >
      <span class="w-3.5 h-3.5 rounded-sm" :style="{ background: c.color }"></span>
      {{ c.name }}
      <span class="font-normal text-gray-400">{{ formatPrice(c.price) }}</span>
    </button>
  </div>
</template>
