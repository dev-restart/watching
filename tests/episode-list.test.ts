import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	collectEpisodePages, episodeListUrl, MAX_EPISODE_PAGES_PER_REQUEST,
	readEpisodeDocument, readEpisodeListResponse,
	type EpisodeFetcher
} from '../src/lib/server/episode-list.ts';

const pageUrl = 'https://source.example/sisa/2829/406779948';

// Synthetic metadata with the supplied HTML's actual structure/protocol, not live video sessions.
function item(no: number) {
	const idx = 1_000_000 + no * 17; // IDs deliberately are not episode numbers.
	return { idx, title: `Test series 시즌 1 ${no}화`, link: `/sisa/2829/${idx}`, thumb: `/thumb/${idx}.png`, date: '09.09.2026' };
}
function descending(total: number) { return Array.from({ length: total }, (_, i) => item(total - i)); }
function html(total: number, paginated = true): string {
	const rows = descending(total).slice(0, 60).map((ep) => `<li data-ep-idx="${ep.idx}"><a class="ep-link" href="${ep.link}"><img data-src="${ep.thumb}"></a><div class="date">${ep.date}</div><a class="title" href="${ep.link}"><div class="clamp">${ep.title}</div></a></li>`).join('');
	return `<title>Test series 시즌 1 ${total}화 다시보기 - Source</title>
		<div id="epListScroll"><a class="ep-item" data-ep-idx="1000017" href="/sisa/2829/1000017"><span class="ep-item-title">Test series 시즌 1 1화</span></a></div>
		<div id="other_list"><ul id="epListUl">${rows}</ul><div id="epListSentinel"></div></div>
		${paginated ? `<script>var listUl = document.getElementById('epListUl'); var PAGE_SIZE = 60; var total = ${total}; var apiBase = '/bbs/get_episode_list.php?bo_table=sisa&wr_id=2829'; var offset = listUl.children.length;</script>` : ''}`;
}
function seed(total: number, paginated = true) {
	const doc = readEpisodeDocument(html(total, paginated), pageUrl);
	return { items: doc.items, total: doc.total, nextOffset: doc.paginated && (doc.total === null || doc.offset < doc.total) ? doc.offset : null };
}
function source(total: number): { fetcher: EpisodeFetcher; offsets: number[] } {
	const offsets: number[] = [];
	return { offsets, fetcher: async (address, init) => {
		const url = new URL(address);
		assert.equal(url.origin, 'https://source.example');
		assert.equal(url.pathname, '/bbs/get_episode_list.php');
		assert.equal(url.searchParams.get('bo_table'), 'sisa');
		assert.equal(url.searchParams.get('wr_id'), '2829');
		assert.equal(url.searchParams.get('limit'), '60');
		assert.equal(url.searchParams.has('ep_idx'), false);
		assert.equal(init.redirect, 'error');
		assert.ok(init.signal instanceof AbortSignal);
		const offset = Number(url.searchParams.get('offset'));
		offsets.push(offset);
		return Response.json({ success: true, total, items: descending(total).slice(offset, offset + 60) });
	} };
}

test('the supplied 112/60 pattern yields 60 bottom-list rows, not the hidden overlay', () => {
	const doc = readEpisodeDocument(html(112), pageUrl);
	assert.equal(doc.total, 112);
	assert.equal(doc.offset, 60);
	assert.equal(doc.items.length, 60);
	assert.equal(doc.items[0].no, 112);
	assert.equal(doc.items.at(-1)?.no, 53);
	assert.equal(doc.paginated, true);
});

test('112 episodes are completed with exactly offset=60&limit=60, yielding 1 through 112', async () => {
	const { fetcher, offsets } = source(112);
	const result = await collectEpisodePages(pageUrl, seed(112), fetcher);
	assert.deepEqual(offsets, [60]);
	assert.deepEqual(result.items.map((ep) => ep.no), Array.from({ length: 112 }, (_, i) => i + 1));
	assert.equal(new Set(result.items.map((ep) => ep.index)).size, 112);
	assert.deepEqual(result.pagination, { total: 112, nextOffset: null });
});

