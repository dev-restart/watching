# Watching

A simple player to search and watch videos right away.

## Run

```bash
pnpm install
pnpm dev
```

Open the address shown in your browser. e.g. `http://localhost:5173`

## Features

### Search

1. Click the **Search** button (or the search box on the home screen).
2. Type a title — it searches automatically after ~0.3s.
3. If results span multiple categories, use the chips at the top to filter.
4. Select a title to open its detail page.

Extras:

- **Voice search** — tap the mic icon to search by voice (shown only in supporting browsers).
- **Recent queries** — recent searches appear before you type; click to re-run, `×` to remove individually, or `Clear` to remove all.

### Detail page

- **Series** — episodes appear as a poster grid; pick one to play.
- **Film** — press `Play` to start.
- Synopsis, poster, and background image are shown.
- The bookmark icon next to the title saves/removes the title.
- The **Share** icon beside it opens a dialog with the video link and a **Copy** button.

### Complete episode lists

The source's bottom list initially contains at most 60 rows. When its inline list script advertises pagination, the server reads that list's `total` and calls `/bbs/get_episode_list.php` with `bo_table`, `wr_id`, `offset` and `limit=60`. This is the list endpoint, not the single-episode `/bbs/get_episode.php` playback endpoint. The source hostname and series identifiers come from the already validated detail URL; no new environment setting is required.

For a 112-episode title, the first detail request combines the initial 60 rows with the remaining 52 from `offset=60`, deduplicates by episode ID, and returns the existing oldest-first order. The hidden player overlay is not treated as a complete list. Upstream scripts are parsed as text, never executed.

Each request fetches at most five additional list pages with a 20-second batch budget. Larger or partially unavailable lists show `loaded / total` and **Load earlier episodes** / **Retry earlier episodes** controls above and below the grid. Continuation uses the returned row offset and does not discard previously loaded episodes or replace their playback tokens. A network failure or repeated/empty premature page leaves a retryable partial result instead of incorrectly declaring the loaded rows to be the whole catalog.

### Share a video

Click **Share**, then **Copy**. The dialog closes only after copying succeeds, and the detail page shows `Link copied.` If automatic copying fails, the dialog stays open with an error and a selectable URL. `Esc`, the close button, and the backdrop also dismiss the dialog.

Send the copied app link to another person. Opening it loads the title and episode list directly through the existing detail API, without entering a search, importing bookmarks, or starting playback automatically. The recipient can choose an episode or press `Play` normally.

Ordinary search/detail navigation still uses in-memory state without changing the address. Shared links use `#watch=<opaque-detail-key>`; the fragment remains while viewing that shared detail so refresh works, and is removed when returning home or selecting another title. Existing `?bookmarkShare=...` import links remain separate.

The link contains the encrypted detail key, not the original source URL, a playback session, browsing history, or the sender's bookmarks. No new database collection or environment setting is needed. These links have no separate short-lived share-code expiry, but changing `PLAYER_TOKEN_SECRET` or removing the source content can invalidate them.

Use the deployed public app address to generate links for other people. A link created on `localhost` is only suitable for local testing. Modern clipboard access requires a supported secure browser context; a legacy copy fallback is attempted before showing the manual-copy error.

### Playback

- Selecting an episode (or film) opens an embedded player at the top.
- Playback is automatically added to **History**.
- If session creation fails, a message and a `Retry` button appear.
- Use `Close` on the player to dismiss it.

### History

Open via the **History** button.

- Click an item to resume from the last watched episode.
- Filter by title and sort by `Recent` / `Title`.
- Select via checkbox and `Delete`, or `Clear all`.

### Bookmarks

Open via the **Bookmarks** button.

- Save titles from the detail page using the bookmark icon.
- Click a title to open its detail page.
- Select via checkbox and `Delete`, or `Clear all`.

## Service availability

The app checks `POST /api/service-status` on startup and approximately every 30 seconds while the tab is visible and online. Navigation, opening search/detail and API failures also request a throttled recheck. The main screen waits for a validated status response before enabling search. A new failure opens a Korean native-dialog modal, with a persistent connection notice behind it, the latest completed status-check time, and a **다시 확인** button. Closing the modal with its close button or Escape does not unblock requests. Repeated polls of the same failure do not reopen a dismissed modal. Confirmed recovery closes the modal and restores normal use without reloading the page or clearing its shared-detail fragment.

