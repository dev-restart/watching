export interface InstallChoice { outcome: 'accepted' | 'dismissed'; platform?: string }
export interface InstallPromptEvent extends Event {
	prompt(): Promise<void | InstallChoice>;
	readonly userChoice: Promise<InstallChoice>;
}

/** A browser prompt is single-use and must be requested directly from a user gesture. */
export function createInstallPromptController() {
	let pending: InstallPromptEvent | null = null;
	return {
		capture(event: Event): boolean {
			const candidate = event as Partial<InstallPromptEvent>;
			if (event.type !== 'beforeinstallprompt' || typeof candidate.prompt !== 'function' ||
				typeof candidate.userChoice?.then !== 'function') return false;
			event.preventDefault();
			pending = event as InstallPromptEvent;
			return true;
		},
		clear() { pending = null; },
		get ready() { return pending !== null; },
		async request(): Promise<InstallChoice['outcome'] | 'unavailable'> {
			const event = pending;
			pending = null;
			if (!event) return 'unavailable';
			// No await before prompt(): preserve the trusted click's user activation.
			await event.prompt();
			return (await event.userChoice).outcome;
		}
	};
}

export function isStandalone(displayModeMatches: boolean, navigatorStandalone?: boolean): boolean {
	return displayModeMatches || navigatorStandalone === true;
}

export function installPlatform(userAgent: string, maxTouchPoints = 0): 'ios' | 'android' | 'mac-safari' | 'other' {
	if (/iPad|iPhone|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) return 'ios';
	if (/Android/i.test(userAgent)) return 'android';
	if (/Macintosh/i.test(userAgent) && /Safari/i.test(userAgent) && !/Chrome|Chromium|Edg|OPR/i.test(userAgent)) return 'mac-safari';
	return 'other';
}

export const INSTALL_GUIDES = {
	ios: 'Tap Share → Add to Home Screen → Add. If you cannot find this option, open the site in Safari.',
	android: 'In Chrome or Samsung Internet, open the browser menu and choose Install app or Add to Home screen. If you are using an in-app browser, open this page in your regular browser.',
	'mac-safari': 'In Safari, choose File → Add to Dock. If this option is unavailable, use the installation menu in Chrome or Edge.',
	other: 'Look for the install icon in your browser address bar or choose Install app from its menu. If you do not see the option, open this site in Chrome or Edge.'
} as const;
