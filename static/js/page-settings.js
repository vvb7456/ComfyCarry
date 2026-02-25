/**
 * ComfyCarry — page-settings.js
 * 设置页: 密码管理、CivitAI Key、Debug 模式、Import/Export、重新初始化
 */

import { registerPage, registerEscapeHandler, showToast, loadApiKey } from './core.js';
import { createLogStream } from './sse-log.js';

let _debugLogStream = null;

registerPage('settings', {
  enter() { loadSettingsPage(); },
  leave() { _stopDebugLogStream(); }
});

registerEscapeHandler(() => { closeIEModal(); });

async function loadSettingsPage() {
  try {
    const settingsR = await fetch('/api/settings');
    const settings = await settingsR.json();

    const civStatus = document.getElementById('settings-civitai-status');
    if (civStatus) {
      civStatus.textContent = settings.civitai_key_set ? `已配置: ${settings.civitai_key}` : '未设置 API Key';
    }

    // API Key
    const apiKeyInput = document.getElementById('settings-api-key');
    if (apiKeyInput && settings.api_key) {
      apiKeyInput.dataset.key = settings.api_key;
      apiKeyInput.value = '••••••••••••••••••••••••';
      apiKeyInput.type = 'password';
    }

    const debugToggle = document.getElementById('settings-debug-toggle');
    if (debugToggle) debugToggle.checked = settings.debug;

    const logCard = document.getElementById('settings-log-card');
    if (logCard) {
      logCard.style.display = settings.debug ? 'block' : 'none';
      if (settings.debug) _startDebugLogStream();
      else _stopDebugLogStream();
    }
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
  try {
    const r = await fetch('/api/settings/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current, new: newPw })
    });
    const d = await r.json();
    if (!r.ok) return showToast(d.error || '修改失败');
    showToast('✅ ' + d.message);
    document.getElementById('settings-pw-current').value = '';
    document.getElementById('settings-pw-new').value = '';
    document.getElementById('settings-pw-confirm').value = '';
  } catch (e) { showToast('修改失败: ' + e.message); }
}

async function saveSettingsCivitaiKey() {
  const key = document.getElementById('settings-civitai-key').value.trim();
  if (!key) return showToast('请输入 API Key');
  try {
    const r = await fetch('/api/settings/civitai-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key })
    });
    const d = await r.json();
    showToast(d.ok ? '✅ API Key 已保存' : (d.error || '保存失败'));
    document.getElementById('settings-civitai-key').value = '';
    loadSettingsPage();
    loadApiKey();
  } catch (e) { showToast('保存失败: ' + e.message); }
}

async function clearSettingsCivitaiKey() {
  try {
    await fetch('/api/settings/civitai-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: '' })
    });
    showToast('✅ API Key 已清除');
    loadSettingsPage();
    loadApiKey();
  } catch (e) { showToast('清除失败: ' + e.message); }
}

