import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { isEpisodeOffset, mergeEpisodes } from '../src/lib/episode-pagination.ts';
import { loadEpisodes, loadMoreEpisodes } from '../src/lib/client/api.ts';
import { API_ACCESS_REFRESHED_CODE } from '../src/lib/api-access.ts';
import type { Episode } from '../src/lib/types.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const ep = (no: number, token = `play-${no}`): Episode => ({ index: 1000 + no * 17, no, title: `${no}화`, playKey: token, date: '', thumbnail: '' });

test('offset validation accepts zero and bounded integers, not strings or episode ID guesses', () => {
	for (const valid of [0, 60, 120, 1_000_000]) assert.equal(isEpisodeOffset(valid), true);
	for (const invalid of [-1, 0.5, NaN, Infinity, '60', null, undefined, 406779948]) assert.equal(isEpisodeOffset(invalid), false);
});

test('merging earlier episodes preserves ascending order and does not mutate the existing list', () => {
	const current = [ep(53), ep(54)];
	const merged = mergeEpisodes(current, [ep(52), ep(1)]);
	assert.deepEqual(merged.map((item) => item.no), [1, 52, 53, 54]);
	assert.deepEqual(current.map((item) => item.no), [53, 54]);
});

test('duplicate pages preserve the original playing token rather than replace it with a fresh token', () => {
	const current = ep(53, 'currently-playing');
	const merged = mergeEpisodes([current], [ep(53, 'new-random-token'), ep(52)]);
	assert.equal(merged.length, 2);
	assert.equal(merged[1], current);
});

test('episodes without parsed numbers are retained after numbered episodes', () => {
	const bonus = { ...ep(99), no: null };
	assert.deepEqual(mergeEpisodes([bonus], [ep(2), ep(1)]).map((item) => item.no), [1, 2, null]);
});

test('initial requests retain the existing detail-key contract', async () => {
	globalThis.fetch = async (url, init) => {
		assert.equal(url, '/api/episodes');
		assert.deepEqual(JSON.parse(String(init?.body)), { key: 'opaque-detail-key' });
		return Response.json({ contentId: 'series', series: 'Title', episodes: [ep(1)] });
	};
	const result = await loadEpisodes('opaque-detail-key');
	assert.equal(result.episodes.length, 1);
});

test('continuation uses the same encrypted detail key, offset and abort signal through the app API', async () => {
	const controller = new AbortController();
	globalThis.fetch = async (url, init) => {
		assert.equal(url, '/api/episodes');
		assert.equal(init?.method, 'POST');
		assert.equal(init?.signal, controller.signal);
		assert.equal(init?.credentials, 'same-origin');
		assert.deepEqual(JSON.parse(String(init?.body)), { key: 'opaque-detail-key', offset: 60 });
		return Response.json({ contentId: 'series', series: '', episodes: [ep(52)], pagination: { total: 112, nextOffset: null } });
	};
	const result = await loadMoreEpisodes('opaque-detail-key', 60, controller.signal);
	assert.equal(result.pagination?.total, 112);
	assert.equal(result.episodes[0].no, 52);
});

test('continuation keeps the existing one-time API access refresh behavior', async () => {
	let count = 0;
	globalThis.fetch = async (_, init) => {
		assert.deepEqual(JSON.parse(String(init?.body)), { key: 'opaque-detail-key', offset: 60 });
		count++;
		return count === 1 ? Response.json({ code: API_ACCESS_REFRESHED_CODE }, { status: 401 })
			: Response.json({ contentId: 'series', series: '', episodes: [] });
	};
	await loadMoreEpisodes('opaque-detail-key', 60);
	assert.equal(count, 2);
});

test('invalid offsets do not send network requests', async () => {
	globalThis.fetch = async () => { throw new Error('Must not fetch.'); };
	await assert.rejects(loadMoreEpisodes('opaque-detail-key', -1), /Invalid episode list offset/);
});
