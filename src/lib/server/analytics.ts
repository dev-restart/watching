import net from 'node:net';
import { env } from '$env/dynamic/private';
import {
	MongoClient,
	type AnyBulkWriteOperation,
	type Db,
	type Document
} from 'mongodb';
import type { AnalyticsEventInput } from '$lib/analytics';
import {
	ACCESS_RETENTION_MS,
	AGGREGATE_RETENTION_MS,
	ANALYTICS_RATE_LIMIT,
	EVENT_RETENTION_MS,
	RATE_LIMIT_RETENTION_MS,
	dailyMetricUpdates,
	expiresAt,
	type AnalyticsRequestContext,
	utcDateKey,
	utcMinuteKey,
	visitorHash
} from '$lib/server/analytics-data';

const DATABASE_NAME = env.MONGODB_DB || 'watching_analytics';
const ANALYTICS_ENABLED = env.ANALYTICS_ENABLED === 'true';
const HASH_SECRET = env.ANALYTICS_HASH_SECRET || '';

let clientPromise: Promise<MongoClient> | undefined;
let indexesPromise: Promise<void> | undefined;

interface RateLimitDocument extends Document {
	_id: string;
	count: number;
	minute: string;
	expiresAt: Date;
}

interface DailyMetricDocument extends Document {
	_id: string;
	date: string;
	metric: 'event' | 'search' | 'content';
	key: string;
	count: number;
	event?: string;
	query?: string;
	contentId?: string;
	title?: string;
	firstSeenAt: Date;
	lastSeenAt: Date;
	expiresAt: Date;
}

export class AnalyticsRateLimitError extends Error {}

export function isAnalyticsConfigured(): boolean {
	return ANALYTICS_ENABLED && !!env.MONGODB && !!HASH_SECRET;
}

function mongoClient(): Promise<MongoClient> {
	if (!env.MONGODB) throw new Error('MONGODB is not configured.');
	if (!clientPromise) {
		const client = new MongoClient(env.MONGODB, {
			appName: 'watching-analytics',
			ignoreUndefined: true,
			maxPoolSize: 5,
			minPoolSize: 0,
			maxIdleTimeMS: 30_000,
			serverSelectionTimeoutMS: 3_000,
			connectTimeoutMS: 3_000
		});
		clientPromise = client.connect().catch((error) => {
			clientPromise = undefined;
			throw error;
		});
	}
	return clientPromise;
}

async function analyticsDb(): Promise<Db> {
	return (await mongoClient()).db(DATABASE_NAME);
}

async function ensureIndexes(db: Db): Promise<void> {
	if (!indexesPromise) {
		indexesPromise = Promise.all([
			db.collection('analytics_access_logs').createIndex(
				{ expiresAt: 1 },
				{ expireAfterSeconds: 0, name: 'access_ttl' }
			),
			db.collection('analytics_events').createIndex(
				{ expiresAt: 1 },
				{ expireAfterSeconds: 0, name: 'events_ttl' }
			),
			db.collection('analytics_events').createIndex(
				{ event: 1, occurredAt: -1 },
				{ name: 'event_time' }
			),
			db.collection('analytics_events').createIndex(
				{ contentId: 1, occurredAt: -1 },
				{ name: 'content_time', sparse: true }
			),
			db.collection('analytics_daily').createIndex(
				{ expiresAt: 1 },
				{ expireAfterSeconds: 0, name: 'daily_ttl' }
			),
			db.collection('analytics_daily').createIndex(
				{ date: -1, metric: 1, count: -1 },
				{ name: 'daily_metric' }
			),
			db.collection('analytics_daily_visitors').createIndex(
				{ expiresAt: 1 },
				{ expireAfterSeconds: 0, name: 'daily_visitors_ttl' }
			),
			db.collection('analytics_daily_visitors').createIndex(
				{ date: 1, visitorHash: 1 },
				{ unique: true, name: 'daily_visitor_unique' }
			),
			db.collection('analytics_rate_limits').createIndex(
				{ expiresAt: 1 },
				{ expireAfterSeconds: 0, name: 'rate_limit_ttl' }
			)
		])
			.then(() => undefined)
			.catch((error) => {
				indexesPromise = undefined;
				throw error;
			});
	}
	return indexesPromise;
}

