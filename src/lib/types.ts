// Shared types (client + server).

/** A single episode in a series list. */
export interface Episode {
	/** data-ep-idx (unique episode id) */
	index: number;
	/** parsed episode number (e.g. 14), or null */
	no: number | null;
	/** episode title */
	title: string;
	/** opaque server token wrapping the source URL */
	playKey: string;
	/** air date (kept internally, not always shown) */
	date: string;
	/** thumbnail URL */
	thumbnail: string;
}

/** Source list progress; nextOffset is a row offset, never an episode ID. */
export interface EpisodePagination {
	total: number | null;
	nextOffset: number | null;
	warning?: string;
}

/** Episode list response. */
export interface EpisodeList {
	/** stable opaque source-post identity; never grants API access */
	contentId: string;
	series: string;
	/** Loaded episodes in ascending episode order. */
	episodes: Episode[];
	/** Optional for compatibility with previously cached/mock responses. */
	pagination?: EpisodePagination;
}

/** A single search result item. */
export interface SearchResult {
	/** stable opaque source-post identity; never grants API access */
	contentId: string;
	title: string;
	description: string;
	thumbnail: string;
	/** opaque server token; the raw source URL is never exposed to the browser */
	detailKey: string;
	/** category name (board_name) */
	category: string;
	/** year (wr_6) */
	year: string;
	/** series synopsis (wr_content), shown on the detail page when available */
	synopsis?: string;
}

/** Search response. */
export interface SearchResponse {
	query: string;
	count: number;
	results: SearchResult[];
}

/** Resolved stream session + assembled playback URL. */
export interface StreamSession {
	/** playback session expiry (unix seconds) */
	expires: number;
	/** final playback URL */
	full: string;
}
