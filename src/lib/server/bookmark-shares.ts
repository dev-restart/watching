import crypto from 'node:crypto';
import { env } from '$env/dynamic/private';
import { type Collection, type Document, MongoServerError } from 'mongodb';
import type { Bookmark } from '$lib/bookmarks';
import { contentIdFromSourceUrl } from '$lib/server/content-id';
import { mongoDb } from '$lib/server/mongo';
import { openUrl } from '$lib/server/tokens';
import { assertImageUrl, assertSourceUrl } from '$lib/server/url-policy';

const SHARE_MS = 3 * 60 * 1000;
const UPLOAD_MS = 5 * 60 * 1000;
const RATE_MS = 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SECRET = env.API_ACCESS_SECRET || env.PLAYER_TOKEN_SECRET;

interface ShareSession extends Document {
	_id: string;
	state: 'uploading' | 'ready' | 'claimed';
	uploadTokenHash: string;
	claimTokenHash?: string;
	code?: string;
	expectedCount: number;
	receivedCount: number;
	chunkCount: number;
	createdAt: Date;
	expiresAt: Date;
}

interface ShareChunk extends Document {
	sessionId: string;
	sequence: number;
	bookmarks: Bookmark[];
	expiresAt: Date;
}

interface ShareRate extends Document {
	_id: string;
	count: number;
	expiresAt: Date;
}

let indexesPromise: Promise<void> | undefined;

function token(): string {
	return crypto.randomBytes(24).toString('base64url');
}

function tokenHash(value: string): string {
	return crypto.createHash('sha256').update(value).digest('base64url');
}

function code(): string {
	let result = '';
	for (let index = 0; index < 6; index++) result += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
	return result;
}

function cleanString(value: unknown, field: string, maxLength: number, optional = false): string | undefined {
	if (value === undefined && optional) return undefined;
	if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
	const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
	if (!cleaned && !optional) throw new Error(`${field} is required.`);
	if (cleaned.length > maxLength) throw new Error(`${field} is too long.`);
	return cleaned || undefined;
}

export function normalizeShareCode(value: unknown): string {
	if (typeof value !== 'string') throw new Error('Share code is required.');
	const normalized = value.trim().toUpperCase();
	if (!/^[A-Z0-9]{6}$/.test(normalized)) throw new Error('Share code must be 6 letters or numbers.');
	return normalized;
}

export function validateSharedBookmark(value: unknown): Bookmark {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Bookmark is invalid.');
	const item = value as Record<string, unknown>;
	const suppliedContentId = cleanString(item.contentId, 'contentId', 200, true);
	const detailKey = cleanString(item.detailKey, 'detailKey', 4096);
	const title = cleanString(item.title, 'title', 200);
	if (!detailKey || !title) throw new Error('Bookmark is invalid.');

	const sourceUrl = assertSourceUrl(openUrl(detailKey, 'detail', { allowLegacy: true }));
	const contentId = contentIdFromSourceUrl(sourceUrl);
	if (suppliedContentId && suppliedContentId !== contentId) throw new Error('Bookmark identity is invalid.');

	const poster = cleanString(item.poster, 'poster', 4096, true);
	if (poster) {
		if (/^https?:\/\//i.test(poster)) assertImageUrl(poster);
		else assertImageUrl(openUrl(poster, 'image', { allowLegacy: true }));
	}
	const synopsis = cleanString(item.synopsis, 'synopsis', 4000, true);
	const category = cleanString(item.category, 'category', 100, true);
	const ts = typeof item.ts === 'number' && Number.isFinite(item.ts) ? item.ts : Date.now();
	return { id: contentId, contentId, detailKey, title, poster, synopsis, category, ts };
}

async function collections(): Promise<{
	sessions: Collection<ShareSession>;
	chunks: Collection<ShareChunk>;
	rates: Collection<ShareRate>;
}> {
	const db = await mongoDb();
	const sessions = db.collection<ShareSession>('bookmark_share_sessions');
	const chunks = db.collection<ShareChunk>('bookmark_share_chunks');
	const rates = db.collection<ShareRate>('bookmark_share_rate_limits');
	if (!indexesPromise) {
		indexesPromise = Promise.all([
			sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'share_session_ttl' }),
			sessions.createIndex({ code: 1 }, { unique: true, sparse: true, name: 'share_code_unique' }),
			chunks.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'share_chunk_ttl' }),
			chunks.createIndex({ sessionId: 1, sequence: 1 }, { unique: true, name: 'share_chunk_unique' }),
			rates.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'share_rate_ttl' })
		]).then(() => undefined).catch((error) => {
			indexesPromise = undefined;
			throw error;
		});
	}
	await indexesPromise;
	return { sessions, chunks, rates };
}

export async function enforceShareRateLimit(action: 'create' | 'import', ip: string): Promise<void> {
	const { rates } = await collections();
	const minute = Math.floor(Date.now() / RATE_MS);
	const identity = crypto.createHmac('sha256', SECRET).update(ip || 'unknown').digest('base64url');
	const result = await rates.findOneAndUpdate(
		{ _id: `${action}:${minute}:${identity}` },
		{ $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + RATE_MS * 2) } },
		{ upsert: true, returnDocument: 'after' }
	);
	const limit = action === 'create' ? 10 : 30;
	if (Number(result?.count || 0) > limit) throw new Error('RATE_LIMIT');
}

