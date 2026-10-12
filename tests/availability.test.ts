import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createAvailabilityMonitor } from '../src/lib/client/availability.ts';
import { initialAvailability, parseServiceStatus, requestServiceRecheck, reportServiceBlocked, shouldOpenStatusDialog, STATUS_BLOCKED_EVENT, STATUS_RECHECK_EVENT, type AvailabilityView, type ServiceStatus } from '../src/lib/service-status.ts';
import { postJson } from '../src/lib/client/api.ts';

type Timer = ReturnType<typeof setTimeout>;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
	else Reflect.deleteProperty(globalThis, 'window');
});
const status = (state: ServiceStatus['state'] = 'available'): ServiceStatus => ({
	state, reason: state === 'available' ? 'ok' : state === 'maintenance' ? 'maintenance' : 'connection', checkedAt: 10_000, retryAfterMs: 30_000
});
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness(check: (signal: AbortSignal) => Promise<unknown> = async () => status()) {
	let now = 10_000;
	let online = true;
	let visible = true;
	let nextTimer = 0;
	let calls = 0;
	let view = initialAvailability();
	const views: AvailabilityView[] = [];
	const timers = new Map<Timer, { at: number; callback: () => void }>();
	const monitor = createAvailabilityMonitor({
		check: (signal) => { calls++; return check(signal); },
		onChange: (next) => { view = next; views.push(next); },
		online: () => online, visible: () => visible, now: () => now,
		setTimer: (callback, delay) => {
			const id = (++nextTimer) as unknown as Timer;
			timers.set(id, { at: now + delay, callback });
			return id;
		},
		clearTimer: (id) => { timers.delete(id); }
	});
	return {
		monitor, views,
		get view() { return view; },
		get calls() { return calls; },
		get timerCount() { return timers.size; },
		setOnline(value: boolean) { online = value; },
		setVisible(value: boolean) { visible = value; },
		async advance(ms: number) {
			const until = now + ms;
			for (let safety = 0; safety < 100; safety++) {
				const due = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
				if (!due) break;
				now = due[1].at;
				timers.delete(due[0]);
				due[1].callback();
				await flush();
			}
			now = until;
			await flush();
		}
	};
}

test('status payloads are validated and unexpected private fields are discarded', () => {
	assert.deepEqual(parseServiceStatus({ ...status(), sourceOrigin: 'https://private.example', token: 'secret' }), status());
	for (const invalid of [null, [], {}, { ...status(), state: 'unknown' }, { ...status(), reason: 'connection' },
		{ ...status(), state: ['available'] }, { ...status(), reason: ['ok'] },
		{ ...status(), checkedAt: '100' }, { ...status(), retryAfterMs: 0 }, { ...status(), retryAfterMs: Infinity },
		{ ...status('maintenance'), reason: 'ok' }, { ...status('unavailable'), reason: 'maintenance' }]) {
		assert.throws(() => parseServiceStatus(invalid));
	}
});

test('initial state stays checking until the status response has been validated', async () => {
	let finish!: (value: unknown) => void;
	const h = harness(async () => new Promise((resolve) => { finish = resolve; }));
	const pending = h.monitor.refresh();
	assert.equal(h.view.state, 'checking');
	assert.equal(h.view.checking, true);
	finish(status());
	await pending;
	assert.equal(h.view.state, 'available');
	assert.equal(h.view.checking, false);
	assert.equal(h.view.retryAt, 40_000);
	h.monitor.stop();
});

test('automatic polling restores availability without a page reload or user action', async () => {
	let up = false;
	const h = harness(async () => status(up ? 'available' : 'unavailable'));
	await h.monitor.refresh();
	assert.equal(h.view.state, 'unavailable');
	up = true;
	await h.advance(30_000);
	assert.equal(h.view.state, 'available');
	assert.equal(h.calls, 2);
	h.monitor.stop();
});

test('planned maintenance returns to available only after the server confirms recovery', async () => {
	let current: ServiceStatus['state'] = 'maintenance';
	const h = harness(async () => status(current));
	await h.monitor.refresh();
	assert.equal(h.view.state, 'maintenance');
	current = 'available';
	await h.advance(30_000);
	assert.equal(h.view.state, 'available');
	h.monitor.stop();
});

