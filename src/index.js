// Friction log: a personal logger for HCI research, Stage 2.
// One Worker serves the logging form, the summary page and a small JSON API backed by D1.

const TYPES = ['channel', 'abstraction', 'context'];
const SETTINGS = ['desk', 'sofa', 'commute', 'walking', 'other'];
const DEVICES = ['laptop', 'iphone'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Static shells: contain no data, so they are served without auth.
    if (request.method === 'GET') {
      if (pathname === '/') return html(FORM_PAGE);
      if (pathname === '/summary') return html(SUMMARY_PAGE);
      if (pathname === '/manifest.webmanifest') return manifest();
      if (pathname === '/sw.js') return serviceWorker();
      if (pathname === '/icon.svg') return icon();
      if (pathname === '/icon.png') return iconPng();
    }

    if (pathname.startsWith('/api/')) {
      if (!env.LOG_TOKEN) return json({ error: 'LOG_TOKEN secret is not set' }, 500);
      if (!(await authorised(request, env.LOG_TOKEN))) return json({ error: 'unauthorised' }, 401);

      if (pathname === '/api/ping' && request.method === 'GET') return json({ ok: true });
      if (pathname === '/api/entries' && request.method === 'POST') return createEntries(request, env);
      if (pathname.startsWith('/api/entries/') && request.method === 'DELETE') {
        const id = decodeURIComponent(pathname.slice('/api/entries/'.length));
        await env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id).run();
        return json({ ok: true });
      }
      if (pathname === '/api/summary' && request.method === 'GET') return summary(env);
      if (pathname === '/api/export.csv' && request.method === 'GET') return exportCsv(env);
    }

    return new Response('Not found', { status: 404 });
  },
};

// ---------- auth ----------

