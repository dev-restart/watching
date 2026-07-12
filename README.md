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

## Keyboard shortcuts

Active when not typing in an input and no modal is open. The home screen shows the main shortcuts under the search box.

| Key          | Action                          |
| ------------ | ------------------------------- |
| `/`          | Open search                     |
| `H`          | Open history                    |
| `B`          | Open bookmarks                  |
| `Backspace`  | Go back (on the detail page)    |
| `Esc`        | Close modal                     |
