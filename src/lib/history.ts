// Client-side watch history stored in localStorage.
// Entries are per-episode (contentId + epIndex), so watching different episodes
// of the same title keeps each as its own row. Most recent first.

export interface WatchEntry {
	/** stable per episode: `${contentId}:${epIndex}` */
	id: string;
	/** stable opaque source-post identity (missing only on legacy entries) */
	contentId?: string;
	detailKey: string;
	title: string;
	/** sealed poster token (proxied via /api/img when IMG_PROXY=true) */
	poster?: string;
	synopsis?: string;
	/** last-played episode title (e.g. "참교육 1화") */
	epTitle?: string;
	/** episode index (data-ep-idx) */
	epIndex?: number;
	/** episode number */
	no?: number | null;
	/** unix ms */
	ts: number;
}

const KEY = 'watching:history';
const MAX = 60;

function episodePart(entry: Pick<WatchEntry, 'epIndex' | 'no' | 'epTitle'>): string {
	if (entry.epIndex != null) return `index:${entry.epIndex}`;
	if (entry.no != null) return `no:${entry.no}`;
	return `title:${(entry.epTitle || '').trim().toLowerCase()}`;
}

function legacyContentPart(entry: Pick<WatchEntry, 'title'>): string {
	return entry.title.trim().toLowerCase();
}

function makeId(
	entry: Pick<WatchEntry, 'contentId' | 'detailKey' | 'title' | 'epIndex' | 'no' | 'epTitle'>
): string {
	const contentPart = entry.contentId || `legacy:${entry.detailKey || legacyContentPart(entry)}`;
	return `${contentPart}:${episodePart(entry)}`;
}

function sameHistoryItem(
	a: Pick<WatchEntry, 'contentId' | 'title' | 'epIndex' | 'no' | 'epTitle'>,
	b: Pick<WatchEntry, 'contentId' | 'title' | 'epIndex' | 'no' | 'epTitle'>
): boolean {
	if (episodePart(a) !== episodePart(b)) return false;
	if (a.contentId && b.contentId) return a.contentId === b.contentId;
	return legacyContentPart(a) === legacyContentPart(b);
}

export function loadHistory(): WatchEntry[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) || '[]') as Partial<WatchEntry>[];
		const sorted = raw
			.map((e) => ({
				id: String(e.id ?? ''),
				contentId: e.contentId,
				detailKey: String(e.detailKey ?? ''),
				title: String(e.title ?? ''),
				poster: e.poster,
				synopsis: e.synopsis,
				epTitle: e.epTitle,
				epIndex: e.epIndex,
				no: e.no,
				ts: Number(e.ts ?? Date.now())
			}))
			.sort((a, b) => b.ts - a.ts);

		const deduped: WatchEntry[] = [];
		for (const entry of sorted) {
			entry.id = entry.contentId ? makeId(entry) : entry.id || makeId(entry);
			if (!deduped.some((existing) => sameHistoryItem(existing, entry))) deduped.push(entry);
		}
		if (JSON.stringify(deduped) !== JSON.stringify(raw)) {
			localStorage.setItem(KEY, JSON.stringify(deduped.slice(0, MAX)));
		}
		return deduped;
	} catch {
		return [];
	}
}

// Prepend (or refresh) a per-episode entry; dedup by id; cap to MAX.
export function addHistory(entry: Omit<WatchEntry, 'id' | 'ts'> & { ts?: number }): void {
	if (typeof localStorage === 'undefined') return;
	const id = makeId(entry);
	const list = loadHistory().filter((item) => !sameHistoryItem(item, entry));
	list.unshift({ ...entry, id, ts: entry.ts ?? Date.now() });
	localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
}

export function removeHistory(ids: Iterable<string>): void {
	if (typeof localStorage === 'undefined') return;
	const removed = new Set(ids);
	const list = loadHistory().filter((entry) => !removed.has(entry.id));
	localStorage.setItem(KEY, JSON.stringify(list));
}

export function clearHistory(): void {
	if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
}

// Compact "YYYY-MM-DD HH:MM" for display.
export function formatWhen(ts: number): string {
	const d = new Date(ts);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
