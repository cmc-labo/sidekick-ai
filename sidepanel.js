/**
 * Sidekick AI – Side Panel
 *
 * Features:
 *  - Prefetch page content on panel open (minimises click-to-API latency)
 *  - 3-line structured summary streamed from OpenAI in English / 日本語 / 中文
 *  - Context-aware multi-turn QA in the selected language
 *  - Persistent history saved to chrome.storage.local with language metadata
 *  - Full UI i18n: all labels update when the output language is changed
 */

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL  = 'gpt-4.1-nano';
const DEFAULT_LANG   = 'en';
const HISTORY_KEY    = 'summary_history';
const MAX_ENTRIES    = 500;
const MAX_QA_HISTORY = 8;

// ─── Content language config (summary output format) ─────────────────────────
const LANG_CONFIG = {
  en: {
    name:          'English',
    labels:        ['Conclusion', 'Background', 'Next Action'],
    re: [
      /^Conclusion[：:]\s*/i,
      /^Background[：:]\s*/i,
      /^Next\s*Action[：:]\s*/i,
    ],
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

// ─── UI string config (panel chrome / labels) ─────────────────────────────────
const UI_STRINGS = {
  en: {
    btnSettingsTitle:         'Settings',
    btnSummarize:             'Summarize',
    btnSummarizeTitle:        'Summarize this page',
    tabSummarize:             'Summary',
    tabHistory:               'History',
    apiWarning:               'OpenAI API key is not set',
    btnWarningSettings:       'Open Settings →',
    idleText:                 'Open a technical document\nand click "Summarize"',
    idleSources:              ['GitHub README / Issue / PR', 'arXiv papers', 'Tech blogs & docs'],
    loadingContent:           'Loading content...',
    btnCopy:                  'Copy',
    btnCopyTitle:             'Copy to clipboard',
    btnRetry:                 '↺ Retry',
    qaSectionHint:            'Ask questions about this page',
    btnClearQATitle:          'Clear chat',
    btnAskTitle:              'Send (Enter)',
    historySearchPlaceholder: 'Search by title, URL, or summary...',
    btnClearSearchTitle:      'Clear',
    btnClearAllTitle:         'Delete all history',
    historyEmptyText:         'Summaries you read will appear here',
    historyGroupPinned:       'Pinned',
    historyGroupToday:        'Today',
    historyGroupYesterday:    'Yesterday',
    historyGroupThisWeek:     'This Week',
    historyGroupOlder:        'Older',
    btnPinTitle:              'Pin to top',
    btnUnpinTitle:            'Unpin',
    btnExpandTitle:           'Expand',
    btnDeleteTitle:           'Delete',
    btnMarkdownText:          '⊕ Markdown',
    btnMarkdownCopied:        '✓ Copied',
    btnOpenText:              '↗ Open',
    confirmClearAll:          'Delete all history?',
    btnGotoSettings:          '⚙ Set API Key',
    errorNoKey:               'OpenAI API key is not set.',
    errorNoTab:               'No active tab found.',
    errorNoContent:           'Could not retrieve page content.',
    errorNoContentHint:       'Reload the page and try again. chrome:// and extension pages are not supported.',
    errorNoText:              'No summarizable text found.',
    errorSummarize:           'Error during summarization: ',
    errorAuth:                'Invalid API key. Check your settings.',
    errorRateLimit:           'Rate limit reached. Please try again later.',
    errorServerError:         'OpenAI server error. Please try again later.',
    errorQAPrefix:            'Error: ',
    dateLocale:               'en-US',
  },
  ja: {
    btnSettingsTitle:         '設定 (APIキー)',
    btnSummarize:             '要約',
    btnSummarizeTitle:        'このページを要約',
    tabSummarize:             '要約',
    tabHistory:               '履歴',
    apiWarning:               'OpenAI APIキーが未設定です',
    btnWarningSettings:       '設定を開く →',
    idleText:                 '技術ドキュメントを開いて\n「要約」ボタンを押してください',
    idleSources:              ['GitHub README / Issue / PR', 'arXiv 論文', '技術ブログ・ドキュメント'],
    loadingContent:           'コンテンツを取得中...',
    btnCopy:                  'コピー',
    btnCopyTitle:             'クリップボードにコピー',
    btnRetry:                 '↺ 再要約',
    qaSectionHint:            'ページの内容について質問できます',
    btnClearQATitle:          '会話をクリア',
    btnAskTitle:              '送信 (Enter)',
    historySearchPlaceholder: 'タイトル・URL・要約で検索...',
    btnClearSearchTitle:      'クリア',
    btnClearAllTitle:         '全履歴を削除',
    historyEmptyText:         '要約した記事が履歴に表示されます',
    historyGroupPinned:       'ピン留め',
    historyGroupToday:        '今日',
    historyGroupYesterday:    '昨日',
    historyGroupThisWeek:     '今週',
    historyGroupOlder:        'それ以前',
    btnPinTitle:              'ピン留め',
    btnUnpinTitle:            'ピン留めを解除',
    btnExpandTitle:           '展開',
    btnDeleteTitle:           '削除',
    btnMarkdownText:          '⊕ Markdown',
    btnMarkdownCopied:        '✓ コピー済み',
    btnOpenText:              '↗ 開く',
    confirmClearAll:          '全ての履歴を削除しますか？',
    btnGotoSettings:          '⚙ APIキーを設定する',
    errorNoKey:               'OpenAI APIキーが設定されていません。',
    errorNoTab:               'アクティブなタブが見つかりません。',
    errorNoContent:           'ページコンテンツを取得できませんでした。',
    errorNoContentHint:       'ページをリロードしてから再試行してください。chrome:// ページや拡張機能ページは非対応です。',
    errorNoText:              '要約できるテキストが見つかりませんでした。',
    errorSummarize:           '要約中にエラーが発生しました: ',
    errorAuth:                'APIキーが無効です。設定を確認してください。',
    errorRateLimit:           'レート制限に達しました。しばらくしてから再試行してください。',
    errorServerError:         'OpenAIサーバーエラーです。時間をおいて再試行してください。',
    errorQAPrefix:            'エラー: ',
    dateLocale:               'ja-JP',
  },
  zh: {
    btnSettingsTitle:         '设置',
    btnSummarize:             '摘要',
    btnSummarizeTitle:        '摘要本页面',
    tabSummarize:             '摘要',
    tabHistory:               '历史',
    apiWarning:               '未设置 OpenAI API 密钥',
    btnWarningSettings:       '打开设置 →',
    idleText:                 '打开技术文档\n然后点击"摘要"按钮',
    idleSources:              ['GitHub README / Issue / PR', 'arXiv 论文', '技术博客和文档'],
    loadingContent:           '正在获取内容...',
    btnCopy:                  '复制',
    btnCopyTitle:             '复制到剪贴板',
    btnRetry:                 '↺ 重新摘要',
    qaSectionHint:            '可以就本页面内容提问',
    btnClearQATitle:          '清除对话',
    btnAskTitle:              '发送 (Enter)',
    historySearchPlaceholder: '按标题、URL 或摘要搜索...',
    btnClearSearchTitle:      '清除',
    btnClearAllTitle:         '删除所有历史',
    historyEmptyText:         '已摘要的文章将显示在这里',
    historyGroupPinned:       '置顶',
    historyGroupToday:        '今天',
    historyGroupYesterday:    '昨天',
    historyGroupThisWeek:     '本周',
    historyGroupOlder:        '更早',
    btnPinTitle:              '置顶',
    btnUnpinTitle:            '取消置顶',
    btnExpandTitle:           '展开',
    btnDeleteTitle:           '删除',
    btnMarkdownText:          '⊕ Markdown',
    btnMarkdownCopied:        '✓ 已复制',
    btnOpenText:              '↗ 打开',
    confirmClearAll:          '删除所有历史记录？',
    btnGotoSettings:          '⚙ 设置 API 密钥',
    errorNoKey:               '未设置 OpenAI API 密钥。',
    errorNoTab:               '未找到活动标签页。',
    errorNoContent:           '无法获取页面内容。',
    errorNoContentHint:       '请重新加载页面后重试。chrome:// 页面和扩展页面不受支持。',
    errorNoText:              '未找到可摘要的文本。',
    errorSummarize:           '摘要时发生错误: ',
    errorAuth:                'API 密钥无效。请检查您的设置。',
    errorRateLimit:           '已达到速率限制。请稍后重试。',
    errorServerError:         'OpenAI 服务器错误。请稍后重试。',
    errorQAPrefix:            '错误: ',
    dateLocale:               'zh-CN',
  },
};

function getUIStrings(lang) {
  return UI_STRINGS[lang] ?? UI_STRINGS[DEFAULT_LANG];
}

// ─── Font size ────────────────────────────────────────────────────────────────
const FONT_SIZE_MAP = { small: '12px', medium: '13px', large: '15px' };

function applyFontSize(size) {
  document.documentElement.style.setProperty('--font-base', FONT_SIZE_MAP[size] ?? '13px');
}

// ─── Theme ────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme || 'dark');
}

// ─── Auto-copy ────────────────────────────────────────────────────────────────
let autoCopyEnabled = false;

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
const btnClearQA      = document.getElementById('btn-clear-qa');
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
const countConclusion = document.getElementById('count-conclusion');
const countBackground = document.getElementById('count-background');
const countNext       = document.getElementById('count-next');

// ─── Tab / state management ───────────────────────────────────────────────────
let activeTab          = 'summarize';
let lastSummarizeState = 'idle';
let currentUILang      = DEFAULT_LANG;

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

// ─── UI i18n ──────────────────────────────────────────────────────────────────
function applyUIStrings(lang) {
  currentUILang = lang;
  const ui = getUIStrings(lang);

  btnSettings.title  = ui.btnSettingsTitle;
  document.getElementById('summarize-label').textContent = ui.btnSummarize;
  btnSummarize.title = ui.btnSummarizeTitle;

  document.getElementById('tab-summarize-label').textContent = ui.tabSummarize;
  document.getElementById('tab-history-label').textContent   = ui.tabHistory;

  document.getElementById('warning-text').textContent = ui.apiWarning;
  btnWarnSettings.textContent = ui.btnWarningSettings;

  document.getElementById('idle-text').textContent = ui.idleText;
  const sourceItems = document.querySelectorAll('.idle-sources li');
  ui.idleSources.forEach((text, i) => { if (sourceItems[i]) sourceItems[i].textContent = text; });

  document.getElementById('copy-label').textContent = ui.btnCopy;
  btnCopy.title = ui.btnCopyTitle;
  document.getElementById('retry-label').textContent = ui.btnRetry;

  document.getElementById('qa-section-hint').textContent = ui.qaSectionHint;
  btnClearQA.title = ui.btnClearQATitle;
  btnAsk.title = ui.btnAskTitle;

  historySearch.placeholder = ui.historySearchPlaceholder;
  btnClearSearch.title      = ui.btnClearSearchTitle;
  btnClearAll.title         = ui.btnClearAllTitle;
  document.getElementById('history-empty-text').textContent = ui.historyEmptyText;

  btnGotoSettings.textContent = ui.btnGotoSettings;
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
  if ('output_language' in changes) {
    const lang = changes.output_language.newValue || DEFAULT_LANG;
    applyUIStrings(lang);
    if (activeTab === 'history') loadAndRenderHistory(historySearch.value);
  }
  if ('font_size' in changes) applyFontSize(changes.font_size.newValue || 'medium');
  if ('theme' in changes) applyTheme(changes.theme.newValue);
  if ('auto_copy' in changes) autoCopyEnabled = Boolean(changes.auto_copy.newValue);
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
  btnClearQA.classList.add('hidden');
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
function updateCharCounts() {
  const fmt = (n) => n > 0 ? String(n) : '';
  countConclusion.textContent = fmt(textConclusion.textContent.length);
  countBackground.textContent = fmt(textBackground.textContent.length);
  countNext.textContent       = fmt(textNext.textContent.length);
}

function renderSummaryStream(raw, lang) {
  const lc = getLangConfig(lang);
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (lc.re[0].test(t))      textConclusion.textContent = t.replace(lc.re[0], '');
    else if (lc.re[1].test(t)) textBackground.textContent = t.replace(lc.re[1], '');
    else if (lc.re[2].test(t)) textNext.textContent       = t.replace(lc.re[2], '');
  }
  updateCharCounts();
}

// ─── Token cost map (USD per 1M tokens) ──────────────────────────────────────
const TOKEN_COST = {
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4o-mini':  { input: 0.15, output: 0.60 },
  'gpt-4.1':      { input: 2.00, output: 8.00 },
  'gpt-4o':       { input: 2.50, output: 10.00 },
};

// ─── Generic SSE streaming ────────────────────────────────────────────────────
async function streamTokens(apiKey, model, messages, maxTokens, onDelta) {
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, messages, stream: true, max_tokens: maxTokens, temperature: 0.2,
      stream_options: { include_usage: true },
    }),
  });

  if (!response.ok) {
    const apiMsg = await response.json().then((j) => j.error?.message).catch(() => null);
    const err = new Error(apiMsg ?? `HTTP ${response.status}`);
    err.httpStatus = response.status;
    throw err;
  }

  const reader = response.body.getReader();
  const dec    = new TextDecoder();
  let buffer   = '';
  let usage    = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return usage;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content ?? '';
        if (delta) onDelta(delta);
        if (parsed.usage) usage = parsed.usage;
      } catch {}
    }
  }
  return usage;
}

