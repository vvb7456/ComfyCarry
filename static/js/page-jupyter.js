/**
 * ComfyCarry — page-jupyter.js
 * JupyterLab 页面: 状态监控、会话管理、内核管理、日志、Token
 */

import { registerPage, fmtBytes, showToast, escHtml, copyText, renderEmpty, renderError } from './core.js';
import { createLogStream } from './sse-log.js';

let _autoRefresh = null;
let _jupyterUrl = '';
let _tokenVisible = false;
let _cachedToken = '';
let _jupyterLogStream = null;

// ── 页面生命周期 ─────────────────────────────────────────────

registerPage('jupyter', {
  enter() { loadJupyterPage(); _startAutoRefresh(); _startJupyterLogStream(); },
  leave() { _stopAutoRefresh(); _stopJupyterLogStream(); }
});

function _startAutoRefresh() {
  _stopAutoRefresh();
  _autoRefresh = setInterval(loadJupyterStatus, 8000);
}
function _stopAutoRefresh() {
  if (_autoRefresh) { clearInterval(_autoRefresh); _autoRefresh = null; }
}

// ── 主加载 ──────────────────────────────────────────────────

async function loadJupyterPage() {
  await Promise.all([loadJupyterStatus(), loadJupyterUrl()]);
}

// ── 获取外部 URL (从 Tunnel 状态) ────────────────────────────

async function loadJupyterUrl() {
  try {
    const r = await fetch('/api/tunnel/status');
    const d = await r.json();
    const urls = d.urls || {};
    for (const [name, url] of Object.entries(urls)) {
      if (name.toLowerCase().includes('jupyter')) {
        _jupyterUrl = url;
        return;
      }
    }
  } catch (_) {}
  _jupyterUrl = '';
}

// ── 状态 ────────────────────────────────────────────────────

async function loadJupyterStatus() {
  const el = document.getElementById('jupyter-status-content');
  try {
    const r = await fetch('/api/jupyter/status');
    const d = await r.json();

    let html = '';

    // PM2 status label
    const pm2St = d.pm2_status || 'unknown';
    const pm2Color = pm2St === 'online' ? 'var(--green)' :
                     pm2St === 'stopped' ? 'var(--amber)' :
                     pm2St === 'errored' ? 'var(--red)' : 'var(--t3)';
    const pm2Label = pm2St === 'online' ? '运行中' :
                     pm2St === 'stopped' ? '已停止' :
                     pm2St === 'errored' ? '出错' :
                     pm2St === 'not_found' ? '未创建' : pm2St;

    // Status header → page header badge + controls
    const stColor = d.online ? 'var(--green)' : pm2Color;
    const stLabel = d.online ? '运行中' : pm2Label;

    const badge = document.getElementById('jupyter-header-badge');
    if (badge) {
      badge.innerHTML = `<span class="page-status-dot" style="background:${stColor}"></span> <span style="color:${stColor}">${stLabel}</span>`;
    }
    const controls = document.getElementById('jupyter-header-controls');
    if (controls) {
      controls.innerHTML = d.online || pm2St === 'online'
        ? `<button class="btn" onclick="window._stopJupyter()">⏹ 停止</button><button class="btn" onclick="window._restartJupyter()">♻️ 重启</button>`
        : `<button class="btn" onclick="window._startJupyter()">▶ 启动</button>`;
    }

    // Version info in body (no status header)
    if (d.version) {
      html += `<div style="font-size:.82rem;color:var(--t3);padding:4px 0">JupyterLab v${escHtml(d.version)}</div>`;
    }

    if (!d.online) {
      const hint = pm2St === 'not_found' ? '点击「启动」创建 JupyterLab 进程' :
                   pm2St === 'stopped' ? '进程已停止，点击「启动」恢复' :
                   pm2St === 'errored' ? '进程出错，请查看日志' :
                   'Jupyter 服务未运行或无法连接';
      html += `<div style="color:var(--t3);padding:16px 0">${hint}</div>`;
      el.innerHTML = html;
      renderKernelsList([]);
      renderSessionsList([]);
      renderTerminalsList([]);
      return;
    }

    // Process info
    html += '<div class="jupyter-info-grid">';
    if (d.pid) {
      html += `<div class="jupyter-info-item"><span class="jupyter-info-label">PID</span><span>${d.pid}</span></div>`;
    }
    html += `<div class="jupyter-info-item"><span class="jupyter-info-label">端口</span><span>${d.port}</span></div>`;
    if (d.cpu !== undefined) {
      html += `<div class="jupyter-info-item"><span class="jupyter-info-label">CPU</span><span>${d.cpu.toFixed(1)}%</span></div>`;
    }
    if (d.memory) {
      html += `<div class="jupyter-info-item"><span class="jupyter-info-label">内存</span><span>${fmtBytes(d.memory)}</span></div>`;
    }
    html += `<div class="jupyter-info-item"><span class="jupyter-info-label">内核</span><span>${d.kernels_count}</span></div>`;
    html += `<div class="jupyter-info-item"><span class="jupyter-info-label">会话</span><span>${d.sessions_count}</span></div>`;
    html += '</div>';

    // Kernel specs
    if (d.kernelspecs && d.kernelspecs.length > 0) {
      html += '<div class="jupyter-kernelspecs">';
      html += '<span style="font-size:.78rem;color:var(--t3);margin-right:8px">可用内核:</span>';
      d.kernelspecs.forEach(ks => {
        const isDefault = ks.name === d.default_kernel;
        html += `<span class="jupyter-ks-badge${isDefault ? ' default' : ''}">${escHtml(ks.display_name)}${isDefault ? ' ✓' : ''}</span>`;
      });
      html += '</div>';
    }

    el.innerHTML = html;

    // Render sub-sections
    renderKernelsList(d.kernels || []);
    renderSessionsList(d.sessions || []);
    renderTerminalsList(d.terminals || []);
  } catch (e) {
    el.innerHTML = renderError('加载失败: ' + e.message);
  }
}

