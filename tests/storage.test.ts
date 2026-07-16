import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import 'fake-indexeddb/auto';
import {
	clearBookmarks,
	loadBookmarks,
	mergeBookmarks,
	removeBookmarks,
	toggleBookmark
} from '../src/lib/bookmarks.ts';
import { addHistory, clearHistory, loadHistory, removeHistory } from '../src/lib/history.ts';

class MemoryStorage implements Storage {
	readonly #values = new Map<string, string>();

	get length(): number {
		return this.#values.size;
	}

	clear(): void {
		this.#values.clear();
	}

	getItem(key: string): string | null {
		return this.#values.get(key) ?? null;
	}

	key(index: number): string | null {
		return [...this.#values.keys()][index] ?? null;
	}

	removeItem(key: string): void {
		this.#values.delete(key);
	}

	setItem(key: string, value: string): void {
		this.#values.set(key, value);
	}
}

Object.defineProperty(globalThis, 'localStorage', {
	configurable: true,
	value: new MemoryStorage()
});

beforeEach(async () => {
	localStorage.clear();
	await clearBookmarks();
});

test('history keeps the latest entry for the same content and episode', () => {
	addHistory({
		contentId: 'content-a',
		detailKey: 'old-random-key',
		title: 'Title A',
		epTitle: 'Episode 1',
		epIndex: 1,
		no: 1,
		ts: 100
	});
	addHistory({
		contentId: 'content-a',
		detailKey: 'new-random-key',
		title: 'Title A',
		epTitle: 'Episode 1',
		epIndex: 1,
		no: 1,
		ts: 200
	});

	const history = loadHistory();
	assert.equal(history.length, 1);
	assert.equal(history[0].detailKey, 'new-random-key');
	assert.equal(history[0].ts, 200);
});

test('history preserves different episodes and removes selected entries in one update', () => {
	for (const epIndex of [1, 2, 3]) {
		addHistory({
			contentId: 'content-a',
			detailKey: `key-${epIndex}`,
			title: 'Title A',
			epTitle: `Episode ${epIndex}`,
			epIndex,
			no: epIndex,
			ts: epIndex
		});
	}

	const [first, second] = loadHistory();
	removeHistory(new Set([first.id, second.id]));
	assert.deepEqual(loadHistory().map((entry) => entry.epIndex), [1]);
});

test('bookmarks use stable content identity and support bulk removal', async () => {
	assert.equal(
		await toggleBookmark({
			contentId: 'content-a',
			detailKey: 'random-detail-key',
			title: 'Title A'
		}),
		true
	);
	assert.equal(
		await toggleBookmark({
			contentId: 'content-a',
			detailKey: 'another-detail-key',
			title: 'Title A'
		}),
		false
	);

	assert.equal((await loadBookmarks()).length, 0);

	await toggleBookmark({ contentId: 'content-a', detailKey: 'key-a', title: 'Title A' });
	await toggleBookmark({ contentId: 'content-b', detailKey: 'key-b', title: 'Title B' });
	await removeBookmarks(new Set(['content-a', 'content-b']));
	assert.deepEqual(await loadBookmarks(), []);
});

test('bookmark merge removes a stale legacy key when content identity becomes available', async () => {
	await toggleBookmark({ detailKey: 'legacy-key', title: 'Same title' });
	await mergeBookmarks([
		{
			id: 'content-a',
			contentId: 'content-a',
			detailKey: 'current-key',
			title: 'Same title',
			ts: Date.now()
		}
	]);

	const bookmarks = await loadBookmarks();
	assert.equal(bookmarks.length, 1);
	assert.equal(bookmarks[0].id, 'content-a');
	assert.equal(bookmarks[0].detailKey, 'current-key');
});

test('clear helpers remove all persisted data', async () => {
	addHistory({ contentId: 'content-a', detailKey: 'key-a', title: 'A', epIndex: 1 });
	await toggleBookmark({ contentId: 'content-a', detailKey: 'key-a', title: 'A' });
	clearHistory();
	await clearBookmarks();
	assert.deepEqual(loadHistory(), []);
	assert.deepEqual(await loadBookmarks(), []);
});

test('legacy localStorage bookmarks migrate automatically without a count limit', async () => {
	const legacy = Array.from({ length: 125 }, (_, index) => ({
		id: `content-${index}`,
		contentId: `content-${index}`,
		detailKey: `key-${index}`,
		title: `Title ${index}`,
		ts: index
	}));
	localStorage.setItem('watching:bookmarks', JSON.stringify(legacy));

	const bookmarks = await loadBookmarks();
	assert.equal(bookmarks.length, 125);
	assert.equal(bookmarks[0].contentId, 'content-124');
	assert.equal(localStorage.getItem('watching:bookmarks'), null);
});
