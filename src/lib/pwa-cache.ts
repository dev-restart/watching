/** Deliberate allowlist: never cache app HTML, API status/data, image proxies or media. */
export const OFFLINE_ASSETS = [
	'/offline.html', '/offline.css', '/offline.js', '/manifest.webmanifest',
	'/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'
] as const;

export function pwaCacheAction(request: { url: string; method: string; mode: string }, origin: string): 'network' | 'navigation' | 'asset' {
	const url = new URL(request.url);
	if (request.method !== 'GET' || url.origin !== origin || url.pathname.startsWith('/api/')) return 'network';
	if (request.mode === 'navigate') return 'navigation';
	return !url.search && (OFFLINE_ASSETS as readonly string[]).includes(url.pathname) ? 'asset' : 'network';
}
