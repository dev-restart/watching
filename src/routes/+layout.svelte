<script lang="ts">
	import './layout.css';
	import { locale, chooseLocale, restoreLocale, translate as tl, LANGUAGE_OPTIONS, type Locale } from '$lib/i18n';
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
	import ServiceStatusNotice from '$lib/components/ServiceStatusNotice.svelte';
	import ServiceStatusModal from '$lib/components/ServiceStatusModal.svelte';
	import PwaInstall from '$lib/components/PwaInstall.svelte';
	import { createAvailabilityMonitor } from '$lib/client/availability';
	import { postJson } from '$lib/client/api';
	import { initialAvailability, shouldOpenStatusDialog, STATUS_BLOCKED_EVENT, STATUS_RECHECK_EVENT } from '$lib/service-status';

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
	let availability = $state(initialAvailability());
	let serviceDialogOpen = $state(false);
	let languageMenu = $state<HTMLDetailsElement>();
	const serviceBlocked = $derived(availability.state !== 'available');
	let mountedDetailKey = $state('');
	let recovered = $state(false);
	let availabilityMonitor: ReturnType<typeof createAvailabilityMonitor> | undefined;
	function checkService() { void availabilityMonitor?.refresh(); }

	$effect(() => {
		if (detail === null) mountedDetailKey = '';
		else if (!serviceBlocked) mountedDetailKey = detail.detailKey;
		// Keep an already mounted DetailView (and its iframe) alive during an outage.
		if (serviceBlocked) searchOpen = false;
	});

	const nav: AppNavigation = {
		openSearch: (q = '') => {
			checkService();
			if (serviceBlocked) { serviceDialogOpen = availability.state !== 'checking'; return; }
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
			checkService();
			if (serviceBlocked && availability.state !== 'checking') serviceDialogOpen = true;
			clearDetailLink();
			detail = target;
		},
		goHome: () => {
			checkService();
			clearDetailLink();
			detail = null;
		}
	};
	setAppNavigation(nav);

	onMount(() => {
		restoreLocale();
		void trackEvent({ type: 'visit', path: window.location.pathname });
		let wasUnavailable = false;
		let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
		const monitor = createAvailabilityMonitor({
			check: (signal) => postJson<unknown>('/api/service-status', {}, { signal }),
			online: () => navigator.onLine,
			visible: () => document.visibilityState !== 'hidden',
			onChange: (view) => {
				if (shouldOpenStatusDialog(availability.state, view.state)) serviceDialogOpen = true;
				if (view.state === 'available') serviceDialogOpen = false;
				availability = view;
				if (view.state !== 'available' && view.state !== 'checking') {
					wasUnavailable = true;
					recovered = false;
				} else if (view.state === 'available' && wasUnavailable) {
					wasUnavailable = false;
					recovered = true;
					clearTimeout(recoveryTimer);
					recoveryTimer = setTimeout(() => { recovered = false; }, 5_000);
				}
			}
		});
		availabilityMonitor = monitor;
		const environmentChanged = () => { void monitor.environmentChanged(); };
		const blockedByServer = (event: Event) => {
			if (event instanceof CustomEvent) monitor.reportBlocked(event.detail);
		};
		window.addEventListener(STATUS_BLOCKED_EVENT, blockedByServer);
		window.addEventListener('online', environmentChanged);
		window.addEventListener('offline', environmentChanged);
		document.addEventListener('visibilitychange', environmentChanged);
		window.addEventListener(STATUS_RECHECK_EVENT, checkService);
		checkService();
		return () => {
			monitor.stop();
			availabilityMonitor = undefined;
			clearTimeout(recoveryTimer);
			window.removeEventListener('online', environmentChanged);
			window.removeEventListener('offline', environmentChanged);
			document.removeEventListener('visibilitychange', environmentChanged);
			window.removeEventListener(STATUS_RECHECK_EVENT, checkService);
			window.removeEventListener(STATUS_BLOCKED_EVENT, blockedByServer);
		};
	});

	// Handles a fresh visit as well as client-side navigation and browser Back/Forward.
	afterNavigate(() => {
		checkService();
		if (openDetailShare()) return;
		const url = new URL(window.location.href);
		const sharedCode = url.searchParams.get('bookmarkShare') || '';
		if (/^[a-z0-9]{6}$/i.test(sharedCode)) {
			bookmarkImportCode = sharedCode.toUpperCase();
			bookmarksOpen = true;
		}
	});

	function openDetailShare(): boolean {
		checkService();
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
		if (searchOpen || historyOpen || bookmarksOpen || privacyOpen || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
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
	<title>WATCHING</title>
	<link rel="icon" href={favicon} />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
	<meta name="theme-color" content="#141414" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-title" content="WATCHING" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
</svelte:head>

<svelte:window onkeydown={onKeydown} onhashchange={openDetailShare} />

<div class="flex min-h-screen flex-col bg-ink text-neutral-100">
	<header class="sticky top-0 z-40 border-b border-neutral-800/60 bg-ink/90 backdrop-blur">
		<div class="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
			<button type="button" onclick={nav.goHome} class="flex items-center gap-2">
				<span class="text-xl font-extrabold tracking-tighter text-brand">WATCHING</span>
			</button>
			<div class="ml-auto flex items-center gap-2">
				<details bind:this={languageMenu} class="relative shrink-0">
					<summary aria-label={tl($locale, 'Language')} title={tl($locale, 'Language')} class="flex min-h-10 min-w-12 cursor-pointer list-none items-center justify-center gap-1 rounded-md border border-neutral-700 bg-neutral-900/60 px-2 text-xs font-semibold text-neutral-100 hover:border-neutral-500 focus-visible:outline-2 focus-visible:outline-brand sm:min-w-[6.5rem] [&::-webkit-details-marker]:hidden">
						<span aria-hidden="true">{LANGUAGE_OPTIONS.find((option) => option.value === $locale)?.flag}</span>
						<span class="hidden sm:inline">{LANGUAGE_OPTIONS.find((option) => option.value === $locale)?.name}</span>
						<svg class="h-3 w-3 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
					</summary>
					<div class="absolute right-0 top-full z-50 mt-2 min-w-40 overflow-hidden rounded-lg border border-neutral-700 bg-ink-soft p-1 shadow-2xl" role="group" aria-label={tl($locale, 'Language')}>
						{#each LANGUAGE_OPTIONS as option}
							<button type="button" lang={option.value} aria-current={$locale === option.value ? 'true' : undefined} onclick={() => { chooseLocale(option.value); if (languageMenu) languageMenu.open = false; }} class="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-neutral-200 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-brand {$locale === option.value ? 'bg-neutral-800 font-semibold text-white' : ''}">
								<span aria-hidden="true">{option.flag}</span>{option.name}
							</button>
						{/each}
					</div>
				</details>
				<button
					type="button"
					onclick={() => nav.openBookmarks()}
					title={tl($locale, 'Bookmarks') + ' (B)'}
					class="flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900/60 px-3 py-1.5 text-sm text-neutral-300 transition hover:border-neutral-500 hover:text-neutral-100"
				>
					<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
					</svg>
					<span class="hidden sm:inline">{tl($locale, 'Bookmarks')}</span>
				</button>
				<button
					type="button"
					onclick={() => nav.openHistory()}
					title={tl($locale, 'History') + ' (H)'}
					class="flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900/60 px-3 py-1.5 text-sm text-neutral-300 transition hover:border-neutral-500 hover:text-neutral-100"
				>
					<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M12 8v4l3 2" />
						<circle cx="12" cy="12" r="9" />
					</svg>
					<span class="hidden sm:inline">{tl($locale, 'History')}</span>
				</button>
				<button
					type="button"
					onclick={() => nav.openSearch()}
					title={serviceBlocked ? tl($locale, 'Waiting for service connection') : tl($locale, 'Search') + ' (/)'}
					disabled={serviceBlocked}
					class="flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900/60 px-3 py-1.5 text-sm text-neutral-300 transition hover:border-neutral-500 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
				>
					<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="11" cy="11" r="7" />
						<path d="m21 21-4.3-4.3" />
					</svg>
					<span class="hidden sm:inline">{tl($locale, 'Search')}</span>
				</button>
			</div>
		</div>
	</header>

	<main class="flex-1">
		{#if serviceBlocked && !shareLinkError}
			<ServiceStatusNotice view={availability} onRetry={checkService} compact={detail !== null && mountedDetailKey === detail.detailKey} />
		{:else if recovered}
			<p lang={$locale} class="mx-auto max-w-6xl px-4 pt-4 text-sm text-emerald-300 sm:px-6" role="status">{tl($locale, 'Connection restored. You can use the service again.')}</p>
		{/if}
		{#if shareLinkError}
			<div class="mx-auto max-w-3xl px-4 py-24 text-center">
				<p class="rounded-lg border border-rose-900/60 bg-rose-950/30 px-4 py-4 text-sm text-rose-200" role="alert">{shareLinkError}</p>
				<button type="button" onclick={nav.goHome} class="mt-4 rounded-md bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-dark">{tl($locale, 'Back to home')}</button>
			</div>
		{:else if detail === null}
			{#if !serviceBlocked}{@render children()}{/if}
		{:else if mountedDetailKey === detail.detailKey}
			{#key detail.detailKey}
				<DetailView
					detailKey={detail.detailKey}
					initialPoster={detail.poster}
					initialSynopsis={detail.synopsis}
					serviceAvailable={!serviceBlocked}
					autoPlayEpIndex={detail.autoPlayEpIndex}
					onBack={nav.goHome}
				/>
			{/key}
		{/if}
		<PwaInstall visible={detail === null && !shareLinkError} />
	</main>

	<footer class="border-t border-neutral-800/60 px-4 py-8 text-center sm:px-6">
		<div class="mx-auto max-w-3xl text-xs leading-relaxed text-neutral-500">
			<p class="font-semibold text-neutral-400">{tl($locale, 'Disclaimer')}</p>
			<p class="mt-2">
				{tl($locale, 'This platform operates strictly as a search engine tool. We do not store or host any multimedia files or personal data. All content is retrieved from third-party sources; consequently, we are not responsible for the copyright, legality, or accuracy of the linked materials. This is an experimental project and is subject to modification or termination at any time without notice.')}
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
<ServiceStatusModal open={serviceDialogOpen && serviceBlocked} view={availability} onRetry={checkService} onClose={() => (serviceDialogOpen = false)} />
