<script lang="ts">
	import './layout.css';
	import { setContext } from 'svelte';
	import favicon from '$lib/assets/favicon.png';
	import SearchModal from '$lib/components/SearchModal.svelte';
	import HistoryModal from '$lib/components/HistoryModal.svelte';
	import BookmarkModal from '$lib/components/BookmarkModal.svelte';
	import DetailView from '$lib/components/DetailView.svelte';

	let { children } = $props();

	let searchOpen = $state(false);
	let historyOpen = $state(false);
	let bookmarksOpen = $state(false);
	let initialQuery = $state('');
	let view = $state<'home' | 'detail'>('home');
	let detailKey = $state('');
	let autoPlayEpIndex = $state<number | undefined>(undefined);

	const nav = {
		openSearch: (q = '') => {
			initialQuery = q;
			searchOpen = true;
		},
		openHistory: () => {
			historyOpen = true;
		},
		openBookmarks: () => {
			bookmarksOpen = true;
		},
		showDetail: (
			key: string,
			opts?: { poster?: string; synopsis?: string; autoPlayEpIndex?: number }
		) => {
			if (typeof sessionStorage !== 'undefined') {
				if (opts?.poster) sessionStorage.setItem('detail:poster', opts.poster);
				else sessionStorage.removeItem('detail:poster');
				if (opts?.synopsis) sessionStorage.setItem('detail:synopsis', opts.synopsis);
				else sessionStorage.removeItem('detail:synopsis');
			}
			detailKey = key;
			autoPlayEpIndex = opts?.autoPlayEpIndex;
			view = 'detail';
		},
		goHome: () => {
			view = 'home';
			detailKey = '';
			autoPlayEpIndex = undefined;
		}
	};
	setContext('nav', nav);

	// Global keyboard shortcuts (ignored while typing or when a modal is open).
	function onKeydown(e: KeyboardEvent) {
		const t = e.target as HTMLElement | null;
		if (t && (/input|textarea|select/i.test(t.tagName) || t.isContentEditable)) return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (searchOpen || historyOpen || bookmarksOpen) return;
		if (e.key === '/') {
			e.preventDefault();
			nav.openSearch();
		} else if (e.key === 'h' || e.key === 'H') {
			nav.openHistory();
		} else if (e.key === 'b' || e.key === 'B') {
			nav.openBookmarks();
		} else if (e.key === 'Backspace' && view === 'detail') {
			e.preventDefault();
			nav.goHome();
		}
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<div class="flex min-h-screen flex-col bg-ink text-neutral-100">
	<header class="sticky top-0 z-40 border-b border-neutral-800/60 bg-ink/90 backdrop-blur">
		<div class="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
			<button type="button" onclick={nav.goHome} class="flex items-center gap-2">
				<span class="text-xl font-extrabold tracking-tighter text-brand">WATCHING</span>
			</button>
			<div class="ml-auto flex items-center gap-2">
				<button
					type="button"
					onclick={() => nav.openBookmarks()}
					title="Bookmarks (B)"
					class="flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900/60 px-3 py-1.5 text-sm text-neutral-300 transition hover:border-neutral-500 hover:text-neutral-100"
				>
					<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
					</svg>
					<span class="hidden sm:inline">Bookmarks</span>
				</button>
				<button
					type="button"
					onclick={() => nav.openHistory()}
					title="History (H)"
					class="flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900/60 px-3 py-1.5 text-sm text-neutral-300 transition hover:border-neutral-500 hover:text-neutral-100"
				>
					<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M12 8v4l3 2" />
						<circle cx="12" cy="12" r="9" />
					</svg>
					<span class="hidden sm:inline">History</span>
				</button>
				<button
					type="button"
					onclick={() => nav.openSearch()}
					title="Search (/)"
					class="flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900/60 px-3 py-1.5 text-sm text-neutral-300 transition hover:border-neutral-500 hover:text-neutral-100"
				>
					<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="11" cy="11" r="7" />
						<path d="m21 21-4.3-4.3" />
					</svg>
					<span class="hidden sm:inline">Search</span>
				</button>
			</div>
		</div>
	</header>

	<main class="flex-1">
		{#if view === 'home'}
			{@render children()}
		{:else}
			<DetailView detailKey={detailKey} autoPlayEpIndex={autoPlayEpIndex} onBack={nav.goHome} />
		{/if}
	</main>

	<footer class="border-t border-neutral-800/60 px-4 py-8 text-center sm:px-6">
		<div class="mx-auto max-w-3xl text-xs leading-relaxed text-neutral-500">
			<p class="font-semibold text-neutral-400">Disclaimer</p>
			<p class="mt-2">
				A search-engine demo that matches and links to titles from public sources. We store no
				data. No liability is assumed, and availability may change or end without notice.
			</p>
		</div>
	</footer>
</div>

<SearchModal open={searchOpen} initialQuery={initialQuery} onClose={() => (searchOpen = false)} />
<HistoryModal open={historyOpen} onClose={() => (historyOpen = false)} />
<BookmarkModal open={bookmarksOpen} onClose={() => (bookmarksOpen = false)} />
