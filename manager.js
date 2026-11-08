'use strict';
const API = String(window.TURNI_API || '').replace(/\/$/, '');
const LS_STATE = 'resp.state.v4', LS_LEGACY_V3 = 'resp.state.v3', LS_LEGACY_V2 = 'resp.state.v2', LS_LEGACY_V1 = 'resp.state.v1';
const LS_PW = 'resp.pw.v1', LS_PUB = 'resp.pub.v1', LS_EMP = 'resp.emp.v2', LS_LEGACY_EMP = 'resp.emp.v1', LS_UI = 'resp.ui.v1';

const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const MES3 = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const GG = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const DEFAULT_COLS = [
 { start: '06:00', end: '14:00', label: '' },
 { start: '14:00', end: '22:00', label: '' },
 { start: '22:00', end: '06:00', label: '' },
];

// Struttura gerarchica di base: CAMPO SUD, CAMPO NORD, PARCHI
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

const $ = (s) => document.querySelector(s);
const el = (t, c, x) => {
 const e = document.createElement(t);
 if (c) e.className = c;
 if (x !== undefined) e.textContent = x;
 return e;
};
const pad = (n) => String(n).padStart(2, '0');
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

function canonicalSheetTitle(raw) {
 const t = String(raw || '').trim().toUpperCase().replace(/[_.]+/g, ' ').replace(/\s+/g, ' ');
 if (!t) return '';
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
 if (/\bNORD\b/.test(t) && !/\bCAMPO\s+SUD\b/.test(t)) return 'CAMPO NORD';
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

const nowInit = new Date();
let month = nowInit.getFullYear() + '-' + pad(nowInit.getMonth() + 1);
let title = 'CAMPO SUD GABBIOTTO';
let activeCat = 'CAMPO SUD';

let state = migrateState(lsGet(LS_STATE, null) || lsGet(LS_LEGACY_V3, null) || lsGet(LS_LEGACY_V2, null) || lsGet(LS_LEGACY_V1, null));
let employees = normalizeEmployees(lsGet(LS_EMP, null) || lsGet(LS_LEGACY_EMP, []));
let pw = lsGet(LS_PW, '');
let saveTimer = 0, toastTimer = 0, scrollTimer = 0, firstRender = true;
let activePicker = null;
let newEmpSelectedCats = new Set(['CAMPO SUD', 'CAMPO NORD', 'PARCHI']);

const ui = lsGet(LS_UI, {});
if (/^\d{4}-\d{2}$/.test(ui.month || '')) month = ui.month;
if (typeof ui.title === 'string' && ui.title) title = canonicalSheetTitle(ui.title);

function normalizeEmployees(rawList) {
 if (!Array.isArray(rawList)) return [];
 const map = new Map();
 rawList.forEach((item) => {
 if (typeof item === 'string') {
 const nm = item.trim().toUpperCase().replace(/\s+/g, ' ');
 if (nm) map.set(nm, { name: nm, cats: ['CAMPO SUD', 'CAMPO NORD', 'PARCHI'] });
 } else if (item && typeof item.name === 'string') {
 const nm = item.name.trim().toUpperCase().replace(/\s+/g, ' ');
 if (!nm) return;
 const cats = Array.isArray(item.cats) && item.cats.length
 ? [...new Set(item.cats.map((c) => (c === 'PARCO CAFASSO' ? 'PARCHI' : String(c).trim().toUpperCase())))]
 : ['CAMPO SUD', 'CAMPO NORD', 'PARCHI'];
 map.set(nm, { name: nm, cats });
 }
 });
 return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

// Migrazione stato: unisce eventuali vecchie extraCols dentro cols e preserva categorie/postazioni eliminate
function migrateState(raw) {
 if (!raw || !Array.isArray(raw.sheets)) return null;
 const byKey = new Map();
 const customStructures = Array.isArray(raw.customStructures) ? raw.customStructures : [];
 const deletedCategories = Array.isArray(raw.deletedCategories) ? raw.deletedCategories : [];
 const deletedTitles = Array.isArray(raw.deletedTitles) ? raw.deletedTitles : [];

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
 };
}

function toast(t) {
 const e = $('#toast');
 e.textContent = t;
 e.hidden = false;
 clearTimeout(toastTimer);
 toastTimer = setTimeout(() => { e.hidden = true; }, 2600);
}
function persist() { lsSet(LS_STATE, state); lsSet(LS_EMP, employees); }
function saveUi() {
 const g = $('#mainGridWrap');
 lsSet(LS_UI, { month, title, y: window.scrollY, x: g ? g.scrollLeft : 0, t: g ? g.scrollTop : 0 });
}
function flush() { clearTimeout(saveTimer); if (state) persist(); saveUi(); }
function onScroll() { clearTimeout(scrollTimer); scrollTimer = setTimeout(saveUi, 250); }
function markDirty() {
 state.dirty = true;
 clearTimeout(saveTimer);
 saveTimer = setTimeout(persist, 300);
 renderBar();
 renderMonthStats();
 renderCategoryNav();
}

// Costruisce l'albero completo delle categorie escludendo quelle eliminate dal responsabile
function getCategories() {
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
 let targetCat = catName ? String(catName).trim().toUpperCase() : '';
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
 return cats.filter((c) => c.items.length > 0);
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
 if (!confirm('Eliminare la categoria "' + catId + '" e tutte le sue postazioni (' + target.items.map((x) => x.label).join(', ') + ')?')) return;

 if (!Array.isArray(state.deletedCategories)) state.deletedCategories = [];
 if (!state.deletedCategories.includes(catId)) state.deletedCategories.push(catId);

 const titlesToRemove = new Set(target.items.map((x) => x.title));
 if (!Array.isArray(state.deletedTitles)) state.deletedTitles = [];
 titlesToRemove.forEach((t) => {
 if (!state.deletedTitles.includes(t)) state.deletedTitles.push(t);
 });

 state.customStructures = (state.customStructures || []).filter((cs) => cs.category !== catId && !titlesToRemove.has(canonicalSheetTitle(cs.title)));
 state.sheets = (state.sheets || []).filter((s) => (s.category || categoryOfTitle(s.title)) !== catId && !titlesToRemove.has(canonicalSheetTitle(s.title)));

 // Rimuove la categoria anche dai filtri dei dipendenti
 employees.forEach((emp) => {
 emp.cats = emp.cats.filter((c) => c !== catId);
 });
 newEmpSelectedCats.delete(catId);

 const rem = allAvailableTitles();
 title = rem[0] || '';
 activeCat = categoryOfTitle(title);
 markDirty();
 render();
 toast('Categoria "' + catId + '" eliminata');
}

// Elimina una singola Postazione
function deletePostazione(postTitle) {
 const all = allAvailableTitles();
 if (all.length <= 1) return toast('Deve rimanere almeno una postazione attiva');
 const ct = canonicalSheetTitle(postTitle);
 if (!confirm('Eliminare definitivamente la postazione "' + ct + '"?')) return;

 if (!Array.isArray(state.deletedTitles)) state.deletedTitles = [];
 if (!state.deletedTitles.includes(ct)) state.deletedTitles.push(ct);

 state.customStructures = (state.customStructures || []).filter((cs) => canonicalSheetTitle(cs.title) !== ct);
 state.sheets = (state.sheets || []).filter((s) => canonicalSheetTitle(s.title) !== ct);

 const rem = allAvailableTitles();
 if (title === ct) title = rem[0] || '';
 activeCat = categoryOfTitle(title);
 markDirty();
 render();
 toast('Postazione "' + ct + '" eliminata');
}

function daysIn(m) {
 const [y, mo] = m.split('-').map(Number);
 return new Date(y, mo, 0).getDate();
}
const isoDay = (m, d) => m + '-' + pad(d);

function sheetHasData(t, m) {
 const s = sheetFor(t, m, false);
 if (!s) return false;
 return Object.entries(s.cells || {}).some(([date, arr]) => date.slice(0, 7) === m && (arr || []).some((v) => extractPureName(v)));
}

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
 return s;
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
 const clean = toks.filter((t) => !/^\d{1,2}(?:[:.]\d{2})?$/.test(t));
 const joined = clean.join(' ');
 if (!joined || joined === 'NO' || joined === 'RIPOSO') return '';
 return joined;
}

