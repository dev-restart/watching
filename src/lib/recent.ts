// Recent search queries stored in localStorage (most recent first).

const KEY = 'watching:recent-queries';
const MAX = 10;

export function loadRecentQueries(): string[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const value: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
		if (!Array.isArray(value)) return [];
		return value
			.filter((query): query is string => typeof query === 'string')
			.map((query) => query.trim())
			.filter(Boolean)
			.slice(0, MAX);
	} catch {
		return [];
	}
}

export function addRecentQuery(q: string): void {
	if (typeof localStorage === 'undefined') return;
	const query = q.trim();
	if (!query) return;
	const list = loadRecentQueries().filter((x) => x !== query);
	list.unshift(query);
	localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
}

export function removeRecentQuery(q: string): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(KEY, JSON.stringify(loadRecentQueries().filter((x) => x !== q)));
}

export function clearRecentQueries(): void {
	if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
}
