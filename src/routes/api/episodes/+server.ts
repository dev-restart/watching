import { error, json } from '@sveltejs/kit';
import { getEpisodes } from '$lib/server/catalog';
import { openUrl } from '$lib/server/tokens';
import { isEpisodeOffset } from '$lib/episode-pagination';
import { assertSourceUrl } from '$lib/server/url-policy';
import { readJsonObject, requireString } from '$lib/server/api-request';
import { ApiRateLimitError, enforceApiRateLimit } from '$lib/server/api-rate-limit';
import type { RequestHandler } from './$types';

/** POST { key, offset? } -> episodes and pagination. The source stays server-only. */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	try {
		await enforceApiRateLimit('details', getClientAddress);
	} catch (cause) {
		if (cause instanceof ApiRateLimitError) throw error(429, 'Too many detail requests. Try again shortly.');
		throw cause;
	}

	const body = await readJsonObject(request);
	const key = requireString(body, 'key', { maxLength: 4096, label: 'Key' });
	const offset = body.offset;
	if (offset !== undefined && !isEpisodeOffset(offset)) {
		throw error(400, 'Invalid episode list offset.');
	}

	let targetUrl = '';
	try {
		targetUrl = assertSourceUrl(openUrl(key, 'detail', { allowLegacy: true }));
	} catch {
		throw error(400, 'Invalid detail request.');
	}

	if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
		throw error(400, 'Invalid detail request.');
	}

	try {
		const result = await getEpisodes(targetUrl, offset, request.signal);
		return json(result, { headers: { 'Cache-Control': 'private, no-store' } });
	} catch (err) {
		console.error('[api/episodes] request failed', err);
		throw error(502, 'Details are temporarily unavailable.');
	}
};
