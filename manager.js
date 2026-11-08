'use strict';
const API = String(window.TURNI_API || '').replace(/\/$/, '');
const LS_STATE = 'resp.state.v2', LS_LEGACY_STATE = 'resp.state.v1';
const LS_PW = 'resp.pw.v1', LS_PUB = 'resp.pub.v1', LS_EMP = 'resp.emp.v1', LS_UI = 'resp.ui.v1';

const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const MES3 = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const GG = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const DEFAULT_COLS = [
 { start: '06:00', end: '14:00', label: '' },
 { start: '14:00', end: '22:00', label: '' },
 { start: '22:00', end: '06:00', label: '' },
];
const EXTRA_PRESETS = [
 { start: '06:00', end: '18:00', label: 'Continuativo Diurno 12h' },
 { start: '18:00', end: '06:00', label: 'Continuativo Notturno 12h' },
 { start: '08:00', end: '20:00', label: 'Continuativo 08-20' },
 { start: '22:00', end: '06:00', label: 'Turno Extra Notte' },
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

// Carica stato (con migrazione automatica da v1 e separazione rigorosa per mese)
let state = lsGet(LS_STATE, null) || migrateState(lsGet(LS_LEGACY_STATE, null));
let employees = lsGet(LS_EMP, []);
let pw = lsGet(LS_PW, '');
const nowInit = new Date();
let month = nowInit.getFullYear() + '-' + pad(nowInit.getMonth() + 1);
let title = '';
let saveTimer = 0, toastTimer = 0, scrollTimer = 0, firstRender = true;
let activePicker = null;

const ui = lsGet(LS_UI, {});
if (/^\d{4}-\d{2}$/.test(ui.month || '')) month = ui.month;
if (typeof ui.title === 'string') title = ui.title;

function normTitle(t) {
 return String(t || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

// Garantisce che ogni foglio contenga SOLO le date del proprio mese YYYY-MM
function migrateState(raw) {
 if (!raw || !Array.isArray(raw.sheets)) return null;
 const byKey = new Map();
 raw.sheets.forEach((s) => {
 const t = normTitle(s.title);
 const m = /^\d{4}-\d{2}$/.test(s.month || '') ? s.month : month;
 if (!t) return;
 const key = t + '|' + m;
 const cols = Array.isArray(s.cols) && s.cols.length ? s.cols.map((c) => ({ start: c.start, end: c.end, label: c.label || '' })) : DEFAULT_COLS.map((c) => ({ ...c }));
 const extraCols = Array.isArray(s.extraCols) ? s.extraCols.map((c) => ({ start: c.start, end: c.end, label: c.label || 'Turno Extra' })) : [];
 const cells = {};
 const extraCells = {};
 Object.entries(s.cells || {}).forEach(([date, arr]) => {
 if (date.slice(0, 7) === m && Array.isArray(arr)) cells[date] = arr.slice(0, cols.length);
 });
 Object.entries(s.extraCells || {}).forEach(([date, arr]) => {
 if (date.slice(0, 7) === m && Array.isArray(arr)) extraCells[date] = arr.slice(0, extraCols.length);
 });
 byKey.set(key, { title: t, month: m, cols, extraCols, cells, extraCells });
 });
 return { sheets: [...byKey.values()], dirty: !!raw.dirty, noticePending: !!raw.noticePending };
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
}

function titles() {
 return [...new Set(state.sheets.map((s) => normTitle(s.title)).filter(Boolean))];
}
function daysIn(m) {
 const [y, mo] = m.split('-').map(Number);
 return new Date(y, mo, 0).getDate();
}
const isoDay = (m, d) => m + '-' + pad(d);

// Restituisce il foglio per (title, month) senza mai mischiare i mesi tra loro
function sheetFor(t, m, create) {
 const nt = normTitle(t);
 let s = state.sheets.find((x) => normTitle(x.title) === nt && x.month === m);
 if (s) {
 s.title = nt;
 if (!Array.isArray(s.extraCols)) s.extraCols = [];
 if (!s.extraCells) s.extraCells = {};
 return s;
 }
 if (!create) return null;
 // Copia solo la struttura oraria delle colonne dal mese precedente più vicino dello stesso foglio
 const sameTitle = state.sheets
 .filter((x) => normTitle(x.title) === nt)
 .sort((a, b) => b.month.localeCompare(a.month));
 const ref = sameTitle[0];
 const cols = (ref && ref.cols && ref.cols.length ? ref.cols : DEFAULT_COLS).map((c) => ({ start: c.start, end: c.end, label: c.label || '' }));
 const extraCols = (ref && Array.isArray(ref.extraCols) ? ref.extraCols : []).map((c) => ({ start: c.start, end: c.end, label: c.label || 'Turno Extra' }));
 s = { title: nt, month: m, cols, extraCols, cells: {}, extraCells: {} };
 state.sheets.push(s);
 return s;
}

// Classifica una colonna per colore (Mattina, Pomeriggio, Notte, Continuativo/Extra)
function colTheme(col, isExtraTable) {
 if (isExtraTable || /extra|continuat/i.test(col.label || '')) return 'col-c';
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

function isExtraOrContCol(col) {
 if (/extra|continuat/i.test(col.label || '')) return true;
 const [sh, sm] = (col.start || '00:00').split(':').map(Number);
 const [eh, em] = (col.end || '00:00').split(':').map(Number);
 const sMin = sh * 60 + (sm || 0);
 let eMin = eh * 60 + (em || 0);
 if (eMin <= sMin) eMin += 1440;
 return (eMin - sMin) / 60 >= 10;
}

// Estrae il nome pulito da una cella (rimuovendo eventuali numeri d'orario come "18 ROSSI M." o "ROSSI M. 18")
function extractPureName(raw) {
 const toks = String(raw || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
 const clean = toks.filter((t) => !/^\d{1,2}(?:[:.]\d{2})?$/.test(t));
 const joined = clean.join(' ');
 if (!joined || joined === 'NO' || joined === 'RIPOSO') return '';
 return joined;
}

// Sincronizza in automatico nella lista dipendenti eventuali nomi già scritti nelle tabelle
function syncEmployeesFromSheets() {
 const set = new Set(employees.map((e) => e.toUpperCase()));
 let changed = false;
 if (state && Array.isArray(state.sheets)) {
 state.sheets.forEach((s) => {
 [s.cells || {}, s.extraCells || {}].forEach((map) => {
 Object.values(map).forEach((arr) => {
 (arr || []).forEach((val) => {
 const nm = extractPureName(val);
 if (nm && nm.length >= 2 && !set.has(nm)) {
 set.add(nm);
 employees.push(nm);
 changed = true;
 }
 });
 });
 });
 });
 }
 employees.sort((a, b) => a.localeCompare(b, 'it'));
 if (changed) lsSet(LS_EMP, employees);
}

/* ---------- Pubblicazione: unisce colonne standard + continuative nel formato letto dall'app turnisti ---------- */
function toDocs() {
 const keep = new Date();
 keep.setDate(1);
 keep.setMonth(keep.getMonth() - 3);
 const minM = keep.getFullYear() + '-' + pad(keep.getMonth() + 1);

 // Raggruppa rigorosamente per (title, month) così due mesi diversi non si sovrascrivono mai
 const validSheets = state.sheets.filter((s) => s.month >= minM);
 return validSheets.map((s) => {
 const [y, mo] = s.month.split('-').map(Number);
 const stdCols = s.cols.map((c) => ({ start: c.start, end: c.end, label: c.label || '' }));
 const extCols = (s.extraCols || []).map((c) => ({
 start: c.start,
 end: c.end,
 label: c.label ? (/extra/i.test(c.label) ? c.label : 'Extra ' + c.label) : 'Turno Extra',
 }));
 const allCols = stdCols.concat(extCols);
 const rows = [];
 for (let d = 1; d <= daysIn(s.month); d++) {
 const key = isoDay(s.month, d);
 const cStd = (s.cells && s.cells[key]) || [];
 const cExt = (s.extraCells && s.extraCells[key]) || [];
 const rowCells = stdCols.map((_, i) => String(cStd[i] || '').trim().replace(/\s+/g, ' '))
 .concat(extCols.map((_, i) => String(cExt[i] || '').trim().replace(/\s+/g, ' ')));
 rows.push({ date: key, cells: rowCells });
 }
 return {
 id: s.title + ' ' + MES3[mo - 1] + '-' + String(y).slice(2),
 title: s.title,
 month: s.month,
 cols: allCols,
 stdCount: stdCols.length,
 rows,
 };
 }).filter((d) => d.rows.some((r) => r.cells.some((x) => x)));
}

// Ricostruisce i fogli separando rigorosamente ogni documento per mese YYYY-MM
function fromDocs(docs) {
 const map = new Map();
 (docs || []).forEach((d) => {
 const t = normTitle(d.title);
 if (!t || !Array.isArray(d.rows)) return;
 // Raggruppa le righe del documento per mese effettivo (YYYY-MM) così mesi diversi non confliggono mai
 const rowsByMonth = {};
 d.rows.forEach((r) => {
 if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) return;
 const m = r.date.slice(0, 7);
 (rowsByMonth[m] = rowsByMonth[m] || []).push(r);
 });

 Object.entries(rowsByMonth).forEach(([m, mRows]) => {
 const key = t + '|' + m;
 const rawCols = Array.isArray(d.cols) ? d.cols : DEFAULT_COLS;
 const stdIdx = [], extIdx = [];
 rawCols.forEach((c, idx) => {
 if (typeof d.stdCount === 'number') {
 if (idx < d.stdCount) stdIdx.push(idx); else extIdx.push(idx);
 } else if (idx >= 3 && isExtraOrContCol(c)) {
 extIdx.push(idx);
 } else {
 stdIdx.push(idx);
 }
 });
 const cols = stdIdx.map((i) => ({ start: rawCols[i].start, end: rawCols[i].end, label: rawCols[i].label || '' }));
 const extraCols = extIdx.map((i) => ({ start: rawCols[i].start, end: rawCols[i].end, label: rawCols[i].label || 'Turno Extra' }));
 const cells = {}, extraCells = {};
 mRows.forEach((r) => {
 cells[r.date] = stdIdx.map((i) => (r.cells && r.cells[i]) || '');
 if (extIdx.length) extraCells[r.date] = extIdx.map((i) => (r.cells && r.cells[i]) || '');
 });
 map.set(key, { title: t, month: m, cols: cols.length ? cols : DEFAULT_COLS.map((c) => ({ ...c })), extraCols, cells, extraCells });
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
 const merged = new Set([...employees, ...d.employees.map((x) => normTitle(x)).filter(Boolean)]);
 employees = [...merged].sort((a, b) => a.localeCompare(b, 'it'));
 }
 state = { sheets: fromDocs(d.docs || []), dirty: false };
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
 body: JSON.stringify({ docs: toDocs(), employees }),
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

/* ---------- Riepilogo del mese selezionato (isolato dal mese corrente) ---------- */
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

 // Calcola statistiche SOLO sui fogli del mese attualmente selezionato (`month`)
 const monthSheets = state.sheets.filter((s) => s.month === month);
 let totalAssigned = 0;
 let activeSheets = 0;
 const uniqueOps = new Set();

 monthSheets.forEach((s) => {
 let sheetHasShifts = false;
 [s.cells || {}, s.extraCells || {}].forEach((cellMap) => {
 Object.entries(cellMap).forEach(([date, arr]) => {
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
 });
 if (sheetHasShifts) activeSheets++;
 });

 const box = $('#mStats');
 const mk = (v, l) => {
 const d = el('div', 'mstat');
 d.append(el('b', '', String(v)), el('span', '', l));
 return d;
 };
 box.replaceChildren(
 mk(activeSheets + ' / ' + titles().length, 'Fogli compilati in ' + MES3[mo - 1]),
 mk(totalAssigned, 'Turni assegnati in ' + MES3[mo - 1]),
 mk(uniqueOps.size, 'Operatori in ' + MES3[mo - 1])
 );
}

/* ---------- Gestione Lista Dipendenti ---------- */
function renderEmployees() {
 $('#empCountLbl').textContent = employees.length
 ? employees.length + (employees.length === 1 ? ' dipendente salvato' : ' dipendenti salvati')
 : 'Nessun dipendente salvato (clicca Gestisci)';
 const list = $('#empList');
 list.replaceChildren();
 if (!employees.length) {
 list.append(el('span', 'hint', 'Aggiungi i nomi dei dipendenti qui sopra (es. GENNARO C., CELENTANO).'));
 return;
 }
 employees.forEach((emp) => {
 const chip = el('span', 'emp-chip', emp);
 const del = el('button', '', '✕');
 del.type = 'button';
 del.title = 'Rimuovi ' + emp;
 del.addEventListener('click', () => {
 employees = employees.filter((x) => x !== emp);
 persist();
 renderEmployees();
 });
 chip.append(del);
 list.append(chip);
 });
}

$('#empForm').addEventListener('submit', (e) => {
 e.preventDefault();
 const inp = $('#empInput');
 const val = normTitle(inp.value);
 if (!val) return;
 if (!employees.includes(val)) {
 employees.push(val);
 employees.sort((a, b) => a.localeCompare(b, 'it'));
 persist();
 renderEmployees();
 toast('Aggiunto ' + val);
 }
 inp.value = '';
 inp.focus();
});

$('#empBtn').addEventListener('click', () => {
 const b = $('#empBox');
 b.hidden = !b.hidden;
 $('#empBtn').setAttribute('aria-expanded', String(!b.hidden));
});

/* ---------- Selettore Rapido Dipendente (Bottom Sheet al click sulla casella) ---------- */
function operatorsWorkingOnDay(isoDate) {
 const busy = new Map();
 state.sheets.filter((s) => s.month === month).forEach((s) => {
 (s.cols || []).forEach((col, i) => {
 const v = (s.cells && s.cells[isoDate] && s.cells[isoDate][i]) || '';
 const nm = extractPureName(v);
 if (nm) busy.set(nm, s.title + ' (' + col.start + '–' + col.end + ')');
 });
 (s.extraCols || []).forEach((col, i) => {
 const v = (s.extraCells && s.extraCells[isoDate] && s.extraCells[isoDate][i]) || '';
 const nm = extractPureName(v);
 if (nm) busy.set(nm, s.title + ' Extra (' + col.start + '–' + col.end + ')');
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
 const n = normTitle(name);
 if (!n) return '';
 const parts = [];
 if (startHour && startHour.trim()) parts.push(startHour.trim());
 parts.push(n);
 if (endHour && endHour.trim()) parts.push(endHour.trim());
 return parts.join(' ');
}

function openCellPicker(sheet, key, colIdx, isExtra, triggerBtn) {
 const cols = isExtra ? sheet.extraCols : sheet.cols;
 const cellMap = isExtra ? sheet.extraCells : sheet.cells;
 const col = cols[colIdx];
 const curRaw = (cellMap[key] && cellMap[key][colIdx]) || '';
 const parsed = parseCellValue(curRaw);
 const [y, mo, d] = key.split('-').map(Number);
 const dow = new Date(y, mo - 1, d).getDay();

 activePicker = { sheet, key, colIdx, isExtra, triggerBtn, parsed };
 $('#pkTitle').textContent = GG[dow] + ' ' + d + ' ' + MESI[mo - 1] + ' · ' + col.start + '–' + col.end;
 $('#pkSub').textContent = sheet.title + (col.label ? ' · ' + col.label : '');

 const body = $('#pkBody');
 body.replaceChildren();

 const setCellValue = (newVal) => {
 const arr = cellMap[key] || (cellMap[key] = []);
 while (arr.length < cols.length) arr.push('');
 arr[colIdx] = String(newVal || '').trim().toUpperCase();
 const Pure = extractPureName(arr[colIdx]);
 if (Pure && Pure.length >= 2 && !employees.includes(Pure)) {
 employees.push(Pure);
 employees.sort((a, b) => a.localeCompare(b, 'it'));
 renderEmployees();
 }
 markDirty();
 renderAllGrids(sheet);
 closeCellPicker();
 };

 // Stato attuale e pulsante Svuota
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

 // Opzioni di orario anticipato/posticipato (es. 18 ROSSI M. o ROSSI M. 18)
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

 // Griglia dipendenti salvati
 body.append(el('p', 'q', 'Tocca un dipendente per assegnarlo'));
 const busyMap = operatorsWorkingOnDay(key);
 const grid = el('div', 'pk-grid');

 employees.forEach((emp) => {
 const isCur = parsed.name === emp;
 const busyWhere = busyMap.get(emp);
 const btn = el('button', 'pk-emp' + (isCur ? ' active' : (busyWhere ? ' busy' : '')));
 btn.type = 'button';
 btn.append(el('b', '', emp));
 btn.append(el('span', '', isCur ? 'Selezionato ✓' : (busyWhere ? 'Già in: ' + busyWhere : 'Disponibile')));
 btn.addEventListener('click', () => {
 setCellValue(formatCellValue(emp, hStart.inp.value, hEnd.inp.value));
 });
 grid.append(btn);
 });

 // Pulsante "NO" (nessun servizio)
 const noBtn = el('button', 'pk-emp' + (curRaw === 'NO' ? ' active' : ''));
 noBtn.type = 'button';
 noBtn.append(el('b', '', 'NO'), el('span', '', 'Turno scoperto / non attivo'));
 noBtn.addEventListener('click', () => setCellValue('NO'));
 grid.append(noBtn);
 body.append(grid);

 // Variazione orario sul nome già selezionato
 body.append(el('p', 'q', 'Orario ridotto o prolungato (facoltativo)'));
 body.append(hrsBox);
 if (parsed.name && parsed.name !== 'NO') {
 const applyHrs = el('button', 'ghost', 'Aggiorna orario per ' + parsed.name);
 applyHrs.type = 'button';
 applyHrs.addEventListener('click', () => {
 setCellValue(formatCellValue(parsed.name, hStart.inp.value, hEnd.inp.value));
 });
 body.append(applyHrs);
 }

 // Inserimento manuale nuovo dipendente al volo
 body.append(el('p', 'q', 'Oppure scrivi un nome manualmente'));
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

function renderTabs() {
 const box = $('#tabs');
 box.replaceChildren();
 titles().forEach((t) => {
 const b = el('button', 'tab' + (t === title ? ' on' : ''), t);
 b.type = 'button';
 b.setAttribute('role', 'tab');
 b.addEventListener('click', () => { title = t; render(); });
 box.append(b);
 });
 const add = el('button', 'tab add', '+ Nuovo Foglio');
 add.type = 'button';
 add.addEventListener('click', () => {
 const t = normTitle(prompt('Nome del foglio (es. CAMPO NORD RONDA):') || '');
 if (!t) return;
 title = t;
 sheetFor(t, month, true);
 markDirty();
 render();
 });
 box.append(add);
}

function renderColsEditor(s, isExtra) {
 const box = $(isExtra ? '#extraColsBox' : '#colsBox');
 const cols = isExtra ? s.extraCols : s.cols;
 const cellMap = isExtra ? s.extraCells : s.cells;
 box.replaceChildren();

 if (isExtra) {
 const pTitle = el('p', 'q', 'Aggiungi rapido orario continuativo / extra:');
 const pBar = el('div', 'preset-bar');
 EXTRA_PRESETS.forEach((pr) => {
 const b = el('button', 'preset-btn', '+ ' + pr.start + '–' + pr.end + ' (' + pr.label + ')');
 b.type = 'button';
 b.addEventListener('click', () => {
 cols.push({ ...pr });
 markDirty();
 renderColsEditor(s, true);
 renderAllGrids(s);
 });
 pBar.append(b);
 });
 box.append(pTitle, pBar);
 } else {
 $('#colsCountLbl').textContent = cols.length + (cols.length === 1 ? ' colonna oraria' : ' colonne orarie');
 }

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
 if (!isExtra && cols.length < 1) return toast('Serve almeno una colonna');
 if (!confirm('Rimuovere questa colonna (' + c.start + '–' + c.end + ') e i nomi che contiene in ' + MESI[+month.slice(5) - 1] + '?')) return;
 cols.splice(i, 1);
 Object.keys(cellMap).forEach((k) => cellMap[k].splice(i, 1));
 markDirty();
 renderColsEditor(s, isExtra);
 renderAllGrids(s);
 });
 const nm = f(isExtra ? 'Etichetta (es. Continuativo 12h o Turno Extra)' : 'Nome colonna (facoltativo)', 'text', 'label');
 nm.className = 'colname';
 row.append(x, nm);
 box.append(row);
 });

 const acts = el('div', 'colactions');
 const add = el('button', 'linkbtn', isExtra ? '+ Aggiungi colonna continuativa/extra personalizzata' : '+ Aggiungi colonna ordinaria');
 add.type = 'button';
 add.addEventListener('click', () => {
 cols.push(isExtra ? { start: '06:00', end: '18:00', label: 'Continuativo' } : { start: '06:00', end: '14:00', label: '' });
 markDirty();
 renderColsEditor(s, isExtra);
 renderAllGrids(s);
 });
 acts.append(add);

 if (!isExtra) {
 const del = el('button', 'linkbtn', 'Elimina foglio ' + s.title + ' (' + MESI[+month.slice(5) - 1] + ')');
 del.type = 'button';
 del.addEventListener('click', () => {
 if (!confirm('Eliminare il foglio ' + s.title + ' di ' + MESI[+month.slice(5) - 1] + '?')) return;
 state.sheets = state.sheets.filter((x) => x !== s);
 markDirty();
 render();
 });
 acts.append(del);
 }
 box.append(acts);
}

function buildTableDOM(tableEl, s, isExtra) {
 const cols = isExtra ? s.extraCols : s.cols;
 const cellMap = isExtra ? s.extraCells : s.cells;
 tableEl.replaceChildren();
 if (!cols.length) return;

 const hr = el('tr');
 hr.append(el('th', 'day', 'Giorno'));
 cols.forEach((c) => {
 const theme = colTheme(c, isExtra);
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
 const theme = colTheme(col, isExtra);
 const c = el('td');
 const val = ((cellMap[key] || [])[i] || '').trim();
 const btn = el('button', 'cell-btn ' + theme + (val ? ' filled' : ' empty') + (val === 'NO' ? ' is-no' : ''));
 btn.type = 'button';
 btn.setAttribute('aria-label', d + ' ' + MESI[mo - 1] + ' ' + col.start + '-' + col.end);
 btn.append(
 el('span', 'c-txt', val || '+ Assegna'),
 el('span', 'c-arr', '▾')
 );
 btn.addEventListener('click', () => openCellPicker(s, key, i, isExtra, btn));
 c.append(btn);
 tr.append(c);
 });
 body.append(tr);
 }
 tableEl.append(body);
}

function renderAllGrids(s) {
 const [y, mo] = month.split('-').map(Number);
 $('#mainTableTitle').textContent = s.title + ' · Turni Ordinari';
 $('#mainTableSub').textContent = MESI[mo - 1] + ' ' + y + ' · ' + daysIn(month) + ' giorni';
 buildTableDOM($('#grid'), s, false);

 const hasExtra = s.extraCols && s.extraCols.length > 0;
 $('#extraGridWrap').hidden = !hasExtra;
 $('#extraEmpty').hidden = hasExtra;
 if (hasExtra) buildTableDOM($('#extraGrid'), s, true);
}

function render() {
 const names = titles();
 if (!names.length) {
 title = 'CAMPO SUD ROM';
 sheetFor(title, month, true);
 } else if (!names.includes(title)) {
 title = names[0];
 }
 const [y, mo] = month.split('-').map(Number);
 $('#monthLbl').textContent = MESI[mo - 1] + ' ' + y;
 const s = sheetFor(title, month, true);

 renderMonthStats();
 renderTabs();
 renderEmployees();
 renderColsEditor(s, false);
 renderColsEditor(s, true);
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
 catch { state = { sheets: [], dirty: false }; toast('Server non raggiungibile'); }
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
$('#extraColsBtn').addEventListener('click', () => {
 const b = $('#extraColsBox');
 b.hidden = !b.hidden;
 $('#extraColsBtn').setAttribute('aria-expanded', String(!b.hidden));
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