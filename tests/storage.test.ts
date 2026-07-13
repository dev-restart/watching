import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { clearBookmarks, loadBookmarks, removeBookmarks, toggleBookmark } from '../src/lib/bookmarks.ts';
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

beforeEach(() => {
	localStorage.clear();
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

test('bookmarks use stable content identity and support bulk removal', () => {
	assert.equal(
		toggleBookmark({
			contentId: 'content-a',
			detailKey: 'random-detail-key',
			title: 'Title A'
		}),
		true
	);
	assert.equal(
		toggleBookmark({
			contentId: 'content-a',
			detailKey: 'another-detail-key',
			title: 'Title A'
		}),
		false
	);

	assert.equal(loadBookmarks().length, 0);

	toggleBookmark({ contentId: 'content-a', detailKey: 'key-a', title: 'Title A' });
	toggleBookmark({ contentId: 'content-b', detailKey: 'key-b', title: 'Title B' });
	removeBookmarks(new Set(['content-a', 'content-b']));
	assert.deepEqual(loadBookmarks(), []);
});

test('clear helpers remove all persisted data', () => {
	addHistory({ contentId: 'content-a', detailKey: 'key-a', title: 'A', epIndex: 1 });
	toggleBookmark({ contentId: 'content-a', detailKey: 'key-a', title: 'A' });
	clearHistory();
	clearBookmarks();
	assert.deepEqual(loadHistory(), []);
	assert.deepEqual(loadBookmarks(), []);
});
