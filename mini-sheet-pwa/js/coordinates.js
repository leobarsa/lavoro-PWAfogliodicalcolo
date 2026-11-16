// Conversione tra notazione A1 e indici numerici (0-based)
export const ROWS = 100, COLS = 100;

// 0 -> "A", 25 -> "Z", 26 -> "AA", 99 -> "CV"
export function colToName(c) {
  let s = ''; c++;
  while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
  return s;
}
// "AA" -> 26
export function nameToCol(n) {
  let c = 0;
  for (const ch of n) c = c * 26 + ch.charCodeAt(0) - 64;
  return c - 1;
}
// "B3" o "$B$3" -> {r:2, c:1}; null se non è un riferimento
export function parseRef(s) {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(s);
  return m ? { c: nameToCol(m[1].toUpperCase()), r: +m[2] - 1 } : null;
}
export const toKey = (r, c) => r * COLS + c;          // chiave numerica unica per cella
export const fromKey = k => ({ r: Math.floor(k / COLS), c: k % COLS });
export const inGrid = (r, c) => r >= 0 && c >= 0 && r < ROWS && c < COLS;
export const cellName = (r, c) => colToName(c) + (r + 1);
