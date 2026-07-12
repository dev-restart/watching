import { error, json } from '@sveltejs/kit';
import { searchList, CatalogError } from '$lib/server/catalog';
import type { RequestHandler } from './$types';

/** POST { query, srows? } -> SearchResponse */
export const POST: RequestHandler = async ({ request }) => {
	let body: { query?: string; srows?: number };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON.');
	}

	const query = (body?.query || '').trim();
	if (!query) throw error(400, 'Query is required.');

	const srows = Number.isFinite(body?.srows) && body!.srows! > 0 ? body!.srows! : 500;

	try {
		const result = await searchList(query, srows);
		return json(result);
	} catch (err) {
		const msg = err instanceof CatalogError ? err.message : 'Search failed.';
		throw error(502, msg);
	}
};
