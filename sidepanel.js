/**
 * Sidekick AI – Side Panel
 *
 * Flow:
 *  1. On load — check if API key is stored; show warning banner if not
 *  2. "要約" button → fetch page content via content.js
 *  3. Call OpenAI Chat Completions API (streaming)
 *  4. Parse 結論 / 背景 / ネクストアクション lines and render into cards
 */

const OPENAI_API_URL  = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL   = 'gpt-4o-mini';

// ─── DOM refs ────────────────────────────────────────────────────────────────
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
const pageTitle       = document.getElementById('page-title');
const pageUrl         = document.getElementById('page-url');
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
  if (hint) {
    errorHint.textContent = hint;
    errorHint.classList.remove('hidden');
  } else {
    errorHint.classList.add('hidden');
  }
  showState('error');
}

// ─── API Key warning banner ───────────────────────────────────────────────────
async function refreshWarning() {
  const { openai_api_key } = await chrome.storage.local.get('openai_api_key');
  apiKeyWarning.classList.toggle('hidden', Boolean(openai_api_key));
}

// Refresh banner when settings are saved in the options page
chrome.storage.onChanged.addListener((changes) => {
  if ('openai_api_key' in changes) refreshWarning();
});

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a technical document summarizer. Analyze the following English technical document and respond in Japanese with EXACTLY 3 lines — no other text:

結論: [The core finding, claim, or value proposition in one sentence]
背景: [The problem being solved, motivation, or context in one sentence]
ネクストアクション: [What a developer or researcher should do or consider next in one sentence]

Rules:
- Each value must be a single complete Japanese sentence.
- Keep each sentence under 80 Japanese characters.
- Output only these 3 lines. No preamble, no explanation.`;

function buildPrompt(title, text) {
  return `Document title: ${title}\n\n---\n${text}`;
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
    if (LABEL_RE.conclusion.test(t)) textConclusion.textContent = t.replace(LABEL_RE.conclusion, '');
    else if (LABEL_RE.background.test(t)) textBackground.textContent = t.replace(LABEL_RE.background, '');
    else if (LABEL_RE.next.test(t))       textNext.textContent       = t.replace(LABEL_RE.next, '');
  }
}

// ─── OpenAI streaming call ────────────────────────────────────────────────────
async function callOpenAI(apiKey, model, title, text, onChunk) {
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
      stream:     true,
      max_tokens: 400,
      temperature: 0.3,
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
    buffer = lines.pop() ?? ''; // keep the last incomplete line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return accumulated;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content ?? '';
        if (delta) { accumulated += delta; onChunk(accumulated); }
      } catch {}
    }
  }
  return accumulated;
}

// ─── Main summarize flow ──────────────────────────────────────────────────────
async function summarize() {
  btnSummarize.disabled = true;
  btnRetry.disabled     = true;
  pageInfo.classList.add('hidden');

  // 1. Load settings
  const { openai_api_key, openai_model } = await chrome.storage.local.get([
    'openai_api_key',
    'openai_model',
  ]);

  if (!openai_api_key) {
    showError('OpenAI APIキーが設定されていません。', true);
    enableButtons();
    return;
  }

  const model = openai_model || DEFAULT_MODEL;

  // 2. Get active tab content
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
      false,
      'ページをリロードしてから再試行してください。chrome:// ページや拡張機能ページは非対応です。'
    );
    enableButtons();
    return;
  }

  const { title, text } = contentData;

  if (!text || text.length < 100) {
    showError('要約できるテキストが見つかりませんでした。');
    enableButtons();
    return;
  }

  updatePageInfo(title, tabUrl);

  // 3. Prepare result cards and start streaming
  textConclusion.textContent = '';
  textBackground.textContent = '';
  textNext.textContent       = '';
  [textConclusion, textBackground, textNext].forEach((el) => el.classList.add('streaming'));
  showState('result');
  showLoading(`${model} で要約中...`); // shown briefly before result state takes over

  try {
    await callOpenAI(openai_api_key, model, title, text, renderStream);
  } catch (err) {
    const isAuthError = err.message.includes('無効') || err.message.includes('401');
    showError(`要約中にエラーが発生しました: ${err.message}`, isAuthError);
    enableButtons();
    [textConclusion, textBackground, textNext].forEach((el) => el.classList.remove('streaming'));
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
    copyIcon.textContent      = '✓';
    btnCopy.style.color       = 'var(--accent-green)';
    setTimeout(() => { copyIcon.textContent = '⊕'; btnCopy.style.color = ''; }, 1800);
  } catch {
    copyIcon.textContent = '✗';
    setTimeout(() => { copyIcon.textContent = '⊕'; }, 1800);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function updatePageInfo(title, url) {
  pageTitle.textContent = title || '(タイトルなし)';
  try {
    const p = new URL(url);
    pageUrl.textContent                = p.hostname + p.pathname.slice(0, 40);
    pageFavicon.style.backgroundImage  = `url(https://www.google.com/s2/favicons?sz=16&domain=${p.hostname})`;
  } catch {
    pageUrl.textContent = url ?? '';
  }
  pageInfo.classList.remove('hidden');
}

function enableButtons() {
  btnSummarize.disabled = false;
  btnRetry.disabled     = false;
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}

// ─── Event listeners ──────────────────────────────────────────────────────────
btnSummarize.addEventListener('click', summarize);
btnRetry.addEventListener('click', summarize);
btnSettings.addEventListener('click', openOptions);
btnWarnSettings.addEventListener('click', openOptions);
btnGotoSettings.addEventListener('click', openOptions);

// ─── Init ─────────────────────────────────────────────────────────────────────
refreshWarning();