async function authorised(request, token) {
  const header = request.headers.get('Authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Compare SHA-256 digests so the comparison takes the same time whatever the input.
  const [a, b] = await Promise.all([sha256(given), sha256(token)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// ---------- API ----------

function validate(e) {
  if (!e || typeof e !== 'object') return 'entry must be an object';
  if (typeof e.id !== 'string' || e.id.length < 8 || e.id.length > 64) return 'bad id';
  if (typeof e.created_at !== 'string' || Number.isNaN(Date.parse(e.created_at))) return 'bad created_at';
  if (!DEVICES.includes(e.device)) return 'bad device';
  if (!TYPES.includes(e.type)) return 'bad type';
  if (e.setting != null && !SETTINGS.includes(e.setting)) return 'bad setting';
  if (typeof e.note !== 'string' || !e.note.trim() || e.note.length > 500) return 'note is required (max 500 chars)';
  if (e.steps != null && (!Number.isInteger(e.steps) || e.steps < 0 || e.steps > 1000)) return 'bad steps';
  return null;
}

async function createEntries(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  // Accept one entry or a batch (the offline queue sends batches).
  const entries = Array.isArray(body) ? body : [body];
  if (entries.length === 0 || entries.length > 200) return json({ error: 'send 1 to 200 entries' }, 400);
  for (const e of entries) {
    const err = validate(e);
    if (err) return json({ error: err, id: e && e.id }, 400);
  }
  const stmt = env.DB.prepare(
    'INSERT OR IGNORE INTO entries (id, created_at, device, type, setting, note, steps) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  await env.DB.batch(
    entries.map((e) =>
      stmt.bind(e.id, new Date(e.created_at).toISOString(), e.device, e.type, e.setting ?? null, e.note.trim(), e.steps ?? null)
    )
  );
  return json({ ok: true, saved: entries.map((e) => e.id) }, 201);
}

async function summary(env) {
  const db = env.DB;
  const [total, byType, byDevice, bySetting, byDay, steps, recent] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n, MIN(created_at) AS first, MAX(created_at) AS last FROM entries'),
    db.prepare('SELECT type AS k, COUNT(*) AS n FROM entries GROUP BY type ORDER BY n DESC'),
    db.prepare('SELECT device AS k, COUNT(*) AS n FROM entries GROUP BY device ORDER BY n DESC'),
    db.prepare("SELECT COALESCE(setting, 'unspecified') AS k, COUNT(*) AS n FROM entries GROUP BY k ORDER BY n DESC"),
    db.prepare('SELECT substr(created_at, 1, 10) AS k, COUNT(*) AS n FROM entries GROUP BY k ORDER BY k'),
    db.prepare('SELECT type AS k, ROUND(AVG(steps), 1) AS avg_steps, COUNT(steps) AS n FROM entries WHERE steps IS NOT NULL GROUP BY type'),
    db.prepare('SELECT * FROM entries ORDER BY created_at DESC LIMIT 100'),
  ]);
  return json({
    total: total.results[0],
    byType: byType.results,
    byDevice: byDevice.results,
    bySetting: bySetting.results,
    byDay: byDay.results,
    avgSteps: steps.results,
    recent: recent.results,
  });
}

async function exportCsv(env) {
  const { results } = await env.DB.prepare('SELECT * FROM entries ORDER BY created_at').all();
  const cols = ['id', 'created_at', 'device', 'type', 'setting', 'note', 'steps', 'received_at'];
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [cols.join(','), ...results.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  return new Response(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="friction-log.csv"' },
  });
}

// ---------- responses ----------

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function html(body) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function manifest() {
  return new Response(
    JSON.stringify({
      name: 'Friction Log',
      short_name: 'Friction',
      start_url: '/',
      display: 'standalone',
      background_color: '#111315',
      theme_color: '#111315',
      icons: [{ src: '/icon.png', sizes: '180x180', type: 'image/png' }, { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
    }),
    { headers: { 'Content-Type': 'application/manifest+json' } }
  );
}

function icon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><rect width="180" height="180" rx="40" fill="#111315"/><path d="M45 120 L80 60 L100 95 L135 45" stroke="#f2a65a" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
}

// 180x180 PNG for the iPhone home screen (iOS ignores SVG touch icons).
const ICON_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAIAAACyr5FlAAAC8UlEQVR42u3dzU3jUBSAUWPRAEKsqYZyqIZyqIZOWLBBSkJi8ux3f863G80oIHxyr+2EzMPT88sinWv1IxAcgkNwCA7BITgEh+AQHIJDgkNwCA7BITgEh+AQHIJDcEhwCA7BITgEh+AQHIJDcAgOCQ7BITgEh+AQHIrZox9BqL4+3n7/8fX9c+I38+CjJmOyiEDEWoku4+rfwtFXxkQfcAiOzGNj1vCAQ3AkHxtwkAGHrBWNHRvH3wqDw0KBI7mMKXfQ4UiQ11aMjVgy4CBj8X6OcG+ViC+j0eQ4fdYefMmQ5QqlHY5LB+awA5ZuobRYK1ePys8/iLZignw/qxPAvUdIxoXiasVC6Ypj61HZ4/mdWobJoX44/jcGxg6P7GPD5HCq0QzHPQNg1pVFzNu1KxkBHwEOCyX6qzyrsTH3qR/59T+Tw83QBjimX4hWWiilcEx/ytaTYa002hFNcex3FG985JJjw+SwUErj2Hpsth6Y4WMpi4ymk2Pg4al9XrIaG0e+BTXR2MiN4x4ZUw5SLhmtT0g3Harpv9kAR7iFcukrll8oLmUHn4IUk5EVx/Fjo+c903wfbz1cxt6HPOnYcIfUFUohHHsslP2OX2oZJkeRowjHtPPQtuBMjl2OZY1RtBobyo3jGBmjPJVxaa041ciM48iFYhmZHGyVwJHoPLTe1FnJGPI4JfeRtaKEOOYulE2PVvU01uRwqpENR4TzUJe1JsddPmoDivhOsGiXr2e/nw5zZSXjH1+iycZp9P+tOP/IPTm8Lg+H4DA24CADDsFhbMjkUAIcxgYcgsPYgIMMOASHsaE4OHzmPByLV8zhsFDgEBwWikwOwaFEOG7fFHaKySE4wnx2rKJPjr+PPRmLX4dcTu6JYQGHrBXBITgEhwSH4BAcgkNwCA7BITgEh+AQHBIcgkNwCA7BITgEh+AQHIJDgkNwCA7BITgEh+AQHIJDcEhwCA7BITgEh+AQHIJDcAgOwSHBITgEh+AQHIrYNxqoHNBCBzFAAAAAAElFTkSuQmCC';
function iconPng() {
  const bytes = Uint8Array.from(atob(ICON_PNG_B64), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
}

// Caches the app shell so the form opens with no signal; entries queue until online.
function serviceWorker() {
  const js = `
const CACHE = 'friction-shell-v1';
const SHELL = ['/', '/summary', '/manifest.webmanifest', '/icon.svg', '/icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  // Network first so updates arrive; fall back to the cached shell offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request))
  );
});`;
  return new Response(js, { headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' } });
}

// ---------- pages ----------

const BASE_STYLE = `
:root {
  --bg: #f6f5f2; --surface: #ffffff; --text: #1b1d1f; --muted: #6b6f74; --border: #dcdad5;
  --accent: #c2611a; --accent-text: #ffffff; --ok: #2f7d4f; --warn: #a15c00;
  --channel: #3b6fb6; --abstraction: #c2611a; --context: #6b8e23;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111315; --surface: #1b1e21; --text: #ececea; --muted: #9a9ea3; --border: #2c3034;
    --accent: #f2a65a; --accent-text: #1b1d1f; --ok: #6fcf97; --warn: #f2c94c;
    --channel: #7aa7e6; --abstraction: #f2a65a; --context: #a9c46c;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); }
body { font: 16px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: max(16px, env(safe-area-inset-top)) 16px 24px; }
main { max-width: 520px; margin: 0 auto; }
h1 { font-size: 20px; margin: 0; }
a { color: var(--accent); }
.top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px; }
.muted { color: var(--muted); font-size: 13px; }
input, textarea { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px; width: 100%; }
textarea { resize: none; min-height: 72px; }
button { font: inherit; cursor: pointer; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text); }
`;

const FORM_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Friction">
<meta name="theme-color" content="#111315">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg">
<link rel="apple-touch-icon" href="/icon.png">
<title>Friction Log</title>
<style>${BASE_STYLE}
.types { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px 0; }
.type { padding: 14px 6px; font-weight: 600; }
.type small { display: block; font-weight: 400; color: var(--muted); font-size: 11px; margin-top: 2px; }
.type[aria-pressed="true"][data-v="channel"] { background: var(--channel); border-color: var(--channel); color: #fff; }
.type[aria-pressed="true"][data-v="abstraction"] { background: var(--abstraction); border-color: var(--abstraction); color: #fff; }
.type[aria-pressed="true"][data-v="context"] { background: var(--context); border-color: var(--context); color: #fff; }
.type[aria-pressed="true"] small { color: rgba(255,255,255,.85); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
.chip { padding: 8px 12px; font-size: 14px; }
.chip[aria-pressed="true"] { background: var(--text); color: var(--bg); border-color: var(--text); }
.row { display: flex; gap: 8px; align-items: center; }
.row input { width: 110px; }
.save { width: 100%; padding: 16px; margin-top: 16px; font-weight: 700; background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
.save:disabled { opacity: .45; cursor: default; }
#status { min-height: 22px; margin-top: 12px; font-size: 14px; display: flex; justify-content: space-between; gap: 8px; }
#status .ok { color: var(--ok); } #status .warn { color: var(--warn); }
#undo { padding: 4px 10px; font-size: 13px; }
.setup { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
.setup button { margin-top: 10px; padding: 12px 16px; background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: 600; }
.hint { margin-top: 20px; }
kbd { font: 12px ui-monospace, monospace; border: 1px solid var(--border); border-radius: 4px; padding: 1px 4px; }
</style>
</head>
<body>
<main>
  <div class="top"><h1>Friction Log</h1><a href="/summary" class="muted">Summary</a></div>

  <section id="setup" class="setup" hidden>
    <p style="margin-top:0">Enter your access key once on this device.</p>
    <input id="key" type="password" autocomplete="off" placeholder="Access key">
    <button id="saveKey">Save key</button>
    <p id="keyMsg" class="muted"></p>
  </section>

  <form id="form" hidden>
    <textarea id="note" maxlength="500" placeholder="What were you trying to do?" required></textarea>
    <div class="types" role="group" aria-label="Friction type">
      <button type="button" class="type" data-v="channel" aria-pressed="false">Channel<small>input too slow</small></button>
      <button type="button" class="type" data-v="abstraction" aria-pressed="false">Abstraction<small>too many steps</small></button>
      <button type="button" class="type" data-v="context" aria-pressed="false">Context<small>wrong setting</small></button>
    </div>
    <div class="chips" role="group" aria-label="Setting">
      <button type="button" class="chip" data-v="desk" aria-pressed="false">Desk</button>
      <button type="button" class="chip" data-v="sofa" aria-pressed="false">Sofa</button>
      <button type="button" class="chip" data-v="commute" aria-pressed="false">Commute</button>
      <button type="button" class="chip" data-v="walking" aria-pressed="false">Walking</button>
      <button type="button" class="chip" data-v="other" aria-pressed="false">Other</button>
    </div>
    <div class="row"><input id="steps" type="number" inputmode="numeric" min="0" max="1000" placeholder="Steps"><span class="muted">optional</span></div>
    <button class="save" id="save" type="submit" disabled>Log it</button>
    <div id="status"></div>
    <p class="muted hint" id="hint"></p>
  </form>
</main>
<script>
(() => {
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const isPhone = /iPhone|iPod/.test(navigator.userAgent);
  const device = isPhone ? 'iphone' : 'laptop';
  const $ = (id) => document.getElementById(id);
  let token = store.get('token', '');
  let type = null, setting = null, lastId = null;

  // ----- setup -----
  function showForm() { $('setup').hidden = true; $('form').hidden = false; $('note').focus(); flush(); }
  if (token) showForm(); else { $('setup').hidden = false; $('key').focus(); }
  $('saveKey').onclick = async () => {
    const k = $('key').value.trim();
    if (!k) return;
    $('keyMsg').textContent = 'Checking…';
    try {
      const r = await fetch('/api/ping', { headers: { Authorization: 'Bearer ' + k } });
      if (r.status === 401) { $('keyMsg').textContent = 'That key was rejected.'; return; }
    } catch { /* offline: accept the key and verify on the next sync */ }
    token = k; store.set('token', k); showForm();
  };
  $('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('saveKey').click(); });

  // ----- toggles -----
  function wire(selector, onPick) {
    const btns = [...document.querySelectorAll(selector)];
    btns.forEach((b) => b.onclick = () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      btns.forEach((x) => x.setAttribute('aria-pressed', 'false'));
      if (on) b.setAttribute('aria-pressed', 'true');
      onPick(on ? b.dataset.v : null);
      refresh();
    });
    return btns;
  }
  const typeBtns = wire('.type', (v) => { type = v; });
  const chipBtns = wire('.chip', (v) => { setting = v; });
  function refresh() { $('save').disabled = !(type && $('note').value.trim()); }
  $('note').addEventListener('input', refresh);

  // Laptop shortcuts: Alt+1/2/3 picks the type, Cmd/Ctrl+Enter saves.
  if (!isPhone) $('hint').innerHTML = '<kbd>Alt</kbd>+<kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> picks the type, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> saves.';
  document.addEventListener('keydown', (e) => {
    // Match on e.code: on a Mac, Alt+1 types a symbol, so e.key is not '1'.
    if (e.altKey && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) { e.preventDefault(); typeBtns[+e.code.slice(-1) - 1].click(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (!$('save').disabled) $('form').requestSubmit(); }
  });

  // ----- queue + sync -----
  const queue = () => store.get('queue', []);
  function setStatus(msg, cls, showUndo) {
    $('status').innerHTML = '';
    const span = document.createElement('span'); span.className = cls || ''; span.textContent = msg; $('status').append(span);
    if (showUndo) { const b = document.createElement('button'); b.type = 'button'; b.id = 'undo'; b.textContent = 'Undo'; b.onclick = undo; $('status').append(b); }
  }
  let flushing = false;
  async function flush() {
    if (flushing || !token) return;
    const q = queue();
    if (!q.length) return;
    flushing = true;
    try {
      const r = await fetch('/api/entries', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(q) });
      if (r.status === 401) { setStatus('Key rejected. Reload to enter it again.', 'warn'); store.set('token', ''); return; }
      if (r.ok) {
        const { saved } = await r.json();
        store.set('queue', queue().filter((e) => !saved.includes(e.id)));
      }
    } catch { /* still offline */ } finally { flushing = false; }
    const left = queue().length;
    if (left) setStatus(left + ' waiting to sync', 'warn', !!lastId);
  }
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });

  async function undo() {
    const id = lastId; if (!id) return;
    lastId = null;
    store.set('queue', queue().filter((e) => e.id !== id));
    try { await fetch('/api/entries/' + encodeURIComponent(id), { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } }); } catch {}
    setStatus('Removed.', 'muted');
  }

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('save').disabled) return;
    const stepsVal = $('steps').value.trim();
    const entry = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      device, type, setting,
      note: $('note').value.trim(),
      steps: stepsVal === '' ? null : Math.max(0, Math.round(+stepsVal)),
    };
    store.set('queue', [...queue(), entry]);
    lastId = entry.id;
    // Reset for the next entry straight away; sync happens in the background.
    $('note').value = ''; $('steps').value = ''; type = null; setting = null;
    [...typeBtns, ...chipBtns].forEach((b) => b.setAttribute('aria-pressed', 'false'));
    refresh();
    setStatus(navigator.onLine ? 'Saved.' : 'Saved offline, will sync.', navigator.onLine ? 'ok' : 'warn', true);
    await flush();
    if (!queue().length && lastId === entry.id) setStatus('Saved.', 'ok', true);
    if (!isPhone) $('note').focus();
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
</script>
</body>
</html>`;

const SUMMARY_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#111315">
<link rel="icon" href="/icon.svg">
<title>Friction Summary</title>
<style>${BASE_STYLE}
main { max-width: 760px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 20px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px; }
.card .n { font-size: 26px; font-weight: 700; }
h2 { font-size: 15px; margin: 22px 0 8px; }
.bar { display: grid; grid-template-columns: 110px 1fr 70px; gap: 8px; align-items: center; margin: 6px 0; font-size: 14px; }
.track { height: 12px; background: var(--border); border-radius: 6px; overflow: hidden; }
.fill { height: 100%; background: var(--muted); }
.fill.channel { background: var(--channel); } .fill.abstraction { background: var(--abstraction); } .fill.context { background: var(--context); }
.num { text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
.tablewrap { overflow-x: auto; }
#msg { color: var(--warn); }
</style>
</head>
<body>
<main>
  <div class="top"><h1>Friction Summary</h1><span><a href="/" class="muted">Log</a> · <a href="#" id="csv" class="muted">CSV</a></span></div>
  <p id="msg"></p>
  <div id="out"></div>
</main>
<script>
(() => {
  let token = '';
  try { token = JSON.parse(localStorage.getItem('token') || '""'); } catch {}
  const msg = document.getElementById('msg'), out = document.getElementById('out');
  if (!token) { msg.textContent = 'Open the log page on this device and enter your key first.'; return; }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  document.getElementById('csv').onclick = async (e) => {
    e.preventDefault();
    const r = await fetch('/api/export.csv', { headers: { Authorization: 'Bearer ' + token } });
    const blob = await r.blob(); const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'friction-log.csv'; a.click();
  };

  function bars(title, rows, total, colour) {
    if (!rows.length) return '';
    return '<h2>' + title + '</h2>' + rows.map((r) => {
      const pct = total ? Math.round((r.n / total) * 100) : 0;
      return '<div class="bar"><span>' + esc(r.k) + '</span><div class="track"><div class="fill ' + (colour ? esc(r.k) : '') +
        '" style="width:' + pct + '%"></div></div><span class="num">' + r.n + ' · ' + pct + '%</span></div>';
    }).join('');
  }

  fetch('/api/summary', { headers: { Authorization: 'Bearer ' + token } })
    .then((r) => { if (r.status === 401) throw new Error('Key rejected.'); return r.json(); })
    .then((d) => {
      const t = d.total.n;
      if (!t) { out.innerHTML = '<p class="muted">No entries yet.</p>'; return; }
      const days = d.byDay.length;
      const top = d.byType[0];
      const stepsBy = Object.fromEntries(d.avgSteps.map((s) => [s.k, s]));
      let html = '<div class="cards">' +
        '<div class="card"><div class="n">' + t + '</div><div class="muted">entries</div></div>' +
        '<div class="card"><div class="n">' + days + '</div><div class="muted">days logged</div></div>' +
        '<div class="card"><div class="n">' + (t / days).toFixed(1) + '</div><div class="muted">per day</div></div>' +
        '<div class="card"><div class="n">' + esc(top.k) + '</div><div class="muted">most common type</div></div></div>';
      html += bars('By friction type', d.byType, t, true);
      html += bars('By device', d.byDevice, t, false);
      html += bars('By setting', d.bySetting, t, false);
      if (d.avgSteps.length) {
        html += '<h2>Average steps (entries with a count)</h2>' + d.avgSteps.map((s) =>
          '<div class="bar"><span>' + esc(s.k) + '</span><span></span><span class="num">' + s.avg_steps + ' (n=' + s.n + ')</span></div>').join('');
      }
      html += '<h2>Recent entries</h2><div class="tablewrap"><table><thead><tr><th>When</th><th>Type</th><th>Device</th><th>Setting</th><th>Steps</th><th>Note</th></tr></thead><tbody>' +
        d.recent.map((e) => '<tr><td>' + esc(new Date(e.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })) +
          '</td><td>' + esc(e.type) + '</td><td>' + esc(e.device) + '</td><td>' + esc(e.setting || '') + '</td><td>' + esc(e.steps ?? '') +
          '</td><td>' + esc(e.note) + '</td></tr>').join('') + '</tbody></table></div>';
      out.innerHTML = html;
    })
    .catch((e) => { msg.textContent = e.message || 'Could not load the summary.'; });
})();
</script>
</body>
</html>`;
