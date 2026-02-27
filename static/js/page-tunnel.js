/**
 * ComfyCarry — page-tunnel.js (v4)
 * Tunnel 页面: 公共节点 + 自定义 Tunnel 双模式
 */

import { registerPage, showToast, escHtml, renderEmpty, renderError, msIcon, apiFetch } from './core.js';
import { createLogStream } from './sse-log.js';

let _autoRefresh = null;
let _lastData = null;
let _currentTunnelTab = 'status';
let _selectedMode = null;  // 'public' | 'custom'

// SSE 日志流
let _tunnelLogStream = null;

registerPage('tunnel', {
  enter() {
    loadTunnelPage();
    _startAutoRefresh();
    _startLogStream();
  },
  leave() {
    _stopAutoRefresh();
    _stopLogStream();
  }
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
      const cfOnline = d.cloudflared === 'online';
      const stColor = cfOnline ? 'var(--green)' : 'var(--red)';
      const stLabel = cfOnline ? '运行中' : '已停止';

      if (badge) badge.innerHTML = `<span class="page-status-dot" style="background:${stColor}"></span> <span style="color:${stColor}">${stLabel}</span>`;
      if (headerControls) {
        headerControls.innerHTML = cfOnline
          ? `<button class="btn" onclick="window._tunnelStop()">${msIcon('stop')} 停止</button><button class="btn" onclick="window._tunnelRestart()">${msIcon('restart_alt')} 重启</button>`
          : `<button class="btn" onclick="window._tunnelStart()">${msIcon('play_arrow')} 启动</button>`;
      }

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
        online: '运行中', degraded: '部分连接', connecting: '连接中',
        offline: '离线', unconfigured: '未配置'
      }[st] || st;

      if (badge) badge.innerHTML = `<span class="page-status-dot" style="background:${stColor}"></span> <span style="color:${stColor}">${stLabel}</span>`;
      if (headerControls) {
        headerControls.innerHTML = st === 'online' || st === 'connecting' || st === 'degraded'
          ? `<button class="btn" onclick="window._tunnelTeardown()">${msIcon('stop')} 停止</button><button class="btn" onclick="window._tunnelRestart()">${msIcon('restart_alt')} 重启</button>`
          : `<button class="btn" onclick="window._tunnelRestart()">${msIcon('play_arrow')} 启动</button>`;
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

    // 日志由 SSE 流管理，不再在此处渲染

  } catch (e) {
    if (statusEl) statusEl.innerHTML = renderError('加载失败: ' + e.message);
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

  const iconMap = { dashboard: msIcon('monitoring'), comfyui: msIcon('palette'), jupyter: msIcon('book_2'), ssh: msIcon('lock') };
  const nameMap = { dashboard: 'Dashboard', comfyui: 'ComfyUI', jupyter: 'JupyterLab', ssh: 'SSH' };

  let html = '<div class="tunnel-services">';
  for (const [key, url] of Object.entries(urls)) {
    const icon = iconMap[key] || msIcon('language');
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
    const icon = {ComfyCarry: msIcon('monitoring'), ComfyUI: msIcon('palette'), JupyterLab: msIcon('book_2'), SSH: msIcon('lock')}[name] || msIcon('language');
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
      <button class="btn btn-xs" onclick="event.preventDefault();event.stopPropagation();window._tunnelEditSuffix('${escHtml(suffix)}')" title="编辑">编辑</button>
      <button class="btn btn-sm btn-danger" onclick="event.preventDefault();event.stopPropagation();window._tunnelRemoveService('${escHtml(suffix)}'${isCustom ? '' : ",true"})" title="删除">${msIcon('delete')}</button>
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
      const icon = {ComfyCarry: msIcon('monitoring'), ComfyUI: msIcon('palette'), JupyterLab: msIcon('book_2'), SSH: msIcon('lock')}[name] || msIcon('language');
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

  // 加载协议设置
  const protocolSel = document.getElementById('tunnel-cfg-protocol');
  if (protocolSel && _lastData?.cf_protocol) {
    protocolSel.value = _lastData.cf_protocol;
  }

  // 加载自定义配置
  try {
    const r = await fetch('/api/tunnel/config');
    const d = await r.json();
    document.getElementById('tunnel-cfg-token').value = d.api_token || '';
    document.getElementById('tunnel-cfg-domain').value = d.domain || '';
    document.getElementById('tunnel-cfg-subdomain').value = d.subdomain || '';
  } catch (_) {}

  _updateModeUI();
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

function _selectTunnelMode(mode) {
  _selectedMode = mode;
  _updateModeUI();
}

function _updateModeUI() {
  const publicCard = document.getElementById('tunnel-mode-public');
  const customCard = document.getElementById('tunnel-mode-custom');
  const configDetails = document.getElementById('tunnel-config-details');
  const banner = document.getElementById('tunnel-config-banner');
  const customCards = document.querySelectorAll('.tunnel-cfg-custom-card');
  const submitBtn = document.getElementById('tunnel-cfg-submit');
  const disableBtn = document.getElementById('tunnel-disable-btn');
  const resultEl = document.getElementById('tunnel-cfg-result');

  // Reset borders
  publicCard.style.borderColor = 'transparent';
  customCard.style.borderColor = 'transparent';

  const isPublicActive = _lastData?.tunnel_mode === 'public';
  const isCustomConfigured = !!_lastData?.configured;

  // Active mode indicator — inset box-shadow (won't conflict with selection border)
  publicCard.style.boxShadow = isPublicActive ? 'inset 0 3px 0 0 var(--green)' : 'none';
  customCard.style.boxShadow = isCustomConfigured ? 'inset 0 3px 0 0 var(--green)' : 'none';

  if (!_selectedMode) {
    configDetails.style.display = 'none';
    return;
  }

  configDetails.style.display = '';
  if (resultEl) resultEl.style.display = 'none';

  const isPublic = _selectedMode === 'public';
  const hasActiveTunnel = isPublicActive || isCustomConfigured;

  // Highlight selected mode card
  if (isPublic) {
    publicCard.style.borderColor = 'var(--ac)';
  } else {
    customCard.style.borderColor = 'var(--ac)';
  }

  // Banner text
  if (isPublic) {
    banner.innerHTML = isPublicActive
      ? `<span class="ms ms-sm" style="color:var(--green);vertical-align:middle">check_circle</span> 公共节点已启用 · 服务链接请查看「服务 & 日志」Tab。`
      : `公共模式无需域名或 CF 账号，点击「保存」一键启用。`;
  } else {
    banner.innerHTML = isCustomConfigured
      ? `自定义 Tunnel 运行中 · 修改配置后点击「保存」将更新并重启。`
      : `填写 CF API Token 和域名后，点击「保存」自动创建 Tunnel、配置 DNS 和 Ingress。`;
  }

  // Custom cards disabled state (grayed out in public mode)
  customCards.forEach(card => {
    card.style.opacity = isPublic ? '0.4' : '1';
    card.style.pointerEvents = isPublic ? 'none' : '';
  });
  document.querySelectorAll('.tunnel-cfg-custom-card input').forEach(inp => {
    inp.disabled = isPublic;
  });

  // Submit button — always visible
  submitBtn.textContent = '保存';

  // Destroy button — only shown when a tunnel is active
  disableBtn.style.display = hasActiveTunnel ? '' : 'none';
  disableBtn.textContent = '销毁 Tunnel';
}

// ════════════════════════════════════════════════════════════════
// 统一保存 (协议 + 模式切换 + 配置)
// ════════════════════════════════════════════════════════════════

async function _tunnelSave() {
  const protocol = document.getElementById('tunnel-cfg-protocol')?.value || 'auto';
  const isPublic = _selectedMode === 'public';
  const isPublicActive = _lastData?.tunnel_mode === 'public';
  const isCustomConfigured = !!_lastData?.configured;

  // 保存协议
  await apiFetch('/api/tunnel/protocol', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ protocol })
  });

  if (isPublic) {
    // 如果当前已经是公共模式且在运行，仅保存协议并提示重启
    if (isPublicActive) {
      if (confirm('协议已保存。需要重启 cloudflared 才能生效，立即重启？')) {
        _tunnelRestart();
      } else {
        showToast('协议已保存，下次启动生效');
      }
      return;
    }
    // 切换到公共模式 — 销毁自定义 + 启用公共
    if (isCustomConfigured) {
      if (!confirm('将销毁当前自定义 Tunnel 并切换到公共模式，确定？')) return;
      await apiFetch('/api/tunnel/teardown', { method: 'POST' });
    }
    _tunnelPublicEnable();
  } else {
    // 自定义模式
    const token = document.getElementById('tunnel-cfg-token').value.trim();
    const domain = document.getElementById('tunnel-cfg-domain').value.trim();
    const subdomain = document.getElementById('tunnel-cfg-subdomain').value.trim();

    if (!token || !domain) {
      showToast('请填写 API Token 和域名');
      return;
    }

    // 切换到自定义模式 — 先销毁公共
    if (isPublicActive) {
      if (!confirm('将停用公共节点并切换到自定义 Tunnel，确定？')) return;
      await apiFetch('/api/tunnel/public/disable', { method: 'POST' });
    } else if (isCustomConfigured) {
      if (!confirm('将更新现有 Tunnel 配置并重启 cloudflared。\n\n通过 Tunnel 的连接可能会短暂中断，确定继续？')) return;
    } else {
      if (!confirm('确定创建 Cloudflare Tunnel？将自动配置 DNS 和 Ingress。')) return;
    }

    showToast('正在应用配置...');
    const d = await apiFetch('/api/tunnel/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_token: token, domain: domain, subdomain: subdomain })
    });
    if (!d) return;
    if (d.ok) {
      showToast('Tunnel 配置已应用！5 秒后自动刷新...');
      setTimeout(() => location.reload(), 5000);
    } else {
      showToast(d.error || '保存失败');
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 公共 Tunnel 操作
// ════════════════════════════════════════════════════════════════

async function _tunnelPublicEnable() {
  showToast('正在启用公共节点...');
  const d = await apiFetch('/api/tunnel/public/enable', { method: 'POST' });
  if (!d) return;
  if (d.ok) {
    showToast('公共节点已启用！');
    setTimeout(() => {
      loadTunnelPage();
      _loadTunnelConfigTab();
    }, 2000);
  } else {
    showToast('启用失败: ' + (d.error || ''));
  }
}

async function _tunnelPublicDisable() {
  if (!confirm('确定停用公共节点？Tunnel 将被删除，所有公网链接将失效。')) return;

  const d = await apiFetch('/api/tunnel/public/disable', { method: 'POST' });
  if (!d) return;
  if (d.ok) {
    showToast('公共节点已停用');
    setTimeout(() => {
      loadTunnelPage();
      _loadTunnelConfigTab();
    }, 1000);
  } else {
    showToast('停用失败: ' + (d.error || ''));
  }
}

// ════════════════════════════════════════════════════════════════
// 统一停用按钮
// ════════════════════════════════════════════════════════════════

function _tunnelDisable() {
  if (_selectedMode === 'public') {
    _tunnelPublicDisable();
  } else {
    _tunnelTeardown();
  }
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
    resultEl.innerHTML = `${msIcon('cancel')} 请填写 Token 和域名`;
    return;
  }

  resultEl.style.display = 'block';
  resultEl.style.color = 'var(--t2)';
  resultEl.innerHTML = `${msIcon('hourglass_top')} 验证中...`;

  try {
    const r = await fetch('/api/tunnel/validate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ api_token: token, domain: domain })
    });
    const d = await r.json();
    if (d.ok) {
      resultEl.style.color = 'var(--green)';
      resultEl.innerHTML = `${msIcon('check_circle')} ${escHtml(d.account_name)} · ${escHtml(d.zone_status)}`;
    } else {
      resultEl.style.color = 'var(--red)';
      resultEl.innerHTML = `${msIcon('cancel')} ${escHtml(d.message)}`;
    }
  } catch (e) {
    resultEl.style.color = 'var(--red)';
    resultEl.innerHTML = `${msIcon('cancel')} 验证请求失败`;
  }
}

