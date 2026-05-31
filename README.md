# Sidekick AI

A Chrome extension that summarizes English technical documents using the OpenAI API and displays the result in a persistent Side Panel. Supports context-aware follow-up Q&A, saves a searchable summary history locally, and outputs in English, Japanese, or Chinese.

## Features

| Feature | Description |
|---|---|
| **3-line Summary** | Every page is summarized as Conclusion / Background / Next Action, streamed in real time |
| **Multi-language Output** | Summaries and Q&A answers in English (default), 日本語, or 中文（简体） |
| **Context Q&A** | Ask follow-up questions grounded in the current page after reading the summary |
| **History** | All summaries are saved locally and searchable; export any entry as Markdown |
| **Prefetch** | Page content is extracted the moment the panel opens, minimising click-to-result latency |

## Summary Format

Each summary has three fields, rendered in the selected output language:

| Field | Description |
|---|---|
| **Conclusion** / 結論 / 结论 | The core finding or value proposition |
| **Background** / 背景 / 背景 | The problem being solved or motivation |
| **Next Action** / ネクストアクション / 下一步行动 | What you should do or consider next |

## Supported Pages

- **GitHub** — README, Issues, Pull Requests, file views
- **arXiv** — abstract pages and HTML full-paper views
- **Hacker News** — article + top comments
- **Tech blogs / docs** — Medium, Zenn, dev.to, and any page with a `<main>` or `<article>` element

## Requirements

- Chrome 127 or later (desktop)
- An [OpenAI API key](https://platform.openai.com/api-keys)

## Setup

### 1. Load the Extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `sidekick-ai/` folder
4. The `✦ Sidekick AI` icon appears in the Chrome toolbar

### 2. Configure the API Key

1. Right-click the toolbar icon → **Options**, or click **⚙** inside the Side Panel
2. Enter your OpenAI API key (`sk-...`)
3. Select an **Output Language** (default: English)
4. Select a model (default: `gpt-4.1-nano`)
5. Click **保存**. Use **接続テスト** to verify the key is valid

The key is stored in `chrome.storage.local` and never sent anywhere except `api.openai.com`.

### Output Language

| Value | Summary & Q&A output |
|---|---|
| **English** (default) | Conclusion / Background / Next Action |
| **日本語** | 結論 / 背景 / ネクストアクション |
| **中文（简体）** | 结论 / 背景 / 下一步行动 |

The language can be changed at any time in Settings. Each history entry stores the language it was saved in, so the correct labels are used when you re-open a past summary.

## Usage

### Summarize

1. Open any technical document
2. Click **✦ Sidekick AI** in the toolbar — the Side Panel opens on the right
3. Click **▶ 要約**
4. The 3-line summary streams in within a few seconds
5. Click **⊕ コピー** to copy the summary to clipboard, or **↺ 再要約** to re-run

### Ask Follow-up Questions

After the summary appears, a Q&A input is shown at the bottom of the panel:

1. Type a question about the current page (e.g. *What are the specific conditions of this experiment?*)
2. Press **Enter** or click **↑**
3. The answer streams in, grounded strictly in the page content, in the selected output language
4. Continue asking — the last 4 turns are kept as conversation context

### History

Switch to the **履歴** tab to browse all past summaries:

- Entries are grouped by **今日 / 昨日 / 今週 / それ以前**
- Use the search bar to filter by title, URL, or any summary text
- Click an entry to expand the full 3-card summary
- **⊕ Markdown コピー** exports the entry in a format ready to paste into Notion or any Markdown editor
- **✕** deletes a single entry; **🗑** deletes all history (with confirmation)

#### Markdown export format

The exported labels match the output language stored with that entry:

```markdown
## Attention Is All You Need

- **URL**: https://arxiv.org/abs/1706.03762
- **Date**: 2026/6/1
- **Language**: 日本語

**結論**: Transformerはアテンション機構のみで...
**背景**: RNNベースのシーケンスモデルは...
**ネクストアクション**: 実装を試し、マルチヘッドアテンションを...
```

## How It Works

```
Panel opens
    ├── content.js prefetches page text in the background
    └── API key + output language + tab queried in parallel on "要約" click
            └── OpenAI Chat Completions (streaming)
                    ├── 3-line summary rendered in the selected language
                    ├── Summary auto-saved to chrome.storage.local (with language tag)
                    └── Q&A input enabled (context = page text + summary)

"履歴" tab
    └── chrome.storage.local → grouped list → full-text search
            └── each entry renders labels in its stored language
```

Page text is capped at 3,000 characters (head + tail) before being sent to the API.

## Model Options

| Model | Speed | Cost | Recommended for |
|---|---|---|---|
| `gpt-4.1-nano` | ★★★ Fastest | $ Lowest | Default — daily reading |
| `gpt-4.1-mini` | ★★☆ Fast | $$ Low | Longer or denser documents |
| `gpt-4o-mini` | ★★☆ Fast | $$ Low | Alternative to 4.1-mini |
| `gpt-4.1` | ★☆☆ Moderate | $$$$ High | Maximum accuracy |
| `gpt-4o` | ★☆☆ Moderate | $$$$ High | Alternative to 4.1 |

## Troubleshooting

**"APIキーが設定されていません" banner**

Open the options page (⚙ button) and save a valid key. Use **接続テスト** to confirm it works.

**"APIキーが無効です" error**

The key may have been revoked or miscopied. Generate a new key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys).

**"ページコンテンツを取得できませんでした" error**

- Reload the target page and retry
- `chrome://` pages, extension pages, and `file://` URLs cannot be accessed by content scripts

**Q&A answers seem inaccurate**

The model answers based only on the extracted page text (up to 3,000 characters). For very long papers, the relevant section may have been truncated — try the HTML version of arXiv papers for more complete extraction.

## Project Structure

```
sidekick-ai/
├── manifest.json       # Manifest V3 — permissions, side_panel, options_ui
├── background.js       # Service worker — opens side panel on toolbar click
├── content.js          # Content script — site-aware DOM text extraction
├── sidepanel.html      # Side Panel UI markup (summary + Q&A + history tabs)
├── sidepanel.js        # Core logic: summarize, Q&A, history CRUD, streaming
├── sidepanel.css       # Dark-theme styles
├── options.html        # Settings page — API key + language + model selector
├── options.js          # Save/load settings, connection test
├── options.css         # Settings page styles
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

## Limitations

- Requires Chrome 127+ on desktop; not available on mobile Chrome or other browsers
- PDF viewer pages are not supported — use the HTML version (`arxiv.org/html/<id>`) for arXiv papers
- Pages behind authentication or paywalls extract only the visible DOM text
- History is stored in `chrome.storage.local` (5 MB default limit); capped at 500 entries
