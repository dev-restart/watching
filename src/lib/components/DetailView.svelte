<script lang="ts">
	import { locale, translate as tl, tr } from '$lib/i18n';
	import { tick, untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import type { Episode, StreamSession } from '$lib/types';
	import { ApiError, isAbortError, loadEpisodes, loadMoreEpisodes } from '$lib/client/api';
	import { mergeEpisodes } from '$lib/episode-pagination';
	import { trackEvent } from '$lib/client/analytics';
	import { getOrFetchSession } from '$lib/session';
	import { imgUrl } from '$lib/img';
	import { addHistory } from '$lib/history';
	import { syncBookmarkIdentity, toggleBookmark } from '$lib/bookmarks';
	import DetailShareModal from '$lib/components/DetailShareModal.svelte';

	let {
		detailKey = '',
		initialPoster = '',
		initialSynopsis = '',
		serviceAvailable = true,
		autoPlayEpIndex,
		onBack
	}: {
		detailKey: string;
		initialPoster?: string;
		initialSynopsis?: string;
		serviceAvailable?: boolean;
		autoPlayEpIndex?: number;
		onBack?: () => void;
	} = $props();

	let loading = $state(false);
	let errorMsg = $state('');
	let series = $state('');
	let contentId = $state('');
	let episodes = $state<Episode[]>([]);
	let loaded = $state(false);
	let recoveryPending = $state(false);
	let episodeTotal = $state<number | null>(null);
	let nextEpisodeOffset = $state<number | null>(null);
	let moreEpisodesLoading = $state(false);
	let episodeListWarning = $state('');
	let episodeGrid = $state<HTMLUListElement>();
	let detailSignal: AbortSignal | undefined;
	const episodeCountLabel = $derived(episodeTotal !== null
		? `${episodes.length} / ${episodeTotal} ${tl($locale, 'loaded')}`
		: `${episodes.length} ${tl($locale, 'loaded')}`);

	type NowPlaying = { session: StreamSession; title: string; playKey: string };
	let playing = $state<NowPlaying | null>(null);
	let pendingKey = $state<string | null>(null);
	let bookmarked = $state(false);
	let shareOpen = $state(false);
	let shareNotice = $state('');
	let lastFailedEp = $state<Episode | null>(null);

	let posterKey = $state('');
	let synopsis = $state('');
	let posterUrl = $derived(posterKey ? imgUrl(posterKey) : '');

	const isSeries = $derived((episodeTotal ?? 0) > 1 || episodes.some((e) => e.no !== null) || episodes.length > 1);
	const heroThumb = $derived(episodes[0]?.thumbnail ?? '');

	$effect(() => {
		const key = detailKey;
		const poster = initialPoster;
		const description = initialSynopsis;
		if (!key) return;

		const controller = new AbortController();
		void loadDetail(key, poster, description, controller.signal);
		return () => controller.abort();
	});

	// Retry a failed initial detail after recovery without reloading a mounted player.
	$effect(() => {
		if (!serviceAvailable) { recoveryPending = true; return; }
		if (!recoveryPending || loading) return;
		recoveryPending = false;
		if (!loaded) untrack(retryDetail);
	});

	function retryDetail() {
		const signal = detailSignal;
		if (!serviceAvailable || loading || !signal || signal.aborted) return;
		void loadDetail(detailKey, initialPoster, initialSynopsis, signal);
	}

	// Auto-resume a previously watched episode once the list is loaded.
	let autoDone = false;
	$effect(() => {
		if (serviceAvailable && loaded && !autoDone && autoPlayEpIndex != null) {
			const ep = episodes.find((e) => e.index === autoPlayEpIndex);
			if (ep) {
				autoDone = true;
				watch(ep);
			}
		}
	});

	async function loadDetail(
		key: string,
		initialPosterKey: string,
		initialDescription: string,
		signal: AbortSignal
	) {
		detailSignal = signal;
		episodeTotal = null;
		nextEpisodeOffset = null;
		moreEpisodesLoading = false;
		episodeListWarning = '';
		shareOpen = false;
		shareNotice = '';
		posterKey = initialPosterKey;
		synopsis = initialDescription;
		bookmarked = false;
		contentId = '';
		series = '';
		loading = true;
		errorMsg = '';
		loaded = false;
		playing = null;
		episodes = [];
		lastFailedEp = null;
		autoDone = false;

		try {
			const data = await loadEpisodes(key, signal);
			if (signal.aborted) return;
			contentId = data.contentId;
			series = data.series;
			episodes = mergeEpisodes([], data.episodes);
			episodeTotal = data.pagination ? data.pagination.total : episodes.length;
			nextEpisodeOffset = data.pagination?.nextOffset ?? null;
			episodeListWarning = data.pagination?.warning ?? '';
			if (!posterKey) posterKey = data.episodes[0]?.thumbnail ?? '';
			const isBookmarked = await syncBookmarkIdentity(contentId, key, series);
			if (signal.aborted) return;
			bookmarked = isBookmarked;
			loaded = true;
			void trackEvent({
				type: 'detail_view',
				contentId,
				title: series,
				episodeCount: episodes.length
			});
		} catch (err) {
			if (isAbortError(err) || signal.aborted) return;
			errorMsg = err instanceof Error ? err.message : String(err);
			void trackEvent({
				type: 'operation_error',
				operation: 'detail',
				status: err instanceof ApiError ? err.status : undefined
			});
		} finally {
			if (!signal.aborted) loading = false;
		}
	}

	async function loadEarlierEpisodes() {
		const signal = detailSignal;
		const offset = nextEpisodeOffset;
		if (!serviceAvailable || !loaded || moreEpisodesLoading || offset === null || !signal || signal.aborted) return;
		moreEpisodesLoading = true;
		episodeListWarning = '';
		try {
			const data = await loadMoreEpisodes(detailKey, offset, signal);
			if (signal.aborted) return;
			if (data.contentId !== contentId) throw new Error('The episode list does not match this title.');
			const merged = mergeEpisodes(episodes, data.episodes);
			const next = data.pagination?.nextOffset ?? null;
			if (next !== null && (next <= offset || merged.length === episodes.length)) {
				throw new Error('No additional episodes were returned. Retry in a moment.');
			}
			// Earlier episodes sort above the current cards. Preserve a visible card's position.
			const anchor = Array.from(episodeGrid?.querySelectorAll<HTMLElement>('[data-episode-index]') ?? [])
				.find((node) => { const rect = node.getBoundingClientRect(); return rect.top >= 0 && rect.top < window.innerHeight; });
			const previousTop = anchor?.getBoundingClientRect().top;
			episodes = merged;
			episodeTotal = data.pagination?.total ?? episodeTotal;
			nextEpisodeOffset = next;
			episodeListWarning = data.pagination?.warning ?? '';
			await tick();
			if (!signal.aborted && anchor?.isConnected && previousTop !== undefined) {
				window.scrollBy(0, anchor.getBoundingClientRect().top - previousTop);
			}
		} catch (error) {
			if (signal.aborted || isAbortError(error)) return;
			episodeListWarning = error instanceof Error ? error.message : 'Unable to load earlier episodes. Please retry.';
		} finally {
			if (!signal.aborted) moreEpisodesLoading = false;
		}
	}

	async function toggleBm() {
		bookmarked = await toggleBookmark({ contentId, detailKey, title: series, poster: posterKey, synopsis });
		void trackEvent({
			type: bookmarked ? 'bookmark_add' : 'bookmark_remove',
			contentId,
			title: series
		});
	}

	function retryLast() {
		if (lastFailedEp) watch(lastFailedEp);
	}

	async function watch(ep: Episode, force = false) {
		if (!serviceAvailable || pendingKey !== null) return;
		const signal = detailSignal;
		errorMsg = '';
		pendingKey = ep.playKey;
		try {
			const s = await getOrFetchSession(ep.playKey, force);
			if (signal?.aborted) return;
			playing = { session: s, title: ep.title, playKey: ep.playKey };
			lastFailedEp = null;
			void trackEvent({
				type: 'play_session_created',
				contentId,
				title: series,
				episodeIndex: ep.index,
				episodeNo: ep.no
			});
			addHistory({
				contentId,
				detailKey,
				title: series,
				poster: posterKey,
				synopsis,
				epTitle: ep.title,
				epIndex: ep.index,
				no: ep.no
			});
			await tick();
			document.getElementById('player-panel')?.scrollIntoView({ behavior: 'smooth' });
		} catch (err) {
			if (signal?.aborted) return;
			errorMsg = err instanceof Error ? err.message : String(err);
			lastFailedEp = ep;
			void trackEvent({
				type: 'operation_error',
				operation: 'playback',
				status: err instanceof ApiError ? err.status : undefined
			});
		} finally {
			if (!signal?.aborted) pendingKey = null;
		}
	}
</script>

<svelte:head>
	<title>{series || tl($locale, 'Details')} — Watching</title>
</svelte:head>

{#if shareOpen}
	<DetailShareModal
		{detailKey}
		title={series}
		onClose={() => (shareOpen = false)}
		onCopied={() => (shareNotice = tr('Link copied.'))}
	/>
{/if}

{#if loading}
	<!-- skeleton -->
	<div class="mx-auto max-w-6xl px-4 py-10 sm:px-6">
		<div class="mb-6 space-y-3">
			<div class="h-9 w-2/3 animate-pulse rounded bg-neutral-800"></div>
			<div class="h-4 w-1/2 animate-pulse rounded bg-neutral-800/70"></div>
		</div>
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
			{#each Array(10) as _}
				<div class="aspect-[2/3] animate-pulse rounded-lg bg-neutral-800"></div>
			{/each}
		</div>
	</div>
{:else if errorMsg && !loaded}
	<div class="mx-auto max-w-3xl px-4 py-24 text-center">
		<div transition:fade class="rounded-lg border border-rose-900/60 bg-rose-950/30 px-4 py-4 text-sm text-rose-200">
			⚠ {errorMsg}
		</div>
		<button type="button" onclick={retryDetail} disabled={!serviceAvailable || loading} class="mr-2 mt-4 rounded-md border border-neutral-700 px-5 py-2 text-sm font-semibold text-neutral-200 hover:border-brand disabled:opacity-50">{tl($locale, 'Retry')}</button>
		<button
			type="button"
			onclick={() => onBack?.()}
			class="mt-4 rounded-md bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
		>
			Back
		</button>
	</div>
{:else if loaded}
	{#if !playing}
	<section class="relative overflow-hidden border-b border-neutral-800/60">
		{#if heroThumb}
			<img
				src={imgUrl(heroThumb)}
				alt=""
				onerror={(e) => {
					const img = e.currentTarget as HTMLImageElement;
					if (img.dataset.tried) {
						img.style.display = 'none';
					} else {
						img.dataset.tried = '1';
						img.src = posterUrl || '';
						if (!posterUrl) img.style.display = 'none';
					}
				}}
				class="absolute inset-0 h-full w-full object-cover opacity-20"
			/>
		{:else if posterUrl}
			<img src={posterUrl} alt="" class="absolute inset-0 h-full w-full object-cover opacity-20" />
		{/if}
		<div class="absolute inset-0 bg-gradient-to-t from-ink via-ink/80 to-ink/40"></div>

		<div class="relative mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
			<button
				type="button"
				onclick={() => onBack?.()}
				class="mb-4 inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200"
			>
				← {tl($locale, 'Back')}
			</button>
			<div class="flex items-start gap-3 sm:gap-4">
				<h1 class="min-w-0 max-w-3xl flex-1 break-words text-3xl font-extrabold tracking-tight sm:text-5xl">{series}</h1>
				<div class="mt-1 flex shrink-0 items-center gap-2">
					<button
						type="button"
						onclick={toggleBm}
						title={bookmarked ? tl($locale, 'Remove bookmark') : tl($locale, 'Add bookmark')}
						aria-label={bookmarked ? tl($locale, 'Remove bookmark') : tl($locale, 'Add bookmark')}
						aria-pressed={bookmarked}
						class="rounded-full border border-neutral-700 bg-neutral-900/60 p-2.5 text-neutral-300 transition hover:border-brand hover:text-brand {bookmarked ? 'border-brand text-brand' : ''}"
					>
						<svg class="h-5 w-5" viewBox="0 0 24 24" fill={bookmarked ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" aria-hidden="true">
							<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
						</svg>
					</button>
					<button
						type="button"
						onclick={() => { shareNotice = ''; shareOpen = true; }}
						title={tl($locale, "Share video")}
						aria-label={tl($locale, "Share video")}
						aria-haspopup="dialog"
						class="rounded-full border border-neutral-700 bg-neutral-900/60 p-2.5 text-neutral-300 transition hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-brand"
					>
						<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
							<circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
						</svg>
					</button>
				</div>
			</div>
			{#if shareNotice}
				<p class="mt-3 text-sm text-emerald-300" role="status">{shareNotice}</p>
			{/if}
			{#if synopsis}
				<p class="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-300 sm:text-base">{synopsis}</p>
			{/if}
			<div class="mt-3 flex items-center gap-3 text-sm text-neutral-400">
				{#if isSeries}
					<span>{nextEpisodeOffset !== null ? episodeCountLabel : `${episodes.length} ${tl($locale, 'episodes')}`}</span>
				{:else}
					<span>{tl($locale, 'Film')}</span>
				{/if}
			</div>

			{#if !isSeries}
				<button
					type="button"
					onclick={() => episodes[0] && watch(episodes[0])}
					disabled={!serviceAvailable || pendingKey !== null || !episodes[0]}
					class="mt-6 flex items-center gap-2 rounded-md bg-white px-7 py-3 text-sm font-bold text-black transition hover:bg-neutral-200 disabled:opacity-50"
				>
					{#if pendingKey === episodes[0]?.playKey}
						{tl($locale, 'Preparing…')}
					{:else}
						<svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4" /></svg>
						{tl($locale, 'Play')}
					{/if}
				</button>
			{/if}
		</div>
	</section>
	{/if}

	<div class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
		{#if playing}
			<div
				id="player-panel"
				transition:fly={{ y: -12, duration: 200 }}
				class="sticky top-0 z-50 mb-8 overflow-hidden rounded-xl border border-neutral-800 bg-ink-soft"
			>
				<div class="flex items-center gap-2 px-4 py-2.5">
					<span class="text-sm font-semibold">{playing.title}</span>
					<button
						type="button"
						onclick={() => (playing = null)}
						class="ml-auto rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
					>
						{tl($locale, 'Close')}
					</button>
				</div>
				<div class="relative aspect-video w-full bg-black">
					<iframe
						src={playing.session.full}
						title={playing.title}
						class="absolute inset-0 h-full w-full"
						scrolling="no"
						allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
						sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
						referrerpolicy="no-referrer"
						allowfullscreen
					></iframe>
				</div>
			</div>
		{/if}

		{#if errorMsg}
			<div
				transition:fade
				class="mb-5 flex items-center gap-3 rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200"
			>
				<span class="flex-1">⚠ {errorMsg}</span>
				{#if lastFailedEp}
					<button
						type="button"
						onclick={retryLast}
						disabled={!serviceAvailable || pendingKey !== null}
						class="shrink-0 rounded bg-amber-900/50 px-3 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-900/80"
					>
						{tl($locale, 'Retry')}
					</button>
				{/if}
			</div>
		{/if}

		{#if isSeries}
			<div class="mb-4 flex flex-wrap items-baseline gap-3">
				<h2 class="text-xl font-bold">{tl($locale, 'Episodes')}</h2>
				<span class="text-sm text-neutral-500" role="status">{nextEpisodeOffset !== null || (episodeTotal !== null && episodeTotal !== episodes.length) ? episodeCountLabel : `${episodes.length} ${tl($locale, 'total')}`}</span>
				{#if nextEpisodeOffset !== null}
					<button type="button" onclick={loadEarlierEpisodes} disabled={!serviceAvailable || moreEpisodesLoading} class="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-brand hover:text-white disabled:opacity-50">{tl($locale, moreEpisodesLoading ? 'Loading earlier episodes…' : episodeListWarning ? 'Retry earlier episodes' : 'Load earlier episodes')}</button>
				{/if}
			</div>
			{#if episodeListWarning}
				<p class="mb-4 rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200" role="alert">{episodeListWarning}</p>
			{/if}
			<ul bind:this={episodeGrid} class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
				{#each episodes as ep (ep.index)}
					<li data-episode-index={ep.index}>
						<button
							type="button"
							onclick={() => watch(ep)}
							disabled={!serviceAvailable || pendingKey !== null}
							class="group relative block aspect-[2/3] w-full overflow-hidden rounded-lg bg-neutral-800 text-left transition hover:z-10 disabled:opacity-60 {playing?.playKey === ep.playKey ? 'z-10 ring-2 ring-brand' : 'hover:ring-2 hover:ring-brand'}"
						>
							<div class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-neutral-700 to-neutral-900 text-3xl font-bold text-neutral-400">
								{ep.no ?? '•'}
							</div>
							{#if ep.thumbnail}
								<img
									src={imgUrl(ep.thumbnail)}
									alt={ep.title}
									loading="lazy"
									onerror={(e) => {
										const img = e.currentTarget as HTMLImageElement;
										if (img.dataset.tried) {
											img.style.display = 'none';
										} else {
											img.dataset.tried = '1';
											img.src = posterUrl || '';
											if (!posterUrl) img.style.display = 'none';
										}
									}}
									class="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
								/>
							{/if}
							<div class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-2.5 pt-8">
								<span class="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">EP {ep.no ?? ep.index}</span>
								<div class="mt-1 line-clamp-2 text-xs font-semibold leading-tight text-white">{ep.title}</div>
							</div>
							{#if pendingKey === ep.playKey}
								<div class="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-white">{tl($locale, 'Loading…')}</div>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
			{#if nextEpisodeOffset !== null}
				<div class="mt-6 text-center">
					<button type="button" onclick={loadEarlierEpisodes} disabled={!serviceAvailable || moreEpisodesLoading} class="rounded-md border border-neutral-700 bg-neutral-900/60 px-5 py-2.5 text-sm text-neutral-300 hover:border-brand hover:text-white disabled:opacity-50">{tl($locale, moreEpisodesLoading ? 'Loading earlier episodes…' : episodeListWarning ? 'Retry earlier episodes' : 'Load earlier episodes')}</button>
				</div>
			{/if}
		{/if}
	</div>
{:else}
	<div class="py-32 text-center text-sm text-neutral-500">
		Nothing to show here.
		<button type="button" onclick={() => onBack?.()} class="ml-2 underline text-neutral-300">{tl($locale, 'Go back')}</button>
	</div>
{/if}