function syncEmployeesFromSheets() {
 const byName = new Map(employees.map((e) => [e.name, e]));
 let changed = false;
 if (state && Array.isArray(state.sheets)) {
 state.sheets.forEach((s) => {
 const sCat = s.category || categoryOfTitle(s.title);
 Object.values(s.cells || {}).forEach((arr) => {
 (arr || []).forEach((val) => {
 const nm = extractPureName(val);
 if (!nm || nm.length < 2) return;
 let emp = byName.get(nm);
 if (!emp) {
 emp = { name: nm, cats: [sCat] };
 byName.set(nm, emp);
 employees.push(emp);
 changed = true;
 } else if (sCat && !emp.cats.includes(sCat)) {
 emp.cats.push(sCat);
 changed = true;
 }
 });
 });
 });
 }
 employees.sort((a, b) => a.name.localeCompare(b.name, 'it'));
 if (changed) lsSet(LS_EMP, employees);
}

/* ---------- Pubblicazione: formato compatibile con l'app dei turnisti ---------- */
function toDocs() {
 const keep = new Date();
 keep.setDate(1);
 keep.setMonth(keep.getMonth() - 3);
 const minM = keep.getFullYear() + '-' + pad(keep.getMonth() + 1);

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
 const rowCells = cols.map((_, i) => String(cStd[i] || '').trim().replace(/\s+/g, ' '));
 rows.push({ date: key, cells: rowCells });
 }
 const pubTitle = exportTitleForClients(s.title);
 return {
 id: s.title + ' ' + MES3[mo - 1] + '-' + String(y).slice(2),
 title: pubTitle,
 uiTitle: s.title,
 category: s.category || categoryOfTitle(s.title),
 month: s.month,
 cols,
 rows,
 };
 }).filter((d) => d.rows.some((r) => r.cells.some((x) => x)));
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
 const key = t + '|' + m;
 const rawCols = Array.isArray(d.cols) && d.cols.length ? d.cols : DEFAULT_COLS;
 const cols = rawCols.map((c) => ({ start: c.start, end: c.end, label: c.label || '' }));
 const cells = {};
 mRows.forEach((r) => {
 cells[r.date] = cols.map((_, i) => (r.cells && r.cells[i]) || '');
 });
 map.set(key, { title: t, category: cat, month: m, cols, cells });
 });
 });
 return [...map.values()];
}

