/**
 * ComfyCarry — page-tunnel.js (v3)
 * Tunnel 页面: CF API 驱动的配置/状态管理
 * 支持: 自定义服务、子域名编辑、服务状态、配置弹窗
 */

import { registerPage, showToast, escHtml, renderEmpty, renderError } from './core.js';

let _autoRefresh = null;
let _lastData = null;

registerPage('tunnel', {
  enter() { loadTunnelPage(); _startAutoRefresh(); },
  leave() { _stopAutoRefresh(); }
});

// ════════════════════════════════════════════════════════════════
// 主加载
// ════════════════════════════════════════════════════════════════

async function loadTunnelPage() {
  const statusSection = document.getElementById('tunnel-status-section');
  const setupSection = document.getElementById('tunnel-setup-section');
  const statusEl = document.getElementById('tunnel-status-info');
  const servicesEl = document.getElementById('tunnel-services');
  const logEl = document.getElementById('tunnel-log-content');

  try {
    const r = await fetch('/api/tunnel/status');
    const d = await r.json();
    _lastData = d;

    if (d.configured) {
      statusSection.style.display = '';
      setupSection.style.display = 'none';

      const tunnel = d.tunnel || {};
      const st = d.effective_status || 'unknown';
      const stColor = st === 'online' ? 'var(--green)'
                     : st === 'degraded' || st === 'connecting' ? 'var(--amber)'
                     : st === 'offline' ? 'var(--red)'
                     : 'var(--t3)';
      const stLabel = {
        online: '运行中', degraded: '部分连接', connecting: '连接中',
        offline: '离线', unconfigured: '未配置'
      }[st] || st;

      // ── Header badge + controls ──
      const badge = document.getElementById('tunnel-header-badge');
      if (badge) {
        badge.innerHTML = `<span class="page-status-dot" style="background:${stColor}"></span> <span style="color:${stColor}">${stLabel}</span>`;
      }
      const headerControls = document.getElementById('tunnel-header-controls');
      if (headerControls) {
        headerControls.innerHTML = st === 'online' || st === 'connecting' || st === 'degraded'
          ? `<button class="btn" onclick="window._tunnelRestart()">♻️ 重启</button><button class="btn" onclick="window._tunnelTeardown()">⏹ 停止</button>`
          : `<button class="btn" onclick="window._tunnelRestart()">▶ 启动</button>`;
      }

      const conns = tunnel.connections || [];
      const connInfo = conns.length > 0
        ? conns.map(c => c.colo_name || '?').join(', ')
        : '无连接';

      statusEl.innerHTML = `
        <div class="tunnel-header-row">
          <span style="font-size:.82rem;color:var(--t3)">
            ${escHtml(d.subdomain)}.${escHtml(d.domain)}
            ${tunnel.tunnel_id ? ` · <code style="font-size:.7rem">${escHtml(tunnel.tunnel_id.slice(0,8))}...</code>` : ''}
            · 节点: ${escHtml(connInfo)}
          </span>
        </div>`;

      _renderServices(d, servicesEl);

    } else {
      statusSection.style.display = 'none';
      setupSection.style.display = '';

      // Unconfigured state
      const badge = document.getElementById('tunnel-header-badge');
      if (badge) badge.innerHTML = `<span class="page-status-dot" style="background:var(--t3)"></span> <span style="color:var(--t3)">未配置</span>`;
      const headerControls = document.getElementById('tunnel-header-controls');
      if (headerControls) headerControls.innerHTML = '';
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
      logEl.innerHTML = renderEmpty('暂无日志');
    }

  } catch (e) {
    if (statusEl) statusEl.innerHTML = renderError('加载失败: ' + e.message);
    if (logEl) logEl.innerHTML = '';
  }
}

// ════════════════════════════════════════════════════════════════
// 服务列表渲染
// ════════════════════════════════════════════════════════════════

