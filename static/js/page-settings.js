/**
 * ComfyCarry — page-settings.js
 * 设置页: 3 Tab (ComfyCarry / CivitAI / LLM)
 */

import { registerPage, registerEscapeHandler, showToast, loadApiKey, msIcon, apiFetch } from './core.js';
import { createLogStream } from './sse-log.js';

let _debugLogStream = null;
let _llmProviders = null; // cached provider list
let _llmProviderKeys = {}; // per-provider saved keys: { provId: { api_key, model, base_url } }
let _llmAllModels = []; // cached model list for filtering

registerPage('settings', {
  enter() { loadSettingsPage(); },
  leave() { _stopDebugLogStream(); }
});

// ── Tab 切换 ────────────────────────────────────────────────

function switchSettingsTab(tabId) {
  document.querySelectorAll('#settings-tabs .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.stab === tabId);
  });
  document.querySelectorAll('.settings-tab-content').forEach(el => {
    el.style.display = el.id === `settings-tab-${tabId}` ? '' : 'none';
  });

  // start/stop log stream based on tab
  if (tabId === 'comfycarry') {
    _startDebugLogStream();
  } else {
    _stopDebugLogStream();
  }

  // lazy-load LLM tab data
  if (tabId === 'llm' && !_llmProviders) {
    _loadLlmTab();
  }
}

async function loadSettingsPage() {
  try {
    const settingsR = await fetch('/api/settings');
    const settings = await settingsR.json();

    const civKeyInput = document.getElementById('settings-civitai-key');
    if (civKeyInput && settings.civitai_key_set && settings.civitai_key) {
      civKeyInput.value = settings.civitai_key;
    }

    // API Key
    const apiKeyInput = document.getElementById('settings-api-key');
    if (apiKeyInput && settings.api_key) {
      apiKeyInput.dataset.key = settings.api_key;
      apiKeyInput.value = '••••••••••••••••••••••••';
      apiKeyInput.classList.add('secret-masked');
    }

    _startDebugLogStream();
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

function _startDebugLogStream() {
  _stopDebugLogStream();
  const el = document.getElementById('log-content');
  if (!el) return;
  _debugLogStream = createLogStream({
    el,
    historyUrl: '/api/logs/dashboard?lines=100',
    streamUrl: '/api/logs/dashboard/stream',
  });
  _debugLogStream.start();
}

function _stopDebugLogStream() {
  if (_debugLogStream) { _debugLogStream.stop(); _debugLogStream = null; }
}

async function changePassword() {
  const current = document.getElementById('settings-pw-current').value;
  const newPw = document.getElementById('settings-pw-new').value;
  const confirmPw = document.getElementById('settings-pw-confirm').value;
  if (!current) return showToast('请输入当前密码');
  if (!newPw) return showToast('请输入新密码');
  if (newPw.length < 4) return showToast('密码至少 4 个字符');
  if (newPw !== confirmPw) return showToast('两次输入的密码不一致');
  const d = await apiFetch('/api/settings/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current, new: newPw })
  });
  if (!d) return;
  showToast(d.message);
  document.getElementById('settings-pw-current').value = '';
  document.getElementById('settings-pw-new').value = '';
  document.getElementById('settings-pw-confirm').value = '';
}

async function saveSettingsCivitaiKey() {
  const key = document.getElementById('settings-civitai-key').value.trim();
  if (!key) return showToast('请输入 API Key');
  const d = await apiFetch('/api/settings/civitai-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key })
  });
  if (!d) return;
  showToast(d.ok ? 'API Key 已保存' : (d.error || '保存失败'));
  document.getElementById('settings-civitai-key').value = '';
  loadSettingsPage();
  loadApiKey();
}

async function clearSettingsCivitaiKey() {
  if (!confirm('确定要清除 CivitAI API Key?')) return;
  const d = await apiFetch('/api/settings/civitai-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: '' })
  });
  if (!d) return;
  showToast('API Key 已清除');
  loadSettingsPage();
  loadApiKey();
}

async function restartDashboard() {
  if (!confirm('确定要重启 ComfyCarry 吗? 页面将短暂不可用')) return;
  const d = await apiFetch('/api/settings/restart', { method: 'POST' });
  if (!d) return;
  showToast('ComfyCarry 正在重启, 3 秒后自动刷新...');
  setTimeout(() => location.reload(), 3000);
}