test('offline status avoids requests and online revalidates rather than assuming recovery', async () => {
	const h = harness(async () => status('unavailable'));
	h.setOnline(false);
	await h.monitor.environmentChanged();
	assert.equal(h.view.state, 'offline');
	assert.equal(h.calls, 0);
	assert.equal(h.timerCount, 0);
	h.setOnline(true);
	await h.monitor.environmentChanged();
	assert.equal(h.calls, 1);
	assert.equal(h.view.state, 'unavailable');
	h.monitor.stop();
});

test('hidden tabs stop polling and check again when visible', async () => {
	const h = harness();
	await h.monitor.refresh();
	h.setVisible(false);
	await h.monitor.environmentChanged();
	assert.equal(h.timerCount, 0);
	await h.advance(120_000);
	assert.equal(h.calls, 1);
	h.setVisible(true);
	await h.monitor.environmentChanged();
	assert.equal(h.calls, 2);
	h.monitor.stop();
});

test('periodic checks do not briefly replace an available screen with a checking screen', async () => {
	let finish!: (value: unknown) => void;
	let first = true;
	const h = harness(async () => {
		if (first) { first = false; return status(); }
		return new Promise((resolve) => { finish = resolve; });
	});
	await h.monitor.refresh();
	await h.advance(30_000);
	assert.equal(h.view.state, 'available');
	assert.equal(h.view.checking, true);
	finish(status());
	await flush();
	h.monitor.stop();
});

test('status API transport errors show unknown, not a fabricated upstream diagnosis', async () => {
	const h = harness(async () => { throw new Error('Our app API is offline'); });
	await h.monitor.refresh();
	assert.equal(h.view.state, 'unknown');
	assert.equal(h.view.checking, false);
	assert.equal(h.view.retryAt, 40_000);
	h.monitor.stop();
});

test('malformed successful status responses do not restore a broken service', async () => {
	const h = harness(async () => ({ state: 'available' }));
	await h.monitor.refresh();
	assert.equal(h.view.state, 'unknown');
	h.monitor.stop();
});

test('a stalled status endpoint has a finite watchdog and stays retryable', async () => {
	let signal: AbortSignal | undefined;
	const h = harness(async (input) => { signal = input; return new Promise(() => {}); });
	const pending = h.monitor.refresh();
	await h.advance(12_000);
	await pending;
	assert.equal(signal?.aborted, true);
	assert.equal(h.view.state, 'unknown');
	assert.equal(h.view.checking, false);
	assert.equal(h.view.retryAt, 52_000);
	h.monitor.stop();
});

test('rapid manual retries are throttled and never overlap an active request', async () => {
	let finish!: (value: unknown) => void;
	let first = true;
	const h = harness(async () => {
		if (first) { first = false; return new Promise((resolve) => { finish = resolve; }); }
		return status();
	});
	const pending = h.monitor.refresh();
	await h.monitor.refresh();
	await h.monitor.refresh();
	assert.equal(h.calls, 1);
	finish(status());
	await pending;
	await h.monitor.refresh();
	assert.equal(h.calls, 1);
	await h.advance(5_000);
	assert.equal(h.calls, 2);
	h.monitor.stop();
});

test('an old response arriving after going offline cannot overwrite the offline screen', async () => {
	let finish!: (value: unknown) => void;
	let signal: AbortSignal | undefined;
	const h = harness(async (input) => { signal = input; return new Promise((resolve) => { finish = resolve; }); });
	const pending = h.monitor.refresh();
	h.setOnline(false);
	await h.monitor.environmentChanged();
	finish(status());
	await pending;
	assert.equal(signal?.aborted, true);
	assert.equal(h.view.state, 'offline');
	assert.equal(h.timerCount, 0);
	h.monitor.stop();
});