function _renderServices(d, el) {
  const urls = d.urls || {};
  const services = d.services || [];

  if (Object.keys(urls).length === 0 && services.length === 0) {
    el.innerHTML = '<div style="color:var(--t3);font-size:.85rem;padding:8px 0">正在获取服务链接...</div>';
    return;
  }

  let html = '<div class="tunnel-services">';
  for (const svc of services) {
    const name = svc.name;
    const url = urls[name] || '';
    const icon = {ComfyCarry: '📊', ComfyUI: '🎨', JupyterLab: '📓', SSH: '🔒'}[name] || '🌐';
    const isCustom = svc.custom;
    const protocol = svc.protocol || 'http';
    const port = svc.port;
    const suffix = svc.suffix || '';

    const eff = d.effective_status || 'unknown';
    const svcOnline = eff === 'online' || eff === 'connecting';
    const statusDot = svcOnline
      ? `<span class="tunnel-svc-status-dot" style="background:${eff === 'online' ? 'var(--green)' : 'var(--amber)'}"></span> ${eff === 'online' ? '路由就绪' : '连接中'}`
      : '<span class="tunnel-svc-status-dot" style="background:var(--red)"></span> 离线';

    // Top-right action buttons (hover to reveal)
    const actionBtns = suffix ? `<div class="tunnel-svc-actions">
      <button class="btn btn-xs" onclick="event.preventDefault();event.stopPropagation();window._tunnelEditSuffix('${escHtml(suffix)}')" title="编辑">✏️</button>
      <button class="btn btn-xs btn-danger" onclick="event.preventDefault();event.stopPropagation();window._tunnelRemoveService('${escHtml(suffix)}'${isCustom ? '' : ",true"})" title="删除">✕</button>
    </div>` : '';

    if (name === 'SSH') {
      const hostname = url ? url.replace('https://', '') : `${suffix}-${d.subdomain}.${d.domain}`;
      const sshCmd = `ssh -o ProxyCommand="cloudflared access ssh --hostname %h" root@${hostname}`;
      const encodedCmd = encodeURIComponent(sshCmd);
      html += `<div class="tunnel-svc-card" style="cursor:pointer" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodedCmd}'));window.showToast?.('SSH 命令已复制')">
        ${actionBtns}
        <div style="display:flex;align-items:center;gap:8px">
          <span class="tunnel-svc-icon">${icon}</span>
          <span class="tunnel-svc-name">${escHtml(name)}</span>
          <span class="tunnel-svc-status">${statusDot}</span>
          <span style="font-size:.68rem;color:var(--t3);margin-left:auto">点击复制</span>
        </div>
        <code class="tunnel-svc-detail" style="font-size:.72rem;user-select:all;cursor:pointer">${escHtml(sshCmd)}</code>
        <span class="tunnel-svc-port">:${port} · ${escHtml(suffix ? suffix + '.' : '')}${escHtml(d.domain)}</span>
      </div>`;
    } else {
      const displayUrl = url || `https://${suffix ? suffix+'-' : ''}${d.subdomain}.${d.domain}`;
      html += `<a href="${escHtml(displayUrl)}" target="_blank" class="tunnel-svc-card">
        ${actionBtns}
        <div style="display:flex;align-items:center;gap:8px">
          <span class="tunnel-svc-icon">${icon}</span>
          <span class="tunnel-svc-name">${escHtml(name)}</span>
          ${isCustom ? '<span style="font-size:.6rem;background:var(--ac);color:#000;padding:1px 5px;border-radius:3px">自定义</span>' : ''}
          <span class="tunnel-svc-status">${statusDot}</span>
        </div>
        <span class="tunnel-svc-detail">${escHtml(displayUrl)}</span>
        <span class="tunnel-svc-port">:${port} · ${protocol}</span>
      </a>`;
    }
  }

  // fallback: 只有 urls 没有 services
  if (services.length === 0) {
    for (const [name, url] of Object.entries(urls)) {
      const icon = {ComfyCarry: '📊', ComfyUI: '🎨', JupyterLab: '📓', SSH: '🔒'}[name] || '🌐';
      html += `<a href="${escHtml(url)}" target="_blank" class="tunnel-svc-card">
        <span class="tunnel-svc-icon">${icon}</span>
        <span class="tunnel-svc-name">${escHtml(name)}</span>
        <span class="tunnel-svc-detail">${escHtml(url)}</span>
      </a>`;
    }
  }

  // Add service card (empty card)
  html += `<div class="tunnel-svc-card add-card" onclick="window._tunnelAddService()" style="cursor:pointer">
    <span class="add-icon">+</span>
    <span>添加服务</span>
  </div>`;

  html += '</div>';
  el.innerHTML = html;
}

// ════════════════════════════════════════════════════════════════
// 验证 Token (初始配置)
// ════════════════════════════════════════════════════════════════

