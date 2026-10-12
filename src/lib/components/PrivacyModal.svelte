<script lang="ts">
	import { locale, translate as tl } from '$lib/i18n';
	import { fade, fly } from 'svelte/transition';
	import { trapFocus } from '$lib/client/modal';

	let { open = false, onClose = () => {} }: { open?: boolean; onClose?: () => void } = $props();

	function onKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') onClose();
	}

	function closeBackdrop(event: MouseEvent) {
		if (event.target === event.currentTarget) onClose();
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm sm:p-8"
		transition:fade={{ duration: 150 }}
		onclick={closeBackdrop}
		role="presentation"
	>
		<div
			class="max-h-full w-full max-w-3xl overflow-y-auto rounded-xl border border-neutral-800 bg-ink-soft shadow-2xl"
			transition:fly={{ y: 18, duration: 200 }}
			use:trapFocus
			tabindex="-1"
			role="dialog"
			aria-modal="true"
			aria-labelledby="data-collection-title"
		>
			<header class="border-b border-neutral-800 px-5 py-5 sm:px-7">
				<div class="flex items-start gap-4">
					<div class="min-w-0 flex-1">
						<p class="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-brand">
							{tl($locale, 'First-party data')}
						</p>
						<h2 id="data-collection-title" class="mt-2 text-2xl font-bold tracking-tight text-white">
							{tl($locale, 'Data collection details')}
						</h2>
						<p class="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
							{tl($locale, 'Watching stores limited usage data for service analytics and temporarily stores bookmark transfers when you explicitly create a share code.')} 
						</p>
					</div>
					<button
						type="button"
						onclick={onClose}
						class="rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-400 transition hover:border-neutral-500 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
						aria-label={tl($locale, "Close data collection details")}
						title="Close (Esc)"
					>
						Close
					</button>
				</div>
			</header>

			<div class="space-y-7 px-5 py-6 sm:px-7">
				<div class="grid overflow-hidden rounded-lg border border-neutral-800 sm:grid-cols-3">
					<div class="border-b border-neutral-800 p-4 sm:border-b-0 sm:border-r">
						<div class="font-mono text-2xl font-bold tabular-nums text-white">07</div>
						<div class="mt-1 text-xs font-semibold uppercase tracking-wide text-neutral-300">{tl($locale, 'days')}</div>
						<p class="mt-2 text-xs leading-5 text-neutral-500">{tl($locale, 'Access time, public IP, path and browser information.')}</p>
					</div>
					<div class="border-b border-neutral-800 p-4 sm:border-b-0 sm:border-r">
						<div class="font-mono text-2xl font-bold tabular-nums text-white">30</div>
						<div class="mt-1 text-xs font-semibold uppercase tracking-wide text-neutral-300">{tl($locale, 'days')}</div>
						<p class="mt-2 text-xs leading-5 text-neutral-500">{tl($locale, 'Raw search, title, playback and bookmark events.')}</p>
					</div>
					<div class="p-4">
						<div class="font-mono text-2xl font-bold tabular-nums text-white">365</div>
						<div class="mt-1 text-xs font-semibold uppercase tracking-wide text-neutral-300">{tl($locale, 'days')}</div>
						<p class="mt-2 text-xs leading-5 text-neutral-500">{tl($locale, 'Daily totals and popular search or content aggregates.')}</p>
					</div>
				</div>

				<div class="grid gap-6 sm:grid-cols-2">
					<div>
						<h3 class="text-sm font-semibold text-neutral-100">{tl($locale, 'What is collected')}</h3>
						<ul class="mt-3 space-y-2 text-sm leading-5 text-neutral-400">
							<li>• {tl($locale, 'Visit time, public IP, country or region, browser and requested path')}</li>
							<li>• {tl($locale, 'Search terms, result counts and selected search results')}</li>
							<li>• {tl($locale, 'Detail views and successful playback-session creation')}</li>
							<li>• {tl($locale, 'Bookmark additions or removals and history/bookmark panel opens')}</li>
							<li>• {tl($locale, 'Temporary bookmark-share data is deleted after its first import or within three minutes')}</li>
						</ul>
					</div>
					<div>
						<h3 class="text-sm font-semibold text-neutral-100">{tl($locale, 'What is not collected')}</h3>
						<ul class="mt-3 space-y-2 text-sm leading-5 text-neutral-400">
							<li>• {tl($locale, 'Names, email addresses or account information')}</li>
							<li>• {tl($locale, 'Raw source URLs, playback URLs or playback keys')}</li>
							<li>• {tl($locale, 'Share codes or bookmark contents in analytics events')}</li>
							<li>• {tl($locale, 'Video duration, completion rate or activity inside the external player')}</li>
						</ul>
					</div>
				</div>

				<div class="rounded-lg bg-neutral-900/70 p-4 text-xs leading-5 text-neutral-400">
					<p>
						{tl($locale, 'Raw IP addresses are kept separately from activity events. Activity uses a one-way daily rotating identifier. Data is stored in a private MongoDB Atlas cloud database and may be processed outside Korea. Expired records are removed automatically.')}
					</p>
				</div>
			</div>

			<footer class="flex justify-end border-t border-neutral-800 px-5 py-4 sm:px-7">
				<button
					type="button"
					onclick={onClose}
					class="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
				>
					Close
				</button>
			</footer>
		</div>
	</div>
{/if}
