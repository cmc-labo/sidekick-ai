/**
 * Sidekick AI – Side Panel
 *
 * Features:
 *  - Prefetch page content on panel open (minimises click-to-API latency)
 *  - 3-line structured summary streamed from OpenAI in English / 日本語 / 中文
 *  - Context-aware multi-turn QA in the selected language
 *  - Persistent history saved to chrome.storage.local with language metadata
 */

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL  = 'gpt-4.1-nano';
const DEFAULT_LANG   = 'en';
const HISTORY_KEY    = 'summary_history';
const MAX_ENTRIES    = 500;
const MAX_QA_HISTORY = 8;

// ─── Language configuration ───────────────────────────────────────────────────
const LANG_CONFIG = {
  en: {
    name:          'English',
    labels:        ['Conclusion', 'Background', 'Next Action'],
    // Regex patterns to detect each label at the start of a streamed line
    re: [
      /^Conclusion[：:]\s*/i,
      /^Background[：:]\s*/i,
      /^Next\s*Action[：:]\s*/i,
    ],
    // Lines used inside the system prompt to describe the output format
    promptLines: [
      'Conclusion: [core finding or conclusion — 1 sentence]',
      'Background: [background, problem, or motivation — 1 sentence]',
      'Next Action: [what the reader should do or consider next — 1 sentence]',
    ],
    summaryLang:   'English',
    qaLang:        'English',
    qaPlaceholder: 'e.g. What are the specific conditions of this experiment?',
    qaReset:       'Ask anything about this page',
  },
  ja: {
    name:          '日本語',
    labels:        ['結論', '背景', 'ネクストアクション'],
    re: [
      /^結論[：:]\s*/,
      /^背景[：:]\s*/,
      /^ネクストアクション[：:]\s*/,
    ],
    promptLines: [
      '結論: [核心的な発見や結論 — 1文、最大60文字]',
      '背景: [背景・問題・動機 — 1文、最大60文字]',
      'ネクストアクション: [読者が次にすべきこと — 1文、最大60文字]',
    ],
    summaryLang:   'Japanese',
    qaLang:        'Japanese',
    qaPlaceholder: '例: この実験の具体的な条件は？',
    qaReset:       '気になったことをそのまま質問してみてください',
  },
  zh: {
    name:          '中文',
    labels:        ['结论', '背景', '下一步行动'],
    re: [
      /^结论[：:]\s*/,
      /^背景[：:]\s*/,
      /^下一步行动[：:]\s*/,
    ],
    promptLines: [
      '结论: [核心发现或结论 — 1句话，最多60个字]',
      '背景: [背景、问题或动机 — 1句话，最多60个字]',
      '下一步行动: [读者应该做什么 — 1句话，最多60个字]',
    ],
    summaryLang:   'Chinese (Simplified)',
    qaLang:        'Chinese (Simplified)',
    qaPlaceholder: '例如：这个实验的具体条件是什么？',
    qaReset:       '可以直接提问关于本页面的任何问题',
  },
};