// ── Kernels ─────────────────────────────────────────────────

function renderKernelsList(kernels) {
  const el = document.getElementById('jupyter-kernels-list');
  if (!el) return;
  const wrapper = document.getElementById('jupyter-section-kernels');

  if (kernels.length === 0) {
    el.innerHTML = '';
    if (wrapper) wrapper.style.display = 'none';
    return;
  }

  if (wrapper) wrapper.style.display = '';

  el.innerHTML = kernels.map(k => {
    const stateColor = k.state === 'idle' ? 'var(--green)' :
                       k.state === 'busy' ? 'var(--amber)' : 'var(--t3)';
    const stateLabel = k.state === 'idle' ? '空闲' :
                       k.state === 'busy' ? '忙碌' : k.state;
    return `<div class="jupyter-kernel-item">
      <div class="jupyter-kernel-info">
        <span class="jupyter-kernel-dot" style="background:${stateColor}"></span>
        <span class="jupyter-kernel-name">${escHtml(k.name)}</span>
        <span class="jupyter-kernel-state" style="color:${stateColor}">${stateLabel}</span>
        ${k.connections > 0 ? `<span style="font-size:.75rem;color:var(--t3)">${k.connections} 连接</span>` : ''}
      </div>
      <div class="jupyter-kernel-actions">
        <button class="btn btn-sm" onclick="window._kernelAction('${k.id}','interrupt')" title="中断">⏸</button>
        <button class="btn btn-sm" onclick="window._kernelAction('${k.id}','restart')" title="重启">♻️</button>
      </div>
    </div>`;
  }).join('');
}

// ── Sessions ────────────────────────────────────────────────

