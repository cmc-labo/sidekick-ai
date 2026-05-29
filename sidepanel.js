/**
 * Sidekick AI – Side Panel
 *
 * Features:
 *  - Page content is prefetched when the panel opens (minimises latency on click)
 *  - Structured 3-line summary streamed from OpenAI
 *  - Context-aware QA chat grounded in the current page content (multi-turn)
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
const btnAsk          = document.getElementById('btn-ask');
const qaInput         = document.getElementById('qa-input');
const qaHistory       = document.getElementById('qa-history');
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

// ─── UI state ─────────────────────────────────────────────────────────────────
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

// ─── API Key warning ──────────────────────────────────────────────────────────
async function refreshWarning() {
  const { openai_api_key } = await chrome.storage.local.get('openai_api_key');
  apiKeyWarning.classList.toggle('hidden', Boolean(openai_api_key));
}

chrome.storage.onChanged.addListener((changes) => {
  if ('openai_api_key' in changes) refreshWarning();
});

// ─── Content prefetch cache ───────────────────────────────────────────────────
const prefetch = { tabId: null, url: null, data: null };

async function prefetchContent() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    if (prefetch.tabId === tab.id && prefetch.url === tab.url) return;
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CONTENT' });
    if (res?.ok) { prefetch.tabId = tab.id; prefetch.url = tab.url; prefetch.data = res.data; }
  } catch {}
}

// ─── QA state ─────────────────────────────────────────────────────────────────
let currentContext = null;  // { title, text } of the summarized page
let currentSummary = '';    // Generated summary (injected as assistant context turn)
let chatHistory    = [];    // [{ role, content }, ...]
let isAnswering    = false;

const MAX_HISTORY  = 8;     // Keep last 4 turns

function resetQA() {
  chatHistory    = [];
  currentSummary = '';
  qaHistory.innerHTML = '<p class="qa-placeholder">気になったことをそのまま質問してみてください</p>';
}

// ─── Prompts ──────────────────────────────────────────────────────────────────
const SUMMARY_SYSTEM =
  'Summarize the following English technical document in Japanese. ' +
  'Output EXACTLY 3 lines, nothing else:\n' +
  '結論: [core finding or conclusion — 1 sentence]\n' +
  '背景: [background, problem, or motivation — 1 sentence]\n' +
  'ネクストアクション: [what the reader should do or consider next — 1 sentence]\n' +
  'Max 60 Japanese characters per line. No other text.';

function buildSummaryMessages(title, text) {
  return [
    { role: 'system', content: SUMMARY_SYSTEM },
    { role: 'user',   content: `Title: ${title}\n${text}` },
  ];
}

function buildQAMessages(question) {
  const { title, text } = currentContext;
  const system =
    'You are a helpful assistant answering questions about the following technical document. ' +
    'Answer concisely in Japanese. Base your answers strictly on the document content. ' +
    'If the answer is not in the document, say so clearly.\n\n' +
    `Title: ${title}\n---\n${text}`;

  return [
    { role: 'system',    content: system },
    // Give the model awareness of the already-generated summary
    ...(currentSummary ? [{ role: 'assistant', content: currentSummary }] : []),
    // Rolling conversation history (last 4 turns)
    ...chatHistory.slice(-MAX_HISTORY),
    { role: 'user', content: question },
  ];
}

// ─── Stream parser (summary) ──────────────────────────────────────────────────
const LABEL_RE = {
  conclusion: /^結論[：:]\s*/,
  background: /^背景[：:]\s*/,
  next:        /^ネクストアクション[：:]\s*/,
};

function renderSummaryStream(raw) {
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (LABEL_RE.conclusion.test(t))      textConclusion.textContent = t.replace(LABEL_RE.conclusion, '');
    else if (LABEL_RE.background.test(t)) textBackground.textContent = t.replace(LABEL_RE.background, '');
    else if (LABEL_RE.next.test(t))       textNext.textContent       = t.replace(LABEL_RE.next, '');
  }
}

// ─── Generic SSE streaming ────────────────────────────────────────────────────
async function streamTokens(apiKey, model, messages, maxTokens, onDelta) {
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream:      true,
      max_tokens:  maxTokens,
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
        if (delta) onDelta(delta);
      } catch {}
    }
  }
}