async function _tunnelValidate() {
  const token = document.getElementById('tunnel-api-token').value.trim();
  const domain = document.getElementById('tunnel-domain').value.trim();
  const resultEl = document.getElementById('tunnel-validate-result');

  if (!token || !domain) {
    resultEl.style.display = 'block';
    resultEl.style.color = 'var(--red)';
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
      resultEl.style.color = 'var(--red)';
      resultEl.innerHTML = `❌ ${escHtml(d.message)}`;
    }
  } catch (e) {
    resultEl.style.color = 'var(--red)';
    resultEl.innerHTML = '❌ 验证请求失败';
  }
}

// ════════════════════════════════════════════════════════════════
// 创建 Tunnel (初始配置)
// ════════════════════════════════════════════════════════════════

async function _tunnelProvision() {
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
      showToast('✅ Tunnel 创建成功！连接可能短暂中断，5 秒后自动刷新...');
      setTimeout(() => location.reload(), 5000);
    } else {
      showToast('❌ 创建失败: ' + (d.error || '未知错误'));
    }
  } catch (e) {
    showToast('❌ 请求失败: ' + e.message);
  }
}

// ════════════════════════════════════════════════════════════════
// 移除 / 重启
// ════════════════════════════════════════════════════════════════

async function _tunnelTeardown() {
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
}

async function _tunnelRestart() {
  if (!confirm('确定重启 cloudflared？')) return;
  try {
    await fetch('/api/tunnel/restart', { method: 'POST' });
    showToast('Tunnel 正在重启...');
    setTimeout(loadTunnelPage, 3000);
  } catch (e) { showToast('重启失败: ' + e.message); }
}

// ════════════════════════════════════════════════════════════════
// 修改配置弹窗
// ════════════════════════════════════════════════════════════════

async function _tunnelOpenConfig() {
  const modal = document.getElementById('tunnel-config-modal');
  const resultEl = document.getElementById('tunnel-cfg-result');
  resultEl.style.display = 'none';

  try {
    const r = await fetch('/api/tunnel/config');
    const d = await r.json();
    document.getElementById('tunnel-cfg-token').value = d.api_token || '';
    document.getElementById('tunnel-cfg-domain').value = d.domain || '';
    document.getElementById('tunnel-cfg-subdomain').value = d.subdomain || '';
  } catch (_) {}

  modal.classList.add('active');
}

async function _tunnelCfgValidate() {
  const token = document.getElementById('tunnel-cfg-token').value.trim();
  const domain = document.getElementById('tunnel-cfg-domain').value.trim();
  const resultEl = document.getElementById('tunnel-cfg-result');

  if (!token || !domain) {
    resultEl.style.display = 'block';
    resultEl.style.color = 'var(--red)';
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
      resultEl.innerHTML = `✅ ${escHtml(d.message)}`;
    } else {
      resultEl.style.color = 'var(--red)';
      resultEl.innerHTML = `❌ ${escHtml(d.message)}`;
    }
  } catch (e) {
    resultEl.style.color = 'var(--red)';
    resultEl.innerHTML = '❌ 验证失败';
  }
}

async function _tunnelCfgSave() {
  const token = document.getElementById('tunnel-cfg-token').value.trim();
  const domain = document.getElementById('tunnel-cfg-domain').value.trim();
  const subdomain = document.getElementById('tunnel-cfg-subdomain').value.trim();
  const resultEl = document.getElementById('tunnel-cfg-result');

  if (!token || !domain) {
    showToast('请填写 API Token 和域名');
    return;
  }

  if (!confirm('将更新现有 Tunnel 配置并重启 cloudflared。\n\n⚠️ 通过 Tunnel 的连接（包括当前页面）可能会短暂中断，确定继续？')) return;

  resultEl.style.display = 'block';
  resultEl.style.color = 'var(--t2)';
  resultEl.innerHTML = '⏳ 正在应用配置...';

  try {
    const r = await fetch('/api/tunnel/provision', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ api_token: token, domain: domain, subdomain: subdomain })
    });
    const d = await r.json();
    if (d.ok) {
      showToast('✅ 配置已更新！连接可能短暂中断，5 秒后自动刷新...');
      document.getElementById('tunnel-config-modal').classList.remove('active');
      setTimeout(() => location.reload(), 5000);
    } else {
      resultEl.style.color = 'var(--red)';
      resultEl.innerHTML = `❌ ${escHtml(d.error || '保存失败')}`;
    }
  } catch (e) {
    resultEl.style.color = 'var(--red)';
    resultEl.innerHTML = '❌ 请求失败';
  }
}

