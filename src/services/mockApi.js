import { CATEGORIES, ZONES, FREE_ZONES, generateSeatZones } from './venueData';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Couche d'accès aux données. Toute la logique "réseau" est isolée ici :
 * pour brancher un vrai backend, il suffit de remplacer le corps de ces
 * deux fonctions par des appels fetch()/axios vers vos endpoints réels,
 * sans rien changer ailleurs dans l'application.
 */
export const venueApi = {
  /**
   * GET /api/venue/:slug
   * Retourne les catégories, les zones génériques et les zones à sièges.
   */
  async fetchVenue() {
    await delay(600);
    return {
      categories: CATEGORIES,
      zones: ZONES,
      freeZones: FREE_ZONES,
      seatZones: generateSeatZones(),
    };
  },

  /**
   * POST /api/reservations
   * payload: { items: CartItem[], total: number }
   */
  async reserve(payload) {
    await delay(900);

    // Simule un conflit occasionnel (siège pris entre-temps par un autre client)
    if (Math.random() < 0.04) {
      throw new Error("Conflit : un siège vient d'être réservé par un autre utilisateur.");
    }

    return {
      success: true,
      reservationId: 'RSV-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
      total: payload.total,
      itemsCount: payload.items.length,
      issuedAt: new Date().toISOString(),
    };
  },
};
