'use strict';
/* =====================================================================
   Turni · Responsabile — editor dei turni con pubblicazione sul Worker
   Sezioni: costanti · utilità · stato · categorie · turni/conflitti ·
            pubblicazione · interfaccia · avvio
   ===================================================================== */

/* ---------- Costanti ---------- */
const API = String(self.TURNI_API || '').replace(/\/+$/, '');
const LS_STATE = 'resp.state.v4', LS_LEGACY_V3 = 'resp.state.v3', LS_LEGACY_V2 = 'resp.state.v2', LS_LEGACY_V1 = 'resp.state.v1';
const LS_PW = 'resp.pw.v1', LS_PUB = 'resp.pub.v1', LS_EMP = 'resp.emp.v2', LS_LEGACY_EMP = 'resp.emp.v1', LS_UI = 'resp.ui.v1';

const KEEP_MONTHS = 12;      // mesi di storico inviati al server a ogni pubblicazione
const MIN_REST_H = 11;       // riposo minimo tra due turni (D.Lgs. 66/2003)
const PW_DAYS = 30;          // durata dell'accesso "ricordato"
const REMOTE_CHECK_MS = 60000;

const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const MES3 = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const GG = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const DEFAULT_COLS = [
 { start: '06:00', end: '14:00', label: '' },
 { start: '14:00', end: '22:00', label: '' },
 { start: '22:00', end: '06:00', label: '' },
];
// Parole che si possono scrivere in una casella ma NON sono dipendenti
const RESERVED = new Set(['NO', 'RIPOSO', 'FERIE', 'MALATTIA', 'PERMESSO', 'FESTIVO', 'RECUPERO', 'LIBERO', 'ASSENTE', 'SCOPERTO', 'CHIUSO', 'ROL', 'CONGEDO', 'INFORTUNIO']);
const HOUR_RE = /^(\d{1,2})(?:[:.](\d{2}))?$/;

const BASE_CATEGORIES = [
 {
 id: 'CAMPO SUD',
 label: 'CAMPO SUD',
 items: [
 { title: 'CAMPO SUD GABBIOTTO', label: 'CAMPO SUD GABBIOTTO', exportTitle: 'CAMPO SUD TERRA DEL SOLE' },
 { title: 'CAMPO SUD RONDA', label: 'CAMPO SUD RONDA', exportTitle: 'CAMPO SUD RONDA' },
 { title: 'CAMPO SUD ROM', label: 'CAMPO SUD ROM', exportTitle: 'CAMPO SUD ROM' },
 ],
 },
 {
 id: 'CAMPO NORD',
 label: 'CAMPO NORD',
 items: [
 { title: 'CAMPO NORD GABBIOTTO', label: 'CAMPO NORD GABBIOTTO', exportTitle: 'CAMPO NORD TERRA DEL SOLE' },
 { title: 'CAMPO NORD RONDA LATO SUD', label: 'CAMPO NORD RONDA LATO SUD', exportTitle: 'CAMPO NORD RONDA LATO SUD' },
 { title: 'CAMPO NORD RONDA LATO NORD', label: 'CAMPO NORD RONDA LATO NORD', exportTitle: 'CAMPO NORD RONDA LATO NORD' },
 ],
 },
 {
 id: 'PARCHI',
 label: 'PARCHI',
 items: [
 { title: 'PARCO CAFASSO', label: 'PARCO CAFASSO', exportTitle: 'PARCO CAFASSO' },
 ],
 },
];
const ALL_BASE_CATS = BASE_CATEGORIES.map((c) => c.id);

/* ---------- Utilità ---------- */
const $ = (s) => document.querySelector(s);
const el = (t, c, x) => {
 const e = document.createElement(t);
 if (c) e.className = c;
 if (x !== undefined) e.textContent = x;
 return e;
};
const pad = (n) => String(n).padStart(2, '0');
const ym = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1);
const isoOf = (d) => ym(d) + '-' + pad(d.getDate());
const isoDay = (m, d) => m + '-' + pad(d);
const normName = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

function shiftMonth(m, delta) {
 const [y, mo] = m.split('-').map(Number);
 return ym(new Date(y, mo - 1 + delta, 1));
}
function daysIn(m) {
 const [y, mo] = m.split('-').map(Number);
 return new Date(y, mo, 0).getDate();
}
const monthName = (m) => MESI[+m.slice(5) - 1];
// "18", "18:30", "6.15" -> minuti dalla mezzanotte; null se non valido
function hourToMin(h) {
 const m = HOUR_RE.exec(String(h || '').trim());
 if (!m) return null;
 const hh = +m[1], mm = +(m[2] || 0);
 if (hh > 24 || mm > 59 || (hh === 24 && mm > 0)) return null;
 return hh * 60 + mm;
}
const minToHHMM = (x) => pad(Math.floor((x % 1440) / 60)) + ':' + pad(x % 60);
const dayNum = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };

/* ---------- Stato globale ---------- */
const nowInit = new Date();
let month = ym(nowInit);
let title = 'CAMPO SUD GABBIOTTO';
let activeCat = 'CAMPO SUD';
let customTitles = new Set();   // postazioni create a mano: il loro nome non va mai "normalizzato"
let catsCache = null;           // cache di getCategories()
let shiftIdx = null;            // cache dell'indice turni per dipendente
let saveTimer = 0, toastTimer = 0, scrollTimer = 0, firstRender = true;
let activePicker = null;
let storageWarned = false;
let remoteNewer = false, lastRemoteCheck = 0;
let renderedToday = isoOf(nowInit);
let newEmpSelectedCats = new Set(ALL_BASE_CATS);

/* ---------- Titoli e categorie ---------- */
const normTitle = (raw) => String(raw || '').trim().toUpperCase().replace(/[_.]+/g, ' ').replace(/\s+/g, ' ');
function setCustomTitles(list) {
 customTitles = new Set((Array.isArray(list) ? list : []).map((cs) => normTitle(cs && cs.title)).filter(Boolean));
}

// Riconduce i nomi storici/importati (es. "TERRA DEL SOLE SUD") alle postazioni ufficiali.
// I nomi delle postazioni create a mano restano invariati.
function canonicalSheetTitle(raw) {
 const t = normTitle(raw);
 if (!t || customTitles.has(t)) return t;
 if (/\bCAMPO\s+SUD\s+ROM\b/.test(t)) return 'CAMPO SUD ROM';
 if (/\bCAFASSO\b/.test(t)) return 'PARCO CAFASSO';
 const isNord = /\bCAMPO\s+NORD\b/.test(t) || (/\bNORD\b/.test(t.replace(/\bLATO\s+NORD\b/g, '')) && !/\bCAMPO\s+SUD\b/.test(t));
 const isSud = /\bCAMPO\s+SUD\b/.test(t) || (!isNord && /\bSUD\b/.test(t.replace(/\bLATO\s+SUD\b/g, '')));
 const isGab = /\bGABBIOTTO\b/.test(t) || /\bTERR[AE]\s+DEL\s+SOLE\b/.test(t);
 const isRonda = /\bROND[AE]\b/.test(t);
 const lato = /\bLATO\s+(NORD|SUD)\b/.exec(t);

 if (isSud && isGab) return 'CAMPO SUD GABBIOTTO';
 if (isSud && isRonda) return 'CAMPO SUD RONDA';
 if (isNord && isGab) return 'CAMPO NORD GABBIOTTO';
 if (isNord && isRonda && lato) return 'CAMPO NORD RONDA LATO ' + lato[1];
 if (isNord && isRonda) return 'CAMPO NORD RONDA LATO NORD';
 return t;
}

// Indovina la categoria migliore in base al nome della postazione (es. "Parco San Gennaro" -> "PARCHI")
function guessCategoryFromName(rawName) {
 const t = String(rawName || '').trim().toUpperCase();
 if (/\bPARCO\b|\bPARCHI\b|\bVILLA\b|\bGIARDIN/i.test(t)) return 'PARCHI';
 if (/\bCAMPO\s+NORD\b/.test(t)) return 'CAMPO NORD';
 if (/\bCAMPO\s+SUD\b/.test(t)) return 'CAMPO SUD';
 if (/\bNORD\b/.test(t)) return 'CAMPO NORD';
 if (/\bSUD\b/.test(t)) return 'CAMPO SUD';
 return '';
}

function exportTitleForClients(canonTitle) {
 for (const cat of BASE_CATEGORIES) {
 const found = cat.items.find((it) => it.title === canonTitle);
 if (found) return found.exportTitle;
 }
 return canonTitle;
}

