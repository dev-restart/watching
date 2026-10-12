import type { EpisodeList, SearchResponse, StreamSession } from '$lib/types';
import { API_ACCESS_REFRESHED_CODE } from '../api-access.ts';
import { isEpisodeOffset } from '../episode-pagination.ts';
import { reportServiceBlocked, requestServiceRecheck } from '../service-status.ts';

interface RequestOptions {
	signal?: AbortSignal;
}

export class ApiError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
	}
}

async function requestPostJson<T>(
	path: string,
	body: object,
	options: RequestOptions,
	canRetryApiAccess: boolean
): Promise<T> {
	const response = await fetch(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		signal: options.signal,
		credentials: 'same-origin'
	});

	const data: unknown = await response.json().catch(() => null);
	if (
		canRetryApiAccess &&
		response.status === 401 &&
		data &&
		typeof data === 'object' &&
		'code' in data &&
		data.code === API_ACCESS_REFRESHED_CODE
	) {
		return requestPostJson<T>(path, body, options, false);
	}

	if (!response.ok) {
		if (!options.signal?.aborted) reportServiceBlocked(path, response.status, data);
		const message =
			data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
				? data.message
				: `Request failed (${response.status})`;
		throw new ApiError(message, response.status);
	}

	return data as T;
}

export function postJson<T>(path: string, body: object, options: RequestOptions = {}): Promise<T> {
	return requestPostJson<T>(path, body, options, true).catch((error: unknown) => {
		if (!options.signal?.aborted && !isAbortError(error)) {
			requestServiceRecheck(path, error instanceof ApiError ? error.status : undefined);
		}
		throw error;
	});
}

export function searchTitles(query: string, signal?: AbortSignal): Promise<SearchResponse> {
	return postJson<SearchResponse>('/api/search', { query }, { signal });
}

export function loadEpisodes(key: string, signal?: AbortSignal): Promise<EpisodeList> {
	return postJson<EpisodeList>('/api/episodes', { key }, { signal });
}

export function loadMoreEpisodes(key: string, offset: number, signal?: AbortSignal): Promise<EpisodeList> {
	if (!isEpisodeOffset(offset)) return Promise.reject(new Error('Invalid episode list offset.'));
	return postJson<EpisodeList>('/api/episodes', { key, offset }, { signal });
}

export function createPlaybackSession(key: string, signal?: AbortSignal): Promise<StreamSession> {
	return postJson<StreamSession>('/api/session', { key }, { signal });
}

export function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}