function getLangConfig(code) {
  return LANG_CONFIG[code] ?? LANG_CONFIG[DEFAULT_LANG];
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const tabSummarize    = document.getElementById('tab-summarize');
const tabHistory      = document.getElementById('tab-history');
const historyBadge    = document.getElementById('history-badge');
const btnSummarize    = document.getElementById('btn-summarize');
const btnSettings     = document.getElementById('btn-settings');
const btnWarnSettings = document.getElementById('btn-warning-settings');
const btnCopy         = document.getElementById('btn-copy');
const btnRetry        = document.getElementById('btn-retry');
const btnGotoSettings = document.getElementById('btn-goto-settings');
const btnAsk          = document.getElementById('btn-ask');
const btnClearSearch  = document.getElementById('btn-clear-search');
const btnClearAll     = document.getElementById('btn-clear-all');
const qaInput         = document.getElementById('qa-input');
const qaHistory       = document.getElementById('qa-history');
const historySearch   = document.getElementById('history-search');
const historyList     = document.getElementById('history-list');
const historyEmpty    = document.getElementById('history-empty');
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

// ─── Tab / state management ───────────────────────────────────────────────────
let activeTab          = 'summarize';
let lastSummarizeState = 'idle';

const STATES = ['idle', 'loading', 'error', 'result'];

function showState(name) {
  lastSummarizeState = name;
  if (activeTab !== 'summarize') return;
  STATES.forEach((s) =>
    document.getElementById(`state-${s}`).classList.toggle('hidden', s !== name)
  );
}

function switchTab(tab) {
  activeTab = tab;
  tabSummarize.classList.toggle('tab-active', tab === 'summarize');
  tabHistory.classList.toggle('tab-active',   tab === 'history');

  const historyView = document.getElementById('state-history');
  if (tab === 'history') {
    STATES.forEach((s) => document.getElementById(`state-${s}`).classList.add('hidden'));
    pageInfo.classList.add('hidden');
    historyView.classList.remove('hidden');
    loadAndRenderHistory(historySearch.value);
  } else {
    historyView.classList.add('hidden');
    showState(lastSummarizeState);
    if (lastSummarizeState === 'result') pageInfo.classList.remove('hidden');
  }
}

function showLoading(msg) { loadingText.textContent = msg; showState('loading'); }

function showError(msg, showSettingsButton = false, hint = '') {
  errorMessage.textContent = msg;
  btnGotoSettings.classList.toggle('hidden', !showSettingsButton);
  errorHint.textContent = hint;
  errorHint.classList.toggle('hidden', !hint);
  showState('error');
}

// ─── Card label update ────────────────────────────────────────────────────────
const CARD_ICONS = ['◆', '◇', '▷'];
const CARD_KEYS  = ['conclusion', 'background', 'nextAction'];

function updateCardLabels(lang) {
  const lc = getLangConfig(lang);
  CARD_KEYS.forEach((key, i) => {
    const el = document.querySelector(`[data-key="${key}"]`);
    if (el) el.textContent = lc.labels[i];
  });
}

// ─── API Key warning ──────────────────────────────────────────────────────────
async function refreshWarning() {
  const { openai_api_key } = await chrome.storage.local.get('openai_api_key');
  apiKeyWarning.classList.toggle('hidden', Boolean(openai_api_key));
}

chrome.storage.onChanged.addListener((changes) => {
  if ('openai_api_key' in changes) refreshWarning();
});

// ─── Content prefetch ─────────────────────────────────────────────────────────
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
let currentContext = null;
let currentSummary = '';
let chatHistory    = [];
let isAnswering    = false;

function resetQA(lang) {
  chatHistory    = [];
  currentSummary = '';
  const lc = getLangConfig(lang);
  qaHistory.innerHTML    = `<p class="qa-placeholder">${lc.qaReset}</p>`;
  qaInput.placeholder    = lc.qaPlaceholder;
}

// ─── Prompts ──────────────────────────────────────────────────────────────────
function buildSummaryMessages(title, text, lang) {
  const lc = getLangConfig(lang);
  const system =
    `Summarize the following English technical document in ${lc.summaryLang}. ` +
    'Output EXACTLY 3 lines, nothing else:\n' +
    lc.promptLines.join('\n') + '\n' +
    'No other text.';
  return [
    { role: 'system', content: system },
    { role: 'user',   content: `Title: ${title}\n${text}` },
  ];
}

function buildQAMessages(question, lang) {
  const { title, text } = currentContext;
  const lc = getLangConfig(lang);
  const system =
    'You are a helpful assistant answering questions about the following technical document. ' +
    `Answer concisely in ${lc.qaLang}. ` +
    'Base your answers strictly on the document content. ' +
    'If the answer is not in the document, say so clearly.\n\n' +
    `Title: ${title}\n---\n${text}`;
  return [
    { role: 'system',    content: system },
    ...(currentSummary ? [{ role: 'assistant', content: currentSummary }] : []),
    ...chatHistory.slice(-MAX_QA_HISTORY),
    { role: 'user', content: question },
  ];
}

// ─── Stream parser ────────────────────────────────────────────────────────────
function renderSummaryStream(raw, lang) {
  const lc = getLangConfig(lang);
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (lc.re[0].test(t))      textConclusion.textContent = t.replace(lc.re[0], '');
    else if (lc.re[1].test(t)) textBackground.textContent = t.replace(lc.re[1], '');
    else if (lc.re[2].test(t)) textNext.textContent       = t.replace(lc.re[2], '');
  }
}

