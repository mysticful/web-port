// This service worker is required to expose an exported Godot project as a
// Progressive Web App. It provides an offline fallback page telling the user
// that they need an Internet connection to run the project if desired.
// Incrementing CACHE_VERSION will kick off the install event and force
// previously cached resources to be updated from the network.

/** @type {string} */
const CACHE_VERSION = '1765324248|219207985';

/** @type {string} */
const CACHE_PREFIX = 'laceys_flash_games-sw-cache-';

const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

/** @type {string} */
const OFFLINE_URL = 'laceys_flash_games.offline.html';

/** @type {boolean} */
const ENSURE_CROSSORIGIN_ISOLATION_HEADERS = true;

// Files that will be cached on load.
/** @type {string[]} */
const CACHED_FILES = [
	"laceys_flash_games.html",
	"laceys_flash_games.js",
	"laceys_flash_games.offline.html",
	"laceys_flash_games.icon.png",
	"laceys_flash_games.apple-touch-icon.png",
	"laceys_flash_games.audio.worklet.js",
	"laceys_flash_games.audio.position.worklet.js"
];

// Files cached on first load.
/** @type {string[]} */
const CACHEABLE_FILES = [
	"laceys_flash_games.wasm",
	"laceys_flash_games.pck"
];

const FULL_CACHE = CACHED_FILES.concat(CACHEABLE_FILES);

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => cache.addAll(CACHED_FILES))
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((keys) => {
			// Remove old caches.
			return Promise.all(
				keys
					.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
					.map((key) => caches.delete(key))
			);
		}).then(() => {
			// Enable navigation preload if available.
			return ('navigationPreload' in self.registration)
				? self.registration.navigationPreload.enable()
				: Promise.resolve();
		})
	);
});

/**
 * Ensures that the response has the correct COEP/COOP headers
 * @param {Response} response
 * @returns {Response}
 */
function ensureCrossOriginIsolationHeaders(response) {
	if (
		response.headers.get('Cross-Origin-Embedder-Policy') === 'require-corp' &&
		response.headers.get('Cross-Origin-Opener-Policy') === 'same-origin'
	) {
		return response;
	}

	const headers = new Headers(response.headers);
	headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
	headers.set('Cross-Origin-Opener-Policy', 'same-origin');

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

/**
 * Calls fetch and caches the result if it is cacheable
 * @param {FetchEvent} event
 * @param {Cache} cache
 * @param {boolean} isCacheable
 * @returns {Response}
 */
async function fetchAndCache(event, cache, isCacheable) {
	let response = await event.preloadResponse;

	if (!response) {
		response = await self.fetch(event.request);
	}

	if (ENSURE_CROSSORIGIN_ISOLATION_HEADERS) {
		response = ensureCrossOriginIsolationHeaders(response);
	}

	if (isCacheable) {
		cache.put(event.request, response.clone());
	}

	return response;
}

self.addEventListener('fetch', (event) => {
	const isNavigate = event.request.mode === 'navigate';
	const url = event.request.url || '';
	const referrer = event.request.referrer || '';
	const base = referrer.slice(0, referrer.lastIndexOf('/') + 1);
	const local = url.startsWith(base) ? url.replace(base, '') : '';
	const isCacheable =
		FULL_CACHE.includes(local) ||
		(base === referrer && base.endsWith(CACHED_FILES[0]));

	if (isNavigate || isCacheable) {
		event.respondWith((async () => {
			const cache = await caches.open(CACHE_NAME);

			if (isNavigate) {
				const fullCache = await Promise.all(
					FULL_CACHE.map((name) => cache.match(name))
				);
				const missing = fullCache.some((v) => v === undefined);

				if (missing) {
					try {
						return await fetchAndCache(event, cache, isCacheable);
					} catch (e) {
						console.error('Network error:', e);
						return caches.match(OFFLINE_URL);
					}
				}
			}

			let cached = await cache.match(event.request);
			if (cached) {
				return ENSURE_CROSSORIGIN_ISOLATION_HEADERS
					? ensureCrossOriginIsolationHeaders(cached)
					: cached;
			}

			return await fetchAndCache(event, cache, isCacheable);
		})());
	} else if (ENSURE_CROSSORIGIN_ISOLATION_HEADERS) {
		event.respondWith((async () => {
			let response = await fetch(event.request);
			response = ensureCrossOriginIsolationHeaders(response);
			return response;
		})());
	}
});

self.addEventListener('message', (event) => {
	if (event.origin !== self.origin) return;

	const id = event.source.id || '';
	const msg = event.data || '';

	self.clients.get(id).then((client) => {
		if (!client) return;

		if (msg === 'claim') {
			self.skipWaiting().then(() => self.clients.claim());
		} else if (msg === 'clear') {
			caches.delete(CACHE_NAME);
		} else if (msg === 'update') {
			self.skipWaiting()
				.then(() => self.clients.claim())
				.then(() => self.clients.matchAll())
				.then((all) => all.forEach((c) => c.navigate(c.url)));
		}
	});
});
