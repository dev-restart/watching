import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { API_ACCESS_REFRESHED_CODE } from '../src/lib/api-access.ts';
import { loadEpisodes } from '../src/lib/client/api.ts';
import {
	copyDetailShareLink,
	createDetailShareUrl,
	readDetailShare,
	withoutDetailShare
} from '../src/lib/client/detail-sharing.ts';

const detailKey = `v1.${'Abcd_123-'.repeat(12)}`;
const originalFetch = globalThis.fetch;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

afterEach(() => {
	globalThis.fetch = originalFetch;
	for (const [name, descriptor] of [
		['navigator', originalNavigator],
		['document', originalDocument]
	] as const) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	}
});

test('detail links round-trip the opaque key without changing ordinary navigation', () => {
	const currentUrl = 'https://watching.example/';
	const shared = new URL(createDetailShareUrl(detailKey, currentUrl));
	assert.equal(shared.origin, 'https://watching.example');
	assert.equal(shared.pathname, '/');
	assert.equal(shared.search, '');
	assert.deepEqual(readDetailShare(shared.hash), { kind: 'detail', detailKey });
	assert.equal(currentUrl, 'https://watching.example/');
});

test('sharing drops old share links, credentials and unrelated query parameters', () => {
	const shared = new URL(createDetailShareUrl(detailKey,
		'https://sender:password@watching.example/app/?bookmarkShare=ABC123&search=private#watch=old&extra=value'));
	assert.equal(shared.username, '');
	assert.equal(shared.password, '');
	assert.equal(shared.pathname, '/app/');
	assert.equal(shared.search, '');
	assert.deepEqual([...new URLSearchParams(shared.hash.slice(1))], [['watch', detailKey]]);
});

test('the running app origin, port and base path are preserved', () => {
	const shared = new URL(createDetailShareUrl(detailKey, 'http://localhost:5173/player/'));
	assert.equal(shared.origin, 'http://localhost:5173');
	assert.equal(shared.pathname, '/player/');
});

test('legacy encrypted detail keys supported by the API can also be shared', () => {
	const legacy = 'abcDEF_012-'.repeat(8);
	const shared = new URL(createDetailShareUrl(legacy, 'https://watching.example/'));
	assert.deepEqual(readDetailShare(shared.hash), { kind: 'detail', detailKey: legacy });
});

test('ordinary anchors and bookmark sharing are not treated as video links', () => {
	for (const hash of ['', '#', '#episodes', '#bookmarkShare=ABC123']) {
		assert.deepEqual(readDetailShare(hash), { kind: 'none' });
	}
});

test('incomplete, malformed, duplicate and raw-URL detail links are rejected', () => {
	for (const hash of [
		'#watch=', '#watch=short', '#watch=%ZZ', '#watch=%00',
		`#watch=${detailKey}&watch=${detailKey}`,
		`#watch=v2.${'a'.repeat(80)}`,
		`#watch=${detailKey}%20`, `#watch=${detailKey}%0A`, `#watch=${detailKey}%0D`,
		`#watch=${detailKey}\n`,
		'#watch=https%3A%2F%2Funtrusted.example%2Fvideo',
		'#watch=%3Cscript%3Ealert(1)%3C%2Fscript%3E'
	]) {
		assert.deepEqual(readDetailShare(hash), { kind: 'invalid' }, hash);
	}
});

test('detail link validation matches the API maximum key length', () => {
	const largestKey = `v1.${'a'.repeat(4093)}`;
	assert.deepEqual(readDetailShare(`#watch=${largestKey}`), { kind: 'detail', detailKey: largestKey });
	assert.deepEqual(readDetailShare(`#watch=${largestKey}a`), { kind: 'invalid' });
	assert.throws(() => createDetailShareUrl(`${largestKey}a`, 'https://watching.example/'));
});

test('invalid keys and non-web app URLs cannot generate share links', () => {
	assert.throws(() => createDetailShareUrl('https://source.example/', 'https://watching.example/'));
	assert.throws(() => createDetailShareUrl(detailKey, 'javascript:alert(1)'));
	assert.throws(() => createDetailShareUrl(detailKey, 'file:///index.html'));
});

test('leaving a shared detail clears only the watch fragment', () => {
	const cleared = withoutDetailShare(`https://watching.example/?bookmarkShare=ABC123#watch=${detailKey}&section=info`);
	assert.equal(cleared.search, '?bookmarkShare=ABC123');
	assert.equal(cleared.hash, '#section=info');
	assert.equal(withoutDetailShare(`https://watching.example/#watch=${detailKey}`).href, 'https://watching.example/');
});

