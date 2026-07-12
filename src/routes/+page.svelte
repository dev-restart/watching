<script lang="ts">
	import { getContext } from 'svelte';

	const nav = getContext<{ openSearch: (q?: string) => void; openHistory: () => void; openBookmarks: () => void }>('nav');
	function openSearch() {
		nav?.openSearch();
	}
	function openHistory() {
		nav?.openHistory();
	}
	function openBookmarks() {
		nav?.openBookmarks();
	}
</script>

<svelte:head>
	<title>Watching</title>
</svelte:head>

<!-- Hero -->
<section class="flex min-h-[78vh] items-center">
	<div class="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
		<h1 class="text-center text-3xl font-bold tracking-tight text-neutral-50 sm:text-5xl">
			Find something to watch.
		</h1>
		<p class="mx-auto mt-4 max-w-md text-center text-sm text-neutral-400 sm:text-base">
			Search across series and films, then play.
		</p>

		<div class="mx-auto mt-8 flex max-w-lg items-center gap-2">
			<button
				type="button"
				onclick={openSearch}
				class="flex flex-1 cursor-pointer items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3 text-left text-sm text-neutral-500 transition hover:border-neutral-700 hover:text-neutral-400"
			>
				<svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="11" cy="11" r="7" />
					<path d="m21 21-4.3-4.3" />
				</svg>
				<span>Search titles...</span>
			</button>
			<button
				type="button"
				onclick={openSearch}
				class="rounded-lg bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-dark"
			>
				Search
			</button>
		</div>

		<!-- Keyboard shortcuts -->
		<div class="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-neutral-500">
			<span class="hidden sm:inline uppercase tracking-wide text-neutral-600">Shortcuts</span>
			<button
				type="button"
				onclick={openSearch}
				class="flex items-center gap-1.5 transition hover:text-neutral-300"
			>
				<kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-neutral-700 bg-neutral-900 px-1.5 font-mono text-[11px] text-neutral-300">/</kbd>
				Search
			</button>
			<button
				type="button"
				onclick={openHistory}
				class="flex items-center gap-1.5 transition hover:text-neutral-300"
			>
				<kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-neutral-700 bg-neutral-900 px-1.5 font-mono text-[11px] text-neutral-300">H</kbd>
				History
			</button>
			<button
				type="button"
				onclick={openBookmarks}
				class="flex items-center gap-1.5 transition hover:text-neutral-300"
			>
				<kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-neutral-700 bg-neutral-900 px-1.5 font-mono text-[11px] text-neutral-300">B</kbd>
				Bookmarks
			</button>
		</div>
	</div>
</section>
