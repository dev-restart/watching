/// <reference lib="webworker" />
import { version } from '$service-worker';
import { OFFLINE_ASSETS, pwaCacheAction } from './lib/pwa-cache';

const worker = self as unknown as ServiceWorkerGlobalScope;
const CACHE_PREFIX = 'watching-pwa-';
const CACHE = `${CACHE_PREFIX}${version}`;

worker.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...OFFLINE_ASSETS])));
	// Do not skipWaiting/reload: activating updates must not interrupt a playing iframe.
});
worker.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		for (const key of await caches.keys()) {
			if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await caches.delete(key);
		}
	})());
});
worker.addEventListener('fetch', (event) => {
	if (event.request.headers.has('range')) return;
	const action = pwaCacheAction(event.request, worker.location.origin);
	if (action === 'network') return;
	event.respondWith((async () => {
		const cache = await caches.open(CACHE);
		if (action === 'asset') return (await cache.match(event.request)) ?? fetch(event.request);
		try {
			const response = await fetch(event.request);
			if (response.status < 500) return response;
		} catch { /* Network unavailable: return only the static, non-personal fallback. */ }
		return (await cache.match('/offline.html')) ?? new Response('연결할 수 없습니다. 인터넷 연결 후 다시 시도해 주세요.', {
			status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
		});
	})());
});