// ════════════════════════════════════════════════════════════════
// 移除 / 重启 (自定义 Tunnel)
// ════════════════════════════════════════════════════════════════

async function _tunnelTeardown() {
  if (!confirm('确定移除 Cloudflare Tunnel？将删除 Tunnel、DNS 记录，并停止 cloudflared。')) return;
  const d = await apiFetch('/api/tunnel/teardown', { method: 'POST' });
  if (!d) return;
  if (d.ok) {
    showToast('Tunnel 已移除');
    setTimeout(loadTunnelPage, 1000);
  } else {
    showToast('移除失败: ' + (d.error || ''));
  }
}

async function _tunnelStop() {
  const d = await apiFetch('/api/tunnel/stop', { method: 'POST' });
  if (!d) return;
  if (d.ok) {
    showToast('cloudflared 已停止');
  } else {
    showToast(d.error || '停止失败');
  }
  setTimeout(loadTunnelPage, 1500);
}

async function _tunnelStart() {
  const d = await apiFetch('/api/tunnel/start', { method: 'POST' });
  if (!d) return;
  if (d.ok) {
    showToast('cloudflared 正在启动...');
  } else {
    showToast(d.error || '启动失败');
  }
  setTimeout(loadTunnelPage, 2000);
}

async function _tunnelRestart() {
  const d = await apiFetch('/api/tunnel/restart', { method: 'POST' });
  if (!d) return;
  showToast('cloudflared 正在重启...');
  setTimeout(loadTunnelPage, 3000);
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

  const d = await apiFetch('/api/tunnel/services', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ name, port, suffix, protocol })
  });
  if (!d) return;
  if (d.ok) {
    showToast('服务已添加！');
    document.getElementById('tunnel-addsvc-modal').classList.remove('active');
    setTimeout(loadTunnelPage, 2000);
  } else {
    showToast('添加失败: ' + (d.error || ''));
  }
}

