/**
 * ComfyCarry — page-tunnel.js (v2)
 * Tunnel 页面: CF API 驱动的配置/状态管理
 */

import { registerPage, showToast, escHtml } from './core.js';

let _autoRefresh = null;

registerPage('tunnel', {
  enter() { loadTunnelPage(); _startAutoRefresh(); },
  leave() { _stopAutoRefresh(); }
});

async function loadTunnelPage() {
  const statusSection = document.getElementById('tunnel-status-section');
  const setupSection = document.getElementById('tunnel-setup-section');
  const statusEl = document.getElementById('tunnel-status-info');
  const servicesEl = document.getElementById('tunnel-services');
  const logEl = document.getElementById('tunnel-log-content');

  try {
    const r = await fetch('/api/tunnel/status');
    const d = await r.json();

    if (d.configured) {
      // ── 已配置视图 ──
      statusSection.style.display = '';
      // 只有当 setup section 不是用户手动展开时才隐藏
      if (!setupSection.dataset.manualOpen) {
        setupSection.style.display = 'none';
      }

      const tunnel = d.tunnel || {};
      const st = tunnel.status || d.cloudflared || 'unknown';
      const stColor = st === 'healthy' || st === 'online' ? 'var(--green)'
                     : st === 'degraded' ? 'var(--amber)'
                     : st === 'down' || st === 'stopped' ? 'var(--red, #e74c3c)'
                     : 'var(--t3)';
      const stLabel = {
        healthy: '运行中', online: '运行中', degraded: '部分连接',
        down: '离线', stopped: '已停止', inactive: '未活跃'
      }[st] || st;

      const conns = tunnel.connections || [];
      const connInfo = conns.length > 0
        ? conns.map(c => c.colo_name || '?').join(', ')
        : '无连接';

      statusEl.innerHTML = `
        <div class="tunnel-header-row">
          <div class="tunnel-status-badge" style="color:${stColor}">
            <span class="tunnel-dot" style="background:${stColor}"></span> ${stLabel}
          </div>
          <span style="font-size:.78rem;color:var(--t3);margin-left:12px">
            域名: <strong>${escHtml(d.subdomain)}.${escHtml(d.domain)}</strong>
            ${tunnel.tunnel_id ? ` · ID: <code style="font-size:.7rem">${escHtml(tunnel.tunnel_id.slice(0,8))}...</code>` : ''}
          </span>
        </div>
        <div style="font-size:.78rem;color:var(--t3);margin-top:6px">
          连接节点: ${escHtml(connInfo)}
        </div>`;

      // 服务列表
      const urls = d.urls || {};
      if (Object.keys(urls).length > 0) {
        servicesEl.innerHTML = '<div class="tunnel-services">' + Object.entries(urls).map(([name, url]) => {
          const icon = {ComfyCarry: '📊', ComfyUI: '🎨', JupyterLab: '📓', SSH: '🔒'}[name] || '🌐';
          if (name === 'SSH') {
            // SSH 显示连接命令而非可点击链接
            const hostname = url.replace('https://', '');
            const sshCmd = `ssh -o ProxyCommand="cloudflared access ssh --hostname %h" root@${hostname}`;
            return `<div class="tunnel-svc-card" style="cursor:default">
              <span class="tunnel-svc-icon">${icon}</span>
              <span class="tunnel-svc-name">${escHtml(name)}</span>
              <code class="tunnel-svc-detail" style="font-size:.72rem;user-select:all;cursor:text">${escHtml(sshCmd)}</code>
              <button class="btn btn-sm" onclick="navigator.clipboard.writeText('${sshCmd.replace(/'/g,"\\'")}');window.showToast?.('已复制')" style="font-size:.68rem;padding:2px 8px;flex-shrink:0">📋</button>
            </div>`;
          }
          return `<a href="${escHtml(url)}" target="_blank" class="tunnel-svc-card">
            <span class="tunnel-svc-icon">${icon}</span>
            <span class="tunnel-svc-name">${escHtml(name)}</span>
            <span class="tunnel-svc-detail">${escHtml(url)}</span>
          </a>`;
        }).join('') + '</div>';
      } else {
        servicesEl.innerHTML = '<div style="color:var(--t3);font-size:.85rem;padding:8px 0">正在获取服务链接...</div>';
      }

    } else {
      // ── 未配置视图 ──
      statusSection.style.display = 'none';
      setupSection.style.display = '';
    }

    // 日志
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
    if (statusEl) statusEl.innerHTML = `<div style="color:var(--red,#e74c3c)">加载失败: ${escHtml(e.message)}</div>`;
    logEl.innerHTML = '';
  }
}

