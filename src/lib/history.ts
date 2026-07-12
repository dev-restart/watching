// Client-side watch history stored in localStorage.
// Entries are per-episode (detailKey + epIndex), so watching different episodes
// of the same title keeps each as its own row. Most recent first.

export interface WatchEntry {
	/** unique per episode: `${detailKey}:${epIndex}` (or detailKey when no epIndex) */
	id: string;
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

function makeId(detailKey: string, epIndex?: number): string {
	return epIndex != null ? `${detailKey}:${epIndex}` : detailKey;
}

export function loadHistory(): WatchEntry[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) || '[]') as Partial<WatchEntry>[];
		return raw
			.map((e) => ({
				id: e.id ?? makeId(String(e.detailKey ?? ''), e.epIndex),
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
	} catch {
		return [];
	}
}

// Prepend (or refresh) a per-episode entry; dedup by id; cap to MAX.
export function addHistory(entry: Omit<WatchEntry, 'id' | 'ts'> & { ts?: number }): void {
	if (typeof localStorage === 'undefined') return;
	const id = makeId(entry.detailKey, entry.epIndex);
	const list = loadHistory().filter((x) => x.id !== id);
	list.unshift({ ...entry, id, ts: entry.ts ?? Date.now() });
	localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
}

export function removeHistory(id: string): void {
	if (typeof localStorage === 'undefined') return;
	const list = loadHistory().filter((x) => x.id !== id);
	localStorage.setItem(KEY, JSON.stringify(list));
}

export function clearHistory(): void {
	if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
}

export function lastWatched(): WatchEntry | null {
	return loadHistory()[0] ?? null;
}

// Compact "YYYY-MM-DD HH:MM" for display.
export function formatWhen(ts: number): string {
	const d = new Date(ts);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
