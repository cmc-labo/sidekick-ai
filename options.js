const inputApiKey    = document.getElementById('api-key');
const selectModel    = document.getElementById('model');
const selectLang     = document.getElementById('lang');
const selectFontSize = document.getElementById('font-size');
const btnToggleKey   = document.getElementById('btn-toggle-key');
const btnSave        = document.getElementById('btn-save');
const btnTest        = document.getElementById('btn-test');
const statusEl       = document.getElementById('status');

// ─── UI strings ───────────────────────────────────────────────────────────────
const OPTIONS_UI = {
  en: {
    pageTitle:        'Sidekick AI — Settings',
    subtitle:         'Settings',
    labelRequired:    'Required',
    hintApiKey:       'Stored only in <code>chrome.storage.local</code>. Never sent anywhere except <code>api.openai.com</code>.',
    labelLang:        'Output Language',
    hintLang:         'Language for summaries and Q&amp;A answers. Source documents are processed in English.',
    labelFontSize:    'Font Size',
    fontSizeOptions:  ['Small', 'Medium (default)', 'Large'],
    labelModel:       'Model',
    btnSave:          'Save',
    btnTest:          'Test Connection',
    footerHint:       'Get your API key at ',
    errNoKey:         'Please enter an API key.',
    errBadKey:        'API key must start with "sk-".',
    errSave:          'Failed to save.',
    msgSaved:         '✓ Settings saved.',
    msgTesting:       'Testing connection...',
    msgTestOk:        '✓ Connected! API key is valid.',
    msgTestBad:       '✗ Invalid API key.',
    msgTestNet:       '✗ Network error. Check your connection.',
    errTestNoKey:     'Enter an API key to test.',
    msgTestHttp:      (s) => `✗ Error: HTTP ${s}`,
  },
  ja: {
    pageTitle:        'Sidekick AI — 設定',
    subtitle:         '設定',
    labelRequired:    '必須',
    hintApiKey:       'APIキーは <code>chrome.storage.local</code> にのみ保存され、<code>api.openai.com</code> 以外には送信されません。',
    labelLang:        '出力言語',
    hintLang:         '要約・Q&amp;A の出力言語を選択します。入力ドキュメントは英語のまま処理されます。',
    labelFontSize:    '文字サイズ',
    fontSizeOptions:  ['小', '中（デフォルト）', '大'],
    labelModel:       'モデル',
    btnSave:          '保存',
    btnTest:          '接続テスト',
    footerHint:       'APIキーの取得はこちら：',
    errNoKey:         'APIキーを入力してください。',
    errBadKey:        'APIキーは "sk-" で始まる必要があります。',
    errSave:          '保存に失敗しました。',
    msgSaved:         '✓ 設定を保存しました。',
    msgTesting:       '接続テスト中...',
    msgTestOk:        '✓ 接続成功！APIキーは有効です。',
    msgTestBad:       '✗ APIキーが無効です。',
    msgTestNet:       '✗ ネットワークエラー。接続を確認してください。',
    errTestNoKey:     'テストするにはAPIキーを入力してください。',
    msgTestHttp:      (s) => `✗ エラー: HTTP ${s}`,
  },
  zh: {
    pageTitle:        'Sidekick AI — 设置',
    subtitle:         '设置',
    labelRequired:    '必填',
    hintApiKey:       'API 密钥仅存储在 <code>chrome.storage.local</code> 中，不会发送到 <code>api.openai.com</code> 以外的地方。',
    labelLang:        '输出语言',
    hintLang:         '选择摘要和问答的输出语言。源文档将始终以英语进行处理。',
    labelFontSize:    '字体大小',
    fontSizeOptions:  ['小', '中（默认）', '大'],
    labelModel:       '模型',
    btnSave:          '保存',
    btnTest:          '测试连接',
    footerHint:       '在此处获取 API 密钥：',
    errNoKey:         '请输入 API 密钥。',
    errBadKey:        'API 密钥必须以 "sk-" 开头。',
    errSave:          '保存失败。',
    msgSaved:         '✓ 设置已保存。',
    msgTesting:       '正在测试连接...',
    msgTestOk:        '✓ 连接成功！API 密钥有效。',
    msgTestBad:       '✗ API 密钥无效。',
    msgTestNet:       '✗ 网络错误。请检查您的连接。',
    errTestNoKey:     '请输入 API 密钥后再测试。',
    msgTestHttp:      (s) => `✗ 错误：HTTP ${s}`,
  },
};

