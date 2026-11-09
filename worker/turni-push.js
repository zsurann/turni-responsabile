/* Turni La Falco · server notifiche push (Cloudflare Worker)
- KV namespace collegato con il nome TURNI
- Cron Trigger consigliato: ogni 2 minuti
Le chiavi VAPID si creano da sole alla prima richiesta e restano nel KV.
Variabili facoltative: ALLOWED_ORIGIN (indirizzo del sito), SUBJECT (tua email come mailto:...).

Consumo KV: ogni iscrizione salva nei metadati della chiave l'ora della prossima notifica
("next"). Il cron legge solo l'elenco delle chiavi e apre soltanto le iscrizioni che hanno
davvero qualcosa da inviare; /api/sync scrive solo se qualcosa è cambiato. */

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function sha(s) {
 const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
 return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const HOUR = 3600e3;
const LATE_MS = 6 * HOUR;          // una notifica non partita entro 6 ore viene lasciata perdere
const SUB_TTL = 90 * 86400;        // un'iscrizione non aggiornata per 90 giorni scade da sola
const REFRESH_MS = 30 * 86400e3;   // anche se nulla cambia, riscrive ogni 30 giorni per non farla scadere

// Cache in memoria finché l'istanza del Worker resta attiva:
// evita una lettura KV e l'importazione della chiave a ogni singola push.
let vapidCache = null;
let signKey = null;
const jwtCache = new Map(); // origine del servizio push -> { jwt, exp }

async function vapid(env) {
 if (vapidCache) return vapidCache;
 let v = await env.TURNI.get('vapid', 'json');
 if (!v) {
 const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
 const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
 const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
 const raw = new Uint8Array(65);
 raw[0] = 4; raw.set(fromB64u(pub.x), 1); raw.set(fromB64u(pub.y), 33);
 v = { priv, pub: b64u(raw) };
 await env.TURNI.put('vapid', JSON.stringify(v));
 v = (await env.TURNI.get('vapid', 'json')) || v;
 }
 vapidCache = v;
 return v;
}

// Il JWT VAPID vale 12 ore: lo riuso per lo stesso servizio push finché manca più di un'ora alla scadenza
async function vapidJwt(env, aud) {
 const now = Math.floor(Date.now() / 1000);
 const c = jwtCache.get(aud);
 if (c && c.exp - now > 3600) return c.jwt;
 const v = await vapid(env);
 if (!signKey) signKey = await crypto.subtle.importKey('jwk', v.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
 const exp = now + 12 * 3600;
 const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
 const body = b64u(enc.encode(JSON.stringify({ aud, exp, sub: env.SUBJECT || 'https://turni-la-falco.pages.dev' })));
 const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signKey, enc.encode(head + '.' + body));
 const jwt = head + '.' + body + '.' + b64u(sig);
 jwtCache.set(aud, { jwt, exp });
 return jwt;
}

const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; a.forEach((x) => { o.set(x, i); i += x.length; }); return o; };
async function hkdf(ikm, salt, info, len) {
 const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
// Cifratura del contenuto (Web Push, RFC 8291, aes128gcm). "t" serve solo ai test.
async function encryptPayload(keys, plain, t) {
 const ua = fromB64u(keys.p256dh), auth = fromB64u(keys.auth);
 const as = (t && t.as) || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
 const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
 const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
 const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
 const salt = (t && t.salt) || crypto.getRandomValues(new Uint8Array(16));
 const ikm = await hkdf(secret, auth, cat(enc.encode('WebPush: info\0'), ua, asPub), 32);
 const cek = await hkdf(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 16);
 const nonce = await hkdf(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 12);
 const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
 const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, cat(plain, new Uint8Array([2]))));
 return cat(salt, new Uint8Array([0, 0, 16, 0, 65]), asPub, ct);
}

