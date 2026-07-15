import { error, json } from '@sveltejs/kit';
import {
	claimShare,
	completeShareImport,
	downloadShareChunk,
	enforceShareRateLimit,
	finalizeShare,
	startShare,
	uploadShareChunk,
	validateSharedBookmark
} from '$lib/server/bookmark-shares';
import { readJsonObject, requireString } from '$lib/server/api-request';
import type { RequestHandler } from './$types';

function integer(value: unknown, field: string, minimum = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw error(400, `${field} is invalid.`);
	return value;
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const body = await readJsonObject(request, { maxBytes: 256 * 1024 });
	const action = requireString(body, 'action', { maxLength: 30, label: 'Action' });
	try {
		switch (action) {
			case 'start':
				await enforceShareRateLimit('create', getClientAddress());
				return json(await startShare(integer(body.expectedCount, 'expectedCount', 1)), { status: 201 });
			case 'upload':
				if (!Array.isArray(body.bookmarks)) throw error(400, 'Bookmarks are required.');
				await uploadShareChunk(
					requireString(body, 'sessionId', { maxLength: 100, label: 'Session' }),
					requireString(body, 'uploadToken', { maxLength: 200, label: 'Upload token' }),
					integer(body.sequence, 'sequence'),
					body.bookmarks
				);
				return new Response(null, { status: 204 });
			case 'finalize':
				return json(await finalizeShare(
					requireString(body, 'sessionId', { maxLength: 100, label: 'Session' }),
					requireString(body, 'uploadToken', { maxLength: 200, label: 'Upload token' })
				));
			case 'claim':
				await enforceShareRateLimit('import', getClientAddress());
				return json(await claimShare(body.code));
			case 'download':
				return json({ bookmarks: await downloadShareChunk(
					requireString(body, 'sessionId', { maxLength: 100, label: 'Session' }),
					requireString(body, 'claimToken', { maxLength: 200, label: 'Claim token' }),
					integer(body.sequence, 'sequence')
				) });
			case 'complete':
				await completeShareImport(
					requireString(body, 'sessionId', { maxLength: 100, label: 'Session' }),
					requireString(body, 'claimToken', { maxLength: 200, label: 'Claim token' })
				);
				return new Response(null, { status: 204 });
			case 'validate':
				if (!Array.isArray(body.bookmarks)) throw error(400, 'Bookmarks are required.');
				return json({ bookmarks: body.bookmarks.map(validateSharedBookmark) });
			default:
				throw error(400, 'Action is invalid.');
		}
	} catch (cause) {
		if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
		const message = cause instanceof Error ? cause.message : 'Bookmark share failed.';
		if (message === 'RATE_LIMIT') throw error(429, 'Too many bookmark share requests.');
		if (message === 'NOT_FOUND') throw error(404, 'Share code is invalid or expired.');
		console.warn('[api/bookmark-shares] request failed', cause instanceof Error ? cause.name : 'UnknownError');
		throw error(400, message);
	}
};