function normalizeEmployees(rawList) {
 if (!Array.isArray(rawList)) return [];
 const map = new Map();
 rawList.forEach((item) => {
 const raw = typeof item === 'string' ? item : (item && typeof item.name === 'string' ? item.name : '');
 const nm = normName(raw);
 if (!nm || RESERVED.has(nm)) return;
 const cats = item && Array.isArray(item.cats) && item.cats.length
 ? [...new Set(item.cats.map((c) => (c === 'PARCO CAFASSO' ? 'PARCHI' : normName(c))).filter(Boolean))]
 : [...ALL_BASE_CATS];
 map.set(nm, { name: nm, cats });
 });
 return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

const emptyState = () => ({
 sheets: [], customStructures: [], deletedCategories: [], deletedTitles: [],
 dirty: false, noticePending: false, noticeCursor: null, noticeBody: '', noticeSent: 0,
});

function migrateState(raw) {
 if (!raw || !Array.isArray(raw.sheets)) return null;
 const byKey = new Map();
 const customStructures = Array.isArray(raw.customStructures) ? raw.customStructures : [];
 const deletedCategories = Array.isArray(raw.deletedCategories) ? raw.deletedCategories : [];
 const deletedTitles = Array.isArray(raw.deletedTitles) ? raw.deletedTitles : [];
 setCustomTitles(customStructures);

 raw.sheets.forEach((s) => {
 const t = canonicalSheetTitle(s.title);
 const m = /^\d{4}-\d{2}$/.test(s.month || '') ? s.month : month;
 if (!t || deletedTitles.includes(t)) return;
 const key = t + '|' + m;
 const baseCols = Array.isArray(s.cols) && s.cols.length ? s.cols.map((c) => ({ start: c.start, end: c.end, label: c.label || '' })) : DEFAULT_COLS.map((c) => ({ ...c }));
 const legacyExtraCols = Array.isArray(s.extraCols) ? s.extraCols.map((c) => ({ start: c.start, end: c.end, label: c.label || 'Turno Extra' })) : [];
 const cols = baseCols.concat(legacyExtraCols);

 const cells = {};
 const allDates = new Set([...Object.keys(s.cells || {}), ...Object.keys(s.extraCells || {})]);
 allDates.forEach((date) => {
 if (date.slice(0, 7) !== m) return;
 const stdArr = (s.cells && Array.isArray(s.cells[date])) ? s.cells[date] : [];
 const extArr = (s.extraCells && Array.isArray(s.extraCells[date])) ? s.extraCells[date] : [];
 const combined = baseCols.map((_, i) => stdArr[i] || '').concat(legacyExtraCols.map((_, i) => extArr[i] || ''));
 if (combined.some((x) => x)) cells[date] = combined;
 });

 const cat = s.category === 'PARCO CAFASSO' ? 'PARCHI' : (s.category || '');
 if (cat && deletedCategories.includes(cat)) return;
 byKey.set(key, { title: t, category: cat, month: m, cols, cells });
 });
 return {
 sheets: [...byKey.values()],
 customStructures,
 deletedCategories,
 deletedTitles,
 dirty: !!raw.dirty,
 noticePending: !!raw.noticePending,
 noticeCursor: raw.noticeCursor == null ? null : raw.noticeCursor,
 noticeBody: typeof raw.noticeBody === 'string' ? raw.noticeBody : '',
 noticeSent: +raw.noticeSent || 0,
 };
}

/* ---------- Password: sessione o "ricordami" per PW_DAYS giorni ---------- */
function loadPw() {
 try { const s = sessionStorage.getItem(LS_PW); if (s) return JSON.parse(s).pw || ''; } catch { /* ignore */ }
 const v = lsGet(LS_PW, '');
 if (typeof v === 'string') { if (v) savePw(v, true); return v; } // vecchio formato: migra
 if (v && v.pw && v.exp > Date.now()) return v.pw;
 if (v) lsSet(LS_PW, '');
 return '';
}
function savePw(p, remember) {
 clearPw();
 if (remember) lsSet(LS_PW, { pw: p, exp: Date.now() + PW_DAYS * 86400000 });
 else { try { sessionStorage.setItem(LS_PW, JSON.stringify({ pw: p })); } catch { /* ignore */ } }
}
function clearPw() {
 try { localStorage.removeItem(LS_PW); sessionStorage.removeItem(LS_PW); } catch { /* ignore */ }
}

let state = migrateState(lsGet(LS_STATE, null) || lsGet(LS_LEGACY_V3, null) || lsGet(LS_LEGACY_V2, null) || lsGet(LS_LEGACY_V1, null));
let employees = normalizeEmployees(lsGet(LS_EMP, null) || lsGet(LS_LEGACY_EMP, []));
let pw = loadPw();

const ui = lsGet(LS_UI, {}) || {};
if (/^\d{4}-\d{2}$/.test(ui.month || '')) month = ui.month;
if (typeof ui.title === 'string' && ui.title) title = canonicalSheetTitle(ui.title);

/* ---------- Toast (con azione facoltativa, es. Annulla) ---------- */
function toast(t, action) {
 const e = $('#toast');
 e.replaceChildren(el('span', '', t));
 if (action) {
 const b = el('button', 'toast-act', action.label);
 b.type = 'button';
 b.addEventListener('click', () => { clearTimeout(toastTimer); e.hidden = true; action.fn(); });
 e.append(b);
 }
 e.hidden = false;
 clearTimeout(toastTimer);
 toastTimer = setTimeout(() => { e.hidden = true; }, action ? 8000 : 3000);
}

/* ---------- Salvataggio locale ---------- */
function persist() {
 const ok = lsSet(LS_STATE, state) && lsSet(LS_EMP, employees);
 if (!ok && !storageWarned) toast('Memoria del dispositivo piena: la bozza NON è stata salvata. Pubblica o esporta i turni.');
 storageWarned = !ok;
}
function saveUi() {
 const g = $('#mainGridWrap');
 lsSet(LS_UI, { month, title, y: window.scrollY, x: g ? g.scrollLeft : 0, t: g ? g.scrollTop : 0 });
}
function flush() { clearTimeout(saveTimer); if (state) persist(); saveUi(); }
function onScroll() { clearTimeout(scrollTimer); scrollTimer = setTimeout(saveUi, 250); }
function invalidate() { catsCache = null; shiftIdx = null; }
function markDirty() {
 state.dirty = true;
 invalidate();
 clearTimeout(saveTimer);
 saveTimer = setTimeout(persist, 300);
 renderBar();
 renderMonthStats();
 renderCategoryNav();
 renderSummary();
}

// Istantanea per "Annulla" dopo un'eliminazione
const snapshot = () => JSON.stringify({ state, employees, title });
function restoreSnapshot(snap) {
 const o = JSON.parse(snap);
 state = o.state;
 employees = o.employees;
 title = o.title;
 setCustomTitles(state.customStructures);
 invalidate();
 persist();
 render();
 toast('Eliminazione annullata');
}
const undoAction = (snap) => ({ label: 'Annulla', fn: () => restoreSnapshot(snap) });

function getCategories() {
 if (catsCache) return catsCache;
 const delCats = new Set((state && state.deletedCategories) || []);
 const delTitles = new Set((state && state.deletedTitles) || []);

 const cats = BASE_CATEGORIES
 .filter((c) => !delCats.has(c.id))
 .map((c) => ({
 id: c.id,
 label: c.label,
 items: c.items.filter((x) => !delTitles.has(x.title)).map((x) => ({ ...x })),
 }));

 const knownTitles = new Set();
 cats.forEach((c) => c.items.forEach((it) => knownTitles.add(it.title)));

 const addItemToCat = (structTitle, catName) => {
 const t = canonicalSheetTitle(structTitle);
 if (!t || knownTitles.has(t) || delTitles.has(t)) return;
 let targetCat = catName ? normName(catName) : '';
 if (targetCat === 'PARCO CAFASSO') targetCat = 'PARCHI';
 if (!targetCat) targetCat = guessCategoryFromName(t) || 'PARCHI';
 if (delCats.has(targetCat)) return;

 knownTitles.add(t);
 let catObj = cats.find((c) => c.id === targetCat);
 if (!catObj) {
 catObj = { id: targetCat, label: targetCat, items: [] };
 cats.push(catObj);
 }
 catObj.items.push({ title: t, label: t, exportTitle: t });
 };

 if (state) {
 (state.customStructures || []).forEach((cs) => addItemToCat(cs.title, cs.category));
 (state.sheets || []).forEach((s) => addItemToCat(s.title, s.category));
 }
 catsCache = cats.filter((c) => c.items.length > 0);
 return catsCache;
}

function categoryOfTitle(t) {
 const ct = canonicalSheetTitle(t);
 const cats = getCategories();
 for (const c of cats) {
 if (c.items.some((it) => it.title === ct)) return c.id;
 }
 return guessCategoryFromName(ct) || (cats[0] ? cats[0].id : 'CAMPO SUD');
}

function allAvailableTitles() {
 const out = [];
 getCategories().forEach((c) => c.items.forEach((it) => out.push(it.title)));
 return out;
}

// Elimina un'intera Categoria e tutte le sue Postazioni
function deleteCategory(catId) {
 const cats = getCategories();
 if (cats.length <= 1) return toast('Deve rimanere almeno una categoria attiva');
 const target = cats.find((c) => c.id === catId);
 if (!target) return;
 if (!confirm('Eliminare la categoria "' + catId + '" e tutte le sue postazioni (' + target.items.map((x) => x.label).join(', ') + ') con i relativi turni?')) return;
 const snap = snapshot();

 if (!Array.isArray(state.deletedCategories)) state.deletedCategories = [];
 if (!state.deletedCategories.includes(catId)) state.deletedCategories.push(catId);

 const titlesToRemove = new Set(target.items.map((x) => x.title));
 if (!Array.isArray(state.deletedTitles)) state.deletedTitles = [];
 titlesToRemove.forEach((t) => {
 if (!state.deletedTitles.includes(t)) state.deletedTitles.push(t);
 });

 state.customStructures = (state.customStructures || []).filter((cs) => cs.category !== catId && !titlesToRemove.has(canonicalSheetTitle(cs.title)));
 state.sheets = (state.sheets || []).filter((s) => s.category !== catId && !titlesToRemove.has(canonicalSheetTitle(s.title)));

 employees.forEach((emp) => {
 const left = emp.cats.filter((c) => c !== catId);
 emp.cats = left.length ? left : emp.cats; // nessun dipendente resta senza campi
 });
 newEmpSelectedCats.delete(catId);
 if (!newEmpSelectedCats.size) getCategories().forEach((c) => newEmpSelectedCats.add(c.id));

 invalidate();
 const rem = allAvailableTitles();
 title = rem[0] || '';
 markDirty();
 render();
 toast('Categoria "' + catId + '" eliminata', undoAction(snap));
}

// Elimina una singola Postazione
function deletePostazione(postTitle) {
 const all = allAvailableTitles();
 if (all.length <= 1) return toast('Deve rimanere almeno una postazione attiva');
 const ct = canonicalSheetTitle(postTitle);
 if (!confirm('Eliminare la postazione "' + ct + '" con tutti i suoi turni?')) return;
 const snap = snapshot();

 if (!Array.isArray(state.deletedTitles)) state.deletedTitles = [];
 if (!state.deletedTitles.includes(ct)) state.deletedTitles.push(ct);

 state.customStructures = (state.customStructures || []).filter((cs) => canonicalSheetTitle(cs.title) !== ct);
 state.sheets = (state.sheets || []).filter((s) => canonicalSheetTitle(s.title) !== ct);

 invalidate();
 const rem = allAvailableTitles();
 if (title === ct) title = rem[0] || '';
 markDirty();
 render();
 toast('Postazione "' + ct + '" eliminata', undoAction(snap));
}

/* ---------- Fogli turni ---------- */
function sheetFor(t, m, create) {
 const nt = canonicalSheetTitle(t);
 let s = state.sheets.find((x) => canonicalSheetTitle(x.title) === nt && x.month === m);
 if (s) {
 s.title = nt;
 if (!s.category) s.category = categoryOfTitle(nt);
 return s;
 }
 if (!create) return null;
 const sameTitle = state.sheets
 .filter((x) => canonicalSheetTitle(x.title) === nt)
 .sort((a, b) => b.month.localeCompare(a.month));
 const ref = sameTitle[0];
 const cols = (ref && ref.cols && ref.cols.length ? ref.cols : DEFAULT_COLS).map((c) => ({ start: c.start, end: c.end, label: c.label || '' }));
 const cat = (ref && ref.category) || categoryOfTitle(nt);
 s = { title: nt, category: cat, month: m, cols, cells: {} };
 state.sheets.push(s);
 invalidate();
 return s;
}

function sheetHasData(t, m) {
 const s = sheetFor(t, m, false);
 if (!s) return false;
 return Object.entries(s.cells || {}).some(([date, arr]) => date.slice(0, 7) === m && (arr || []).some((v) => extractPureName(v)));
}

function colTheme(col) {
 if (/extra|continuat/i.test(col.label || '')) return 'col-c';
 const [sh, sm] = (col.start || '00:00').split(':').map(Number);
 const [eh, em] = (col.end || '00:00').split(':').map(Number);
 const sMin = sh * 60 + (sm || 0);
 let eMin = eh * 60 + (em || 0);
 if (eMin <= sMin) eMin += 1440;
 const dur = (eMin - sMin) / 60;
 if (dur >= 10) return 'col-c';
 if (eMin > 1440 || sh >= 20 || sh < 4) return 'col-n';
 if (sh < 12) return 'col-m';
 return 'col-p';
}

function extractPureName(raw) {
 const toks = String(raw || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
 const joined = toks.filter((t) => !HOUR_RE.test(t)).join(' ');
 if (!joined || RESERVED.has(joined)) return '';
 return joined;
}

function parseCellValue(raw) {
 const toks = String(raw || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
 let startHour = '', endHour = '';
 if (toks.length > 1 && HOUR_RE.test(toks[0])) startHour = toks.shift();
 if (toks.length > 1 && HOUR_RE.test(toks[toks.length - 1])) endHour = toks.pop();
 return { name: toks.join(' '), startHour, endHour };
}

function formatCellValue(name, startHour, endHour) {
 const n = normName(name);
 if (!n) return '';
 const parts = [];
 if (startHour && startHour.trim()) parts.push(startHour.trim());
 parts.push(n);
 if (endHour && endHour.trim()) parts.push(endHour.trim());
 return parts.join(' ');
}

// Popola la lista dipendenti dai turni SOLO se è vuota (primo avvio / dati storici):
// così un dipendente eliminato non ricompare da solo.
function bootstrapEmployeesFromSheets() {
 if (employees.length || !state) return;
 const byName = new Map();
 state.sheets.forEach((s) => {
 const sCat = s.category || categoryOfTitle(s.title);
 Object.values(s.cells || {}).forEach((arr) => (arr || []).forEach((val) => {
 const nm = extractPureName(val);
 if (!nm || nm.length < 2) return;
 const emp = byName.get(nm) || { name: nm, cats: [] };
 if (sCat && !emp.cats.includes(sCat)) emp.cats.push(sCat);
 byName.set(nm, emp);
 }));
 });
 employees = [...byName.values()].map((e) => ({ ...e, cats: e.cats.length ? e.cats : [...ALL_BASE_CATS] }))
 .sort((a, b) => a.name.localeCompare(b.name, 'it'));
 if (employees.length) lsSet(LS_EMP, employees);
}

/* ---------- Indice turni: sovrapposizioni e riposi ---------- */
function cellInterval(col, raw, iso) {
 const p = parseCellValue(raw);
 let s = hourToMin(p.startHour); if (s === null) s = hourToMin(col.start);
 let e = hourToMin(p.endHour); if (e === null) e = hourToMin(col.end);
 if (s === null || e === null) return null;
 if (e <= s) e += 1440;
 const base = dayNum(iso) * 1440;
 return { a: base + s, b: base + e };
}

// Mappa nome -> turni nel mese selezionato e in quelli adiacenti (per i riposi a cavallo)
function getShiftIdx() {
 if (shiftIdx && shiftIdx.month === month) return shiftIdx.map;
 const months = new Set([shiftMonth(month, -1), month, shiftMonth(month, 1)]);
 const active = new Set(allAvailableTitles());
 const map = new Map();
 state.sheets.forEach((s) => {
 if (!months.has(s.month) || !active.has(canonicalSheetTitle(s.title))) return;
 Object.entries(s.cells || {}).forEach(([iso, arr]) => {
 if (iso.slice(0, 7) !== s.month) return;
 (arr || []).forEach((raw, i) => {
 const name = extractPureName(raw);
 const col = s.cols[i];
 if (!name || !col) return;
 const iv = cellInterval(col, raw, iso);
 if (!iv) return;
 const list = map.get(name) || [];
 list.push({ ...iv, iso, title: s.title, key: s.title + '|' + iso + '|' + i, month: s.month });
 map.set(name, list);
 });
 });
 });
 shiftIdx = { month, map };
 return map;
}

function conflictsFor(name, iv, selfKey) {
 const out = { overlap: [], rest: [] };
 if (!name || !iv) return out;
 (getShiftIdx().get(name) || []).forEach((o) => {
 if (o.key === selfKey) return;
 if (iv.a < o.b && o.a < iv.b) out.overlap.push(o);
 else {
 const gap = iv.a >= o.b ? iv.a - o.b : o.a - iv.b;
 if (gap < MIN_REST_H * 60) out.rest.push({ ...o, gap });
 }
 });
 return out;
}
const shiftDesc = (o) => o.title + ' ' + +o.iso.slice(8) + '/' + +o.iso.slice(5, 7) + ' ' + minToHHMM(o.a) + '–' + minToHHMM(o.b);
function conflictText(c) {
 if (c.overlap.length) return 'Sovrapposto a: ' + c.overlap.map(shiftDesc).join('; ');
 if (c.rest.length) return 'Riposo inferiore a ' + MIN_REST_H + 'h (' + c.rest.map((o) => Math.round(o.gap / 6) / 10 + 'h con ' + shiftDesc(o)).join('; ') + ')';
 return '';
}

/* ---------- Pubblicazione: formato compatibile con l'app dei turnisti ---------- */
function toDocs() {
 const minM = shiftMonth(ym(new Date()), -KEEP_MONTHS);
 const delTitles = new Set((state && state.deletedTitles) || []);
 const delCats = new Set((state && state.deletedCategories) || []);

 const validSheets = state.sheets.filter((s) => {
 const ct = canonicalSheetTitle(s.title);
 const cat = s.category || categoryOfTitle(ct);
 return s.month >= minM && !delTitles.has(ct) && !delCats.has(cat);
 });

 return validSheets.map((s) => {
 const [y, mo] = s.month.split('-').map(Number);
 const cols = s.cols.map((c) => ({ start: c.start, end: c.end, label: c.label || '' }));
 const rows = [];
 for (let d = 1; d <= daysIn(s.month); d++) {
 const key = isoDay(s.month, d);
 const cStd = (s.cells && s.cells[key]) || [];
 rows.push({ date: key, cells: cols.map((_, i) => String(cStd[i] || '').trim().replace(/\s+/g, ' ')) });
 }
 return {
 id: s.title + ' ' + MES3[mo - 1] + '-' + String(y).slice(2),
 title: exportTitleForClients(s.title),
 uiTitle: s.title,
 category: s.category || categoryOfTitle(s.title),
 month: s.month,
 cols,
 rows,
 };
 }).filter((d) => d.rows.some((r) => r.cells.some((x) => x)));
}

// Impronta per mese dei documenti pubblicati: serve a dire nell'avviso solo i mesi cambiati
function monthSigs(docs) {
 const by = {};
 docs.forEach((d) => { (by[d.month] = by[d.month] || []).push(d); });
 const out = {};
 Object.keys(by).forEach((m) => { out[m] = JSON.stringify(by[m].sort((a, b) => a.id.localeCompare(b.id))); });
 return out;
}
function changedMonths(docs, oldSigs) {
 const cur = ym(new Date());
 const now = monthSigs(docs);
 let ms = Object.keys(now);
 if (oldSigs && typeof oldSigs === 'object') {
 ms = [...new Set([...Object.keys(now), ...Object.keys(oldSigs)])].filter((m) => now[m] !== oldSigs[m]);
 }
 ms.sort();
 const future = ms.filter((m) => m >= cur);
 return future.length ? future : (ms.length ? ms : [month]);
}
function monthsLabel(ms) {
 const names = ms.map((m) => monthName(m).toLowerCase());
 return names.length > 1 ? names.slice(0, -1).join(', ') + ' e ' + names[names.length - 1] : names[0];
}

function fromDocs(docs, delCats = [], delTitles = []) {
 const map = new Map();
 const delC = new Set(delCats);
 const delT = new Set(delTitles);

 (docs || []).forEach((d) => {
 const t = canonicalSheetTitle(d.uiTitle || d.title || d.id);
 if (!t || delT.has(t) || !Array.isArray(d.rows)) return;
 const cat = d.category === 'PARCO CAFASSO' ? 'PARCHI' : (d.category || categoryOfTitle(t));
 if (delC.has(cat)) return;

 const rowsByMonth = {};
 d.rows.forEach((r) => {
 if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) return;
 const m = r.date.slice(0, 7);
 (rowsByMonth[m] = rowsByMonth[m] || []).push(r);
 });

 Object.entries(rowsByMonth).forEach(([m, mRows]) => {
 const rawCols = Array.isArray(d.cols) && d.cols.length ? d.cols : DEFAULT_COLS;
 const cols = rawCols.map((c) => ({ start: c.start, end: c.end, label: c.label || '' }));
 const cells = {};
 mRows.forEach((r) => {
 const arr = cols.map((_, i) => (r.cells && r.cells[i]) || '');
 if (arr.some((x) => x)) cells[r.date] = arr;
 });
 map.set(t + '|' + m, { title: t, category: cat, month: m, cols, cells });
 });
 });
 return [...map.values()];
}

async function api(path, opt) {
 return fetch(API + path, { ...opt, headers: { ...(opt && opt.headers), authorization: 'Bearer ' + pw } });
}
async function fetchSchedule() {
 const r = await fetch(API + '/api/schedule', { cache: 'no-store' });
 if (!r.ok) throw new Error('server ' + r.status);
 return r.json();
}

function applyRemote(d) {
 if (Array.isArray(d.employees) && d.employees.length) employees = normalizeEmployees(d.employees);
 const custom = Array.isArray(d.customStructures) ? d.customStructures : (state && state.customStructures) || [];
 setCustomTitles(custom);
 const delCats = Array.isArray(d.deletedCategories) ? d.deletedCategories : (state && state.deletedCategories) || [];
 const delTitles = Array.isArray(d.deletedTitles) ? d.deletedTitles : (state && state.deletedTitles) || [];
 const old = state || emptyState();
 state = {
 ...emptyState(),
 sheets: fromDocs(d.docs || [], delCats, delTitles),
 customStructures: custom,
 deletedCategories: delCats,
 deletedTitles: delTitles,
 // un avviso rimasto in sospeso non va perso ricaricando
 noticePending: !!old.noticePending,
 noticeCursor: old.noticeCursor || null,
 noticeBody: old.noticeBody || '',
 noticeSent: old.noticeSent || 0,
 };
 invalidate();
 bootstrapEmployeesFromSheets();
 lsSet(LS_PUB, { version: d.version, months: monthSigs(toDocs()) });
 remoteNewer = false;
 persist();
}
async function loadRemote() { applyRemote(await fetchSchedule()); }

// Controlla se un altro dispositivo ha pubblicato dopo il nostro ultimo caricamento
async function checkRemote() {
 if (!API || !pw || !state) return;
 lastRemoteCheck = Date.now();
 let d;
 try { d = await fetchSchedule(); } catch { return; }
 const pub = lsGet(LS_PUB, {}) || {};
 if (!d || d.version == null || String(d.version) === String(pub.version)) {
 if (remoteNewer) { remoteNewer = false; renderBar(); }
 return;
 }
 if (!state.dirty) {
 closeCellPicker();
 applyRemote(d);
 render();
 toast('Caricata l\'ultima versione pubblicata');
 } else {
 remoteNewer = true;
 renderBar();
 toast('Attenzione: un altro dispositivo ha pubblicato turni più recenti della tua bozza');
 }
}

async function sendNotice() {
 const body = state.noticeBody || 'Il responsabile ha aggiornato i turni.';
 for (let i = 0; i < 40; i++) {
 const r = await api('/api/notify', {
 method: 'POST',
 headers: { 'content-type': 'application/json' },
 body: JSON.stringify({ title: 'Turni aggiornati', body, cursor: state.noticeCursor || null }),
 });
 if (r.status === 401) { logout(true); throw new Error('auth'); }
 if (!r.ok) throw new Error('notify ' + r.status);
 const d = await r.json();
 state.noticeSent = (state.noticeSent || 0) + (+d.sent || 0);
 if (d.done) {
 const n = state.noticeSent;
 Object.assign(state, { noticePending: false, noticeCursor: null, noticeSent: 0, noticeBody: '' });
 persist();
 return n;
 }
 // salva il punto raggiunto: un nuovo tentativo riparte da qui, senza doppioni
 state.noticeCursor = d.cursor;
 persist();
 }
 throw new Error('notify incomplete');
}

async function publish() {
 const btn = $('#pubBtn'), btnTxt = $('#pubBtnTxt');
 btn.disabled = true;
 btnTxt.textContent = state.dirty ? 'Pubblicazione…' : 'Invio avviso…';
 try {
 flush();
 if (state.dirty) {
 const pub = lsGet(LS_PUB, {}) || {};
 const remote = await fetchSchedule();
 if (remote && remote.version != null && String(remote.version) !== String(pub.version)) {
 if (!confirm('Attenzione: sul server ci sono turni pubblicati da un altro dispositivo DOPO il tuo ultimo caricamento.\n\nPubblicando sovrascriverai quelle modifiche. Continuare?\n\n(Annulla e usa "Ricarica dal server" per vederle prima.)')) {
 remoteNewer = true;
 return;
 }
 }
 const docs = toDocs();
 const months = changedMonths(docs, pub.months);
 const r = await api('/api/schedule', {
 method: 'PUT',
 headers: { 'content-type': 'application/json' },
 body: JSON.stringify({
 docs,
 employees,
 customStructures: state.customStructures || [],
 deletedCategories: state.deletedCategories || [],
 deletedTitles: state.deletedTitles || [],
 baseVersion: pub.version == null ? null : pub.version,
 }),
 });
 if (r.status === 401) { logout(true); return; }
 if (r.status === 409) { remoteNewer = true; toast('Il server ha rifiutato: ci sono turni più recenti. Usa "Ricarica dal server".'); return; }
 if (!r.ok) throw new Error('server ' + r.status);
 const d = await r.json().catch(() => ({}));
 Object.assign(state, {
 dirty: false, noticePending: true, noticeCursor: null, noticeSent: 0,
 noticeBody: 'Il responsabile ha pubblicato i turni di ' + monthsLabel(months) + '.',
 });
 remoteNewer = false;
 lsSet(LS_PUB, { version: d.version, months: monthSigs(docs) });
 persist();
 }
 if (state.noticePending) {
 try {
 const n = await sendNotice();
 toast('Pubblicato · avviso inviato a ' + n + (n === 1 ? ' persona' : ' persone'));
 } catch {
 if (pw) toast('Turni pubblicati, ma l\'avviso non è partito del tutto: tocca "Invia avviso" per riprendere');
 }
 }
 } catch {
 toast('Errore di rete: riprova');
 } finally {
 renderBar();
 }
}

/* ---------- Riepilogo del mese selezionato ---------- */
function renderMonthStats() {
 const [y, mo] = month.split('-').map(Number);
 const curMonth = ym(new Date());
 const mbar = $('.mbar');
 const badge = $('#mStateBadge');

 mbar.classList.remove('past-month', 'future-month');
 if (month < curMonth) {
 mbar.classList.add('past-month');
 badge.textContent = 'Archivio mese concluso · ' + MESI[mo - 1] + ' ' + y;
 } else if (month > curMonth) {
 mbar.classList.add('future-month');
 badge.textContent = 'Pianificazione futura · ' + MESI[mo - 1] + ' ' + y;
 } else {
 badge.textContent = 'Mese in corso · ' + MESI[mo - 1] + ' ' + y;
 }

 const activeTitles = new Set(allAvailableTitles());
 const monthSheets = state.sheets.filter((s) => s.month === month && activeTitles.has(canonicalSheetTitle(s.title)));
 let totalAssigned = 0, activeSheets = 0;
 const uniqueOps = new Set();

 monthSheets.forEach((s) => {
 let has = false;
 Object.entries(s.cells || {}).forEach(([date, arr]) => {
 if (date.slice(0, 7) !== month) return;
 (arr || []).forEach((val) => {
 const nm = extractPureName(val);
 if (nm) { totalAssigned++; has = true; uniqueOps.add(nm); }
 });
 });
 if (has) activeSheets++;
 });

 const mk = (v, l) => {
 const d = el('div', 'mstat');
 d.append(el('b', '', String(v)), el('span', '', l));
 return d;
 };
 $('#mStats').replaceChildren(
 mk(activeSheets + ' / ' + activeTitles.size, 'Postazioni compilate in ' + MES3[mo - 1]),
 mk(totalAssigned, 'Turni assegnati in ' + MES3[mo - 1]),
 mk(uniqueOps.size, 'Operatori in ' + MES3[mo - 1])
 );
}

/* ---------- Navigazione: Categorie -> Postazioni ---------- */
function makeTab(label, isOn, hasData, dotTitle, count, onSelect, delLabel, onDelete) {
 const wrap = el('div', 'tab-wrap' + (isOn ? ' on' : ''));
 const b = el('button', 'tab');
 b.type = 'button';
 b.setAttribute('role', 'tab');
 b.setAttribute('aria-selected', String(isOn));
 b.append(el('span', '', label));
 if (count !== undefined) b.append(el('span', 'cat-cnt', String(count)));
 if (hasData) {
 const dot = el('i', 'tab-dot');
 dot.title = dotTitle;
 b.append(dot);
 }
 b.addEventListener('click', onSelect);
 wrap.append(b);
 // Il pulsante elimina compare solo sulla scheda attiva: niente eliminazioni per sbaglio
 if (isOn) {
 const delBtn = el('button', 'tab-del', '✕');
 delBtn.type = 'button';
 delBtn.title = delLabel;
 delBtn.setAttribute('aria-label', delLabel);
 delBtn.addEventListener('click', (e) => { e.stopPropagation(); onDelete(); });
 wrap.append(delBtn);
 }
 return wrap;
}

function renderCategoryNav() {
 const cats = getCategories();
 if (!cats.length) return;
 activeCat = categoryOfTitle(title);
 const curCatObj = cats.find((c) => c.id === activeCat) || cats[0];

 $('#catTabs').replaceChildren(...cats.map((c) => makeTab(
 c.label, c.id === curCatObj.id,
 c.items.some((it) => sheetHasData(it.title, month)), 'Contiene turni compilati in questo mese',
 c.items.length,
 () => {
 activeCat = c.id;
 if (!c.items.some((it) => it.title === title)) title = c.items[0].title;
 render();
 },
 'Elimina categoria ' + c.label, () => deleteCategory(c.id)
 )));

 $('#subNavLabel').textContent = '2. Postazioni in ' + curCatObj.label + ':';
 $('#subTabs').replaceChildren(...curCatObj.items.map((it) => makeTab(
 it.label, it.title === title, sheetHasData(it.title, month), 'Turni presenti', undefined,
 () => { title = it.title; render(); },
 'Elimina postazione ' + it.label, () => deletePostazione(it.title)
 )));
 $('#subNavBlock').hidden = false;
}

/* ---------- Pannello (bottom sheet) ---------- */
function openSheet(triggerBtn, focusEl) {
 $('#pickerSheet').hidden = false;
 document.body.classList.add('lock');
 setTimeout(() => (focusEl || $('#pkPanel')).focus(), 50);
}
function closeCellPicker() {
 if (!activePicker) return;
 const btn = activePicker.triggerBtn;
 activePicker = null;
 $('#pickerSheet').hidden = true;
 document.body.classList.remove('lock');
 if (btn && btn.isConnected) btn.focus();
}

/* ---------- Modal: Aggiungi Nuova Postazione ---------- */
function openAddPostazioneModal(triggerBtn) {
 activePicker = { triggerBtn };
 $('#pkTitle').textContent = 'Aggiungi nuova postazione';
 $('#pkSub').textContent = 'Inserisci il nome e scegli la categoria (es. Parchi, Campo Sud, Campo Nord)';

 const body = $('#pkBody');
 body.replaceChildren();

 const form = el('form', 'struct-form');
 const nameField = el('div', 'struct-field');
 const nameLbl = el('label', '', 'Nome della postazione');
 nameLbl.htmlFor = 'newPostName';
 const nameInp = el('input');
 nameInp.id = 'newPostName';
 nameInp.type = 'text';
 nameInp.placeholder = 'Es. PARCO SAN GENNARO';
 nameInp.autocapitalize = 'characters';
 nameInp.spellcheck = false;
 nameInp.maxLength = 60;
 nameField.append(nameLbl, nameInp);

 const suggestBadge = el('div', 'suggest-badge');
 suggestBadge.hidden = true;

 const catField = el('div', 'struct-field');
 catField.append(el('label', '', 'Categoria di appartenenza'));
 const catGrid = el('div', 'struct-cats');

 const existingCats = [...new Set([...ALL_BASE_CATS, ...getCategories().map((c) => c.id)])];
 let chosenCat = activeCat || 'PARCHI';
 let manualCatOverride = false;

 const customCatField = el('div', 'struct-field');
 customCatField.hidden = true;
 const ccLbl = el('label', '', 'Nome della nuova categoria');
 ccLbl.htmlFor = 'newCatName';
 const customCatInp = el('input');
 customCatInp.id = 'newCatName';
 customCatInp.type = 'text';
 customCatInp.placeholder = 'Es. VIGILANZA EVENTI';
 customCatInp.maxLength = 40;
 customCatField.append(ccLbl, customCatInp);

 const renderCatButtons = () => {
 catGrid.replaceChildren();
 existingCats.forEach((cid) => {
 const btn = el('button', 'struct-cat-btn' + (chosenCat === cid ? ' on' : ''));
 btn.type = 'button';
 btn.setAttribute('aria-pressed', String(chosenCat === cid));
 const desc = cid === 'PARCHI' ? 'Tutti i parchi (es. Cafasso, ecc.)' : (cid === 'CAMPO SUD' ? 'Gabbiotto, Ronda, Sud Rom' : (cid === 'CAMPO NORD' ? 'Gabbiotto, Ronda Nord/Sud' : 'Categoria personalizzata'));
 btn.append(el('b', '', cid), el('span', '', desc));
 btn.addEventListener('click', () => {
 chosenCat = cid;
 manualCatOverride = true;
 customCatField.hidden = true;
 renderCatButtons();
 });
 catGrid.append(btn);
 });
 const newBtn = el('button', 'struct-cat-btn' + (chosenCat === '__NEW__' ? ' on' : ''));
 newBtn.type = 'button';
 newBtn.append(el('b', '', '+ Nuova categoria'), el('span', '', 'Crea un nuovo gruppo'));
 newBtn.addEventListener('click', () => {
 chosenCat = '__NEW__';
 manualCatOverride = true;
 customCatField.hidden = false;
 renderCatButtons();
 customCatInp.focus();
 });
 catGrid.append(newBtn);
 };

 nameInp.addEventListener('input', () => {
 const guessed = guessCategoryFromName(nameInp.value);
 if (guessed && !manualCatOverride) {
 chosenCat = guessed;
 customCatField.hidden = true;
 suggestBadge.textContent = '✓ Categoria suggerita automaticamente dal nome: ' + guessed;
 suggestBadge.hidden = false;
 renderCatButtons();
 } else if (!guessed) {
 suggestBadge.hidden = true;
 }
 });

 renderCatButtons();
 catField.append(catGrid);

 const submitBtn = el('button', 'big', 'Aggiungi postazione');
 submitBtn.type = 'submit';

 form.append(nameField, suggestBadge, catField, customCatField, submitBtn);
 form.addEventListener('submit', (e) => {
 e.preventDefault();
 // Il nome resta esattamente quello scritto (solo maiuscole/spazi): niente fusioni con postazioni esistenti
 const postName = normTitle(nameInp.value);
 if (!postName) return toast('Inserisci il nome della postazione');
 if (allAvailableTitles().includes(postName)) {
 title = postName;
 closeCellPicker();
 render();
 return toast('La postazione "' + postName + '" esiste già: l\'ho aperta');
 }
 const finalCat = chosenCat === '__NEW__' ? normName(customCatInp.value) : chosenCat;
 if (!finalCat) return toast('Scegli o scrivi una categoria');

 state.deletedCategories = (state.deletedCategories || []).filter((c) => c !== finalCat);
 state.deletedTitles = (state.deletedTitles || []).filter((t) => t !== postName);
 if (!Array.isArray(state.customStructures)) state.customStructures = [];
 state.customStructures = state.customStructures.filter((x) => normTitle(x.title) !== postName);
 state.customStructures.push({ title: postName, category: finalCat });
 setCustomTitles(state.customStructures);
 invalidate();

 const sh = sheetFor(postName, month, true);
 sh.category = finalCat;
 title = postName;
 activeCat = finalCat;
 markDirty();
 closeCellPicker();
 render();
 toast('Postazione "' + postName + '" aggiunta in ' + finalCat);
 });

 body.append(form);
 openSheet(triggerBtn, nameInp);
}

/* ---------- Lista Dipendenti con Campi assegnati ---------- */
function renderEmployees() {
 const cats = getCategories().map((c) => c.id);

 $('#empNewCats').replaceChildren(...cats.map((cid) => {
 const on = newEmpSelectedCats.has(cid);
 const b = el('button', 'cat-chk' + (on ? ' on' : ''), (on ? '✓ ' : '') + cid);
 b.type = 'button';
 b.setAttribute('aria-pressed', String(on));
 b.addEventListener('click', () => {
 if (newEmpSelectedCats.has(cid)) {
 if (newEmpSelectedCats.size > 1) newEmpSelectedCats.delete(cid);
 } else newEmpSelectedCats.add(cid);
 renderEmployees();
 });
 return b;
 }));

 $('#empCountLbl').textContent = employees.length
 ? employees.length + (employees.length === 1 ? ' dipendente salvato' : ' dipendenti salvati')
 : 'Nessun dipendente salvato (clicca Gestisci)';

 const list = $('#empList');
 list.replaceChildren();
 if (!employees.length) {
 list.append(el('span', 'hint', 'Aggiungi i dipendenti qui sopra e scegli a quali campi sono assegnati (es. Campo Nord, Campo Sud, Parchi).'));
 return;
 }

 employees.forEach((emp) => {
 const row = el('div', 'emp-row');
 row.append(el('span', 'emp-name', emp.name));

 const tagsBox = el('div', 'emp-row-cats');
 cats.forEach((cid) => {
 const isAssigned = emp.cats.includes(cid);
 const tag = el('button', 'emp-cat-tag' + (isAssigned ? ' on' : ''), (isAssigned ? '✓ ' : '') + cid);
 tag.type = 'button';
 tag.setAttribute('aria-pressed', String(isAssigned));
 tag.title = isAssigned ? 'Rimuovi ' + emp.name + ' da ' + cid : 'Assegna ' + emp.name + ' a ' + cid;
 tag.addEventListener('click', () => {
 if (isAssigned) {
 if (emp.cats.length <= 1) return toast('Il dipendente deve avere almeno un campo assegnato');
 emp.cats = emp.cats.filter((c) => c !== cid);
 } else emp.cats.push(cid);
 markDirty();
 renderEmployees();
 });
 tagsBox.append(tag);
 });

 const del = el('button', 'emp-del', '✕');
 del.type = 'button';
 del.title = 'Elimina ' + emp.name;
 del.setAttribute('aria-label', 'Elimina ' + emp.name);
 del.addEventListener('click', () => {
 const snap = snapshot();
 employees = employees.filter((x) => x.name !== emp.name);
 markDirty();
 renderEmployees();
 toast(emp.name + ' rimosso dalla lista (i turni già assegnati restano)', undoAction(snap));
 });

 row.append(tagsBox, del);
 list.append(row);
 });
}

/* ---------- Riepilogo per dipendente (mese selezionato) ---------- */
function renderSummary() {
 const box = $('#sumBody');
 if (!box || !state) return;
 const idx = getShiftIdx();
 const rows = [];
 idx.forEach((list, name) => {
 const mine = list.filter((o) => o.month === month);
 if (!mine.length) return;
 let mins = 0, warn = 0;
 mine.forEach((o) => {
 mins += o.b - o.a;
 const c = conflictsFor(name, o, o.key);
 if (c.overlap.length || c.rest.length) warn++;
 });
 rows.push({ name, n: mine.length, h: mins / 60, warn });
 });
 rows.sort((a, b) => b.h - a.h || a.name.localeCompare(b.name, 'it'));
 $('#sumSub').textContent = rows.length
 ? rows.length + ' operatori · ' + MESI[+month.slice(5) - 1] + ' (tutte le postazioni)'
 : 'Nessun turno in ' + MESI[+month.slice(5) - 1];
 if (!rows.length) { box.replaceChildren(); return; }
 const t = el('table', 'sum-table');
 const hr = el('tr');
 ['Dipendente', 'Turni', 'Ore', 'Avvisi'].forEach((h) => hr.append(el('th', '', h)));
 const thead = el('thead'); thead.append(hr);
 const tb = el('tbody');
 rows.forEach((r) => {
 const tr = el('tr');
 tr.append(el('td', '', r.name), el('td', 'num', String(r.n)), el('td', 'num', String(Math.round(r.h * 10) / 10).replace('.', ',')));
 const w = el('td', 'num' + (r.warn ? ' warn' : ''), r.warn ? '⚠ ' + r.warn : '—');
 if (r.warn) w.title = r.warn + ' turni con sovrapposizioni o riposo inferiore a ' + MIN_REST_H + 'h';
 tr.append(w);
 tb.append(tr);
 });
 t.append(thead, tb);
 box.replaceChildren(t);
}

/* ---------- Selettore Rapido Dipendente ---------- */
function openCellPicker(sheet, key, colIdx, triggerBtn, showAllCats = false, draftHours = null) {
 const cols = sheet.cols;
 const cellMap = sheet.cells;
 const col = cols[colIdx];
 const curRaw = (cellMap[key] && cellMap[key][colIdx]) || '';
 const parsed = parseCellValue(curRaw);
 const [y, mo, d] = key.split('-').map(Number);
 const dow = new Date(y, mo - 1, d).getDay();
 const sheetCat = sheet.category || categoryOfTitle(sheet.title);
 const selfKey = sheet.title + '|' + key + '|' + colIdx;

 activePicker = { sheet, key, colIdx, triggerBtn, parsed };
 $('#pkTitle').textContent = GG[dow] + ' ' + d + ' ' + MESI[mo - 1] + ' · ' + col.start + '–' + col.end;
 $('#pkSub').textContent = sheet.title + ' (' + sheetCat + ')' + (col.label ? ' · ' + col.label : '');

 const body = $('#pkBody');
 body.replaceChildren();

 // Legge e valida gli orari personalizzati
 const readHours = () => {
 const s = hStart.inp.value.trim().replace('.', ':'), e = hEnd.inp.value.trim().replace('.', ':');
 if ((s && hourToMin(s) === null) || (e && hourToMin(e) === null)) {
 toast('Orario non valido: scrivi ad es. 18 oppure 18:30');
 return null;
 }
 return [s, e];
 };

 const setCellValue = (newVal) => {
 const v = normName(newVal);
 const p = parseCellValue(v);
 if ((p.startHour && hourToMin(p.startHour) === null) || (p.endHour && hourToMin(p.endHour) === null)) {
 return toast('Orario non valido nella casella: usa ad es. 18 oppure 18:30');
 }
 const pure = extractPureName(v);
 let addedEmp = false;
 if (pure && pure.length >= 2 && !employees.some((x) => x.name === pure)) {
 if (confirm('"' + pure + '" non è nella lista dipendenti.\n\nOK = aggiungilo ai dipendenti di ' + sheetCat + '\nAnnulla = scrivilo solo in questa casella')) {
 employees.push({ name: pure, cats: [sheetCat] });
 employees.sort((a, b) => a.name.localeCompare(b.name, 'it'));
 addedEmp = true;
 }
 }
 const arr = cellMap[key] || (cellMap[key] = []);
 while (arr.length < cols.length) arr.push('');
 arr[colIdx] = v;
 if (!arr.some((x) => x)) delete cellMap[key];
 markDirty();
 if (addedEmp) renderEmployees();
 renderAllGrids(sheet);
 closeCellPicker();
 };

 if (curRaw) {
 const curBox = el('div', 'pk-current');
 const left = el('div');
 left.append(el('span', 'q', 'Attualmente assegnato'), el('b', '', curRaw));
 const clr = el('button', 'pk-clear', 'Svuota casella');
 clr.type = 'button';
 clr.addEventListener('click', () => setCellValue(''));
 curBox.append(left, clr);
 body.append(curBox);
 const curConf = conflictText(conflictsFor(extractPureName(curRaw), cellInterval(col, curRaw, key), selfKey));
 if (curConf) body.append(el('p', 'pk-warn', '⚠ ' + curConf));
 }

 const hrsBox = el('div', 'pk-hours');
 const mkHr = (lbl, ph, initVal, id) => {
 const w = el('div');
 const l = el('label', '', lbl);
 l.htmlFor = id;
 const inp = el('input');
 inp.id = id;
 inp.type = 'text';
 inp.inputMode = 'decimal';
 inp.placeholder = ph;
 inp.value = initVal;
 inp.maxLength = 5;
 w.append(l, inp);
 return { w, inp };
 };
 const hStart = mkHr('Inizio personalizzato (opz.)', 'Es. 18', draftHours ? draftHours[0] : parsed.startHour, 'pkHStart');
 const hEnd = mkHr('Fine / Prolungamento (opz.)', 'Es. 18', draftHours ? draftHours[1] : parsed.endHour, 'pkHEnd');
 hrsBox.append(hStart.w, hEnd.w);

 const assignedEmps = employees.filter((e) => e.cats.includes(sheetCat));
 const otherEmps = employees.filter((e) => !e.cats.includes(sheetCat));
 const visibleEmps = showAllCats ? employees : assignedEmps;

 body.append(el('p', 'q', showAllCats ? 'Tutti i dipendenti (' + employees.length + ')' : 'Dipendenti assegnati a ' + sheetCat + ' (' + assignedEmps.length + ')'));
 const grid = el('div', 'pk-grid');
 const baseIv = cellInterval(col, formatCellValue('X', hStart.inp.value, hEnd.inp.value), key);

 visibleEmps.forEach((empObj) => {
 const emp = empObj.name;
 const isCur = parsed.name === emp;
 const c = conflictsFor(emp, baseIv, selfKey);
 const cls = isCur ? ' active' : (c.overlap.length ? ' conflict' : (c.rest.length ? ' warn' : ''));
 const btn = el('button', 'pk-emp' + cls);
 btn.type = 'button';
 btn.append(el('b', '', emp));
 let info = 'Disponibile · ' + empObj.cats.join(', ');
 if (c.overlap.length) info = '⚠ Già in: ' + shiftDesc(c.overlap[0]);
 else if (c.rest.length) info = '⚠ Riposo ' + Math.round(c.rest[0].gap / 6) / 10 + 'h: ' + shiftDesc(c.rest[0]);
 if (isCur) info = 'Selezionato ✓';
 btn.append(el('span', '', info));
 if (c.overlap.length || c.rest.length) btn.title = conflictText(c);
 btn.addEventListener('click', () => {
 const h = readHours();
 if (!h) return;
 if (c.overlap.length && !isCur && !confirm(emp + ' risulta già in servizio in quell\'orario:\n' + c.overlap.map(shiftDesc).join('\n') + '\n\nAssegnare comunque?')) return;
 setCellValue(formatCellValue(emp, h[0], h[1]));
 });
 grid.append(btn);
 });

 const noBtn = el('button', 'pk-emp' + (curRaw === 'NO' ? ' active' : ''));
 noBtn.type = 'button';
 noBtn.append(el('b', '', 'NO'), el('span', '', 'Turno scoperto / non attivo'));
 noBtn.addEventListener('click', () => setCellValue('NO'));
 grid.append(noBtn);
 body.append(grid);

 if (!assignedEmps.length && !showAllCats) {
 body.append(el('p', 'none', 'Nessun dipendente assegnato a "' + sheetCat + '". Puoi abilitarli nella sezione "Lista dipendenti e campi" oppure mostrare quelli di altri settori qui sotto.'));
 }

 if (otherEmps.length > 0) {
 const toggleOther = el('button', 'linkbtn', showAllCats
 ? '▲ Mostra solo dipendenti di ' + sheetCat
 : '▼ Mostra anche dipendenti di altri campi (' + otherEmps.length + ' nascosti)');
 toggleOther.type = 'button';
 toggleOther.addEventListener('click', () => openCellPicker(sheet, key, colIdx, triggerBtn, !showAllCats, [hStart.inp.value, hEnd.inp.value]));
 body.append(toggleOther);
 }

 body.append(el('p', 'q', 'Orario continuativo, ridotto o prolungato (facoltativo)'));
 body.append(hrsBox);
 if (parsed.name && parsed.name !== 'NO') {
 const applyHrs = el('button', 'ghost', 'Aggiorna orario per ' + parsed.name);
 applyHrs.type = 'button';
 applyHrs.addEventListener('click', () => {
 const h = readHours();
 if (h) setCellValue(formatCellValue(parsed.name, h[0], h[1]));
 });
 body.append(applyHrs);
 }

 body.append(el('p', 'q', 'Oppure scrivi un nome manualmente (verrà assegnato a ' + sheetCat + ')'));
 const manualForm = el('form', 'row');
 const manualInp = el('input');
 manualInp.type = 'text';
 manualInp.placeholder = 'Scrivi nome (es. ROSSI M. o ROSSI M. 18)';
 manualInp.setAttribute('aria-label', 'Nome manuale');
 manualInp.value = curRaw;
 manualInp.autocapitalize = 'characters';
 manualInp.spellcheck = false;
 manualInp.maxLength = 60;
 const manualBtn = el('button', '', 'Imposta');
 manualBtn.type = 'submit';
 manualForm.append(manualInp, manualBtn);
 manualForm.addEventListener('submit', (e) => {
 e.preventDefault();
 setCellValue(manualInp.value);
 });
 body.append(manualForm);

 openSheet(triggerBtn);
}

/* ---------- Dock di Pubblicazione ---------- */
function renderBar() {
 const pub = lsGet(LS_PUB, null);
 const bar = $('#pubbar'), ttl = $('#pubTitle'), st = $('#pubStatus');
 const pending = !!state.noticePending;
 const needsAction = !!(state.dirty || pending);

 bar.classList.toggle('is-dirty', needsAction);
 bar.classList.toggle('is-conflict', remoteNewer && !!state.dirty);
 if (state.dirty && remoteNewer) {
 ttl.textContent = 'Attenzione: il server ha turni più recenti';
 st.textContent = 'Un altro dispositivo ha pubblicato · pubblicando li sovrascrivi';
 } else if (state.dirty) {
 ttl.textContent = 'Modifiche in bozza da pubblicare';
 st.textContent = 'Salvate sul dispositivo · premi Pubblica turni per inviarle a tutti';
 } else if (pending) {
 ttl.textContent = 'Avviso push in sospeso';
 st.textContent = 'Turni pubblicati, ma la notifica non è partita del tutto · riprova';
 } else if (pub && pub.version) {
 const d = new Date(pub.version);
 ttl.textContent = 'Tutti i turni sono pubblicati e sincronizzati';
 st.textContent = isNaN(d) ? 'Ultima versione pubblicata caricata' : 'Ultimo invio il ' + d.getDate() + ' ' + MES3[d.getMonth()] + ' alle ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
 } else {
 ttl.textContent = 'Pronto per la pubblicazione';
 st.textContent = 'Compila le caselle e pubblica i turni';
 }
 $('#pubBtnTxt').textContent = !state.dirty && pending ? 'Invia avviso' : 'Pubblica turni';
 $('#pubBtn').disabled = !needsAction;
}

/* ---------- Editor colonne orarie ---------- */
function renderColsEditor(s) {
 const box = $('#colsBox');
 const cols = s.cols;
 box.replaceChildren();
 const mName = MESI[+month.slice(5) - 1];

 $('#colsCountLbl').textContent = cols.length + (cols.length === 1 ? ' colonna oraria' : ' colonne orarie') + ' · ' + mName;

 cols.forEach((c, i) => {
 const row = el('div', 'colrow');
 const f = (lbl, type, key) => {
 const w = el('div');
 const id = 'col' + i + key;
 const l = el('label', '', lbl);
 l.htmlFor = id;
 const inp = el('input');
 inp.id = id;
 inp.type = type;
 inp.value = c[key] || '';
 inp.addEventListener('change', () => {
 if (type === 'time' && !inp.value) {
 inp.value = c[key] || '';
 return toast('Inserisci un orario valido');
 }
 c[key] = type === 'time' ? inp.value : inp.value.trim();
 markDirty();
 renderAllGrids(s);
 });
 w.append(l, inp);
 return w;
 };
 row.append(f('Inizio', 'time', 'start'), f('Fine', 'time', 'end'));
 const x = el('button', 'colx', '✕');
 x.type = 'button';
 x.setAttribute('aria-label', 'Rimuovi colonna ' + c.start + '–' + c.end);
 x.addEventListener('click', () => {
 if (cols.length <= 1) return toast('Serve almeno una colonna');
 if (!confirm('Rimuovere questa colonna (' + c.start + '–' + c.end + ') e i nomi che contiene in ' + mName + '?')) return;
 cols.splice(i, 1);
 Object.keys(s.cells).forEach((k) => s.cells[k].splice(i, 1));
 markDirty();
 renderColsEditor(s);
 renderAllGrids(s);
 });
 const nm = f('Nome colonna (facoltativo, es. Turno Extra)', 'text', 'label');
 nm.className = 'colname';
 row.append(x, nm);
 box.append(row);
 });

 const acts = el('div', 'colactions');
 const btn = (txt, fn) => { const b = el('button', 'linkbtn', txt); b.type = 'button'; b.addEventListener('click', fn); return b; };

 const add = btn('+ Aggiungi colonna oraria', () => {
 cols.push({ start: '06:00', end: '14:00', label: '' });
 markDirty();
 renderColsEditor(s);
 renderAllGrids(s);
 });

 const applyNext = btn('Applica questi orari ai mesi successivi', () => {
 const later = state.sheets.filter((x) => canonicalSheetTitle(x.title) === s.title && x.month > s.month);
 if (!later.length) return toast('Nessun mese successivo già creato: i nuovi mesi useranno questi orari');
 const same = later.filter((x) => x.cols.length === cols.length);
 if (!same.length) return toast('I mesi successivi hanno un numero diverso di colonne: aggiornali a mano');
 if (!confirm('Copiare orari e nomi delle colonne su ' + same.length + ' mesi successivi di ' + s.title + '? I nomi nelle caselle restano invariati.')) return;
 same.forEach((x) => { x.cols = cols.map((c) => ({ ...c })); });
 markDirty();
 toast('Orari applicati a ' + same.length + ' mesi' + (same.length < later.length ? ' (' + (later.length - same.length) + ' saltati: colonne diverse)' : ''));
 });

 const copyPrev = btn('Copia turni dal mese precedente', () => copyFromPrevMonth(s));

 const clearMonth = btn('Svuota turni ' + mName, () => {
 if (!confirm('Svuotare tutti i turni di ' + s.title + ' nel mese di ' + mName + '?')) return;
 const snap = snapshot();
 s.cells = {};
 markDirty();
 render();
 toast('Turni di ' + mName + ' svuotati', undoAction(snap));
 });

 const delPost = btn('Elimina postazione ' + s.title, () => deletePostazione(s.title));
 delPost.classList.add('danger');

 acts.append(add, copyPrev, applyNext, clearMonth, delPost);
 box.append(acts);
}

// Ripete lo schema delle ultime 4 settimane del mese precedente (stessi giorni della settimana)
function copyFromPrevMonth(s) {
 const pm = shiftMonth(s.month, -1);
 const prev = sheetFor(s.title, pm, false);
 if (!prev || !Object.keys(prev.cells || {}).length) return toast('Nessun turno in ' + monthName(pm) + ' per ' + s.title);
 const hasData = Object.values(s.cells || {}).some((a) => (a || []).some((x) => x));
 if (!confirm('Copiare in ' + monthName(s.month) + ' lo schema di ' + monthName(pm) + ' per ' + s.title + '?\n\nOgni giorno prende i turni dello stesso giorno della settimana di 4 settimane prima.' + (hasData ? '\n\nATTENZIONE: i turni già presenti in ' + monthName(s.month) + ' verranno sostituiti.' : ''))) return;
 const snap = snapshot();
 s.cols = prev.cols.map((c) => ({ ...c }));
 const cells = {};
 const [y, mo] = s.month.split('-').map(Number);
 for (let d = 1; d <= daysIn(s.month); d++) {
 const src = isoOf(new Date(y, mo - 1, d - 28));
 const from = src.slice(0, 7) === pm ? prev.cells[src] : cells[src];
 if (from && from.some((x) => x)) cells[isoDay(s.month, d)] = [...from];
 }
 s.cells = cells;
 markDirty();
 render();
 toast('Schema copiato da ' + monthName(pm), undoAction(snap));
}

/* ---------- Tabella turni ---------- */
function buildTableDOM(tableEl, s) {
 const cols = s.cols;
 const cellMap = s.cells;
 tableEl.replaceChildren();
 if (!cols.length) return;

 const hr = el('tr');
 hr.append(el('th', 'day', 'Giorno'));
 cols.forEach((c) => {
 const theme = colTheme(c);
 const th = el('th', theme);
 th.scope = 'col';
 th.append(el('span', 'th-time', c.start + ' – ' + c.end));
 const defaultLbl = theme === 'col-m' ? 'Mattina' : (theme === 'col-p' ? 'Pomeriggio' : (theme === 'col-n' ? 'Notte' : 'Continuativo / Extra'));
 th.append(el('small', '', c.label || defaultLbl));
 hr.append(th);
 });
 const thead = el('thead');
 thead.append(hr);
 tableEl.append(thead);

 const body = el('tbody');
 const [y, mo] = month.split('-').map(Number);
 const todayIso = isoOf(new Date());
 renderedToday = todayIso;

 for (let d = 1; d <= daysIn(month); d++) {
 const key = isoDay(month, d);
 const dow = new Date(y, mo - 1, d).getDay();
 const rowCls = [dow === 0 || dow === 6 ? 'we' : '', key === todayIso ? 'is-today' : ''].filter(Boolean).join(' ');

 const tr = el('tr', rowCls);
 const td = el('td', 'day', String(d));
 td.append(el('span', '', GG[dow]));
 tr.append(td);

 cols.forEach((col, i) => {
 const theme = colTheme(col);
 const c = el('td');
 const val = ((cellMap[key] || [])[i] || '').trim();
 const conf = val ? conflictsFor(extractPureName(val), cellInterval(col, val, key), s.title + '|' + key + '|' + i) : null;
 const confCls = conf && conf.overlap.length ? ' conflict' : (conf && conf.rest.length ? ' rest-warn' : '');
 const btn = el('button', 'cell-btn ' + theme + (val ? ' filled' : ' empty') + (val === 'NO' ? ' is-no' : '') + confCls);
 btn.type = 'button';
 const confTxt = conf ? conflictText(conf) : '';
 btn.setAttribute('aria-label', GG[dow] + ' ' + d + ' ' + MESI[mo - 1] + ', ' + col.start + '–' + col.end + ': ' + (val || 'vuoto') + (confTxt ? '. ' + confTxt : ''));
 if (confTxt) btn.title = confTxt;
 btn.append(el('span', 'c-txt', val || '+ Assegna'));
 if (confCls) btn.append(el('span', 'c-warn', '⚠'));
 btn.append(el('span', 'c-arr', '▾'));
 btn.addEventListener('click', () => openCellPicker(s, key, i, btn, false));
 c.append(btn);
 tr.append(c);
 });
 body.append(tr);
 }
 tableEl.append(body);
}

function renderAllGrids(s) {
 const [y, mo] = month.split('-').map(Number);
 const sCat = s.category || categoryOfTitle(s.title);
 $('#mainTableTitle').textContent = s.title;
 $('#mainTableSub').textContent = sCat + ' · ' + MESI[mo - 1] + ' ' + y;
 buildTableDOM($('#grid'), s);
}

function scrollToToday() {
 requestAnimationFrame(() => {
 const row = $('#grid tr.is-today');
 const g = $('#mainGridWrap');
 if (!row || !g) return;
 const head = $('#grid thead');
 g.scrollTop = row.offsetTop - (head ? head.offsetHeight : 0) - 8;
 $('.table-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
 });
}

/* ---------- Stampa ed esportazione CSV ---------- */
function exportCsv() {
 const s = sheetFor(title, month, true);
 const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
 const lines = [['Giorno', 'Data'].concat(s.cols.map((c) => c.start + '-' + c.end + (c.label ? ' ' + c.label : ''))).map(q).join(';')];
 const [y, mo] = month.split('-').map(Number);
 for (let d = 1; d <= daysIn(month); d++) {
 const key = isoDay(month, d);
 const dow = new Date(y, mo - 1, d).getDay();
 const arr = s.cells[key] || [];
 lines.push([GG[dow], pad(d) + '/' + pad(mo) + '/' + y].concat(s.cols.map((_, i) => arr[i] || '')).map(q).join(';'));
 }
 const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
 const a = el('a');
 a.href = URL.createObjectURL(blob);
 a.download = 'turni ' + s.title.toLowerCase() + ' ' + month + '.csv';
 document.body.append(a);
 a.click();
 a.remove();
 setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- Render principale ---------- */
function render() {
 setCustomTitles(state.customStructures);
 invalidate();
 if (!allAvailableTitles().length) {
 state.deletedCategories = [];
 state.deletedTitles = [];
 invalidate();
 }
 const titles = allAvailableTitles();
 if (!titles.includes(title)) title = titles[0];
 const [y, mo] = month.split('-').map(Number);
 $('#monthLbl').textContent = MESI[mo - 1] + ' ' + y;
 const s = sheetFor(title, month, true);

 renderMonthStats();
 renderCategoryNav();
 renderEmployees();
 renderColsEditor(s);
 renderAllGrids(s);
 renderSummary();
 renderBar();
 saveUi();

 if (firstRender) {
 firstRender = false;
 requestAnimationFrame(() => {
 const g = $('#mainGridWrap');
 if (g) { g.scrollLeft = ui.x || 0; g.scrollTop = ui.t || 0; }
 window.scrollTo(0, ui.y || 0);
 });
 }
}

function show(logged) {
 $('#login').hidden = logged;
 $('#editor').hidden = !logged;
 $('#pubbar').hidden = !logged;
 document.body.classList.toggle('logged', logged);
}
function logout(wrong) {
 pw = '';
 clearPw();
 closeCellPicker();
 show(false);
 $('#loginMsg').className = 'msg err';
 $('#loginMsg').textContent = wrong ? 'Password non valida o scaduta: rieffettua l\'accesso.' : '';
}
async function start() {
 if (!API) {
 show(false);
 $('#loginMsg').className = 'msg err';
 $('#loginMsg').textContent = 'Manca l\'indirizzo del server in config.js';
 return;
 }
 if (!pw) return show(false);
 show(true);
 let justLoaded = false;
 if (!state) {
 try { await loadRemote(); justLoaded = true; } catch { state = emptyState(); toast('Server non raggiungibile'); }
 } else {
 bootstrapEmployeesFromSheets();
 }
 render();
 if (!justLoaded) checkRemote();
}

/* ---------- Eventi ---------- */
$('#addPostBtn').addEventListener('click', (e) => openAddPostazioneModal(e.currentTarget));

$('#empForm').addEventListener('submit', (e) => {
 e.preventDefault();
 const inp = $('#empInput');
 const val = normName(inp.value);
 if (!val) return;
 if (RESERVED.has(val) || HOUR_RE.test(val)) return toast('"' + val + '" non è un nome valido per un dipendente');
 const chosenCats = [...newEmpSelectedCats];
 const existing = employees.find((x) => x.name === val);
 if (existing) {
 existing.cats = [...new Set([...existing.cats, ...chosenCats])];
 toast('Aggiornati i campi di ' + val);
 } else {
 employees.push({ name: val, cats: chosenCats.length ? chosenCats : [activeCat] });
 employees.sort((a, b) => a.name.localeCompare(b.name, 'it'));
 toast('Aggiunto ' + val + ' (' + chosenCats.join(', ') + ')');
 }
 markDirty();
 renderEmployees();
 inp.value = '';
 inp.focus();
});

const toggleBox = (btnSel, boxSel) => $(btnSel).addEventListener('click', () => {
 const b = $(boxSel);
 b.hidden = !b.hidden;
 $(btnSel).setAttribute('aria-expanded', String(!b.hidden));
});
toggleBox('#empBtn', '#empBox');
toggleBox('#colsBtn', '#colsBox');

$('#pkClose').addEventListener('click', closeCellPicker);
$('#pkBg').addEventListener('click', closeCellPicker);
// Esc chiude, Tab resta dentro il pannello aperto
document.addEventListener('keydown', (e) => {
 if ($('#pickerSheet').hidden) return;
 if (e.key === 'Escape') { closeCellPicker(); return; }
 if (e.key !== 'Tab') return;
 const panel = $('#pkPanel');
 const f = [...panel.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
 .filter((x) => !x.disabled && x.offsetParent !== null);
 if (!f.length) return;
 const first = f[0], last = f[f.length - 1];
 if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
 else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

$('#loginForm').addEventListener('submit', async (e) => {
 e.preventDefault();
 const msg = $('#loginMsg');
 msg.className = 'msg';
 msg.textContent = 'Controllo…';
 const tryPw = $('#pw').value;
 try {
 const r = await fetch(API + '/api/auth', { headers: { authorization: 'Bearer ' + tryPw } });
 if (!r.ok) { msg.className = 'msg err'; msg.textContent = r.status === 429 ? 'Troppi tentativi: riprova tra qualche minuto' : 'Password errata'; return; }
 pw = tryPw;
 savePw(pw, $('#remember').checked);
 $('#pw').value = '';
 msg.textContent = '';
 start();
 } catch {
 msg.className = 'msg err';
 msg.textContent = 'Server non raggiungibile';
 }
});

const goMonth = (m) => { month = m; render(); };
$('#mPrev').addEventListener('click', () => goMonth(shiftMonth(month, -1)));
$('#mNext').addEventListener('click', () => goMonth(shiftMonth(month, 1)));
$('#mToday').addEventListener('click', () => { goMonth(ym(new Date())); scrollToToday(); });

$('#printBtn').addEventListener('click', () => window.print());
$('#csvBtn').addEventListener('click', exportCsv);

$('#pubBtn').addEventListener('click', publish);
$('#logout').addEventListener('click', () => logout(false));
$('#reload').addEventListener('click', async () => {
 if (state.dirty && !confirm('Scartare le modifiche non pubblicate e caricare i turni dal server?')) return;
 closeCellPicker();
 try { await loadRemote(); render(); toast('Ricaricato dal server'); }
 catch { toast('Server non raggiungibile'); }
});

document.addEventListener('visibilitychange', () => {
 if (document.visibilityState === 'hidden') { flush(); return; }
 if (!state || !pw) return;
 if (isoOf(new Date()) !== renderedToday && !activePicker) render(); // passata la mezzanotte
 if (Date.now() - lastRemoteCheck > REMOTE_CHECK_MS) checkRemote();
});
// Un'altra scheda ha modificato la bozza: allineati invece di sovrascriverla
window.addEventListener('storage', (e) => {
 if (e.key !== LS_STATE || !e.newValue || !pw) return;
 try {
 const next = migrateState(JSON.parse(e.newValue));
 if (!next) return;
 clearTimeout(saveTimer);
 closeCellPicker();
 state = next;
 employees = normalizeEmployees(lsGet(LS_EMP, []));
 invalidate();
 render();
 toast('Bozza aggiornata da un\'altra scheda');
 } catch { /* ignore */ }
});
window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', flush);
window.addEventListener('scroll', onScroll, { passive: true });
$('#mainGridWrap').addEventListener('scroll', onScroll, { passive: true });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
start();
