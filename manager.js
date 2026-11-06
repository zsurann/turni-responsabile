'use strict';
const API = String(window.TURNI_API || '').replace(/\/$/, '');
const LS_STATE = 'resp.state.v1', LS_PW = 'resp.pw.v1', LS_PUB = 'resp.pub.v1';
const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const MES3 = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const GG = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const DEFAULT_COLS = [{ start: '06:00', end: '14:00', label: '' }, { start: '14:00', end: '22:00', label: '' }, { start: '22:00', end: '06:00', label: '' }];

const $ = (s) => document.querySelector(s);
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x !== undefined) e.textContent = x; return e; };
const pad = (n) => String(n).padStart(2, '0');
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

// state = { sheets: [{ title, month:'YYYY-MM', cols:[{start,end,label}], cells:{ 'YYYY-MM-DD': ['', ...] } }], dirty }
let state = lsGet(LS_STATE, null);
let pw = lsGet(LS_PW, '');
let month = new Date().getFullYear() + '-' + pad(new Date().getMonth() + 1);
let title = '';
let saveTimer = 0, toastTimer = 0, scrollTimer = 0, firstRender = true;
const LS_UI = 'resp.ui.v1';
const ui = lsGet(LS_UI, {});
if (/^\d{4}-\d{2}$/.test(ui.month || '')) month = ui.month;
if (typeof ui.title === 'string') title = ui.title;

function toast(t) {
  const e = $('#toast'); e.textContent = t; e.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { e.hidden = true; }, 2600);
}
function persist() { lsSet(LS_STATE, state); }
function saveUi() { const g = $('.gridwrap'); lsSet(LS_UI, { month, title, y: window.scrollY, x: g ? g.scrollLeft : 0, t: g ? g.scrollTop : 0 }); }
// salva subito (chiusura app, cambio app, pagina nascosta): la bozza non aspetta il timer
function flush() { clearTimeout(saveTimer); if (state) persist(); saveUi(); }
function onScroll() { clearTimeout(scrollTimer); scrollTimer = setTimeout(saveUi, 250); }
function markDirty() { state.dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(persist, 300); renderBar(); }

function titles() { return [...new Set(state.sheets.map((s) => s.title))]; }
function daysIn(m) { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); }
function sheetFor(t, m, create) {
  let s = state.sheets.find((x) => x.title === t && x.month === m);
  if (s || !create) return s;
  // la struttura (colonne) si copia dal mese più vicino dello stesso foglio
  const sameTitle = state.sheets.filter((x) => x.title === t).sort((a, b) => Math.abs(a.month.localeCompare(m)) - Math.abs(b.month.localeCompare(m)));
  const cols = (sameTitle[0] ? sameTitle[0].cols : DEFAULT_COLS).map((c) => ({ ...c }));
  s = { title: t, month: m, cols, cells: {} };
  state.sheets.push(s);
  return s;
}
const isoDay = (m, d) => m + '-' + pad(d);

/* ---------- Pubblicazione: stesso formato che l'app dei turnisti legge dai PDF ---------- */
function toDocs() {
  const keep = new Date(); keep.setMonth(keep.getMonth() - 3);
  const minM = keep.getFullYear() + '-' + pad(keep.getMonth() + 1);
  return state.sheets.filter((s) => s.month >= minM).map((s) => {
    const [y, mo] = s.month.split('-').map(Number);
    const rows = [];
    for (let d = 1; d <= daysIn(s.month); d++) {
      const key = isoDay(s.month, d), c = s.cells[key] || [];
      rows.push({ date: key, cells: s.cols.map((_, i) => String(c[i] || '').trim().replace(/\s+/g, ' ')) });
    }
    return { id: s.title + ' ' + MES3[mo - 1] + '-' + String(y).slice(2), title: s.title, cols: s.cols.map((c) => ({ start: c.start, end: c.end, label: c.label || '' })), rows };
  }).filter((d) => d.rows.some((r) => r.cells.some((x) => x)));
}
function fromDocs(docs) {
  return docs.map((d) => {
    const m = d.rows.length ? d.rows[0].date.slice(0, 7) : month;
    const cells = {};
    d.rows.forEach((r) => { cells[r.date] = r.cells.slice(); });
    return { title: d.title, month: m, cols: d.cols.map((c) => ({ ...c })), cells };
  });
}

