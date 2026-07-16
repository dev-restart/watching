import { error } from '@sveltejs/kit';
import { openUrl } from '$lib/server/tokens';
import { assertImageUrl } from '$lib/server/url-policy';
import type { RequestHandler } from './$types';

// Opaque image proxy: the browser never sees the original host.
// GET /api/img?key=<sealed> -> proxied image bytes with long-lived caching.

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 10_000;

async function readLimitedBody(response: Response): Promise<Uint8Array> {
	const declaredLength = Number(response.headers.get('content-length'));
	if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
		await response.body?.cancel();
		throw new Error('Image is too large.');
	}
	if (!response.body) return new Uint8Array();

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_IMAGE_BYTES) throw new Error('Image is too large.');
			chunks.push(value);
		}
	} catch (cause) {
		await reader.cancel().catch(() => undefined);
		throw cause;
	}

	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

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
			},
			signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS)
		});
	} catch {
		throw error(502, 'Image fetch failed.');
	}
	if (!upstream.ok) throw error(502, 'Image fetch failed.');

	const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
	if (!contentType.startsWith('image/') || contentType === 'image/svg+xml') {
		throw error(502, 'Invalid image response.');
	}
	let body: Uint8Array;
	try {
		body = await readLimitedBody(upstream);
	} catch {
		throw error(502, 'Image fetch failed.');
	}

	return new Response(body.buffer as ArrayBuffer, {
		headers: {
			'Content-Type': contentType,
			'X-Content-Type-Options': 'nosniff',
			// Long-lived cache so repeat views are served from the edge, not re-fetched.
			'Cache-Control': 'public, max-age=86400, s-maxage=2592000, immutable'
		}
	});
};
