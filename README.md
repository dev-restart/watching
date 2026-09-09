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

## Verification

```bash
pnpm test
pnpm check
pnpm build
```

`tests/detail-sharing.test.ts` covers share-link parsing and cleanup, fresh-recipient API access with mocked responses, and clipboard success/failure paths. For browser smoke testing, copy a detail link into a private window, refresh it, return home, and confirm ordinary search plus bookmark imports still work. Also check the modal on a narrow mobile viewport and with clipboard permission denied.

Episode pagination regression tests are in `tests/episode-list.test.ts` and `tests/episode-pagination.test.ts`. They use synthetic HTML/JSON matching the supplied source template, including the 60 + 52 scenario, and mocked network responses. They also cover continuation limits, partial failures/retry offsets, deduplication, cancellation, and cross-host/cross-series link rejection. They do not constitute a live upstream or browser playback test.

## Keyboard shortcuts

Active when not typing in an input and no modal is open. The home screen shows the main shortcuts under the search box.

| Key          | Action                          |
| ------------ | ------------------------------- |
| `/`          | Open search                     |
| `H`          | Open history                    |
| `B`          | Open bookmarks                  |
| `Backspace`  | Go back (on the detail page)    |
| `Esc`        | Close modal                     |