// ─── Summarize ────────────────────────────────────────────────────────────────
async function summarize() {
  btnSummarize.disabled = true;
  btnRetry.disabled     = true;
  pageInfo.classList.add('hidden');
  clearTokenInfo();

  const [{ openai_api_key, openai_model, output_language }, [tab]] = await Promise.all([
    chrome.storage.local.get(['openai_api_key', 'openai_model', 'output_language']),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);

  const lang = output_language || DEFAULT_LANG;
  const ui   = getUIStrings(lang);

  if (!openai_api_key) { showError(ui.errorNoKey, true); enableSummarizeButtons(); return; }
  if (!tab?.id)        { showError(ui.errorNoTab);        enableSummarizeButtons(); return; }

  const model  = openai_model || DEFAULT_MODEL;
  const tabId  = tab.id;
  const tabUrl = tab.url;

  let contentData = (prefetch.tabId === tabId && prefetch.url === tabUrl) ? prefetch.data : null;
  if (!contentData) {
    showLoading(ui.loadingContent);
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'GET_CONTENT' });
      if (!res?.ok) throw new Error(res?.error ?? 'unknown');
      contentData = res.data;
      prefetch.tabId = tabId; prefetch.url = tabUrl; prefetch.data = contentData;
    } catch {
      showError(ui.errorNoContent, false, ui.errorNoContentHint);
      enableSummarizeButtons(); return;
    }
  }

  const { title, text } = contentData;
  if (!text || text.length < 100) { showError(ui.errorNoText); enableSummarizeButtons(); return; }

  updateCardLabels(lang);
  currentContext = { title, text };
  resetQA(lang);
  updatePageInfo(title, tabUrl);

  textConclusion.textContent = '';
  textBackground.textContent = '';
  textNext.textContent       = '';
  countConclusion.textContent = '';
  countBackground.textContent = '';
  countNext.textContent       = '';
  const streamEls = [textConclusion, textBackground, textNext];
  streamEls.forEach((el) => el.classList.add('streaming'));
  showState('result');

  let accumulated = '';
  let usage = null;
  try {
    usage = await streamTokens(openai_api_key, model, buildSummaryMessages(title, text, lang), 250, (delta) => {
      accumulated += delta;
      renderSummaryStream(accumulated, lang);
    });
  } catch (err) {
    let msg;
    let isAuth = false;
    if (err.httpStatus === 401) { msg = ui.errorAuth; isAuth = true; }
    else if (err.httpStatus === 429) msg = ui.errorRateLimit;
    else if (err.httpStatus === 500) msg = ui.errorServerError;
    else msg = ui.errorSummarize + err.message;
    showError(msg, isAuth);
    streamEls.forEach((el) => el.classList.remove('streaming'));
    enableSummarizeButtons(); return;
  }

  streamEls.forEach((el) => el.classList.remove('streaming'));
  showTokenInfo(usage, model);

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

  if (autoCopyEnabled) copySummary();
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
  const ui     = getUIStrings(lang);
  let   answer = '';

  const answerTextEl = answerBubble.querySelector('.qa-bubble-text') ?? answerBubble;
  try {
    await streamTokens(
      openai_api_key, openai_model || DEFAULT_MODEL,
      buildQAMessages(question, lang), 400,
      (delta) => {
        answer += delta;
        answerTextEl.textContent = answer;
        qaHistory.scrollTop = qaHistory.scrollHeight;
      }
    );
    chatHistory.push({ role: 'user',      content: question });
    chatHistory.push({ role: 'assistant', content: answer   });
    answerBubble.querySelector('.qa-bubble-copy')?.classList.remove('hidden');
  } catch (err) {
    let msg = ui.errorQAPrefix + err.message;
    if (err.httpStatus === 401) msg = ui.errorAuth;
    answerTextEl.textContent = msg;
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
  btnClearQA.classList.remove('hidden');
  const bubble = document.createElement('div');
  bubble.className = `qa-bubble qa-bubble-${role}`;
  if (role === 'assistant') {
    const textSpan = document.createElement('span');
    textSpan.className   = 'qa-bubble-text';
    textSpan.textContent = content;
    const copyBtn = document.createElement('button');
    copyBtn.className   = 'qa-bubble-copy hidden';
    copyBtn.textContent = '⊕';
    copyBtn.title       = 'Copy';
    copyBtn.addEventListener('click', async () => {
      const text = bubble.querySelector('.qa-bubble-text')?.textContent ?? '';
      await navigator.clipboard.writeText(text).catch(() => {});
      copyBtn.textContent = '✓';
      setTimeout(() => { copyBtn.textContent = '⊕'; }, 1500);
    });
    bubble.append(textSpan, copyBtn);
  } else {
    bubble.textContent = content;
  }
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
  if (idx >= 0) {
    entry.pinned = hist[idx].pinned || false;
    hist[idx] = entry;
  } else { hist.unshift(entry); hist.length = Math.min(hist.length, MAX_ENTRIES); }
  await chrome.storage.local.set({ [HISTORY_KEY]: hist });
  return hist.length;
}

