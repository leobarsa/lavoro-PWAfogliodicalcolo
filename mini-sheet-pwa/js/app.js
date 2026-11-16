// UI: griglia virtualizzata, navigazione da tastiera, editing, persistenza, PWA.
import { Sheet } from './engine.js';
import { ROWS, COLS, colToName, toKey, cellName, parseRef } from './coordinates.js';

const COL_W = 96, ROW_H = 28, HDR_W = 48, HDR_H = 28, BUF = 3;   // BUF = righe/colonne extra fuori viewport
const sheet = new Sheet();
const $ = id => document.getElementById(id);
const grid = $('grid'), fx = $('fx'), status = $('status');
let sel = { r: 0, c: 0 }, editing = false;

/* ---- Struttura DOM: #sheet ha la dimensione TOTALE (100x100 celle) così le barre di scorrimento sono vere,
        ma nel DOM esistono solo le celle visibili (virtualizzazione a finestra). ---- */
grid.innerHTML = `<div id="sheet" style="width:${HDR_W + COLS * COL_W}px;height:${HDR_H + ROWS * ROW_H}px">
  <div id="corner"><div class="hdr" style="left:0;top:0;width:${HDR_W}px;height:${HDR_H}px"></div></div>
  <div id="colhdr" style="width:${HDR_W + COLS * COL_W}px;height:${HDR_H}px"></div>
  <div id="body" style="height:${ROWS * ROW_H}px"><div id="rowhdr" style="width:${HDR_W}px"></div>
  <input id="ed" hidden autocomplete="off"></div></div>`;
const colhdr = $('colhdr'), rowhdr = $('rowhdr'), body = $('body'), ed = $('ed');
const cellEls = new Map(), colEls = new Map(), rowEls = new Map();   // elementi DOM attualmente vivi

function mk(cls, l, t, w, h, text) {
  const e = document.createElement('div');
  e.className = cls; e.style.cssText = `left:${l}px;top:${t}px;width:${w}px;height:${h}px`;
  if (text !== undefined) e.textContent = text;
  return e;
}
function fmt(v) {                                     // valore -> [testo, classe CSS]
  if (v === undefined) return ['', ''];
  if (typeof v === 'number') return [String(Number(v.toPrecision(12))), 'num'];
  if (typeof v === 'boolean') return [v ? 'VERO' : 'FALSO', ''];
  if (typeof v === 'object') return [v.code, 'err'];
  return [String(v), ''];
}
// Aggiunge/rimuove elementi per tenere solo l'intervallo [lo,hi] e aggiorna quelli rimasti
function sync(map, lo, hi, parent, make, upd) {
  for (const [i, e] of map) if (i < lo || i > hi) { e.remove(); map.delete(i); }
  for (let i = lo; i <= hi; i++) {
    let e = map.get(i);
    if (!e) { e = make(i); parent.appendChild(e); map.set(i, e); }
    upd(e, i);
  }
}

/* ---- Rendering: calcola quali righe/colonne sono visibili dallo scroll e disegna solo quelle ---- */
function render() {
  const top = grid.scrollTop, left = grid.scrollLeft;
  const r0 = Math.max(0, Math.floor(top / ROW_H) - BUF), r1 = Math.min(ROWS - 1, Math.ceil((top + grid.clientHeight) / ROW_H) + BUF);
  const c0 = Math.max(0, Math.floor((left - HDR_W) / COL_W) - BUF), c1 = Math.min(COLS - 1, Math.ceil((left + grid.clientWidth) / COL_W) + BUF);
  sync(colEls, c0, c1, colhdr, c => mk('hdr', HDR_W + c * COL_W, 0, COL_W, HDR_H, colToName(c)), (e, c) => e.classList.toggle('on', c === sel.c));
  sync(rowEls, r0, r1, rowhdr, r => mk('hdr', 0, r * ROW_H, HDR_W, ROW_H, r + 1), (e, r) => e.classList.toggle('on', r === sel.r));
  for (const [k, e] of cellEls) if (e._r < r0 || e._r > r1 || e._c < c0 || e._c > c1) { e.remove(); cellEls.delete(k); }
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const k = toKey(r, c); let e = cellEls.get(k);
    if (!e) { e = mk('cell', HDR_W + c * COL_W, r * ROW_H, COL_W, ROW_H); e._r = r; e._c = c; body.appendChild(e); cellEls.set(k, e); }
    const v = sheet.get(k), [t, cls] = fmt(v);          // get() è pigro: ricalcola solo se la cache è stata invalidata
    if (e._t !== t) { e.textContent = t; e._t = t; }
    const cl = 'cell ' + cls + (r === sel.r && c === sel.c ? ' sel' : '');
    if (e.className !== cl) e.className = cl;
    const hint = cls === 'err' ? v.hint : ''; if (e.title !== hint) e.title = hint;
  }
}
let raf = 0;
grid.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }, { passive: true });
addEventListener('resize', render);