test('complete small lists and legacy static pages do not call an unadvertised API', async () => {
	for (const initial of [seed(1), seed(60), seed(20, false)]) {
		const result = await collectEpisodePages(pageUrl, initial, async () => { throw new Error('Unexpected request'); });
		assert.equal(result.pagination.nextOffset, null);
		assert.equal(result.pagination.warning, undefined);
	}
});

test('board query URLs work without hardcoding a source hostname or episode ID', () => {
	const url = new URL(episodeListUrl('https://another.example/bbs/board.php?bo_table=drama&wr_id=123&ep_idx=999', 60));
	assert.equal(url.origin, 'https://another.example');
	assert.equal(url.searchParams.get('bo_table'), 'drama');
	assert.equal(url.searchParams.get('wr_id'), '123');
	assert.equal(url.searchParams.get('offset'), '60');
	assert.equal(url.searchParams.has('ep_idx'), false);
});

test('invalid source paths, credentials, non-web URLs and offset values are rejected', () => {
	for (const url of ['https://source.example/unknown', 'file:///sisa/2829', 'https://user:pass@source.example/sisa/2829']) {
		assert.throws(() => episodeListUrl(url, 60));
	}
	for (const offset of [-1, 0.5, NaN, Infinity, 1_000_001]) assert.throws(() => episodeListUrl(pageUrl, offset));
});

test('metadata parsing reads only the matching script, supports unknown totals, and does not evaluate JS', () => {
	const input = html(112).replace('var total = 112;', 'var total = getTotal();') + '<script>var total = 99999; throw new Error("Never execute this");</script>';
	const doc = readEpisodeDocument(input, pageUrl);
	assert.equal(doc.total, null);
	assert.equal(doc.paginated, true);
	assert.equal(doc.offset, 60);
});

test('unknown initial totals are resolved by the actual list API total', async () => {
	const { fetcher } = source(112);
	const result = await collectEpisodePages(pageUrl, { ...seed(112), total: null }, fetcher);
	assert.equal(result.items.length, 112);
	assert.equal(result.pagination.total, 112);
});

test('large catalogs stop at a bounded batch and expose the next offset for continuation', async () => {
	const { fetcher, offsets } = source(1000);
	const result = await collectEpisodePages(pageUrl, seed(1000), fetcher);
	assert.equal(offsets.length, MAX_EPISODE_PAGES_PER_REQUEST);
	assert.equal(result.items.length, 60 * (MAX_EPISODE_PAGES_PER_REQUEST + 1));
	assert.equal(result.pagination.nextOffset, 360);
	assert.equal(result.pagination.warning, undefined);
	const remaining = await collectEpisodePages(pageUrl, { items: [], total: null, nextOffset: 360 }, fetcher);
	assert.equal(remaining.items.length, 300);
	assert.equal(remaining.pagination.nextOffset, 660);
});

test('offsets advance by raw returned rows rather than unique IDs or a guessed +60', async () => {
	const offsets: number[] = [];
	const result = await collectEpisodePages(pageUrl, seed(112), async (url) => {
		const offset = Number(new URL(url).searchParams.get('offset'));
		offsets.push(offset);
		return Response.json({ success: true, total: 112, items: descending(112).slice(offset, offset + (offset === 60 ? 20 : 60)) });
	});
	assert.deepEqual(offsets, [60, 80]);
	assert.equal(result.items.length, 112);
});

test('overlapping items are deduplicated while preserving the raw offset', async () => {
	const initial = readEpisodeListResponse({ success: true, total: 5, items: [item(5), item(4)] }, pageUrl);
	const result = await collectEpisodePages(pageUrl, { items: initial.items, total: 5, nextOffset: 2 }, async () =>
		Response.json({ success: true, total: 5, items: [item(4), item(3), item(2), item(1)] }));
	assert.deepEqual(result.items.map((ep) => ep.no), [1, 2, 3, 4, 5]);
	assert.equal(result.pagination.nextOffset, null);
});

test('a failed additional request keeps the initial list and exposes a retry instead of claiming completion', async () => {
	const result = await collectEpisodePages(pageUrl, seed(112), async () => { throw new Error('Network unavailable'); });
	assert.equal(result.items.length, 60);
	assert.equal(result.pagination.total, 112);
	assert.equal(result.pagination.nextOffset, 60);
	assert.match(result.pagination.warning ?? '', /Retry/);
});

