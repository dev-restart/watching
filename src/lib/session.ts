// Client-side playback session cache (sessionStorage).
// The frontend only ever holds the opaque playKey/detailKey from the server.

import type { StreamSession } from './types';

const SAFETY_MS = 20_000; // treat as expired 20s before the real expiry

export function ssKey(playKey: string): string {
	return `watching:session:${playKey}`;
}

export function readSession(playKey: string): StreamSession | null {
	if (typeof sessionStorage === 'undefined') return null;
	const raw = sessionStorage.getItem(ssKey(playKey));
	if (!raw) return null;
	try {
		return JSON.parse(raw) as StreamSession;
	} catch {
		return null;
	}
}

export function isFresh(s: StreamSession | null, now = Date.now()): boolean {
	return !!s && s.expires * 1000 - SAFETY_MS > now;
}

// Fetch a session via the API and cache it.
export async function fetchSession(playKey: string): Promise<StreamSession> {
	const res = await fetch('/api/session', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ key: playKey })
	});
	if (!res.ok) {
		const j = await res.json().catch(() => ({}));
		throw new Error(j.message || `Session failed (${res.status})`);
	}
	const s = (await res.json()) as StreamSession;
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
