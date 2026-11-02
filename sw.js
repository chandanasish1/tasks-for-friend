// ============================================
// TASKS APP - Service Worker (Offline Support)
// ============================================

// Versioned by scripts/set-version.mjs — do not edit by hand.
const CACHE_NAME = 'tasks-app-v1.13.0';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/app.mjs',
    '/style.css',
    '/manifest.json',
    '/supabase.min.js',
    '/sortable.min.js',
    '/src/config.mjs',
    '/src/main.mjs',
    '/src/store.mjs',
    '/src/utils.mjs',
    '/src/version.mjs'
];
const APP_SHELL_ASSETS = new Set(STATIC_ASSETS);

function getCacheKey(requestUrl) {
    return requestUrl.pathname === '/' ? '/' : requestUrl.pathname;
}

async function fetchAndCache(request) {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
        const responseToCache = networkResponse.clone();
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, responseToCache);
    }

    return networkResponse;
}

// Install - pre-cache core static assets.
self.addEventListener('install', (event) => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Pre-caching static assets');
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate - clean up old caches.
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating...');
    event.waitUntil(
        (async () => {
            const cacheNames = await caches.keys();
            await Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );

            await self.clients.claim();
        })()
    );
});

// Fetch - network-first for app shell, cache fallback for offline use.
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip Supabase API calls and realtime - let them pass through.
    if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in')) {
        return;
    }

    const isAppShellAsset = event.request.method === 'GET'
        && url.origin === self.location.origin
        && APP_SHELL_ASSETS.has(getCacheKey(url));

    if (isAppShellAsset) {
        event.respondWith(
            fetchAndCache(event.request).catch(async () => {
                const cachedResponse = await caches.match(event.request);
                if (cachedResponse) {
                    return cachedResponse;
                }

                if (event.request.mode === 'navigate') {
                    return caches.match('/index.html');
                }

                return new Response('Offline', { status: 503, statusText: 'Offline' });
            })
        );
        return;
    }

    // Other static assets remain cache-first.
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                fetchAndCache(event.request).catch(() => { /* Offline - ignore. */ });
                return cachedResponse;
            }

            return fetchAndCache(event.request).catch(() => {
                if (event.request.mode === 'navigate') {
                    return caches.match('/index.html');
                }

                return new Response('Offline', { status: 503, statusText: 'Offline' });
            });
        })
    );
});
