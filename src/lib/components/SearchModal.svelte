<script lang="ts">
	import { tick } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { getAppNavigation } from '$lib/app-navigation';
	import { ApiError, isAbortError, searchTitles } from '$lib/client/api';
	import { trackEvent } from '$lib/client/analytics';
	import { trapFocus } from '$lib/client/modal';
	import type { SearchInputMethod } from '$lib/analytics';
	import type { SearchResult } from '$lib/types';
	import { imgUrl } from '$lib/img';
	import {
		loadRecentQueries,
		addRecentQuery,
		removeRecentQuery,
		clearRecentQueries
	} from '$lib/recent';

	let {
		open = false,
		initialQuery = '',
		onClose = () => {}
	}: { open?: boolean; initialQuery?: string; onClose?: () => void } = $props();

	const nav = getAppNavigation();

	let query = $state('');
	let inputEl = $state<HTMLInputElement>();
	let loading = $state(false);
	let errorMsg = $state('');
	let results = $state<SearchResult[]>([]);
	let touched = $state(false);
	let recents = $state<string[]>([]);
	let activeCat = $state('All');
	let timer: ReturnType<typeof setTimeout> | undefined;
	let searchController: AbortController | undefined;
	let searchVersion = 0;

	const cats = $derived(['All', ...Array.from(new Set(results.map((r) => r.category).filter(Boolean)))]);
	const filtered = $derived(activeCat === 'All' ? results : results.filter((r) => r.category === activeCat));

	interface SpeechRecognitionEventLike {
		results?: { [index: number]: { [index: number]: { transcript?: string } } };
	}

	interface SpeechRecognitionLike {
		lang: string;
		interimResults: boolean;
		maxAlternatives: number;
		onresult: ((event: SpeechRecognitionEventLike) => void) | null;
		onend: (() => void) | null;
		onerror: (() => void) | null;
		start(): void;
		stop(): void;
		abort(): void;
	}

	type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

	// When opened, seed the query, auto-run when present, focus the input, load recents.
	$effect(() => {
		if (!open) return;

		const seed = initialQuery;
		query = seed;
		results = [];
		errorMsg = '';
		touched = false;
		activeCat = 'All';
		recents = loadRecentQueries();
		if (seed.trim()) void runSearch(seed, 'initial');
		void tick().then(() => inputEl?.focus());

		return () => {
			clearTimeout(timer);
			searchVersion += 1;
			searchController?.abort();
		};
	});

	async function runSearch(searchQuery: string, inputMethod: SearchInputMethod) {
		clearTimeout(timer);
		timer = undefined;
		const q = searchQuery.trim();
		if (!q) {
			results = [];
			errorMsg = '';
			touched = false;
			loading = false;
			return;
		}

		searchController?.abort();
		const controller = new AbortController();
		searchController = controller;
		const version = ++searchVersion;
		loading = true;
		errorMsg = '';
		activeCat = 'All';
		try {
			const data = await searchTitles(q, controller.signal);
			if (version !== searchVersion) return;
			results = data.results;
			touched = true;
			addRecentQuery(q);
			recents = loadRecentQueries();
			void trackEvent({
				type: 'search_success',
				query: q,
				resultCount: data.results.length,
				inputMethod
			});
		} catch (e) {
			if (isAbortError(e) || version !== searchVersion) return;
			errorMsg = e instanceof Error ? e.message : String(e);
			results = [];
			void trackEvent({
				type: 'operation_error',
				operation: 'search',
				status: e instanceof ApiError ? e.status : undefined
			});
		} finally {
			if (version === searchVersion) loading = false;
		}
	}

	function onInput() {
		clearTimeout(timer);
		searchVersion += 1;
		searchController?.abort();
		loading = false;
		errorMsg = '';
		const nextQuery = query;
		if (!nextQuery.trim()) {
			results = [];
			touched = false;
			activeCat = 'All';
			return;
		}
		timer = setTimeout(() => void runSearch(nextQuery, 'typed'), 300);
	}

	function close() {
		clearTimeout(timer);
		timer = undefined;
		searchVersion += 1;
		searchController?.abort();
		recognition?.abort();
		listening = false;
		onClose();
	}

	function pick(r: SearchResult) {
		void trackEvent({
			type: 'search_result_open',
			contentId: r.contentId,
			title: r.title,
			category: r.category || undefined
		});
		close();
		nav.showDetail({ detailKey: r.detailKey, poster: r.thumbnail, synopsis: r.synopsis });
	}

	function useRecent(q: string) {
		query = q;
		void runSearch(q, 'recent');
	}

	function onKey(e: KeyboardEvent) {
		if (open && e.key === 'Escape') close();
	}
	function backdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) close();
	}

	// --- Voice search via Web Speech API (shown only when the browser supports it) ---
	let speechSupported = $state(false);
	let listening = $state(false);
	let recognition: SpeechRecognitionLike | undefined;
	$effect(() => {
		if (typeof window === 'undefined') return;
		const speechWindow = window as typeof window & {
			SpeechRecognition?: SpeechRecognitionConstructor;
			webkitSpeechRecognition?: SpeechRecognitionConstructor;
		};
		const SR = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
		if (!SR) return;
		speechSupported = true;
		const rec = new SR();
		rec.lang = 'ko-KR';
		rec.interimResults = false;
		rec.maxAlternatives = 1;
		rec.onresult = (e) => {
			const text = e.results?.[0]?.[0]?.transcript;
			if (text && open) {
				clearTimeout(timer);
				query = text;
				void runSearch(text, 'voice');
			}
		};
		rec.onend = () => (listening = false);
		rec.onerror = () => (listening = false);
		recognition = rec;

		return () => {
			rec.abort();
			rec.onresult = null;
			rec.onend = null;
			rec.onerror = null;
			if (recognition === rec) recognition = undefined;
		};
	});
	function toggleVoice() {
		if (!recognition) return;
		if (listening) {
			recognition.stop();
			listening = false;
		} else {
			try {
				recognition.start();
				listening = true;
			} catch {
				listening = false;
			}
		}
	}
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-start justify-center bg-black/85 p-4 backdrop-blur-sm sm:p-10"
		transition:fade={{ duration: 150 }}
		onclick={backdrop}
		role="presentation"
	>
		<div
			class="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-neutral-800 bg-ink-soft shadow-2xl"
			transition:fly={{ y: -20, duration: 200 }}
			use:trapFocus
			tabindex="-1"
			role="dialog"
			aria-modal="true"
			aria-label="Search titles"
		>
			<div class="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-3 py-3 sm:px-6 sm:py-5">
				<div class="flex h-11 min-w-0 flex-1 items-center rounded-lg border border-neutral-700 bg-neutral-900/70 px-2.5 transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
					<svg class="h-5 w-5 shrink-0 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="11" cy="11" r="7" />
						<path d="m21 21-4.3-4.3" />
					</svg>
					<input
						bind:this={inputEl}
						bind:value={query}
						oninput={onInput}
						placeholder="Search titles..."
						aria-label="Search titles"
						class="h-full min-w-0 flex-1 border-0 bg-transparent px-2 py-0 text-base text-neutral-100 outline-none placeholder:text-neutral-500 focus:ring-0 sm:text-xl"
					/>
					{#if speechSupported}
						<button
							type="button"
							onclick={toggleVoice}
							title="Voice search"
							aria-label="Voice search"
							aria-pressed={listening}
							class="grid h-9 w-9 shrink-0 place-items-center rounded-md text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-100 {listening ? 'animate-pulse text-brand' : ''}"
						>
							<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
								<path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
							</svg>
						</button>
					{/if}
				</div>
				<button
					type="button"
					onclick={close}
					aria-label="Cancel search"
					title="Cancel (Esc)"
					class="h-11 shrink-0 rounded-md px-1.5 text-sm font-medium text-neutral-300 transition hover:bg-neutral-800 hover:text-neutral-100 sm:px-2.5"
				>
					Cancel
				</button>
			</div>

			<div class="min-h-[160px] flex-1 overflow-y-auto p-2">
				{#if errorMsg}
					<div class="px-3 py-6 text-center text-sm text-rose-300">⚠ {errorMsg}</div>
				{:else if loading}
					<!-- skeleton -->
					<ul>
						{#each Array(5) as _}
							<li class="flex items-center gap-3 rounded-lg px-3 py-2">
								<div class="h-[72px] w-12 shrink-0 animate-pulse rounded bg-neutral-800"></div>
								<div class="flex-1 space-y-2">
									<div class="h-3 w-1/2 animate-pulse rounded bg-neutral-800"></div>
									<div class="h-2.5 w-2/3 animate-pulse rounded bg-neutral-800/70"></div>
								</div>
							</li>
						{/each}
					</ul>
				{:else if results.length > 0}
					{#if cats.length > 1}
						<div class="flex flex-wrap gap-1.5 px-2 pb-2">
							{#each cats as c}
								<button
									type="button"
									onclick={() => (activeCat = c)}
									class="rounded-full px-2.5 py-1 text-[11px] transition {activeCat === c ? 'bg-brand text-white' : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'}"
								>
									{c}
								</button>
							{/each}
						</div>
					{/if}
					<ul>
						{#each filtered as r (r.detailKey)}
							<li>
								<button
									type="button"
									onclick={() => pick(r)}
									class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-neutral-800"
								>
									<div class="h-[72px] w-12 shrink-0 overflow-hidden rounded bg-neutral-800">
										{#if r.thumbnail}
											<img src={imgUrl(r.thumbnail)} alt={r.title} loading="lazy" class="h-full w-full object-cover" />
										{/if}
									</div>
									<div class="min-w-0 flex-1">
										<div class="truncate text-sm font-medium text-neutral-100">{r.title}</div>
										<div class="mt-0.5 flex items-center gap-1.5 text-[11px] text-neutral-500">
											{#if r.category}<span class="rounded bg-neutral-800 px-1.5 py-0.5">{r.category}</span>{/if}
											{#if r.year}<span>{r.year}</span>{/if}
										</div>
										<p class="mt-0.5 line-clamp-1 text-xs text-neutral-500">{r.description}</p>
									</div>
								</button>
							</li>
						{/each}
					</ul>
				{:else if touched}
					<div class="px-3 py-10 text-center text-sm text-neutral-500">No results found.</div>
				{:else if recents.length}
					<div class="px-3 py-2 text-[11px] uppercase tracking-wide text-neutral-600">Recent</div>
					<div class="flex flex-wrap gap-2 px-3 pb-2">
						{#each recents as q (q)}
							<div class="flex items-center overflow-hidden rounded-full bg-neutral-800 text-xs text-neutral-300 transition hover:bg-neutral-700">
								<button type="button" onclick={() => useRecent(q)} class="py-1 pl-3 pr-1.5">
									{q}
								</button>
								<button
									type="button"
									onclick={() => { removeRecentQuery(q); recents = loadRecentQueries(); }}
									class="py-1 pl-1.5 pr-3 text-neutral-500 hover:text-rose-300"
									aria-label={`Remove ${q} from recent searches`}
								>×</button>
							</div>
						{/each}
						<button
							type="button"
							onclick={() => { clearRecentQueries(); recents = []; }}
							class="rounded-full px-2.5 py-1 text-[11px] text-neutral-500 hover:text-neutral-300"
						>
							Clear
						</button>
					</div>
				{:else}
					<div class="px-3 py-10 text-center text-sm text-neutral-600">Type a title to search.</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