async function reinitialize() {
  const keepModels = document.getElementById('reinit-keep-models')?.checked ?? true;
  const msg = keepModels
    ? '确定要重新初始化吗?\n\n将删除 ComfyUI 安装 (保留模型文件)，停止 ComfyUI 和同步服务，重新进入部署向导。\n\n系统依赖、PyTorch、Tunnel 不受影响。'
    : '确定要重新初始化吗?\n\n将删除整个 ComfyUI 目录 (包括所有模型文件)，停止 ComfyUI 和同步服务，重新进入部署向导。\n\n模型文件将被永久删除！';
  if (!confirm(msg)) return;
  if (!keepModels && !confirm('再次确认: 所有模型文件将被永久删除，无法恢复。继续？')) return;
  showToast('正在重新初始化...');
  const d = await apiFetch('/api/settings/reinitialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keep_models: keepModels })
  });
  if (!d) return;
  if (d.ok) {
    showToast('已重置, 正在跳转到部署向导...');
    setTimeout(() => location.reload(), 1500);
  } else {
    showToast('部分操作失败: ' + (d.errors || []).join('; '));
  }
}

// ── Import / Export ─────────────────────────────────────────

async function exportConfig() {
  try {
    const r = await fetch('/api/settings/export-config');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comfycarry-config-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('配置已导出');
  } catch (e) { showToast('导出失败: ' + e.message); }
}

async function importConfig(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  event.target.value = '';
  try {
    const text = await file.text();
    const config = JSON.parse(text);
    if (!config._version) {
      showToast('无效的配置文件格式');
      return;
    }
    if (!confirm(`确定要导入配置吗?\n\n导出于: ${config._exported_at || '未知'}\n将覆盖当前的密码、API Key、Tunnel 配置、同步规则等设置。`)) return;
    const d = await apiFetch('/api/settings/import-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: text
    });
    if (!d) return;
    showToast(d.message);
    if (document.getElementById('page-settings')?.classList.contains('hidden') === false) loadSettingsPage();
  } catch (e) { showToast('导入失败: ' + e.message); }
}

// ── API Key 管理 ────────────────────────────────────────────

async function regenerateApiKey() {
  if (!confirm('确定要重新生成 API Key 吗？\n\n旧的 Key 将立即失效，所有使用旧 Key 的外部应用需要更新。')) return;
  const d = await apiFetch('/api/settings/api-key', { method: 'POST' });
  if (!d) return;
  if (d.ok) {
    const el = document.getElementById('settings-api-key');
    if (el) { el.dataset.key = d.api_key; el.classList.remove('secret-masked'); el.value = d.api_key; }
    showToast('API Key 已重新生成');
  } else {
    showToast(d.error || '重新生成失败');
  }
}

// ── LLM Tab ─────────────────────────────────────────────────

function _bindRangeSlider(sliderId, valId, isInt = false) {
  const slider = document.getElementById(sliderId);
  const valEl = document.getElementById(valId);
  if (!slider || !valEl) return;
  slider.addEventListener('input', () => {
    valEl.textContent = isInt ? parseInt(slider.value) : parseFloat(slider.value).toFixed(1);
  });
}

async function _loadLlmTab() {
  try {
    // Bind range sliders to value displays
    _bindRangeSlider('llm-temperature', 'llm-temperature-val');
    _bindRangeSlider('llm-max-tokens', 'llm-max-tokens-val', true);

    // Load providers + current config in parallel
    const [provR, cfgR] = await Promise.all([
      apiFetch('/api/llm/providers'),
      apiFetch('/api/llm/config'),
    ]);

    if (provR?.providers) {
      _llmProviders = provR.providers;
      const sel = document.getElementById('llm-provider');
      sel.innerHTML = '<option value="" disabled selected>— 选择服务提供商 —</option>';
      for (const p of _llmProviders) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        sel.appendChild(opt);
      }
    }

    if (cfgR?.ok && cfgR.data) {
      const cfg = cfgR.data;
      // cache per-provider saved keys
      _llmProviderKeys = cfg.provider_keys || {};
      if (cfg.provider) document.getElementById('llm-provider').value = cfg.provider;
      // restore API key from per-provider cache (cfg.api_key is masked)
      const savedProv = _llmProviderKeys[cfg.provider];
      if (savedProv && savedProv.api_key) {
        const inp = document.getElementById('llm-api-key');
        inp.value = savedProv.api_key;
        inp.classList.add('secret-masked');
      }
      if (cfg.base_url) document.getElementById('llm-base-url').value = cfg.base_url;
      if (cfg.temperature != null) {
        document.getElementById('llm-temperature').value = cfg.temperature;
        document.getElementById('llm-temperature-val').textContent = parseFloat(cfg.temperature).toFixed(1);
      }
      if (cfg.max_tokens != null) {
        document.getElementById('llm-max-tokens').value = cfg.max_tokens;
        document.getElementById('llm-max-tokens-val').textContent = parseInt(cfg.max_tokens);
      }
      document.getElementById('llm-stream').checked = !!cfg.stream;
      // show/hide base_url group (without clearing inputs)
      document.getElementById('llm-base-url-group').style.display = cfg.provider === 'custom' ? '' : 'none';
      // set model display
      if (cfg.model) {
        document.getElementById('llm-model').value = cfg.model;
        _setLlmModelDisplay(cfg.model, false);
      }
    }
  } catch (e) {
    console.error('Failed to load LLM tab:', e);
  }
}

