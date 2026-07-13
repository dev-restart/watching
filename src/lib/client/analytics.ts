import type { AnalyticsEventInput } from '$lib/analytics';

export async function trackEvent(event: AnalyticsEventInput): Promise<void> {
	try {
		await fetch('/api/analytics', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(event),
			keepalive: true
		});
	} catch {
		// Analytics must never interrupt the user-facing action.
	}
}
