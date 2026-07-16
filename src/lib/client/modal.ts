let activeScrollLocks = 0;
let previousBodyOverflow = '';

const FOCUSABLE_SELECTOR = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])'
].join(',');

function focusableElements(node: HTMLElement): HTMLElement[] {
	return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
		(element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true'
	);
}

/** Locks background scrolling, traps Tab focus, and restores focus when a modal closes. */
export function trapFocus(node: HTMLElement): { destroy(): void } {
	const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	if (activeScrollLocks === 0) {
		previousBodyOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
	}
	activeScrollLocks += 1;

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab') return;
		const focusable = focusableElements(node);
		if (!focusable.length) {
			event.preventDefault();
			node.focus();
			return;
		}

		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	node.addEventListener('keydown', onKeydown);
	queueMicrotask(() => {
		if (!node.contains(document.activeElement)) {
			(focusableElements(node)[0] || node).focus();
		}
	});

	return {
		destroy() {
			node.removeEventListener('keydown', onKeydown);
			activeScrollLocks = Math.max(0, activeScrollLocks - 1);
			if (activeScrollLocks === 0) document.body.style.overflow = previousBodyOverflow;
			if (previousFocus?.isConnected) previousFocus.focus();
		}
	};
}
