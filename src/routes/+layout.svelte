<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { readDetailShare, withoutDetailShare } from '$lib/client/detail-sharing';
	import favicon from '$lib/assets/favicon.png';
	import { setAppNavigation, type AppNavigation, type DetailTarget } from '$lib/app-navigation';
	import { trackEvent } from '$lib/client/analytics';
	import SearchModal from '$lib/components/SearchModal.svelte';
	import HistoryModal from '$lib/components/HistoryModal.svelte';
	import BookmarkModal from '$lib/components/BookmarkModal.svelte';
	import DetailView from '$lib/components/DetailView.svelte';
	import PrivacyModal from '$lib/components/PrivacyModal.svelte';

	let { children } = $props();

	let searchOpen = $state(false);
	let historyOpen = $state(false);
	let bookmarksOpen = $state(false);
	let bookmarkImportCode = $state('');
	let privacyOpen = $state(false);
	let initialQuery = $state('');
	let detail = $state<DetailTarget | null>(null);
	let shareLinkError = $state('');
	let detailFromShare = false;

	const nav: AppNavigation = {
		openSearch: (q = '') => {
			initialQuery = q;
			searchOpen = true;
			void trackEvent({ type: 'search_open' });
		},
		openHistory: () => {
			historyOpen = true;
			void trackEvent({ type: 'history_open' });
		},
		openBookmarks: () => {
			bookmarksOpen = true;
			void trackEvent({ type: 'bookmarks_open' });
		},
		showDetail: (target) => {
			clearDetailLink();
			detail = target;
		},
		goHome: () => {
			clearDetailLink();
			detail = null;
		}
	};
	setAppNavigation(nav);

	onMount(() => {
		void trackEvent({ type: 'visit', path: window.location.pathname });
	});

	// Handles a fresh visit as well as client-side navigation and browser Back/Forward.
	afterNavigate(() => {
		if (openDetailShare()) return;
		const url = new URL(window.location.href);
		const sharedCode = url.searchParams.get('bookmarkShare') || '';
		if (/^[a-z0-9]{6}$/i.test(sharedCode)) {
			bookmarkImportCode = sharedCode.toUpperCase();
			bookmarksOpen = true;
		}
	});

	function openDetailShare(): boolean {
		const target = readDetailShare(window.location.hash);
		if (target.kind === 'none') {
			if (detailFromShare) {
				detail = null;
				shareLinkError = '';
				detailFromShare = false;
			}
			return false;
		}
		detailFromShare = true;
		searchOpen = false;
		historyOpen = false;
		bookmarksOpen = false;
		privacyOpen = false;
		bookmarkImportCode = '';
		if (target.kind === 'invalid') {
			detail = null;
			shareLinkError = 'This share link is invalid or incomplete. Ask the sender to copy it again.';
			return true;
		}
		shareLinkError = '';
		if (detail?.detailKey !== target.detailKey) {
			// Do not import bookmarks or auto-play just because a shared link was opened.
			detail = { detailKey: target.detailKey };
		}
		return true;
	}

	function clearDetailLink() {
		detailFromShare = false;
		shareLinkError = '';
		const url = withoutDetailShare(window.location.href);
		if (url.href !== window.location.href) replaceState(url, page.state);
	}

	function clearBookmarkImportCode() {
		bookmarkImportCode = '';
		const url = new URL(window.location.href);
		url.searchParams.delete('bookmarkShare');
		replaceState(url, page.state);
	}

	// Global keyboard shortcuts (ignored while typing or when a modal is open).
	function onKeydown(e: KeyboardEvent) {
		if (e.defaultPrevented) return;
		const t = e.target as HTMLElement | null;
		if (t && (/input|textarea|select/i.test(t.tagName) || t.isContentEditable)) return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (searchOpen || historyOpen || bookmarksOpen || privacyOpen || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
		if (e.key === '/') {
			e.preventDefault();
			nav.openSearch();
		} else if (e.key === 'h' || e.key === 'H') {
			nav.openHistory();
		} else if (e.key === 'b' || e.key === 'B') {
			nav.openBookmarks();
		} else if (e.key === 'Backspace' && detail) {
			e.preventDefault();
			nav.goHome();
		}
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<svelte:window onkeydown={onKeydown} onhashchange={openDetailShare} />

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
		{#if shareLinkError}
			<div class="mx-auto max-w-3xl px-4 py-24 text-center">
				<p class="rounded-lg border border-rose-900/60 bg-rose-950/30 px-4 py-4 text-sm text-rose-200" role="alert">{shareLinkError}</p>
				<button type="button" onclick={nav.goHome} class="mt-4 rounded-md bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-dark">Back to home</button>
			</div>
		{:else if detail === null}
			{@render children()}
		{:else}
			{#key detail.detailKey}
				<DetailView
					detailKey={detail.detailKey}
					initialPoster={detail.poster}
					initialSynopsis={detail.synopsis}
					autoPlayEpIndex={detail.autoPlayEpIndex}
					onBack={nav.goHome}
				/>
			{/key}
		{/if}
	</main>

	<footer class="border-t border-neutral-800/60 px-4 py-8 text-center sm:px-6">
		<div class="mx-auto max-w-3xl text-xs leading-relaxed text-neutral-500">
			<p class="font-semibold text-neutral-400">Disclaimer</p>
			<p class="mt-2">
				This platform operates strictly as a search engine tool. We do not store or host any multimedia files or personal data. All content is retrieved from third-party sources; consequently, we are not responsible for the copyright, legality, or accuracy of the linked materials. This is an experimental project and is subject to modification or termination at any time without notice.
			</p>
			
		</div>
	</footer>
</div>

<SearchModal open={searchOpen} initialQuery={initialQuery} onClose={() => (searchOpen = false)} />
<HistoryModal open={historyOpen} onClose={() => (historyOpen = false)} />
<BookmarkModal
	open={bookmarksOpen}
	initialImportCode={bookmarkImportCode}
	onImportHandled={clearBookmarkImportCode}
	onClose={() => (bookmarksOpen = false)}
/>
<PrivacyModal open={privacyOpen} onClose={() => (privacyOpen = false)} />