test('a later failure preserves successful pages and resumes from the failed offset', async () => {
	const { fetcher } = source(200);
	const result = await collectEpisodePages(pageUrl, seed(200), (url, init) =>
		new URL(url).searchParams.get('offset') === '120' ? Promise.reject(new Error('Temporary outage')) : fetcher(url, init));
	assert.equal(result.items.length, 120);
	assert.equal(result.pagination.nextOffset, 120);
	assert.match(result.pagination.warning ?? '', /Retry/);
	const retry = await collectEpisodePages(pageUrl, { items: [], total: null, nextOffset: 120 }, fetcher);
	assert.equal(retry.items.length, 80);
	assert.equal(retry.pagination.nextOffset, null);
});

test('an initial continuation failure rejects instead of returning an empty successful page', async () => {
	await assert.rejects(collectEpisodePages(pageUrl, { items: [], total: null, nextOffset: 60 }, async () => { throw new Error('Offline'); }), /Offline/);
});

test('repeated pages stop without advancing the retry offset or looping', async () => {
	let calls = 0;
	const result = await collectEpisodePages(pageUrl, seed(112), async () => {
		calls++;
		return Response.json({ success: true, total: 112, items: descending(112).slice(0, 60) });
	});
	assert.equal(calls, 1);
	assert.equal(result.items.length, 60);
	assert.equal(result.pagination.nextOffset, 60);
	assert.ok(result.pagination.warning);
});

test('an empty page before the reported total is not reported as complete', async () => {
	const result = await collectEpisodePages(pageUrl, seed(112), async () => Response.json({ success: true, total: 112, items: [] }));
	assert.equal(result.pagination.nextOffset, 60);
	assert.ok(result.pagination.warning);
});

test('HTTP errors and non-JSON responses keep the usable list', async () => {
	for (const response of [new Response('Unavailable', { status: 503 }), new Response('<html>Maintenance</html>')]) {
		const result = await collectEpisodePages(pageUrl, seed(112), async () => response);
		assert.equal(result.pagination.nextOffset, 60);
		assert.ok(result.pagination.warning);
	}
});

test('large response headers and streaming bodies are bounded', async () => {
	for (const response of [new Response('x', { headers: { 'Content-Length': '2000001' } }), new Response('x'.repeat(2_000_001))]) {
		const result = await collectEpisodePages(pageUrl, seed(112), async () => response);
		assert.equal(result.pagination.nextOffset, 60);
		assert.ok(result.pagination.warning);
	}
});

test('cancellation discards the result instead of treating navigation as a partial success', async () => {
	const controller = new AbortController();
	await assert.rejects(collectEpisodePages(pageUrl, seed(112), async () => {
		controller.abort();
		return Response.json({ success: true, total: 112, items: descending(112).slice(60) });
	}, {}, controller.signal), (error: unknown) => error instanceof Error && error.name === 'AbortError');
});

test('source item metadata is normalized but source HTML/script is never rendered', () => {
	const result = readEpisodeListResponse({ success: true, total: '112', items: [{ ...item(52), idx: String(item(52).idx) }] }, pageUrl);
	assert.equal(result.items[0].no, 52);
	assert.equal(result.items[0].url, new URL(item(52).link, pageUrl).href);
	assert.equal(result.items[0].thumb, new URL(item(52).thumb, pageUrl).href);
});

test('unrelated hosts, other series, mismatched IDs and malformed item metadata are rejected', () => {
	for (const change of [
		{ link: 'https://other.example/sisa/2829/1000884' },
		{ link: '/sisa/9999/1000884' }, { link: '/sisa/2829/99999' },
		{ link: 'javascript:alert(1)' }, { idx: -1 }, { idx: 1.5 }, { idx: '3junk' }, { title: '' }
	]) assert.throws(() => readEpisodeListResponse({ success: true, total: 112, items: [{ ...item(52), ...change }] }, pageUrl));
});

test('invalid page envelopes and excessive page sizes are rejected', () => {
	for (const data of [null, [], { success: false, items: [], total: 112 },
		{ success: true, items: 'bad', total: 112 }, { success: true, items: [], total: -1 },
		{ success: true, items: [], total: 1_000_001 },
		{ success: true, items: descending(61), total: 112 }
	]) assert.throws(() => readEpisodeListResponse(data, pageUrl));
});
