<script setup>
import { ref, onMounted } from 'vue';
import { adminApi } from '../services/adminApi';

const props = defineProps({ selectedId: { type: String, default: null } });
const emit = defineEmits(['select']);

const venues = ref([]);
const loading = ref(true);
const formOpen = ref(false);
const editing = ref(null);
const form = ref({ name: '', description: '' });
const saving = ref(false);

async function load() {
  loading.value = true;
  venues.value = await adminApi.listVenues();
  loading.value = false;
  if (!props.selectedId && venues.value.length) emit('select', venues.value[0].id);
}
onMounted(load);

function openCreate() {
  editing.value = null;
  form.value = { name: '', description: '' };
  formOpen.value = true;
}
function openEdit(v) {
  editing.value = v;
  form.value = { name: v.name, description: v.description };
  formOpen.value = true;
}

async function save() {
  if (!form.value.name.trim()) return;
  saving.value = true;
  if (editing.value) {
    await adminApi.updateVenue(editing.value.id, form.value);
  } else {
    const created = await adminApi.createVenue(form.value);
    emit('select', created.id);
  }
  saving.value = false;
  formOpen.value = false;
  await load();
}

async function remove(v) {
  if (!confirm(`Supprimer la salle "${v.name}" et tout son plan (zones, catégories, rangées) ?`)) return;
  await adminApi.deleteVenue(v.id);
  await load();
  if (props.selectedId === v.id) {
    emit('select', venues.value[0]?.id ?? null);
  }
}
</script>

<template>
  <div class="bg-white rounded-2xl shadow-sm p-5">
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-bold text-gray-800">Salles</h3>
      <button @click="openCreate" class="text-xs font-semibold bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700">
        + Nouvelle salle
      </button>
    </div>

    <div v-if="loading" class="text-sm text-gray-400 py-6 text-center">Chargement…</div>

    <ul v-else class="flex flex-col gap-2">
      <li
        v-for="v in venues"
        :key="v.id"
        @click="emit('select', v.id)"
        class="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border cursor-pointer text-sm"
        :class="selectedId === v.id ? 'border-gray-900 bg-gray-50' : 'border-gray-100 hover:border-gray-300'"
      >
        <div class="min-w-0">
          <p class="font-semibold text-gray-700 truncate">{{ v.name }}</p>
          <p class="text-xs text-gray-400 truncate">{{ v.slug }}</p>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button @click.stop="openEdit(v)" class="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 text-xs">✎</button>
          <button @click.stop="remove(v)" class="w-7 h-7 rounded bg-red-50 hover:bg-red-100 text-red-500 text-xs">✕</button>
        </div>
      </li>
      <li v-if="venues.length === 0" class="text-sm text-gray-400 text-center py-4">Aucune salle pour le moment.</li>
    </ul>

    <!-- Modale création/édition -->
    <div v-if="formOpen" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50" @click.self="formOpen = false">
      <div class="bg-white rounded-2xl p-6 w-80 shadow-xl">
        <p class="font-bold text-gray-800 mb-4">{{ editing ? 'Modifier la salle' : 'Nouvelle salle' }}</p>
        <label class="text-xs font-semibold text-gray-500">Nom</label>
        <input v-model="form.name" type="text" placeholder="Ex: Stade Barea"
          class="w-full mt-1 mb-3 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400" />
        <label class="text-xs font-semibold text-gray-500">Description</label>
        <textarea v-model="form.description" rows="2" placeholder="Ex: Stade municipal — 12 000 places"
          class="w-full mt-1 mb-4 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"></textarea>
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
