<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { copyDetailShareLink, createDetailShareUrl } from '$lib/client/detail-sharing';
	import { trapFocus } from '$lib/client/modal';

	let { detailKey, title, onClose, onCopied = () => {} }: {
		detailKey: string;
		title: string;
		onClose: () => void;
		onCopied?: () => void;
	} = $props();

	let shareUrl = $state('');
	let errorMessage = $state('');
	let copying = $state(false);
	let linkInput = $state<HTMLInputElement>();
	let active = true;

	onMount(() => {
		try {
			shareUrl = createDetailShareUrl(detailKey, window.location.href);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unable to create a share link.';
		}
	});

	onDestroy(() => { active = false; });

	function close() {
		if (!active) return;
		active = false;
		onClose();
	}

	async function copyLink() {
		if (!active || copying || !linkInput || !shareUrl) return;
		copying = true;
		errorMessage = '';
		try {
			await copyDetailShareLink(linkInput);
			if (!active) return;
			onCopied();
			close();
		} catch (error) {
			if (active) errorMessage = error instanceof Error ? error.message : 'Unable to copy the link.';
		} finally {
			if (active) copying = false;
		}
	}

	function onKey(event: KeyboardEvent) {
		if (active && event.key === 'Escape') {
			event.preventDefault();
			close();
		}
	}

	function backdrop(event: MouseEvent) {
		if (event.target === event.currentTarget) close();
	}
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm" transition:fade={{ duration: 150 }} onclick={backdrop} role="presentation">
	<div class="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-neutral-800 bg-ink-soft shadow-2xl" transition:fly={{ y: 12, duration: 150 }} use:trapFocus tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="detail-share-title" aria-describedby="detail-share-description">
		<div class="flex items-center justify-between gap-3 border-b border-neutral-800 px-5 py-4">
			<h2 id="detail-share-title" class="text-base font-semibold text-neutral-100">Share video</h2>
			<button type="button" onclick={close} aria-label="Close share dialog" title="Close (Esc)" class="rounded-md p-2 text-neutral-400 transition hover:bg-neutral-800 hover:text-white focus-visible:outline-2 focus-visible:outline-brand">
				<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
			</button>
		</div>
		<div class="p-5">
			<p class="break-words text-sm font-semibold text-neutral-100">{title}</p>
			<p id="detail-share-description" class="mt-2 text-sm leading-relaxed text-neutral-400">Open this link to view the video details without searching. Playback starts only when you choose to play.</p>
			<label for="detail-share-url" class="mt-5 block text-xs font-medium text-neutral-400">Video link</label>
			<div class="mt-2 flex items-stretch gap-2">
				<input id="detail-share-url" bind:this={linkInput} value={shareUrl} readonly spellcheck="false" onfocus={(event) => event.currentTarget.select()} class="min-h-11 min-w-0 flex-1 rounded-md border border-neutral-700 bg-black px-3 py-2 text-base text-neutral-200 focus:border-brand focus:outline-none sm:text-sm" />
				<button type="button" onclick={copyLink} disabled={copying || !shareUrl} class="min-h-11 shrink-0 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50">{copying ? 'Copying…' : 'Copy'}</button>
			</div>
			{#if errorMessage}
				<p class="mt-3 text-sm text-rose-300" role="alert">{errorMessage}</p>
			{/if}
		</div>
	</div>
</div>
