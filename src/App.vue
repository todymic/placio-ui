<script setup>
import { ref, onMounted, reactive } from 'vue';
import { venueApi } from './services/mockApi';
import { useCart } from './composables/useCart';

import CategoryLegend from './components/CategoryLegend.vue';
import VenuePlan from './components/VenuePlan.vue';
import CartPanel from './components/CartPanel.vue';
import QtyModal from './components/modals/QtyModal.vue';
import CheckoutModal from './components/modals/CheckoutModal.vue';

const loading = ref(true);
const categories = ref([]);
const zones = ref([]);
const seatZones = ref([]);
const freeZones = ref([]);
const activeCategory = ref(null);

const {
  cart, total, totalSeats,
  addZone, isSeatSelected, toggleSeat,
  removeItem, incQty, decQty, clear,
} = useCart(categories);

const qtyModal = reactive({ open: false, zone: null });
const checkout = reactive({ open: false, status: 'idle', error: '', result: null });

function catById(id) {
  return categories.value.find((c) => c.id === id);
}

async function loadVenue() {
  loading.value = true;
  const data = await venueApi.fetchVenue();
  categories.value = data.categories;
  zones.value = data.zones;
  freeZones.value = data.freeZones;
  seatZones.value = data.seatZones;
  loading.value = false;
}
onMounted(loadVenue);

function toggleCategory(id) {
  activeCategory.value = activeCategory.value === id ? null : id;
}

function openZoneModal(zone) {
  qtyModal.zone = zone;
  qtyModal.open = true;
}
function confirmZoneQty(qty) {
  addZone(qtyModal.zone, qty);
  qtyModal.open = false;
}

async function submitReservation() {
  checkout.open = true;
  checkout.status = 'loading';
  checkout.error = '';
  try {
    const res = await venueApi.reserve({ items: cart.items, total: total.value });
    checkout.status = 'success';
    checkout.result = res;
    clear();
  } catch (e) {
    checkout.status = 'error';
    checkout.error = e.message;
  }
}
function closeCheckout() {
  checkout.open = false;
  checkout.status = 'idle';
  checkout.result = null;
}
</script>

<template>
  <div class="min-h-screen pb-10">

    <CategoryLegend
      v-if="!loading"
      :categories="categories"
      :active-category="activeCategory"
      @toggle="toggleCategory"
    />

    <div v-if="loading" class="flex flex-col items-center justify-center py-32 text-gray-400 gap-3">
      <div class="w-8 h-8 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin"></div>
      <p class="text-sm">Chargement du plan de salle…</p>
    </div>

    <div v-else class="flex flex-col lg:flex-row gap-4 px-4 pt-4">
      <VenuePlan
        :categories="categories"
        :zones="zones"
        :seat-zones="seatZones"
        :free-zones="freeZones"
        :active-category="activeCategory"
        :is-seat-selected="isSeatSelected"
        @zone-click="openZoneModal"
        @seat-click="toggleSeat"
      />

      <CartPanel
        :categories="categories"
        :items="cart.items"
        :total="total"
        :total-seats="totalSeats"
        @inc="incQty"
        @dec="decQty"
        @remove="removeItem"
        @submit="submitReservation"
      />
    </div>

    <QtyModal
      v-if="qtyModal.open"
      :zone="qtyModal.zone"
      :category="catById(qtyModal.zone.categoryId)"
      @confirm="confirmZoneQty"
      @close="qtyModal.open = false"
    />

    <CheckoutModal
      v-if="checkout.open"
      :status="checkout.status"
      :error="checkout.error"
      :result="checkout.result"
      @close="closeCheckout"
    />

  </div>
</template>
