import crypto from 'node:crypto';
import type {
	AnalyticsEventInput,
	AnalyticsOperation,
	SearchInputMethod
} from '../analytics.ts';

export const ACCESS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const AGGREGATE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
export const RATE_LIMIT_RETENTION_MS = 10 * 60 * 1000;
export const ANALYTICS_RATE_LIMIT = 60;

type UnknownRecord = Record<string, unknown>;

export interface AnalyticsRequestContext {
	ip: string;
	country?: string;
	region?: string;
	userAgent?: string;
}

export interface DailyMetricUpdate {
	id: string;
	date: string;
	metric: 'event' | 'search' | 'content';
	key: string;
	event?: string;
	query?: string;
	contentId?: string;
	title?: string;
}

function isRecord(value: unknown): value is UnknownRecord {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(
	value: unknown,
	field: string,
	maxLength: number,
	options: { normalizeWhitespace?: boolean } = {}
): string {
	if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
	const safeValue = value.replace(/[\u0000-\u001f\u007f]/g, ' ');
	const normalized = options.normalizeWhitespace
		? safeValue.trim().replace(/\s+/g, ' ')
		: safeValue.trim();
	if (!normalized) throw new Error(`${field} is required.`);
	if (normalized.length > maxLength) throw new Error(`${field} is too long.`);
	return normalized;
}

function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
	if (value === undefined) return undefined;
	return requiredString(value, field, maxLength);
}

function integer(value: unknown, field: string, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
		throw new Error(`${field} must be an integer between ${min} and ${max}.`);
	}
	return value;
}

function optionalInteger(
	value: unknown,
	field: string,
	min: number,
	max: number
): number | undefined {
	if (value === undefined || value === null) return undefined;
	return integer(value, field, min, max);
}

function contentFields(value: UnknownRecord): { contentId: string; title: string } {
	return {
		contentId: requiredString(value.contentId, 'contentId', 200),
		title: requiredString(value.title, 'title', 200)
	};
}

export function parseAnalyticsEvent(value: unknown): AnalyticsEventInput {
	if (!isRecord(value)) throw new Error('An event object is required.');
	const type = requiredString(value.type, 'type', 40);

	switch (type) {
		case 'visit':
			return { type, path: requiredString(value.path, 'path', 200) };
		case 'search_open':
		case 'history_open':
		case 'bookmarks_open':
			return { type };
		case 'search_success': {
			const inputMethod = requiredString(value.inputMethod, 'inputMethod', 20) as SearchInputMethod;
			if (!['typed', 'recent', 'voice', 'initial'].includes(inputMethod)) {
				throw new Error('inputMethod is invalid.');
			}
			return {
				type,
				query: requiredString(value.query, 'query', 100, { normalizeWhitespace: true }),
				resultCount: integer(value.resultCount, 'resultCount', 0, 500),
				inputMethod
			};
		}
		case 'search_result_open':
			return {
				type,
				...contentFields(value),
				category: optionalString(value.category, 'category', 100)
			};
		case 'detail_view':
			return {
				type,
				...contentFields(value),
				episodeCount: integer(value.episodeCount, 'episodeCount', 0, 10_000)
			};
		case 'play_session_created':
			return {
				type,
				...contentFields(value),
				episodeIndex: integer(value.episodeIndex, 'episodeIndex', 0, 10_000_000),
				episodeNo: optionalInteger(value.episodeNo, 'episodeNo', 0, 100_000) ?? null
			};
		case 'bookmark_add':
		case 'bookmark_remove':
			return { type, ...contentFields(value) };
		case 'bookmark_share_create':
		case 'bookmark_share_import':
			return { type, itemCount: integer(value.itemCount, 'itemCount', 1, 10_000_000) };
		case 'operation_error': {
			const operation = requiredString(value.operation, 'operation', 20) as AnalyticsOperation;
			if (!['search', 'detail', 'playback'].includes(operation)) {
				throw new Error('operation is invalid.');
			}
			return {
				type,
				operation,
				status: optionalInteger(value.status, 'status', 100, 599)
			};
		}
		default:
			throw new Error('Event type is not allowed.');
	}
}

export function utcDateKey(date: Date): string {
	return date.toISOString().slice(0, 10);
}

export function utcMinuteKey(date: Date): string {
	return date.toISOString().slice(0, 16);
}

export function visitorHash(
	secret: string,
	date: Date,
	context: Pick<AnalyticsRequestContext, 'ip' | 'userAgent'>
): string {
	return crypto
		.createHmac('sha256', secret)
		.update(`${utcDateKey(date)}\0${context.ip}\0${context.userAgent || ''}`)
		.digest('base64url');
}

export function expiresAt(date: Date, retentionMs: number): Date {
	return new Date(date.getTime() + retentionMs);
}

export function dailyMetricUpdates(event: AnalyticsEventInput, date: Date): DailyMetricUpdate[] {
	const day = utcDateKey(date);
	const updates: DailyMetricUpdate[] = [
		{
			id: `${day}:event:${event.type}`,
			date: day,
			metric: 'event',
			key: event.type,
			event: event.type
		}
	];

	if (event.type === 'search_success') {
		const key = event.query.toLocaleLowerCase('ko-KR');
		updates.push({
			id: `${day}:search:${key}`,
			date: day,
			metric: 'search',
			key,
			query: event.query
		});
	}

	if ('contentId' in event) {
		updates.push({
			id: `${day}:content:${event.type}:${event.contentId}`,
			date: day,
			metric: 'content',
			key: `${event.type}:${event.contentId}`,
			event: event.type,
			contentId: event.contentId,
			title: event.title
		});
	}

	return updates;
}
