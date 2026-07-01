<script setup>
import { formatPrice } from '../../services/format';

defineProps({
  status: { type: String, required: true }, // 'loading' | 'success' | 'error'
  error: { type: String, default: '' },
  result: { type: Object, default: null },
});

const emit = defineEmits(['close']);
</script>

<template>
  <div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
    <div class="bg-white rounded-2xl p-7 w-80 shadow-xl text-center">

      <div v-if="status === 'loading'">
        <div class="w-8 h-8 mx-auto border-2 border-gray-200 border-t-gray-700 rounded-full animate-spin mb-4"></div>
        <p class="text-sm font-semibold text-gray-700">Traitement de la réservation…</p>
      </div>

      <div v-else-if="status === 'success'">
        <div class="w-12 h-12 mx-auto rounded-full bg-green-50 flex items-center justify-center text-green-500 text-xl mb-3">✓</div>
        <p class="font-bold text-gray-800">Réservation confirmée</p>
        <p class="text-xs text-gray-400 mt-1">Réf. {{ result.reservationId }}</p>
        <p class="text-sm font-semibold text-gray-700 mt-3">{{ formatPrice(result.total) }}</p>
        <button @click="emit('close')" class="w-full mt-5 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700">
          Fermer
        </button>
      </div>

      <div v-else-if="status === 'error'">
        <div class="w-12 h-12 mx-auto rounded-full bg-red-50 flex items-center justify-center text-red-500 text-xl mb-3">!</div>
        <p class="font-bold text-gray-800">Échec de la réservation</p>
        <p class="text-xs text-gray-400 mt-1">{{ error }}</p>
        <button @click="emit('close')" class="w-full mt-5 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200">
          Fermer
        </button>
      </div>

    </div>
  </div>
</template>