function renderSessionsList(sessions) {
  const el = document.getElementById('jupyter-sessions-list');
  if (!el) return;
  const wrapper = document.getElementById('jupyter-section-sessions');

  if (sessions.length === 0) {
    el.innerHTML = '';
    if (wrapper) wrapper.style.display = 'none';
    return;
  }

  if (wrapper) wrapper.style.display = '';

  el.innerHTML = sessions.map(s => {
    const icon = s.type === 'notebook' ? '📓' : s.type === 'console' ? '💻' : '📄';
    const kernelState = s.kernel_state === 'idle' ? '空闲' :
                        s.kernel_state === 'busy' ? '忙碌' : (s.kernel_state || '-');
    const stateColor = s.kernel_state === 'idle' ? 'var(--green)' :
                       s.kernel_state === 'busy' ? 'var(--amber)' : 'var(--t3)';
    return `<div class="jupyter-session-item">
      <span class="jupyter-session-icon">${icon}</span>
      <div class="jupyter-session-info">
        <span class="jupyter-session-name">${escHtml(s.name || s.path)}</span>
        <span class="jupyter-session-meta">
          ${escHtml(s.path)} · ${escHtml(s.kernel_name || '')}
          <span style="color:${stateColor}">(${kernelState})</span>
        </span>
      </div>
      <div class="jupyter-session-actions">
        <button class="btn btn-sm btn-danger" onclick="window._closeSession('${s.id}')" title="关闭会话">✕</button>
      </div>
    </div>`;
  }).join('');
}

// ── Terminals ───────────────────────────────────────────────

