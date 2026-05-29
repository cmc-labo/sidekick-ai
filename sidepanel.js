/**
 * Sidekick AI – Side Panel
 *
 * Latency optimizations:
 *  - Content is prefetched in the background as soon as the panel opens,
 *    so clicking "要約" can skip the DOM extraction round-trip entirely.
 *  - chrome.tabs.query is called directly (no background relay message).
 *  - Storage load and tab query run in parallel via Promise.all.
 *  - Input text is capped at 3,000 chars (head + tail) to reduce TTFT.
 *  - System prompt is kept tight to minimise input tokens.
 *  - max_tokens is set to 250 (sufficient for 3 short Japanese lines).
 */

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL  = 'gpt-4.1-nano';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const btnSummarize    = document.getElementById('btn-summarize');
const btnSettings     = document.getElementById('btn-settings');
const btnWarnSettings = document.getElementById('btn-warning-settings');
const btnCopy         = document.getElementById('btn-copy');
const btnRetry        = document.getElementById('btn-retry');
const btnGotoSettings = document.getElementById('btn-goto-settings');
const copyIcon        = document.getElementById('copy-icon');
const apiKeyWarning   = document.getElementById('api-key-warning');
const pageInfo        = document.getElementById('page-info');
const pageFavicon     = document.getElementById('page-favicon');
const pageTitleEl     = document.getElementById('page-title');
const pageUrlEl       = document.getElementById('page-url');
const loadingText     = document.getElementById('loading-text');
const errorMessage    = document.getElementById('error-message');
const errorHint       = document.getElementById('error-hint');
const textConclusion  = document.getElementById('text-conclusion');
const textBackground  = document.getElementById('text-background');
const textNext        = document.getElementById('text-next');

// ─── State helpers ────────────────────────────────────────────────────────────
const STATES = ['idle', 'loading', 'error', 'result'];

function showState(name) {
  STATES.forEach((s) =>
    document.getElementById(`state-${s}`).classList.toggle('hidden', s !== name)
  );
}

function showLoading(msg) {
  loadingText.textContent = msg;
  showState('loading');
}

function showError(msg, showSettingsButton = false, hint = '') {
  errorMessage.textContent = msg;
  btnGotoSettings.classList.toggle('hidden', !showSettingsButton);
  errorHint.textContent = hint;
  errorHint.classList.toggle('hidden', !hint);
  showState('error');
}

// ─── API Key warning banner ───────────────────────────────────────────────────
async function refreshWarning() {
  const { openai_api_key } = await chrome.storage.local.get('openai_api_key');
  apiKeyWarning.classList.toggle('hidden', Boolean(openai_api_key));
}

chrome.storage.onChanged.addListener((changes) => {
  if ('openai_api_key' in changes) refreshWarning();
});

// ─── Content prefetch cache ───────────────────────────────────────────────────
// Populated immediately when the panel opens so "要約" can skip the
// content-extraction round-trip and fire the API call straight away.
const prefetch = { tabId: null, url: null, data: null };

async function prefetchContent() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    if (prefetch.tabId === tab.id && prefetch.url === tab.url) return; // already cached

    const res = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CONTENT' });
    if (res?.ok) {
      prefetch.tabId = tab.id;
      prefetch.url   = tab.url;
      prefetch.data  = res.data;
    }
  } catch {
    // Silently ignore — prefetch is best-effort; summarize() has its own fallback
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT =
  'Summarize the following English technical document in Japanese. ' +
  'Output EXACTLY 3 lines, nothing else:\n' +
  '結論: [core finding or conclusion — 1 sentence]\n' +
  '背景: [background, problem, or motivation — 1 sentence]\n' +
  'ネクストアクション: [what the reader should do or consider next — 1 sentence]\n' +
  'Max 60 Japanese characters per line. No other text.';

function buildPrompt(title, text) {
  return `Title: ${title}\n${text}`;
}

// ─── Stream parser ────────────────────────────────────────────────────────────
const LABEL_RE = {
  conclusion: /^結論[：:]\s*/,
  background: /^背景[：:]\s*/,
  next:        /^ネクストアクション[：:]\s*/,
};

function renderStream(raw) {
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (LABEL_RE.conclusion.test(t))      textConclusion.textContent = t.replace(LABEL_RE.conclusion, '');
    else if (LABEL_RE.background.test(t)) textBackground.textContent = t.replace(LABEL_RE.background, '');
    else if (LABEL_RE.next.test(t))       textNext.textContent       = t.replace(LABEL_RE.next, '');
  }
}

