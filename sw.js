// Service worker: guarda la app para que abra sin internet.
const CACHE = 'aypollito-v1';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './config.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'
];
const LIBS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://fonts.googleapis.com/css2?family=Lilita+One&family=Nunito:wght@600;700;800&display=swap'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    await Promise.all(LIBS.map((u) => c.add(new Request(u, { mode: 'no-cors' })).catch(() => null)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Supabase: siempre red (la app maneja el modo sin conexión)
  if (url.hostname.endsWith('supabase.co')) return;
  // Fuentes: cache-first (archivos woff2 de gstatic)
  const cacheFirst = url.hostname === 'fonts.gstatic.com' || LIBS.includes(e.request.url);
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const cached = await c.match(e.request, { ignoreSearch: false });
    if (cacheFirst && cached) return cached;
    try {
      const res = await fetch(e.request);
      if (res && (res.ok || res.type === 'opaque')) c.put(e.request, res.clone());
      return res;
    } catch (err) {
      if (cached) return cached;
      if (e.request.mode === 'navigate') return c.match('./index.html');
      throw err;
    }
  })());
});
