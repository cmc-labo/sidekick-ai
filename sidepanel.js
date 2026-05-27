/**
 * Sidekick AI – Side Panel
 *
 * Flow:
 *  1. User clicks "要約" → fetch content from active tab via content.js
 *  2. Check Chrome Built-in AI availability
 *  3. Create a language model session with a structured-output system prompt
 *  4. Stream the response into 3 labelled cards
 */

// ─── DOM refs ───────────────────────────────────────────────────────────────
const btnSummarize   = document.getElementById('btn-summarize');
const btnCopy        = document.getElementById('btn-copy');
const btnRetry       = document.getElementById('btn-retry');
const copyIcon       = document.getElementById('copy-icon');
const pageInfo       = document.getElementById('page-info');
const pageFavicon    = document.getElementById('page-favicon');
const pageTitle      = document.getElementById('page-title');
const pageUrl        = document.getElementById('page-url');
const loadingText    = document.getElementById('loading-text');
const downloadBar    = document.getElementById('download-progress');
const progressFill   = document.getElementById('progress-fill');
const progressLabel  = document.getElementById('progress-label');
const errorMessage   = document.getElementById('error-message');
const errorHint      = document.getElementById('error-hint');
const textConclusion = document.getElementById('text-conclusion');
const textBackground = document.getElementById('text-background');
const textNext       = document.getElementById('text-next');

// ─── State helpers ───────────────────────────────────────────────────────────
const STATES = ['idle', 'loading', 'error', 'result'];

function showState(name) {
  STATES.forEach((s) => {
    document.getElementById(`state-${s}`).classList.toggle('hidden', s !== name);
  });
}

function showLoading(msg) {
  loadingText.textContent = msg;
  downloadBar.classList.add('hidden');
  showState('loading');
}

function showError(msg, hint = '') {
  errorMessage.textContent = msg;
  if (hint) {
    errorHint.innerHTML = hint;
    errorHint.classList.remove('hidden');
  } else {
    errorHint.classList.add('hidden');
  }
  showState('error');
}

// ─── System prompt ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a technical document summarizer. Your job is to analyze English technical documents (GitHub READMEs, arXiv papers, tech blogs, etc.) and produce a concise Japanese summary.

Respond with EXACTLY 3 lines and nothing else:
結論: [The core finding, claim, or value proposition — one sentence]
背景: [The problem being solved, motivation, or context — one sentence]
ネクストアクション: [What a developer or researcher should do or consider — one sentence]

