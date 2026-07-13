import { json, type Handle } from '@sveltejs/kit';
import {
	API_ACCESS_COOKIE,
	API_ACCESS_MAX_AGE,
	createApiAccessToken,
	verifyApiAccessToken
} from '$lib/server/api-access';

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

export const handle: Handle = async ({ event, resolve }) => {
	const accessToken = event.cookies.get(API_ACCESS_COOKIE);
	const isApiRequest = event.url.pathname.startsWith('/api/');

	if (isApiRequest) {
		if (!verifyApiAccessToken(accessToken)) {
			return json(
				{ message: 'API access is not available. Reload the page and try again.' },
				{ status: 403 }
			);
		}

		if (!isSameOriginRequest(event.request, event.url.origin)) {
			return json({ message: 'Cross-origin API access is not allowed.' }, { status: 403 });
		}
	} else if (
		event.request.method === 'GET' &&
		event.request.headers.get('accept')?.includes('text/html') &&
		!verifyApiAccessToken(accessToken)
	) {
		event.cookies.set(API_ACCESS_COOKIE, createApiAccessToken(), {
			httpOnly: true,
			sameSite: 'strict',
			secure: event.url.protocol === 'https:',
			path: '/',
			maxAge: API_ACCESS_MAX_AGE
		});
	}

	return resolve(event);
};
