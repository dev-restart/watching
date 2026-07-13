import { createContext } from 'svelte';

export interface DetailTarget {
	detailKey: string;
	poster?: string;
	synopsis?: string;
	autoPlayEpIndex?: number;
}

export interface AppNavigation {
	openSearch(query?: string): void;
	openHistory(): void;
	openBookmarks(): void;
	showDetail(target: DetailTarget): void;
	goHome(): void;
}

export const [getAppNavigation, setAppNavigation] = createContext<AppNavigation>();
