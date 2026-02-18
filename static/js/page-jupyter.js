/**
 * ComfyCarry — page-jupyter.js
 * JupyterLab 页面: 状态监控、会话管理、内核管理、日志、Token
 */

import { registerPage, fmtBytes, showToast, escHtml, copyText } from './core.js';

let _autoRefresh = null;
let _jupyterUrl = '';
let _tokenVisible = false;
let _cachedToken = '';

// ── 页面生命周期 ─────────────────────────────────────────────

registerPage('jupyter', {
  enter() { loadJupyterPage(); _startAutoRefresh(); },
  leave() { _stopAutoRefresh(); }
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

// ── 获取外部 URL ────────────────────────────────────────────

async function loadJupyterUrl() {
  try {
    const r = await fetch('/api/jupyter/url');
    const d = await r.json();
    _jupyterUrl = d.url || '';
  } catch (_) {}
}

// ── 状态 ────────────────────────────────────────────────────

async function loadJupyterStatus() {
  const el = document.getElementById('jupyter-status-content');
  try {
    const r = await fetch('/api/jupyter/status');
    const d = await r.json();

    let html = '';

    // Status header
    const stColor = d.online ? 'var(--green)' : 'var(--red, #e74c3c)';
    const stLabel = d.online ? '运行中' : '未运行';
    html += `<div class="jupyter-status-header">
      <div class="jupyter-status-badge" style="color:${stColor}">
        <span class="jupyter-dot" style="background:${stColor}"></span> ${stLabel}
      </div>
      ${d.version ? `<span style="font-size:.82rem;color:var(--t3)">JupyterLab v${escHtml(d.version)}</span>` : ''}
      <div style="margin-left:auto;display:flex;gap:6px">
        ${_jupyterUrl ? `<a href="${_jupyterUrl}" target="_blank" class="btn btn-sm btn-primary">🔗 打开 JupyterLab</a>` : ''}
        <button class="btn btn-sm" onclick="loadJupyterStatus()" title="刷新">🔄 刷新</button>
        <button class="btn btn-sm" onclick="window._restartJupyter()">♻️ 重启</button>
      </div>
    </div>`;

    if (!d.online) {
      html += '<div style="color:var(--t3);padding:16px 0">Jupyter 服务未运行或无法连接</div>';
      el.innerHTML = html;
      renderKernelsList([]);
      renderSessionsList([]);
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
  } catch (e) {
    el.innerHTML = `<div style="color:var(--red,#e74c3c)">加载失败: ${escHtml(e.message)}</div>`;
  }
}

// ── Kernels ─────────────────────────────────────────────────

function renderKernelsList(kernels) {
  const el = document.getElementById('jupyter-kernels-list');
  if (!el) return;

  if (kernels.length === 0) {
    el.innerHTML = '<div class="jupyter-empty">无活跃内核</div>';
    return;
  }

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

  if (sessions.length === 0) {
    el.innerHTML = '<div class="jupyter-empty">无活跃会话</div>';
    return;
  }

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

// ── 日志 ────────────────────────────────────────────────────

async function loadJupyterLogs() {
  const el = document.getElementById('jupyter-log-content');
  if (!el) return;
  try {
    const r = await fetch('/api/jupyter/logs?lines=200');
    const d = await r.json();
    if (d.logs && d.logs.trim()) {
      const lines = d.logs.split('\n').filter(l => l.trim());
      el.innerHTML = lines.map(l => {
        let cls = '';
        if (/error|exception|traceback/i.test(l)) cls = 'log-error';
        else if (/warn/i.test(l)) cls = 'log-warn';
        else if (/kernel|session/i.test(l)) cls = 'log-info';
        return `<div class="${cls}">${escHtml(l)}</div>`;
      }).join('');
      el.scrollTop = el.scrollHeight;
    } else {
      el.innerHTML = '<div style="color:var(--t3)">日志为空 — Jupyter 的 stderr 输出未被重定向到日志文件</div>';
    }
  } catch (e) {
    el.innerHTML = `<div style="color:var(--red,#e74c3c)">加载失败: ${escHtml(e.message)}</div>`;
  }
}

// ── Token 显示/隐藏 ─────────────────────────────────────────

window._toggleJupyterToken = async function() {
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
};

window._copyJupyterToken = async function() {
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
};

// ── Window exports ──────────────────────────────────────────

window._restartJupyter = async function() {
  if (!confirm('确定要重启 Jupyter 吗？活跃的内核/会话将丢失。')) return;
  try {
    const r = await fetch('/api/jupyter/restart', { method: 'POST' });
    const d = await r.json();
    if (d.ok) {
      showToast('♻️ Jupyter 正在重启...');
      setTimeout(loadJupyterStatus, 5000);
    } else {
      showToast('重启失败: ' + (d.error || ''));
    }
  } catch (e) { showToast('重启失败: ' + e.message); }
};

window._kernelAction = async function(kernelId, action) {
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
};

window._closeSession = async function(sessionId) {
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
};

window.loadJupyterLogs = loadJupyterLogs;
window.loadJupyterStatus = loadJupyterStatus;
