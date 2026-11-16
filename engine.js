// Motore di calcolo: tokenizer + parser (discesa ricorsiva) + valutatore + grafo dipendenze.
import { parseRef, toKey, fromKey, inGrid } from './coordinates.js';

export class SheetError {
  constructor(code, hint) { this.code = code; this.hint = hint || code; }
  toString() { return this.code; }
}
const err = (c, h) => new SheetError(c, h);
const isErr = v => v instanceof SheetError;

/* ---------------- TOKENIZER ---------------- */
function tokenize(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    const rest = src.slice(i); let m;
    if ((m = /^(\d+(\.\d+)?|\.\d+)/.exec(rest))) out.push({ type: 'num', v: parseFloat(m[0]) });
    else if ((m = /^"((?:[^"]|"")*)"/.exec(rest))) out.push({ type: 'str', v: m[1].replace(/""/g, '"') });
    else if ((m = /^[A-Za-z_$][A-Za-z0-9_.$]*/.exec(rest))) out.push({ type: 'id', v: m[0] });
    else if ((m = /^(<=|>=|<>|[-+*\/()=<>:;,])/.exec(rest))) out.push({ type: 'op', v: m[0] });
    else throw err('#VALORE!', `Carattere non valido: ${src[i]}`);
    i += m[0].length;
  }
  return out;
}

/* ---------------- PARSER ----------------
   cmp := add (( = | < | > | <= | >= | <> ) add)?
   add := mul (( + | - ) mul)*      mul := unary (( * | / ) unary)*
   unary := - unary | primary
   primary := numero | "testo" | RIF | RIF:RIF | FUNZ(arg; arg...) | ( cmp )          */
function parse(src) {
  const t = tokenize(src); let p = 0;
  const isOp = v => t[p] && t[p].type === 'op' && t[p].v === v;
  const bad = h => { throw err('#VALORE!', h); };

  function cmp() {
    const a = add(), o = t[p];
    if (o && o.type === 'op' && ['=', '<', '>', '<=', '>=', '<>'].includes(o.v)) { p++; return { t: 'bin', op: o.v, a, b: add() }; }
    return a;
  }
  function add() { let a = mul(); while (isOp('+') || isOp('-')) { const op = t[p++].v; a = { t: 'bin', op, a, b: mul() }; } return a; }
  function mul() { let a = un(); while (isOp('*') || isOp('/')) { const op = t[p++].v; a = { t: 'bin', op, a, b: un() }; } return a; }
  function un() { if (isOp('-')) { p++; return { t: 'neg', a: un() }; } if (isOp('+')) { p++; return un(); } return prim(); }
  function prim() {
    const k = t[p++];
    if (!k) bad('Formula incompleta');
    if (k.type === 'num' || k.type === 'str') return { t: 'lit', v: k.v };
    if (k.type === 'op' && k.v === '(') { const e = cmp(); if (!isOp(')')) bad('Manca )'); p++; return e; }
    if (k.type === 'id') {
      if (isOp('(')) {                                   // chiamata di funzione
        p++; const args = [], name = k.v.toUpperCase();
        if (!FNS[name]) throw err('#NOME?', `Funzione sconosciuta: ${k.v}`);
        if (isOp(')')) p++;
        else for (;;) {
          args.push(cmp());
          if (isOp(';') || isOp(',')) { p++; continue; }
          if (isOp(')')) { p++; break; }
          bad('Separatore o ) mancante');
        }
        return { t: 'fn', name, args };
      }
      const a = parseRef(k.v);
      if (!a) throw err('#NOME?', `Nome sconosciuto: ${k.v}`);
      if (isOp(':')) {                                   // intervallo A1:B5
        p++; const e = t[p++], b = e && e.type === 'id' ? parseRef(e.v) : null;
        if (!b) bad('Intervallo non valido');
        return { t: 'range', r1: Math.min(a.r, b.r), r2: Math.max(a.r, b.r), c1: Math.min(a.c, b.c), c2: Math.max(a.c, b.c) };
      }
      return { t: 'ref', r: a.r, c: a.c };
    }
    bad('Token inatteso');
  }
  const ast = cmp();
  if (p < t.length) bad('Token in eccesso');
  return ast;
}

/* ---------------- UTILITÀ DI VALUTAZIONE ---------------- */
const C = { '=': (a, b) => a === b, '<>': (a, b) => a !== b, '<': (a, b) => a < b, '>': (a, b) => a > b, '<=': (a, b) => a <= b, '>=': (a, b) => a >= b };

