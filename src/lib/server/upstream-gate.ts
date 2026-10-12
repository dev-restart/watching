import { SERVICE_STATUS_MESSAGES, STATUS_POLL_MS, type ServiceStatus } from '../service-status.ts';

/** Do not gate health checks, local data, installation assets or unsupported HTTP methods. */
export function isUpstreamRequest(method: string, pathname: string): boolean {
	const path = pathname.replace(/\/+$/, '');
	return (method === 'POST' && ['/api/search', '/api/episodes', '/api/session'].includes(path)) ||
		((method === 'GET' || method === 'HEAD') && path === '/api/img');
}

/** Invoked after same-origin and API-cookie validation, before any upstream handler runs. */
export function createUpstreamGate(check: () => Promise<ServiceStatus>) {
	return async (method: string, pathname: string): Promise<Response | null> => {
		if (!isUpstreamRequest(method, pathname)) return null;
		let serviceStatus: ServiceStatus;
		try {
			serviceStatus = await check();
		} catch {
			// A failure in our own checker is not proof of an upstream outage. Still fail closed.
			return Response.json({ code: 'SERVICE_CHECK_FAILED', message: SERVICE_STATUS_MESSAGES.unknown[0] }, {
				status: 503,
				headers: { 'Cache-Control': 'private, no-store', 'Retry-After': String(STATUS_POLL_MS / 1000) }
			});
		}
		if (serviceStatus.state === 'available') return null;
		return Response.json({
			code: 'SERVICE_UNAVAILABLE',
			message: SERVICE_STATUS_MESSAGES[serviceStatus.state][0],
			serviceStatus
		}, {
			status: 503,
			headers: {
				'Cache-Control': 'private, no-store',
				'Retry-After': String(Math.ceil(serviceStatus.retryAfterMs / 1000))
			}
		});
	};
}