test('unmount cancels timers, aborts requests and ignores late responses', async () => {
	let finish!: (value: unknown) => void;
	const h = harness(async () => new Promise((resolve) => { finish = resolve; }));
	const pending = h.monitor.refresh();
	const count = h.views.length;
	h.monitor.stop();
	finish(status());
	await pending;
	await h.advance(120_000);
	assert.equal(h.views.length, count);
	assert.equal(h.timerCount, 0);
	assert.equal(h.calls, 1);
});

test('a validated gate failure blocks immediately and supersedes a stale in-flight success', async () => {
	let finish!: (value: unknown) => void;
	const h = harness(async () => new Promise((resolve) => { finish = resolve; }));
	const pending = h.monitor.refresh();
	h.monitor.reportBlocked(status('maintenance'));
	assert.equal(h.view.state, 'maintenance');
	assert.equal(h.view.checking, false);
	finish(status());
	await pending;
	assert.equal(h.view.state, 'maintenance');
	h.monitor.reportBlocked(status());
	h.monitor.reportBlocked({ state: 'available' });
	assert.equal(h.view.state, 'maintenance');
	h.monitor.stop();
	h.monitor.reportBlocked(status('unavailable'));
	assert.equal(h.view.state, 'maintenance');
});

test('status dialog opens on a new failure, not every poll or manual recheck', () => {
	assert.ok(shouldOpenStatusDialog('checking', 'unavailable'));
	assert.ok(shouldOpenStatusDialog('available', 'maintenance'));
	assert.ok(shouldOpenStatusDialog('available', 'offline'));
	assert.equal(shouldOpenStatusDialog('unavailable', 'unavailable'), false);
	assert.equal(shouldOpenStatusDialog('available', 'checking'), false);
	assert.equal(shouldOpenStatusDialog('unavailable', 'available'), false);
});

test('only validated upstream 503 envelopes dispatch immediate blocking events', () => {
	const events = listenForRechecks();
	const body = { code: 'SERVICE_UNAVAILABLE', serviceStatus: status('maintenance') };
	reportServiceBlocked('/api/session', 503, body);
	reportServiceBlocked('/api/session', 500, body);
	reportServiceBlocked('/api/service-status', 503, body);
	reportServiceBlocked('/api/session', 503, { ...body, serviceStatus: status() });
	reportServiceBlocked('/api/session', 503, { ...body, serviceStatus: {} });
	assert.equal(events.length, 1);
	assert.equal(events[0].type, STATUS_BLOCKED_EVENT);
	assert.deepEqual((events[0] as CustomEvent).detail, status('maintenance'));
});

function listenForRechecks(): Event[] {
	const events: Event[] = [];
	Object.defineProperty(globalThis, 'window', { configurable: true, value: {
		dispatchEvent(event: Event) { events.push(event); return true; }
	} });
	return events;
}

test('only core API network/5xx errors request a real service probe', () => {
	const events = listenForRechecks();
	requestServiceRecheck('/api/search', 502);
	requestServiceRecheck('/api/episodes', 503);
	requestServiceRecheck('/api/session');
	for (const code of [400, 401, 403, 404, 429]) requestServiceRecheck('/api/episodes', code);
	requestServiceRecheck('/api/analytics', 500);
	requestServiceRecheck('/api/service-status', 500);
	assert.equal(events.length, 3);
	assert.ok(events.every((event) => event.type === STATUS_RECHECK_EVENT));
});

test('postJson preserves its error and requests a health recheck on a core 5xx response', async () => {
	const events = listenForRechecks();
	globalThis.fetch = async () => Response.json({ message: 'Unavailable' }, { status: 502 });
	await assert.rejects(postJson('/api/search', { query: 'test' }), /Unavailable/);
	assert.equal(events.length, 1);
});

test('postJson ignores user cancellation and status-API failures to avoid recursive checks', async () => {
	const events = listenForRechecks();
	globalThis.fetch = async () => { throw new DOMException('Cancelled', 'AbortError'); };
	await assert.rejects(postJson('/api/episodes', {}));
	globalThis.fetch = async () => { throw new Error('Network unavailable'); };
	await assert.rejects(postJson('/api/service-status', {}));
	assert.equal(events.length, 0);
});
