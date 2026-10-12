import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createInstallPromptController, installPlatform, isStandalone } from '../src/lib/client/pwa-install.ts';
import { OFFLINE_ASSETS, pwaCacheAction } from '../src/lib/pwa-cache.ts';

function promptEvent(outcome: 'accepted' | 'dismissed', fail = false) {
	let calls = 0;
	const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
		prompt: async () => { calls++; if (fail) throw new Error('Prompt denied'); },
		userChoice: Promise.resolve({ outcome })
	});
	return { event, get calls() { return calls; } };
}

test('install prompt is deferred until a user action and consumed exactly once', async () => {
	const controller = createInstallPromptController();
	const prompt = promptEvent('accepted');
	assert.equal(await controller.request(), 'unavailable');
	assert.ok(controller.capture(prompt.event));
	assert.ok(prompt.event.defaultPrevented);
	assert.equal(prompt.calls, 0);
	assert.ok(controller.ready);
	const result = controller.request();
	assert.equal(prompt.calls, 1);
	assert.equal(controller.ready, false);
	assert.equal(await controller.request(), 'unavailable');
	assert.equal(await result, 'accepted');
});

test('dismissed and rejected prompts remain retryable only after a new browser event', async () => {
	const controller = createInstallPromptController();
	controller.capture(promptEvent('dismissed').event);
	assert.equal(await controller.request(), 'dismissed');
	controller.capture(promptEvent('accepted', true).event);
	await assert.rejects(controller.request(), /denied/);
	assert.equal(controller.ready, false);
	assert.equal(controller.capture(new Event('beforeinstallprompt')), false);
	controller.capture(promptEvent('accepted').event);
	controller.clear();
	assert.equal(controller.ready, false);
});

test('installation guidance handles iOS, desktop-mode iPad, Android and macOS Safari', () => {
	assert.equal(installPlatform('iPhone Safari'), 'ios');
	assert.equal(installPlatform('Macintosh Safari', 5), 'ios');
	assert.equal(installPlatform('Android Chrome Safari'), 'android');
	assert.equal(installPlatform('Macintosh Safari'), 'mac-safari');
	assert.equal(installPlatform('Macintosh Chrome Safari'), 'other');
	assert.equal(installPlatform('Windows Firefox'), 'other');
	assert.ok(isStandalone(true));
	assert.ok(isStandalone(false, true));
	assert.equal(isStandalone(false, false), false);
});

test('PWA cache bypasses health, POST, proxy images, media, tokens, queries and other origins', () => {
	const origin = 'https://app.example';
	const action = (path: string, method = 'GET', mode = 'cors') => pwaCacheAction({ url: new URL(path, origin).href, method, mode }, origin);
	for (const path of ['/api/service-status', '/api/search', '/api/episodes', '/api/session', '/api/img?key=secret', '/movie.m3u8', '/video.mp4', '/icons/icon-192.png?v=2', 'https://other.example/offline.css']) {
		assert.equal(action(path), 'network');
	}
	assert.equal(action('/api/img?key=secret', 'GET', 'navigate'), 'network');
	assert.equal(action('/offline.css', 'POST'), 'network');
	assert.equal(action('/offline.css', 'GET'), 'asset');
	assert.equal(action('/?bookmarkShare=ABCDEF#watch=key', 'GET', 'navigate'), 'navigation');
});

test('manifest has stable app identity, root launch, standalone mode and real required-size PNGs', () => {
	const manifest = JSON.parse(readFileSync(new URL('../static/manifest.webmanifest', import.meta.url), 'utf8'));
	assert.equal(manifest.id, '/');
	assert.equal(manifest.start_url, '/');
	assert.equal(manifest.scope, '/');
	assert.equal(manifest.display, 'standalone');
	assert.equal(manifest.prefer_related_applications, false);
	for (const size of [192, 512]) {
		const icon = manifest.icons.find((item: { sizes: string }) => item.sizes === `${size}x${size}`);
		assert.ok(icon);
		const png = readFileSync(new URL(`../static${icon.src}`, import.meta.url));
		assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
		assert.equal(png.readUInt32BE(16), size);
		assert.equal(png.readUInt32BE(20), size);
	}
	const apple = readFileSync(new URL('../static/icons/apple-touch-icon.png', import.meta.url));
	assert.equal(apple.readUInt32BE(16), 180);
	for (const path of OFFLINE_ASSETS) assert.ok(readFileSync(new URL(`../static${path}`, import.meta.url)).length > 0);
});