// Invia una push; con "payload" il testo viaggia cifrato, altrimenti la push è vuota
async function sendPush(env, rec, payload) {
 const v = await vapid(env);
 const jwt = await vapidJwt(env, new URL(rec.endpoint).origin);
 const headers = { Authorization: 'vapid t=' + jwt + ', k=' + v.pub, TTL: '7200', Urgency: 'high' };
 let body;
 if (payload && rec.keys && rec.keys.p256dh && rec.keys.auth) {
 body = await encryptPayload(rec.keys, enc.encode(JSON.stringify(payload)));
 headers['Content-Encoding'] = 'aes128gcm';
 headers['Content-Type'] = 'application/octet-stream';
 }
 return fetch(rec.endpoint, { method: 'POST', headers, body });
}

// Ora della prossima notifica ancora da inviare (0 = nessuna in programma)
function nextDue(notifs, sent) {
 let m = Infinity;
 for (const n of notifs) if (!sent.includes(n.id) && n.at < m) m = n.at;
 return Number.isFinite(m) ? m : 0;
}
// Salva un'iscrizione con "next" nei metadati, così il cron non deve aprirla a ogni giro
async function saveSub(env, key, rec) {
 const ids = new Set(rec.notifs.map((n) => n.id));
 const sent = rec.sent.filter((id) => ids.has(id));
 const data = { endpoint: rec.endpoint, keys: rec.keys || null, notifs: rec.notifs, sent, saved: Date.now() };
 await env.TURNI.put(key, JSON.stringify(data), { expirationTtl: SUB_TTL, metadata: { next: nextDue(data.notifs, sent) } });
}
// Coda di riserva per i dispositivi senza chiavi di cifratura (il service worker la legge da /api/due)
async function queueDue(env, h, note) {
 const prev = (await env.TURNI.get('due:' + h, 'json')) || [];
 if (prev.some((p) => p.id === note.id)) return; // già in coda: niente doppioni né scritture inutili
 await env.TURNI.put('due:' + h, JSON.stringify(prev.concat(note).slice(-10)), { expirationTtl: 3600 });
}

const cors = (env) => ({
 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
 'Access-Control-Allow-Headers': 'content-type',
 'Access-Control-Max-Age': '86400',
 Vary: 'Origin',
});
const json = (env, data, status) => new Response(JSON.stringify(data), { status: status || 200, headers: { 'content-type': 'application/json', ...cors(env) } });
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
const okEndpoint = (e) => {
 try {
 const u = new URL(e);
 return u.protocol === 'https:' && e.length <= 1200 && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
 } catch { return false; }
};
const str = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '');

