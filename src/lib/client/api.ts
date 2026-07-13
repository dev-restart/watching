import type { EpisodeList, SearchResponse, StreamSession } from '$lib/types';

interface RequestOptions {
	signal?: AbortSignal;
}

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
		this.name = 'ApiError';
	}
}

async function postJson<T>(path: string, body: object, options: RequestOptions = {}): Promise<T> {
	const response = await fetch(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		signal: options.signal
	});

	const data: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const message =
			data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
				? data.message
				: `Request failed (${response.status})`;
		throw new ApiError(message, response.status);
	}

	return data as T;
}

export function searchTitles(query: string, signal?: AbortSignal): Promise<SearchResponse> {
	return postJson<SearchResponse>('/api/search', { query }, { signal });
}

export function loadEpisodes(key: string, signal?: AbortSignal): Promise<EpisodeList> {
	return postJson<EpisodeList>('/api/episodes', { key }, { signal });
}

export function createPlaybackSession(key: string, signal?: AbortSignal): Promise<StreamSession> {
	return postJson<StreamSession>('/api/session', { key }, { signal });
}

export function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}
