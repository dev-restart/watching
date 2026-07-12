// Build an image URL from a (possibly sealed) thumbnail value.
// - sealed token -> proxied through /api/img (original host hidden)
// - raw http(s) URL -> returned as-is (when IMG_PROXY=false)
export function imgUrl(thumbnail: string): string {
	if (!thumbnail) return '';
	if (/^https?:\/\//i.test(thumbnail)) return thumbnail;
	return `/api/img?key=${encodeURIComponent(thumbnail)}`;
}