async function handle(req, env) {
 const url = new URL(req.url);
 if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
 if (url.pathname === '/' || url.pathname === '') return json(env, { ok: true, name: 'turni-push' });
 if (url.pathname === '/api/key' && req.method === 'GET') return json(env, { key: (await vapid(env)).pub });
 if (req.method !== 'POST') return json(env, { error: 'not found' }, 404);
 const origin = req.headers.get('Origin');
 if (env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== '*' && origin && origin !== env.ALLOWED_ORIGIN) return json(env, { error: 'forbidden' }, 403);

 const text = await req.text();
 if (text.length > 120000) return json(env, { error: 'too big' }, 413);
 let b;
 try { b = JSON.parse(text); } catch { return json(env, { error: 'bad json' }, 400); }
 if (!b || typeof b !== 'object') return json(env, { error: 'bad json' }, 400);

 if (url.pathname === '/api/sync') {
 const sub = b.sub;
 if (!sub || !okEndpoint(sub.endpoint)) return json(env, { error: 'bad subscription' }, 400);
 const now = Date.now();
 const seen = new Set();
 const notifs = (Array.isArray(b.notifs) ? b.notifs : []).slice(0, 400)
 .map((n) => ({ id: str(n && n.id, 80), at: Number(n && n.at), title: str(n && n.title, 80), body: str(n && n.body, 200) }))
 .filter((n) => n.id && Number.isFinite(n.at) && n.at > now - LATE_MS && n.at < now + 120 * 864e5 && !seen.has(n.id) && seen.add(n.id))
 .sort((x, y) => x.at - y.at);
 const keys = sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string'
 ? { p256dh: sub.keys.p256dh.slice(0, 120), auth: sub.keys.auth.slice(0, 60) } : null;
 const h = await sha(sub.endpoint);
 const old = (await env.TURNI.get('sub:' + h, 'json')) || {};
 const keep = new Set(notifs.map((n) => n.id));
 const sent = (old.sent || []).filter((id) => keep.has(id));
 const rec = { endpoint: sub.endpoint, keys, notifs, sent };
 // Scrive solo se qualcosa è cambiato (le scritture KV gratuite sono poche) o se è ora di rinnovare la scadenza
 const unchanged = old.endpoint
 && JSON.stringify({ e: old.endpoint, k: old.keys || null, n: old.notifs || [], s: old.sent || [] }) === JSON.stringify({ e: rec.endpoint, k: keys, n: notifs, s: sent })
 && old.saved > now - REFRESH_MS;
 if (!unchanged) await saveSub(env, 'sub:' + h, rec);
 return json(env, { ok: true, count: notifs.length });
 }
 if (url.pathname === '/api/unsub') {
 if (!okEndpoint(b.endpoint)) return json(env, { error: 'bad endpoint' }, 400);
 const h = await sha(b.endpoint);
 await env.TURNI.delete('sub:' + h); await env.TURNI.delete('due:' + h);
 return json(env, { ok: true });
 }
 if (url.pathname === '/api/due') { // chiamata dal service worker quando arriva una push
 if (!okEndpoint(b.endpoint)) return json(env, []);
 const h = await sha(b.endpoint);
 const list = (await env.TURNI.get('due:' + h, 'json')) || [];
 if (list.length) await env.TURNI.delete('due:' + h);
 return json(env, list);
 }
 if (url.pathname === '/api/test') {
 if (!okEndpoint(b.endpoint)) return json(env, { error: 'bad endpoint' }, 400);
 const h = await sha(b.endpoint);
 const rec = (await env.TURNI.get('sub:' + h, 'json')) || { endpoint: b.endpoint };
 const note = { id: 'test', title: 'Turni La Falco', body: 'Le notifiche funzionano ✓' };
 if (!rec.keys) await queueDue(env, h, note); // per chi non riceve il testo cifrato
 const r = await sendPush(env, rec, note);
 return json(env, { ok: r.ok, status: r.status });
 }
 return json(env, { error: 'not found' }, 404);
}

async function runCron(env) {
 const now = Date.now();
 let cursor;
 do {
 const page = await env.TURNI.list({ prefix: 'sub:', cursor });
 for (const k of page.keys) {
 // Dai metadati: se la prossima notifica non è ancora scaduta, non serve aprire l'iscrizione
 const next = k.metadata && typeof k.metadata.next === 'number' ? k.metadata.next : null;
 if (next !== null && (next === 0 || next > now)) continue;

 const rec = await env.TURNI.get(k.name, 'json');
 if (!rec || !rec.endpoint) continue;
 const sent = rec.sent || [];
 const all = rec.notifs || [];
 const due = all.filter((n) => n.at <= now && n.at > now - LATE_MS && !sent.includes(n.id));
 const live = all.filter((n) => n.at > now - LATE_MS);
 // next === null: iscrizione salvata dalla versione precedente, la riscrivo per aggiungere i metadati
 let changed = next === null || live.length !== all.length;
 const h = k.name.slice(4);
 let gone = false;
 for (const n of due) {
 const note = { id: n.id, title: n.title, body: n.body };
 if (!rec.keys) await queueDue(env, h, note); // senza chiavi: push vuota, il testo lo chiede il service worker
 let res;
 try { res = await sendPush(env, rec, note); } catch { res = null; }
 if (res && (res.status === 404 || res.status === 410)) { gone = true; break; }
 if (res && res.ok) { sent.push(n.id); changed = true; }
 }
 if (gone) { await env.TURNI.delete(k.name); await env.TURNI.delete('due:' + h); continue; }
 if (changed) await saveSub(env, k.name, { endpoint: rec.endpoint, keys: rec.keys, notifs: live, sent });
 }
 cursor = page.list_complete ? undefined : page.cursor;
 } while (cursor);
}

export const _test = { encryptPayload, okEndpoint, nextDue, runCron, handle };
export default {
 async fetch(req, env) {
 try { return await handle(req, env); } catch (e) { return json(env, { error: 'server error' }, 500); }
 },
 async scheduled(_ev, env, ctx) { ctx.waitUntil(runCron(env)); },
};
