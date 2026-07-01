import { reactive, computed } from 'vue';

// État réactif partagé entre tous les composants qui importent ce composable
// (pattern "store léger" sans dépendre de Pinia/Vuex).
const cart = reactive({ items: [] });

export function useCart(categoriesRef) {
  function catById(id) {
    return categoriesRef.value.find((c) => c.id === id);
  }

  function addZone(zone, qty) {
    const existing = cart.items.find((i) => i.type === 'zone' && i.refId === zone.id);
    if (existing) {
      existing.qty += qty;
    } else {
      cart.items.push({
        key: `zone-${zone.id}-${Date.now()}`,
        type: 'zone',
        refId: zone.id,
        label: zone.label,
        categoryId: zone.categoryId,
        price: catById(zone.categoryId).price,
        qty,
      });
    }
  }

  function isSeatSelected(seatId) {
    return cart.items.some((i) => i.type === 'seat' && i.refId === seatId);
  }

  function toggleSeat(seatZone, seat) {
    if (seat.status === 'sold' || seat.status === 'disabled') return;
    const idx = cart.items.findIndex((i) => i.type === 'seat' && i.refId === seat.id);
    if (idx >= 0) {
      cart.items.splice(idx, 1);
    } else {
      cart.items.push({
        key: `seat-${seat.id}`,
        type: 'seat',
        refId: seat.id,
        label: `Siège ${seat.label}`,
        categoryId: seat.categoryId,
        price: catById(seat.categoryId).price,
        qty: 1,
      });
    }
  }

  function removeItem(key) {
    const idx = cart.items.findIndex((i) => i.key === key);
    if (idx >= 0) cart.items.splice(idx, 1);
  }

  function incQty(item) {
    item.qty++;
  }

  function decQty(item) {
    item.qty--;
    if (item.qty <= 0) removeItem(item.key);
  }

  function clear() {
    cart.items.splice(0, cart.items.length);
  }

  const total = computed(() => cart.items.reduce((s, i) => s + i.price * i.qty, 0));
  const totalSeats = computed(() => cart.items.reduce((s, i) => s + i.qty, 0));

  return {
    cart,
    total,
    totalSeats,
    addZone,
    isSeatSelected,
    toggleSeat,
    removeItem,
    incQty,
    decQty,
    clear,
  };
}
