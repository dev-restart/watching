import { error, json } from '@sveltejs/kit';
import { searchList } from '$lib/server/catalog';
import { optionalPositiveInteger, readJsonObject, requireString } from '$lib/server/api-request';
import type { RequestHandler } from './$types';

/** POST { query, srows? } -> SearchResponse */
export const POST: RequestHandler = async ({ request }) => {
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
