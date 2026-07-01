<script setup>
import { ref, watch } from 'vue';
import { adminApi } from '../services/adminApi';

const props = defineProps({
  venueId: { type: String, required: true },
  categories: { type: Array, required: true },
});
const emit = defineEmits(['changed']);

const zones = ref([]);
const loading = ref(true);
const formOpen = ref(false);
const editing = ref(null);
const blank = () => ({ label: '', categoryId: '', top: 200, left: 200, width: 200, height: 70, capacity: 50, shape: 'rect', labelFontSize: 11 });
const form = ref(blank());
const saving = ref(false);

async function load() {
  loading.value = true;
  zones.value = await adminApi.listZones(props.venueId);
  loading.value = false;
  emit('changed');
}
watch(() => props.venueId, load, { immediate: true });

function catById(id) { return props.categories.find((c) => c.id === id); }

function openCreate() {
  editing.value = null;
  form.value = { ...blank(), categoryId: props.categories[0]?.id ?? '' };
  formOpen.value = true;
}
function openEdit(z) {
  editing.value = z;
  form.value = { ...z };
  formOpen.value = true;
}

async function save() {
  if (!form.value.label.trim() || !form.value.categoryId) return;
  saving.value = true;
  const payload = {
    ...form.value,
    top: Number(form.value.top), left: Number(form.value.left),
    width: Number(form.value.width), height: Number(form.value.height),
    capacity: Number(form.value.capacity), labelFontSize: Number(form.value.labelFontSize),
  };
  if (editing.value) {
    await adminApi.updateZone(editing.value.id, payload);
  } else {
    await adminApi.createZone(props.venueId, payload);
  }
  saving.value = false;
  formOpen.value = false;
  await load();
}

async function remove(z) {
  if (!confirm(`Supprimer la zone "${z.label}" ?`)) return;
  await adminApi.deleteZone(z.id, props.venueId);
  await load();
}
</script>

<template>
  <div class="bg-white rounded-2xl shadow-sm p-5">
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-bold text-gray-800">Zones (tribunes / gradins)</h3>
      <button :disabled="categories.length===0" @click="openCreate" class="text-xs font-semibold bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 disabled:opacity-40">
        + Zone
      </button>
    </div>
    <p v-if="categories.length===0" class="text-xs text-amber-600 mb-3">Créez d'abord au moins une catégorie.</p>

    <div v-if="loading" class="text-sm text-gray-400 py-6 text-center">Chargement…</div>

    <table v-else class="w-full text-sm">
      <thead>
        <tr class="text-left text-xs text-gray-400 border-b border-gray-100">
          <th class="pb-2 font-semibold">Zone</th>
          <th class="pb-2 font-semibold">Catégorie</th>
          <th class="pb-2 font-semibold">Position / Taille</th>
          <th class="pb-2 font-semibold">Capacité</th>
          <th class="pb-2"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="z in zones" :key="z.id" class="border-b border-gray-50">
          <td class="py-2 font-semibold text-gray-700">{{ z.label }}</td>
          <td class="py-2">
            <span v-if="catById(z.categoryId)" class="inline-flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-sm" :style="{ background: catById(z.categoryId).color }"></span>
              {{ catById(z.categoryId).name }}
            </span>
          </td>
          <td class="py-2 text-xs text-gray-400">{{ z.top }},{{ z.left }} · {{ z.width }}×{{ z.height }}</td>
          <td class="py-2 text-gray-500">{{ z.capacity }}</td>
          <td class="py-2 text-right">
            <button @click="openEdit(z)" class="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 text-xs mr-1">✎</button>
            <button @click="remove(z)" class="w-7 h-7 rounded bg-red-50 hover:bg-red-100 text-red-500 text-xs">✕</button>
          </td>
        </tr>
        <tr v-if="zones.length === 0">
          <td colspan="5" class="py-6 text-center text-gray-400">Aucune zone. Ajoutez-en une.</td>
        </tr>
      </tbody>
    </table>

    <!-- Modale -->
    <div v-if="formOpen" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50" @click.self="formOpen = false">
      <div class="bg-white rounded-2xl p-6 w-96 shadow-xl max-h-[90vh] overflow-auto">
        <p class="font-bold text-gray-800 mb-4">{{ editing ? 'Modifier la zone' : 'Nouvelle zone' }}</p>

        <label class="text-xs font-semibold text-gray-500">Nom de la zone</label>
        <input v-model="form.label" type="text" placeholder="Ex: Tribune Nord"
          class="w-full mt-1 mb-3 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400" />

        <label class="text-xs font-semibold text-gray-500">Catégorie</label>
        <select v-model="form.categoryId" class="w-full mt-1 mb-3 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400">
          <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>

        <label class="text-xs font-semibold text-gray-500">Forme</label>
        <select v-model="form.shape" class="w-full mt-1 mb-3 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400">
          <option value="rect">Rectangle</option>
          <option value="pill">Arrondie (pill)</option>
        </select>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs font-semibold text-gray-500">Position X (left)</label>
            <input v-model="form.left" type="number" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Position Y (top)</label>
            <input v-model="form.top" type="number" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Largeur</label>
            <input v-model="form.width" type="number" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Hauteur</label>
            <input v-model="form.height" type="number" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>

        <label class="text-xs font-semibold text-gray-500">Capacité (places)</label>
        <input v-model="form.capacity" type="number" min="1"
          class="w-full mt-1 mb-3 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400" />

        <label class="text-xs font-semibold text-gray-500">Taille de police du libellé (px)</label>
        <input v-model="form.labelFontSize" type="number" min="6" max="24"
          class="w-full mt-1 mb-4 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400" />

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
