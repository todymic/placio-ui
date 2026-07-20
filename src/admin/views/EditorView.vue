<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { adminApi } from '../services/adminApi.js';
import PlanEditor from '../components/PlanEditor.vue';

const route  = useRoute();

const planId  = computed(() => route.params.id);
const isEmbed = computed(() => route.query.embed === 'true');
const plan    = ref(null);

const STATUS_LABELS = { draft: 'Brouillon', published: 'Publié', archived: 'Archivé' };
const STATUS_COLORS = { draft: 'bg-yellow-100 text-yellow-700', published: 'bg-green-100 text-green-700', archived: 'bg-gray-100 text-gray-500' };

async function loadPlan() {
  const plans = await adminApi.listVenues();
  plan.value = plans.find(p => p.id === planId.value) || null;
}

async function onChildChanged() {
  await loadPlan();
}

onMounted(loadPlan);
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- Breadcrumb -->
    <div v-if="!isEmbed" class="px-6 pt-4 pb-3 shrink-0 bg-gray-100 border-b border-gray-200">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <router-link to="/plans" class="flex items-center gap-1 text-indigo-600 hover:underline shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
          </svg>
          Plans
        </router-link>
        <span class="text-gray-400">/</span>
        <span class="font-semibold text-gray-800 truncate max-w-[160px] sm:max-w-none">{{ plan?.name || '…' }}</span>
        <span v-if="plan" :class="STATUS_COLORS[plan.status || 'draft']" class="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0">
          {{ STATUS_LABELS[plan.status || 'draft'] }}
        </span>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 min-h-0 overflow-hidden p-2">
      <PlanEditor
        :venue-id="planId"
        :plan-status="plan?.status || 'draft'"
        :plan-pending-changes="plan?.pendingChanges || false"
        :plan-name="plan?.name || ''"
        @changed="onChildChanged"
        class="h-full"
      />
    </div>
  </div>
</template>