function getUI(lang) { return OPTIONS_UI[lang] ?? OPTIONS_UI.en; }

let currentUI = OPTIONS_UI.en;

function applyUI(lang) {
  currentUI = getUI(lang);
  document.title = currentUI.pageTitle;
  document.getElementById('subtitle').textContent       = currentUI.subtitle;
  document.getElementById('label-required').textContent = currentUI.labelRequired;
  document.getElementById('hint-api-key').innerHTML     = currentUI.hintApiKey;
  document.getElementById('label-lang').textContent     = currentUI.labelLang;
  document.getElementById('hint-lang').innerHTML        = currentUI.hintLang;
  document.getElementById('label-font-size').textContent = currentUI.labelFontSize;
  const fontSizeOpts = document.querySelectorAll('#font-size option');
  currentUI.fontSizeOptions.forEach((text, i) => { if (fontSizeOpts[i]) fontSizeOpts[i].textContent = text; });
  document.getElementById('label-model').textContent    = currentUI.labelModel;
  btnSave.textContent = currentUI.btnSave;
  btnTest.textContent = currentUI.btnTest;
  document.getElementById('footer-hint').textContent    = currentUI.footerHint;
}

// ─── Load saved values ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const { openai_api_key, openai_model, output_language, font_size } = await chrome.storage.local.get([
    'openai_api_key',
    'openai_model',
    'output_language',
    'font_size',
  ]);
  if (openai_api_key) inputApiKey.value   = openai_api_key;
  if (openai_model)   selectModel.value   = openai_model;
  if (output_language) selectLang.value   = output_language;
  selectFontSize.value = font_size || 'medium';
  applyUI(output_language || 'en');
});

// ─── Live language preview ────────────────────────────────────────────────────
selectLang.addEventListener('change', () => applyUI(selectLang.value));

// ─── Show / hide API key ──────────────────────────────────────────────────────
btnToggleKey.addEventListener('click', () => {
  const isPassword = inputApiKey.type === 'password';
  inputApiKey.type         = isPassword ? 'text' : 'password';
  btnToggleKey.textContent = isPassword ? '🙈' : '👁';
});

// ─── Save ─────────────────────────────────────────────────────────────────────
btnSave.addEventListener('click', async () => {
  const key = inputApiKey.value.trim();

  if (!key) { showStatus(currentUI.errNoKey, 'error'); return; }
  if (!key.startsWith('sk-')) { showStatus(currentUI.errBadKey, 'error'); return; }

  btnSave.disabled = true;
  try {
    await chrome.storage.local.set({
      openai_api_key:  key,
      openai_model:    selectModel.value,
      output_language: selectLang.value,
      font_size:       selectFontSize.value,
    });
    showStatus(currentUI.msgSaved, 'success');
  } catch {
    showStatus(currentUI.errSave, 'error');
  } finally {
    btnSave.disabled = false;
  }
});

// ─── Connection test ──────────────────────────────────────────────────────────
btnTest.addEventListener('click', async () => {
  const key = inputApiKey.value.trim();
  if (!key) { showStatus(currentUI.errTestNoKey, 'error'); return; }

  btnTest.disabled = true;
  showStatus(currentUI.msgTesting, 'info');

  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      showStatus(currentUI.msgTestOk, 'success');
    } else if (res.status === 401) {
      showStatus(currentUI.msgTestBad, 'error');
    } else {
      showStatus(currentUI.msgTestHttp(res.status), 'error');
    }
  } catch {
    showStatus(currentUI.msgTestNet, 'error');
  } finally {
    btnTest.disabled = false;
  }
});

// ─── Status helper ────────────────────────────────────────────────────────────
function showStatus(msg, type = 'info') {
  statusEl.textContent = msg;
  statusEl.className   = `status status-${type}`;
  statusEl.classList.remove('hidden');
  if (type === 'success') {
    setTimeout(() => statusEl.classList.add('hidden'), 3000);
  }
}
