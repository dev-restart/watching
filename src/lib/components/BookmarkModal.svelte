<script lang="ts">
	import { tick } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { getAppNavigation } from '$lib/app-navigation';
	import { trackEvent } from '$lib/client/analytics';
	import { trapFocus } from '$lib/client/modal';
	import {
		clearBookmarks,
		loadBookmarks,
		mergeBookmarks,
		removeBookmarks,
		type Bookmark
	} from '$lib/bookmarks';
	import {
		createBookmarkShare,
		importBookmarkShare,
		validateBookmarkFile
	} from '$lib/client/bookmark-sharing';
	import { imgUrl } from '$lib/img';

	let {
		open = false,
		initialImportCode = '',
		onClose = () => {},
		onImportHandled = () => {}
	}: {
		open?: boolean;
		initialImportCode?: string;
		onClose?: () => void;
		onImportHandled?: () => void;
	} = $props();

	const nav = getAppNavigation();
	let bookmarks = $state<Bookmark[]>([]);
	let selected = $state<Set<string>>(new Set());
	let visibleCount = $state(60);
	let panel = $state<'share' | 'import' | null>(null);
	let busy = $state(false);
	let errorMessage = $state('');
	let resultMessage = $state('');
	let listNotice = $state('');
	let shareCode = $state('');
	let shareExpiresAt = $state(0);
	let remainingSeconds = $state(0);
	let importCode = $state('');
	let qrCanvas = $state<HTMLCanvasElement>();
	let scannerVideo = $state<HTMLVideoElement>();
	let scannerControls: { stop(): void } | undefined;
	let noticeTimer: number | undefined;
	let scanning = $state(false);
	let handledCode = '';

	const allSelected = $derived(bookmarks.length > 0 && selected.size === bookmarks.length);
	const hasSel = $derived(selected.size > 0);
	const visibleBookmarks = $derived(bookmarks.slice(0, visibleCount));
	const shareUrl = $derived(shareCode && typeof window !== 'undefined'
		? `${window.location.origin}/?bookmarkShare=${encodeURIComponent(shareCode)}`
		: '');

	$effect(() => {
		if (!open) {
			stopScanner();
			return;
		}
		resetTransientState();
		void refresh();
	});

	$effect(() => {
		if (!open || !initialImportCode || handledCode === initialImportCode) return;
		handledCode = initialImportCode;
		panel = 'import';
		importCode = normalizeCode(initialImportCode);
		void importFromCode();
	});

	$effect(() => {
		if (!shareExpiresAt) return;
		const update = () => remainingSeconds = Math.max(0, Math.ceil((shareExpiresAt - Date.now()) / 1000));
		update();
		const timer = window.setInterval(update, 1000);
		return () => window.clearInterval(timer);
	});

	async function refresh() {
		try {
			bookmarks = await loadBookmarks();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unable to load bookmarks.';
		}
	}

	function resetTransientState() {
		selected = new Set();
		visibleCount = 60;
		panel = null;
		busy = false;
		errorMessage = '';
		resultMessage = '';
		listNotice = '';
		if (noticeTimer) window.clearTimeout(noticeTimer);
		noticeTimer = undefined;
		shareCode = '';
		shareExpiresAt = 0;
		remainingSeconds = 0;
		importCode = '';
	}

	function normalizeCode(value: string): string {
		return value.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase();
	}

	function showImportSuccess(added: number, duplicates: number) {
		panel = null;
		errorMessage = '';
		resultMessage = '';
		listNotice = `Import complete — ${added.toLocaleString()} added · ${duplicates.toLocaleString()} duplicates skipped`;
		if (noticeTimer) window.clearTimeout(noticeTimer);
		noticeTimer = window.setTimeout(() => {
			listNotice = '';
			noticeTimer = undefined;
		}, 5000);
	}

	function countdown(seconds: number): string {
		const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
		const rest = (seconds % 60).toString().padStart(2, '0');
		return `${minutes}:${rest}`;
	}

	function toggle(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	function toggleAll() {
		selected = allSelected ? new Set() : new Set(bookmarks.map((bookmark) => bookmark.id));
	}

	async function removeSelected() {
		for (const bookmark of bookmarks) {
			if (selected.has(bookmark.id) && bookmark.contentId) {
				void trackEvent({ type: 'bookmark_remove', contentId: bookmark.contentId, title: bookmark.title });
			}
		}
		await removeBookmarks(selected);
		selected = new Set();
		await refresh();
	}

	async function clearAll() {
		if (!window.confirm('Clear all bookmarks? This cannot be undone.')) return;
		for (const bookmark of bookmarks) {
			if (bookmark.contentId) void trackEvent({ type: 'bookmark_remove', contentId: bookmark.contentId, title: bookmark.title });
		}
		await clearBookmarks();
		bookmarks = [];
		selected = new Set();
	}

	function openPanel(next: 'share' | 'import') {
		panel = panel === next ? null : next;
		errorMessage = '';
		resultMessage = '';
		if (next !== 'import') stopScanner();
	}

	async function createShare() {
		const targets = hasSel ? bookmarks.filter((bookmark) => selected.has(bookmark.id)) : bookmarks;
		if (!targets.length) return;
		busy = true;
		errorMessage = '';
		resultMessage = '';
		try {
			const result = await createBookmarkShare(targets);
			shareCode = result.code;
			shareExpiresAt = new Date(result.expiresAt).getTime();
			void trackEvent({ type: 'bookmark_share_create', itemCount: targets.length });
			await tick();
			if (qrCanvas) {
				const QRCode = await import('qrcode');
				await QRCode.toCanvas(qrCanvas, `${window.location.origin}/?bookmarkShare=${result.code}`, {
					width: 176,
					margin: 1,
					color: { dark: '#111111', light: '#ffffff' }
				});
			}
			resultMessage = `${targets.length.toLocaleString()} bookmarks ready to share.`;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unable to create a share code.';
		} finally {
			busy = false;
		}
	}

	async function copy(value: string, label: string) {
		try {
			await navigator.clipboard.writeText(value);
			resultMessage = `${label} copied.`;
		} catch {
			errorMessage = `Unable to copy ${label.toLowerCase()}.`;
		}
	}

	async function importFromCode() {
		const code = normalizeCode(importCode);
		importCode = code;
		if (code.length !== 6 || busy) return;
		busy = true;
		errorMessage = '';
		resultMessage = '';
		stopScanner();
		try {
			const result = await importBookmarkShare(code);
			await refresh();
			if (result.added > 0) void trackEvent({ type: 'bookmark_share_import', itemCount: result.added });
			showImportSuccess(result.added, result.duplicates);
			onImportHandled();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unable to import bookmarks.';
			onImportHandled();
		} finally {
			busy = false;
		}
	}

	function scannedCode(value: string): string {
		try {
			const url = new URL(value);
			if (url.origin === window.location.origin) return normalizeCode(url.searchParams.get('bookmarkShare') || '');
		} catch {
			// A QR may contain only the six-character code.
		}
		return normalizeCode(value);
	}

	async function startScanner() {
		if (scanning) return;
		errorMessage = '';
		scanning = true;
		await tick();
		try {
			const { BrowserQRCodeReader } = await import('@zxing/browser');
			const reader = new BrowserQRCodeReader();
			if (!scannerVideo) throw new Error('Camera preview is unavailable.');
			scannerControls = await reader.decodeFromConstraints(
				{ video: { facingMode: { ideal: 'environment' } } },
				scannerVideo,
				(result) => {
					if (!result) return;
					const code = scannedCode(result.getText());
					if (code.length !== 6) return;
					importCode = code;
					stopScanner();
					void importFromCode();
				}
			);
		} catch (error) {
			stopScanner();
			errorMessage = error instanceof Error ? error.message : 'Camera access is unavailable. Enter the code instead.';
		}
	}

	function stopScanner() {
		scannerControls?.stop();
		scannerControls = undefined;
		if (scannerVideo?.srcObject instanceof MediaStream) {
			for (const track of scannerVideo.srcObject.getTracks()) track.stop();
			scannerVideo.srcObject = null;
		}
		scanning = false;
	}

	function downloadJson() {
		const payload = {
			format: 'watching-bookmarks',
			version: 1,
			exportedAt: new Date().toISOString(),
			bookmarks
		};
		const link = document.createElement('a');
		link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
		const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
		link.download = `watching-bookmarks-${stamp}.json`;
		link.click();
		URL.revokeObjectURL(link.href);
		resultMessage = `${bookmarks.length.toLocaleString()} bookmarks downloaded.`;
	}

	async function importJson(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		busy = true;
		errorMessage = '';
		resultMessage = '';
		try {
			const payload: unknown = JSON.parse(await file.text());
			if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid bookmark file.');
			const data = payload as { format?: unknown; version?: unknown; bookmarks?: unknown };
			if (data.format !== 'watching-bookmarks' || data.version !== 1 || !Array.isArray(data.bookmarks)) {
				throw new Error('Unsupported bookmark file format.');
			}
			const validated = await validateBookmarkFile(data.bookmarks as Bookmark[]);
			const result = await mergeBookmarks(validated.map((bookmark, index) => ({ ...bookmark, ts: Date.now() - index })));
			await refresh();
			showImportSuccess(result.added, result.duplicates);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unable to import the bookmark file.';
		} finally {
			busy = false;
		}
	}

	function resume(bookmark: Bookmark) {
		onClose();
		nav.showDetail({ detailKey: bookmark.detailKey, poster: bookmark.poster, synopsis: bookmark.synopsis });
	}

	function close() {
		stopScanner();
		onClose();
	}

	function onKey(event: KeyboardEvent) {
		if (open && event.key === 'Escape') close();
	}

	function backdrop(event: MouseEvent) {
		if (event.target === event.currentTarget) close();
	}
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 flex items-start justify-center bg-black/85 p-4 backdrop-blur-sm sm:p-8" transition:fade={{ duration: 150 }} onclick={backdrop} role="presentation">
		<div class="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-neutral-800 bg-ink-soft shadow-2xl" transition:fly={{ y: -20, duration: 200 }} use:trapFocus tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="bookmarks-title">
			<div class="flex shrink-0 flex-col gap-3 border-b border-neutral-800 px-5 py-4">
				<div class="flex items-center gap-3">
					<h2 id="bookmarks-title" class="text-base font-semibold text-neutral-100">Bookmarks</h2>
					<span class="text-xs text-neutral-500">{bookmarks.length.toLocaleString()}</span>
				</div>
				<div class="flex w-full flex-wrap items-center gap-x-1.5 gap-y-2">
					<button type="button" onclick={() => openPanel('share')} disabled={!bookmarks.length} class="shrink-0 rounded-md border border-neutral-700 bg-neutral-900/70 px-2.5 py-1.5 text-[11px] font-medium text-neutral-300 transition hover:border-neutral-500 hover:bg-neutral-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">Share</button>
					<button type="button" onclick={() => openPanel('import')} class="shrink-0 rounded-md border border-neutral-700 bg-neutral-900/70 px-2.5 py-1.5 text-[11px] font-medium text-neutral-300 transition hover:border-neutral-500 hover:bg-neutral-800 hover:text-white">Import</button>
					{#if bookmarks.length > 0}
						<label class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900/70 px-2 py-1.5 text-[11px] font-medium text-neutral-300 transition hover:border-neutral-500 hover:bg-neutral-800 hover:text-white"><input type="checkbox" checked={allSelected} onchange={toggleAll} class="h-3.5 w-3.5 accent-brand" />Select all</label>
					{/if}
					{#if hasSel}<button type="button" onclick={removeSelected} class="shrink-0 rounded-md border border-rose-900/70 bg-rose-950/30 px-2.5 py-1.5 text-[11px] font-medium text-rose-300 transition hover:border-rose-700 hover:bg-rose-950/60">Delete ({selected.size})</button>{/if}
					{#if bookmarks.length > 0}<button type="button" onclick={clearAll} class="shrink-0 rounded-md border border-neutral-700 bg-neutral-900/70 px-2.5 py-1.5 text-[11px] font-medium text-neutral-300 transition hover:border-neutral-500 hover:bg-neutral-800 hover:text-white">Clear all</button>{/if}
					<button type="button" onclick={close} title="Close (Esc)" class="shrink-0 rounded-md border border-neutral-700 bg-neutral-900/70 px-2.5 py-1.5 text-[11px] font-medium text-neutral-300 transition hover:border-neutral-500 hover:bg-neutral-800 hover:text-white">Close</button>
				</div>
			</div>

			{#if panel}
				<section class="shrink-0 border-b border-neutral-800 bg-neutral-950/40 p-4 sm:px-5" aria-live="polite">
					{#if panel === 'share'}
						<div class="flex flex-col gap-4 sm:flex-row sm:items-start">
							<div class="flex-1">
								<h3 class="text-sm font-semibold text-neutral-100">Share bookmarks</h3>
								<p class="mt-1 text-xs text-neutral-500">{hasSel ? `${selected.size.toLocaleString()} selected` : `${bookmarks.length.toLocaleString()} total`} · one-time code · expires in 3 minutes</p>
								<div class="mt-3 flex flex-wrap gap-2">
									<button type="button" onclick={createShare} disabled={busy || !bookmarks.length} class="rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Creating…' : shareCode ? 'Create new code' : 'Create share code'}</button>
									<button type="button" onclick={downloadJson} disabled={!bookmarks.length} class="rounded-md border border-neutral-700 px-3 py-2 text-xs text-neutral-300">Download JSON</button>
								</div>
								{#if shareCode}
									<div class="mt-4 flex flex-wrap items-center gap-2">
										<code class="rounded-md border border-neutral-700 bg-black px-4 py-2 font-mono text-xl font-bold tracking-[0.25em] text-white">{shareCode}</code>
										<span class="text-xs {remainingSeconds > 0 ? 'text-neutral-400' : 'text-rose-300'}">{remainingSeconds > 0 ? `Expires in ${countdown(remainingSeconds)}` : 'Expired'}</span>
									</div>
									<div class="mt-3 flex gap-2"><button type="button" onclick={() => copy(shareCode, 'Code')} class="rounded-md border border-neutral-700 bg-neutral-900/70 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:border-neutral-500 hover:bg-neutral-800 hover:text-white">Copy code</button><button type="button" onclick={() => copy(shareUrl, 'Link')} class="rounded-md border border-neutral-700 bg-neutral-900/70 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:border-neutral-500 hover:bg-neutral-800 hover:text-white">Copy link</button></div>
								{/if}
							</div>
							{#if shareCode}<div class="flex shrink-0 self-center justify-center rounded-lg bg-white p-2 sm:self-start"><canvas bind:this={qrCanvas} class="block max-w-full" aria-label="Bookmark share QR code"></canvas></div>{/if}
						</div>
					{:else}
						<h3 class="text-sm font-semibold text-neutral-100">Import bookmarks</h3>
						<div class="mt-3 flex max-w-md gap-2">
							<label class="sr-only" for="share-code">Share code</label>
							<input id="share-code" value={importCode} oninput={(event) => importCode = normalizeCode(event.currentTarget.value)} onkeydown={(event) => { if (event.key === 'Enter') void importFromCode(); }} placeholder="6-character code" maxlength="6" class="min-w-0 flex-1 rounded-md border border-neutral-700 bg-black px-3 py-2 font-mono text-sm uppercase tracking-widest text-white" />
							<button type="button" onclick={importFromCode} disabled={busy || importCode.length !== 6} class="rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Importing…' : 'Import'}</button>
						</div>
						<div class="mt-3 flex flex-wrap gap-2">
							<button type="button" onclick={scanning ? stopScanner : startScanner} class="rounded-md border border-neutral-700 px-3 py-2 text-xs text-neutral-300">{scanning ? 'Stop camera' : 'Scan QR'}</button>
							<label class="cursor-pointer rounded-md border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:border-neutral-500">Import JSON file<input type="file" accept="application/json,.json" onchange={importJson} class="sr-only" /></label>
						</div>
						{#if scanning}<video bind:this={scannerVideo} autoplay muted playsinline class="mt-3 aspect-video w-full max-w-md rounded-lg bg-black object-cover"></video>{/if}
					{/if}
					{#if errorMessage}<p class="mt-3 text-xs text-rose-300">{errorMessage}</p>{/if}
					{#if resultMessage}<p class="mt-3 text-xs text-emerald-300">{resultMessage}</p>{/if}
				</section>
			{/if}

			<div class="min-h-[200px] flex-1 overflow-y-auto p-4 sm:p-5">
				{#if listNotice}
					<div class="mb-4 flex items-center gap-2 rounded-lg border border-emerald-800/70 bg-emerald-950/30 px-3 py-2.5 text-xs font-medium text-emerald-300" role="status">
						<svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
						<span>{listNotice}</span>
					</div>
				{/if}
				{#if bookmarks.length === 0}
					<div class="py-16 text-center text-sm text-neutral-600">No bookmarks yet. Enter a share code or import a JSON file to get started.</div>
				{:else}
					<div class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
						{#each visibleBookmarks as bookmark (bookmark.id)}
							<div class="group relative">
								<input type="checkbox" checked={selected.has(bookmark.id)} onchange={() => toggle(bookmark.id)} class="absolute left-2 top-2 z-10 h-5 w-5 accent-brand" aria-label={`Select ${bookmark.title}`} />
								<button type="button" onclick={() => resume(bookmark)} class="block aspect-[2/3] w-full overflow-hidden rounded-lg bg-neutral-800 text-left transition hover:ring-2 hover:ring-brand">
									<div class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-neutral-700 to-neutral-900 text-2xl font-bold text-neutral-500">{bookmark.title.slice(0, 1)}</div>
									{#if bookmark.poster}<img src={imgUrl(bookmark.poster)} alt={bookmark.title} loading="lazy" onerror={(event) => { (event.currentTarget as HTMLImageElement).style.display = 'none'; }} class="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105" />{/if}
									<div class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-2 pt-8"><div class="line-clamp-2 text-xs font-semibold leading-tight text-white">{bookmark.title}</div>{#if bookmark.category}<div class="mt-0.5 truncate text-[10px] text-neutral-300">{bookmark.category}</div>{/if}</div>
								</button>
							</div>
						{/each}
					</div>
					{#if visibleCount < bookmarks.length}<div class="mt-5 text-center"><button type="button" onclick={() => visibleCount += 60} class="rounded-md border border-neutral-700 px-4 py-2 text-xs text-neutral-300">Show more ({(bookmarks.length - visibleCount).toLocaleString()})</button></div>{/if}
				{/if}
			</div>
		</div>
	</div>
{/if}