function onLlmProviderChange() {
  const provider = document.getElementById('llm-provider').value;
  const baseUrlGroup = document.getElementById('llm-base-url-group');
  // show base_url only for "custom" provider
  baseUrlGroup.style.display = provider === 'custom' ? '' : 'none';
  // restore per-provider saved key/model/base_url
  const saved = _llmProviderKeys[provider];
  const apiKeyInput = document.getElementById('llm-api-key');
  if (saved && saved.api_key) {
    apiKeyInput.value = saved.api_key;
    apiKeyInput.classList.add('secret-masked');
  } else {
    apiKeyInput.value = '';
    apiKeyInput.classList.remove('secret-masked');
  }
  if (saved && saved.base_url) {
    document.getElementById('llm-base-url').value = saved.base_url;
  } else {
    document.getElementById('llm-base-url').value = '';
  }
  // restore model or clear
  _llmAllModels = [];
  document.getElementById('llm-model-options').innerHTML = '';
  if (saved && saved.model) {
    document.getElementById('llm-model').value = saved.model;
    _setLlmModelDisplay(saved.model, false);
  } else {
    document.getElementById('llm-model').value = '';
    _setLlmModelDisplay('刷新获取模型列表', true);
  }
  // clear model info
  document.getElementById('llm-model-info').style.display = 'none';
}

// ── Searchable Model Dropdown ────────────────────────────────────────────

function _renderLlmModelOptions(models, selectedId) {
  const container = document.getElementById('llm-model-options');
  container.innerHTML = '';
  if (models.length === 0) {
    container.innerHTML = '<div class="ss-empty">无匹配模型</div>';
    return;
  }
  for (const m of models) {
    const id = m.id || m;
    const name = m.name || m.id || m;
    const div = document.createElement('div');
    div.className = 'ss-option' + (id === selectedId ? ' selected' : '');
    div.textContent = name;
    div.dataset.value = id;
    if (m.context_length) div.dataset.ctx = m.context_length;
    if (m.pricing) div.dataset.pricing = JSON.stringify(m.pricing);
    div.onclick = () => selectLlmModel(id, name, div);
    container.appendChild(div);
  }
}

function selectLlmModel(id, name, optEl) {
  document.getElementById('llm-model').value = id;
  const textEl = document.getElementById('llm-model-text');
  textEl.textContent = name;
  textEl.classList.remove('placeholder');
  // update selected state
  document.querySelectorAll('#llm-model-options .ss-option').forEach(el => el.classList.remove('selected'));
  if (optEl) optEl.classList.add('selected');
  // close dropdown
  document.getElementById('llm-model-dropdown').classList.remove('open');
  // show model info
  _showLlmModelInfo(optEl);
}

function _showLlmModelInfo(optEl) {
  const infoEl = document.getElementById('llm-model-info');
  if (!optEl?.dataset.ctx && !optEl?.dataset.pricing) {
    infoEl.style.display = 'none';
    return;
  }
  let info = [];
  if (optEl.dataset.ctx) info.push(`上下文: ${Number(optEl.dataset.ctx).toLocaleString()} tokens`);
  if (optEl.dataset.pricing) {
    try {
      const p = JSON.parse(optEl.dataset.pricing);
      if (p.prompt) info.push(`输入: $${p.prompt}/M`);
      if (p.completion) info.push(`输出: $${p.completion}/M`);
    } catch {}
  }
  infoEl.textContent = info.join(' · ');
  infoEl.style.display = '';
}

function toggleLlmModelDropdown() {
  const dd = document.getElementById('llm-model-dropdown');
  const isOpen = dd.classList.toggle('open');
  if (isOpen) {
    const search = document.getElementById('llm-model-search');
    search.value = '';
    filterLlmModels();
    setTimeout(() => search.focus(), 0);
  }
}

// close dropdown on outside click
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('llm-model-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('llm-model-dropdown')?.classList.remove('open');
  }
});

function filterLlmModels() {
  const q = (document.getElementById('llm-model-search')?.value || '').toLowerCase();
  const filtered = q ? _llmAllModels.filter(m => {
    const name = (m.name || m.id || '').toString().toLowerCase();
    const id = (m.id || '').toString().toLowerCase();
    return name.includes(q) || id.includes(q);
  }) : _llmAllModels;
  const curVal = document.getElementById('llm-model').value;
  _renderLlmModelOptions(filtered, curVal);
}

