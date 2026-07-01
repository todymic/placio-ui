<script setup>
import { ref, watch } from 'vue';
import { adminApi } from '../services/adminApi';
import { ROW_FORMATS, COL_FORMATS, DIRECTIONS } from '../../services/seatLabel';

const props = defineProps({
  venueId: { type: String, required: true },
  categories: { type: Array, required: true },
});
const emit = defineEmits(['changed']);

const seatRows = ref([]);
const loading = ref(true);
const formOpen = ref(false);
const editing = ref(null);
const blank = () => ({
  label: '', categoryId: '', top: 200, left: 200, rows: 4, cols: 9, shape: 'square', seatSize: 18,
  rowFormat: 'A-Z', rowDirection: 'normal', colFormat: '1-9', colDirection: 'normal',
});
const form = ref(blank());
const saving = ref(false);

async function load() {
  loading.value = true;
  seatRows.value = await adminApi.listSeatRows(props.venueId);
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
function openEdit(r) {
  editing.value = r;
  form.value = { ...r };
  formOpen.value = true;
}

async function save() {
  if (!form.value.label.trim() || !form.value.categoryId) return;
  saving.value = true;
  const payload = {
    ...form.value,
    top: Number(form.value.top), left: Number(form.value.left),
    rows: Number(form.value.rows), cols: Number(form.value.cols),
    seatSize: Number(form.value.seatSize),
  };
  if (editing.value) {
    await adminApi.updateSeatRow(editing.value.id, payload);
  } else {
    await adminApi.createSeatRow(props.venueId, payload);
  }
  saving.value = false;
  formOpen.value = false;
  await load();
}

async function remove(r) {
  if (!confirm(`Supprimer le bloc "${r.label}" (${r.rows * r.cols} sièges) ?`)) return;
  await adminApi.deleteSeatRow(r.id, props.venueId);
  await load();
}
</script>

<template>
  <div class="bg-white rounded-2xl shadow-sm p-5">
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-bold text-gray-800">Rangées de sièges nominatifs</h3>
      <button :disabled="categories.length===0" @click="openCreate" class="text-xs font-semibold bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 disabled:opacity-40">
        + Bloc de sièges
      </button>
    </div>
    <p v-if="categories.length===0" class="text-xs text-amber-600 mb-3">Créez d'abord au moins une catégorie.</p>

    <div v-if="loading" class="text-sm text-gray-400 py-6 text-center">Chargement…</div>

    <table v-else class="w-full text-sm">
      <thead>
        <tr class="text-left text-xs text-gray-400 border-b border-gray-100">
          <th class="pb-2 font-semibold">Bloc</th>
          <th class="pb-2 font-semibold">Catégorie</th>
          <th class="pb-2 font-semibold">Rangs × Sièges</th>
          <th class="pb-2 font-semibold">Forme / Taille</th>
          <th class="pb-2 font-semibold">Total sièges</th>
          <th class="pb-2"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in seatRows" :key="r.id" class="border-b border-gray-50">
          <td class="py-2 font-semibold text-gray-700">{{ r.label }}</td>
          <td class="py-2">
            <span v-if="catById(r.categoryId)" class="inline-flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-sm" :style="{ background: catById(r.categoryId).color }"></span>
              {{ catById(r.categoryId).name }}
            </span>
          </td>
          <td class="py-2 text-gray-500">{{ r.rows }} × {{ r.cols }}</td>
          <td class="py-2 text-gray-500">{{ r.shape === 'round' ? 'Rond' : 'Carré' }} · {{ r.seatSize }}px</td>
          <td class="py-2 text-gray-500">{{ r.rows * r.cols }}</td>
          <td class="py-2 text-right">
            <button @click="openEdit(r)" class="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 text-xs mr-1">✎</button>
            <button @click="remove(r)" class="w-7 h-7 rounded bg-red-50 hover:bg-red-100 text-red-500 text-xs">✕</button>
          </td>
        </tr>
        <tr v-if="seatRows.length === 0">
          <td colspan="6" class="py-6 text-center text-gray-400">Aucun bloc de sièges. Ajoutez-en un.</td>
        </tr>
      </tbody>
    </table>

    <!-- Modale -->
    <div v-if="formOpen" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50" @click.self="formOpen = false">
      <div class="bg-white rounded-2xl p-6 w-96 shadow-xl max-h-[90vh] overflow-auto">
        <p class="font-bold text-gray-800 mb-4">{{ editing ? 'Modifier le bloc' : 'Nouveau bloc de sièges' }}</p>

        <label class="text-xs font-semibold text-gray-500">Nom du bloc</label>
        <input v-model="form.label" type="text" placeholder="Ex: Signature Gauche"
          class="w-full mt-1 mb-3 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400" />

        <label class="text-xs font-semibold text-gray-500">Catégorie</label>
        <select v-model="form.categoryId" class="w-full mt-1 mb-3 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400">
          <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
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
            <label class="text-xs font-semibold text-gray-500">Nombre de rangs</label>
            <input v-model="form.rows" type="number" min="1" max="40" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Sièges par rang</label>
            <input v-model="form.cols" type="number" min="1" max="60" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs font-semibold text-gray-500">Forme des sièges</label>
            <select v-model="form.shape" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm">
              <option value="square">Carré</option>
              <option value="round">Rond</option>
            </select>
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500">Taille des sièges (px)</label>
            <input v-model="form.seatSize" type="number" min="10" max="40" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>

        <p class="text-xs text-gray-400 mb-3">
          Ce bloc générera <strong>{{ Number(form.rows) * Number(form.cols) || 0 }}</strong> sièges individuels.
        </p>

        <div class="border-t border-gray-100 pt-3 mb-3">
          <p class="text-xs font-bold text-gray-700 mb-2">Nommage des rangées</p>
          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="text-[11px] text-gray-500">Format</label>
              <select v-model="form.rowFormat" class="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs">
                <option v-for="f in ROW_FORMATS" :key="f.id" :value="f.id">{{ f.label }}</option>
              </select>
            </div>
            <div>
              <label class="text-[11px] text-gray-500">Sens</label>
              <select v-model="form.rowDirection" class="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs">
                <option v-for="d in DIRECTIONS" :key="d.id" :value="d.id">{{ d.label }}</option>
              </select>
            </div>
          </div>

          <p class="text-xs font-bold text-gray-700 mb-2">Nommage des colonnes</p>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-[11px] text-gray-500">Format</label>
              <select v-model="form.colFormat" class="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs">
                <option v-for="f in COL_FORMATS" :key="f.id" :value="f.id">{{ f.label }}</option>
              </select>
            </div>
            <div>
              <label class="text-[11px] text-gray-500">Sens</label>
              <select v-model="form.colDirection" class="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs">
                <option v-for="d in DIRECTIONS" :key="d.id" :value="d.id">{{ d.label }}</option>
              </select>
            </div>
          </div>
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
