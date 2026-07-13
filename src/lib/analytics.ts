export type AnalyticsOperation = 'search' | 'detail' | 'playback';
export type SearchInputMethod = 'typed' | 'recent' | 'voice' | 'initial';

interface ContentEvent {
	contentId: string;
	title: string;
}

export type AnalyticsEventInput =
	| { type: 'visit'; path: string }
	| { type: 'search_open' }
	| {
			type: 'search_success';
			query: string;
			resultCount: number;
			inputMethod: SearchInputMethod;
	  }
	| (ContentEvent & { type: 'search_result_open'; category?: string })
	| (ContentEvent & { type: 'detail_view'; episodeCount: number })
	| (ContentEvent & { type: 'play_session_created'; episodeIndex: number; episodeNo?: number | null })
	| (ContentEvent & { type: 'bookmark_add' | 'bookmark_remove' })
	| { type: 'history_open' | 'bookmarks_open' }
	| { type: 'operation_error'; operation: AnalyticsOperation; status?: number };
