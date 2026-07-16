import { json, type Cookies, type Handle } from '@sveltejs/kit';
import { API_ACCESS_REFRESHED_CODE } from '$lib/api-access';
import {
	API_ACCESS_COOKIE,
	API_ACCESS_MAX_AGE,
	createApiAccessToken,
	verifyApiAccessToken
} from '$lib/server/api-access';

function securityHeaders(response: Response, protocol: string): Response {
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	if (protocol === 'https:') {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
	return response;
}

function isSameOriginRequest(request: Request, expectedOrigin: string): boolean {
	const origin = request.headers.get('origin');
	if (origin) return origin === expectedOrigin;

	const fetchSite = request.headers.get('sec-fetch-site');
	if (fetchSite) return fetchSite === 'same-origin';

	const referer = request.headers.get('referer');
	if (!referer) return false;

	try {
		return new URL(referer).origin === expectedOrigin;
	} catch {
		return false;
	}
}

function apiAccessCookieOptions(protocol: string): Parameters<Cookies['set']>[2] {
	return {
		httpOnly: true,
		sameSite: 'strict',
		secure: protocol === 'https:',
		path: '/',
		maxAge: API_ACCESS_MAX_AGE
	};
}

function issueApiAccessCookie(cookies: Cookies, protocol: string): void {
	cookies.set(API_ACCESS_COOKIE, createApiAccessToken(), apiAccessCookieOptions(protocol));
}

function serializeApiAccessCookie(cookies: Cookies, protocol: string): string {
	return cookies.serialize(
		API_ACCESS_COOKIE,
		createApiAccessToken(),
		apiAccessCookieOptions(protocol)
	);
}

export const handle: Handle = async ({ event, resolve }) => {
	const accessToken = event.cookies.get(API_ACCESS_COOKIE);
	const isApiRequest = event.url.pathname.startsWith('/api/');

	if (isApiRequest) {
		if (!isSameOriginRequest(event.request, event.url.origin)) {
			return securityHeaders(
				json({ message: 'Cross-origin API access is not allowed.' }, { status: 403 }),
				event.url.protocol
			);
		}

		if (!verifyApiAccessToken(accessToken)) {
			const response = json(
				{
					code: API_ACCESS_REFRESHED_CODE,
					message: 'API access was refreshed. Retry the request.'
				},
				{ status: 401 }
			);
			response.headers.append(
				'Set-Cookie',
				serializeApiAccessCookie(event.cookies, event.url.protocol)
			);
			response.headers.set('Cache-Control', 'private, no-store');
			return securityHeaders(response, event.url.protocol);
		}
	} else if (
		event.request.method === 'GET' &&
		event.request.headers.get('accept')?.includes('text/html') &&
		!verifyApiAccessToken(accessToken)
	) {
		issueApiAccessCookie(event.cookies, event.url.protocol);
		const response = await resolve(event);
		response.headers.set('Cache-Control', 'private, no-store');
		return securityHeaders(response, event.url.protocol);
	}

	return securityHeaders(await resolve(event), event.url.protocol);
};