function _setLlmModelDisplay(text, isPlaceholder) {
  const textEl = document.getElementById('llm-model-text');
  textEl.textContent = text;
  textEl.classList.toggle('placeholder', !!isPlaceholder);
}

async function fetchLlmModels() {
  const provider = document.getElementById('llm-provider').value;
  const apiKey = document.getElementById('llm-api-key').value.trim();
  const baseUrl = document.getElementById('llm-base-url').value.trim();

  if (!provider) return showToast('请先选择服务提供商');
  if (!apiKey) return showToast('请先输入 API Key');

  _setLlmModelDisplay('获取中...', true);
  document.getElementById('llm-model').value = '';
  _llmAllModels = [];

  try {
    const d = await apiFetch('/api/llm/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, api_key: apiKey, base_url: baseUrl })
    });

    if (!d?.ok) {
      _setLlmModelDisplay('获取失败', true);
      showToast(d?.error || '获取模型列表失败');
      return;
    }

    const models = d.models || [];
    models.sort((a, b) => {
      const na = (a.name || a.id || a).toString().toLowerCase();
      const nb = (b.name || b.id || b).toString().toLowerCase();
      return na.localeCompare(nb);
    });
    _llmAllModels = models;

    _renderLlmModelOptions(models);
    if (models.length > 0) {
      _setLlmModelDisplay('点击选择模型', true);
    } else {
      _setLlmModelDisplay('无可用模型', true);
    }
    showToast(`获取到 ${models.length} 个模型`);
  } catch (e) {
    _setLlmModelDisplay('获取失败', true);
    showToast('获取模型列表失败: ' + e.message);
  }
}

async function saveLlmConfig() {
  const provider = document.getElementById('llm-provider').value;
  const apiKey = document.getElementById('llm-api-key').value.trim();
  const baseUrl = document.getElementById('llm-base-url').value.trim();
  const model = document.getElementById('llm-model').value;
  const temperature = parseFloat(document.getElementById('llm-temperature').value);
  const maxTokens = parseInt(document.getElementById('llm-max-tokens').value);
  const stream = document.getElementById('llm-stream').checked;

  if (!provider) return showToast('请选择服务提供商');
  if (!apiKey) return showToast('请输入 API Key');

  const data = { provider, api_key: apiKey, model, temperature, max_tokens: maxTokens, stream };
  if (baseUrl) data.base_url = baseUrl;

  const d = await apiFetch('/api/llm/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!d) return;
  if (d.ok) {
    // update local per-provider cache
    _llmProviderKeys[provider] = { api_key: apiKey, model, base_url: baseUrl };
    showToast('LLM 配置已保存');
  } else {
    showToast(d.error || '保存失败');
  }
}

async function testLlmConnection() {
  const provider = document.getElementById('llm-provider').value;
  const apiKey = document.getElementById('llm-api-key').value.trim();
  const model = document.getElementById('llm-model').value;
  const baseUrl = document.getElementById('llm-base-url').value.trim();

  if (!provider) return showToast('请先选择服务提供商');
  if (!apiKey) return showToast('请先输入 API Key');
  if (!model) return showToast('请先选择模型');

  const resultEl = document.getElementById('llm-test-result');
  resultEl.style.display = '';
  resultEl.innerHTML = '<span style="color:var(--t2)">测试中...</span>';

  try {
    const d = await apiFetch('/api/llm/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, api_key: apiKey, model, base_url: baseUrl })
    });
    if (d?.ok) {
      resultEl.innerHTML = `<span style="color:var(--green)">✓ 连接成功</span><span style="color:var(--t3);margin-left:8px;font-size:.78rem">${d.latency_ms ? d.latency_ms + 'ms' : ''}${d.response ? ' — ' + d.response : ''}</span>`;
    } else {
      resultEl.innerHTML = `<span style="color:var(--red)">✗ 连接失败: ${d?.error || '未知错误'}</span>`;
    }
  } catch (e) {
    resultEl.innerHTML = `<span style="color:var(--red)">✗ 请求失败: ${e.message}</span>`;
  }
}

// ── Window exports ──────────────────────────────────────────

Object.assign(window, {
  switchSettingsTab,
  changePassword, saveSettingsCivitaiKey, clearSettingsCivitaiKey,
  restartDashboard, reinitialize,
  exportConfig, importConfig,
  regenerateApiKey,
  onLlmProviderChange, fetchLlmModels, filterLlmModels, toggleLlmModelDropdown, selectLlmModel, saveLlmConfig, testLlmConnection,
});