// ════════════════════════════════════════════════════════════════
// 添加/移除自定义服务
// ════════════════════════════════════════════════════════════════

function _tunnelAddService() {
  const modal = document.getElementById('tunnel-addsvc-modal');
  document.getElementById('tunnel-addsvc-name').value = '';
  document.getElementById('tunnel-addsvc-port').value = '';
  document.getElementById('tunnel-addsvc-suffix').value = '';
  document.getElementById('tunnel-addsvc-proto').value = 'http';
  _updateAddSvcPreview();
  modal.classList.add('active');

  document.getElementById('tunnel-addsvc-suffix').oninput = _updateAddSvcPreview;
}

function _updateAddSvcPreview() {
  const suffix = document.getElementById('tunnel-addsvc-suffix').value.trim();
  const preview = document.getElementById('tunnel-addsvc-preview');
  if (_lastData && suffix) {
    preview.textContent = `${suffix}-${_lastData.subdomain}.${_lastData.domain}`;
  } else {
    preview.textContent = '请输入后缀';
  }
}

async function _tunnelAddServiceSubmit() {
  const name = document.getElementById('tunnel-addsvc-name').value.trim();
  const port = parseInt(document.getElementById('tunnel-addsvc-port').value);
  const suffix = document.getElementById('tunnel-addsvc-suffix').value.trim();
  const protocol = document.getElementById('tunnel-addsvc-proto').value;

  if (!name || !port || !suffix) {
    showToast('请填写所有字段');
    return;
  }

  showToast('正在添加服务...');

  try {
    const r = await fetch('/api/tunnel/services', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ name, port, suffix, protocol })
    });
    const d = await r.json();
    if (d.ok) {
      showToast('✅ 服务已添加！');
      document.getElementById('tunnel-addsvc-modal').classList.remove('active');
      setTimeout(loadTunnelPage, 2000);
    } else {
      showToast('❌ 添加失败: ' + (d.error || ''));
    }
  } catch (e) {
    showToast('❌ 请求失败: ' + e.message);
  }
}

async function _tunnelRemoveService(suffix, isDefault) {
  if (isDefault) {
    if (!confirm(`⚠️ "${suffix}" 是默认服务。删除后相关功能将无法通过 Tunnel 访问。\n\n确定继续？`)) return;
  } else {
    if (!confirm(`确定移除自定义服务 (${suffix})？`)) return;
  }
  showToast('正在移除...');
  try {
    const r = await fetch(`/api/tunnel/services/${encodeURIComponent(suffix)}`, { method: 'DELETE' });
    const d = await r.json();
    if (d.ok) {
      showToast('✅ 服务已移除');
      setTimeout(loadTunnelPage, 2000);
    } else {
      showToast('❌ ' + (d.error || '移除失败'));
    }
  } catch (e) { showToast('❌ ' + e.message); }
}

async function _tunnelEditSuffix(currentSuffix) {
  const newSuffix = prompt(`修改子域名后缀 (当前: ${currentSuffix})`, currentSuffix);
  if (!newSuffix || newSuffix === currentSuffix) return;
  showToast('正在更新...');
  try {
    const r = await fetch(`/api/tunnel/services/${encodeURIComponent(currentSuffix)}/subdomain`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_suffix: newSuffix })
    });
    const d = await r.json();
    if (d.ok) {
      showToast('✅ 子域名已更新');
      setTimeout(loadTunnelPage, 2000);
    } else {
      showToast('❌ ' + (d.error || '更新失败'));
    }
  } catch (e) { showToast('❌ ' + e.message); }
}

// expose for inline onclick
Object.assign(window, {
  _tunnelValidate, _tunnelProvision, _tunnelTeardown, _tunnelRestart,
  _tunnelOpenConfig, _tunnelCfgValidate, _tunnelCfgSave,
  _tunnelAddService, _tunnelAddServiceSubmit,
  _tunnelRemoveService, _tunnelEditSuffix,
  showToast,
});

function _startAutoRefresh() {
  _stopAutoRefresh();
  _autoRefresh = setInterval(loadTunnelPage, 10000);
}
function _stopAutoRefresh() {
  if (_autoRefresh) { clearInterval(_autoRefresh); _autoRefresh = null; }
}
