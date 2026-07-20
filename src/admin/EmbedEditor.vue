<script setup>
import { ref, onMounted } from 'vue';
import { auth } from './services/auth.js';
import PlanEditor from './components/PlanEditor.vue';
import { adminApi } from './services/adminApi.js';

const planId = new URLSearchParams(window.location.search).get('planId');

const ready = ref(false);
const error = ref('');
const plan = ref(null);

onMounted(async () => {
  if (!planId) { error.value = "Paramètre planId manquant dans l'URL"; return; }
  if (!auth.isLoggedIn()) { error.value = 'Non authentifié (token manquant)'; return; }
  try {
    const venues = await adminApi.listVenues();
    plan.value = venues.find(p => p.id === planId) || null;
    ready.value = true;
  } catch (e) {
    error.value = e.message || 'Erreur de chargement';
  }
});
</script>

<template>
  <div style="height:100vh;display:flex;flex-direction:column;background:#fff;font-family:sans-serif;">
    <div v-if="error" style="padding:24px;color:#e53e3e;">{{ error }}</div>
    <div v-else-if="!ready" style="display:flex;align-items:center;justify-content:center;flex:1;color:#888;">
      Chargement…
    </div>
    <PlanEditor
      v-else
      :venue-id="planId"
      :plan-status="plan?.status || 'draft'"
      :plan-pending-changes="plan?.pendingChanges || false"
      :plan-name="plan?.name || ''"
      style="flex:1;min-height:0;"
    />
  </div>
</template>
