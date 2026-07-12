// Bookmarks ("watch later") stored in localStorage, keyed by detailKey.

export interface Bookmark {
	/** detailKey (one bookmark per title) */
	id: string;
	detailKey: string;
	title: string;
	poster?: string;
	synopsis?: string;
	category?: string;
	ts: number;
}

const KEY = 'watching:bookmarks';
const MAX = 100;

export function loadBookmarks(): Bookmark[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		return JSON.parse(localStorage.getItem(KEY) || '[]') as Bookmark[];
	} catch {
		return [];
	}
}

export function isBookmarked(detailKey: string): boolean {
	return loadBookmarks().some((b) => b.id === detailKey);
}

// Toggle a bookmark; returns the new state (true = bookmarked).
export function toggleBookmark(b: Omit<Bookmark, 'id' | 'ts'>): boolean {
	if (typeof localStorage === 'undefined') return false;
	const list = loadBookmarks();
	const exists = list.some((x) => x.id === b.detailKey);
	if (exists) {
		localStorage.setItem(KEY, JSON.stringify(list.filter((x) => x.id !== b.detailKey)));
		return false;
	}
	list.unshift({ ...b, id: b.detailKey, ts: Date.now() });
	localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
	return true;
}

export function removeBookmark(id: string): void {
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(KEY, JSON.stringify(loadBookmarks().filter((x) => x.id !== id)));
	}
}

export function clearBookmarks(): void {
	if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
}
