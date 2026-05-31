const inputApiKey   = document.getElementById('api-key');
const selectModel   = document.getElementById('model');
const selectLang    = document.getElementById('lang');
const btnToggleKey  = document.getElementById('btn-toggle-key');
const btnSave       = document.getElementById('btn-save');
const btnTest       = document.getElementById('btn-test');
const statusEl      = document.getElementById('status');

// ─── Load saved values ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const { openai_api_key, openai_model, output_language } = await chrome.storage.local.get([
    'openai_api_key',
    'openai_model',
    'output_language',
  ]);
  if (openai_api_key)  inputApiKey.value = openai_api_key;
  if (openai_model)    selectModel.value = openai_model;
  if (output_language) selectLang.value  = output_language;
});

// ─── Show / hide API key ──────────────────────────────────────────────────────
btnToggleKey.addEventListener('click', () => {
  const isPassword = inputApiKey.type === 'password';
  inputApiKey.type         = isPassword ? 'text' : 'password';
  btnToggleKey.textContent = isPassword ? '🙈' : '👁';
});

// ─── Save ─────────────────────────────────────────────────────────────────────
btnSave.addEventListener('click', async () => {
  const key   = inputApiKey.value.trim();
  const model = selectModel.value;

  if (!key) {
    showStatus('APIキーを入力してください。', 'error');
    return;
  }
  if (!key.startsWith('sk-')) {
    showStatus('APIキーは "sk-" で始まる必要があります。', 'error');
    return;
  }

  btnSave.disabled = true;
  try {
    await chrome.storage.local.set({ openai_api_key: key, openai_model: model, output_language: selectLang.value });
    showStatus('✓ 設定を保存しました。', 'success');
  } catch {
    showStatus('保存に失敗しました。', 'error');
  } finally {
    btnSave.disabled = false;
  }
});

// ─── Connection test ──────────────────────────────────────────────────────────
btnTest.addEventListener('click', async () => {
  const key = inputApiKey.value.trim();
  if (!key) {
    showStatus('テストするにはAPIキーを入力してください。', 'error');
    return;
  }

  btnTest.disabled = true;
  showStatus('接続テスト中...', 'info');

  try {
    // Lightweight call: list models (no token consumption)
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (res.ok) {
      showStatus('✓ 接続成功！APIキーは有効です。', 'success');
    } else if (res.status === 401) {
      showStatus('✗ APIキーが無効です。', 'error');
    } else {
      showStatus(`✗ エラー: HTTP ${res.status}`, 'error');
    }
  } catch {
    showStatus('✗ ネットワークエラー。接続を確認してください。', 'error');
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