async function deleteHistoryEntry(id) {
  const { [HISTORY_KEY]: hist = [] } = await chrome.storage.local.get(HISTORY_KEY);
  const updated = hist.filter((e) => e.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: updated });
  return updated.length;
}

async function togglePin(id) {
  const { [HISTORY_KEY]: hist = [] } = await chrome.storage.local.get(HISTORY_KEY);
  const entry = hist.find((e) => e.id === id);
  if (entry) entry.pinned = !entry.pinned;
  await chrome.storage.local.set({ [HISTORY_KEY]: hist });
  loadAndRenderHistory(historySearch.value);
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
  const ui        = getUIStrings(currentUILang);
  const t0        = new Date(); t0.setHours(0, 0, 0, 0);
  const today     = t0.getTime();
  const yesterday = today - 864e5;
  const weekAgo   = today - 7 * 864e5;
  return [
    { label: ui.historyGroupToday,     items: entries.filter((e) => e.savedAt >= today)                              },
    { label: ui.historyGroupYesterday, items: entries.filter((e) => e.savedAt >= yesterday && e.savedAt < today)    },
    { label: ui.historyGroupThisWeek,  items: entries.filter((e) => e.savedAt >= weekAgo   && e.savedAt < yesterday)},
    { label: ui.historyGroupOlder,     items: entries.filter((e) => e.savedAt < weekAgo)                            },
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

  const pinned   = entries.filter((e) => e.pinned);
  const unpinned = entries.filter((e) => !e.pinned);

  const makeGroup = (label, items) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'history-group';
    const hdr = document.createElement('div');
    hdr.className   = 'history-group-label';
    hdr.textContent = label;
    groupEl.appendChild(hdr);
    items.forEach((e) => groupEl.appendChild(renderHistoryEntry(e)));
    historyList.appendChild(groupEl);
  };

  if (pinned.length) {
    makeGroup(getUIStrings(currentUILang).historyGroupPinned, pinned);
  }
  for (const group of groupByDate(unpinned)) {
    makeGroup(group.label, group.items);
  }
}

