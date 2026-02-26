/**
 * ComfyCarry — page-tunnel.js (v4)
 * Tunnel 页面: 公共节点 + 自定义 Tunnel 双模式
 */

import { registerPage, showToast, escHtml, renderEmpty, renderError } from './core.js';

let _autoRefresh = null;
let _lastData = null;
let _currentTunnelTab = 'status';
let _selectedMode = null;  // 'public' | 'custom'

registerPage('tunnel', {
  enter() { loadTunnelPage(); _startAutoRefresh(); },
  leave() { _stopAutoRefresh(); }
});

// ════════════════════════════════════════════════════════════════
// Tab 切换
// ════════════════════════════════════════════════════════════════

function switchTunnelTab(tab) {
  ['status', 'config'].forEach(t => {
    const el = document.getElementById('ttab-' + t);
    const tabEl = document.querySelector(`.tab[data-ttab="${t}"]`);
    if (el) el.classList.toggle('hidden', t !== tab);
    if (tabEl) tabEl.classList.toggle('active', t === tab);
  });
  _currentTunnelTab = tab;
  if (tab === 'status') loadTunnelPage();
  else if (tab === 'config') _loadTunnelConfigTab();
}

// ════════════════════════════════════════════════════════════════
// 主加载
// ════════════════════════════════════════════════════════════════