async function api(path, opt) {
  const r = await fetch(API + path, { ...opt, headers: { ...(opt && opt.headers), authorization: 'Bearer ' + pw } });
  return r;
}
async function loadRemote() {
  const r = await fetch(API + '/api/schedule', { cache: 'no-store' });
  if (!r.ok) throw new Error('server ' + r.status);
  const d = await r.json();
  state = { sheets: fromDocs(d.docs || []), dirty: false };
  lsSet(LS_PUB, { version: d.version });
  persist();
}
function noticeMonths() {
  const now = new Date(), cur = now.getFullYear() + '-' + pad(now.getMonth() + 1);
  const ms = [...new Set(toDocs().map((d) => d.rows[0].date.slice(0, 7)).filter((m) => m >= cur))].sort();
  const names = (ms.length ? ms : [month]).map((m) => MESI[+m.slice(5) - 1].toLowerCase());
  return names.length > 1 ? names.slice(0, -1).join(', ') + ' e ' + names[names.length - 1] : names[0];
}
async function sendNotice() {
  const body = 'Il responsabile ha pubblicato i turni di ' + noticeMonths() + '.';
  let cursor = null, sent = 0;
  for (let i = 0; i < 40; i++) {
    const r = await api('/api/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Turni aggiornati', body, cursor }) });
    if (!r.ok) throw new Error('notify ' + r.status);
    const d = await r.json(); sent += d.sent;
    if (d.done) return sent;
    cursor = d.cursor;
  }
  return sent;
}
async function publish() {
  const btn = $('#pubBtn'); btn.disabled = true; btn.textContent = 'Invio…';
  try {
    flush();
    const r = await api('/api/schedule', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ docs: toDocs() }) });
    if (r.status === 401) { logout(true); return; }
    if (!r.ok) throw new Error('server ' + r.status);
    const d = await r.json();
    state.dirty = false; state.noticePending = true; persist(); lsSet(LS_PUB, { version: d.version });
    try {
      const n = await sendNotice();
      state.noticePending = false; persist();
      toast('Pubblicato · avviso inviato a ' + n + (n === 1 ? ' persona' : ' persone'));
    } catch { toast('Pubblicato, ma l\'avviso non è partito: tocca Pubblica per riprovare'); }
  } catch { toast('Errore di rete: riprova'); }
  btn.textContent = 'Pubblica'; renderBar();
}

