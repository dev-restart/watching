import crypto from 'node:crypto';
import { env } from '$env/dynamic/private';

export const API_ACCESS_COOKIE = 'watching_api_access';
export const API_ACCESS_MAX_AGE = 60 * 60 * 24;

const SIGNING_SECRET = env.API_ACCESS_SECRET || env.PLAYER_TOKEN_SECRET;
if (!SIGNING_SECRET) {
	throw new Error('API_ACCESS_SECRET or PLAYER_TOKEN_SECRET is not set');
}

// Derive a purpose-specific key instead of reusing the URL-encryption key directly.
const SIGNING_KEY = crypto
	.createHmac('sha256', SIGNING_SECRET)
	.update('watching-api-access-v1')
	.digest();

function signature(payload: string): Buffer {
	return crypto.createHmac('sha256', SIGNING_KEY).update(payload).digest();
}

export function createApiAccessToken(now = Date.now()): string {
	const issuedAt = Math.floor(now / 1000).toString(36);
	const nonce = crypto.randomBytes(18).toString('base64url');
	const payload = `${issuedAt}.${nonce}`;
	return `${payload}.${signature(payload).toString('base64url')}`;
}

export function verifyApiAccessToken(token: string | undefined, now = Date.now()): boolean {
	if (!token) return false;

	const [issuedAtValue, nonce, suppliedValue, ...rest] = token.split('.');
	if (!issuedAtValue || !nonce || !suppliedValue || rest.length) return false;

	const issuedAt = Number.parseInt(issuedAtValue, 36);
	const age = Math.floor(now / 1000) - issuedAt;
	if (!Number.isFinite(issuedAt) || age < -60 || age > API_ACCESS_MAX_AGE) return false;

	let supplied: Buffer;
	try {
		supplied = Buffer.from(suppliedValue, 'base64url');
	} catch {
		return false;
	}

	const expected = signature(`${issuedAtValue}.${nonce}`);
	return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
