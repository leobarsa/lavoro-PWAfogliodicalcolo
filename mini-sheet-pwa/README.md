# Mini-Foglio di Calcolo (PWA)

**🌐 Sito pubblicato: https://TUO-USERNAME.github.io/mini-sheet-pwa/** ← sostituire dopo il deploy

Foglio di calcolo 100×100 (A1:CV100) in HTML/CSS/JS vanilla (moduli ES), con motore di formule scritto da zero,
installabile e funzionante offline. Unica dipendenza: Bootstrap 5 (solo CSS, da CDN, messo in cache dal service worker).

## Avvio in locale
```bash
python -m http.server 8000     # poi apri http://localhost:8000  (non file://: serve il service worker)
```

## Deploy
**GitHub Pages**: `git init && git add . && git commit -m "Prima versione" && git branch -M main`,
`git remote add origin https://github.com/TUO-USERNAME/mini-sheet-pwa.git`, `git push -u origin main`;
poi *Settings → Pages → Deploy from a branch → main / (root)*. Tutti i percorsi sono relativi (`./sw.js`, `start_url: "./"`, `scope: "./"`).
**Vercel** (opzionale, bonus): Add New → Project → repo → Framework "Other", build command vuoto.
Dopo ogni modifica ai file, incrementare `CACHE` in `sw.js`.

## Funzioni implementate
`SOMMA, MEDIA, CONTA, CONTA.VALORI, SOMMA.SE, CONTA.SE, MEDIA.SE, MAX, MIN` + extra `SE, CONCAT, ARROTONDA`.
Riferimenti `A1`/`$A$1`, intervalli multi-colonna, operatori `+ - * /`, parentesi, confronti `= < > <= >= <>`, separatori `;` o `,`.
Errori: `#DIV/0!`, `#VALORE!`, `#RIF!`, `#NOME?`, `#CIRC!` (riferimento circolare). Passando il mouse su un errore si vede la spiegazione.
Tastiera: frecce, Tab/Shift+Tab, Invio (conferma e scende), PagSu/PagGiù, Home/Fine, F2 o doppio click per modificare, Canc per svuotare, digitare sovrascrive.
Su touch: tocca una cella per selezionarla, toccala di nuovo per modificarla (o usa la barra della formula).
Extra: salvataggio automatico in localStorage, export CSV, pulsante *Demo*, pulsante *Installa*.

## Strategia di virtualizzazione
Un `div` (#sheet) ha la dimensione totale 100×100, quindi le barre di scorrimento sono reali; nel DOM esistono solo le celle visibili
(~30×15 + margine di 3 righe/colonne), create/rimosse a ogni evento `scroll` (throttle con `requestAnimationFrame`).
Le intestazioni sono `position: sticky`. Alternative valutate: `content-visibility: auto` (non evita di creare 10.000 nodi), tabella HTML completa.

## Gestione delle dipendenze
Ogni formula, dopo il parsing, registra le celle da cui dipende (anche espandendo gli intervalli) in un grafo inverso `dep`.
Quando una cella cambia si invalidano solo lei e i suoi dipendenti transitivi; il valore è calcolato in modo pigro e memoizzato (`Sheet.get`),
quindi si ricalcolano solo le celle visibili e invalidate. I cicli sono rilevati con lo stack di valutazione (→ `#CIRC!`).
Nota di progetto: per il caso di test 5, una cella che compare nel proprio intervallo (`=SOMMA(A1:CV100)` in E1) ignora se stessa; i cicli reali (A1→B1→A1, `=C1`) restano segnalati.
Limite noto: catene di dipendenze lunghissime (migliaia di celle in cascata) possono esaurire lo stack e dare `#VALORE!`.

## Casi di test
Il motore (casi 1–5 e dipendenze) è stato verificato con uno script Node; gli altri vanno verificati nel browser e annotati qui.

| # | Caso | Esito |
|---|------|-------|
| 1 | A1=5, A2=10, A3=`=SOMMA(A1:A2)` → 15 | OK (Node) |
| 2 | B2=`=A1/B1` con B1=0 → `#DIV/0!` | OK (Node) |
| 3 | C1=`=C1` → `#CIRC!` | OK (Node) |
| 4 | `=CONTA.SE(A1:A10;">5")` con valori misti | OK (Node) |
| 5 | `=SOMMA(A1:CV100)` su griglia vuota → 0 | OK (Node) |
| 6 | Scorrimento riga 1→100 e ritorno | da verificare |
| 7 | 100 dipendenze (Demo → modifica I1; la barra di stato mostra i ms; in Node ≈0,2 ms) | da verificare nel browser |
| 8 | Offline: DevTools → Network → Offline, ricarica | da verificare |
| 9 | URL pubblico in incognito: installazione + offline | da verificare |
| 10 | Nessun 404 in console sull'URL pubblico | da verificare |

## Domande di riflessione
*(da completare con le vostre risposte: 1 parte scritta da voi/AI e verifica · 2 prompt efficaci · 3 correzioni all'AI · 4 virtualizzazione · 5 dipendenze · 6 piattaforma e problemi di deploy · 7 verifica da URL pubblico · 8 cosa cambiereste)*

## Difficoltà incontrate
*(da completare)*
