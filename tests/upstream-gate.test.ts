import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUpstreamGate, isUpstreamRequest } from '../src/lib/server/upstream-gate.ts';
import { createServiceHealth } from '../src/lib/server/service-health.ts';
import type { ServiceStatus } from '../src/lib/service-status.ts';

const status = (state: ServiceStatus['state']): ServiceStatus => ({
	state, reason: state === 'available' ? 'ok' : state === 'maintenance' ? 'maintenance' : 'connection',
	checkedAt: 1_000, retryAfterMs: 30_000
});

test('gate covers upstream methods only, including trailing slashes and image HEAD', () => {
	for (const path of ['/api/search', '/api/episodes', '/api/session', '/api/search/']) assert.ok(isUpstreamRequest('POST', path));
	assert.ok(isUpstreamRequest('GET', '/api/img'));
	assert.ok(isUpstreamRequest('HEAD', '/api/img'));
	for (const path of ['/api/service-status', '/api/bookmark-shares', '/api/analytics', '/manifest.webmanifest', '/']) {
		assert.equal(isUpstreamRequest('POST', path), false);
		assert.equal(isUpstreamRequest('GET', path), false);
	}
	assert.equal(isUpstreamRequest('GET', '/api/search'), false);
	assert.equal(isUpstreamRequest('POST', '/api/img'), false);
});

test('healthy requests pass and excluded endpoints do not probe at all', async () => {
	let checks = 0;
	const gate = createUpstreamGate(async () => { checks++; return status('available'); });
	assert.equal(await gate('POST', '/api/service-status'), null);
	assert.equal(checks, 0);
	assert.equal(await gate('POST', '/api/search'), null);
	assert.equal(checks, 1);
});

test('outage and planned maintenance reject new work with a non-cacheable 503 and retry interval', async () => {
	for (const state of ['unavailable', 'maintenance'] as const) {
		const gate = createUpstreamGate(async () => status(state));
		const response = await gate('POST', '/api/session');
		assert.equal(response?.status, 503);
		assert.equal(response?.headers.get('retry-after'), '30');
		assert.equal(response?.headers.get('cache-control'), 'private, no-store');
		const body = await response!.json();
		assert.equal(body.code, 'SERVICE_UNAVAILABLE');
		assert.deepEqual(body.serviceStatus, status(state));
		assert.equal(body.message.includes('점검'), state === 'maintenance');
	}
});

test('unexpected checker errors fail closed without leaking their content or inventing an upstream diagnosis', async () => {
	const gate = createUpstreamGate(async () => { throw new Error('private-host-token'); });
	const response = await gate('POST', '/api/episodes');
	assert.equal(response?.status, 503);
	const body = await response!.json();
	assert.equal(body.code, 'SERVICE_CHECK_FAILED');
	assert.equal('serviceStatus' in body, false);
	assert.equal(JSON.stringify(body).includes('private-host-token'), false);
});

test('status and API requests share a coalesced probe, cache and recovery', async () => {
	let now = 1_000;
	let probes = 0;
	let healthy = false;
	const check = createServiceHealth({
		configuration: () => ({ sourceOrigin: 'https://source.example', searchPath: '/search', tokenPath: '/token' }),
		now: () => now,
		fetcher: async () => { probes++; return healthy ? Response.json({ list: [] }) : new Response('down', { status: 503 }); }
	});
	const gate = createUpstreamGate(check);
	const responses = await Promise.all([check(), gate('POST', '/api/search'), gate('POST', '/api/session')]);
	assert.equal(probes, 1);
	assert.equal((responses[1] as Response).status, 503);
	healthy = true;
	assert.equal((await gate('POST', '/api/session'))?.status, 503);
	now += 15_001;
	assert.equal(await gate('POST', '/api/session'), null);
	assert.equal(probes, 2);
});