// ─── Generic SSE streaming ────────────────────────────────────────────────────
async function streamTokens(apiKey, model, messages, maxTokens, onDelta) {
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, stream: true, max_tokens: maxTokens, temperature: 0.2 }),
  });

  if (!response.ok) {
    let msg = `HTTP ${response.status}`;
    try { msg = (await response.json()).error?.message ?? msg; } catch {}
    if (response.status === 401) msg = 'APIキーが無効です。設定を確認してください。';
    if (response.status === 429) msg = 'レート制限に達しました。しばらくしてから再試行してください。';
    if (response.status === 500) msg = 'OpenAIサーバーエラーです。時間をおいて再試行してください。';
    throw new Error(msg);
  }

  const reader = response.body.getReader();
  const dec    = new TextDecoder();
  let buffer   = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
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

  const [{ openai_api_key, openai_model, output_language }, [tab]] = await Promise.all([
    chrome.storage.local.get(['openai_api_key', 'openai_model', 'output_language']),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);

  if (!openai_api_key) { showError('OpenAI APIキーが設定されていません。', true); enableSummarizeButtons(); return; }
  if (!tab?.id)        { showError('アクティブなタブが見つかりません。');            enableSummarizeButtons(); return; }

  const model  = openai_model    || DEFAULT_MODEL;
  const lang   = output_language || DEFAULT_LANG;
  const tabId  = tab.id;
  const tabUrl = tab.url;

  let contentData = (prefetch.tabId === tabId && prefetch.url === tabUrl) ? prefetch.data : null;
  if (!contentData) {
    showLoading('Loading content...');
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'GET_CONTENT' });
      if (!res?.ok) throw new Error(res?.error ?? 'unknown');
      contentData = res.data;
      prefetch.tabId = tabId; prefetch.url = tabUrl; prefetch.data = contentData;
    } catch {
      showError('ページコンテンツを取得できませんでした。', false,
        'ページをリロードしてから再試行してください。chrome:// ページや拡張機能ページは非対応です。');
      enableSummarizeButtons(); return;
    }
  }

  const { title, text } = contentData;
  if (!text || text.length < 100) { showError('要約できるテキストが見つかりませんでした。'); enableSummarizeButtons(); return; }

  // Apply language settings to UI before streaming starts
  updateCardLabels(lang);
  currentContext = { title, text };
  resetQA(lang);
  updatePageInfo(title, tabUrl);

  textConclusion.textContent = '';
  textBackground.textContent = '';
  textNext.textContent       = '';
  const streamEls = [textConclusion, textBackground, textNext];
  streamEls.forEach((el) => el.classList.add('streaming'));
  showState('result');

  let accumulated = '';
  try {
    await streamTokens(openai_api_key, model, buildSummaryMessages(title, text, lang), 250, (delta) => {
      accumulated += delta;
      renderSummaryStream(accumulated, lang);
    });
  } catch (err) {
    const isAuth = err.message.includes('無効') || err.message.includes('401');
    showError(`要約中にエラーが発生しました: ${err.message}`, isAuth);
    streamEls.forEach((el) => el.classList.remove('streaming'));
    enableSummarizeButtons(); return;
  }

  streamEls.forEach((el) => el.classList.remove('streaming'));

  const lc = getLangConfig(lang);
  currentSummary = [
    textConclusion.textContent && `${lc.labels[0]}: ${textConclusion.textContent}`,
    textBackground.textContent && `${lc.labels[1]}: ${textBackground.textContent}`,
    textNext.textContent       && `${lc.labels[2]}: ${textNext.textContent}`,
  ].filter(Boolean).join('\n');

  const count = await saveToHistory(
    title, tabUrl,
    textConclusion.textContent,
    textBackground.textContent,
    textNext.textContent,
    lang,
  );
  updateHistoryBadge(count);

  enableSummarizeButtons();
  qaInput.focus();
}