async function loadTunnelPage() {
  const statusSection = document.getElementById('tunnel-status-section');
  const setupHint = document.getElementById('tunnel-setup-hint');
  const statusEl = document.getElementById('tunnel-status-info');
  const servicesEl = document.getElementById('tunnel-services');
  const logEl = document.getElementById('tunnel-log-content');

  try {
    const r = await fetch('/api/tunnel/status');
    const d = await r.json();
    _lastData = d;

    const tunnelMode = d.tunnel_mode; // "public" | "custom" | null

    // ── Header badge ──
    const badge = document.getElementById('tunnel-header-badge');
    const headerControls = document.getElementById('tunnel-header-controls');

    if (tunnelMode === 'public' && d.public) {
      // 公共模式
      const st = d.effective_status || 'unknown';
      const stColor = st === 'online' ? 'var(--green)' : st === 'degraded' ? 'var(--amber)' : 'var(--red)';
      const stLabel = { online: '公共 · 运行中', degraded: '公共 · 部分异常', offline: '公共 · 离线' }[st] || st;

      if (badge) badge.innerHTML = `<span class="page-status-dot" style="background:${stColor}"></span> <span style="color:${stColor}">${stLabel}</span>`;
      if (headerControls) headerControls.innerHTML = `<button class="btn" onclick="window._tunnelPublicDisable()">⏹ 停用</button>`;

      // Show status section with public tunnel services
      statusSection.style.display = '';
      setupHint.style.display = 'none';

      const pubId = d.public.random_id || '?';
      statusEl.textContent = `公共节点 · ${pubId}`;

      _renderPublicServices(d, servicesEl);

    } else if (d.configured) {
      // 自定义模式
      statusSection.style.display = '';
      setupHint.style.display = 'none';

      const tunnel = d.tunnel || {};
      const st = d.effective_status || 'unknown';
      const stColor = st === 'online' ? 'var(--green)'
                     : st === 'degraded' || st === 'connecting' ? 'var(--amber)'
                     : st === 'offline' ? 'var(--red)'
                     : 'var(--t3)';
      const stLabel = {
        online: '自定义 · 运行中', degraded: '自定义 · 部分连接', connecting: '自定义 · 连接中',
        offline: '自定义 · 离线', unconfigured: '未配置'
      }[st] || st;

      if (badge) badge.innerHTML = `<span class="page-status-dot" style="background:${stColor}"></span> <span style="color:${stColor}">${stLabel}</span>`;
      if (headerControls) {
        headerControls.innerHTML = st === 'online' || st === 'connecting' || st === 'degraded'
          ? `<button class="btn" onclick="window._tunnelTeardown()">⏹ 停止</button><button class="btn" onclick="window._tunnelRestart()">♻️ 重启</button>`
          : `<button class="btn" onclick="window._tunnelRestart()">▶ 启动</button>`;
      }

      const conns = tunnel.connections || [];
      const connInfo = conns.length > 0
        ? conns.map(c => c.colo_name || '?').join(', ')
        : '无连接';

      statusEl.textContent = `${d.subdomain}.${d.domain}${tunnel.tunnel_id ? ` · ${tunnel.tunnel_id.slice(0,8)}...` : ''} · 节点: ${connInfo}`;

      _renderCustomServices(d, servicesEl);

    } else {
      // 未配置
      statusSection.style.display = 'none';
      setupHint.style.display = '';
      if (badge) badge.innerHTML = `<span class="page-status-dot" style="background:var(--t3)"></span> <span style="color:var(--t3)">未配置</span>`;
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
// 公共节点服务列表渲染
// ════════════════════════════════════════════════════════════════

function _renderPublicServices(d, el) {
  const urls = d.public?.urls || {};

  if (Object.keys(urls).length === 0) {
    el.innerHTML = '<div style="color:var(--t3);font-size:.85rem;padding:8px 0">正在获取服务链接...</div>';
    return;
  }

  const eff = d.effective_status || 'unknown';
  const svcOnline = eff === 'online';
  const statusDot = svcOnline
    ? '<span class="tunnel-svc-status-dot" style="background:var(--green)"></span> 在线'
    : '<span class="tunnel-svc-status-dot" style="background:var(--amber)"></span> 连接中';

  const iconMap = { dashboard: '📊', comfyui: '🎨', jupyter: '📓', ssh: '🔒' };
  const nameMap = { dashboard: 'Dashboard', comfyui: 'ComfyUI', jupyter: 'JupyterLab', ssh: 'SSH' };

  let html = '<div class="tunnel-services">';
  for (const [key, url] of Object.entries(urls)) {
    const icon = iconMap[key] || '🌐';
    const name = nameMap[key] || key;

    if (key === 'ssh') {
      const hostname = url.replace(/^https?:\/\//, '');
      const sshCmd = `ssh -o ProxyCommand="cloudflared access ssh --hostname %h" root@${hostname}`;
      const encodedCmd = encodeURIComponent(sshCmd);
      html += `<div class="tunnel-svc-card" style="cursor:pointer" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodedCmd}'));window.showToast?.('SSH 命令已复制')">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="tunnel-svc-icon">${icon}</span>
          <span class="tunnel-svc-name">${escHtml(name)}</span>
          <span class="tunnel-svc-status">${statusDot}</span>
          <span style="font-size:.68rem;color:var(--t3);margin-left:auto">点击复制</span>
        </div>
        <code class="tunnel-svc-detail" style="font-size:.72rem;user-select:all;cursor:pointer">${escHtml(sshCmd)}</code>
        <span class="tunnel-svc-port">:22 · TCP</span>
      </div>`;
    } else {
      html += `<a href="${escHtml(url)}" target="_blank" class="tunnel-svc-card">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="tunnel-svc-icon">${icon}</span>
          <span class="tunnel-svc-name">${escHtml(name)}</span>
          <span class="tunnel-svc-status">${statusDot}</span>
        </div>
        <span class="tunnel-svc-detail">${escHtml(url)}</span>
      </a>`;
    }
  }
  html += '</div>';
  el.innerHTML = html;
}

// ════════════════════════════════════════════════════════════════
// 自定义 Tunnel 服务列表渲染
// ════════════════════════════════════════════════════════════════

function _renderCustomServices(d, el) {
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
// Config Tab — 模式选择 + 配置加载
// ════════════════════════════════════════════════════════════════

async function _loadTunnelConfigTab() {
  const resultEl = document.getElementById('tunnel-cfg-result');
  if (resultEl) resultEl.style.display = 'none';

  // 获取公共 Tunnel 容量
  _loadPublicCapacity();

  // 获取当前模式
  const tunnelMode = _lastData?.tunnel_mode;

  if (tunnelMode === 'public') {
    _selectedMode = 'public';
  } else if (_lastData?.configured) {
    _selectedMode = 'custom';
  } else {
    _selectedMode = _selectedMode || null;
  }

  _updateModeUI();

  // 加载自定义配置
  try {
    const r = await fetch('/api/tunnel/config');
    const d = await r.json();
    document.getElementById('tunnel-cfg-token').value = d.api_token || '';
    document.getElementById('tunnel-cfg-domain').value = d.domain || '';
    document.getElementById('tunnel-cfg-subdomain').value = d.subdomain || '';
  } catch (_) {}

  // Update submit button label
  const btn = document.getElementById('tunnel-cfg-submit');
  if (btn) {
    btn.textContent = _lastData?.configured ? '💾 保存并应用' : '🚀 创建 Tunnel';
  }

  // 加载公共 Tunnel 状态
  _loadPublicStatus();
}

async function _loadPublicCapacity() {
  const capEl = document.getElementById('tunnel-public-capacity');
  try {
    const r = await fetch('/api/tunnel/public/status');
    const d = await r.json();
    const cap = d.capacity || {};
    if (cap.active_tunnels >= 0) {
      const pct = Math.round((cap.active_tunnels / cap.max_tunnels) * 100);
      capEl.innerHTML = `容量: <strong>${cap.active_tunnels}</strong> / ${cap.max_tunnels} (${pct}%)${cap.available ? '' : ' · <span style="color:var(--red)">已满</span>'}`;
    } else {
      capEl.textContent = '容量: 无法获取';
    }
  } catch (_) {
    capEl.textContent = '容量: 无法获取';
  }
}

async function _loadPublicStatus() {
  const activeEl = document.getElementById('tunnel-public-active');
  const inactiveEl = document.getElementById('tunnel-public-inactive');

  if (_selectedMode !== 'public') return;

  try {
    const r = await fetch('/api/tunnel/public/status');
    const d = await r.json();
    if (d.mode === 'public' && d.random_id) {
      // 已启用 — 显示 URLs
      activeEl.style.display = '';
      inactiveEl.style.display = 'none';

      const badge = document.getElementById('tunnel-public-status-badge');
      if (d.degraded) {
        badge.textContent = '部分异常';
        badge.style.color = 'var(--amber)';
      } else {
        badge.textContent = '已启用';
        badge.style.color = 'var(--green)';
      }

      const urlsEl = document.getElementById('tunnel-public-urls');
      _renderPublicUrlCards(d.urls || {}, urlsEl);
    } else {
      // 未启用
      activeEl.style.display = 'none';
      inactiveEl.style.display = '';
    }
  } catch (_) {
    activeEl.style.display = 'none';
    inactiveEl.style.display = '';
  }
}

function _renderPublicUrlCards(urls, el) {
  const iconMap = { dashboard: '📊', comfyui: '🎨', jupyter: '📓', ssh: '🔒' };
  const nameMap = { dashboard: 'Dashboard', comfyui: 'ComfyUI', jupyter: 'JupyterLab', ssh: 'SSH' };

  let html = '';
  for (const [key, url] of Object.entries(urls)) {
    const icon = iconMap[key] || '🌐';
    const name = nameMap[key] || key;
    if (key === 'ssh') {
      const hostname = url.replace(/^https?:\/\//, '');
      html += `<div class="tunnel-svc-card" style="cursor:pointer" onclick="navigator.clipboard.writeText('${escHtml(url)}');window.showToast?.('已复制')">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="tunnel-svc-icon">${icon}</span>
          <span class="tunnel-svc-name">${escHtml(name)}</span>
          <span style="font-size:.68rem;color:var(--t3);margin-left:auto">点击复制</span>
        </div>
        <span class="tunnel-svc-detail" style="font-size:.75rem">${escHtml(hostname)}</span>
      </div>`;
    } else {
      html += `<a href="${escHtml(url)}" target="_blank" class="tunnel-svc-card">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="tunnel-svc-icon">${icon}</span>
          <span class="tunnel-svc-name">${escHtml(name)}</span>
        </div>
        <span class="tunnel-svc-detail" style="font-size:.75rem">${escHtml(url)}</span>
      </a>`;
    }
  }
  el.innerHTML = html;
}

function _selectTunnelMode(mode) {
  _selectedMode = mode;
  _updateModeUI();
}

function _updateModeUI() {
  const publicCard = document.getElementById('tunnel-mode-public');
  const customCard = document.getElementById('tunnel-mode-custom');
  const publicDetails = document.getElementById('tunnel-public-details');
  const customDetails = document.getElementById('tunnel-custom-details');

  // Reset borders
  publicCard.style.borderColor = 'transparent';
  customCard.style.borderColor = 'transparent';

  // Hide both
  publicDetails.style.display = 'none';
  customDetails.style.display = 'none';

  if (_selectedMode === 'public') {
    publicCard.style.borderColor = 'var(--ac)';
    publicDetails.style.display = '';
    _loadPublicStatus();
  } else if (_selectedMode === 'custom') {
    customCard.style.borderColor = 'var(--ac)';
    customDetails.style.display = '';
  }
}

// ════════════════════════════════════════════════════════════════
// 公共 Tunnel 操作
// ════════════════════════════════════════════════════════════════

async function _tunnelPublicEnable() {
  const btn = document.getElementById('tunnel-public-enable-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 正在启用...'; }

  try {
    const r = await fetch('/api/tunnel/public/enable', { method: 'POST' });
    const d = await r.json();
    if (d.ok) {
      showToast('✅ 公共节点已启用！');
      setTimeout(() => {
        loadTunnelPage();
        _loadPublicStatus();
      }, 2000);
    } else {
      showToast('❌ 启用失败: ' + (d.error || ''));
    }
  } catch (e) {
    showToast('❌ 请求失败: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 启用公共节点'; }
  }
}

async function _tunnelPublicDisable() {
  if (!confirm('确定停用公共节点？Tunnel 将被删除，所有公网链接将失效。')) return;

  try {
    const r = await fetch('/api/tunnel/public/disable', { method: 'POST' });
    const d = await r.json();
    if (d.ok) {
      showToast('✅ 公共节点已停用');
      setTimeout(() => {
        loadTunnelPage();
        _loadTunnelConfigTab();
      }, 1000);
    } else {
      showToast('❌ 停用失败: ' + (d.error || ''));
    }
  } catch (e) { showToast('❌ 请求失败: ' + e.message); }
}

// ════════════════════════════════════════════════════════════════
// 自定义 Tunnel — Config 验证/保存
// ════════════════════════════════════════════════════════════════

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

async function _tunnelCfgSave() {
  const token = document.getElementById('tunnel-cfg-token').value.trim();
  const domain = document.getElementById('tunnel-cfg-domain').value.trim();
  const subdomain = document.getElementById('tunnel-cfg-subdomain').value.trim();
  const resultEl = document.getElementById('tunnel-cfg-result');

  if (!token || !domain) {
    showToast('请填写 API Token 和域名');
    return;
  }

  const isCreate = !_lastData?.configured;
  const msg = isCreate
    ? '确定创建 Cloudflare Tunnel？将自动配置 DNS 和 Ingress。'
    : '将更新现有 Tunnel 配置并重启 cloudflared。\n\n⚠️ 通过 Tunnel 的连接可能会短暂中断，确定继续？';
  if (!confirm(msg)) return;

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
      showToast('✅ Tunnel 配置已应用！连接可能短暂中断，5 秒后自动刷新...');
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
// 移除 / 重启 (自定义 Tunnel)
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
  switchTunnelTab,
  _selectTunnelMode,
  _tunnelCfgValidate, _tunnelCfgSave,
  _tunnelTeardown, _tunnelRestart,
  _tunnelPublicEnable, _tunnelPublicDisable,
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
