import { error, json } from '@sveltejs/kit';
import { resolveStream } from '$lib/server/catalog';
import { openUrl } from '$lib/server/tokens';
import { assertSourceUrl } from '$lib/server/url-policy';
import { readJsonObject, requireString } from '$lib/server/api-request';
import type { RequestHandler } from './$types';

/** POST { key } -> StreamSession { full, expires } */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readJsonObject(request);
	const key = requireString(body, 'key', { maxLength: 4096, label: 'Key' });

	let targetUrl = '';
	try {
		targetUrl = assertSourceUrl(openUrl(key, 'play'));
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
		console.error('[api/session] request failed', err);
		throw error(502, 'Playback is temporarily unavailable.');
	}
};