test('ordinary navigation and unrelated anchors are left unchanged', () => {
	for (const url of ['https://watching.example/', 'https://watching.example/?bookmarkShare=ABC123#episodes']) {
		assert.equal(withoutDetailShare(url).href, url);
	}
});

test('a recipient can load the shared detail through the existing API without searching or playback', async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input, init) => {
		requests.push(String(input));
		assert.equal(init?.method, 'POST');
		assert.deepEqual(JSON.parse(String(init?.body)), { key: detailKey });
		if (requests.length === 1) {
			return Response.json({ code: API_ACCESS_REFRESHED_CODE }, { status: 401 });
		}
		return Response.json({ contentId: 'shared-title', series: 'Shared title', episodes: [] });
	};
	const target = readDetailShare(new URL(createDetailShareUrl(detailKey, 'https://watching.example/')).hash);
	assert.equal(target.kind, 'detail');
	if (target.kind !== 'detail') throw new Error('Expected a detail target.');
	const result = await loadEpisodes(target.detailKey);
	assert.equal(result.series, 'Shared title');
	assert.deepEqual(requests, ['/api/episodes', '/api/episodes']);
});

function inputField() {
	const calls: string[] = [];
	const input = {
		value: createDetailShareUrl(detailKey, 'https://watching.example/'),
		isConnected: true,
		focus() { calls.push('focus'); },
		select() { calls.push('select'); },
		setSelectionRange(start: number, end: number) {
			assert.equal(start, 0);
			assert.equal(end, this.value.length);
			calls.push('range');
		}
	};
	return { input: input as unknown as HTMLInputElement, calls };
}

function clipboardEnvironment(writeText?: (text: string) => Promise<void>, execCommand?: (command: string) => boolean) {
	Object.defineProperty(globalThis, 'navigator', {
		value: { clipboard: writeText ? { writeText } : undefined }, configurable: true
	});
	Object.defineProperty(globalThis, 'document', {
		value: { execCommand }, configurable: true
	});
}

test('copying writes the complete URL and resolves only after clipboard success', async () => {
	const { input, calls } = inputField();
	let finish!: () => void;
	let copied = false;
	clipboardEnvironment(async (text) => {
		assert.equal(text, input.value);
		await new Promise<void>((resolve) => { finish = resolve; });
	}, () => { throw new Error('Fallback should not run.'); });
	const pending = copyDetailShareLink(input).then(() => { copied = true; });
	await Promise.resolve();
	assert.equal(copied, false);
	finish();
	await pending;
	assert.equal(copied, true);
	assert.deepEqual(calls, []);
});

test('copying falls back to the selected field when the modern API is unavailable', async () => {
	const { input, calls } = inputField();
	clipboardEnvironment(undefined, (command) => {
		assert.equal(command, 'copy');
		assert.deepEqual(calls, ['focus', 'select', 'range']);
		return true;
	});
	await copyDetailShareLink(input);
});

test('copying can recover from a clipboard permission rejection through the fallback', async () => {
	const { input, calls } = inputField();
	clipboardEnvironment(async () => { throw new DOMException('Denied', 'NotAllowedError'); }, () => true);
	await copyDetailShareLink(input);
	assert.deepEqual(calls, ['focus', 'select', 'range']);
});

test('failed copying rejects and leaves the URL selected instead of reporting success', async () => {
	const { input, calls } = inputField();
	clipboardEnvironment(async () => { throw new Error('Denied'); }, () => false);
	await assert.rejects(copyDetailShareLink(input), /Copy the selected link manually/);
	assert.deepEqual(calls, ['focus', 'select', 'range']);
});

test('browsers without either clipboard implementation get a manual-copy error', async () => {
	const { input } = inputField();
	clipboardEnvironment();
	await assert.rejects(copyDetailShareLink(input), /Unable to copy automatically/);
});

test('a throwing legacy copy implementation still returns the actionable error', async () => {
	const { input } = inputField();
	clipboardEnvironment(undefined, () => { throw new Error('Not supported'); });
	await assert.rejects(copyDetailShareLink(input), /Copy the selected link manually/);
});

test('a dismissed modal cannot start a fallback copy against a disconnected input', async () => {
	const { input, calls } = inputField();
	Object.defineProperty(input, 'isConnected', { value: false });
	clipboardEnvironment(undefined, () => { throw new Error('Fallback must not run.'); });
	await assert.rejects(copyDetailShareLink(input), /Unable to copy automatically/);
	assert.deepEqual(calls, []);
});
