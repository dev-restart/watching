<script lang="ts">
	import { onMount } from 'svelte';
	import { locale, translate as tl } from '$lib/i18n';
	import { createInstallPromptController, INSTALL_GUIDES, installPlatform, isStandalone } from '$lib/client/pwa-install';

	let { visible = true }: { visible?: boolean } = $props();
	const controller = createInstallPromptController();
	let mounted = $state(false);
	let installed = $state(false);
	let canPrompt = $state(false);
	let secure = $state(false);
	let busy = $state(false);
	let showGuide = $state(false);
	let message = $state('');
	let platform = $state<keyof typeof INSTALL_GUIDES>('other');

	onMount(() => {
		const mode = window.matchMedia('(display-mode: standalone)');
		const refreshMode = () => {
			installed = isStandalone(mode.matches, (navigator as Navigator & { standalone?: boolean }).standalone);
		};
		refreshMode();
		secure = window.isSecureContext;
		platform = installPlatform(navigator.userAgent, navigator.maxTouchPoints);
		mounted = true;
		const beforeInstall = (event: Event) => {
			if (controller.capture(event)) { canPrompt = true; message = ''; }
		};
		const afterInstall = () => {
			installed = true;
			canPrompt = false;
			showGuide = false;
			controller.clear();
		};
		window.addEventListener('beforeinstallprompt', beforeInstall);
		window.addEventListener('appinstalled', afterInstall);
		mode.addEventListener('change', refreshMode);
		return () => {
			mounted = false;
			controller.clear();
			window.removeEventListener('beforeinstallprompt', beforeInstall);
			window.removeEventListener('appinstalled', afterInstall);
			mode.removeEventListener('change', refreshMode);
		};
	});

	async function install() {
		if (busy) return;
		if (!secure || !controller.ready) { showGuide = !showGuide; return; }
		busy = true;
		message = '';
		try {
			const outcome = await controller.request();
			if (!mounted) return;
			message = outcome === 'accepted' ? 'Installation requested. Follow the instructions shown by your browser.' : 'Installation cancelled. You can install later from your browser menu.';
		} catch {
			if (mounted) { message = 'Could not open the install prompt. See the browser-specific instructions below.'; showGuide = true; }
		} finally {
			if (mounted) { busy = false; canPrompt = controller.ready; }
		}
	}
</script>

{#if mounted && visible && !installed}
	<section lang={$locale} aria-labelledby="pwa-install-title" class="mx-auto w-full max-w-3xl px-4 pt-3 pb-6 sm:px-6 sm:pt-5" style="word-break: keep-all; overflow-wrap: anywhere">
		<div class="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 sm:px-4">
			<div class="flex flex-wrap items-center gap-3">
				<img src="/icons/icon-192.png" alt="" width="36" height="36" class="h-9 w-9 shrink-0 rounded-lg" />
				<div class="min-w-0 flex-1 basis-40">
					<h2 id="pwa-install-title" class="text-sm font-semibold text-neutral-100">{tl($locale, 'Install WATCHING')}</h2>
					<p class="mt-1 text-xs leading-relaxed text-neutral-400">{tl($locale, 'Quick access from your home screen. Streaming requires internet.')}</p>
				</div>
				<button type="button" onclick={install} disabled={busy} aria-controls="pwa-install-guide" aria-expanded={showGuide} aria-label="Install WATCHING app" class="min-h-11 w-full shrink-0 rounded-lg border border-neutral-600 bg-neutral-800 px-5 py-2.5 text-sm font-semibold text-white transition hover:border-brand hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-wait disabled:opacity-50 sm:w-auto">{busy ? tl($locale, 'Checking installation…') : tl($locale, 'Install App')}</button>
			</div>
			<div id="pwa-install-guide" hidden={!showGuide} class="mt-4 border-t border-neutral-800 pt-4">
				<p class="text-sm leading-relaxed text-neutral-300">{tl($locale, secure ? INSTALL_GUIDES[platform] : 'App installation requires a secure HTTPS connection. Please open the HTTPS version of this site.')}</p>
				<p class="mt-2 text-xs leading-relaxed text-neutral-500">{tl($locale, 'Installation is optional. You can still use the website normally. Installing the app does not bypass server outages or enable offline video playback.')}</p>
			</div>
			{#if message}<p class="mt-3 text-sm text-neutral-300" role="status">{tl($locale, message)}</p>{/if}
		</div>
	</section>
{/if}