// ── 验证 Token ──
window._tunnelValidate = async function() {
  const token = document.getElementById('tunnel-api-token').value.trim();
  const domain = document.getElementById('tunnel-domain').value.trim();
  const resultEl = document.getElementById('tunnel-validate-result');

  if (!token || !domain) {
    resultEl.style.display = 'block';
    resultEl.style.color = 'var(--red, #e74c3c)';
    resultEl.innerHTML = '❌ 请填写 API Token 和域名';
    return;
  }

  resultEl.style.display = 'block';
  resultEl.style.color = 'var(--t2)';
  resultEl.innerHTML = '⏳ 验证中...';

  try {
    const r = await fetch('/api/tunnel/validate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ api_token: token, domain: domain })
    });
    const d = await r.json();
    if (d.ok) {
      resultEl.style.color = 'var(--green)';
      resultEl.innerHTML = `✅ ${escHtml(d.message)} · 账户: ${escHtml(d.account_name)} · Zone: ${escHtml(d.zone_status)}`;
    } else {
      resultEl.style.color = 'var(--red, #e74c3c)';
      resultEl.innerHTML = `❌ ${escHtml(d.message)}`;
    }
  } catch (e) {
    resultEl.style.color = 'var(--red, #e74c3c)';
    resultEl.innerHTML = '❌ 验证请求失败';
  }
};

// ── 创建 Tunnel ──
window._tunnelProvision = async function() {
  const token = document.getElementById('tunnel-api-token').value.trim();
  const domain = document.getElementById('tunnel-domain').value.trim();
  const subdomain = document.getElementById('tunnel-subdomain').value.trim();

  if (!token || !domain) {
    showToast('请填写 API Token 和域名');
    return;
  }

  if (!confirm('确定创建 Cloudflare Tunnel？将自动配置 DNS 和 Ingress。')) return;

  showToast('正在创建 Tunnel...');

  try {
    const r = await fetch('/api/tunnel/provision', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ api_token: token, domain: domain, subdomain: subdomain })
    });
    const d = await r.json();
    if (d.ok) {
      showToast('✅ Tunnel 创建成功！');
      document.getElementById('tunnel-setup-section').dataset.manualOpen = '';
      setTimeout(loadTunnelPage, 2000);
    } else {
      showToast('❌ 创建失败: ' + (d.error || '未知错误'));
    }
  } catch (e) {
    showToast('❌ 请求失败: ' + e.message);
  }
};

// ── 移除 Tunnel ──
window._tunnelTeardown = async function() {
  if (!confirm('确定移除 Cloudflare Tunnel？将删除 Tunnel、DNS 记录，并停止 cloudflared。')) return;
  try {
    const r = await fetch('/api/tunnel/teardown', { method: 'POST' });
    const d = await r.json();
    if (d.ok) {
      showToast('✅ Tunnel 已移除');
      setTimeout(loadTunnelPage, 1000);
    } else {
      showToast('❌ 移除失败: ' + (d.error || ''));
    }
  } catch (e) { showToast('❌ 请求失败: ' + e.message); }
};

// ── 重启 cloudflared ──
window._tunnelRestart = async function() {
  if (!confirm('确定重启 cloudflared？')) return;
  try {
    await fetch('/api/tunnel/restart', { method: 'POST' });
    showToast('Tunnel 正在重启...');
    setTimeout(loadTunnelPage, 3000);
  } catch (e) { showToast('重启失败: ' + e.message); }
};

// ── 切换配置区显示 ──
window._tunnelToggleSetup = function() {
  const el = document.getElementById('tunnel-setup-section');
  if (el.style.display === 'none') {
    el.style.display = '';
    el.dataset.manualOpen = 'true';
  } else {
    el.style.display = 'none';
    el.dataset.manualOpen = '';
  }
};

// expose showToast for inline onclick
window.showToast = showToast;

function _startAutoRefresh() {
  _stopAutoRefresh();
  _autoRefresh = setInterval(loadTunnelPage, 10000);
}
function _stopAutoRefresh() {
  if (_autoRefresh) { clearInterval(_autoRefresh); _autoRefresh = null; }
}
