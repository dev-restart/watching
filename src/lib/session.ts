// Client-side playback session cache (sessionStorage).
// The frontend only ever holds the opaque playKey/detailKey from the server.

import type { StreamSession } from './types';
import { createPlaybackSession } from '$lib/client/api';

const SAFETY_MS = 20_000; // treat as expired 20s before the real expiry

function ssKey(playKey: string): string {
	return `watching:session:${playKey}`;
}

function readSession(playKey: string): StreamSession | null {
	if (typeof sessionStorage === 'undefined') return null;
	const raw = sessionStorage.getItem(ssKey(playKey));
	if (!raw) return null;
	try {
		return JSON.parse(raw) as StreamSession;
	} catch {
		return null;
	}
}

function isFresh(s: StreamSession | null, now = Date.now()): boolean {
	return !!s && s.expires * 1000 - SAFETY_MS > now;
}

// Fetch a session via the API and cache it.
async function fetchSession(playKey: string): Promise<StreamSession> {
	const s = await createPlaybackSession(playKey);
	if (typeof sessionStorage !== 'undefined') {
		sessionStorage.setItem(ssKey(playKey), JSON.stringify(s));
	}
	return s;
}

// Return cached session if fresh, otherwise reissue (always when force=true).
export async function getOrFetchSession(playKey: string, force = false): Promise<StreamSession> {
	const cached = readSession(playKey);
	if (!force && isFresh(cached)) return cached!;
	return fetchSession(playKey);
}
