import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServiceHealth, HEALTH_CACHE_MS, type HealthConfiguration } from '../src/lib/server/service-health.ts';
import type { ServiceStatus } from '../src/lib/service-status.ts';

const configuration: HealthConfiguration = {
	sourceOrigin: 'https://source.example', searchPath: '/bbs/search.php', tokenPath: '/api/create_session.php'
};
const healthy = () => Response.json({ list: [{ href: '/sisa/2829', wr_subject: 'A title' }] });
const withResponse = (response: () => Response) => createServiceHealth({
	configuration: () => configuration, fetcher: async () => response()
});

test('status verifies the configured search API using a small read-only query', async () => {
	const calls: string[] = [];
	const get = createServiceHealth({ configuration: () => configuration, fetcher: async (input, init) => {
		const url = new URL(String(input));
		calls.push(url.href);
		assert.equal(url.origin, configuration.sourceOrigin);
		assert.equal(url.pathname, configuration.searchPath);
		assert.equal(url.searchParams.get('srows'), '1');
		assert.equal(url.searchParams.get('sfl'), 'wr_subject');
		assert.equal(init?.method ?? 'GET', 'GET');
		assert.equal(init?.redirect, 'manual');
		assert.equal(new Headers(init?.headers).get('Origin'), configuration.sourceOrigin);
		assert.ok(init?.signal instanceof AbortSignal);
		return healthy();
	} });
	const result = await get();
	assert.equal(result.state, 'available');
	assert.equal(result.reason, 'ok');
	assert.equal(calls.length, 1); // No playback session or media CDN request.
});

test('empty arrays and object-form search results are healthy, not an outage', async () => {
	for (const list of [[], {}, { one: { href: '/drama/1', wr_subject: 'Title' } }]) {
		assert.equal((await withResponse(() => Response.json({ list }))()).state, 'available');
	}
});

test('an HTTP 200 maintenance page or unexpected JSON never reports healthy', async () => {
	for (const data of ['<html>Maintenance</html>', '{}', 'null', '[]', '{"success":true}', '{"list":null}', '{"list":"unavailable"}']) {
		const result = await withResponse(() => new Response(data))();
		assert.equal(result.state, 'unavailable');
		assert.equal(result.reason, 'response');
	}
});

test('negative responses and invalid search items are rejected', async () => {
	for (const data of [
		{ list: [], success: false }, { list: [], error: 'Unavailable' },
		{ list: [null] }, { list: [{ href: '/sisa/1' }] },
		{ list: [{ href: 'https://unrelated.example/sisa/1', wr_subject: 'Title' }] },
		{ list: [{ href: 'https://user:password@source.example/sisa/1', wr_subject: 'Title' }] },
		{ list: [{ href: 'javascript:alert(1)', wr_subject: 'Title' }] }
	]) assert.equal((await withResponse(() => Response.json(data))()).reason, 'response');
});

test('HTTP errors and upstream rate limits report unavailability', async () => {
	for (const status of [403, 404, 429, 500, 502, 503]) {
		const result = await withResponse(() => new Response('Error', { status }))();
		assert.equal(result.state, 'unavailable');
		assert.equal(result.reason, 'upstream');
	}
});

test('DNS, connection and TLS failures are sanitized', async () => {
	const get = createServiceHealth({ configuration: () => configuration, fetcher: async () => {
		throw new Error('getaddrinfo ENOTFOUND secret.source.example token=do-not-expose');
	} });
	const result = await get();
	assert.equal(result.reason, 'connection');
	assert.equal(JSON.stringify(result).includes('source.example'), false);
	assert.equal(JSON.stringify(result).includes('token'), false);
});

test('malformed host/path configuration fails without making network calls', async () => {
	for (const changes of [
		{ sourceOrigin: '' }, { sourceOrigin: 'not-a-host' }, { sourceOrigin: 'file:///tmp/data' },
		{ sourceOrigin: 'https://user:password@source.example' }, { sourceOrigin: 'https://source.example/sisa/1' },
		{ searchPath: '' }, { searchPath: '//other.example/search' }, { searchPath: '/\\other.example/search' },
		{ searchPath: '/search?secret=value' }, { tokenPath: '' },
		{ playerOrigin: 'https://player.example/path' }
	]) {
		let calls = 0;
		const get = createServiceHealth({ configuration: () => ({ ...configuration, ...changes }), fetcher: async () => {
			calls++; return healthy();
		} });
		assert.equal((await get()).reason, 'configuration');
		assert.equal(calls, 0);
	}
});

test('planned maintenance is explicit and performs no upstream requests', async () => {
	const get = createServiceHealth({ configuration: () => ({ maintenance: true }), fetcher: async () => {
		throw new Error('Must not probe.');
	} });
	const status = await get();
	assert.equal(status.state, 'maintenance');
	assert.equal(status.reason, 'maintenance');
});

test('same-origin redirects are allowed with a strict redirect limit', async () => {
	let calls = 0;
	const get = createServiceHealth({ configuration: () => configuration, fetcher: async (input) => {
		calls++;
		if (calls === 1) return new Response(null, { status: 302, headers: { Location: '/new-search' } });
		assert.equal(new URL(String(input)).pathname, '/new-search');
		return healthy();
	} });
	assert.equal((await get()).state, 'available');
	assert.equal(calls, 2);
});

