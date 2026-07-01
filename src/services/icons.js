// Icônes disponibles pour les zones libres (non liées à une catégorie).
// Simples emoji pour rester sans dépendance — peuvent être remplacées par une vraie lib d'icônes si besoin.
export const FREE_ZONE_ICONS = [
  { id: 'none', emoji: '', label: 'Aucune (zone simple)' },
  { id: 'stage', emoji: '🎤', label: 'Scène' },
  { id: 'door', emoji: '🚪', label: 'Porte / Entrée' },
  { id: 'toilets', emoji: '🚻', label: 'Toilettes' },
  { id: 'toilets-accessible', emoji: '♿', label: 'Toilettes PMR' },
  { id: 'restaurant', emoji: '🍽️', label: 'Restaurant' },
  { id: 'bar', emoji: '🍸', label: 'Bar' },
  { id: 'stairs', emoji: '🪜', label: 'Escalier' },
  { id: 'stage-light', emoji: '💡', label: 'Projecteur' },
  { id: 'blocked', emoji: '🚫', label: 'Zone inaccessible' },
];

export function iconById(id) {
  return FREE_ZONE_ICONS.find((i) => i.id === id) || FREE_ZONE_ICONS[0];
}

export const FREE_ZONE_PATTERNS = [
  { id: 'solid', label: 'Couleur unie' },
  { id: 'stripes', label: 'Rayures' },
  { id: 'dots', label: 'Pointillés' },
];

// Retourne le style CSS de fond pour un pattern + une couleur donnés.
export function patternStyle(pattern, color) {
  if (pattern === 'stripes') {
    return {
      backgroundColor: color + '12',
      backgroundImage: `repeating-linear-gradient(45deg, ${color}55 0, ${color}55 6px, transparent 6px, transparent 14px)`,
    };
  }
  if (pattern === 'dots') {
    return {
      backgroundColor: color + '12',
      backgroundImage: `radial-gradient(${color}99 1.4px, transparent 1.4px)`,
      backgroundSize: '10px 10px',
    };
  }
  return { backgroundColor: color + '1a' };
}
