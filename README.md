# Sidekick AI

A Chrome extension that summarizes English technical documents directly in your browser using Chrome Built-in AI (Gemini Nano) — no external API calls, no data leaves your machine.

## Summary Format

Every summary is structured as exactly three lines:

| Field | Description |
|---|---|
| **結論** (Conclusion) | The core finding or value proposition |
| **背景** (Background) | The problem being solved or motivation |
| **ネクストアクション** (Next Action) | What you should do or consider next |

## Supported Pages

- GitHub — README, Issues, Pull Requests, file views
- arXiv — abstract pages and HTML full-paper views
- Hacker News — article + top comments
- Tech blogs and documentation — Medium, Zenn, dev.to, and any page with a `<main>` or `<article>` element

## Requirements

- Chrome 127 or later
- Chrome Built-in AI (Gemini Nano) enabled (see setup below)

## Setup

### 1. Enable Chrome Built-in AI

Open each URL in Chrome and apply the setting shown:

| URL | Setting |
|---|---|
| `chrome://flags/#prompt-api-for-gemini-nano` | **Enabled** |
| `chrome://flags/#optimization-guide-on-device-model` | **Enabled BypassPerfRequirement** |

After saving the flags, restart Chrome.

Then go to `chrome://components`, find **Optimization Guide On Device Model**, and click **Check for update**. Wait for the model to finish downloading (this may take a few minutes depending on your connection).

You can verify the model is ready at `chrome://on-device-internals`.

### 2. Load the Extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `sidekick-ai/` folder

The `✦ Sidekick AI` icon will appear in the Chrome toolbar.

## Usage

1. Open any technical document (GitHub repo, arXiv paper, tech blog, etc.)
2. Click the **✦ Sidekick AI** icon in the toolbar — the Side Panel opens on the right
3. Click the **▶ 要約** button
4. The summary streams in within a few seconds
5. Use the **コピー** button to copy the three lines to your clipboard

To re-summarize the same page (e.g., after scrolling to a new section), click **↺ 再要約**.

## How It Works

```
Toolbar click
    └── Side Panel opens
            └── "要約" button click
                    ├── content.js extracts main text from the active tab DOM
                    ├── window.ai.languageModel.capabilities() checks model status
                    ├── Session created with a structured Japanese output prompt
                    └── promptStreaming() streams result into three cards
```

All processing runs locally via `window.ai.languageModel` (Chrome Prompt API). Text is capped at 6,000 characters before being sent to the model to stay within Gemini Nano's context limit.

## Troubleshooting

**"Chrome Built-in AI が利用できません" error**

- Make sure you are on Chrome 127 or later (`chrome://version`)
- Confirm both flags are set to **Enabled** and Chrome was restarted
- Check that the model downloaded successfully at `chrome://components`

**"ページコンテンツを取得できませんでした" error**

- Reload the target page, then retry
- Chrome internal pages (`chrome://`, `chrome-extension://`) and local files (`file://`) cannot be accessed by content scripts

**Model is slow on first run**

Gemini Nano may need a warm-up period after the initial download. Subsequent runs are faster.

## Project Structure

```
sidekick-ai/
├── manifest.json       # Manifest V3 config
├── background.js       # Service worker — opens the side panel on icon click
├── content.js          # Content script — extracts main text from page DOM
├── sidepanel.html      # Side Panel UI markup
├── sidepanel.js        # AI summarization logic + UI state management
├── sidepanel.css       # Dark-theme styles
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

## Limitations

- Requires Chrome 127+ on desktop (not available on mobile Chrome or other browsers)
- Gemini Nano is a small on-device model; summary quality on very long or highly technical papers may vary
- PDF viewer pages are not supported — open the HTML version of arXiv papers (e.g., `arxiv.org/html/<id>`) for best results
- Pages behind authentication or paywalls extract only the visible DOM text
