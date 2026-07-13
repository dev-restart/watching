<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { getAppNavigation } from '$lib/app-navigation';
	import { trackEvent } from '$lib/client/analytics';
	import { loadBookmarks, removeBookmarks, clearBookmarks, type Bookmark } from '$lib/bookmarks';
	import { imgUrl } from '$lib/img';

	let { open = false, onClose = () => {} }: { open?: boolean; onClose?: () => void } = $props();

	const nav = getAppNavigation();

	let bookmarks = $state<Bookmark[]>([]);
	let selected = $state<Set<string>>(new Set());

	$effect(() => {
		if (open) {
			bookmarks = loadBookmarks();
			selected = new Set();
		}
	});

	const allSelected = $derived(bookmarks.length > 0 && selected.size === bookmarks.length);
	const hasSel = $derived(selected.size > 0);

	function toggle(id: string) {
		const s = new Set(selected);
		if (s.has(id)) s.delete(id);
		else s.add(id);
		selected = s;
	}
	function toggleAll() {
		selected = allSelected ? new Set() : new Set(bookmarks.map((b) => b.id));
	}
	function removeSelected() {
		for (const bookmark of bookmarks) {
			if (selected.has(bookmark.id) && bookmark.contentId) {
				void trackEvent({
					type: 'bookmark_remove',
					contentId: bookmark.contentId,
					title: bookmark.title
				});
			}
		}
		removeBookmarks(selected);
		bookmarks = loadBookmarks();
		selected = new Set();
	}
	function clearAll() {
		for (const bookmark of bookmarks) {
			if (bookmark.contentId) {
				void trackEvent({
					type: 'bookmark_remove',
					contentId: bookmark.contentId,
					title: bookmark.title
				});
			}
		}
		clearBookmarks();
		bookmarks = [];
		selected = new Set();
	}
	function resume(b: Bookmark) {
		onClose();
		nav.showDetail({ detailKey: b.detailKey, poster: b.poster, synopsis: b.synopsis });
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
			aria-labelledby="bookmarks-title"
		>
			<div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-neutral-800 px-5 py-4">
				<h2 id="bookmarks-title" class="text-base font-semibold text-neutral-100">Bookmarks</h2>
				<span class="text-xs text-neutral-500">{bookmarks.length}</span>
				<div class="ml-auto flex flex-wrap items-center gap-3">
					{#if bookmarks.length > 0}
						<label class="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-200">
							<input type="checkbox" checked={allSelected} onchange={toggleAll} class="h-4 w-4 accent-brand" />
							Select all
						</label>
					{/if}
					{#if hasSel}
						<button type="button" onclick={removeSelected} class="rounded px-2.5 py-1 text-xs text-rose-300 hover:bg-neutral-800">
							Delete ({selected.size})
						</button>
					{/if}
					{#if bookmarks.length > 0}
						<button type="button" onclick={clearAll} class="rounded px-2.5 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200">
							Clear all
						</button>
					{/if}
					<button type="button" onclick={onClose} class="rounded px-2.5 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200">Esc</button>
				</div>
			</div>

			<div class="min-h-[200px] flex-1 overflow-y-auto p-4 sm:p-5">
				{#if bookmarks.length === 0}
					<div class="py-16 text-center text-sm text-neutral-600">No bookmarks yet.</div>
				{:else}
					<div class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
						{#each bookmarks as b (b.id)}
							<div class="group relative">
								<input
									type="checkbox"
									checked={selected.has(b.id)}
									onchange={() => toggle(b.id)}
									class="absolute left-2 top-2 z-10 h-5 w-5 accent-brand"
									aria-label="select"
								/>
								<button
									type="button"
									onclick={() => resume(b)}
									class="block aspect-[2/3] w-full overflow-hidden rounded-lg bg-neutral-800 text-left transition hover:ring-2 hover:ring-brand"
								>
									<div class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-neutral-700 to-neutral-900 text-2xl font-bold text-neutral-500">
										{b.title.slice(0, 1)}
									</div>
									{#if b.poster}
										<img
											src={imgUrl(b.poster)}
											alt={b.title}
											loading="lazy"
											onerror={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = 'none'; }}
											class="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
										/>
									{/if}
									<div class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-2 pt-8">
										<div class="line-clamp-2 text-xs font-semibold leading-tight text-white">{b.title}</div>
										{#if b.category}
											<div class="mt-0.5 truncate text-[10px] text-neutral-300">{b.category}</div>
										{/if}
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
