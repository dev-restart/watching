import type { Episode } from './types.ts';

export const EPISODE_PAGE_SIZE = 60;
export const MAX_EPISODE_OFFSET = 1_000_000;

export function isEpisodeOffset(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_EPISODE_OFFSET;
}

/** Preserve existing playback tokens when pages overlap, and keep the current oldest-first UI. */
export function mergeEpisodes(current: readonly Episode[], incoming: readonly Episode[]): Episode[] {
	const episodes = new Map<number, Episode>();
	for (const episode of [...current, ...incoming]) {
		if (!episodes.has(episode.index)) episodes.set(episode.index, episode);
	}
	return [...episodes.values()].sort((a, b) =>
		(a.no ?? Number.MAX_SAFE_INTEGER) - (b.no ?? Number.MAX_SAFE_INTEGER) || a.index - b.index
	);
}