// ─── Summarize ────────────────────────────────────────────────────────────────
async function summarize() {
  btnSummarize.disabled = true;
  btnRetry.disabled     = true;
  pageInfo.classList.add('hidden');

  const [{ openai_api_key, openai_model }, [tab]] = await Promise.all([
    chrome.storage.local.get(['openai_api_key', 'openai_model']),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);

  if (!openai_api_key) {
    showError('OpenAI APIキーが設定されていません。', true);
    enableSummarizeButtons();
    return;
  }
  if (!tab?.id) {
    showError('アクティブなタブが見つかりません。');
    enableSummarizeButtons();
    return;
  }

  const model  = openai_model || DEFAULT_MODEL;
  const tabId  = tab.id;
  const tabUrl = tab.url;

  // Use prefetched content when available
  let contentData = (prefetch.tabId === tabId && prefetch.url === tabUrl) ? prefetch.data : null;
  if (!contentData) {
    showLoading('コンテンツを取得中...');
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'GET_CONTENT' });
      if (!res?.ok) throw new Error(res?.error ?? 'unknown');
      contentData = res.data;
      prefetch.tabId = tabId; prefetch.url = tabUrl; prefetch.data = contentData;
    } catch {
      showError(
        'ページコンテンツを取得できませんでした。',
        false,
        'ページをリロードしてから再試行してください。chrome:// ページや拡張機能ページは非対応です。'
      );
      enableSummarizeButtons();
      return;
    }
  }

  const { title, text } = contentData;
  if (!text || text.length < 100) {
    showError('要約できるテキストが見つかりませんでした。');
    enableSummarizeButtons();
    return;
  }

  // Save context for QA, reset previous chat
  currentContext = { title, text };
  resetQA();
  updatePageInfo(title, tabUrl);

  // Prepare streaming
  textConclusion.textContent = '';
  textBackground.textContent = '';
  textNext.textContent       = '';
  const streamEls = [textConclusion, textBackground, textNext];
  streamEls.forEach((el) => el.classList.add('streaming'));
  showState('result');

  let accumulated = '';
  try {
    await streamTokens(openai_api_key, model, buildSummaryMessages(title, text), 250, (delta) => {
      accumulated += delta;
      renderSummaryStream(accumulated);
    });
  } catch (err) {
    const isAuth = err.message.includes('無効') || err.message.includes('401');
    showError(`要約中にエラーが発生しました: ${err.message}`, isAuth);
    streamEls.forEach((el) => el.classList.remove('streaming'));
    enableSummarizeButtons();
    return;
  }

  streamEls.forEach((el) => el.classList.remove('streaming'));

  // Save summary text for QA context
  currentSummary = [
    textConclusion.textContent && `結論: ${textConclusion.textContent}`,
    textBackground.textContent && `背景: ${textBackground.textContent}`,
    textNext.textContent       && `ネクストアクション: ${textNext.textContent}`,
  ].filter(Boolean).join('\n');

  enableSummarizeButtons();
  // Focus QA input so the user can start asking immediately
  qaInput.focus();
}

// ─── QA ask ───────────────────────────────────────────────────────────────────
async function handleAsk() {
  const question = qaInput.value.trim();
  if (!question || isAnswering || !currentContext) return;

  qaInput.value     = '';
  isAnswering       = true;
  btnAsk.disabled   = true;
  qaInput.disabled  = true;

  addBubble('user', question);
  const answerBubble = addBubble('assistant', '');
  answerBubble.classList.add('streaming');

  const { openai_api_key, openai_model } = await chrome.storage.local.get([
    'openai_api_key',
    'openai_model',
  ]);

  let answer = '';
  try {
    await streamTokens(
      openai_api_key,
      openai_model || DEFAULT_MODEL,
      buildQAMessages(question),
      400,
      (delta) => {
        answer += delta;
        answerBubble.textContent = answer;
        // Auto-scroll as answer streams in
        qaHistory.scrollTop = qaHistory.scrollHeight;
      }
    );
    // Commit to history
    chatHistory.push({ role: 'user', content: question });
    chatHistory.push({ role: 'assistant', content: answer });
  } catch (err) {
    answerBubble.textContent = `エラー: ${err.message}`;
    answerBubble.classList.add('bubble-error');
  } finally {
    answerBubble.classList.remove('streaming');
    isAnswering      = false;
    btnAsk.disabled  = false;
    qaInput.disabled = false;
    qaInput.focus();
  }
}

// ─── Chat bubble helper ───────────────────────────────────────────────────────
function addBubble(role, content) {
  // Remove placeholder text on first message
  qaHistory.querySelector('.qa-placeholder')?.remove();

  const bubble = document.createElement('div');
  bubble.className    = `qa-bubble qa-bubble-${role}`;
  bubble.textContent  = content;
  qaHistory.appendChild(bubble);
  qaHistory.scrollTop = qaHistory.scrollHeight;
  return bubble;
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
    pageUrlEl.textContent             = p.hostname + p.pathname.slice(0, 40);
    pageFavicon.style.backgroundImage = `url(https://www.google.com/s2/favicons?sz=16&domain=${p.hostname})`;
  } catch {
    pageUrlEl.textContent = url ?? '';
  }
  pageInfo.classList.remove('hidden');
}

function enableSummarizeButtons() {
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
btnAsk.addEventListener('click', handleAsk);
qaInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk(); }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
Promise.all([refreshWarning(), prefetchContent()]);
