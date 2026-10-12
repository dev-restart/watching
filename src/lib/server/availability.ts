import { env } from '$env/dynamic/private';
import { createServiceHealth } from './service-health';
import { createUpstreamGate } from './upstream-gate';

/** One cache and in-flight probe shared by the status endpoint and upstream API gate. */
export const getServiceStatus = createServiceHealth({
	configuration: () => ({
		sourceOrigin: env.SOURCE_ORIGIN,
		searchPath: env.SEARCH_PATH,
		tokenPath: env.TOKEN_PATH,
		playerOrigin: env.PLAYER_ORIGIN,
		maintenance: env.SERVICE_MAINTENANCE === 'true'
	}),
	onChange: ({ state, reason }) => {
		// Never log hosts, environment values, tokens or upstream response bodies.
		console.info('[service-status]', state, reason);
	}
});

export const gateUpstreamRequest = createUpstreamGate(getServiceStatus);
