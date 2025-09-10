// ----- Service Worker for Route-Aid -----
// キャッシュ名のバージョンを上げると、強制的に新SW & 新キャッシュに切替わります。
const VERSION     = 'v4';
const APP_CACHE   = `route-aid-app-${VERSION}`;
const TILE_CACHE  = `route-aid-tiles-${VERSION}`;

// アプリ本体（オフラインでも動く「アプリ殻」）
const APP_ASSETS = [
  './',
  './index.html',
  './leaflet.js',
  './leaflet.css',
  './jszip.min.js',
  './togeojson.umd.js',
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
    (async () => {
      // 古いキャッシュを削除
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== APP_CACHE && k !== TILE_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// HTMLはネット優先（落ちたらキャッシュ）で最新化しやすく
async function networkFirstHTML(req) {
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(APP_CACHE);
    cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cached = await caches.match(req);
    return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

// アプリアセットはキャッシュ優先（オフライン即起動）
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  const cache = await caches.open(APP_CACHE);
  cache.put(req, fresh.clone());
  return fresh;
}

// タイルは Stale-While-Revalidate（表示優先で裏で更新）＋上限管理
async function tilesSWR(req) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req)
    .then(async (resp) => {
      // OSMはCORSの関係でopaqueになることがあるが、そのままキャッシュOK
      if (resp && (resp.status === 200 || resp.type === 'opaque')) {
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
  return cached || fetchPromise || new Response(null, { status: 504 });
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
    const isAppAsset = APP_ASSETS.some(p => url.pathname.endsWith(p.replace('./','/')));
    if (isAppAsset) {
      event.respondWith(cacheFirst(req));
      return;
    }
  }

  // それ以外は素通し（必要に応じて追加でキャッシュ戦略を定義）
});

// 新しいSWを即時有効化したい時用（pagesからpostMessage({type:'SKIP_WAITING'})）
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