function renderTerminalsList(terminals) {
  const el = document.getElementById('jupyter-terminals-list');
  if (!el) return;
  const wrapper = document.getElementById('jupyter-section-terminals');

  if (terminals.length === 0) {
    el.innerHTML = '';
    if (wrapper) wrapper.style.display = 'none';
    return;
  }

  if (wrapper) wrapper.style.display = '';

  el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px">${terminals.map(t => {
    // 构建跳转 URL
    let openBtn = '';
    if (_jupyterUrl) {
      const base = _jupyterUrl.split('?')[0];
      const tokenPart = _jupyterUrl.includes('?') ? _jupyterUrl.substring(_jupyterUrl.indexOf('?')) : '';
      const termUrl = `${base}/terminals/${encodeURIComponent(t.name)}${tokenPart}`;
      openBtn = `<a href="${termUrl}" target="_blank" class="btn btn-xs btn-primary" title="在 JupyterLab 中打开">🔗</a>`;
    }

    return `<div class="jupyter-terminal-item" style="display:inline-flex">
      <span style="font-size:1rem">💻</span>
      <span style="font-weight:600;font-size:.85rem">终端 ${escHtml(t.name)}</span>
      ${openBtn}
      <button class="btn btn-xs btn-danger" onclick="window._deleteJupyterTerminal('${escHtml(t.name)}')" title="销毁终端">✕</button>
    </div>`;
  }).join('')}</div>`;
}

async function _newJupyterTerminal() {
  try {
    const r = await fetch('/api/jupyter/terminals/new', { method: 'POST' });
    const d = await r.json();
    if (r.ok) {
      showToast(`✅ 终端 ${d.name || ''} 已创建`);
      loadJupyterStatus();
    } else {
      showToast(d.error || '创建失败');
    }
  } catch (e) { showToast('创建失败: ' + e.message); }
}

async function _deleteJupyterTerminal(name) {
  if (!confirm(`确定销毁终端 ${name}？`)) return;
  try {
    const r = await fetch(`/api/jupyter/terminals/${encodeURIComponent(name)}`, { method: 'DELETE' });
    const d = await r.json();
    if (r.ok) {
      showToast(`✅ 终端 ${name} 已销毁`);
      loadJupyterStatus();
    } else {
      showToast(d.error || '销毁失败');
    }
  } catch (e) { showToast('销毁失败: ' + e.message); }
}

// ── SSE: 实时日志流 ──────────────────────────────────────────

function _startJupyterLogStream() {
  const page = document.getElementById('page-jupyter');
  if (!page || page.classList.contains('hidden')) return;
  _stopJupyterLogStream();
  const el = document.getElementById('jupyter-log-content');
  if (!el) return;

  _jupyterLogStream = createLogStream({
    el,
    historyUrl: '/api/jupyter/logs?lines=200',
    streamUrl: '/api/jupyter/logs/stream',
    classify: line => {
      if (/error|exception|traceback/i.test(line)) return 'log-error';
      if (/warn/i.test(line)) return 'log-warn';
      if (/kernel|session/i.test(line)) return 'log-info';
      return '';
    },
  });
  _jupyterLogStream.start();
}

function _stopJupyterLogStream() {
  if (_jupyterLogStream) { _jupyterLogStream.stop(); _jupyterLogStream = null; }
}

// ── Token 显示/隐藏 ─────────────────────────────────────────

async function _toggleJupyterToken() {
  const valEl = document.getElementById('jupyter-token-value');
  const btnEl = document.getElementById('jupyter-token-toggle');
  if (!valEl) return;

  if (_tokenVisible) {
    valEl.textContent = '••••••••••••••••';
    btnEl.textContent = '👁 显示';
    _tokenVisible = false;
  } else {
    if (!_cachedToken) {
      try {
        const r = await fetch('/api/jupyter/token');
        const d = await r.json();
        _cachedToken = d.token || '(未找到)';
      } catch (_) {
        _cachedToken = '(获取失败)';
      }
    }
    valEl.textContent = _cachedToken;
    btnEl.textContent = '🙈 隐藏';
    _tokenVisible = true;
  }
}

async function _copyJupyterToken() {
  if (!_cachedToken) {
    try {
      const r = await fetch('/api/jupyter/token');
      const d = await r.json();
      _cachedToken = d.token || '';
    } catch (_) {}
  }
  if (_cachedToken) {
    copyText(_cachedToken);
    showToast('📋 Token 已复制');
  } else {
    showToast('未找到 Token');
  }
}

// ── 操作函数 ────────────────────────────────────────────────

async function _startJupyter() {
  try {
    const r = await fetch('/api/jupyter/start', { method: 'POST' });
    const d = await r.json();
    if (d.ok) {
      showToast('▶ ' + (d.message || 'JupyterLab 启动中...'));
      _cachedToken = '';
      setTimeout(loadJupyterPage, 3000);
    } else {
      showToast('启动失败: ' + (d.error || ''));
    }
  } catch (e) { showToast('启动失败: ' + e.message); }
}

async function _stopJupyter() {
  if (!confirm('确定停止 JupyterLab？活跃的内核/会话将丢失。')) return;
  try {
    const r = await fetch('/api/jupyter/stop', { method: 'POST' });
    const d = await r.json();
    if (d.ok) {
      showToast('⏹ JupyterLab 已停止');
      _cachedToken = '';
      setTimeout(loadJupyterStatus, 1000);
    } else {
      showToast('停止失败: ' + (d.error || ''));
    }
  } catch (e) { showToast('停止失败: ' + e.message); }
}

async function _restartJupyter() {
  if (!confirm('确定要重启 Jupyter 吗？活跃的内核/会话将丢失。')) return;
  try {
    const r = await fetch('/api/jupyter/restart', { method: 'POST' });
    const d = await r.json();
    if (d.ok) {
      showToast('♻️ Jupyter 正在重启...');
      _cachedToken = '';
      setTimeout(loadJupyterPage, 5000);
    } else {
      showToast('重启失败: ' + (d.error || ''));
    }
  } catch (e) { showToast('重启失败: ' + e.message); }
}

async function _kernelAction(kernelId, action) {
  try {
    const r = await fetch(`/api/jupyter/kernels/${kernelId}/${action}`, { method: 'POST' });
    const d = await r.json();
    if (d.ok) {
      showToast(`✅ 内核已${action === 'restart' ? '重启' : '中断'}`);
      setTimeout(loadJupyterStatus, 1000);
    } else {
      showToast('操作失败: ' + (d.error || ''));
    }
  } catch (e) { showToast('操作失败: ' + e.message); }
}

async function _closeSession(sessionId) {
  if (!confirm('关闭此会话？关联的内核也将被停止。')) return;
  try {
    const r = await fetch(`/api/jupyter/sessions/${sessionId}`, { method: 'DELETE' });
    const d = await r.json();
    if (d.ok) {
      showToast('✅ 会话已关闭');
      setTimeout(loadJupyterStatus, 1000);
    } else {
      showToast('操作失败: ' + (d.error || ''));
    }
  } catch (e) { showToast('操作失败: ' + e.message); }
}

// ── Window exports (供 HTML onclick 调用) ─────────────────────

Object.assign(window, {
  loadJupyterStatus,
  _newJupyterTerminal, _deleteJupyterTerminal,
  _toggleJupyterToken, _copyJupyterToken,
  _startJupyter, _stopJupyter, _restartJupyter,
  _kernelAction, _closeSession,
});
