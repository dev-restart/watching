// Source list protocol from the supplied page's epListUl infinite-scroll script.
// This module reads HTML/JSON as data; it never evaluates upstream JavaScript.
import * as cheerio from 'cheerio';
import { EPISODE_PAGE_SIZE, isEpisodeOffset } from '../episode-pagination.ts';
import type { EpisodePagination } from '../types.ts';

export const MAX_EPISODE_PAGES_PER_REQUEST = 5;
const MAX_RESPONSE_BYTES = 2_000_000;
const BATCH_TIMEOUT_MS = 20_000;
const PARTIAL_WARNING = 'Some earlier episodes could not be loaded. Your current list is still available; use Retry to continue.';

export interface SourceEpisode {
	index: number;
	no: number | null;
	title: string;
	url: string;
	date: string;
	thumb: string;
}

export interface EpisodeDocument {
	title: string;
	items: SourceEpisode[];
	/** Raw upstream row count, not the deduplicated/filtered count. */
	offset: number;
	total: number | null;
	paginated: boolean;
}

type SourcePost = { origin: string; board: string; post: string };
export type EpisodeFetcher = (url: string, init: RequestInit) => Promise<Response>;

function sourcePost(pageUrl: string): SourcePost | null {
	const url = new URL(pageUrl);
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
	const pretty = url.pathname.match(/^\/([A-Za-z0-9_]{1,64})\/([1-9]\d{0,19})(?:\/[1-9]\d{0,19})?\/?$/);
	const board = pretty?.[1] ?? (url.pathname === '/bbs/board.php' ? url.searchParams.get('bo_table') : null);
	const post = pretty?.[2] ?? (url.pathname === '/bbs/board.php' ? url.searchParams.get('wr_id') : null);
	if (!board || !post || !/^[A-Za-z0-9_]{1,64}$/.test(board) || !/^[1-9]\d{0,19}$/.test(post)) return null;
	return { origin: url.origin, board, post };
}

export function episodeListUrl(pageUrl: string, offset: number): string {
	const source = sourcePost(pageUrl);
	if (!source || !isEpisodeOffset(offset)) throw new Error('Invalid episode list request.');
	// Never accept an endpoint/host from the client or execute the page's apiBase expression.
	const url = new URL('/bbs/get_episode_list.php', source.origin);
	url.search = new URLSearchParams({
		bo_table: source.board, wr_id: source.post,
		offset: String(offset), limit: String(EPISODE_PAGE_SIZE)
	}).toString();
	return url.href;
}

function httpUrl(value: unknown, base: string): string {
	if (typeof value !== 'string' || !value.trim() || value.length > 4096) return '';
	try {
		const url = new URL(value, base);
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
		return url.href;
	} catch { return ''; }
}

function normalizeEpisode(raw: Record<string, unknown>, pageUrl: string): SourceEpisode | null {
	const index = typeof raw.idx === 'string' && /^[1-9]\d*$/.test(raw.idx) ? Number(raw.idx) : raw.idx;
	if (typeof index !== 'number' || !Number.isSafeInteger(index) || index <= 0) return null;
	if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 2000) return null;
	const url = httpUrl(raw.link, pageUrl);
	if (!url || new URL(url).origin !== new URL(pageUrl).origin) return null;
	const source = sourcePost(pageUrl);
	if (source) {
		const target = sourcePost(url);
		if (!target || target.board !== source.board || target.post !== source.post) return null;
		const parsed = new URL(url);
		const linkIndex = parsed.pathname.match(/^\/[^/]+\/\d+\/(\d+)\/?$/)?.[1] ?? parsed.searchParams.get('ep_idx');
		if (linkIndex !== null && linkIndex !== undefined && Number(linkIndex) !== index) return null;
	}
	const title = raw.title.trim();
	const episodeNumber = title.match(/(\d+)\s*화/);
	return {
		index, no: episodeNumber ? Number(episodeNumber[1]) : null,
		title, url,
		date: typeof raw.date === 'string' ? raw.date.slice(0, 100) : '',
		thumb: httpUrl(raw.thumb, pageUrl)
	};
}

