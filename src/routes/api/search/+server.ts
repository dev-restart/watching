import { error, json } from '@sveltejs/kit';
import { searchList } from '$lib/server/catalog';
import { optionalPositiveInteger, readJsonObject, requireString } from '$lib/server/api-request';
import { ApiRateLimitError, enforceApiRateLimit } from '$lib/server/api-rate-limit';
import type { RequestHandler } from './$types';

/** POST { query, srows? } -> SearchResponse */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	try {
		await enforceApiRateLimit('search', getClientAddress);
	} catch (cause) {
		if (cause instanceof ApiRateLimitError) throw error(429, 'Too many searches. Try again shortly.');
		throw cause;
	}

	const body = await readJsonObject(request);
	const query = requireString(body, 'query', { maxLength: 100, label: 'Query' });
	const srows = optionalPositiveInteger(body, 'srows', 500, 500);

	try {
		const result = await searchList(query, srows);
		return json(result);
	} catch (err) {
		console.error('[api/search] request failed', err);
		throw error(502, 'Search is temporarily unavailable.');
	}
};
