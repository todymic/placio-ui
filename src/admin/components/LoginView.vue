<script setup>
import { ref } from 'vue';
import { auth } from '../services/auth.js';

const emit = defineEmits(['logged-in']);

const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    await auth.login(email.value, password.value);
    emit('logged-in');
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50">
    <div class="bg-white rounded-2xl shadow-sm p-8 w-full max-w-sm">
      <h1 class="text-xl font-bold text-gray-800 mb-1">Back-office</h1>
      <p class="text-xs text-gray-400 mb-6">Connectez-vous pour gérer les plans</p>

      <p v-if="error" class="text-xs text-red-500 mb-4 bg-red-50 p-2 rounded-lg">{{ error }}</p>

      <label class="text-xs font-semibold text-gray-500">Email</label>
      <input
        v-model="email" type="email" placeholder="admin@example.com"
        @keyup.enter="submit"
        class="w-full mt-1 mb-3 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
      />

      <label class="text-xs font-semibold text-gray-500">Mot de passe</label>
      <input
        v-model="password" type="password" placeholder="••••••••"
        @keyup.enter="submit"
        class="w-full mt-1 mb-5 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
      />

      <button
        :disabled="loading"
        @click="submit"
        class="w-full py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 disabled:opacity-50"
      >
        {{ loading ? 'Connexion…' : 'Se connecter' }}
      </button>
    </div>
  </div>
</template>