async function api(path, opt) {
 return fetch(API + path, { ...opt, headers: { ...(opt && opt.headers), authorization: 'Bearer ' + pw } });
}
async function loadRemote() {
 const r = await fetch(API + '/api/schedule', { cache: 'no-store' });
 if (!r.ok) throw new Error('server ' + r.status);
 const d = await r.json();
 if (Array.isArray(d.employees) && d.employees.length) {
 employees = normalizeEmployees([...employees, ...d.employees]);
 }
 const delCats = Array.isArray(d.deletedCategories) ? d.deletedCategories : (state && state.deletedCategories) || [];
 const delTitles = Array.isArray(d.deletedTitles) ? d.deletedTitles : (state && state.deletedTitles) || [];
 state = {
 sheets: fromDocs(d.docs || [], delCats, delTitles),
 customStructures: Array.isArray(d.customStructures) ? d.customStructures : (state && state.customStructures) || [],
 deletedCategories: delCats,
 deletedTitles: delTitles,
 dirty: false,
 };
 syncEmployeesFromSheets();
 lsSet(LS_PUB, { version: d.version });
 persist();
}

function noticeMonths() {
 const now = new Date(), cur = now.getFullYear() + '-' + pad(now.getMonth() + 1);
 const ms = [...new Set(toDocs().map((d) => d.month || (d.rows[0] && d.rows[0].date.slice(0, 7))).filter((m) => m && m >= cur))].sort();
 const names = (ms.length ? ms : [month]).map((m) => MESI[+m.slice(5) - 1].toLowerCase());
 return names.length > 1 ? names.slice(0, -1).join(', ') + ' e ' + names[names.length - 1] : names[0];
}
async function sendNotice() {
 const body = 'Il responsabile ha pubblicato i turni di ' + noticeMonths() + '.';
 let cursor = null, sent = 0;
 for (let i = 0; i < 40; i++) {
 const r = await api('/api/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Turni aggiornati', body, cursor }) });
 if (!r.ok) throw new Error('notify ' + r.status);
 const d = await r.json();
 sent += d.sent;
 if (d.done) return sent;
 cursor = d.cursor;
 }
 return sent;
}
async function publish() {
 const btn = $('#pubBtn');
 btn.disabled = true;
 btn.textContent = 'Invio…';
 try {
 flush();
 const r = await api('/api/schedule', {
 method: 'PUT',
 headers: { 'content-type': 'application/json' },
 body: JSON.stringify({
 docs: toDocs(),
 employees,
 customStructures: state.customStructures || [],
 deletedCategories: state.deletedCategories || [],
 deletedTitles: state.deletedTitles || [],
 }),
 });
 if (r.status === 401) { logout(true); return; }
 if (!r.ok) throw new Error('server ' + r.status);
 const d = await r.json();
 state.dirty = false;
 state.noticePending = true;
 persist();
 lsSet(LS_PUB, { version: d.version });
 try {
 const n = await sendNotice();
 state.noticePending = false;
 persist();
 toast('Pubblicato · avviso inviato a ' + n + (n === 1 ? ' persona' : ' persone'));
 } catch {
 toast('Pubblicato, ma l\'avviso non è partito: tocca Pubblica per riprovare');
 }
 } catch {
 toast('Errore di rete: riprova');
 }
 btn.textContent = 'Pubblica';
 renderBar();
}

