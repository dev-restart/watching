import { error, json } from '@sveltejs/kit';
import { getEpisodes, CatalogError } from '$lib/server/catalog';
import { openUrl } from '$lib/server/tokens';
import type { RequestHandler } from './$types';

/** POST { key } -> { series, episodes }  (key is an opaque server-encrypted detail URL) */
export const POST: RequestHandler = async ({ request }) => {
	let body: { key?: string; url?: string };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON.');
	}

	let targetUrl = '';
	try {
		if (body?.key) targetUrl = openUrl(body.key);
		else if (body?.url) targetUrl = body.url; // dev/compat
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
		const msg = err instanceof CatalogError ? err.message : 'Failed to load episodes.';
		throw error(502, msg);
	}
};
