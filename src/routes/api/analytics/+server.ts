import { error } from '@sveltejs/kit';
import { parseAnalyticsEvent } from '$lib/server/analytics-data';
import {
	AnalyticsRateLimitError,
	analyticsRequestContext,
	recordAnalyticsEvent
} from '$lib/server/analytics';
import { readJsonObject } from '$lib/server/api-request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const body = await readJsonObject(request);
	let event;
	try {
		event = parseAnalyticsEvent(body);
	} catch (cause) {
		throw error(400, cause instanceof Error ? cause.message : 'Invalid analytics event.');
	}

	try {
		await recordAnalyticsEvent(event, analyticsRequestContext(request, getClientAddress));
		return new Response(null, { status: 204 });
	} catch (cause) {
		if (cause instanceof AnalyticsRateLimitError) throw error(429, 'Too many analytics events.');
		console.warn(
			'[api/analytics] event storage failed',
			cause instanceof Error ? cause.name : 'UnknownError'
		);
		throw error(503, 'Analytics is temporarily unavailable.');
	}
};