/* ---------- Riepilogo del mese selezionato ---------- */
function renderMonthStats() {
 const [y, mo] = month.split('-').map(Number);
 const now = new Date();
 const curMonth = now.getFullYear() + '-' + pad(now.getMonth() + 1);
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
 let totalAssigned = 0;
 let activeSheets = 0;
 const uniqueOps = new Set();

 monthSheets.forEach((s) => {
 let sheetHasShifts = false;
 Object.entries(s.cells || {}).forEach(([date, arr]) => {
 if (date.slice(0, 7) !== month) return;
 (arr || []).forEach((val) => {
 const nm = extractPureName(val);
 if (nm) {
 totalAssigned++;
 sheetHasShifts = true;
 uniqueOps.add(nm);
 }
 });
 });
 if (sheetHasShifts) activeSheets++;
 });

 const totalPossible = activeTitles.size;
 const box = $('#mStats');
 const mk = (v, l) => {
 const d = el('div', 'mstat');
 d.append(el('b', '', String(v)), el('span', '', l));
 return d;
 };
 box.replaceChildren(
 mk(activeSheets + ' / ' + totalPossible, 'Postazioni compilate in ' + MES3[mo - 1]),
 mk(totalAssigned, 'Turni assegnati in ' + MES3[mo - 1]),
 mk(uniqueOps.size, 'Operatori in ' + MES3[mo - 1])
 );
}

/* ---------- Navigazione a 2 Livelli: Categorie (con elimina) -> Postazioni (con elimina) ---------- */
function renderCategoryNav() {
 const cats = getCategories();
 if (!cats.length) return;
 activeCat = categoryOfTitle(title);
 const curCatObj = cats.find((c) => c.id === activeCat) || cats[0];

 // Livello 1: Macro-categorie (CAMPO SUD, CAMPO NORD, PARCHI, ecc.) + pulsante ✕ per eliminarle
 const catBox = $('#catTabs');
 catBox.replaceChildren();
 cats.forEach((c) => {
 const isOn = c.id === curCatObj.id;
 const hasAnyData = c.items.some((it) => sheetHasData(it.title, month));
 const wrap = el('div', 'tab-wrap' + (isOn ? ' on' : ''));

 const b = el('button', 'tab');
 b.type = 'button';
 b.setAttribute('role', 'tab');
 b.setAttribute('aria-selected', String(isOn));
 b.append(el('span', '', c.label), el('span', 'cat-cnt', String(c.items.length)));
 if (hasAnyData) {
 const dot = el('i', 'tab-dot');
 dot.title = 'Contiene turni compilati in questo mese';
 b.append(dot);
 }
 b.addEventListener('click', () => {
 activeCat = c.id;
 if (!c.items.some((it) => it.title === title)) {
 title = c.items[0].title;
 }
 render();
 });

 const delBtn = el('button', 'tab-del', '✕');
 delBtn.type = 'button';
 delBtn.title = 'Elimina categoria ' + c.label;
 delBtn.setAttribute('aria-label', 'Elimina categoria ' + c.label);
 delBtn.addEventListener('click', (e) => {
 e.stopPropagation();
 deleteCategory(c.id);
 });

 wrap.append(b, delBtn);
 catBox.append(wrap);
 });

 // Livello 2: Postazioni della categoria attiva + pulsante ✕ per eliminarle
 const subBlock = $('#subNavBlock');
 const subBox = $('#subTabs');
 subBox.replaceChildren();

 $('#subNavLabel').textContent = '2. Postazioni in ' + curCatObj.label + ':';
 curCatObj.items.forEach((it) => {
 const isOn = it.title === title;
 const hasData = sheetHasData(it.title, month);
 const wrap = el('div', 'tab-wrap' + (isOn ? ' on' : ''));

 const b = el('button', 'tab');
 b.type = 'button';
 b.setAttribute('role', 'tab');
 b.setAttribute('aria-selected', String(isOn));
 b.append(el('span', '', it.label));
 if (hasData) {
 const dot = el('i', 'tab-dot');
 dot.title = 'Turni presenti';
 b.append(dot);
 }
 b.addEventListener('click', () => {
 title = it.title;
 render();
 });

 const delBtn = el('button', 'tab-del', '✕');
 delBtn.type = 'button';
 delBtn.title = 'Elimina postazione ' + it.label;
 delBtn.setAttribute('aria-label', 'Elimina postazione ' + it.label);
 delBtn.addEventListener('click', (e) => {
 e.stopPropagation();
 deletePostazione(it.title);
 });

 wrap.append(b, delBtn);
 subBox.append(wrap);
 });
 subBlock.hidden = false;
}

