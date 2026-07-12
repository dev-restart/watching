// Server-only source catalog client.
// Never imported by the client bundle ($lib/server/* is excluded from the browser).

import * as cheerio from 'cheerio';
import { env } from '$env/dynamic/private';
import type {
	Episode,
	EpisodeList,
	SearchResponse,
	SearchResult,
	StreamSession
} from '$lib/types';
import { sealUrl } from '$lib/server/tokens';

function trimTrailingSlash(v: string | undefined): string {
	return (v || '').replace(/\/+$/, '');
}

// Composed at runtime from env: origin + path => token endpoint.
export const SOURCE_ORIGIN = trimTrailingSlash(env.SOURCE_ORIGIN);
export const TOKEN_PATH = env.TOKEN_PATH || '';
export const TOKEN_ENDPOINT = `${SOURCE_ORIGIN}${TOKEN_PATH}`;
export const PLAYER_ORIGIN = trimTrailingSlash(env.PLAYER_ORIGIN);

// When true (default), images are served through /api/img so the original host is hidden.
// Set IMG_PROXY=false to load images directly from the source (saves server bandwidth).
export const IMG_PROXY = env.IMG_PROXY !== 'false';

// Search endpoint path under SOURCE_ORIGIN (kept in env so the source route is not hard-coded).
export const SEARCH_PATH = env.SEARCH_PATH || '';

const UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
	'AppleWebKit/537.36 (KHTML, like Gecko) ' +
	'Chrome/120.0.0.0 Safari/537.36';

const COMMON_HEADERS = {
	'User-Agent': UA,
	Accept: 'application/json, text/javascript, text/html, */*; q=0.01',
	'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
	'Cache-Control': 'no-cache',
	Pragma: 'no-cache'
};

const AJAX_HEADERS = {
	...COMMON_HEADERS,
	'X-Requested-With': 'XMLHttpRequest',
	'Sec-Fetch-Dest': 'empty',
	'Sec-Fetch-Mode': 'cors',
	'Sec-Fetch-Site': 'same-origin'
};

const MAX_RETRIES = 5;

export class CatalogError extends Error {}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// fetch wrapper with exponential backoff for transient failures / rate limiting.
async function request(url: string, init: RequestInit = {}): Promise<Response> {
	let lastErr: unknown;
	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			const res = await fetch(url, init);
			if (res.status === 429) {
				await sleep((2 ** attempt + Math.random()) * 1000);
				continue;
			}
			return res;
		} catch (err) {
			lastErr = err;
			await sleep(1500 * (attempt + 1));
		}
	}
	throw new CatalogError(`Request failed (${url}): ${String(lastErr)}`);
}

export async function fetchPage(url: string): Promise<string> {
	const res = await request(url, {
		headers: { ...COMMON_HEADERS, Referer: `${SOURCE_ORIGIN}/` }
	});
	if (!res.ok) throw new CatalogError(`Page request failed (${res.status}): ${url}`);
	return res.text();
}

// --- parsing helpers ---

const SESSION_RE = /data-session1\s*=\s*"([^"]*)"/;

function decodeEntities(s: string): string {
	return s
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, '&')
		.replace(/&#39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>');
}

// Extract and decode the embedded session payload from the page HTML.
export function extractSession(html: string): Record<string, unknown> | null {
	const m = html.match(SESSION_RE);
	if (!m) return null;
	try {
		return JSON.parse(decodeEntities(m[1]));
	} catch {
		return null;
	}
}

function parseEpisodeNo(title: string): number | null {
	const m = title.match(/(\d+)\s*화/);
	return m ? parseInt(m[1], 10) : null;
}

// Best-effort series title from a page <title>.
function guessSeries(rawTitle: string): string {
	let t = rawTitle.split(/\s*[-|]\s*/)[0];
	t = t.replace(/다시보기/g, '').trim();
	t = t.replace(/\s*\d+\s*화\s*$/, '').trim();
	return t;
}

// Normalize the player host against the configured origin (keeps code free of hard-coded hosts).
function normalizePlayerUrl(url: string): string {
	if (!PLAYER_ORIGIN) return url;
	try {
		const u = new URL(url);
		const base = new URL(PLAYER_ORIGIN);
		return `${base.origin}${u.pathname}`;
	} catch {
		return url;
	}
}

function playerCompany(playerUrl: string): string {
	let host = '';
	try {
		host = new URL(playerUrl).hostname.toLowerCase();
	} catch {
		host = playerUrl;
	}
	return host.replace(/^(player|www|cdn\d*|m)\./, '');
}

