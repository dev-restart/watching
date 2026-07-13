// Bookmarks ("watch later") stored in localStorage, keyed by stable contentId.

export interface Bookmark {
	/** stable contentId for new entries; legacy entries keep their old detailKey ID */
	id: string;
	/** stable opaque source-post identity (missing only on legacy entries) */
	contentId?: string;
	detailKey: string;
	title: string;
	poster?: string;
	synopsis?: string;
	category?: string;
	ts: number;
}

const KEY = 'watching:bookmarks';
const MAX = 100;

function normalizedTitle(bookmark: Pick<Bookmark, 'title'>): string {
	return bookmark.title.trim().toLowerCase();
}

function sameBookmark(
	a: Pick<Bookmark, 'contentId' | 'title'>,
	b: Pick<Bookmark, 'contentId' | 'title'>
): boolean {
	if (a.contentId && b.contentId) return a.contentId === b.contentId;
	return normalizedTitle(a) === normalizedTitle(b);
}

export function loadBookmarks(): Bookmark[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const list = (JSON.parse(localStorage.getItem(KEY) || '[]') as Bookmark[]).sort(
			(a, b) => b.ts - a.ts
		);
		const deduped: Bookmark[] = [];
		for (const bookmark of list) {
			if (!deduped.some((existing) => sameBookmark(existing, bookmark))) deduped.push(bookmark);
		}
		if (JSON.stringify(deduped) !== JSON.stringify(list)) {
			localStorage.setItem(KEY, JSON.stringify(deduped.slice(0, MAX)));
		}
		return deduped;
	} catch {
		return [];
	}
}

export function syncBookmarkIdentity(contentId: string, detailKey: string, title: string): boolean {
	if (typeof localStorage === 'undefined') return false;
	const target = { contentId, title };
	const list = loadBookmarks();
	const existing = list.find(
		(bookmark) => bookmark.id === detailKey || sameBookmark(bookmark, target)
	);
	if (!existing) return false;

	const updated: Bookmark = { ...existing, id: contentId, contentId, detailKey, title };
	localStorage.setItem(
		KEY,
		JSON.stringify([updated, ...list.filter((bookmark) => bookmark !== existing)].slice(0, MAX))
	);
	return true;
}

// Toggle a bookmark; returns the new state (true = bookmarked).
export function toggleBookmark(b: Omit<Bookmark, 'id' | 'ts'>): boolean {
	if (typeof localStorage === 'undefined') return false;
	const list = loadBookmarks();
	const sameContent = (bookmark: Bookmark) => sameBookmark(bookmark, b);
	const exists = list.some(sameContent);
	if (exists) {
		localStorage.setItem(KEY, JSON.stringify(list.filter((bookmark) => !sameContent(bookmark))));
		return false;
	}
	list.unshift({ ...b, id: b.contentId || b.detailKey, ts: Date.now() });
	localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
	return true;
}

export function removeBookmarks(ids: Iterable<string>): void {
	if (typeof localStorage !== 'undefined') {
		const removed = new Set(ids);
		localStorage.setItem(
			KEY,
			JSON.stringify(loadBookmarks().filter((bookmark) => !removed.has(bookmark.id)))
		);
	}
}

export function clearBookmarks(): void {
	if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
}
