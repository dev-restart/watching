import { error } from '@sveltejs/kit';
import { openUrl } from '$lib/server/tokens';
import { assertImageUrl } from '$lib/server/url-policy';
import type { RequestHandler } from './$types';

// Opaque image proxy: the browser never sees the original host.
// GET /api/img?key=<sealed> -> proxied image bytes with long-lived caching.

export const GET: RequestHandler = async ({ url }) => {
	const key = url.searchParams.get('key') || '';
	if (!key) throw error(400, 'Missing key.');
	if (key.length > 4096) throw error(400, 'Invalid key.');

	let target = '';
	try {
		target = assertImageUrl(openUrl(key, 'image', { allowLegacy: true }));
	} catch {
		throw error(400, 'Invalid key.');
	}

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
	if (!upstream.ok) throw error(502, 'Image fetch failed.');

	const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
	if (!contentType.startsWith('image/') || contentType === 'image/svg+xml') {
		throw error(502, 'Invalid image response.');
	}
	const buf = await upstream.arrayBuffer();
	if (buf.byteLength > 8 * 1024 * 1024) throw error(502, 'Image is too large.');

	return new Response(buf, {
		headers: {
			'Content-Type': contentType,
			'X-Content-Type-Options': 'nosniff',
			// Long-lived cache so repeat views are served from the edge, not re-fetched.
			'Cache-Control': 'public, max-age=86400, s-maxage=2592000, immutable'
		}
	});
};
