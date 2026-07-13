// Server-only opaque token for hiding source URLs from the browser.
// Encrypts the URL with AES-256-GCM and exposes only an opaque key to the client.

import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { env } from '$env/dynamic/private';

const SECRET = env.PLAYER_TOKEN_SECRET;
if (!SECRET) throw new Error('PLAYER_TOKEN_SECRET is not set');
const KEY = crypto.createHash('sha256').update(SECRET).digest(); // 32 bytes
const TOKEN_VERSION = 'v1';

export type TokenPurpose = 'detail' | 'play' | 'image';

function tokenAad(purpose: TokenPurpose): Buffer {
	return Buffer.from(`watching:${TOKEN_VERSION}:${purpose}`, 'utf8');
}

export function sealUrl(url: string, purpose: TokenPurpose): string {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
	cipher.setAAD(tokenAad(purpose));
	const enc = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `${TOKEN_VERSION}.${Buffer.concat([iv, tag, enc]).toString('base64url')}`;
}

function decrypt(token: string, purpose?: TokenPurpose): string {
	const buf = Buffer.from(token, 'base64url');
	if (buf.length < 29) throw new Error('Invalid token.');

	const iv = buf.subarray(0, 12);
	const tag = buf.subarray(12, 28);
	const enc = buf.subarray(28);
	const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
	if (purpose) decipher.setAAD(tokenAad(purpose));
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export function openUrl(
	token: string,
	purpose: TokenPurpose,
	options: { allowLegacy?: boolean } = {}
): string {
	try {
		if (token.startsWith(`${TOKEN_VERSION}.`)) {
			return decrypt(token.slice(TOKEN_VERSION.length + 1), purpose);
		}
		if (options.allowLegacy) return decrypt(token);
		throw new Error('Legacy token not allowed.');
	} catch {
		throw new Error('Invalid token.');
	}
}
