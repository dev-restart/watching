<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { getContext } from 'svelte';
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

	const nav = getContext<{ showDetail: (k: string, o?: { poster?: string; synopsis?: string }) => void }>('nav');

	let query = $state('');
	let inputEl = $state<HTMLInputElement>();
	let loading = $state(false);
	let errorMsg = $state('');
	let results = $state<SearchResult[]>([]);
	let touched = $state(false);
	let recents = $state<string[]>([]);
	let activeCat = $state('All');
	let timer: ReturnType<typeof setTimeout> | undefined;

	const cats = $derived(['All', ...Array.from(new Set(results.map((r) => r.category).filter(Boolean)))]);
	const filtered = $derived(activeCat === 'All' ? results : results.filter((r) => r.category === activeCat));

	// When opened, seed the query, auto-run when present, focus the input, load recents.
	$effect(() => {
		if (open) {
			query = initialQuery;
			results = [];
			errorMsg = '';
			touched = false;
			activeCat = 'All';
			recents = loadRecentQueries();
			if (initialQuery.trim()) runSearch();
			queueMicrotask(() => inputEl?.focus());
		}
	});

	async function runSearch() {
		const q = query.trim();
		if (!q) {
			results = [];
			touched = false;
			return;
		}
		loading = true;
		errorMsg = '';
		activeCat = 'All';
		try {
			const res = await fetch('/api/search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ query: q })
			});
			if (!res.ok) {
				const j = await res.json().catch(() => ({}));
				throw new Error(j.message || `Search failed (${res.status})`);
			}
			const data = await res.json();
			results = data.results;
			touched = true;
			addRecentQuery(q);
			recents = loadRecentQueries();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e);
			results = [];
		} finally {
			loading = false;
		}
	}

	function onInput() {
		clearTimeout(timer);
		timer = setTimeout(runSearch, 300);
	}

	function pick(r: SearchResult) {
		onClose();
		nav?.showDetail(r.detailKey, { poster: r.thumbnail, synopsis: r.synopsis });
	}

	function useRecent(q: string) {
		query = q;
		runSearch();
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
	function backdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}

	// --- Voice search via Web Speech API (shown only when the browser supports it) ---
	let speechSupported = $state(false);
	let listening = $state(false);
	let recognition: any = undefined;
	$effect(() => {
		if (typeof window === 'undefined') return;
		const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
		if (!SR) return;
		speechSupported = true;
		const rec = new SR();
		rec.lang = 'ko-KR';
		rec.interimResults = false;
		rec.maxAlternatives = 1;
		rec.onresult = (e: any) => {
			const text = e.results?.[0]?.[0]?.transcript;
			if (text) {
				query = text;
				runSearch();
			}
		};
		rec.onend = () => (listening = false);
		rec.onerror = () => (listening = false);
		recognition = rec;
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
			role="dialog"
			aria-modal="true"
		>
			<div class="flex shrink-0 items-center gap-4 border-b border-neutral-800 px-6 py-5">
				<svg class="h-7 w-7 shrink-0 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="11" cy="11" r="7" />
					<path d="m21 21-4.3-4.3" />
				</svg>
				<input
					bind:this={inputEl}
					bind:value={query}
					oninput={onInput}
					placeholder="Search titles..."
					class="flex-1 bg-transparent py-1 text-lg text-neutral-100 outline-none placeholder:text-neutral-500 sm:text-xl"
				/>
				{#if speechSupported}
					<button
						type="button"
						onclick={toggleVoice}
						title="Voice search"
						class="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-100 {listening ? 'animate-pulse text-brand' : ''}"
					>
						<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
							<path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
						</svg>
					</button>
				{/if}
				<button
					onclick={onClose}
					class="rounded px-2.5 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
				>
					Esc
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
							<button
								type="button"
								onclick={() => useRecent(q)}
								class="group flex items-center gap-1.5 rounded-full bg-neutral-800 px-3 py-1 text-xs text-neutral-300 transition hover:bg-neutral-700"
							>
								{q}
								<span
									role="button"
									tabindex="0"
									onclick={(e) => { e.stopPropagation(); removeRecentQuery(q); recents = loadRecentQueries(); }}
									onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); removeRecentQuery(q); recents = loadRecentQueries(); } }}
									class="text-neutral-500 hover:text-rose-300"
									title="remove"
								>×</span>
							</button>
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
