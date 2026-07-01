// Données statiques simulant ce que renverrait un vrai backend.
// À remplacer plus tard par de vrais appels (fetch/axios) vers votre API.

import { computeSeatLabel } from './seatLabel';

export const CATEGORIES = [
  { id: 'prestige',  name: 'PRESTIGE',  price: 100000, color: '#e11d2e' },
  { id: 'signature', name: 'SIGNATURE', price: 70000,  color: '#7a1f2b' },
  { id: 'platinium', name: 'PLATINIUM', price: 40000,  color: '#2554c7' },
  { id: 'gold',      name: 'GOLD',      price: 30000,  color: '#eab308' },
  { id: 'prime',     name: 'PRIME',     price: 25000,  color: '#c026d3' },
  { id: 'silver',    name: 'SILVER',    price: 20000,  color: '#0d9488' },
  { id: 'bronze',    name: 'BRONZE',    price: 12000,  color: '#92400e' },
  { id: 'fanzone',   name: 'FANZONE',   price: 8000,   color: '#16a34a' },
];

// Zones "génériques" (tribunes/gradins) : réservation par quantité, pas de siège précis.
export const ZONES = [
  { id: 'z1', categoryId: 'gold',      label: 'Tribune Nord',     top: 240, left: 320,  width: 250, height: 70,  capacity: 180 },
  { id: 'z2', categoryId: 'platinium', label: 'Tribune Centrale', top: 240, left: 600,  width: 320, height: 80,  capacity: 260 },
  { id: 'z3', categoryId: 'silver',    label: 'Tribune Sud',      top: 250, left: 960,  width: 250, height: 70,  capacity: 180 },
  { id: 'z4', categoryId: 'prime',     label: 'Loge Prime',       top: 330, left: 320,  width: 240, height: 50,  capacity: 90 },
  { id: 'z5', categoryId: 'silver',    label: 'Aile Est',         top: 410, left: 320,  width: 200, height: 50,  capacity: 70 },
  { id: 'z6', categoryId: 'silver',    label: 'Aile Ouest',       top: 410, left: 650,  width: 200, height: 50,  capacity: 70 },
  { id: 'z7', categoryId: 'prestige',  label: 'Carré Prestige',   top: 460, left: 130,  width: 150, height: 150, capacity: 40 },
  { id: 'z8', categoryId: 'prestige',  label: 'Loge VIP Droite',  top: 460, left: 1090, width: 150, height: 150, capacity: 40 },
  { id: 'z9', categoryId: 'fanzone',   label: 'Fanzone',          top: 460, left: 1170, width: 90,  height: 90,  capacity: 60, shape: 'pill' },
];

// Zones "libres" : non liées à une catégorie (scène, portes, sanitaires, zones inaccessibles…)
export const FREE_ZONES = [
  { id: 'fz-scene', label: 'SCÈNE',  icon: 'stage', color: '#111827', pattern: 'solid',  top: 560, left: 600,  width: 140, height: 50, labelFontSize: 11 },
  { id: 'fz-p1',    label: 'PORTE 1', icon: 'door',  color: '#2563eb', pattern: 'solid',  top: 368, left: 240,  width: 90,  height: 34, labelFontSize: 10 },
  { id: 'fz-p2',    label: 'PORTE 2', icon: 'door',  color: '#2563eb', pattern: 'solid',  top: 368, left: 540,  width: 90,  height: 34, labelFontSize: 10 },
  { id: 'fz-p3',    label: 'PORTE 3', icon: 'door',  color: '#2563eb', pattern: 'solid',  top: 368, left: 880,  width: 90,  height: 34, labelFontSize: 10 },
  { id: 'fz-p4',    label: 'PORTE 4', icon: 'door',  color: '#2563eb', pattern: 'solid',  top: 368, left: 1170, width: 90,  height: 34, labelFontSize: 10 },
  { id: 'fz-wc',    label: 'WC',     icon: 'toilets', color: '#0891b2', pattern: 'dots',  top: 200, left: 700,  width: 70,  height: 50, labelFontSize: 9 },
  { id: 'fz-block', label: 'Zone inaccessible', icon: 'blocked', color: '#6b7280', pattern: 'stripes', top: 60, left: 900, width: 140, height: 60, labelFontSize: 9 },
];

// Génère une zone à sièges nominatifs (grille rangs x colonnes).
function buildSeatZone(id, categoryId, top, left, rows, cols, opts = {}) {
  const shape = opts.shape || 'rounded'; // 'square' | 'round' | 'rounded'
  const seatSize = opts.seatSize || 18;  // taille (hauteur) du siège en px
  const blockNumber = opts.blockNumber ?? null;
  const rowLabelFontSize = opts.rowLabelFontSize || 10;
  const naming = {
    rowFormat: opts.rowFormat || 'A-Z',
    rowDirection: opts.rowDirection || 'normal',
    colFormat: opts.colFormat || '1-9',
    colDirection: opts.colDirection || 'normal',
  };
  const disabledSeats = opts.disabledSeats || []; // ex: ['0-3', '2-7'] = rang 0 / col 3, rang 2 / col 7
  const categoryOverrides = opts.categoryOverrides || {}; // ex: {'0-0': 'prestige'}
  const seats = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const posKey = `${r}-${c}`;
      const isDisabled = disabledSeats.includes(posKey);
      seats.push({
        id: `${id}-${r}-${c}`,
        row: r + 1,
        col: c + 1,
        label: computeSeatLabel(r, c, rows, cols, naming),
        categoryId: categoryOverrides[posKey] || categoryId,
        status: isDisabled ? 'disabled' : (Math.random() < 0.18 ? 'sold' : 'available'),
      });
    }
  }
  return { id, categoryId, top, left, rows, cols, shape, seatSize, blockNumber, rowLabelFontSize, ...naming, seats };
}

export function generateSeatZones() {
  return [
    buildSeatZone('signature-left', 'signature', 415, 130, 4, 9, {
      shape: 'rounded', seatSize: 26, blockNumber: 11, disabledSeats: ['0-0', '3-8'],
    }),
    buildSeatZone('signature-right', 'signature', 415, 1195, 4, 9, {
      shape: 'rounded', seatSize: 26, blockNumber: 12, rowDirection: 'reversed',
    }),
  ];
}
