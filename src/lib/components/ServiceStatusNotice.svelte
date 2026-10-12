<script lang="ts">
	import type { AvailabilityView } from '$lib/service-status';
	import { locale, translate as tl, healthCopy, LOCALE_TAGS } from '$lib/i18n';

	let { view, onRetry, compact = false }: {
		view: AvailabilityView;
		onRetry: () => void;
		compact?: boolean;
	} = $props();

	const message = $derived(healthCopy($locale, view.state));
	const checkedTime = $derived(view.checkedAt === null ? '' : new Date(view.checkedAt).toLocaleTimeString(LOCALE_TAGS[$locale]));
</script>

<section lang={$locale} class={compact ? 'mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6' : 'flex min-h-[68vh] items-center justify-center px-4 py-12 sm:px-6'} aria-labelledby="service-status-title">
	<div class="w-full rounded-2xl border border-neutral-800 bg-neutral-900/60 {compact ? 'p-5' : 'max-w-xl p-7 text-center sm:p-10'}">
		<div class="{compact ? 'flex items-start gap-4' : ''}">
			<div class="{compact ? 'shrink-0' : 'mx-auto mb-6'} flex h-12 w-12 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800/70 text-neutral-300" aria-hidden="true">
				{#if view.checking || view.state === 'checking'}
					<svg class="h-6 w-6 motion-safe:animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" opacity="0.25" /><path d="M12 3a9 9 0 0 1 9 9" stroke-linecap="round" /></svg>
				{:else}
					<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 8a13 13 0 0 1 16 0M7 12a8 8 0 0 1 10 0M10 16a3 3 0 0 1 4 0M12 20h.01M3 3l18 18" /></svg>
				{/if}
			</div>
			<div class="min-w-0 flex-1">
				<div role="status" aria-live="polite">
					<h1 id="service-status-title" class="font-bold tracking-tight text-neutral-100 {compact ? 'text-base' : 'text-xl sm:text-2xl'}">{message[0]}</h1>
					<p class="mt-3 text-sm leading-relaxed text-neutral-400">{message[1]}</p>
				</div>
				{#if view.state !== 'checking' && view.state !== 'offline'}
					<p class="mt-2 text-xs leading-relaxed text-neutral-500">{tl($locale, 'This page checks again about every 30 seconds. You can continue without reloading after recovery.')}</p>
				{/if}
				{#if compact}
					<p class="mt-2 text-xs text-neutral-500">{tl($locale, 'The current video and loaded episodes remain available. New requests will resume after recovery.')}</p>
				{/if}
				<div class="mt-5 flex flex-wrap items-center gap-3 {compact ? '' : 'justify-center'}">
					<button type="button" onclick={onRetry} disabled={view.checking} class="min-h-11 rounded-lg border border-neutral-600 bg-neutral-800 px-5 py-2.5 text-sm font-semibold text-white transition hover:border-brand hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-wait disabled:opacity-50">{tl($locale, view.checking ? 'Checking…' : 'Check again')}</button>
					{#if checkedTime}<span class="text-xs text-neutral-500">{tl($locale, 'Last checked')} {checkedTime}</span>{/if}
				</div>
			</div>
		</div>
	</div>
</section>