/* ---------- Modal: Aggiungi Nuova Postazione con scelta Categoria e Auto-Suggerimento ---------- */
function openAddPostazioneModal(triggerBtn) {
 activePicker = { triggerBtn };
 $('#pkTitle').textContent = 'Aggiungi nuova postazione';
 $('#pkSub').textContent = 'Inserisci il nome e scegli la categoria (es. Parchi, Campo Sud, Campo Nord)';

 const body = $('#pkBody');
 body.replaceChildren();

 const form = el('form', 'struct-form');
 const nameField = el('div', 'struct-field');
 nameField.append(el('label', '', 'Nome della postazione'));
 const nameInp = el('input');
 nameInp.type = 'text';
 nameInp.placeholder = 'Es. PARCO SAN GENNARO';
 nameInp.autocapitalize = 'characters';
 nameInp.spellcheck = false;
 nameField.append(nameInp);

 const suggestBadge = el('div', 'suggest-badge');
 suggestBadge.hidden = true;

 const catField = el('div', 'struct-field');
 catField.append(el('label', '', 'Categoria di appartenenza'));
 const catGrid = el('div', 'struct-cats');

 const existingCats = [...new Set([...BASE_CATEGORIES.map((c) => c.id), ...getCategories().map((c) => c.id)])];
 let chosenCat = activeCat || 'PARCHI';
 let manualCatOverride = false;

 const customCatField = el('div', 'struct-field');
 customCatField.hidden = true;
 customCatField.append(el('label', '', 'Nome della nuova categoria'));
 const customCatInp = el('input');
 customCatInp.type = 'text';
 customCatInp.placeholder = 'Es. VIGILANZA EVENTI';
 customCatField.append(customCatInp);

 const renderCatButtons = () => {
 catGrid.replaceChildren();
 existingCats.forEach((cid) => {
 const btn = el('button', 'struct-cat-btn' + (chosenCat === cid ? ' on' : ''));
 btn.type = 'button';
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

 // Auto-suggerimento mentre si digita il nome (es. "Parco San Gennaro" -> "PARCHI")
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
 const postName = canonicalSheetTitle(nameInp.value);
 if (!postName) return toast('Inserisci il nome della postazione');
 const finalCat = chosenCat === '__NEW__'
 ? String(customCatInp.value || '').trim().toUpperCase().replace(/\s+/g, ' ')
 : chosenCat;
 if (!finalCat) return toast('Scegli o scrivi una categoria');

 // Se la postazione o la categoria erano state eliminate in precedenza, le riattiva
 state.deletedCategories = (state.deletedCategories || []).filter((c) => c !== finalCat);
 state.deletedTitles = (state.deletedTitles || []).filter((t) => t !== postName);

 if (!Array.isArray(state.customStructures)) state.customStructures = [];
 const existingCustom = state.customStructures.find((x) => canonicalSheetTitle(x.title) === postName);
 if (existingCustom) existingCustom.category = finalCat;
 else state.customStructures.push({ title: postName, category: finalCat });

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
 $('#pickerSheet').hidden = false;
 document.body.classList.add('lock');
 setTimeout(() => nameInp.focus(), 50);
}

$('#addPostBtn').addEventListener('click', (e) => openAddPostazioneModal(e.currentTarget));

/* ---------- Gestione Lista Dipendenti con Campi / Categorie assegnate ---------- */
function renderEmployees() {
 const cats = getCategories().map((c) => c.id);

 const newCatsBox = $('#empNewCats');
 newCatsBox.replaceChildren();
 cats.forEach((cid) => {
 const on = newEmpSelectedCats.has(cid);
 const b = el('button', 'cat-chk' + (on ? ' on' : ''), (on ? '✓ ' : '') + cid);
 b.type = 'button';
 b.addEventListener('click', () => {
 if (newEmpSelectedCats.has(cid)) {
 if (newEmpSelectedCats.size > 1) newEmpSelectedCats.delete(cid);
 } else {
 newEmpSelectedCats.add(cid);
 }
 renderEmployees();
 });
 newCatsBox.append(b);
 });

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
 tag.title = isAssigned ? 'Rimuovi ' + emp.name + ' da ' + cid : 'Assegna ' + emp.name + ' a ' + cid;
 tag.addEventListener('click', () => {
 if (isAssigned) {
 if (emp.cats.length <= 1) return toast('Il dipendente deve avere almeno un campo assegnato');
 emp.cats = emp.cats.filter((c) => c !== cid);
 } else {
 emp.cats.push(cid);
 }
 markDirty();
 renderEmployees();
 });
 tagsBox.append(tag);
 });

 const del = el('button', 'emp-del', '✕');
 del.type = 'button';
 del.title = 'Elimina ' + emp.name;
 del.addEventListener('click', () => {
 if (!confirm('Rimuovere ' + emp.name + ' dalla lista dipendenti?')) return;
 employees = employees.filter((x) => x.name !== emp.name);
 markDirty();
 renderEmployees();
 });

 row.append(tagsBox, del);
 list.append(row);
 });
}