A mounted detail/player stays mounted during an outage: its existing iframe and loaded episodes are not reset by health polling. New search, episode playback and additional-page requests are disabled until recovery. A shared detail waiting to open is retained, and an initial detail request that failed during an outage is retried on recovery. Already loaded details are not automatically reloaded. Local bookmark/history lists remain accessible; no stored data is deleted.

The notice distinguishes a confirmed upstream failure, the device reporting offline, failure to reach the app's own status API, and explicitly planned maintenance. A network error is not mislabeled as an information update. Optional server setting `SERVICE_MAINTENANCE=true` enables the **현재 서버 점검 중입니다** notice and blocks new upstream work without probing; ordinary upstream failures instead use **영상 서버에 연결할 수 없습니다**. To end planned maintenance, remove it or set it to `false` to resume real checks. Apply configuration changes through the deployment's normal restart/redeploy workflow. Ordinary automatic checks require no additional environment setting or database.

### Probe scope and operating limits

The server validates `SOURCE_ORIGIN`, `SEARCH_PATH`, `TOKEN_PATH` and optional `PLAYER_ORIGIN` formats. It makes a one-result search request and validates the JSON list contract, so an HTTP 200 maintenance/HTML page is not accepted as healthy. An empty valid search list is allowed. When configured, the player host receives a HEAD request to check basic network/TLS/server availability; a session-less root's 401/403/404/405 is tolerated. Playback sessions are not created as probes. A valid-looking but incorrect token endpoint, an unrelated reachable player host, individual deleted videos, iframe restrictions, media CDN failures and actual end-to-end playback are not fully validated by this check.

Probes have an eight-second budget and a 512 KB response limit. At most two same-origin redirects are followed; a redirect to a different hostname is not adopted automatically. An incorrect source hostname must be corrected by the operator; waiting does not repair a typo or discover a replacement site. Results are cached for 15 seconds per server process, with concurrent requests coalesced. This cache is not global across serverless instances/replicas. The client permits one status request at a time, throttles manual retries to five seconds, and stops polling in hidden/offline tabs. It has a 12-second status-request watchdog. Core API 5xx/network failures trigger a real probe rather than declaring an outage solely from one failed episode.

Inspect the app's `service-status` network response or server log `[service-status] <state> <reason>`. The transport uses HTTP 200 when a check completes even if `state` is `unavailable`; availability is in the JSON. Reasons are fixed codes (`configuration`, `connection`, `upstream`, `response`, `maintenance`, `ok`). Responses and transition logs do not expose source hosts, URLs, environment values or playback tokens. The existing same-origin/API-cookie checks also protect this endpoint.

### Server-side request gate

`src/lib/server/availability.ts` provides one health checker to the status endpoint and server hook. After existing same-origin/API-cookie validation, `src/hooks.server.ts` checks availability before running POST search/episodes/session handlers or GET/HEAD image-proxy handlers. A blocked request returns HTTP 503, a fixed `SERVICE_UNAVAILABLE` code, sanitized status, `Cache-Control: private, no-store` and `Retry-After: 30`. A checker exception also fails closed, but does not falsely diagnose an upstream outage. Status checks, local history/bookmarks and PWA assets remain accessible. This gate supplements, rather than replaces, authentication and each handler's normal validation.

A validated core API 503 immediately blocks new client actions and supersedes an older in-flight status request. Ordinary network/5xx failures without that envelope still request a real probe rather than inventing an outage. Health results and API requests share the 15-second process-local cache; therefore a newly occurring outage can remain undetected until the next check or cache expiry. The gate does not cancel work already in progress or control network requests inside an existing third-party iframe.

For a visitor who has never loaded the app, failure of the app's own DNS, hosting or initial HTML cannot be handled by this UI and still needs a separate hosting/edge fallback. Previously controlled PWA visits have the limited static fallback described below.

## Install as an app (PWA)

The first screen offers **앱 설치** when the browser provides a deferred installation prompt, otherwise **설치 방법** opens platform-specific instructions. The browser prompt is requested only from a user click and is single-use. Cancellation and prompt errors do not claim installation succeeded. The installation panel is hidden in standalone app mode and after an `appinstalled` event; ordinary web usage remains available without installing.