export async function startShare(expectedCount: number): Promise<{ sessionId: string; uploadToken: string }> {
	if (!Number.isSafeInteger(expectedCount) || expectedCount <= 0) throw new Error('At least one bookmark is required.');
	const { sessions } = await collections();
	const sessionId = crypto.randomUUID();
	const uploadToken = token();
	await sessions.insertOne({
		_id: sessionId,
		state: 'uploading',
		uploadTokenHash: tokenHash(uploadToken),
		expectedCount,
		receivedCount: 0,
		chunkCount: 0,
		createdAt: new Date(),
		expiresAt: new Date(Date.now() + UPLOAD_MS)
	});
	return { sessionId, uploadToken };
}

export async function uploadShareChunk(sessionId: string, uploadToken: string, sequence: number, values: unknown[]): Promise<void> {
	if (!Number.isSafeInteger(sequence) || sequence < 0 || !values.length) throw new Error('Share chunk is invalid.');
	const bookmarks = values.map(validateSharedBookmark);
	const { sessions, chunks } = await collections();
	const session = await sessions.findOne({ _id: sessionId, state: 'uploading', expiresAt: { $gt: new Date() } });
	if (!session || session.uploadTokenHash !== tokenHash(uploadToken)) throw new Error('Share upload is invalid or expired.');
	try {
		await chunks.insertOne({ sessionId, sequence, bookmarks, expiresAt: session.expiresAt });
	} catch (error) {
		if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
	}
	const totals = await chunks.aggregate<{ count: number; items: number }>([
		{ $match: { sessionId } },
		{ $project: { items: { $size: '$bookmarks' } } },
		{ $group: { _id: null, count: { $sum: 1 }, items: { $sum: '$items' } } }
	]).next();
	if (!totals || totals.items > session.expectedCount) {
		await chunks.deleteOne({ sessionId, sequence });
		throw new Error('Share contains too many bookmarks.');
	}
	await sessions.updateOne(
		{ _id: sessionId, state: 'uploading' },
		{ $set: { receivedCount: totals.items, chunkCount: totals.count } }
	);
}

export async function finalizeShare(sessionId: string, uploadToken: string): Promise<{ code: string; expiresAt: Date }> {
	const { sessions, chunks } = await collections();
	const session = await sessions.findOne({ _id: sessionId, state: 'uploading', expiresAt: { $gt: new Date() } });
	if (!session || session.uploadTokenHash !== tokenHash(uploadToken) || session.receivedCount !== session.expectedCount) {
		throw new Error('Share upload is incomplete or expired.');
	}
	const expiresAt = new Date(Date.now() + SHARE_MS);
	for (let attempt = 0; attempt < 10; attempt++) {
		const shareCode = code();
		try {
			const result = await sessions.updateOne(
				{ _id: sessionId, state: 'uploading' },
				{ $set: { state: 'ready', code: shareCode, expiresAt } }
			);
			if (!result.modifiedCount) throw new Error('Share upload is invalid.');
			await chunks.updateMany({ sessionId }, { $set: { expiresAt } });
			return { code: shareCode, expiresAt };
		} catch (error) {
			if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
		}
	}
	throw new Error('Unable to allocate a share code.');
}

export async function claimShare(rawCode: unknown): Promise<{ claimToken: string; sessionId: string; chunkCount: number }> {
	const { sessions } = await collections();
	const shareCode = normalizeShareCode(rawCode);
	const claimToken = token();
	const session = await sessions.findOneAndUpdate(
		{ code: shareCode, state: 'ready', expiresAt: { $gt: new Date() } },
		{ $set: { state: 'claimed', claimTokenHash: tokenHash(claimToken) } },
		{ returnDocument: 'after' }
	);
	if (!session) throw new Error('NOT_FOUND');
	return { claimToken, sessionId: session._id, chunkCount: session.chunkCount };
}

export async function downloadShareChunk(sessionId: string, claimToken: string, sequence: number): Promise<Bookmark[]> {
	const { sessions, chunks } = await collections();
	const session = await sessions.findOne({ _id: sessionId, state: 'claimed', expiresAt: { $gt: new Date() } });
	if (!session || session.claimTokenHash !== tokenHash(claimToken)) throw new Error('NOT_FOUND');
	const chunk = await chunks.findOne({ sessionId, sequence });
	if (!chunk) throw new Error('NOT_FOUND');
	return chunk.bookmarks;
}

export async function completeShareImport(sessionId: string, claimToken: string): Promise<void> {
	const { sessions, chunks } = await collections();
	const session = await sessions.findOne({ _id: sessionId, state: 'claimed' });
	if (!session || session.claimTokenHash !== tokenHash(claimToken)) throw new Error('NOT_FOUND');
	await Promise.all([chunks.deleteMany({ sessionId }), sessions.deleteOne({ _id: sessionId })]);
}
