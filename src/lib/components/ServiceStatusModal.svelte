<script lang="ts">
	import type { AvailabilityView } from '$lib/service-status';
	import { locale, translate as tl, healthCopy } from '$lib/i18n';

	let { open, view, onRetry, onClose }: {
		open: boolean;
		view: AvailabilityView;
		onRetry: () => void;
		onClose: () => void;
	} = $props();
	let dialog = $state<HTMLDialogElement>();
	const message = $derived(healthCopy($locale, view.state));

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});
</script>

<dialog bind:this={dialog} lang={$locale} aria-labelledby="service-dialog-title" aria-describedby="service-dialog-description"
	oncancel={(event) => { event.preventDefault(); onClose(); }}
	onclose={() => { if (open) onClose(); }}
	class="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-neutral-700 bg-ink-soft p-0 text-neutral-100 shadow-2xl">
	<div class="p-6 sm:p-8" style="word-break: keep-all; overflow-wrap: anywhere">
		<div class="mb-5 flex items-center justify-between gap-4">
			<span class="rounded-full border border-neutral-700 bg-neutral-800 px-3 py-1 text-xs font-semibold text-neutral-300">{tl($locale, 'Service connection notice')}</span>
			<button type="button" onclick={onClose} aria-label={tl($locale, "Close notice")} class="min-h-11 min-w-11 rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white focus-visible:outline-2 focus-visible:outline-brand">{tl($locale, 'Close')}</button>
		</div>
		<div role="status" aria-live="polite">
			<h2 id="service-dialog-title" class="text-xl font-bold tracking-tight sm:text-2xl">{message[0]}</h2>
			<p id="service-dialog-description" class="mt-4 text-sm leading-relaxed text-neutral-300">{message[1]}</p>
		</div>
		<p class="mt-4 text-sm leading-relaxed text-neutral-400">{tl($locale, 'New searches, video information requests, and playback are temporarily paused. Your bookmarks and watch history are safe.')}</p>
		{#if view.state !== 'offline'}
			<p class="mt-3 text-xs leading-relaxed text-neutral-500">{tl($locale, 'We check about every 30 seconds while this page is open. The notice closes automatically on recovery.')}</p>
		{/if}
		<div class="mt-6 flex flex-wrap gap-3">
			<button type="button" onclick={onRetry} disabled={view.checking || view.state === 'offline'} class="min-h-11 flex-1 rounded-lg bg-brand px-5 py-3 text-sm font-semibold text-white hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50">{tl($locale, view.checking ? 'Checking…' : 'Check again')}</button>
			<button type="button" onclick={onClose} class="min-h-11 flex-1 rounded-lg border border-neutral-600 px-5 py-3 text-sm font-semibold hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-brand">{tl($locale, 'Dismiss')}</button>
		</div>
		<p class="mt-3 text-xs text-neutral-500">{tl($locale, 'Closing the notice does not enable new requests until the service recovers.')}</p>
	</div>
</dialog>

<style>
	dialog::backdrop { background: rgb(0 0 0 / 80%); backdrop-filter: blur(4px); }
</style>