function toNum(v) {                       // conversione per l'aritmetica
  if (isErr(v)) throw v;
  if (v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v.trim() !== '' && isFinite(Number(v))) return Number(v);
  throw err('#VALORE!', 'Testo non convertibile in numero');
}
// Interpreta il testo digitato in una cella non-formula
function parseLiteral(raw) {
  const s = raw.trim();
  return /^[-+]?(\d+([.,]\d+)?|[.,]\d+)$/.test(s) ? Number(s.replace(',', '.')) : raw;
}
// Costruisce il predicato per i criteri di SOMMA.SE / CONTA.SE / MEDIA.SE (">5", "<=3", "<>x", "testo")
function makeTest(crit) {
  let op = '=', rhs = crit;
  if (typeof crit === 'string') { const m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(crit); op = m[1] || '='; rhs = m[2]; }
  const rn = typeof rhs === 'number' ? rhs : (String(rhs).trim() !== '' && isFinite(Number(rhs)) ? Number(rhs) : null);
  return v => {
    if (isErr(v)) return false;
    if (rn !== null) return typeof v === 'number' ? C[op](v, rn) : op === '<>';
    const s = String(v ?? '').toLowerCase(), r = String(rhs).toLowerCase();
    return C[op](s, r);
  };
}

/* ---------------- FUNZIONI ---------------- */
const FNS = {
  'SOMMA': (s, a) => s.nums(a).reduce((x, y) => x + y, 0),
  'MEDIA': (s, a) => { const n = s.nums(a); if (!n.length) throw err('#DIV/0!'); return n.reduce((x, y) => x + y, 0) / n.length; },
  'CONTA': (s, a) => s.nums(a).length,
  'CONTA.VALORI': (s, a) => a.reduce((n, x) => n + (x.t === 'range' ? s.rangeVals(x).length : 1), 0),
  'MAX': (s, a) => { const n = s.nums(a); return n.length ? n.reduce((x, y) => (y > x ? y : x)) : 0; },
  'MIN': (s, a) => { const n = s.nums(a); return n.length ? n.reduce((x, y) => (y < x ? y : x)) : 0; },
  'SOMMA.SE': (s, a) => s.cond(a).vals.reduce((x, y) => x + y, 0),
  'CONTA.SE': (s, a) => s.cond(a, true).vals.length,
  'MEDIA.SE': (s, a) => { const v = s.cond(a).vals; if (!v.length) throw err('#DIV/0!'); return v.reduce((x, y) => x + y, 0) / v.length; },
  // Extra (bonus)
  'SE': (s, a) => { if (a.length < 2) throw err('#VALORE!'); const c = s.ev(a[0]); if (isErr(c)) throw c;
    const ok = typeof c === 'string' ? c !== '' : !!c; const br = ok ? a[1] : a[2]; return br ? s.ev(br) : false; },
  'CONCAT': (s, a) => a.map(x => (x.t === 'range' ? s.rangeVals(x) : [s.ev(x)]).map(v => { if (isErr(v)) throw v; return v ?? ''; }).join('')).join(''),
  'ARROTONDA': (s, a) => { const x = toNum(s.ev(a[0])), n = a[1] ? toNum(s.ev(a[1])) : 0, f = 10 ** n; return Math.sign(x) * Math.round(Math.abs(x) * f) / f; },
};

/* ---------------- FOGLIO ---------------- */
export class Sheet {
  constructor() {
    this.raw = new Map();     // chiave -> testo digitato
    this.ast = new Map();     // chiave -> AST (o SheetError di parsing) per le formule
    this.vals = new Map();    // cache valori calcolati (invalidata in modo incrementale)
    this.prec = new Map();    // chiave -> Set di celle da cui dipende
    this.dep = new Map();     // chiave -> Set di celle che dipendono da lei (grafo inverso)
    this.stack = [];          // celle in valutazione: serve a rilevare i cicli
  }

  // Imposta una cella; restituisce l'insieme delle celle da ridisegnare (lei + dipendenti transitivi)
  setCell(k, text) { this._set(k, text); return this._invalidate(k); }

  _set(k, text) {
    for (const p of this.prec.get(k) || []) this.dep.get(p)?.delete(k);   // scollega vecchie dipendenze
    this.prec.delete(k); this.ast.delete(k);
    if (text === '' || text == null) { this.raw.delete(k); return; }
    this.raw.set(k, text);
    if (text[0] !== '=') return;
    let node;
    try { node = parse(text.slice(1)); } catch (e) { node = e instanceof SheetError ? e : err('#VALORE!'); }
    this.ast.set(k, node);
    if (isErr(node)) return;
    const ps = new Set(); this._collect(node, ps);
    this.prec.set(k, ps);
    for (const p of ps) { if (!this.dep.has(p)) this.dep.set(p, new Set()); this.dep.get(p).add(k); }
  }

  _collect(n, out) {
    if (n.t === 'ref') { if (inGrid(n.r, n.c)) out.add(toKey(n.r, n.c)); }
    else if (n.t === 'range') { for (let r = n.r1; r <= n.r2; r++) for (let c = n.c1; c <= n.c2; c++) if (inGrid(r, c)) out.add(toKey(r, c)); }
    else if (n.t === 'fn') n.args.forEach(x => this._collect(x, out));
    else if (n.t === 'bin') { this._collect(n.a, out); this._collect(n.b, out); }
    else if (n.t === 'neg') this._collect(n.a, out);
  }

