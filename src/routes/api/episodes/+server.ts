import { error, json } from '@sveltejs/kit';
import { getEpisodes } from '$lib/server/catalog';
import { openUrl } from '$lib/server/tokens';
import { assertSourceUrl } from '$lib/server/url-policy';
import { readJsonObject, requireString } from '$lib/server/api-request';
import type { RequestHandler } from './$types';

/** POST { key } -> { series, episodes }  (key is an opaque server-encrypted detail URL) */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readJsonObject(request);
	const key = requireString(body, 'key', { maxLength: 4096, label: 'Key' });

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
		const result = await getEpisodes(targetUrl);
		return json(result);
	} catch (err) {
		console.error('[api/episodes] request failed', err);
		throw error(502, 'Details are temporarily unavailable.');
	}
};
