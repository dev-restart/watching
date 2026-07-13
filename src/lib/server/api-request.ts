import { error } from '@sveltejs/kit';

const MAX_JSON_BYTES = 4096;

export type JsonObject = Record<string, unknown>;

export async function readJsonObject(request: Request): Promise<JsonObject> {
	const contentType = request.headers.get('content-type')?.toLowerCase() || '';
	if (!contentType.startsWith('application/json')) throw error(415, 'JSON is required.');

	const contentLength = Number(request.headers.get('content-length'));
	if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
		throw error(413, 'Request is too large.');
	}

	const raw = await request.text();
	if (Buffer.byteLength(raw, 'utf8') > MAX_JSON_BYTES) throw error(413, 'Request is too large.');

	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw error(400, 'Invalid JSON.');
	}

	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw error(400, 'A JSON object is required.');
	}
	return value as JsonObject;
}

export function requireString(
	object: JsonObject,
	field: string,
	options: { maxLength: number; label: string }
): string {
	const value = object[field];
	if (typeof value !== 'string' || !value.trim()) throw error(400, `${options.label} is required.`);
	const normalized = value.trim();
	if (normalized.length > options.maxLength) throw error(400, `${options.label} is too long.`);
	return normalized;
}

export function optionalPositiveInteger(
	object: JsonObject,
	field: string,
	defaultValue: number,
	maxValue: number
): number {
	const value = object[field];
	if (value === undefined) return defaultValue;
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		throw error(400, `${field} must be a positive integer.`);
	}
	return Math.min(value, maxValue);
}