function renderHistoryEntry(entry) {
  const lc = getLangConfig(entry.language);
  const ui = getUIStrings(currentUILang);

  let domain = '';
  try { domain = new URL(entry.url).hostname.replace(/^www\./, ''); } catch {}
  const date = new Date(entry.savedAt).toLocaleDateString(ui.dateLocale, { month: 'short', day: 'numeric' });

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

  const langBadge = document.createElement('span');
  langBadge.className   = 'h-lang-badge';
  langBadge.textContent = lc.name;
  sub.append(' '); sub.appendChild(langBadge);

  meta.append(titleEl, sub);

  const btnPin = document.createElement('button');
  btnPin.className   = `btn-he-pin${entry.pinned ? ' active' : ''}`;
  btnPin.title       = entry.pinned ? ui.btnUnpinTitle : ui.btnPinTitle;
  btnPin.textContent = '★';

  const btnExpand = document.createElement('button');
  btnExpand.className   = 'btn-he-expand';
  btnExpand.title       = ui.btnExpandTitle;
  btnExpand.textContent = '▾';

  const btnDel = document.createElement('button');
  btnDel.className   = 'btn-he-delete';
  btnDel.title       = ui.btnDeleteTitle;
  btnDel.textContent = '✕';

  top.append(fav, meta, btnPin, btnExpand, btnDel);

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
  btnMd.className   = 'btn-secondary h-btn';
  btnMd.textContent = ui.btnMarkdownText;

  const linkOpen = document.createElement('a');
  linkOpen.className = 'btn-secondary h-btn';
  linkOpen.href      = entry.url;
  linkOpen.target    = '_blank';
  linkOpen.rel       = 'noopener noreferrer';
  linkOpen.textContent = ui.btnOpenText;

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
  top.addEventListener('click', (e) => { if (e.target !== btnDel && e.target !== btnPin) toggleExpand(); });

  // Pin / Unpin
  btnPin.addEventListener('click', async (e) => {
    e.stopPropagation();
    await togglePin(entry.id);
  });

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
    btnMd.textContent = getUIStrings(currentUILang).btnMarkdownCopied;
    setTimeout(() => { btnMd.textContent = getUIStrings(currentUILang).btnMarkdownText; }, 1800);
  });

  return el;
}

