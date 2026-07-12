// Server-only opaque token for hiding source URLs from the browser.
// Encrypts the URL with AES-256-GCM and exposes only an opaque key to the client.

import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { env } from '$env/dynamic/private';

const SECRET = env.PLAYER_TOKEN_SECRET;
if (!SECRET) throw new Error('PLAYER_TOKEN_SECRET is not set');
const KEY = crypto.createHash('sha256').update(SECRET).digest(); // 32 bytes

export function sealUrl(url: string): string {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
	const enc = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, tag, enc]).toString('base64url');
}

export function openUrl(token: string): string {
	try {
		const buf = Buffer.from(token, 'base64url');
		const iv = buf.subarray(0, 12);
		const tag = buf.subarray(12, 28);
		const enc = buf.subarray(28);
		const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
	} catch {
		throw new Error('Invalid detail/play token.');
	}
}