Guidance covers iPhone/iPad home-screen installation, Android browser installation menus and macOS Safari's Dock option. Native menus, prompt availability and wording depend on the browser/version. Serve the deployed app over HTTPS; localhost/loopback is suitable for development. No new environment values or paid installation service are required. The manifest uses a stable root identity, root start URL and standalone display mode, so installing from a shared-detail URL does not permanently pin that share link as the launch page.

`static/manifest.webmanifest` and layout metadata declare the app and its icons. `scripts/generate-pwa-icons.mjs` creates deterministic 180/192/512-pixel PNGs without an extra dependency. It runs before dev, build and tests; `pnpm pwa:icons` regenerates them separately.

SvelteKit builds/registers `src/service-worker.ts` for production. The worker caches only the explicit offline HTML/CSS/JavaScript, manifest and icon allowlist. It never caches app HTML, API responses, health results, playback sessions, proxy images or videos; range requests and other origins pass through unchanged. Controlled navigation uses the network first and shows the static **연결할 수 없습니다** page on a connection failure or server 5xx. This requires a previous successful worker installation. The retry action reloads the current address, including a shared-detail fragment. It does not implement offline video playback or offline browsing of the main app.

Worker updates do not force `skipWaiting`, a client reload or replacement of an active player. Old cache cleanup is confined to this app's `watching-pwa-` namespace and never deletes bookmark/history storage.

## Verification

```bash
pnpm test
pnpm check
pnpm build
```

`tests/detail-sharing.test.ts` covers share-link parsing and cleanup, fresh-recipient API access with mocked responses, and clipboard success/failure paths. For browser smoke testing, copy a detail link into a private window, refresh it, return home, and confirm ordinary search plus bookmark imports still work. Also check the modal on a narrow mobile viewport and with clipboard permission denied.

Episode pagination regression tests are in `tests/episode-list.test.ts` and `tests/episode-pagination.test.ts`. They use synthetic HTML/JSON matching the supplied source template, including the 60 + 52 scenario, and mocked network responses. They also cover continuation limits, partial failures/retry offsets, deduplication, cancellation, and cross-host/cross-series link rejection. They do not constitute a live upstream or browser playback test.

Availability regression tests in `tests/service-health.test.ts`, `tests/availability.test.ts` and `tests/upstream-gate.test.ts` cover configuration errors, DNS/TLS/network failures, invalid HTTP 200 responses, shared cache/coalescing, recovery, offline/hidden tabs, timeouts, cancellation, immediate validated 503 handling, modal transition policy and server-side request gating. `tests/pwa-install.test.ts` covers single-use deferred prompts, cancellation/errors, platform/standalone detection, the cache allowlist, manifest identity and actual PNG sizes. These are controlled unit/regression tests, not live upstream or native installation evidence.

On 2026-10-12, all 110 tests passed, Svelte checks reported zero errors/warnings, and the production/Vercel build completed. The build emitted non-fatal MongoDB optional-module tracing warnings. A production preview with process-only planned maintenance and MongoDB disabled passed real HTTP assertions: status endpoint 200/maintenance, protected search/episodes/session and image requests 503, cross-origin rejection 403, and all eight installation/offline/worker assets 200. The preview did not change `.env` or write to the application's database.

Browser checks at 1280 × 900 and 390 × 844 confirmed the maintenance dialog, close/Escape dismissal without restoring the search UI, continued background status checks without reopening the dismissed dialog, and expandable installation guidance. The managed browser blocks service-worker registration, so actual worker activation/offline transitions and native app installation were not verified. The separate mock-upstream server launch was denied by the tool, so browser outage-to-recovery and real video playback remain unverified; recovery behavior is covered by the automated tests.

For browser smoke testing in a non-production deployment: confirm the healthy home screen; test an invalid source host and restore it; enter/exit explicit maintenance mode; toggle the device offline/online; leave a shared-detail link open during recovery; and confirm a playing iframe does not remount when the status changes. Restore the test configuration afterward. Run `pnpm check` and `pnpm build` in the deployment environment before publishing.

## Keyboard shortcuts

Active when not typing in an input and no modal is open. The home screen shows the main shortcuts under the search box.

| Key          | Action                          |
| ------------ | ------------------------------- |
| `/`          | Open search                     |
| `H`          | Open history                    |
| `B`          | Open bookmarks                  |
| `Backspace`  | Go back (on the detail page)    |
| `Esc`        | Close modal                     |