test('a redirected new domain is never adopted or fetched automatically', async () => {
	let calls = 0;
	const get = createServiceHealth({ configuration: () => configuration, fetcher: async () => {
		calls++;
		return new Response(null, { status: 302, headers: { Location: 'https://new.example/search' } });
	} });
	assert.equal((await get()).reason, 'response');
	assert.equal(calls, 1);
});

test('redirect loops stop after three requests', async () => {
	let calls = 0;
	const get = createServiceHealth({ configuration: () => configuration, fetcher: async () => {
		calls++; return new Response(null, { status: 301, headers: { Location: '/loop' } });
	} });
	assert.equal((await get()).state, 'unavailable');
	assert.equal(calls, 3);
});

test('the optional player host uses HEAD without requesting session tokens', async () => {
	for (const status of [200, 401, 403, 404, 405]) {
		const get = createServiceHealth({ configuration: () => ({ ...configuration, playerOrigin: 'https://player.example' }), fetcher: async (input, init) => {
			if (new URL(String(input)).hostname === 'player.example') {
				assert.equal(init?.method, 'HEAD');
				assert.equal(new URL(String(input)).search, '');
				return new Response(null, { status });
			}
			return healthy();
		} });
		assert.equal((await get()).state, 'available');
	}
});

test('a player host DNS failure or server failure is detected', async () => {
	for (const failure of [new Error('DNS failure'), 503, 429]) {
		const get = createServiceHealth({ configuration: () => ({ ...configuration, playerOrigin: 'https://player.example' }), fetcher: async (input) => {
			if (new URL(String(input)).hostname !== 'player.example') return healthy();
			if (failure instanceof Error) throw failure;
			return new Response(null, { status: failure });
		} });
		assert.equal((await get()).state, 'unavailable');
	}
});

test('oversized responses are bounded for both Content-Length and streamed bodies', async () => {
	for (const make of [() => new Response('x', { headers: { 'Content-Length': '512001' } }), () => new Response('x'.repeat(512_001))]) {
		assert.equal((await withResponse(make)()).reason, 'response');
	}
});

test('a hung request is bounded by the probe timeout and its signal is aborted', async () => {
	let signal: AbortSignal | null | undefined;
	const get = createServiceHealth({ configuration: () => configuration, timeoutMs: 5, fetcher: async (_, init) => {
		signal = init?.signal;
		return new Promise<Response>(() => {});
	} });
	assert.equal((await get()).reason, 'connection');
	assert.equal(signal?.aborted, true);
});

test('concurrent visitors and manual retry share one cached probe per process', async () => {
	let now = 10_000;
	let calls = 0;
	let finish!: (response: Response) => void;
	const get = createServiceHealth({ configuration: () => configuration, now: () => now, fetcher: async () => {
		calls++;
		return new Promise<Response>((resolve) => { finish = resolve; });
	} });
	const first = get();
	const second = get();
	finish(healthy());
	const [a, b] = await Promise.all([first, second]);
	assert.equal(calls, 1);
	assert.deepEqual(a, b);
	a.state = 'unavailable';
	now += HEALTH_CACHE_MS - 1;
	assert.equal((await get()).state, 'available');
	assert.equal(calls, 1);
});

test('an outage recovers automatically after cache expiration and logs only transitions', async () => {
	let now = 1_000;
	let up = false;
	const changes: ServiceStatus[] = [];
	const get = createServiceHealth({ configuration: () => configuration, now: () => now, onChange: (status) => changes.push(status), fetcher: async () => {
		if (!up) throw new Error('Offline');
		return healthy();
	} });
	assert.equal((await get()).state, 'unavailable');
	now += HEALTH_CACHE_MS;
	await get();
	assert.equal(changes.length, 1);
	up = true;
	now += HEALTH_CACHE_MS;
	assert.equal((await get()).state, 'available');
	assert.deepEqual(changes.map((value) => value.state), ['unavailable', 'available']);
	assert.equal(JSON.stringify(changes).includes('source.example'), false);
});

test('operator configuration changes invalidate a cached failure or maintenance state immediately', async () => {
	let current: HealthConfiguration = { ...configuration, sourceOrigin: '' };
	const get = createServiceHealth({ configuration: () => current, fetcher: async () => healthy() });
	assert.equal((await get()).reason, 'configuration');
	current = { ...configuration, maintenance: true };
	assert.equal((await get()).state, 'maintenance');
	current = configuration;
	assert.equal((await get()).state, 'available');
});

test('a late response from an old configuration does not overwrite the new configuration cache', async () => {
	let current = { ...configuration };
	let finish!: (response: Response) => void;
	let calls = 0;
	const get = createServiceHealth({ configuration: () => current, fetcher: async () => {
		calls++;
		return calls === 1 ? new Promise<Response>((resolve) => { finish = resolve; }) : healthy();
	} });
	const old = get();
	current = { ...configuration, searchPath: '/new-search' };
	assert.equal((await get()).state, 'available');
	finish(new Response('Offline', { status: 503 }));
	await old;
	assert.equal((await get()).state, 'available');
	assert.equal(calls, 2);
});
