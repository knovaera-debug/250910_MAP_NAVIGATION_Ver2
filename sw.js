// ----- Service Worker for Route-Aid -----
// キャッシュ名のバージョンを上げると、強制的に新SW & 新キャッシュに切替わります。
const VERSION     = 'v5'; // バージョンを上げました
const APP_CACHE   = `route-aid-app-${VERSION}`;
const TILE_CACHE  = `route-aid-tiles-${VERSION}`;

// アプリ本体（オフラインでも動く「アプリ殻」）
const APP_ASSETS = [
  './',
  './index.html',
  './leaflet.js',
  './leaflet.css',
  './jszip.min.js',
  './sw.js',
  './manifest.webmanifest',
  // Leafletのマーカー画像（ローカル参照）
  './images/marker-icon.png',
  './images/marker-icon-2x.png',
  './images/marker-shadow.png',
  // PWAアイコン（後述の icons/ を使う）
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-1024.png'
];

// タイルキャッシュの最大枚数（端末容量に合わせて調整）
const MAX_TILES = 2000; // 例：2,000枚程度

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== APP_CACHE && key !== TILE_CACHE)
          .map((key) => caches.delete(key))
    ))
  );
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function networkFirstHTML(req) {
  return caches.open(APP_CACHE).then(async (cache) => {
    try {
      const resp = await fetch(req);
      if (resp.status === 200) await cache.put(req, resp.clone());
      return resp;
    } catch (e) {
      const cached = await cache.match(req);
      return cached || new Response(null, { status: 504 });
    }
  });
}

function tilesSWR(req) {
  let cached = null;
  const cachePromise = caches.open(TILE_CACHE).then(async (cache) => {
    cached = await cache.match(req);
    return cached;
  });

  const fetchPromise = fetch(req)
    .then(async (resp) => {
      // OSMはCORSの関係でopaqueになることがあるが、そのままキャッシュOK
      if (resp && (resp.status === 200 || resp.type === 'opaque')) {
        const cache = await caches.open(TILE_CACHE);
        await cache.put(req, resp.clone());
        // キャッシュ上限を超えたら古いものから削除
        const keys = await cache.keys();
        if (keys.length > MAX_TILES) {
          const over = keys.length - MAX_TILES;
          for (let i = 0; i < over; i++) await cache.delete(keys[i]);
        }
      }
      return resp;
    })
    .catch(() => null);

  // まずキャッシュを即返し、裏で取得。キャッシュがなければネット優先。
  return cachePromise.then(cachedResp => cachedResp || fetchPromise || new Response(null, { status: 504 }));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // ナビゲーション（HTML）はネット優先
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstHTML(req));
    return;
  }

  // OSMタイル
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(tilesSWR(req));
    return;
  }

  // 自アプリの静的ファイル（アセット）
  if (url.origin === self.location.origin) {
    // アプリ殻ファイルはキャッシュ優先
    const isAppAsset = APP_ASSETS.some(asset => url.pathname.endsWith(asset) || url.pathname.endsWith(`${asset.replace('./','')}`));
    if (isAppAsset) {
      event.respondWith(caches.match(req).then((response) => response || fetch(req)));
      return;
    }
    // その他のリソースはキャッシュなしでネットワークへ
    event.respondWith(fetch(req));
    return;
  }
  
  // その他
  event.respondWith(fetch(req));
});