// ─── QA ───────────────────────────────────────────────────────────────────────
async function handleAsk() {
  const question = qaInput.value.trim();
  if (!question || isAnswering || !currentContext) return;

  qaInput.value = '';
  isAnswering   = true;
  btnAsk.disabled  = true;
  qaInput.disabled = true;

  addBubble('user', question);
  const answerBubble = addBubble('assistant', '');
  answerBubble.classList.add('streaming');

  const { openai_api_key, openai_model, output_language } = await chrome.storage.local.get([
    'openai_api_key', 'openai_model', 'output_language',
  ]);
  const lang   = output_language || DEFAULT_LANG;
  let   answer = '';

  try {
    await streamTokens(
      openai_api_key, openai_model || DEFAULT_MODEL,
      buildQAMessages(question, lang), 400,
      (delta) => {
        answer += delta;
        answerBubble.textContent = answer;
        qaHistory.scrollTop = qaHistory.scrollHeight;
      }
    );
    chatHistory.push({ role: 'user',      content: question });
    chatHistory.push({ role: 'assistant', content: answer   });
  } catch (err) {
    answerBubble.textContent = `Error: ${err.message}`;
    answerBubble.classList.add('bubble-error');
  } finally {
    answerBubble.classList.remove('streaming');
    isAnswering = false;
    btnAsk.disabled  = false;
    qaInput.disabled = false;
    qaInput.focus();
  }
}

function addBubble(role, content) {
  qaHistory.querySelector('.qa-placeholder')?.remove();
  const bubble = document.createElement('div');
  bubble.className   = `qa-bubble qa-bubble-${role}`;
  bubble.textContent = content;
  qaHistory.appendChild(bubble);
  qaHistory.scrollTop = qaHistory.scrollHeight;
  return bubble;
}

// ─── History: storage ─────────────────────────────────────────────────────────
async function saveToHistory(title, url, conclusion, background, nextAction, lang) {
  const { [HISTORY_KEY]: hist = [] } = await chrome.storage.local.get(HISTORY_KEY);
  const entry = {
    id:      Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    title:   title || '(no title)',
    url,
    favicon: getFaviconUrl(url),
    language: lang || DEFAULT_LANG,
    summary: { conclusion, background, nextAction },
    savedAt: Date.now(),
  };
  const idx = hist.findIndex((e) => e.url === url);
  if (idx >= 0) hist[idx] = entry;
  else { hist.unshift(entry); hist.length = Math.min(hist.length, MAX_ENTRIES); }
  await chrome.storage.local.set({ [HISTORY_KEY]: hist });
  return hist.length;
}

async function deleteHistoryEntry(id) {
  const { [HISTORY_KEY]: hist = [] } = await chrome.storage.local.get(HISTORY_KEY);
  const updated = hist.filter((e) => e.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: updated });
  return updated.length;
}

async function clearAllHistory() {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
}

async function loadHistory() {
  const { [HISTORY_KEY]: hist = [] } = await chrome.storage.local.get(HISTORY_KEY);
  return hist;
}

function searchHistory(entries, query) {
  if (!query.trim()) return entries;
  const q = query.toLowerCase();
  return entries.filter((e) =>
    e.title.toLowerCase().includes(q) ||
    e.url.toLowerCase().includes(q) ||
    Object.values(e.summary).some((v) => v.toLowerCase().includes(q))
  );
}

async function updateHistoryBadge(count) {
  if (count === undefined) { const h = await loadHistory(); count = h.length; }
  if (count > 0) {
    historyBadge.textContent = count > 99 ? '99+' : String(count);
    historyBadge.classList.remove('hidden');
  } else {
    historyBadge.classList.add('hidden');
  }
}

// ─── History: rendering ───────────────────────────────────────────────────────
function groupByDate(entries) {
  const t0        = new Date(); t0.setHours(0, 0, 0, 0);
  const today     = t0.getTime();
  const yesterday = today - 864e5;
  const weekAgo   = today - 7 * 864e5;
  return [
    { label: '今日',     items: entries.filter((e) => e.savedAt >= today)                             },
    { label: '昨日',     items: entries.filter((e) => e.savedAt >= yesterday && e.savedAt < today)    },
    { label: '今週',     items: entries.filter((e) => e.savedAt >= weekAgo   && e.savedAt < yesterday)},
    { label: 'それ以前', items: entries.filter((e) => e.savedAt < weekAgo)                            },
  ].filter((g) => g.items.length);
}

async function loadAndRenderHistory(query = '') {
  const all      = await loadHistory();
  const filtered = searchHistory(all, query);
  renderHistoryList(filtered);
}

