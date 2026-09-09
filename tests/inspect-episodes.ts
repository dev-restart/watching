// Read-only upstream pagination diagnostics. Never runs downloaded JavaScript,
// requests playback tokens, reads local credentials, or writes fetched content.
// pnpm inspect:episodes checks the reported page configured in package.json.
// Other pages: node --experimental-strip-types tests/inspect-episodes.ts <public-url>
import * as cheerio from 'cheerio';

const MAX_BYTES = 2_000_000;
const MAX_OUTPUT = 24_000;
let outputRemaining = MAX_OUTPUT;

function report(label: string, value: string): void {
	if (outputRemaining <= 0) return;
	const text = `${label}\n${value}\n`.slice(0, outputRemaining);
	console.log(text);
	outputRemaining -= text.length;
}

async function readPublicText(url: URL, referer?: URL): Promise<string> {
	const response = await fetch(url, {
		redirect: 'error',
		signal: AbortSignal.timeout(15_000),
		headers: { Accept: 'text/html, application/javascript, */*;q=0.1', ...(referer ? { Referer: referer.href } : {}) }
	});
	if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}.`);
	const reader = response.body?.getReader();
	if (!reader) throw new Error('Upstream returned no body.');
	const decoder = new TextDecoder();
	let size = 0;
	let text = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) return text + decoder.decode();
			size += value.byteLength;
			if (size > MAX_BYTES) throw new Error('Upstream response exceeded the diagnostic size limit.');
			text += decoder.decode(value, { stream: true });
		}
	} finally {
		await reader.cancel();
	}
}

function paginationSnippets(script: string): string {
	const relevant = /other_list|data-ep-idx|loadMoreEpisodes|load_more_episodes/gi;
	const ranges: { start: number; end: number }[] = [];
	for (const match of script.matchAll(relevant)) {
		const start = Math.max(0, match.index - 1800);
		const end = Math.min(script.length, match.index + 6000);
		const previous = ranges.at(-1);
		if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
		else ranges.push({ start, end });
	}
	return ranges.map(({ start, end }) => script.slice(start, end)).join('\n[...pagination excerpt...]\n');
}

async function main(): Promise<void> {
	const argument = process.argv[2];
	if (!argument) throw new Error('Pass the public source episode URL as the only argument.');
	const page = new URL(argument);
	if (!/^https?:$/.test(page.protocol) || page.username || page.password) throw new Error('An HTTP(S) URL without credentials is required.');
	const html = await readPublicText(page);
	const $ = cheerio.load(html);
	report('PAGE', $('title').text());
	report('INITIAL EPISODES', JSON.stringify({
		count: $('#other_list li[data-ep-idx]').length,
		first: $('#other_list li[data-ep-idx]').first().find('a.title').text().trim(),
		last: $('#other_list li[data-ep-idx]').last().find('a.title').text().trim()
	}));
	const controls = $('#other_list').clone();
	controls.find('li[data-ep-idx], script, iframe').remove();
	report('LIST CONTROLS', controls.toString().slice(0, 4000));
	let inlineFound = false;
	$('script:not([src])').each((_, element) => {
		const snippet = paginationSnippets($(element).text());
		if (snippet) { inlineFound = true; report('INLINE PAGINATION', snippet); }
	});
	const scriptUrls = $('script[src]').map((_, el) => $(el).attr('src') || '').get()
		.map((src) => new URL(src, page)).filter((url) => url.origin === page.origin);
	report('SAME-ORIGIN SCRIPT PATHS', scriptUrls.map((url) => url.pathname).join('\n'));
	// Most templates use inline pagination; only inspect up to four named board/episode scripts otherwise.
	if (!inlineFound) {
		for (const scriptUrl of scriptUrls.filter((url) => /episode|board|view/i.test(url.pathname)).slice(0, 4)) {
			const snippet = paginationSnippets(await readPublicText(scriptUrl, page));
			if (snippet) report(`SCRIPT ${scriptUrl.pathname}`, snippet);
		}
	}
	if (!$('#other_list li[data-ep-idx]').length) throw new Error('No episode list found; the source may be unavailable or require a browser capture.');
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	if (error instanceof Error && error.cause) console.error('Network cause:', error.cause);
	process.exitCode = 1;
});
