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

/** Episode list response. */
export interface EpisodeList {
	series: string;
	/** ordered 1..N */
	episodes: Episode[];
}

/** A single search result item. */
export interface SearchResult {
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
	success: boolean;
	/** rotating short id from the player path */
	short_id: string;
	/** player base URL (no query) */
	player_url: string;
	/** issued timestamp (unix seconds) */
	t: number;
	/** signature paired with t */
	sig: string;
	/** expiry (unix seconds) = t + 300 */
	expires: number;
	/** final playback URL: player_url?t=<t>&sig=<sig> */
	full: string;
	/** company (player host with common prefixes stripped) */
	company: string;
}
