import { env } from '$env/dynamic/private';

function parseHttpUrl(raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error('Invalid URL.');
	}

	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
		throw new Error('URL is not allowed.');
	}
	return url;
}

export function assertSourceUrl(raw: string): string {
	const source = parseHttpUrl(env.SOURCE_ORIGIN || '');
	const target = parseHttpUrl(raw);
	if (target.origin !== source.origin) throw new Error('Source origin is not allowed.');
	return target.toString();
}

function isPrivateHostname(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
	if (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host.endsWith('.internal') ||
		host === '::' ||
		host === '::1' ||
		host.startsWith('fc') ||
		host.startsWith('fd') ||
		host.startsWith('fe80:')
	) {
		return true;
	}

	const parts = host.split('.').map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
		return false;
	}

	const [a, b] = parts;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		a >= 224
	);
}

export function assertImageUrl(raw: string): string {
	const target = parseHttpUrl(raw);
	const configuredOrigins = (env.IMAGE_ALLOWED_ORIGINS || '')
		.split(',')
		.map((origin) => origin.trim())
		.filter(Boolean)
		.map((origin) => parseHttpUrl(origin).origin);

	if (configuredOrigins.length) {
		if (!configuredOrigins.includes(target.origin)) throw new Error('Image origin is not allowed.');
	} else if (isPrivateHostname(target.hostname)) {
		throw new Error('Private image host is not allowed.');
	}

	return target.toString();
}