/* ---------- Interfaccia ---------- */
function renderBar() {
  const pub = lsGet(LS_PUB, null), st = $('#pubStatus');
  const pending = !!state.noticePending;
  st.className = state.dirty || pending ? 'dirty' : '';
  if (state.dirty) st.textContent = 'Bozza salvata sul telefono · non ancora pubblicata';
  else if (pending) st.textContent = 'Pubblicato, ma l\'avviso non è partito';
  else if (pub && pub.version) { const d = new Date(pub.version); st.textContent = 'Pubblicato il ' + d.getDate() + ' ' + MES3[d.getMonth()] + ' alle ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  else st.textContent = 'Niente di pubblicato';
  $('#pubBtn').disabled = !(state.dirty || pending);
}

function renderTabs() {
  const box = $('#tabs'); box.replaceChildren();
  titles().forEach((t) => {
    const b = el('button', 'tab' + (t === title ? ' on' : ''), t); b.type = 'button'; b.setAttribute('role', 'tab');
    b.addEventListener('click', () => { title = t; render(); });
    box.append(b);
  });
  const add = el('button', 'tab add', '+ Foglio'); add.type = 'button';
  add.addEventListener('click', () => {
    const t = (prompt('Nome del foglio (es. CAMPO NORD RONDA):') || '').trim().toUpperCase();
    if (!t) return;
    title = t; sheetFor(t, month, true); markDirty(); render();
  });
  box.append(add);
}

function renderCols(s) {
  const box = $('#colsBox'); box.replaceChildren();
  s.cols.forEach((c, i) => {
    const row = el('div', 'colrow');
    const f = (lbl, type, key) => {
      const w = el('div'); w.append(el('label', '', lbl));
      const inp = el('input'); inp.type = type; inp.value = c[key] || '';
      inp.addEventListener('change', () => { c[key] = inp.value; if (key !== 'label') { /* ricalcola intestazioni */ } markDirty(); renderGrid(s); });
      w.append(inp); return w;
    };
    row.append(f('Inizio', 'time', 'start'), f('Fine', 'time', 'end'));
    const x = el('button', 'colx', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Rimuovi colonna');
    x.addEventListener('click', () => {
      if (s.cols.length < 2) return toast('Serve almeno una colonna');
      if (!confirm('Rimuovere questa colonna e i nomi che contiene?')) return;
      s.cols.splice(i, 1); Object.keys(s.cells).forEach((k) => s.cells[k].splice(i, 1));
      markDirty(); renderCols(s); renderGrid(s);
    });
    const nm = f('Nome colonna (facoltativo, es. Turno Extra)', 'text', 'label'); nm.className = 'colname';
    row.append(x, nm); box.append(row);
  });
  const acts = el('div', 'colactions');
  const add = el('button', 'linkbtn', '+ Aggiungi colonna'); add.type = 'button';
  add.addEventListener('click', () => { s.cols.push({ start: '06:00', end: '14:00', label: '' }); markDirty(); renderCols(s); renderGrid(s); });
  const del = el('button', 'linkbtn', 'Elimina questo foglio (' + MESI[+month.slice(5) - 1] + ')'); del.type = 'button';
  del.addEventListener('click', () => {
    if (!confirm('Eliminare il foglio ' + s.title + ' di ' + MESI[+month.slice(5) - 1] + '?')) return;
    state.sheets = state.sheets.filter((x) => x !== s); markDirty(); render();
  });
  acts.append(add, del); box.append(acts);
}

function renderGrid(s) {
  const t = $('#grid'); t.replaceChildren();
  const hr = el('tr'); hr.append(Object.assign(el('th', 'day', 'Giorno')));
  s.cols.forEach((c) => { const th = el('th', '', c.start + '–' + c.end); if (c.label) th.append(el('small', '', c.label)); hr.append(th); });
  t.append(el('thead')); t.firstChild.append(hr);
  const body = el('tbody');
  const [y, mo] = month.split('-').map(Number);
  for (let d = 1; d <= daysIn(month); d++) {
    const key = isoDay(month, d), dow = new Date(y, mo - 1, d).getDay();
    const tr = el('tr', dow === 0 || dow === 6 ? 'we' : '');
    const td = el('td', 'day', String(d)); td.append(el('span', '', GG[dow])); tr.append(td);
    s.cols.forEach((_, i) => {
      const c = el('td'); const inp = el('input', 'cell');
      inp.type = 'text'; inp.value = (s.cells[key] || [])[i] || ''; inp.autocomplete = 'off'; inp.autocapitalize = 'characters'; inp.spellcheck = false;
      inp.setAttribute('aria-label', d + ' ' + MESI[mo - 1] + ' ' + s.cols[i].start + '-' + s.cols[i].end);
      inp.addEventListener('input', () => {
        const arr = s.cells[key] || (s.cells[key] = []);
        while (arr.length < s.cols.length) arr.push('');
        arr[i] = inp.value.toUpperCase(); markDirty();
      });
      c.append(inp); tr.append(c);
    });
    body.append(tr);
  }
  t.append(body);
}

function render() {
  const names = titles();
  if (!names.length) { title = 'CAMPO SUD ROM'; sheetFor(title, month, true); }
  else if (!names.includes(title)) title = names[0];
  const [y, mo] = month.split('-').map(Number);
  $('#monthLbl').textContent = MESI[mo - 1] + ' ' + y;
  const s = sheetFor(title, month, true);
  renderTabs(); renderCols(s); renderGrid(s); renderBar(); saveUi();
  if (firstRender) {
    firstRender = false;
    requestAnimationFrame(() => { const g = $('.gridwrap'); if (g) { g.scrollLeft = ui.x || 0; g.scrollTop = ui.t || 0; } window.scrollTo(0, ui.y || 0); });
  }
}

function show(logged) {
  $('#login').hidden = logged; $('#editor').hidden = !logged; $('#pubbar').hidden = !logged;
}
function logout(wrong) {
  pw = ''; lsSet(LS_PW, ''); show(false);
  $('#loginMsg').className = 'msg err'; $('#loginMsg').textContent = wrong ? 'Password non valida: rieffettua l\'accesso.' : '';
}
async function start() {
  if (!API) { show(false); $('#loginMsg').className = 'msg err'; $('#loginMsg').textContent = 'Manca l\'indirizzo del server in config.js'; return; }
  if (!pw) return show(false);
  show(true);
  if (!state) { try { await loadRemote(); } catch { state = { sheets: [], dirty: false }; toast('Server non raggiungibile'); } }
  render();
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#loginMsg'); msg.className = 'msg'; msg.textContent = 'Controllo…';
  const tryPw = $('#pw').value;
  try {
    const r = await fetch(API + '/api/auth', { headers: { authorization: 'Bearer ' + tryPw } });
    if (!r.ok) { msg.className = 'msg err'; msg.textContent = 'Password errata'; return; }
    pw = tryPw; lsSet(LS_PW, pw); $('#pw').value = ''; msg.textContent = ''; start();
  } catch { msg.className = 'msg err'; msg.textContent = 'Server non raggiungibile'; }
});
$('#mPrev').addEventListener('click', () => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 2, 1); month = d.getFullYear() + '-' + pad(d.getMonth() + 1); render(); });
$('#mNext').addEventListener('click', () => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m, 1); month = d.getFullYear() + '-' + pad(d.getMonth() + 1); render(); });
$('#colsBtn').addEventListener('click', () => { const b = $('#colsBox'); b.hidden = !b.hidden; $('#colsBtn').setAttribute('aria-expanded', String(!b.hidden)); });
$('#pubBtn').addEventListener('click', publish);
$('#logout').addEventListener('click', () => logout(false));
$('#reload').addEventListener('click', async () => {
  if (state.dirty && !confirm('Scartare le modifiche non pubblicate?')) return;
  try { await loadRemote(); render(); toast('Ricaricato dal server'); } catch { toast('Server non raggiungibile'); }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', flush);
window.addEventListener('scroll', onScroll, { passive: true });
$('.gridwrap').addEventListener('scroll', onScroll, { passive: true });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
start();
