<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { getAppNavigation } from '$lib/app-navigation';
	import { loadHistory, removeHistory, clearHistory, formatWhen, type WatchEntry } from '$lib/history';
	import { imgUrl } from '$lib/img';

	let { open = false, onClose = () => {} }: { open?: boolean; onClose?: () => void } = $props();

	const nav = getAppNavigation();

	let history = $state<WatchEntry[]>([]);
	let selected = $state<Set<string>>(new Set());
	let query = $state('');
	let sortBy = $state<'recent' | 'title'>('recent');

	$effect(() => {
		if (open) {
			history = loadHistory();
			selected = new Set();
			query = '';
			sortBy = 'recent';
		}
	});

	const filtered = $derived(
		history
			.filter((e) => !query.trim() || e.title.toLowerCase().includes(query.trim().toLowerCase()))
			.slice()
			.sort((a, b) => (sortBy === 'title' ? a.title.localeCompare(b.title) : b.ts - a.ts))
	);

	const allSelected = $derived(
		filtered.length > 0 && filtered.every((entry) => selected.has(entry.id))
	);
	const hasSel = $derived(selected.size > 0);

	function toggle(id: string) {
		const s = new Set(selected);
		if (s.has(id)) s.delete(id);
		else s.add(id);
		selected = s;
	}
	function toggleAll() {
		const next = new Set(selected);
		for (const entry of filtered) {
			if (allSelected) next.delete(entry.id);
			else next.add(entry.id);
		}
		selected = next;
	}
	function removeSelected() {
		removeHistory(selected);
		history = loadHistory();
		selected = new Set();
	}
	function clearAll() {
		clearHistory();
		history = [];
		selected = new Set();
	}
	function resume(e: WatchEntry) {
		onClose();
		nav.showDetail({
			detailKey: e.detailKey,
			poster: e.poster,
			synopsis: e.synopsis,
			autoPlayEpIndex: e.epIndex
		});
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
	function backdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-start justify-center bg-black/85 p-4 backdrop-blur-sm sm:p-8"
		transition:fade={{ duration: 150 }}
		onclick={backdrop}
		role="presentation"
	>
		<div
			class="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-neutral-800 bg-ink-soft shadow-2xl"
			transition:fly={{ y: -20, duration: 200 }}
			role="dialog"
			aria-modal="true"
			aria-labelledby="history-title"
		>
			<!-- toolbar -->
			<div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-neutral-800 px-5 py-4">
				<h2 id="history-title" class="text-base font-semibold text-neutral-100">Watch history</h2>
				<span class="text-xs text-neutral-500">{history.length}</span>
				<div class="ml-auto flex flex-wrap items-center gap-3">
					<div class="flex items-center gap-1 overflow-hidden rounded-md border border-neutral-800 bg-neutral-900 px-1 py-0.5">
						<input
							bind:value={query}
							placeholder="Filter..."
							class="w-24 bg-transparent px-1.5 py-1 text-xs text-neutral-200 outline-none placeholder:text-neutral-600 sm:w-32"
						/>
						<div class="flex items-center text-[11px] text-neutral-500">
							<button
								type="button"
								onclick={() => (sortBy = 'recent')}
								class="px-1.5 py-1 {sortBy === 'recent' ? 'text-neutral-100' : 'hover:text-neutral-300'}"
							>Recent</button>
							<button
								type="button"
								onclick={() => (sortBy = 'title')}
								class="px-1.5 py-1 {sortBy === 'title' ? 'text-neutral-100' : 'hover:text-neutral-300'}"
							>Title</button>
						</div>
					</div>
					{#if filtered.length > 0}
						<label class="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-200">
							<input type="checkbox" checked={allSelected} onchange={toggleAll} class="h-4 w-4 accent-brand" />
							All
						</label>
					{/if}
					{#if hasSel}
						<button type="button" onclick={removeSelected} class="rounded px-2.5 py-1 text-xs text-rose-300 hover:bg-neutral-800">
							Delete ({selected.size})
						</button>
					{/if}
					{#if history.length > 0}
						<button type="button" onclick={clearAll} class="rounded px-2.5 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200">
							Clear all
						</button>
					{/if}
					<button type="button" onclick={onClose} class="rounded px-2.5 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200">Esc</button>
				</div>
			</div>

			<!-- grid -->
			<div class="min-h-[200px] flex-1 overflow-y-auto p-4 sm:p-5">
				{#if history.length === 0}
					<div class="py-16 text-center text-sm text-neutral-600">No watch history yet.</div>
				{:else if filtered.length === 0}
					<div class="py-16 text-center text-sm text-neutral-600">No matches.</div>
				{:else}
					<div class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
						{#each filtered as e (e.id)}
							<div class="group relative">
								<input
									type="checkbox"
									checked={selected.has(e.id)}
									onchange={() => toggle(e.id)}
									class="absolute left-2 top-2 z-10 h-5 w-5 accent-brand"
									aria-label="select"
								/>
								<button
									type="button"
									onclick={() => resume(e)}
									class="block aspect-[2/3] w-full overflow-hidden rounded-lg bg-neutral-800 text-left transition hover:ring-2 hover:ring-brand"
								>
									<div class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-neutral-700 to-neutral-900 text-2xl font-bold text-neutral-500">
										{e.title.slice(0, 1)}
									</div>
									{#if e.poster}
										<img
											src={imgUrl(e.poster)}
											alt={e.title}
											loading="lazy"
											onerror={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = 'none'; }}
											class="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
										/>
									{/if}
									<div class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-2 pt-8">
										<div class="line-clamp-2 text-xs font-semibold leading-tight text-white">{e.title}</div>
										{#if e.epTitle}
											<div class="mt-0.5 truncate text-[10px] text-neutral-300">{e.epTitle}</div>
										{/if}
										<div class="mt-1 text-[10px] tabular-nums text-neutral-400">{formatWhen(e.ts)}</div>
									</div>
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
