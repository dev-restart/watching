// Reload the current address, including a shared-detail fragment. Never replace it with '/'.
document.getElementById('offline-retry')?.addEventListener('click', () => window.location.reload());
window.addEventListener('online', () => window.location.reload(), { once: true });
