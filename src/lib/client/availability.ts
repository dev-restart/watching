import { initialAvailability, parseServiceStatus, STATUS_POLL_MS, type AvailabilityView } from '../service-status.ts';

type Timer = ReturnType<typeof setTimeout>;

/** One monitor per mounted app. It never reloads the page or discards detail/bookmark state. */
export function createAvailabilityMonitor(options: {
	check: (signal: AbortSignal) => Promise<unknown>;
	onChange: (view: AvailabilityView) => void;
	online: () => boolean;
	visible: () => boolean;
	now?: () => number;
	setTimer?: (callback: () => void, ms: number) => Timer;
	clearTimer?: (timer: Timer) => void;
}) {
	const now = options.now ?? Date.now;
	const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
	const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
	let view = initialAvailability();
	let stopped = false;
	let generation = 0;
	let lastAttempt = -Infinity;
	let controller: AbortController | undefined;
	let pollTimer: Timer | undefined;
	let requestTimer: Timer | undefined;

	function publish(patch: Partial<AvailabilityView>) {
		view = { ...view, ...patch };
		options.onChange({ ...view });
	}
	function clearPoll() {
		if (pollTimer !== undefined) clearTimer(pollTimer);
		pollTimer = undefined;
	}
	function cancel() {
		generation++;
		controller?.abort();
		controller = undefined;
		if (requestTimer !== undefined) clearTimer(requestTimer);
		requestTimer = undefined;
		clearPoll();
	}
	function schedule(delay: number) {
		clearPoll();
		if (stopped || !options.online() || !options.visible()) return;
		publish({ retryAt: now() + delay });
		pollTimer = setTimer(() => { pollTimer = undefined; void refresh(); }, delay);
	}

	async function refresh(): Promise<void> {
		if (stopped) return;
		if (!options.online()) {
			cancel();
			lastAttempt = -Infinity;
			publish({ state: 'offline', checking: false, retryAt: null });
			return;
		}
		if (!options.visible()) {
			cancel();
			publish({ checking: false, retryAt: null });
			return;
		}
		if (controller) return;
		const wait = 5_000 - (now() - lastAttempt);
		if (wait > 0) { schedule(wait); return; }
		clearPoll();
		lastAttempt = now();
		const version = ++generation;
		const active = new AbortController();
		controller = active;
		publish({ checking: true, retryAt: null });
		let delay = STATUS_POLL_MS;
		try {
			const result = await Promise.race([
				options.check(active.signal),
				new Promise<never>((_, reject) => {
					requestTimer = setTimer(() => { active.abort(); reject(new Error('Status request timed out.')); }, 12_000);
				})
			]);
			if (stopped || version !== generation) return;
			const status = parseServiceStatus(result);
			delay = status.retryAfterMs;
			publish({ state: status.state, checkedAt: status.checkedAt });
		} catch {
			if (stopped || version !== generation) return;
			// Failure to reach our status API is NOT proof that the upstream host is down.
			publish({ state: options.online() ? 'unknown' : 'offline' });
		} finally {
			if (!stopped && version === generation) {
				if (requestTimer !== undefined) clearTimer(requestTimer);
				requestTimer = undefined;
				controller = undefined;
				publish({ checking: false });
				schedule(delay);
			}
		}
	}

	return {
		refresh,
		/** Apply a server-side 503 immediately; a stale in-flight success must not undo it. */
		reportBlocked(value: unknown) {
			if (stopped) return;
			let status;
			try { status = parseServiceStatus(value); } catch { return; }
			if (status.state === 'available') return;
			cancel();
			publish({ state: options.online() ? status.state : 'offline', checkedAt: status.checkedAt,
				checking: false, retryAt: null });
			schedule(status.retryAfterMs);
		},
		/** Call for online/offline and visibility changes; online never means healthy until probed. */
		environmentChanged: refresh,
		stop() { stopped = true; cancel(); }
	};
}
