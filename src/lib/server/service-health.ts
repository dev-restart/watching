import { STATUS_POLL_MS, type ServiceStatus } from '../service-status.ts';

export const HEALTH_CACHE_MS = 15_000;
const MAX_BODY_BYTES = 512_000;

type Reason = ServiceStatus['reason'];
export interface HealthConfiguration {
	sourceOrigin?: string;
	searchPath?: string;
	tokenPath?: string;
	playerOrigin?: string;
	maintenance?: boolean;
}

class ProbeFailure extends Error {
	readonly reason: Reason;
	constructor(reason: Reason) {
		super(reason);
		this.reason = reason;
	}
}

function origin(raw: string | undefined): URL {
	try {
		const url = new URL(raw || '');
		if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
			url.pathname !== '/' || url.search || url.hash) throw new Error();
		return url;
	} catch { throw new ProbeFailure('configuration'); }
}

function endpoint(base: URL, path: string | undefined): URL {
	if (!path || !path.startsWith('/') || path.startsWith('//') || /[\\\s?#]/.test(path)) {
		throw new ProbeFailure('configuration');
	}
	const url = new URL(path, base);
	if (url.origin !== base.origin) throw new ProbeFailure('configuration');
	return url;
}

/** Bounded same-origin redirects only. A new host requires an operator configuration change. */
async function request(url: URL, init: RequestInit, fetcher: typeof fetch): Promise<Response> {
	let target = url;
	for (let redirects = 0; redirects <= 2; redirects++) {
		const response = await fetcher(target.href, { ...init, redirect: 'manual' });
		if (![301, 302, 303, 307, 308].includes(response.status)) return response;
		const location = response.headers.get('location');
		await response.body?.cancel();
		if (!location || redirects === 2) throw new ProbeFailure('response');
		const next = new URL(location, target);
		if (next.origin !== url.origin || next.username || next.password) throw new ProbeFailure('response');
		target = next;
	}
	throw new ProbeFailure('response');
}

async function readText(response: Response): Promise<string> {
	if (!response.ok) {
		await response.body?.cancel();
		throw new ProbeFailure('upstream');
	}
	if (Number(response.headers.get('content-length')) > MAX_BODY_BYTES) {
		await response.body?.cancel();
		throw new ProbeFailure('response');
	}
	const reader = response.body?.getReader();
	if (!reader) throw new ProbeFailure('response');
	let bytes = 0;
	let text = '';
	const decoder = new TextDecoder();
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) return text + decoder.decode();
			bytes += chunk.value.byteLength;
			if (bytes > MAX_BODY_BYTES) throw new ProbeFailure('response');
			text += decoder.decode(chunk.value, { stream: true });
		}
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

function validateSearch(text: string, base: URL): void {
	try {
		const value: unknown = JSON.parse(text);
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
		const data = value as Record<string, unknown>;
		if (data.success === false || data.error || !data.list || typeof data.list !== 'object') throw new Error();
		const rows: unknown[] = Array.isArray(data.list) ? data.list : Object.values(data.list);
		// An empty, well-formed result is valid: not every title/query has matches.
		for (const row of rows) {
			if (!row || typeof row !== 'object') throw new Error();
			const item = row as Record<string, unknown>;
			if (typeof item.href !== 'string' || !item.href || typeof item.wr_subject !== 'string') throw new Error();
			const link = new URL(item.href, base);
			if (link.origin !== base.origin || link.username || link.password) throw new Error();
		}
	} catch { throw new ProbeFailure('response'); }
}

async function probe(config: HealthConfiguration, fetcher: typeof fetch, timeoutMs: number): Promise<Reason> {
	if (config.maintenance) return 'maintenance';
	let source: URL;
	let search: URL;
	let player: URL | undefined;
	try {
		source = origin(config.sourceOrigin);
		search = endpoint(source, config.searchPath);
		endpoint(source, config.tokenPath); // Validate only: a probe must never create playback sessions.
		player = config.playerOrigin ? origin(config.playerOrigin) : undefined;
	} catch { return 'configuration'; }
	search.search = new URLSearchParams({ sfl: 'wr_subject', stx: 'a', srows: '1' }).toString();
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const headers = {
		'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
		Accept: 'application/json, text/javascript, */*; q=0.01',
		'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
		'X-Requested-With': 'XMLHttpRequest', Referer: source.href, Origin: source.origin
	};
	try {
		await Promise.race([
			Promise.all([
				(async () => {
					const response = await request(search, { headers, signal: controller.signal }, fetcher);
					validateSearch(await readText(response), source);
				})(),
				...(player ? [(async () => {
					const response = await request(player, { method: 'HEAD', signal: controller.signal }, fetcher);
					await response.body?.cancel();
					// Player roots often return 401/403/404/405 without a session. This checks
					// host reachability, not successful video playback or a media CDN.
					if (response.status >= 500 || response.status === 429) throw new ProbeFailure('upstream');
				})()] : [])
			]),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => { controller.abort(); reject(new ProbeFailure('connection')); }, timeoutMs);
			})
		]);
		return 'ok';
	} catch (error) {
		return error instanceof ProbeFailure ? error.reason : 'connection';
	} finally {
		clearTimeout(timer);
		controller.abort();
	}
}

/** Shared per server process: concurrent visitors share one probe; Retry cannot bypass the cache.
 * No MongoDB, source-page tokens or environment reads are required by this testable core.
 */
export function createServiceHealth(options: {
	configuration: () => HealthConfiguration;
	fetcher?: typeof fetch;
	now?: () => number;
	timeoutMs?: number;
	onChange?: (status: ServiceStatus) => void;
}) {
	const now = options.now ?? Date.now;
	let cached: { key: string; value: ServiceStatus } | undefined;
	let pending: { key: string; promise: Promise<ServiceStatus> } | undefined;
	let latestKey = '';
	let lastState = '';
	return async function getStatus(): Promise<ServiceStatus> {
		const configuration = options.configuration();
		const key = JSON.stringify(configuration);
		latestKey = key;
		if (cached?.key === key && now() - cached.value.checkedAt < HEALTH_CACHE_MS) return { ...cached.value };
		if (pending?.key === key) return { ...await pending.promise };
		const promise = (async (): Promise<ServiceStatus> => {
			const reason = await probe(configuration, options.fetcher ?? fetch, options.timeoutMs ?? 8_000);
			const value: ServiceStatus = {
				state: reason === 'ok' ? 'available' : reason === 'maintenance' ? 'maintenance' : 'unavailable',
				reason, checkedAt: now(), retryAfterMs: STATUS_POLL_MS
			};
			if (latestKey === key) {
				cached = { key, value };
				const state = `${value.state}:${reason}`;
				if (state !== lastState) { lastState = state; options.onChange?.({ ...value }); }
			}
			return value;
		})();
		pending = { key, promise };
		try { return { ...await promise }; }
		finally { if (pending?.promise === promise) pending = undefined; }
	};
}