async function _tunnelRemoveService(suffix, isDefault) {
  if (isDefault) {
    if (!confirm(`"${suffix}" 是默认服务。删除后相关功能将无法通过 Tunnel 访问。\n\n确定继续？`)) return;
  } else {
    if (!confirm(`确定移除自定义服务 (${suffix})？`)) return;
  }
  showToast('正在移除...');
  const d = await apiFetch(`/api/tunnel/services/${encodeURIComponent(suffix)}`, { method: 'DELETE' });
  if (!d) return;
  if (d.ok) {
    showToast('服务已移除');
    setTimeout(loadTunnelPage, 2000);
  } else {
    showToast(d.error || '移除失败');
  }
}

async function _tunnelEditSuffix(currentSuffix) {
  const newSuffix = prompt(`修改子域名后缀 (当前: ${currentSuffix})`, currentSuffix);
  if (!newSuffix || newSuffix === currentSuffix) return;
  showToast('正在更新...');
  const d = await apiFetch(`/api/tunnel/services/${encodeURIComponent(currentSuffix)}/subdomain`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_suffix: newSuffix })
  });
  if (!d) return;
  if (d.ok) {
    showToast('子域名已更新');
    setTimeout(loadTunnelPage, 2000);
  } else {
    showToast(d.error || '更新失败');
  }
}

// expose for inline onclick
Object.assign(window, {
  switchTunnelTab,
  _selectTunnelMode,
  _tunnelCfgValidate, _tunnelSave,
  _tunnelTeardown, _tunnelRestart, _tunnelStop, _tunnelStart,
  _tunnelPublicEnable, _tunnelPublicDisable, _tunnelDisable,
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

function _startLogStream() {
  _stopLogStream();
  const el = document.getElementById('tunnel-log-content');
  if (!el) return;
  _tunnelLogStream = createLogStream({
    el,
    historyUrl: '/api/tunnel/logs?lines=200',
    streamUrl: '/api/tunnel/logs/stream',
    classify(line) {
      if (/error|ERR|exception/i.test(line)) return 'log-error';
      if (/warn/i.test(line)) return 'log-warn';
      if (/connection|register|route|ingress/i.test(line)) return 'log-info';
      return '';
    },
  });
  _tunnelLogStream.start();
}
function _stopLogStream() {
  if (_tunnelLogStream) { _tunnelLogStream.stop(); _tunnelLogStream = null; }
}