$('#empForm').addEventListener('submit', (e) => {
 e.preventDefault();
 const inp = $('#empInput');
 const val = String(inp.value || '').trim().toUpperCase().replace(/\s+/g, ' ');
 if (!val) return;
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

$('#empBtn').addEventListener('click', () => {
 const b = $('#empBox');
 b.hidden = !b.hidden;
 $('#empBtn').setAttribute('aria-expanded', String(!b.hidden));
});

/* ---------- Selettore Rapido Dipendente (filtrato per la Categoria della Postazione attiva) ---------- */
function operatorsWorkingOnDay(isoDate) {
 const busy = new Map();
 const activeTitles = new Set(allAvailableTitles());
 state.sheets.filter((s) => s.month === month && activeTitles.has(canonicalSheetTitle(s.title))).forEach((s) => {
 (s.cols || []).forEach((col, i) => {
 const v = (s.cells && s.cells[isoDate] && s.cells[isoDate][i]) || '';
 const nm = extractPureName(v);
 if (nm) busy.set(nm, s.title + ' (' + col.start + '–' + col.end + ')');
 });
 });
 return busy;
}

function parseCellValue(raw) {
 const toks = String(raw || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
 let startHour = '', endHour = '';
 if (toks.length > 1 && /^\d{1,2}(?:[:.]\d{2})?$/.test(toks[0])) {
 startHour = toks.shift();
 }
 if (toks.length > 1 && /^\d{1,2}(?:[:.]\d{2})?$/.test(toks[toks.length - 1])) {
 endHour = toks.pop();
 }
 return { name: toks.join(' '), startHour, endHour };
}

function formatCellValue(name, startHour, endHour) {
 const n = String(name || '').trim().toUpperCase().replace(/\s+/g, ' ');
 if (!n) return '';
 const parts = [];
 if (startHour && startHour.trim()) parts.push(startHour.trim());
 parts.push(n);
 if (endHour && endHour.trim()) parts.push(endHour.trim());
 return parts.join(' ');
}

function openCellPicker(sheet, key, colIdx, triggerBtn, showAllCats = false) {
 const cols = sheet.cols;
 const cellMap = sheet.cells;
 const col = cols[colIdx];
 const curRaw = (cellMap[key] && cellMap[key][colIdx]) || '';
 const parsed = parseCellValue(curRaw);
 const [y, mo, d] = key.split('-').map(Number);
 const dow = new Date(y, mo - 1, d).getDay();
 const sheetCat = sheet.category || categoryOfTitle(sheet.title);

 activePicker = { sheet, key, colIdx, triggerBtn, parsed };
 $('#pkTitle').textContent = GG[dow] + ' ' + d + ' ' + MESI[mo - 1] + ' · ' + col.start + '–' + col.end;
 $('#pkSub').textContent = sheet.title + ' (' + sheetCat + ')' + (col.label ? ' · ' + col.label : '');

 const body = $('#pkBody');
 body.replaceChildren();

 const setCellValue = (newVal) => {
 const arr = cellMap[key] || (cellMap[key] = []);
 while (arr.length < cols.length) arr.push('');
 arr[colIdx] = String(newVal || '').trim().toUpperCase();
 const pure = extractPureName(arr[colIdx]);
 if (pure && pure.length >= 2) {
 const emp = employees.find((x) => x.name === pure);
 if (!emp) {
 employees.push({ name: pure, cats: [sheetCat] });
 employees.sort((a, b) => a.name.localeCompare(b.name, 'it'));
 }
 renderEmployees();
 }
 markDirty();
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
 }

 const hrsBox = el('div', 'pk-hours');
 const mkHr = (lbl, ph, initVal) => {
 const w = el('div');
 w.append(el('label', '', lbl));
 const inp = el('input');
 inp.type = 'text';
 inp.placeholder = ph;
 inp.value = initVal;
 w.append(inp);
 return { w, inp };
 };
 const hStart = mkHr('Inizio personalizzato (opz.)', 'Es. 18', parsed.startHour);
 const hEnd = mkHr('Fine / Prolungamento (opz.)', 'Es. 18', parsed.endHour);
 hrsBox.append(hStart.w, hEnd.w);

 // Filtra i dipendenti: mostra solo quelli assegnati alla categoria della postazione attiva
 const assignedEmps = employees.filter((e) => e.cats.includes(sheetCat));
 const otherEmps = employees.filter((e) => !e.cats.includes(sheetCat));
 const visibleEmps = showAllCats ? employees : assignedEmps;

 body.append(el('p', 'q', showAllCats ? 'Tutti i dipendenti (' + employees.length + ')' : 'Dipendenti assegnati a ' + sheetCat + ' (' + assignedEmps.length + ')'));
 const busyMap = operatorsWorkingOnDay(key);
 const grid = el('div', 'pk-grid');

 visibleEmps.forEach((empObj) => {
 const emp = empObj.name;
 const isCur = parsed.name === emp;
 const busyWhere = busyMap.get(emp);
 const btn = el('button', 'pk-emp' + (isCur ? ' active' : (busyWhere ? ' busy' : '')));
 btn.type = 'button';
 btn.append(el('b', '', emp));
 btn.append(el('span', '', isCur ? 'Selezionato ✓' : (busyWhere ? 'Già in: ' + busyWhere : 'Disponibile · ' + empObj.cats.join(', '))));
 btn.addEventListener('click', () => {
 setCellValue(formatCellValue(emp, hStart.inp.value, hEnd.inp.value));
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
 toggleOther.addEventListener('click', () => openCellPicker(sheet, key, colIdx, triggerBtn, !showAllCats));
 body.append(toggleOther);
 }

 body.append(el('p', 'q', 'Orario continuativo, ridotto o prolungato (facoltativo)'));
 body.append(hrsBox);
 if (parsed.name && parsed.name !== 'NO') {
 const applyHrs = el('button', 'ghost', 'Aggiorna orario per ' + parsed.name);
 applyHrs.type = 'button';
 applyHrs.addEventListener('click', () => {
 setCellValue(formatCellValue(parsed.name, hStart.inp.value, hEnd.inp.value));
 });
 body.append(applyHrs);
 }

 body.append(el('p', 'q', 'Oppure scrivi un nome manualmente (verrà assegnato a ' + sheetCat + ')'));
 const manualForm = el('form', 'row');
 const manualInp = el('input');
 manualInp.type = 'text';
 manualInp.placeholder = 'Scrivi nome (es. ROSSI M. o ROSSI M. 18)';
 manualInp.value = curRaw;
 manualInp.autocapitalize = 'characters';
 manualInp.spellcheck = false;
 const manualBtn = el('button', '', 'Imposta');
 manualBtn.type = 'submit';
 manualForm.append(manualInp, manualBtn);
 manualForm.addEventListener('submit', (e) => {
 e.preventDefault();
 setCellValue(manualInp.value);
 });
 body.append(manualForm);

 $('#pickerSheet').hidden = false;
 document.body.classList.add('lock');
 $('#pkPanel').focus();
}

function closeCellPicker() {
 if (!activePicker) return;
 const btn = activePicker.triggerBtn;
 activePicker = null;
 $('#pickerSheet').hidden = true;
 document.body.classList.remove('lock');
 if (btn && btn.isConnected) btn.focus();
}
$('#pkClose').addEventListener('click', closeCellPicker);
$('#pkBg').addEventListener('click', closeCellPicker);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCellPicker(); });

/* ---------- Interfaccia Principale ---------- */
function renderBar() {
 const pub = lsGet(LS_PUB, null), st = $('#pubStatus');
 const pending = !!state.noticePending;
 st.className = state.dirty || pending ? 'dirty' : '';
 if (state.dirty) st.textContent = 'Bozza salvata sul dispositivo · non ancora pubblicata';
 else if (pending) st.textContent = 'Pubblicato, ma l\'avviso non è partito';
 else if (pub && pub.version) {
 const d = new Date(pub.version);
 st.textContent = 'Pubblicato il ' + d.getDate() + ' ' + MES3[d.getMonth()] + ' alle ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
 } else st.textContent = 'Niente di pubblicato';
 $('#pubBtn').disabled = !(state.dirty || pending);
}

function renderColsEditor(s) {
 const box = $('#colsBox');
 const cols = s.cols;
 const cellMap = s.cells;
 box.replaceChildren();

 $('#colsCountLbl').textContent = cols.length + (cols.length === 1 ? ' colonna oraria' : ' colonne orarie');

 cols.forEach((c, i) => {
 const row = el('div', 'colrow');
 const f = (lbl, type, key) => {
 const w = el('div');
 w.append(el('label', '', lbl));
 const inp = el('input');
 inp.type = type;
 inp.value = c[key] || '';
 inp.addEventListener('change', () => {
 c[key] = inp.value;
 markDirty();
 renderAllGrids(s);
 });
 w.append(inp);
 return w;
 };
 row.append(f('Inizio', 'time', 'start'), f('Fine', 'time', 'end'));
 const x = el('button', 'colx', '✕');
 x.type = 'button';
 x.setAttribute('aria-label', 'Rimuovi colonna');
 x.addEventListener('click', () => {
 if (cols.length < 1) return toast('Serve almeno una colonna');
 if (!confirm('Rimuovere questa colonna (' + c.start + '–' + c.end + ') e i nomi che contiene in ' + MESI[+month.slice(5) - 1] + '?')) return;
 cols.splice(i, 1);
 Object.keys(cellMap).forEach((k) => cellMap[k].splice(i, 1));
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
 const add = el('button', 'linkbtn', '+ Aggiungi colonna oraria');
 add.type = 'button';
 add.addEventListener('click', () => {
 cols.push({ start: '06:00', end: '14:00', label: '' });
 markDirty();
 renderColsEditor(s);
 renderAllGrids(s);
 });

 const clearMonth = el('button', 'linkbtn', 'Svuota turni ' + MESI[+month.slice(5) - 1]);
 clearMonth.type = 'button';
 clearMonth.addEventListener('click', () => {
 if (!confirm('Svuotare tutti i turni di ' + s.title + ' nel mese di ' + MESI[+month.slice(5) - 1] + '?')) return;
 s.cells = {};
 markDirty();
 render();
 });

 const delPost = el('button', 'linkbtn', 'Elimina postazione ' + s.title);
 delPost.type = 'button';
 delPost.addEventListener('click', () => deletePostazione(s.title));

 acts.append(add, clearMonth, delPost);
 box.append(acts);
}

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
 const now = new Date();
 const todayIso = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());

 for (let d = 1; d <= daysIn(month); d++) {
 const key = isoDay(month, d);
 const dow = new Date(y, mo - 1, d).getDay();
 const rowCls = [
 dow === 0 || dow === 6 ? 'we' : '',
 key === todayIso ? 'is-today' : '',
 ].filter(Boolean).join(' ');

 const tr = el('tr', rowCls);
 const td = el('td', 'day', String(d));
 td.append(el('span', '', GG[dow]));
 tr.append(td);

 cols.forEach((col, i) => {
 const theme = colTheme(col);
 const c = el('td');
 const val = ((cellMap[key] || [])[i] || '').trim();
 const btn = el('button', 'cell-btn ' + theme + (val ? ' filled' : ' empty') + (val === 'NO' ? ' is-no' : ''));
 btn.type = 'button';
 btn.setAttribute('aria-label', d + ' ' + MESI[mo - 1] + ' ' + col.start + '-' + col.end);
 btn.append(
 el('span', 'c-txt', val || '+ Assegna'),
 el('span', 'c-arr', '▾')
 );
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

function render() {
 const validTitles = allAvailableTitles();
 if (!validTitles.length) {
 // Se tutte le categorie/postazioni fossero state cancellate, ripristina la prima di default
 state.deletedCategories = [];
 state.deletedTitles = [];
 }
 const updatedTitles = allAvailableTitles();
 if (!updatedTitles.includes(title)) title = updatedTitles[0];
 const [y, mo] = month.split('-').map(Number);
 $('#monthLbl').textContent = MESI[mo - 1] + ' ' + y;
 const s = sheetFor(title, month, true);

 renderMonthStats();
 renderCategoryNav();
 renderEmployees();
 renderColsEditor(s);
 renderAllGrids(s);
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
}
function logout(wrong) {
 pw = '';
 lsSet(LS_PW, '');
 show(false);
 $('#loginMsg').className = 'msg err';
 $('#loginMsg').textContent = wrong ? 'Password non valida: rieffettua l\'accesso.' : '';
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
 if (!state) {
 try { await loadRemote(); }
 catch { state = { sheets: [], customStructures: [], deletedCategories: [], deletedTitles: [], dirty: false }; toast('Server non raggiungibile'); }
 } else {
 syncEmployeesFromSheets();
 }
 render();
}

$('#loginForm').addEventListener('submit', async (e) => {
 e.preventDefault();
 const msg = $('#loginMsg');
 msg.className = 'msg';
 msg.textContent = 'Controllo…';
 const tryPw = $('#pw').value;
 try {
 const r = await fetch(API + '/api/auth', { headers: { authorization: 'Bearer ' + tryPw } });
 if (!r.ok) { msg.className = 'msg err'; msg.textContent = 'Password errata'; return; }
 pw = tryPw;
 lsSet(LS_PW, pw);
 $('#pw').value = '';
 msg.textContent = '';
 start();
 } catch {
 msg.className = 'msg err';
 msg.textContent = 'Server non raggiungibile';
 }
});

$('#mPrev').addEventListener('click', () => {
 const [y, m] = month.split('-').map(Number);
 const d = new Date(y, m - 2, 1);
 month = d.getFullYear() + '-' + pad(d.getMonth() + 1);
 render();
});
$('#mNext').addEventListener('click', () => {
 const [y, m] = month.split('-').map(Number);
 const d = new Date(y, m, 1);
 month = d.getFullYear() + '-' + pad(d.getMonth() + 1);
 render();
});
$('#mToday').addEventListener('click', () => {
 const n = new Date();
 month = n.getFullYear() + '-' + pad(n.getMonth() + 1);
 render();
});

$('#colsBtn').addEventListener('click', () => {
 const b = $('#colsBox');
 b.hidden = !b.hidden;
 $('#colsBtn').setAttribute('aria-expanded', String(!b.hidden));
});

$('#pubBtn').addEventListener('click', publish);
$('#logout').addEventListener('click', () => logout(false));
$('#reload').addEventListener('click', async () => {
 if (state.dirty && !confirm('Scartare le modifiche non pubblicate?')) return;
 try { await loadRemote(); render(); toast('Ricaricato dal server'); }
 catch { toast('Server non raggiungibile'); }
});

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', flush);
window.addEventListener('scroll', onScroll, { passive: true });
$('#mainGridWrap').addEventListener('scroll', onScroll, { passive: true });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
start();