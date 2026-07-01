<script setup>
import { ref, watch } from 'vue';
import { adminApi } from '../services/adminApi';

const props = defineProps({ venueId: { type: String, required: true } });
const emit = defineEmits(['changed']);

const categories = ref([]);
const loading = ref(true);
const formOpen = ref(false);
const editing = ref(null);
const form = ref({ name: '', color: '#2554c7' });
const saving = ref(false);
const errorMsg = ref('');

async function load() {
  loading.value = true;
  categories.value = await adminApi.listCategories(props.venueId);
  loading.value = false;
  emit('changed');
}
watch(() => props.venueId, load, { immediate: true });

function openCreate() {
  editing.value = null;
  form.value = { name: '', color: '#2554c7' };
  formOpen.value = true;
}
function openEdit(c) {
  editing.value = c;
  form.value = { name: c.name, color: c.color };
  formOpen.value = true;
}

async function save() {
  if (!form.value.name.trim()) return;
  saving.value = true;
  const payload = { ...form.value, name: form.value.name.toUpperCase() };
  if (editing.value) {
    await adminApi.updateCategory(editing.value.id, payload, props.venueId, editing.value.key);
  } else {
    await adminApi.createCategory(props.venueId, payload);
  }
  saving.value = false;
  formOpen.value = false;
  await load();
}

async function remove(c) {
  errorMsg.value = '';
  if (!confirm(`Supprimer la catégorie "${c.name}" ?`)) return;
  try {
    await adminApi.deleteCategory(c.id, props.venueId, c.key);
    await load();
  } catch (e) {
    errorMsg.value = e.message;
  }
}
</script>

<template>
  <div class="bg-white rounded-2xl shadow-sm p-5">
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-bold text-gray-800">Catégories</h3>
      <button @click="openCreate" class="text-xs font-semibold bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700">
        + Catégorie
      </button>
    </div>

    <p v-if="errorMsg" class="text-xs text-red-500 mb-3">{{ errorMsg }}</p>
    <div v-if="loading" class="text-sm text-gray-400 py-6 text-center">Chargement…</div>

    <table v-else class="w-full text-sm">
      <thead>
        <tr class="text-left text-xs text-gray-400 border-b border-gray-100">
          <th class="pb-2 font-semibold">Couleur</th>
          <th class="pb-2 font-semibold">Nom</th>
          <th class="pb-2"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in categories" :key="c.id" class="border-b border-gray-50">
          <td class="py-2"><span class="inline-block w-4 h-4 rounded" :style="{ background: c.color }"></span></td>
          <td class="py-2 font-semibold text-gray-700">{{ c.name }}</td>
          <td class="py-2 text-right">
            <button @click="openEdit(c)" class="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 text-xs mr-1">✎</button>
            <button @click="remove(c)" class="w-7 h-7 rounded bg-red-50 hover:bg-red-100 text-red-500 text-xs">✕</button>
          </td>
        </tr>
        <tr v-if="categories.length === 0">
          <td colspan="4" class="py-6 text-center text-gray-400">Aucune catégorie. Ajoutez-en une.</td>
        </tr>
      </tbody>
    </table>

    <!-- Modale -->
    <div v-if="formOpen" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50" @click.self="formOpen = false">
      <div class="bg-white rounded-2xl p-6 w-80 shadow-xl">
        <p class="font-bold text-gray-800 mb-4">{{ editing ? 'Modifier la catégorie' : 'Nouvelle catégorie' }}</p>

        <label class="text-xs font-semibold text-gray-500">Nom</label>
        <input v-model="form.name" type="text" placeholder="Ex: GOLD"
          class="w-full mt-1 mb-3 px-3 py-2 border border-gray-200 rounded-lg text-sm uppercase focus:outline-none focus:border-gray-400" />

        <label class="text-xs font-semibold text-gray-500">Couleur</label>
        <div class="flex items-center gap-2 mt-1 mb-3">
          <input v-model="form.color" type="color" class="w-10 h-9 rounded border border-gray-200 cursor-pointer" />
          <input v-model="form.color" type="text" class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400" />
        </div>

        <div class="flex gap-2">
          <button @click="formOpen = false" class="flex-1 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200">Annuler</button>
          <button :disabled="saving" @click="save" class="flex-1 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 disabled:opacity-50">
            {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
