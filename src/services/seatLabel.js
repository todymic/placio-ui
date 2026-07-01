// Génère des séquences de nommage (rangées / colonnes) selon un format et un sens donnés.

function toLetters(n, upper = true) {
  // 0 -> A, 25 -> Z, 26 -> AA, ...
  let label = '';
  let x = n;
  do {
    label = String.fromCharCode((upper ? 65 : 97) + (x % 26)) + label;
    x = Math.floor(x / 26) - 1;
  } while (x >= 0);
  return label;
}

const ROMAN_MAP = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
  [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];
function toRoman(n) {
  let num = n + 1; // 0 -> I
  let result = '';
  for (const [value, symbol] of ROMAN_MAP) {
    while (num >= value) {
      result += symbol;
      num -= value;
    }
  }
  return result || String(n + 1);
}

export const ROW_FORMATS = [
  { id: 'A-Z', label: 'Lettres majuscules (A, B, C…)' },
  { id: 'a-z', label: 'Lettres minuscules (a, b, c…)' },
  { id: 'I-X', label: 'Chiffres romains (I, II, III…)' },
  { id: '1-9', label: 'Chiffres (1, 2, 3…)' },
];

export const COL_FORMATS = [
  { id: '1-9', label: 'Chiffres (1, 2, 3…)' },
  { id: 'A-Z', label: 'Lettres majuscules (A, B, C…)' },
  { id: 'a-z', label: 'Lettres minuscules (a, b, c…)' },
  { id: 'I-X', label: 'Chiffres romains (I, II, III…)' },
];

export const DIRECTIONS = [
  { id: 'normal', label: 'Normal (croissant)' },
  { id: 'reversed', label: 'Inversé (décroissant)' },
];

// index: position 0-based · total: nombre total d'éléments sur cet axe
function sequenceValue(format, index, total, direction) {
  const i = direction === 'reversed' ? Math.max(0, total - 1 - index) : index;
  switch (format) {
    case 'A-Z': return toLetters(i, true);
    case 'a-z': return toLetters(i, false);
    case 'I-X': return toRoman(i);
    case '1-9':
    default: return String(i + 1);
  }
}

export function computeAxisLabel(index, total, format, direction) {
  return sequenceValue(format, index, total, direction);
}

/**
 * Calcule le nom d'un siège à partir de sa position et de la configuration du bloc.
 * config: { rowFormat, rowDirection, colFormat, colDirection }
 */
export function computeSeatLabel(rowIndex, colIndex, totalRows, totalCols, config = {}) {
  const rowFormat = config.rowFormat || 'A-Z';
  const rowDirection = config.rowDirection || 'normal';
  const colFormat = config.colFormat || '1-9';
  const colDirection = config.colDirection || 'normal';

  const rowPart = sequenceValue(rowFormat, rowIndex, totalRows, rowDirection);
  const colPart = sequenceValue(colFormat, colIndex, totalCols, colDirection);
  return `${rowPart}${colPart}`;
}

// Conservé pour rétro-compatibilité (ancienne API : lettre de rangée + numéro de colonne, sens normal)
export function rowLetter(rowIndex) {
  return toLetters(rowIndex, true);
}
export function seatLabel(rowIndex, colIndex) {
  return `${toLetters(rowIndex, true)}${colIndex + 1}`;
}
