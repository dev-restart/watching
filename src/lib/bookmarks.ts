// Browser-local bookmark repository backed by IndexedDB.

export interface Bookmark {
	id: string;
	contentId?: string;
	detailKey: string;
	title: string;
	poster?: string;
	synopsis?: string;
	category?: string;
	ts: number;
}

export interface BookmarkMergeResult {
	added: number;
	duplicates: number;
	invalid: number;
}

const LEGACY_KEY = 'watching:bookmarks';
const DATABASE_NAME = 'watching';
const DATABASE_VERSION = 1;
const STORE_NAME = 'bookmarks';

let databasePromise: Promise<IDBDatabase> | undefined;
let migrationPromise: Promise<void> | undefined;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
	});
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
		transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
	});
}

function openDatabase(): Promise<IDBDatabase> {
	if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable.'));
	if (!databasePromise) {
		databasePromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (db.objectStoreNames.contains(STORE_NAME)) return;
				const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
				store.createIndex('contentId', 'contentId', { unique: false });
				store.createIndex('titleKey', 'titleKey', { unique: false });
				store.createIndex('ts', 'ts', { unique: false });
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => {
				databasePromise = undefined;
				reject(request.error || new Error('Unable to open IndexedDB.'));
			};
		});
	}
	return databasePromise;
}

function titleKey(title: string): string {
	return title.trim().toLocaleLowerCase();
}

function validBookmark(value: unknown): value is Bookmark {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const item = value as Partial<Bookmark>;
	return (
		typeof item.id === 'string' &&
		!!item.id &&
		typeof item.detailKey === 'string' &&
		!!item.detailKey &&
		typeof item.title === 'string' &&
		!!item.title.trim() &&
		typeof item.ts === 'number' &&
		Number.isFinite(item.ts)
	);
}

type StoredBookmark = Bookmark & { titleKey: string };

function stored(bookmark: Bookmark): StoredBookmark {
	return { ...bookmark, titleKey: titleKey(bookmark.title) };
}

function publicBookmark(bookmark: StoredBookmark): Bookmark {
	const { titleKey: _titleKey, ...value } = bookmark;
	return value;
}

function sameBookmark(a: Pick<Bookmark, 'contentId' | 'title'>, b: Pick<Bookmark, 'contentId' | 'title'>): boolean {
	if (a.contentId && b.contentId) return a.contentId === b.contentId;
	return titleKey(a.title) === titleKey(b.title);
}

function mergeFields(current: Bookmark, incoming: Bookmark): Bookmark {
	const newer = incoming.ts >= current.ts ? incoming : current;
	const older = newer === incoming ? current : incoming;
	return {
		...older,
		...newer,
		id: newer.contentId || older.contentId || newer.id,
		contentId: newer.contentId || older.contentId,
		detailKey: newer.detailKey || older.detailKey,
		title: newer.title || older.title,
		poster: newer.poster || older.poster,
		synopsis: newer.synopsis || older.synopsis,
		category: newer.category || older.category,
		ts: Math.max(current.ts, incoming.ts)
	};
}

async function rawBookmarks(db: IDBDatabase): Promise<Bookmark[]> {
	const transaction = db.transaction(STORE_NAME, 'readonly');
	const values = await requestResult(transaction.objectStore(STORE_NAME).getAll() as IDBRequest<StoredBookmark[]>);
	await transactionDone(transaction);
	return values.map(publicBookmark).sort((a, b) => b.ts - a.ts);
}

async function writeMerged(db: IDBDatabase, incoming: Bookmark[]): Promise<BookmarkMergeResult> {
	const current = await rawBookmarks(db);
	const merged = [...current];
	let added = 0;
	let duplicates = 0;
	let invalid = 0;

	for (const item of incoming) {
		if (!validBookmark(item)) {
			invalid++;
			continue;
		}
		const index = merged.findIndex((existing) => sameBookmark(existing, item));
		if (index >= 0) {
			merged[index] = mergeFields(merged[index], item);
			duplicates++;
		} else {
			merged.push(item);
			added++;
		}
	}

	const transaction = db.transaction(STORE_NAME, 'readwrite');
	const store = transaction.objectStore(STORE_NAME);
	for (const item of merged) store.put(stored(item));
	await transactionDone(transaction);
	return { added, duplicates, invalid };
}

async function migrateLegacy(db: IDBDatabase): Promise<void> {
	if (typeof localStorage === 'undefined') return;
	const raw = localStorage.getItem(LEGACY_KEY);
	if (!raw) return;

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error('Legacy bookmark data is not valid JSON.');
	}
	if (!Array.isArray(parsed)) throw new Error('Legacy bookmark data is invalid.');
	await writeMerged(db, parsed.filter(validBookmark));
	localStorage.removeItem(LEGACY_KEY);
}

export async function initializeBookmarkStore(): Promise<void> {
	const db = await openDatabase();
	if (!migrationPromise) migrationPromise = migrateLegacy(db).finally(() => {
		migrationPromise = undefined;
	});
	await migrationPromise;
}

export async function loadBookmarks(): Promise<Bookmark[]> {
	await initializeBookmarkStore();
	return rawBookmarks(await openDatabase());
}

export async function mergeBookmarks(items: Bookmark[]): Promise<BookmarkMergeResult> {
	await initializeBookmarkStore();
	return writeMerged(await openDatabase(), items);
}

export async function syncBookmarkIdentity(contentId: string, detailKey: string, title: string): Promise<boolean> {
	const list = await loadBookmarks();
	const existing = list.find((bookmark) => bookmark.id === detailKey || sameBookmark(bookmark, { contentId, title }));
	if (!existing) return false;
	const updated: Bookmark = { ...existing, id: contentId, contentId, detailKey, title };
	const db = await openDatabase();
	const transaction = db.transaction(STORE_NAME, 'readwrite');
	const store = transaction.objectStore(STORE_NAME);
	if (existing.id !== updated.id) store.delete(existing.id);
	store.put(stored(updated));
	await transactionDone(transaction);
	return true;
}

export async function toggleBookmark(bookmark: Omit<Bookmark, 'id' | 'ts'>): Promise<boolean> {
	const list = await loadBookmarks();
	const existing = list.find((item) => sameBookmark(item, bookmark));
	const db = await openDatabase();
	const transaction = db.transaction(STORE_NAME, 'readwrite');
	const store = transaction.objectStore(STORE_NAME);
	if (existing) {
		store.delete(existing.id);
		await transactionDone(transaction);
		return false;
	}
	store.put(stored({ ...bookmark, id: bookmark.contentId || bookmark.detailKey, ts: Date.now() }));
	await transactionDone(transaction);
	return true;
}

export async function removeBookmarks(ids: Iterable<string>): Promise<void> {
	await initializeBookmarkStore();
	const db = await openDatabase();
	const transaction = db.transaction(STORE_NAME, 'readwrite');
	const store = transaction.objectStore(STORE_NAME);
	for (const id of ids) store.delete(id);
	await transactionDone(transaction);
}

export async function clearBookmarks(): Promise<void> {
	await initializeBookmarkStore();
	const db = await openDatabase();
	const transaction = db.transaction(STORE_NAME, 'readwrite');
	transaction.objectStore(STORE_NAME).clear();
	await transactionDone(transaction);
}
