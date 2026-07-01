<script setup>
import { formatPrice } from '../services/format';

const props = defineProps({
  categories: { type: Array, required: true },
  items: { type: Array, required: true },
  total: { type: Number, required: true },
  totalSeats: { type: Number, required: true },
});

const emit = defineEmits(['inc', 'dec', 'remove', 'submit']);

function catById(id) {
  return props.categories.find((c) => c.id === id);
}
</script>

<template>
  <div class="w-full lg:w-80 shrink-0">
    <div class="bg-white rounded-2xl shadow-sm p-5 sticky top-20">
      <h3 class="font-bold text-gray-800 mb-3">Votre sélection</h3>

      <div v-if="items.length === 0" class="text-sm text-gray-400 py-6 text-center">
        Cliquez sur une zone ou un siège pour commencer.
      </div>

      <div v-else class="flex flex-col gap-3 max-h-80 overflow-auto pr-1">
        <div
          v-for="item in items"
          :key="item.key"
          class="flex items-center justify-between gap-2 text-sm border-b border-gray-100 pb-2"
        >
          <div class="min-w-0">
            <p class="font-semibold text-gray-700 truncate">{{ item.label }}</p>
            <p class="text-xs" :style="{ color: catById(item.categoryId).color }">
              {{ catById(item.categoryId).name }} · {{ formatPrice(item.price) }}
            </p>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button v-if="item.type === 'zone'" @click="emit('dec', item)" class="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 text-gray-600">−</button>
            <span class="w-5 text-center text-xs font-semibold">{{ item.qty }}</span>
            <button v-if="item.type === 'zone'" @click="emit('inc', item)" class="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 text-gray-600">+</button>
            <button v-if="item.type === 'seat'" @click="emit('remove', item.key)" class="w-6 h-6 rounded bg-red-50 hover:bg-red-100 text-red-500 text-xs">✕</button>
          </div>
        </div>
      </div>

      <div class="border-t border-gray-100 mt-4 pt-3 flex items-center justify-between">
        <span class="text-sm text-gray-500">{{ totalSeats }} place(s)</span>
        <span class="font-bold text-gray-800">{{ formatPrice(total) }}</span>
      </div>

      <button
        :disabled="items.length === 0"
        @click="emit('submit')"
        class="w-full mt-4 py-2.5 rounded-lg font-semibold text-sm transition"
        :class="items.length === 0 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gray-900 text-white hover:bg-gray-700'"
      >
        Réserver
      </button>
    </div>
  </div>
</template>
