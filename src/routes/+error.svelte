<script lang="ts">
	import { locale, translate as tl } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	function goBack() {
		if (window.history.length > 1) {
			window.history.back();
		} else {
			void goto('/');
		}
	}
</script>

<svelte:head>
	<title>{page.status === 404 ? tl($locale, 'Page not found') : tl($locale, 'Something went wrong')} — Watching</title>
</svelte:head>

<section class="flex min-h-[68vh] items-center justify-center px-4 py-20 sm:px-6">
	<div class="w-full max-w-xl text-center">
		<div class="mb-7 inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-brand">
			<span class="h-2 w-2 rounded-full bg-brand shadow-[0_0_14px_rgba(229,9,20,0.8)]"></span>
			{page.status === 404 ? 'Route not found' : `Error ${page.status}`}
		</div>

		<h1 class="text-3xl font-extrabold tracking-tight text-neutral-50 sm:text-5xl">
			{page.status === 404 ? 'This page does not exist.' : 'We could not load this page.'}
		</h1>
		<p class="mx-auto mt-4 max-w-md text-sm leading-6 text-neutral-400 sm:text-base">
			{page.status === 404
				? 'The address may be incorrect, or the page may have moved. Go back and try again.'
				: 'Try again in a moment, or return to the previous page.'}
		</p>

		<div class="mt-8 flex flex-wrap items-center justify-center gap-3">
			<button
				type="button"
				onclick={goBack}
				class="inline-flex min-w-44 items-center justify-center gap-2 rounded-lg bg-brand px-5 py-3 text-sm font-bold text-white transition hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
			>
				<span aria-hidden="true">←</span>
				Go back
			</button>
			<a
				href="/"
				class="inline-flex min-w-32 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900/70 px-5 py-3 text-sm font-semibold text-neutral-300 transition hover:border-neutral-500 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-400"
			>
				Go home
			</a>
		</div>
	</div>
</section>
