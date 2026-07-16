import crypto from 'node:crypto';
import net from 'node:net';
import { env } from '$env/dynamic/private';
import type { Collection, Document } from 'mongodb';
import { isMongoConfigured, mongoDb } from '$lib/server/mongo';

export type ApiRateLimitScope = 'search' | 'details' | 'playback';

const WINDOW_MS = 60_000;
const LIMITS: Record<ApiRateLimitScope, number> = {
	search: 30,
	details: 60,
	playback: 30
};
const SECRET = env.API_ACCESS_SECRET || env.PLAYER_TOKEN_SECRET;
if (!SECRET) throw new Error('API_ACCESS_SECRET or PLAYER_TOKEN_SECRET is not set');

interface RateDocument extends Document {
	_id: string;
	count: number;
	expiresAt: Date;
}

const memoryRates = new Map<string, { count: number; expiresAt: number }>();
let rateCollectionPromise: Promise<Collection<RateDocument>> | undefined;

export class ApiRateLimitError extends Error {}

function normalizeIp(value: string | undefined): string | undefined {
	const first = value?.split(',')[0]?.trim().replace(/^::ffff:/, '');
	return first && net.isIP(first) ? first : undefined;
}

function requestIp(getClientAddress: () => string): string {
	try {
		return normalizeIp(getClientAddress()) || 'unknown';
	} catch {
		return 'unknown';
	}
}

function identityFor(ip: string): string {
	return crypto.createHmac('sha256', SECRET).update(ip).digest('base64url');
}

function enforceMemory(key: string, limit: number, now: number): void {
	if (memoryRates.size > 2_000) {
		for (const [storedKey, value] of memoryRates) {
			if (value.expiresAt <= now) memoryRates.delete(storedKey);
		}
	}

	const current = memoryRates.get(key);
	if (!current || current.expiresAt <= now) {
		memoryRates.set(key, { count: 1, expiresAt: now + WINDOW_MS });
		return;
	}
	current.count += 1;
	if (current.count > limit) throw new ApiRateLimitError('API rate limit exceeded.');
}

async function rateCollection(): Promise<Collection<RateDocument>> {
	if (!rateCollectionPromise) {
		rateCollectionPromise = (async () => {
			const collection = (await mongoDb()).collection<RateDocument>('api_rate_limits');
			await collection.createIndex(
				{ expiresAt: 1 },
				{ expireAfterSeconds: 0, name: 'api_rate_limit_ttl' }
			);
			return collection;
		})().catch((cause) => {
			rateCollectionPromise = undefined;
			throw cause;
		});
	}
	return rateCollectionPromise;
}

/** Fixed-window per-IP rate limit. MongoDB coordinates serverless instances; memory is a fallback. */
export async function enforceApiRateLimit(
	scope: ApiRateLimitScope,
	getClientAddress: () => string,
	now = Date.now()
): Promise<void> {
	const limit = LIMITS[scope];
	const window = Math.floor(now / WINDOW_MS);
	const key = `${scope}:${window}:${identityFor(requestIp(getClientAddress))}`;
	enforceMemory(key, limit, now);

	if (!isMongoConfigured()) return;
	try {
		const result = await (await rateCollection()).findOneAndUpdate(
			{ _id: key },
			{
				$inc: { count: 1 },
				$setOnInsert: { expiresAt: new Date((window + 2) * WINDOW_MS) }
			},
			{ upsert: true, returnDocument: 'after' }
		);
		if (Number(result?.count || 0) > limit) {
			throw new ApiRateLimitError('API rate limit exceeded.');
		}
	} catch (cause) {
		if (cause instanceof ApiRateLimitError) throw cause;
		// Core browsing remains available during a MongoDB outage; the local limit still applies.
		console.warn('[api/rate-limit] distributed limit unavailable', cause instanceof Error ? cause.name : 'UnknownError');
	}
}