async function toggleDebugMode() {
  const enabled = document.getElementById('settings-debug-toggle')?.checked || false;
  try {
    await fetch('/api/settings/debug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    const logCard = document.getElementById('settings-log-card');
    if (logCard) {
      logCard.style.display = enabled ? 'block' : 'none';
      if (enabled) loadSettingsLogs();
    }
    showToast(enabled ? '✅ Debug 模式已开启' : 'Debug 模式已关闭');
  } catch (e) { showToast('操作失败: ' + e.message); }
}

async function restartDashboard() {
  if (!confirm('确定要重启 ComfyCarry 吗? 页面将短暂不可用')) return;
  try {
    await fetch('/api/settings/restart', { method: 'POST' });
    showToast('🔄 ComfyCarry 正在重启, 3 秒后自动刷新...');
    setTimeout(() => location.reload(), 3000);
  } catch (e) { showToast('重启失败: ' + e.message); }
}

async function reinitialize() {
  const keepModels = document.getElementById('reinit-keep-models')?.checked ?? true;
  const msg = keepModels
    ? '确定要重新初始化吗?\n\n将删除 ComfyUI 安装 (保留模型文件)，停止 ComfyUI 和同步服务，重新进入部署向导。\n\n系统依赖、PyTorch、Tunnel 不受影响。'
    : '确定要重新初始化吗?\n\n将删除整个 ComfyUI 目录 (包括所有模型文件)，停止 ComfyUI 和同步服务，重新进入部署向导。\n\n⚠️ 模型文件将被永久删除！';
  if (!confirm(msg)) return;
  if (!keepModels && !confirm('再次确认: 所有模型文件将被永久删除，无法恢复。继续？')) return;
  try {
    showToast('⏳ 正在重新初始化...');
    const r = await fetch('/api/settings/reinitialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keep_models: keepModels })
    });
    const d = await r.json();
    if (d.ok) {
      showToast('✅ 已重置, 正在跳转到部署向导...');
      setTimeout(() => location.reload(), 1500);
    } else {
      showToast('❌ 部分操作失败: ' + (d.errors || []).join('; '));
    }
  } catch (e) { showToast('重新初始化失败: ' + e.message); }
}

// ── Import / Export ─────────────────────────────────────────

function openIEModal() { document.getElementById('ie-modal')?.classList.add('active'); }
function closeIEModal() { document.getElementById('ie-modal')?.classList.remove('active'); }

async function exportConfig() {
  try {
    const r = await fetch('/api/settings/export-config');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comfyui-config-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('✅ 配置已导出');
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
      showToast('❌ 无效的配置文件格式');
      return;
    }
    if (!confirm(`确定要导入配置吗?\n\n导出于: ${config._exported_at || '未知'}\n将覆盖当前的密码、API Key、Tunnel 配置、同步规则等设置。`)) return;
    const r = await fetch('/api/settings/import-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: text
    });
    const d = await r.json();
    showToast(d.ok ? '✅ ' + d.message : '⚠️ ' + d.message);
    closeIEModal();
    if (document.getElementById('page-settings')?.classList.contains('hidden') === false) loadSettingsPage();
  } catch (e) { showToast('导入失败: ' + e.message); }
}

// ── API Key 管理 ────────────────────────────────────────────

function toggleApiKeyVisibility() {
  const el = document.getElementById('settings-api-key');
  if (!el) return;
  if (el.type === 'password') {
    el.type = 'text';
    el.value = el.dataset.key || '';
  } else {
    el.type = 'password';
    el.value = '••••••••••••••••••••••••';
  }
}

async function copyApiKey() {
  const el = document.getElementById('settings-api-key');
  if (!el?.dataset.key) return;
  try {
    await navigator.clipboard.writeText(el.dataset.key);
    showToast('✅ API Key 已复制');
  } catch { showToast('复制失败'); }
}

async function regenerateApiKey() {
  if (!confirm('确定要重新生成 API Key 吗？\n\n旧的 Key 将立即失效，所有使用旧 Key 的外部应用需要更新。')) return;
  try {
    const r = await fetch('/api/settings/api-key', { method: 'POST' });
    const d = await r.json();
    if (d.ok) {
      const el = document.getElementById('settings-api-key');
      if (el) { el.dataset.key = d.api_key; el.type = 'text'; el.value = d.api_key; }
      showToast('✅ API Key 已重新生成');
    } else {
      showToast('⚠️ ' + (d.error || '重新生成失败'));
    }
  } catch (e) { showToast('请求失败: ' + e.message); }
}

// ── Window exports ──────────────────────────────────────────

Object.assign(window, {
  changePassword, saveSettingsCivitaiKey, clearSettingsCivitaiKey,
  toggleDebugMode, restartDashboard, reinitialize,
  openIEModal, closeIEModal, exportConfig, importConfig,
  toggleApiKeyVisibility, copyApiKey, regenerateApiKey
});
