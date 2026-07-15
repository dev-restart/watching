import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ACCESS_RETENTION_MS,
	AGGREGATE_RETENTION_MS,
	EVENT_RETENTION_MS,
	dailyMetricUpdates,
	expiresAt,
	parseAnalyticsEvent,
	visitorHash
} from '../src/lib/server/analytics-data.ts';

test('analytics parser keeps only allowed search fields', () => {
	const event = parseAnalyticsEvent({
		type: 'search_success',
		query: '  참교육   시즌 2  ',
		resultCount: 3,
		inputMethod: 'typed',
		detailKey: 'must-not-be-stored',
		playKey: 'must-not-be-stored'
	});

	assert.deepEqual(event, {
		type: 'search_success',
		query: '참교육 시즌 2',
		resultCount: 3,
		inputMethod: 'typed'
	});
});

test('analytics parser rejects unknown or malformed events', () => {
	assert.throws(() => parseAnalyticsEvent({ type: 'image_loaded' }), /not allowed/);
	assert.throws(
		() =>
			parseAnalyticsEvent({
				type: 'play_session_created',
				contentId: '',
				title: 'Title',
				episodeIndex: 1
			}),
		/contentId/
	);
	assert.throws(
		() => parseAnalyticsEvent({ type: 'operation_error', operation: 'database' }),
		/operation/
	);
});

test('bookmark share analytics stores counts without codes or bookmark payloads', () => {
	assert.deepEqual(
		parseAnalyticsEvent({
			type: 'bookmark_share_create',
			itemCount: 125,
			code: 'SECRET',
			bookmarks: ['must-not-be-stored']
		}),
		{ type: 'bookmark_share_create', itemCount: 125 }
	);
});

test('visitor hash is stable within a UTC day and rotates the next day', () => {
	const context = { ip: '203.0.113.10', userAgent: 'Example Browser' };
	const first = visitorHash('secret', new Date('2026-07-13T00:00:00Z'), context);
	const sameDay = visitorHash('secret', new Date('2026-07-13T23:59:59Z'), context);
	const nextDay = visitorHash('secret', new Date('2026-07-14T00:00:00Z'), context);

	assert.equal(first, sameDay);
	assert.notEqual(first, nextDay);
	assert.equal(first.includes('203.0.113.10'), false);
});

test('retention dates match access, event, and aggregate policies', () => {
	const now = new Date('2026-07-13T00:00:00Z');
	assert.equal(expiresAt(now, ACCESS_RETENTION_MS).toISOString(), '2026-07-20T00:00:00.000Z');
	assert.equal(expiresAt(now, EVENT_RETENTION_MS).toISOString(), '2026-08-12T00:00:00.000Z');
	assert.equal(expiresAt(now, AGGREGATE_RETENTION_MS).toISOString(), '2027-07-13T00:00:00.000Z');
});

test('daily metrics include totals plus searchable dimensions', () => {
	const now = new Date('2026-07-13T08:00:00Z');
	const search = dailyMetricUpdates(
		{ type: 'search_success', query: '참교육', resultCount: 3, inputMethod: 'typed' },
		now
	);
	assert.deepEqual(
		search.map((item) => [item.metric, item.key]),
		[
			['event', 'search_success'],
			['search', '참교육']
		]
	);

	const play = dailyMetricUpdates(
		{
			type: 'play_session_created',
			contentId: 'content-a',
			title: 'Title A',
			episodeIndex: 1,
			episodeNo: 1
		},
		now
	);
	assert.equal(play[1].key, 'play_session_created:content-a');
});
