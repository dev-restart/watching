<script lang="ts">
	import { onMount } from 'svelte';
	import { getAppNavigation } from '$lib/app-navigation';
	import { locale, translate as tl } from '$lib/i18n';
	import { loadHistory, type WatchEntry } from '$lib/history';
	import { imgUrl } from '$lib/img';

	const nav = getAppNavigation();
	let recent = $state<WatchEntry[]>([]);

	onMount(() => {
		recent = loadHistory().filter((entry) => !!entry.detailKey && !!entry.title).slice(0, 3);
	});

	function resume(entry: WatchEntry) {
		nav.showDetail({
			detailKey: entry.detailKey,
			poster: entry.poster,
			synopsis: entry.synopsis,
			autoPlayEpIndex: entry.epIndex
		});
	}
</script>

<svelte:head>
	<title>Watching</title>
</svelte:head>

<section aria-labelledby="home-title" class="mx-auto flex w-full max-w-5xl flex-col items-center px-4 pb-5 pt-10 sm:px-6 sm:pb-8 sm:pt-16 lg:pt-20" style="word-break: keep-all; overflow-wrap: anywhere">
	<div class="w-full max-w-2xl text-center">
		<p class="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-brand">{tl($locale, 'Your next watch starts here')}</p>
		<h1 id="home-title" class="text-balance text-3xl font-extrabold tracking-tight text-neutral-50 sm:text-5xl">{tl($locale, 'What do you want to watch?')}</h1>
		<p class="mx-auto mt-3 max-w-lg text-pretty text-sm leading-relaxed text-neutral-400 sm:mt-4 sm:text-base">{tl($locale, 'Search TV shows and movies in one place.')}</p>
	</div>

	<button type="button" onclick={() => nav.openSearch()} aria-label={tl($locale, "Search movies or TV shows")} class="group mt-7 flex min-h-14 w-full max-w-xl items-center gap-3 rounded-xl border border-neutral-700 bg-neutral-900 px-4 text-left shadow-lg shadow-black/10 transition hover:border-neutral-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:mt-9">
		<svg class="h-5 w-5 shrink-0 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
		<span class="min-w-0 flex-1 text-sm text-neutral-400">{tl($locale, 'Search movies or TV shows...')}</span>
		<span class="flex h-9 w-10 shrink-0 items-center justify-center rounded-lg bg-brand text-white transition group-hover:bg-brand-dark" aria-hidden="true">
			<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 14 0m-6-6 6 6-6 6"/></svg>
		</span>
	</button>

	{#if recent.length > 0}
		<div class="mt-10 w-full max-w-3xl sm:mt-12">
			<div class="mb-4 flex items-center justify-between gap-3">
				<h2 class="text-base font-semibold text-neutral-100">{tl($locale, 'Continue watching')}</h2>
				<button type="button" onclick={() => nav.openHistory()} class="min-h-11 rounded-lg px-2 text-sm font-medium text-neutral-400 hover:text-white focus-visible:outline-2 focus-visible:outline-brand">{tl($locale, 'View history →')}</button>
			</div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
				{#each recent as item (item.id)}
					<button type="button" onclick={() => resume(item)} class="flex min-w-0 items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/70 p-3 text-left transition hover:border-neutral-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:flex-col sm:items-stretch">
						{#if item.poster}
							<img src={imgUrl(item.poster)} alt="" loading="lazy" class="h-14 w-11 shrink-0 rounded-md bg-neutral-800 object-cover sm:h-28 sm:w-full"/>
						{:else}
							<span class="flex h-14 w-11 shrink-0 items-center justify-center rounded-md bg-neutral-800 text-neutral-400 sm:h-28 sm:w-full" aria-hidden="true">▶</span>
						{/if}
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm font-semibold text-neutral-100">{item.title}</span>
							<span class="mt-1 block truncate text-xs text-neutral-400">{item.epTitle || tl($locale, 'Continue watching')}</span>
						</span>
					</button>
				{/each}
			</div>
		</div>
	{:else}
		<div class="mt-7 flex flex-wrap items-center justify-center gap-2 text-xs text-neutral-500">
			<span>{tl($locale, 'No recommendations until you search.')}</span>
			<span aria-hidden="true">·</span>
			<button type="button" onclick={() => nav.openHistory()} class="min-h-10 px-2 text-neutral-300 hover:text-white focus-visible:outline-2 focus-visible:outline-brand">{tl($locale, 'Watch history')}</button>
			<button type="button" onclick={() => nav.openBookmarks()} class="min-h-10 px-2 text-neutral-300 hover:text-white focus-visible:outline-2 focus-visible:outline-brand">{tl($locale, 'Bookmarks')}</button>
		</div>
	{/if}
</section>