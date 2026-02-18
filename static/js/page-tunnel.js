/**
 * ComfyCarry — page-tunnel.js
 * Tunnel 页面: Cloudflare Tunnel 状态、转发服务、日志
 */

import { registerPage, showToast, escHtml } from './core.js';

let _autoRefresh = null;

registerPage('tunnel', {
  enter() { loadTunnelPage(); _startAutoRefresh(); },
  leave() { _stopAutoRefresh(); }
});

async function loadTunnelPage() {
  const statusEl = document.getElementById('tunnel-status-info');
  const logEl = document.getElementById('tunnel-log-content');
  try {
    const r = await fetch('/api/tunnel_status');
    const d = await r.json();

    const st = d.status || 'unknown';
    const stColor = st === 'online' ? 'var(--green)' : st === 'stopped' ? 'var(--red, #e74c3c)' : 'var(--t3)';
    const stLabel = { online: '运行中', stopped: '已停止', errored: '错误', launching: '启动中' }[st] || st;

    const links = d.links || [];
    let linksHtml = '';
    if (links.length > 0) {
      linksHtml = '<div class="tunnel-services">' + links.map(l => {
        const proto = (l.service || '').split('://')[0] || 'http';
        const portInfo = l.port ? `:${l.port}` : '';
        return `<a href="${l.url}" target="_blank" class="tunnel-svc-card">
          <span class="tunnel-svc-icon">${l.icon || '🔗'}</span>
          <span class="tunnel-svc-name">${l.name}</span>
          <span class="tunnel-svc-detail">${l.url}</span>
          <span class="tunnel-svc-port">${proto}${portInfo}</span>
        </a>`;
      }).join('') + '</div>';
    } else {
      linksHtml = '<div style="color:var(--t3);font-size:.85rem;padding:8px 0">未检测到转发服务</div>';
    }

    statusEl.innerHTML = `
      <div class="tunnel-header-row">
        <div class="tunnel-status-badge" style="color:${stColor}">
          <span class="tunnel-dot" style="background:${stColor}"></span> ${stLabel}
        </div>
        <button class="btn btn-sm" onclick="window._restartTunnel()" style="font-size:.75rem;padding:3px 10px;margin-left:12px">♻️ 重启</button>
      </div>
      <div class="section-title" style="margin-top:16px">🔗 转发服务</div>
      ${linksHtml}`;

    if (d.logs) {
      const lines = d.logs.split('\n').filter(l => l.trim());
      logEl.innerHTML = lines.map(l => {
        let cls = '';
        if (/error|ERR/i.test(l)) cls = 'log-error';
        else if (/warn/i.test(l)) cls = 'log-warn';
        else if (/connection|register|route|ingress/i.test(l)) cls = 'log-info';
        return `<div class="${cls}">${escHtml(l)}</div>`;
      }).join('');
      logEl.scrollTop = logEl.scrollHeight;
    } else {
      logEl.innerHTML = '<div style="color:var(--t3)">暂无日志</div>';
    }
  } catch (e) {
    statusEl.innerHTML = `<div style="color:var(--red,#e74c3c)">加载失败: ${escHtml(e.message)}</div>`;
    logEl.innerHTML = '';
  }
}

window._restartTunnel = async function() {
  if (!confirm('确定要重启 Cloudflare Tunnel 吗？')) return;
  try {
    await fetch('/api/services/tunnel/restart', { method: 'POST' });
    showToast('Tunnel 正在重启...');
    setTimeout(loadTunnelPage, 3000);
  } catch (e) { showToast('重启失败: ' + e.message); }
};

function _startAutoRefresh() {
  _stopAutoRefresh();
  _autoRefresh = setInterval(loadTunnelPage, 10000);
}
function _stopAutoRefresh() {
  if (_autoRefresh) { clearInterval(_autoRefresh); _autoRefresh = null; }
}
