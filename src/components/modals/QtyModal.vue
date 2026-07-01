<script setup>
import { ref, watch } from 'vue';
import { formatPrice } from '../../services/format';

const props = defineProps({
  zone: { type: Object, required: true },
  category: { type: Object, required: true },
});

const emit = defineEmits(['confirm', 'close']);

const qty = ref(1);

// Réinitialise la quantité à chaque ouverture sur une nouvelle zone
watch(() => props.zone, () => { qty.value = 1; });
</script>

<template>
  <div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50" @click.self="emit('close')">
    <div class="bg-white rounded-2xl p-6 w-72 shadow-xl">
      <p class="font-bold text-gray-800">{{ zone.label }}</p>
      <p class="text-xs text-gray-400 mb-4">{{ category.name }} · {{ formatPrice(category.price) }} / place</p>

      <div class="flex items-center justify-center gap-4 mb-5">
        <button @click="qty = Math.max(1, qty - 1)" class="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 text-lg">−</button>
        <span class="text-lg font-bold w-8 text-center">{{ qty }}</span>
        <button @click="qty++" class="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 text-lg">+</button>
      </div>

      <button
        @click="emit('confirm', qty)"
        class="w-full py-2 rounded-lg bg-gray-900 text-white font-semibold text-sm hover:bg-gray-700"
      >
        Ajouter au panier
      </button>
    </div>
  </div>
</template>
