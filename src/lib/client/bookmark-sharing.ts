import type { Bookmark, BookmarkMergeResult } from '$lib/bookmarks';
import { mergeBookmarks } from '$lib/bookmarks';
import { postJson } from '$lib/client/api';

const TARGET_CHUNK_BYTES = 200 * 1024;

interface StartedShare {
	sessionId: string;
	uploadToken: string;
}

export interface CreatedShare {
	code: string;
	expiresAt: string;
}

interface ClaimedShare {
	claimToken: string;
	sessionId: string;
	chunkCount: number;
}

function byteLength(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function bookmarkChunks(bookmarks: Bookmark[]): Bookmark[][] {
	const chunks: Bookmark[][] = [];
	let chunk: Bookmark[] = [];
	for (const bookmark of bookmarks) {
		const candidate = [...chunk, bookmark];
		if (chunk.length && byteLength({ action: 'upload', bookmarks: candidate }) > TARGET_CHUNK_BYTES) {
			chunks.push(chunk);
			chunk = [bookmark];
		} else {
			chunk = candidate;
		}
	}
	if (chunk.length) chunks.push(chunk);
	return chunks;
}

export async function createBookmarkShare(bookmarks: Bookmark[]): Promise<CreatedShare> {
	if (!bookmarks.length) throw new Error('There are no bookmarks to share.');
	const started = await postJson<StartedShare>('/api/bookmark-shares', {
		action: 'start',
		expectedCount: bookmarks.length
	});
	const chunks = bookmarkChunks(bookmarks);
	for (let sequence = 0; sequence < chunks.length; sequence++) {
		await postJson<void>('/api/bookmark-shares', {
			action: 'upload',
			sessionId: started.sessionId,
			uploadToken: started.uploadToken,
			sequence,
			bookmarks: chunks[sequence]
		});
	}
	return postJson<CreatedShare>('/api/bookmark-shares', {
		action: 'finalize',
		sessionId: started.sessionId,
		uploadToken: started.uploadToken
	});
}

export async function importBookmarkShare(code: string): Promise<BookmarkMergeResult> {
	const claimed = await postJson<ClaimedShare>('/api/bookmark-shares', { action: 'claim', code });
	const bookmarks: Bookmark[] = [];
	for (let sequence = 0; sequence < claimed.chunkCount; sequence++) {
		const chunk = await postJson<{ bookmarks: Bookmark[] }>('/api/bookmark-shares', {
			action: 'download',
			sessionId: claimed.sessionId,
			claimToken: claimed.claimToken,
			sequence
		});
		bookmarks.push(...chunk.bookmarks);
	}
	const result = await mergeBookmarks(bookmarks.map((bookmark, index) => ({
		...bookmark,
		ts: Date.now() - index
	})));
	await postJson<void>('/api/bookmark-shares', {
		action: 'complete',
		sessionId: claimed.sessionId,
		claimToken: claimed.claimToken
	});
	return result;
}

export async function validateBookmarkFile(bookmarks: Bookmark[]): Promise<Bookmark[]> {
	const validated: Bookmark[] = [];
	for (const chunk of bookmarkChunks(bookmarks)) {
		const response = await postJson<{ bookmarks: Bookmark[] }>('/api/bookmark-shares', {
			action: 'validate',
			bookmarks: chunk
		});
		validated.push(...response.bookmarks);
	}
	return validated;
}
