import crypto from 'node:crypto';
import { env } from '$env/dynamic/private';

const SECRET = env.CONTENT_ID_SECRET || env.PLAYER_TOKEN_SECRET;
if (!SECRET) throw new Error('CONTENT_ID_SECRET or PLAYER_TOKEN_SECRET is not set');

const KEY = crypto.createHmac('sha256', SECRET).update('watching-content-id-v1').digest();

function sign(identity: string): string {
	return `c1.${crypto.createHmac('sha256', KEY).update(identity).digest('base64url')}`;
}

function normalizePart(value: string): string {
	try {
		return decodeURIComponent(value).trim().toLowerCase();
	} catch {
		return value.trim().toLowerCase();
	}
}

/** Stable, opaque ID based on the source board ID and post number. */
export function contentIdForSourcePost(boardId: string, postId: string): string {
	const board = normalizePart(boardId);
	const post = postId.trim();
	if (!board || !/^\d+$/.test(post)) throw new Error('Invalid source post identity.');
	return sign(`post:${board}:${post}`);
}

export function contentIdFromSourceUrl(rawUrl: string): string {
	const url = new URL(rawUrl);
	const queryBoard = url.searchParams.get('bo_table') || '';
	const queryPost = url.searchParams.get('wr_id') || '';
	if (queryBoard && /^\d+$/.test(queryPost)) {
		return contentIdForSourcePost(queryBoard, queryPost);
	}

	const parts = url.pathname.split('/').filter(Boolean);
	for (let index = parts.length - 1; index > 0; index--) {
		if (/^\d+$/.test(parts[index])) {
			return contentIdForSourcePost(parts[index - 1], parts[index]);
		}
	}

	// A canonical path fallback keeps the raw URL hidden even for an unexpected source route.
	return sign(`path:${url.pathname.replace(/\/+$/, '').toLowerCase()}`);
}
