import { error } from '@sveltejs/kit';
import { openUrl } from '$lib/server/tokens';
import type { RequestHandler } from './$types';

// Opaque image proxy: the browser never sees the original host.
// GET /api/img?key=<sealed> -> proxied image bytes with long-lived caching.

export const GET: RequestHandler = async ({ url }) => {
	const key = url.searchParams.get('key') || '';
	if (!key) throw error(400, 'Missing key.');

	let target = '';
	try {
		target = openUrl(key);
	} catch {
		throw error(400, 'Invalid key.');
	}
	if (!/^https?:\/\//i.test(target)) throw error(400, 'Invalid target.');

	let upstream: Response;
	try {
		upstream = await fetch(target, {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
				Accept: 'image/*,*/*;q=0.8'
			}
		});
	} catch {
		throw error(502, 'Image fetch failed.');
	}
	if (!upstream.ok) throw error(502, `Image fetch failed (${upstream.status}).`);

	const contentType = upstream.headers.get('content-type') || 'image/jpeg';
	const buf = await upstream.arrayBuffer();

	return new Response(buf, {
		headers: {
			'Content-Type': contentType,
			// Long-lived cache so repeat views are served from the edge, not re-fetched.
			'Cache-Control': 'public, max-age=86400, s-maxage=2592000, immutable'
		}
	});
};