function renderHistoryList(entries) {
  historyList.innerHTML = '';
  if (!entries.length) { historyEmpty.classList.remove('hidden'); return; }
  historyEmpty.classList.add('hidden');
  for (const group of groupByDate(entries)) {
    const groupEl = document.createElement('div');
    groupEl.className = 'history-group';
    const hdr = document.createElement('div');
    hdr.className   = 'history-group-label';
    hdr.textContent = group.label;
    groupEl.appendChild(hdr);
    group.items.forEach((e) => groupEl.appendChild(renderHistoryEntry(e)));
    historyList.appendChild(groupEl);
  }
}

function renderHistoryEntry(entry) {
  // Use the language stored with the entry; fall back to default
  const lc = getLangConfig(entry.language);

  let domain = '';
  try { domain = new URL(entry.url).hostname.replace(/^www\./, ''); } catch {}
  const date = new Date(entry.savedAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });

  const el = document.createElement('div');
  el.className  = 'history-entry';
  el.dataset.id = entry.id;

  // Top row
  const top = document.createElement('div');
  top.className = 'h-entry-top';

  const fav = document.createElement('img');
  fav.className = 'h-favicon';
  fav.src       = entry.favicon;
  fav.onerror   = () => { fav.style.display = 'none'; };

  const meta = document.createElement('div');
  meta.className = 'h-meta';
  const titleEl = document.createElement('div');
  titleEl.className = 'h-title'; titleEl.textContent = entry.title;
  const sub = document.createElement('div');
  sub.className = 'h-domain-date';
  sub.textContent = domain ? `${domain} · ${date}` : date;

  // Language badge
  const langBadge = document.createElement('span');
  langBadge.className   = 'h-lang-badge';
  langBadge.textContent = lc.name;
  sub.append(' '); sub.appendChild(langBadge);

  meta.append(titleEl, sub);

  const btnExpand = document.createElement('button');
  btnExpand.className = 'btn-he-expand'; btnExpand.title = '展開';
  btnExpand.textContent = '▾';

  const btnDel = document.createElement('button');
  btnDel.className = 'btn-he-delete'; btnDel.title = '削除';
  btnDel.textContent = '✕';

  top.append(fav, meta, btnExpand, btnDel);

  // Snippet
  const snippet = document.createElement('div');
  snippet.className = 'h-snippet';
  const s = entry.summary.conclusion;
  snippet.textContent = s.length > 55 ? s.slice(0, 55) + '…' : s;

  // Detail (expanded)
  const detail = document.createElement('div');
  detail.className = 'h-detail hidden';

  for (const [i, { cls, text }] of [
    { cls: 'h-conclusion', text: entry.summary.conclusion },
    { cls: 'h-background', text: entry.summary.background },
    { cls: 'h-next',       text: entry.summary.nextAction  },
  ].entries()) {
    const card = document.createElement('div');
    card.className = `h-card ${cls}`;
    const lbl = document.createElement('div');
    lbl.className   = 'h-card-label';
    lbl.textContent = `${CARD_ICONS[i]} ${lc.labels[i]}`;
    const p = document.createElement('p');
    p.textContent = text;
    card.append(lbl, p);
    detail.appendChild(card);
  }

  const actions = document.createElement('div');
  actions.className = 'h-entry-actions';

  const btnMd = document.createElement('button');
  btnMd.className = 'btn-secondary h-btn'; btnMd.textContent = '⊕ Markdown';

  const linkOpen = document.createElement('a');
  linkOpen.className = 'btn-secondary h-btn';
  linkOpen.href = entry.url; linkOpen.target = '_blank'; linkOpen.rel = 'noopener noreferrer';
  linkOpen.textContent = '↗ 開く';

  actions.append(btnMd, linkOpen);
  detail.appendChild(actions);
  el.append(top, snippet, detail);

  // Toggle
  function toggleExpand() {
    const isOpen = !detail.classList.contains('hidden');
    detail.classList.toggle('hidden',  isOpen);
    snippet.classList.toggle('hidden', !isOpen);
    btnExpand.textContent = isOpen ? '▾' : '▴';
    el.classList.toggle('expanded', !isOpen);
  }
  top.addEventListener('click', (e) => { if (e.target !== btnDel) toggleExpand(); });

  // Delete
  btnDel.addEventListener('click', async (e) => {
    e.stopPropagation();
    const count = await deleteHistoryEntry(entry.id);
    el.remove();
    const group = el.closest?.('.history-group');
    if (group && !group.querySelector('.history-entry')) group.remove();
    if (!historyList.querySelector('.history-entry')) historyEmpty.classList.remove('hidden');
    updateHistoryBadge(count);
  });

  // Copy Markdown
  btnMd.addEventListener('click', async () => {
    await navigator.clipboard.writeText(buildMarkdown(entry));
    btnMd.textContent = '✓ Copied';
    setTimeout(() => { btnMd.textContent = '⊕ Markdown'; }, 1800);
  });

  return el;
}

