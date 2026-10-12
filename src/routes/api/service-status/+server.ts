import { json } from '@sveltejs/kit';
import { getServiceStatus } from '$lib/server/availability';
import type { RequestHandler } from './$types';

/** Same-origin/API-cookie protected. Never accepts a caller-supplied probe target.
 * Transport succeeds even when upstream is down; the JSON describes availability.
 */
export const POST: RequestHandler = async () => json(await getServiceStatus(), {
	headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' }
});