// ─── OpenAI streaming call ────────────────────────────────────────────────────
async function callOpenAI(apiKey, model, title, text) {
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: buildPrompt(title, text) },
      ],
      stream:      true,
      max_tokens:  250,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    let msg = `HTTP ${response.status}`;
    try { msg = (await response.json()).error?.message ?? msg; } catch {}
    if (response.status === 401) msg = 'APIキーが無効です。設定を確認してください。';
    if (response.status === 429) msg = 'レート制限に達しました。しばらくしてから再試行してください。';
    if (response.status === 500) msg = 'OpenAIサーバーエラーです。時間をおいて再試行してください。';
    throw new Error(msg);
  }

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content ?? '';
        if (delta) { accumulated += delta; renderStream(accumulated); }
      } catch {}
    }
  }
}

// ─── Main summarize flow ──────────────────────────────────────────────────────
async function summarize() {
  btnSummarize.disabled = true;
  btnRetry.disabled     = true;
  pageInfo.classList.add('hidden');

  // Load settings and query active tab in parallel
  const [{ openai_api_key, openai_model }, [tab]] = await Promise.all([
    chrome.storage.local.get(['openai_api_key', 'openai_model']),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);

  if (!openai_api_key) {
    showError('OpenAI APIキーが設定されていません。', true);
    enableButtons();
    return;
  }

  if (!tab?.id) {
    showError('アクティブなタブが見つかりません。');
    enableButtons();
    return;
  }

  const model  = openai_model || DEFAULT_MODEL;
  const tabId  = tab.id;
  const tabUrl = tab.url;

  // Use prefetched content if it matches the current tab; otherwise fetch now
  let contentData = (prefetch.tabId === tabId && prefetch.url === tabUrl)
    ? prefetch.data
    : null;

  if (!contentData) {
    showLoading('コンテンツを取得中...');
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'GET_CONTENT' });
      if (!res?.ok) throw new Error(res?.error ?? 'unknown');
      contentData = res.data;
      // Update cache for subsequent retries
      prefetch.tabId = tabId;
      prefetch.url   = tabUrl;
      prefetch.data  = contentData;
    } catch {
      showError(
        'ページコンテンツを取得できませんでした。',
        false,
        'ページをリロードしてから再試行してください。chrome:// ページや拡張機能ページは非対応です。'
      );
      enableButtons();
      return;
    }
  }

  const { title, text } = contentData;

  if (!text || text.length < 100) {
    showError('要約できるテキストが見つかりませんでした。');
    enableButtons();
    return;
  }

  updatePageInfo(title, tabUrl);

  // Reset cards and start streaming
  textConclusion.textContent = '';
  textBackground.textContent = '';
  textNext.textContent       = '';
  [textConclusion, textBackground, textNext].forEach((el) => el.classList.add('streaming'));
  showState('result');

  try {
    await callOpenAI(openai_api_key, model, title, text);
  } catch (err) {
    const isAuthError = err.message.includes('無効') || err.message.includes('401');
    showError(`要約中にエラーが発生しました: ${err.message}`, isAuthError);
    [textConclusion, textBackground, textNext].forEach((el) => el.classList.remove('streaming'));
    enableButtons();
    return;
  }

  [textConclusion, textBackground, textNext].forEach((el) => el.classList.remove('streaming'));
  enableButtons();
}

// ─── Copy to clipboard ────────────────────────────────────────────────────────
btnCopy.addEventListener('click', async () => {
  const text = [
    `結論: ${textConclusion.textContent}`,
    `背景: ${textBackground.textContent}`,
    `ネクストアクション: ${textNext.textContent}`,
  ].join('\n');

  try {
    await navigator.clipboard.writeText(text);
    copyIcon.textContent = '✓';
    btnCopy.style.color  = 'var(--accent-green)';
    setTimeout(() => { copyIcon.textContent = '⊕'; btnCopy.style.color = ''; }, 1800);
  } catch {
    copyIcon.textContent = '✗';
    setTimeout(() => { copyIcon.textContent = '⊕'; }, 1800);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function updatePageInfo(title, url) {
  pageTitleEl.textContent = title || '(タイトルなし)';
  try {
    const p = new URL(url);
    pageUrlEl.textContent              = p.hostname + p.pathname.slice(0, 40);
    pageFavicon.style.backgroundImage  = `url(https://www.google.com/s2/favicons?sz=16&domain=${p.hostname})`;
  } catch {
    pageUrlEl.textContent = url ?? '';
  }
  pageInfo.classList.remove('hidden');
}

function enableButtons() {
  btnSummarize.disabled = false;
  btnRetry.disabled     = false;
}

function openOptions() { chrome.runtime.openOptionsPage(); }

// ─── Event listeners ──────────────────────────────────────────────────────────
btnSummarize.addEventListener('click', summarize);
btnRetry.addEventListener('click', summarize);
btnSettings.addEventListener('click', openOptions);
btnWarnSettings.addEventListener('click', openOptions);
btnGotoSettings.addEventListener('click', openOptions);

// ─── Init ─────────────────────────────────────────────────────────────────────
// Run warning check and content prefetch concurrently
Promise.all([refreshWarning(), prefetchContent()]);