function absUrl(href: string): string {
	if (!href) return '';
	if (/^https?:\/\//i.test(href)) return href;
	return `${SOURCE_ORIGIN}${href.startsWith('/') ? '' : '/'}${href}`;
}

// Wrap an external image URL into an opaque token so the raw host never reaches the browser.
// Honors IMG_PROXY: when disabled, the raw URL is returned as-is for direct loading.
function sealIf(v: string): string {
	if (!v) return '';
	return IMG_PROXY ? sealUrl(v) : v;
}

// --- public API ---

// Episode page -> (series name, full episode list). Ordered 1..N.
export async function getEpisodes(pageUrl: string): Promise<EpisodeList> {
	const html = await fetchPage(pageUrl);
	const $ = cheerio.load(html);

	const series = guessSeries($('title').first().text().trim());

	const episodes: Episode[] = [];
	const seen = new Set<number>();

	$('#other_list ul li[data-ep-idx]').each((_, el) => {
		const $li = $(el);
		const idx = parseInt($li.attr('data-ep-idx') || '', 10);
		if (!idx || seen.has(idx)) return;
		seen.add(idx);

		const href = $li.find('a.ep-link').attr('href') || '';
		const title =
			$li.find('a.title .clamp').text().trim() ||
			$li.find('a.title').text().trim() ||
			$li.find('.searchText').text().trim();
		const date = $li.find('.date').text().trim();
		const $img = $li.find('img').first();
		const thumbnail = sealIf(
			$img.attr('data-src') || $img.attr('data-original') || $img.attr('src') || ''
		);

		const epPageUrl = absUrl(href);
		episodes.push({
			index: idx,
			no: parseEpisodeNo(title),
			title,
			playKey: sealUrl(epPageUrl),
			date,
			thumbnail
		});
	});

	episodes.sort((a, b) => (a.no ?? 1e9) - (b.no ?? 1e9));

	return { series, episodes };
}

// Title search via the board ajax endpoint.
export async function searchList(query: string, srows = 500): Promise<SearchResponse> {
	const q = query.trim();
	if (!q) return { query: q, count: 0, results: [] };

	const url =
		`${SOURCE_ORIGIN}${SEARCH_PATH}?sfl=wr_subject` +
		`&stx=${encodeURIComponent(q)}` +
		`&srows=${srows}`;

	const res = await request(url, {
		headers: { ...AJAX_HEADERS, Referer: `${SOURCE_ORIGIN}/`, Origin: SOURCE_ORIGIN }
	});
	const text = await res.text();
	let data: any;
	try {
		data = JSON.parse(text);
	} catch {
		const preview = text.replace(/\s+/g, ' ').slice(0, 120);
		throw new CatalogError(`Search response is not JSON (status=${res.status}): ${preview}`);
	}

	const raw = data?.list;
	const items: any[] = Array.isArray(raw)
		? raw
		: raw && typeof raw === 'object'
			? Object.values(raw)
			: [];

	const results: SearchResult[] = items.map((it) => {
		const href = String(it.href ?? '');
		return {
			title: stripTags(String(it.wr_subject ?? '')),
			description: stripTags(String(it.sub_content ?? it.wr_content ?? '')),
			thumbnail: sealIf(String(it.wr_4 ?? '')),
			detailKey: sealUrl(href),
			category: String(it.board_name ?? ''),
			year: String(it.wr_6 ?? ''),
			synopsis: stripTags(String(it.wr_content ?? ''))
		};
	});

	return { query: q, count: results.length, results };
}

function stripTags(s: string): string {
	return s.replace(/<[^>]*>/g, '').trim();
}

// Episode page -> token endpoint -> final player URL (+ company).
export async function resolveStream(pageUrl: string): Promise<StreamSession> {
	const html = await fetchPage(pageUrl);
	const session = extractSession(html);
	if (!session) {
		throw new CatalogError('Unsupported player (session payload missing).');
	}

	const res = await request(TOKEN_ENDPOINT, {
		method: 'POST',
		headers: {
			...AJAX_HEADERS,
			'Content-Type': 'application/json',
			Origin: SOURCE_ORIGIN,
			Referer: pageUrl
		},
		body: JSON.stringify(session)
	});

	let data: any;
	try {
		data = await res.json();
	} catch {
		throw new CatalogError(`Session response parse failed (${res.status}).`);
	}

	if (!data?.success) {
		throw new CatalogError('Session creation failed: ' + JSON.stringify(data));
	}

	const playerUrl = normalizePlayerUrl(String(data.player_url));

	return {
		success: true,
		short_id: data.short_id,
		player_url: playerUrl,
		t: data.t,
		sig: data.sig,
		expires: data.expires,
		full: `${playerUrl}?t=${data.t}&sig=${data.sig}`,
		company: playerCompany(playerUrl)
	};
}