function buildMarkdown(entry) {
  const lc   = getLangConfig(entry.language);
  const ui   = getUIStrings(entry.language);
  const date = new Date(entry.savedAt).toLocaleDateString(ui.dateLocale);
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

// ─── Token info display ───────────────────────────────────────────────────────
const tokenInfoEl = document.getElementById('token-info');

function showTokenInfo(usage, model) {
  if (!usage || !tokenInfoEl) return;
  const { prompt_tokens = 0, completion_tokens = 0, total_tokens = 0 } = usage;
  const cost = TOKEN_COST[model];
  let parts = [`${total_tokens.toLocaleString()} tokens`];
  if (cost) {
    const usd = (prompt_tokens * cost.input + completion_tokens * cost.output) / 1_000_000;
    parts.push(`$${usd.toFixed(5)}`);
  }
  tokenInfoEl.textContent = parts.join(' · ');
  tokenInfoEl.classList.remove('hidden');
}

function clearTokenInfo() {
  if (tokenInfoEl) { tokenInfoEl.textContent = ''; tokenInfoEl.classList.add('hidden'); }
}

// ─── Copy summary ─────────────────────────────────────────────────────────────
async function copySummary() {
  const text = [
    textConclusion.textContent && `${document.querySelector('[data-key="conclusion"]').textContent}: ${textConclusion.textContent}`,
    textBackground.textContent && `${document.querySelector('[data-key="background"]').textContent}: ${textBackground.textContent}`,
    textNext.textContent       && `${document.querySelector('[data-key="nextAction"]').textContent}: ${textNext.textContent}`,
  ].filter(Boolean).join('\n');
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copyIcon.textContent = '✓'; btnCopy.style.color = 'var(--accent-green)';
    setTimeout(() => { copyIcon.textContent = '⊕'; btnCopy.style.color = ''; }, 1800);
  } catch {
    copyIcon.textContent = '✗';
    setTimeout(() => { copyIcon.textContent = '⊕'; }, 1800);
  }
}

btnCopy.addEventListener('click', copySummary);

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
btnClearQA.addEventListener('click', () => resetQA(currentUILang));
qaInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk(); }
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.shiftKey) {
    if (lastSummarizeState !== 'result') return;
    if (window.getSelection()?.toString()) return;
    e.preventDefault();
    copySummary();
  }
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
  if (!confirm(getUIStrings(currentUILang).confirmClearAll)) return;
  await clearAllHistory();
  renderHistoryList([]);
  updateHistoryBadge(0);
});

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const { output_language, font_size, theme, auto_copy } = await chrome.storage.local.get(['output_language', 'font_size', 'theme', 'auto_copy']);
  applyUIStrings(output_language || DEFAULT_LANG);
  applyFontSize(font_size || 'medium');
  applyTheme(theme);
  autoCopyEnabled = Boolean(auto_copy);
  await Promise.all([refreshWarning(), prefetchContent(), updateHistoryBadge()]);
}

init();