function buildMarkdown(entry) {
  const lc   = getLangConfig(entry.language);
  const date = new Date(entry.savedAt).toLocaleDateString('ja-JP');
  return [
    `## ${entry.title}`,
    ``,
    `- **URL**: ${entry.url}`,
    `- **Date**: ${date}`,
    `- **Language**: ${lc.name}`,
    ``,
    `**${lc.labels[0]}**: ${entry.summary.conclusion}`,
    `**${lc.labels[1]}**: ${entry.summary.background}`,
    `**${lc.labels[2]}**: ${entry.summary.nextAction}`,
  ].join('\n');
}

function getFaviconUrl(url) {
  try { return `https://www.google.com/s2/favicons?sz=16&domain=${new URL(url).hostname}`; }
  catch { return ''; }
}

// ─── Copy summary ─────────────────────────────────────────────────────────────
btnCopy.addEventListener('click', async () => {
  const text = [
    textConclusion.textContent && `${document.querySelector('[data-key="conclusion"]').textContent}: ${textConclusion.textContent}`,
    textBackground.textContent && `${document.querySelector('[data-key="background"]').textContent}: ${textBackground.textContent}`,
    textNext.textContent       && `${document.querySelector('[data-key="nextAction"]').textContent}: ${textNext.textContent}`,
  ].filter(Boolean).join('\n');

  try {
    await navigator.clipboard.writeText(text);
    copyIcon.textContent = '✓'; btnCopy.style.color = 'var(--accent-green)';
    setTimeout(() => { copyIcon.textContent = '⊕'; btnCopy.style.color = ''; }, 1800);
  } catch {
    copyIcon.textContent = '✗';
    setTimeout(() => { copyIcon.textContent = '⊕'; }, 1800);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function updatePageInfo(title, url) {
  pageTitleEl.textContent = title || '(no title)';
  try {
    const p = new URL(url);
    pageUrlEl.textContent             = p.hostname + p.pathname.slice(0, 40);
    pageFavicon.style.backgroundImage = `url(https://www.google.com/s2/favicons?sz=16&domain=${p.hostname})`;
  } catch { pageUrlEl.textContent = url ?? ''; }
  pageInfo.classList.remove('hidden');
}

function enableSummarizeButtons() {
  btnSummarize.disabled = false;
  btnRetry.disabled     = false;
}

function openOptions() { chrome.runtime.openOptionsPage(); }

// ─── Event listeners ──────────────────────────────────────────────────────────
tabSummarize.addEventListener('click', () => switchTab('summarize'));
tabHistory.addEventListener('click',   () => switchTab('history'));

btnSummarize.addEventListener('click', summarize);
btnRetry.addEventListener('click', summarize);
btnSettings.addEventListener('click', openOptions);
btnWarnSettings.addEventListener('click', openOptions);
btnGotoSettings.addEventListener('click', openOptions);

btnAsk.addEventListener('click', handleAsk);
qaInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk(); }
});

historySearch.addEventListener('input', () => {
  btnClearSearch.classList.toggle('hidden', !historySearch.value);
  loadAndRenderHistory(historySearch.value);
});

btnClearSearch.addEventListener('click', () => {
  historySearch.value = '';
  btnClearSearch.classList.add('hidden');
  loadAndRenderHistory('');
});

btnClearAll.addEventListener('click', async () => {
  if (!confirm('全ての履歴を削除しますか？')) return;
  await clearAllHistory();
  renderHistoryList([]);
  updateHistoryBadge(0);
});

// ─── Init ─────────────────────────────────────────────────────────────────────
Promise.all([refreshWarning(), prefetchContent(), updateHistoryBadge()]);