/* ---- Selezione e navigazione ---- */
function select(r, c) {
  sel = { r: Math.max(0, Math.min(ROWS - 1, r)), c: Math.max(0, Math.min(COLS - 1, c)) };
  const x = HDR_W + sel.c * COL_W, y = HDR_H + sel.r * ROW_H;       // posizione nello #sheet
  if (y < grid.scrollTop + HDR_H) grid.scrollTop = y - HDR_H;
  else if (y + ROW_H > grid.scrollTop + grid.clientHeight) grid.scrollTop = y + ROW_H - grid.clientHeight;
  if (x < grid.scrollLeft + HDR_W) grid.scrollLeft = x - HDR_W;
  else if (x + COL_W > grid.scrollLeft + grid.clientWidth) grid.scrollLeft = x + COL_W - grid.clientWidth;
  $('name').value = cellName(sel.r, sel.c);
  fx.value = sheet.raw.get(toKey(sel.r, sel.c)) ?? '';
  render();
}
function setVal(r, c, text) {
  const t0 = performance.now();
  const affected = sheet.setCell(toKey(r, c), text);
  render();
  status.textContent = `Aggiornate ${affected.size} celle (dipendenti inclusi) in ${(performance.now() - t0).toFixed(1)} ms`;
  save();
}
function startEdit(initial) {
  const k = toKey(sel.r, sel.c);
  ed.style.cssText = `left:${HDR_W + sel.c * COL_W}px;top:${sel.r * ROW_H}px;width:${COL_W * 1.6}px;height:${ROW_H}px`;
  ed.value = initial ?? sheet.raw.get(k) ?? '';
  ed.hidden = false; editing = true; ed.focus();
  if (initial === undefined) ed.select();
}
function commit() {
  if (!editing) return;
  editing = false; ed.hidden = true;
  setVal(sel.r, sel.c, ed.value);
  fx.value = ed.value;
}
ed.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); commit(); select(sel.r + (e.shiftKey ? -1 : 1), sel.c); grid.focus(); }
  else if (e.key === 'Tab') { e.preventDefault(); commit(); select(sel.r, sel.c + (e.shiftKey ? -1 : 1)); grid.focus(); }
  else if (e.key === 'Escape') { editing = false; ed.hidden = true; grid.focus(); }
});
ed.addEventListener('blur', commit);
ed.addEventListener('input', () => { fx.value = ed.value; });

fx.addEventListener('keydown', e => {                    // modifica dalla barra della formula
  if (e.key === 'Enter') { setVal(sel.r, sel.c, fx.value); grid.focus(); }
  else if (e.key === 'Escape') { select(sel.r, sel.c); grid.focus(); }
});

document.addEventListener('keydown', e => {
  if (editing || e.target === fx || e.ctrlKey || e.metaKey || e.altKey) return;
  const page = Math.max(1, Math.floor((grid.clientHeight - HDR_H) / ROW_H) - 1);
  const s = e.shiftKey ? -1 : 1;
  const nav = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Enter: [s, 0], Tab: [0, s],
    PageUp: [-page, 0], PageDown: [page, 0], Home: [0, -COLS], End: [0, COLS] }[e.key];
  if (nav) { e.preventDefault(); select(sel.r + nav[0], sel.c + nav[1]); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setVal(sel.r, sel.c, ''); fx.value = ''; }
  else if (e.key === 'F2') { e.preventDefault(); startEdit(); }
  else if (e.key.length === 1) { e.preventDefault(); startEdit(e.key); }   // digitare sovrascrive la cella
});
// Click: seleziona; secondo click sulla cella già selezionata (o doppio click) apre la modifica (utile su touch)
grid.addEventListener('click', e => {
  const el = e.target.closest('.cell'); if (!el) return;
  if (el._r === sel.r && el._c === sel.c) startEdit(); else select(el._r, el._c);
});
grid.addEventListener('dblclick', e => { if (e.target.closest('.cell') && !editing) startEdit(); });

/* ---- Persistenza (localStorage) ---- */
let timer = 0;
function save() { clearTimeout(timer); timer = setTimeout(() => { try { localStorage.setItem('minisheet-v1', JSON.stringify(sheet)); } catch {} }, 300); }
try { const s = localStorage.getItem('minisheet-v1'); if (s) sheet.load(JSON.parse(s)); } catch {}

/* ---- Pulsanti ---- */
$('btnDemo').onclick = () => {
  const d = [['A1', '5'], ['A2', '10'], ['A3', '=SOMMA(A1:A2)'], ['B1', '0'], ['B2', '=A1/B1'], ['C1', '=C1'],
    ['D1', '=CONTA.SE(A1:A10;">5")'], ['D2', '=MEDIA(A1:A2)'], ['D3', '=SOMMA.SE(A1:A10;">5")'], ['D4', '=MAX(A1:A3)-MIN(A1:A3)'],
    ['G1', 'Test 7: cambia I1 →'], ['I1', '1']];
  for (let i = 1; i <= 100; i++) d.push(['J' + i, `=$I$1*${i}`]);        // 100 celle dipendenti da I1
  for (const [a, v] of d) { const p = parseRef(a); sheet.setCell(toKey(p.r, p.c), v); }
  select(0, 0); save();
  status.textContent = 'Demo caricata: modifica I1 e guarda i tempi di ricalcolo di J1:J100';
};
$('btnClear').onclick = () => { if (confirm('Svuotare tutto il foglio?')) { sheet.load({}); select(0, 0); save(); } };
$('btnCsv').onclick = () => {
  let mr = 0, mc = 0;
  for (const k of sheet.raw.keys()) { mr = Math.max(mr, Math.floor(k / COLS)); mc = Math.max(mc, k % COLS); }
  const q = s => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [];
  for (let r = 0; r <= mr; r++) { const row = []; for (let c = 0; c <= mc; c++) row.push(q(fmt(sheet.get(toKey(r, c)))[0])); lines.push(row.join(';')); }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv' })); a.download = 'foglio.csv'; a.click();
};

/* ---- PWA: service worker (percorso RELATIVO) e pulsante di installazione ---- */
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.error));
let deferred;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('btnInstall').hidden = false; });
$('btnInstall').onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('btnInstall').hidden = true; };

select(0, 0);
grid.focus();
