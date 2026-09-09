// Share the existing opaque detail key, never a playback session or source URL.
// Authentication of the key and source allowlisting remain in /api/episodes.
const MAX_DETAIL_KEY_LENGTH = 4096;
const DETAIL_KEY_PATTERN = /^(?:v1\.)?[A-Za-z0-9_-]{39,}$/;

export type DetailShareTarget =
	| { kind: 'none' }
	| { kind: 'invalid' }
	| { kind: 'detail'; detailKey: string };

function isDetailKey(value: string): boolean {
	return value.length <= MAX_DETAIL_KEY_LENGTH && value === value.trim() && DETAIL_KEY_PATTERN.test(value);
}

export function readDetailShare(hash: string): DetailShareTarget {
	const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
	const keys = params.getAll('watch');
	if (keys.length === 0) return { kind: 'none' };
	if (keys.length !== 1 || !isDetailKey(keys[0])) return { kind: 'invalid' };
	return { kind: 'detail', detailKey: keys[0] };
}

export function createDetailShareUrl(detailKey: string, currentUrl: string): string {
	if (!isDetailKey(detailKey)) throw new Error('Unable to create a link for this video.');
	const url = new URL(currentUrl);
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new Error('Sharing requires an HTTP or HTTPS app address.');
	}
	url.username = '';
	url.password = '';
	url.search = '';
	url.hash = new URLSearchParams({ watch: detailKey }).toString();
	return url.href;
}

/** Remove only the incoming detail link when resuming ordinary in-memory navigation. */
export function withoutDetailShare(currentUrl: string): URL {
	const url = new URL(currentUrl);
	const params = new URLSearchParams(url.hash.slice(1));
	if (params.has('watch')) {
		params.delete('watch');
		url.hash = params.toString();
	}
	return url;
}

/** Resolve only after copying succeeds; leave the visible field selected on failure. */
export async function copyDetailShareLink(input: HTMLInputElement): Promise<void> {
	try {
		if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(input.value);
			return;
		}
	} catch {
		// Some embedded browsers deny the modern API but still support a user-initiated copy.
	}

	if (input.isConnected) {
		input.focus();
		input.select();
		input.setSelectionRange(0, input.value.length);
		try {
			// Legacy fallback only; the Clipboard API above is the primary implementation.
			if (typeof document.execCommand === 'function' && document.execCommand('copy')) return;
		} catch {
			// Keep the selected URL available for manual copying.
		}
	}
	throw new Error('Unable to copy automatically. Copy the selected link manually or allow clipboard access.');
}