  // Ricalcolo incrementale: invalida SOLO la cella e i suoi dipendenti transitivi (visita sul grafo inverso).
  _invalidate(k) {
    const seen = new Set([k]), q = [k];
    while (q.length) { const x = q.pop(); this.vals.delete(x); for (const d of this.dep.get(x) || []) if (!seen.has(d)) { seen.add(d); q.push(d); } }
    return seen;
  }

  // Valore calcolato (pigro + memoizzato). undefined = cella vuota.
  get(k) {
    if (this.vals.has(k)) return this.vals.get(k);
    const raw = this.raw.get(k);
    if (raw === undefined) return undefined;
    const node = this.ast.get(k); let v;
    if (node === undefined) v = parseLiteral(raw);
    else if (isErr(node)) v = node;
    else {
      if (this.stack.includes(k)) return err('#CIRC!', 'Riferimento circolare');   // ciclo!
      this.stack.push(k);
      try { v = this.ev(node); if (Array.isArray(v)) v = err('#VALORE!'); }
      catch (e) { v = e instanceof SheetError ? e : err('#VALORE!', 'Formula troppo profonda'); }
      finally { this.stack.pop(); }
    }
    this.vals.set(k, v);
    return v;
  }

  ev(n) {
    switch (n.t) {
      case 'lit': return n.v;
      case 'ref': if (!inGrid(n.r, n.c)) throw err('#RIF!', 'Riferimento fuori griglia'); return this.get(toKey(n.r, n.c));
      case 'range': throw err('#VALORE!', 'Intervallo usato come valore singolo');
      case 'neg': return -toNum(this.ev(n.a));
      case 'fn': return FNS[n.name](this, n.args);
      case 'bin': {
        const x = this.ev(n.a), y = this.ev(n.b);
        if (isErr(x)) throw x; if (isErr(y)) throw y;
        if (C[n.op]) {                                   // confronti
          const num = v => typeof v === 'number' || v === undefined;
          return num(x) && num(y) ? C[n.op](x ?? 0, y ?? 0) : C[n.op](String(x ?? '').toLowerCase(), String(y ?? '').toLowerCase());
        }
        const a = toNum(x), b = toNum(y);
        if (n.op === '+') return a + b; if (n.op === '-') return a - b; if (n.op === '*') return a * b;
        if (b === 0) throw err('#DIV/0!', 'Divisione per zero');
        return a / b;
      }
    }
  }

  // Valori delle sole celle non vuote di un intervallo (efficiente su intervalli enormi e griglia vuota).
  // La cella che sta calcolando se stessa viene ignorata (così =SOMMA(A1:CV100) su griglia vuota dà 0).
  rangeVals(n) {
    const { r1, r2, c1, c2 } = n;
    if (!inGrid(r1, c1) || !inGrid(r2, c2)) throw err('#RIF!', 'Intervallo fuori griglia');
    const self = this.stack[this.stack.length - 1], out = [];
    if ((r2 - r1 + 1) * (c2 - c1 + 1) > this.raw.size) {            // meno celle piene che celle nell'intervallo
      for (const k of [...this.raw.keys()]) { const { r, c } = fromKey(k); if (k !== self && r >= r1 && r <= r2 && c >= c1 && c <= c2) out.push(this.get(k)); }
    } else for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const k = toKey(r, c); if (k !== self && this.raw.has(k)) out.push(this.get(k)); }
    return out;
  }
  rangeDense(n) {                                                    // posizionale (serve ai criteri)
    const { r1, r2, c1, c2 } = n;
    if (!inGrid(r1, c1) || !inGrid(r2, c2)) throw err('#RIF!', 'Intervallo fuori griglia');
    const self = this.stack[this.stack.length - 1], out = [];
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const k = toKey(r, c); out.push(k === self ? undefined : this.get(k)); }
    return out;
  }
  // Raccoglie i numeri dagli argomenti: negli intervalli si ignorano testo e celle vuote
  nums(args) {
    const out = [];
    for (const a of args) {
      if (a.t === 'range') for (const v of this.rangeVals(a)) { if (isErr(v)) throw v; if (typeof v === 'number') out.push(v); }
      else out.push(toNum(this.ev(a)));
    }
    return out;
  }
  // Argomenti (intervallo; criterio; [intervallo_somma]) -> valori corrispondenti al criterio.
  // countAll=true (CONTA.SE): conta anche le celle di testo che soddisfano il criterio.
  cond(a, countAll) {
    if (a.length < 2 || a[0].t !== 'range' || (a[2] && a[2].t !== 'range')) throw err('#VALORE!', 'Argomenti non validi');
    const crit = this.ev(a[1]); if (isErr(crit)) throw crit;
    const test = makeTest(crit), rng = this.rangeDense(a[0]), sum = a[2] ? this.rangeDense(a[2]) : rng, vals = [];
    rng.forEach((v, i) => { if (test(v) && (countAll || typeof sum[i] === 'number')) vals.push(sum[i]); });
    return { vals };
  }

  toJSON() { return Object.fromEntries(this.raw); }
  load(obj) {
    this.raw.clear(); this.ast.clear(); this.vals.clear(); this.prec.clear(); this.dep.clear();
    for (const [k, t] of Object.entries(obj)) this._set(+k, t);
  }
}