Rules:
- Each value must be a single complete sentence in Japanese.
- Do NOT add any other text, headers, or explanations.
- Keep each sentence under 80 Japanese characters.
- If the document is too short or unclear, still produce the 3 lines with best-effort content.`;

// ─── Prompt ──────────────────────────────────────────────────────────────────
function buildPrompt(title, text) {
  return `Document title: ${title}\n\n---\n${text}`;
}

// ─── Parse streamed output into 3 fields ────────────────────────────────────
const LABELS = {
  conclusion: /^結論[：:]\s*/,
  background: /^背景[：:]\s*/,
  next:       /^ネクストアクション[：:]\s*/,
};

/**
 * Given the full accumulated response text so far, parse and render card text.
 * Called on every streaming chunk.
 */
function renderStream(raw) {
  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (LABELS.conclusion.test(trimmed)) {
      textConclusion.textContent = trimmed.replace(LABELS.conclusion, '');
    } else if (LABELS.background.test(trimmed)) {
      textBackground.textContent = trimmed.replace(LABELS.background, '');
    } else if (LABELS.next.test(trimmed)) {
      textNext.textContent = trimmed.replace(LABELS.next, '');
    }
  }
}

// ─── AI availability check ───────────────────────────────────────────────────
async function checkAI() {
  // Chrome 127+ ships window.ai; the Prompt API lives at window.ai.languageModel
  const api = window.ai?.languageModel;
  if (!api) {
    return { available: false, reason: 'api_missing' };
  }
  try {
    const caps = await api.capabilities();
    return { available: caps.available !== 'no', status: caps.available, reason: null };
  } catch {
    return { available: false, reason: 'caps_error' };
  }
}

// ─── Summarize ───────────────────────────────────────────────────────────────
async function summarize() {
  btnSummarize.disabled = true;
  btnRetry.disabled = true;
  pageInfo.classList.add('hidden');

  // 1. Fetch active tab content
  showLoading('コンテンツを取得中...');
  let tabId, tabUrl;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB' });
    tabId  = res?.tabId;
    tabUrl = res?.url;
  } catch {
    showError('タブ情報の取得に失敗しました。');
    enableButtons();
    return;
  }

  if (!tabId) {
    showError('アクティブなタブが見つかりません。');
    enableButtons();
    return;
  }

  let contentData;
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'GET_CONTENT' });
    if (!res?.ok) throw new Error(res?.error ?? 'unknown');
    contentData = res.data;
  } catch {
    showError(
      'ページコンテンツを取得できませんでした。',
      'ページをリロードしてから再試行してください。<br>chrome:// ページや拡張機能ページは対応していません。'
    );
    enableButtons();
    return;
  }

  const { title, text } = contentData;

  if (!text || text.length < 100) {
    showError('要約できるテキストが見つかりませんでした。', 'このページには十分なテキストコンテンツがない可能性があります。');
    enableButtons();
    return;
  }

  // Update page info bar
  updatePageInfo(title, tabUrl);

  // 2. Check AI availability
  showLoading('Chrome Built-in AI を確認中...');
  const { available, status, reason } = await checkAI();

  if (!available) {
    const hint = reason === 'api_missing'
      ? `Chrome Built-in AI が利用できません。<br><br>
         有効化手順:<br>
         1. Chrome 127 以降にアップデート<br>
         2. <code>chrome://flags/#prompt-api-for-gemini-nano</code> を <b>Enabled</b> に設定<br>
         3. <code>chrome://components</code> で <b>Optimization Guide On Device Model</b> をアップデート<br>
         4. Chrome を再起動`
      : `Chrome Built-in AI が "no" を返しました。<br>上記の有効化手順を確認してください。`;
    showError('Chrome Built-in AI が利用できません。', hint);
    enableButtons();
    return;
  }

  // 3. Create session (with optional download progress)
  showLoading('Gemini Nano セッションを初期化中...');
  let session;
  try {
    session = await window.ai.languageModel.create({
      systemPrompt: SYSTEM_PROMPT,
      ...(status === 'after-download' && {
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            downloadBar.classList.remove('hidden');
            loadingText.textContent = 'モデルをダウンロード中...';
            if (e.total > 0) {
              const pct = Math.round((e.loaded / e.total) * 100);
              progressFill.style.width = `${pct}%`;
              progressLabel.textContent = `${pct}% (${formatBytes(e.loaded)} / ${formatBytes(e.total)})`;
            }
          });
        },
      }),
    });
  } catch (err) {
    showError(`セッション作成に失敗しました: ${err.message}`);
    enableButtons();
    return;
  }

  // 4. Stream into result cards
  textConclusion.textContent = '';
  textBackground.textContent = '';
  textNext.textContent = '';
  textConclusion.classList.add('streaming');
  textBackground.classList.add('streaming');
  textNext.classList.add('streaming');
  showState('result');
  loadingText.textContent = '要約中...';

  try {
    const stream = session.promptStreaming(buildPrompt(title, text));
    let accumulated = '';
    for await (const chunk of stream) {
      accumulated = chunk; // chunk is always the full text so far in promptStreaming
      renderStream(accumulated);
    }
    // Final pass to ensure complete parse
    renderStream(accumulated);
  } catch (err) {
    showError(`要約中にエラーが発生しました: ${err.message}`);
    enableButtons();
    session.destroy();
    return;
  }

  // Done
  textConclusion.classList.remove('streaming');
  textBackground.classList.remove('streaming');
  textNext.classList.remove('streaming');
  session.destroy();
  enableButtons();
}

// ─── Copy to clipboard ───────────────────────────────────────────────────────
function buildCopyText() {
  const lines = [
    `結論: ${textConclusion.textContent}`,
    `背景: ${textBackground.textContent}`,
    `ネクストアクション: ${textNext.textContent}`,
  ];
  return lines.join('\n');
}

btnCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(buildCopyText());
    copyIcon.textContent = '✓';
    btnCopy.style.color = 'var(--accent-green)';
    setTimeout(() => {
      copyIcon.textContent = '⊕';
      btnCopy.style.color = '';
    }, 1800);
  } catch {
    copyIcon.textContent = '✗';
    setTimeout(() => { copyIcon.textContent = '⊕'; }, 1800);
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function updatePageInfo(title, url) {
  pageTitle.textContent = title || '(タイトルなし)';
  try {
    const parsed = new URL(url);
    pageUrl.textContent   = parsed.hostname + parsed.pathname.slice(0, 40);
    pageFavicon.style.backgroundImage = `url(https://www.google.com/s2/favicons?sz=16&domain=${parsed.hostname})`;
  } catch {
    pageUrl.textContent = url ?? '';
  }
  pageInfo.classList.remove('hidden');
}

function enableButtons() {
  btnSummarize.disabled = false;
  btnRetry.disabled = false;
}

function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
}

// ─── Event listeners ─────────────────────────────────────────────────────────
btnSummarize.addEventListener('click', summarize);
btnRetry.addEventListener('click', summarize);