function cleanHeader(value: string | null, maxLength: number): string | undefined {
	if (!value) return undefined;
	const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
	return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function normalizedIp(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const first = value.split(',')[0]?.trim().replace(/^::ffff:/, '');
	return first && net.isIP(first) ? first : undefined;
}

export function analyticsRequestContext(
	request: Request,
	getClientAddress?: () => string
): AnalyticsRequestContext {
	const forwarded =
		cleanHeader(request.headers.get('x-vercel-forwarded-for'), 100) ||
		cleanHeader(request.headers.get('x-forwarded-for'), 100);
	let ip = normalizedIp(forwarded);
	if (!ip && getClientAddress) {
		try {
			ip = normalizedIp(getClientAddress());
		} catch {
			// Some adapters do not expose a client address in development.
		}
	}

	return {
		ip: ip || 'unknown',
		country: cleanHeader(request.headers.get('x-vercel-ip-country'), 2),
		region: cleanHeader(request.headers.get('x-vercel-ip-country-region'), 10),
		userAgent: cleanHeader(request.headers.get('user-agent'), 300)
	};
}

function eventDocument(
	event: AnalyticsEventInput,
	context: AnalyticsRequestContext,
	now: Date,
	visitorId: string
): Document {
	const { type, ...properties } = event;
	return {
		event: type,
		...properties,
		occurredAt: now,
		expiresAt: expiresAt(now, EVENT_RETENTION_MS),
		visitorHash: visitorId,
		country: context.country,
		region: context.region
	};
}

async function enforceRateLimit(
	db: Db,
	now: Date,
	visitorId: string
): Promise<void> {
	const minute = utcMinuteKey(now);
	const result = await db.collection<RateLimitDocument>('analytics_rate_limits').findOneAndUpdate(
		{ _id: `${minute}:${visitorId}` },
		{
			$inc: { count: 1 },
			$setOnInsert: {
				minute,
				expiresAt: expiresAt(now, RATE_LIMIT_RETENTION_MS)
			}
		},
		{ upsert: true, returnDocument: 'after' }
	);
	if (Number(result?.count || 0) > ANALYTICS_RATE_LIMIT) {
		throw new AnalyticsRateLimitError('Analytics rate limit exceeded.');
	}
}

export async function recordAnalyticsEvent(
	event: AnalyticsEventInput,
	context: AnalyticsRequestContext,
	now = new Date()
): Promise<boolean> {
	if (!isAnalyticsConfigured()) return false;

	const db = await analyticsDb();
	await ensureIndexes(db);
	const visitorId = visitorHash(HASH_SECRET, now, context);
	await enforceRateLimit(db, now, visitorId);

	const day = utcDateKey(now);
	const aggregateExpiry = expiresAt(now, AGGREGATE_RETENTION_MS);
	const dailyUpdates = dailyMetricUpdates(event, now);
	const dailyOperations: AnyBulkWriteOperation<DailyMetricDocument>[] = dailyUpdates.map(
		(update) => {
			const mutableFields: Document = { lastSeenAt: now };
			if (update.title) mutableFields.title = update.title;
			const initialFields: Document = {
				date: update.date,
				metric: update.metric,
				key: update.key,
				firstSeenAt: now,
				expiresAt: aggregateExpiry
			};
			if (update.event) initialFields.event = update.event;
			if (update.query) initialFields.query = update.query;
			if (update.contentId) initialFields.contentId = update.contentId;
			return {
				updateOne: {
					filter: { _id: update.id },
					update: {
						$inc: { count: 1 },
						$set: mutableFields,
						$setOnInsert: initialFields
					},
					upsert: true
				}
			};
		}
	);

	const writes: Promise<unknown>[] = [
		db.collection('analytics_events').insertOne(eventDocument(event, context, now, visitorId)),
		db.collection<DailyMetricDocument>('analytics_daily').bulkWrite(dailyOperations, {
			ordered: false
		}),
		db.collection('analytics_daily_visitors').updateOne(
			{ date: day, visitorHash: visitorId },
			{
				$setOnInsert: {
					date: day,
					visitorHash: visitorId,
					firstSeenAt: now,
					expiresAt: aggregateExpiry
				}
			},
			{ upsert: true }
		)
	];

	if (event.type === 'visit') {
		writes.push(
			db.collection('analytics_access_logs').insertOne({
				occurredAt: now,
				expiresAt: expiresAt(now, ACCESS_RETENTION_MS),
				ip: context.ip,
				country: context.country,
				region: context.region,
				userAgent: context.userAgent,
				path: event.path
			})
		);
	}

	await Promise.all(writes);
	return true;
}