/** Read only the actual bottom list, not the hidden player overlay's first 20 episodes. */
export function readEpisodeDocument(html: string, pageUrl: string): EpisodeDocument {
	const $ = cheerio.load(html);
	const rows = $('#other_list ul li[data-ep-idx]');
	const items = new Map<number, SourceEpisode>();
	rows.each((_, node) => {
		const row = $(node);
		const image = row.find('img').first();
		const item = normalizeEpisode({
			idx: row.attr('data-ep-idx'),
			link: row.find('a.ep-link').attr('href') || row.find('a.title').attr('href'),
			title: row.find('a.title .clamp').text().trim() || row.find('a.title').text().trim() || row.text().trim(),
			date: row.find('.date').text().trim(),
			thumb: image.attr('data-src') || image.attr('data-original') || image.attr('src') || ''
		}, pageUrl);
		if (item && !items.has(item.index)) items.set(item.index, item);
	});
	const listScript = $('script:not([src])').toArray().map((node) => $(node).text())
		.find((text) => text.includes('epListUl') && text.includes('/bbs/get_episode_list.php'));
	const rawTotal = listScript?.match(/\b(?:var|let|const)\s+total\s*=\s*(\d+)\s*;/)?.[1];
	const parsedTotal = rawTotal === undefined ? null : Number(rawTotal);
	const paginated = Boolean(listScript && sourcePost(pageUrl));
	return {
		title: $('title').first().text().trim(), items: [...items.values()], offset: rows.length,
		total: paginated ? (isEpisodeOffset(parsedTotal) ? parsedTotal : null) : items.size,
		paginated
	};
}

export function readEpisodeListResponse(data: unknown, pageUrl: string): { items: SourceEpisode[]; total: number; count: number } {
	if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid episode list response.');
	const result = data as Record<string, unknown>;
	const total = typeof result.total === 'string' && /^\d+$/.test(result.total) ? Number(result.total) : result.total;
	if (result.success !== true || !Array.isArray(result.items) || result.items.length > EPISODE_PAGE_SIZE || !isEpisodeOffset(total)) {
		throw new Error('Invalid episode list response.');
	}
	const items = result.items.map((raw: unknown) => {
		const item = raw && typeof raw === 'object' && !Array.isArray(raw)
			? normalizeEpisode(raw as Record<string, unknown>, pageUrl) : null;
		if (!item) throw new Error('Invalid episode list item.');
		return item;
	});
	return { items, total, count: result.items.length };
}

async function boundedJson(response: Response): Promise<unknown> {
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`Episode list request failed (${response.status}).`);
	}
	if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
		await response.body?.cancel();
		throw new Error('Episode list response is too large.');
	}
	const reader = response.body?.getReader();
	if (!reader) throw new Error('Episode list response is empty.');
	const decoder = new TextDecoder();
	let size = 0;
	let text = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_RESPONSE_BYTES) throw new Error('Episode list response is too large.');
			text += decoder.decode(value, { stream: true });
		}
		return JSON.parse(text + decoder.decode());
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

/**
 * Complete ordinary lists (112 = initial 60 + remaining 52) in the first request.
 * Larger/slow lists return a resumable offset instead of issuing unbounded requests.
 */
export async function collectEpisodePages(
	pageUrl: string,
	seed: { items: SourceEpisode[]; total: number | null; nextOffset: number | null },
	fetcher: EpisodeFetcher,
	headers: HeadersInit = {},
	parentSignal?: AbortSignal
): Promise<{ items: SourceEpisode[]; pagination: EpisodePagination }> {
	const items = new Map(seed.items.map((item) => [item.index, item]));
	let nextOffset = seed.nextOffset;
	let total = seed.total;
	let warning: string | undefined;
	const timeout = AbortSignal.timeout(BATCH_TIMEOUT_MS);
	const signal = parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout;
	for (let page = 0; nextOffset !== null && page < MAX_EPISODE_PAGES_PER_REQUEST; page++) {
		try {
			signal.throwIfAborted();
			const offset: number = nextOffset;
			const response = await fetcher(episodeListUrl(pageUrl, offset), {
				headers, signal, redirect: 'error'
			});
			const batch = readEpisodeListResponse(await boundedJson(response), pageUrl);
			signal.throwIfAborted();
			if (batch.count === 0 && offset < batch.total) throw new Error('Episode list stopped before the reported total.');
			if (batch.count > 0 && batch.items.every((item) => items.has(item.index))) {
				throw new Error('Episode list returned a repeated page.');
			}
			const advancedOffset: number = offset + batch.count;
			if (!isEpisodeOffset(advancedOffset)) throw new Error('Episode list offset exceeded the limit.');
			for (const item of batch.items) if (!items.has(item.index)) items.set(item.index, item);
			total = batch.total;
			nextOffset = advancedOffset >= total ? null : advancedOffset;
		} catch (error) {
			if (parentSignal?.aborted) throw error;
			if (items.size === 0) throw error;
			// Keep the last successful offset, so Retry does not refetch or lose completed pages.
			warning = PARTIAL_WARNING;
			break;
		}
	}
	return {
		items: [...items.values()].sort((a, b) => (a.no ?? Number.MAX_SAFE_INTEGER) - (b.no ?? Number.MAX_SAFE_INTEGER) || a.index - b.index),
		pagination: { total, nextOffset, ...(warning ? { warning } : {}) }
	};
}
