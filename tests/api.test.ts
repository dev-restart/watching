import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { API_ACCESS_REFRESHED_CODE } from '../src/lib/api-access.ts';
import { ApiError, postJson } from '../src/lib/client/api.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

test('postJson retries once after the API access cookie is refreshed', async () => {
	let requestCount = 0;
	globalThis.fetch = async () => {
		requestCount += 1;
		if (requestCount === 1) {
			return Response.json(
				{ code: API_ACCESS_REFRESHED_CODE, message: 'API access was refreshed.' },
				{ status: 401 }
			);
		}
		return Response.json({ ok: true });
	};

	assert.deepEqual(await postJson<{ ok: boolean }>('/api/search', { query: 'test' }), { ok: true });
	assert.equal(requestCount, 2);
});

test('postJson does not retry an unrelated unauthorized response', async () => {
	let requestCount = 0;
	globalThis.fetch = async () => {
		requestCount += 1;
		return Response.json({ message: 'Unauthorized.' }, { status: 401 });
	};

	await assert.rejects(
		postJson('/api/search', { query: 'test' }),
		(error: unknown) => error instanceof ApiError && error.status === 401
	);
	assert.equal(requestCount, 1);
});

test('postJson stops after one API access retry', async () => {
	let requestCount = 0;
	globalThis.fetch = async () => {
		requestCount += 1;
		return Response.json(
			{ code: API_ACCESS_REFRESHED_CODE, message: 'API access was refreshed.' },
			{ status: 401 }
		);
	};

	await assert.rejects(
		postJson('/api/search', { query: 'test' }),
		(error: unknown) => error instanceof ApiError && error.status === 401
	);
	assert.equal(requestCount, 2);
});
