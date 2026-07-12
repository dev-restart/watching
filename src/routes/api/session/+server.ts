import { error, json } from '@sveltejs/kit';
import { resolveStream, CatalogError } from '$lib/server/catalog';
import { openUrl } from '$lib/server/tokens';
import type { RequestHandler } from './$types';

/** POST { key } -> StreamSession { full, t, sig, expires, company, ... } */
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
		throw error(400, 'Invalid playback request.');
	}

	if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
		throw error(400, 'Invalid playback request.');
	}

	try {
		const session = await resolveStream(targetUrl);
		return json(session);
	} catch (err) {
		const msg = err instanceof CatalogError ? err.message : 'Session creation failed.';
		throw error(502, msg);
	}
};
