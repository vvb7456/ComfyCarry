/**
 * ComfyCarry — page-dashboard.js
 * 总览页: 一屏呈现实例全貌
 *
 * 区域:
 * 1. 快速访问栏 (Tunnel Links)
 * 2. 实例状态栏 (Status Bar)
 * 3. 硬件指标卡片 (GPU/CPU/Memory/Disk)
 * 4. 活动面板 (Activity Feed)
 * 5. 服务管理表格 (PM2 Services)
 * 6. 环境信息栏 (Environment Info)
 */

import { registerPage, fmtBytes, fmtPct, fmtUptime, fmtDuration, showToast, escHtml, msIcon } from './core.js';
import { createExecTracker, renderProgressBar } from './comfyui-progress.js';

let _refreshTimer = null;
let _sseSource = null;
let _cachedData = null;

// ── 页面生命周期 ─────────────────────────────────────────────

registerPage('dashboard', {
  enter() {
    refreshOverview();
    _refreshTimer = setInterval(refreshOverview, 5000);
    _startSSE();
  },
  leave() {
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
    _stopSSE();
  }
});

// ── SSE: ComfyUI 实时事件（用于活动面板进度更新）─────────────

function _startSSE() {
  _stopSSE();
  try {
    _sseSource = new EventSource('/api/comfyui/events');
    _sseSource.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        _execTracker.handleEvent(evt);
      } catch (_) {}
    };
  } catch (_) {}
}

function _stopSSE() {
  if (_sseSource) { _sseSource.close(); _sseSource = null; }
}

// Shared execution tracker — drives activity feed progress bar
const _execTracker = createExecTracker({ onUpdate: _updateActivity });

// ── 主刷新函数 ──────────────────────────────────────────────

async function refreshOverview() {
  try {
    const r = await fetch('/api/overview');
    if (!r.ok) return;
    const data = await r.json();
    _cachedData = data;

    _renderQuickLinks(data.tunnel);
    _renderStatusBar(data);
    _renderMetrics(data.system);
    _renderActivity(data);
    _renderServices(data.services);
    _renderEnvInfo(data);
  } catch (e) {
    const el = document.getElementById('overview-status-bar');
    if (el) el.innerHTML = `<span class="status-badge red">${msIcon('warning','ms-sm')} 后端连接失败: ${escHtml(e.message)}</span>`;
  }
}

// ── 1. 快速访问栏 ───────────────────────────────────────────

function _renderQuickLinks(tunnel) {
  const el = document.getElementById('overview-quick-links');
  if (!el) return;

  // 合并自定义和公共两种模式的 URL
  let urls = tunnel?.urls || {};
  const publicUrls = tunnel?.public?.urls || {};
  if (Object.keys(urls).length === 0 && Object.keys(publicUrls).length > 0) {
    urls = publicUrls;
  }

  const tunnelOnline = tunnel?.pm2_status === 'online' || tunnel?.cloudflared === 'online' || tunnel?.status === 'healthy';

  // 过滤掉 ComfyCarry 自身(dashboard)和 SSH，只显示可点击链接
  const entries = Object.entries(urls).filter(([name]) =>
    !/comfycarry/i.test(name) && !/ssh/i.test(name) && !/dashboard/i.test(name)
  );

  if (entries.length === 0) {
    el.innerHTML = `<div class="quick-links-empty">${tunnelOnline ? `${msIcon('language','ms-sm')} Tunnel 已连接` : tunnel?.configured ? `${msIcon('language','ms-sm')} Tunnel 离线` : `${msIcon('language','ms-sm')} Tunnel 未配置`}</div>`;
    return;
  }

  // 映射公共模式 key → 显示名
  const nameMap = { comfyui: 'ComfyUI', jupyter: 'JupyterLab', ComfyUI: 'ComfyUI', JupyterLab: 'JupyterLab' };
  const icons = { comfyui: msIcon('palette','ms-sm'), jupyter: msIcon('book_2','ms-sm'), ComfyUI: msIcon('palette','ms-sm'), JupyterLab: msIcon('book_2','ms-sm') };
  el.innerHTML = entries.map(([name, url]) =>
    `<a href="${escHtml(url)}" target="_blank" class="quick-link-btn">
      <span class="quick-link-icon">${icons[name] || msIcon('link','ms-sm')}</span>
      <span class="quick-link-name">${escHtml(nameMap[name] || name)}</span>
    </a>`
  ).join('');
}

// ── 2. 实例状态栏 ───────────────────────────────────────────

function _renderStatusBar(data) {
  const el = document.getElementById('overview-status-bar');
  if (!el) return;

  const comfy = data.comfyui || {};
  const sync = data.sync || {};
  const tunnel = data.tunnel || {};

  let html = '';

  // ComfyUI status
  if (comfy.online) {
    const ver = comfy.version ? ` v${comfy.version}` : '';
    html += `<span class="status-badge green"><span class="status-dot online"></span> ComfyUI${ver} 在线</span>`;
  } else if (comfy.pm2_status === 'online') {
    html += `<span class="status-badge amber"><span class="status-dot pending"></span> ComfyUI 启动中</span>`;
  } else {
    html += `<span class="status-badge red"><span class="status-dot offline"></span> ComfyUI 离线</span>`;
  }

  // Uptime
  if (comfy.pm2_uptime) {
    html += `<span class="status-badge muted">${msIcon('timer')} ${fmtUptime(comfy.pm2_uptime)}</span>`;
  }

  // Queue
  const qr = comfy.queue_running || 0;
  const qp = comfy.queue_pending || 0;
  if (qr > 0 || qp > 0) {
    const total = qr + qp;
    const color = total > 5 ? 'red' : 'amber';
    html += `<span class="status-badge ${color}">${msIcon('assignment')} 队列: ${qr} 运行 / ${qp} 等待</span>`;
  } else if (comfy.online) {
    html += `<span class="status-badge muted">${msIcon('assignment')} 队列空闲</span>`;
  }

  // Sync
  if (sync.worker_running) {
    html += `<span class="status-badge green">${msIcon('cloud_sync','ms-sm')} Sync 运行中</span>`;
  } else if (sync.rules_count > 0) {
    html += `<span class="status-badge muted">${msIcon('cloud_sync','ms-sm')} Sync 未启动</span>`;
  }

  // Tunnel (使用后端统一的 effective_status)
  const tst = tunnel.effective_status || 'unconfigured';
  if (tst === 'online') {
    html += `<span class="status-badge green">${msIcon('language','ms-sm')} Tunnel 在线</span>`;
  } else if (tst === 'connecting' || tst === 'degraded') {
    html += `<span class="status-badge amber">${msIcon('language','ms-sm')} Tunnel 连接中</span>`;
  } else if (tst === 'offline') {
    html += `<span class="status-badge red">${msIcon('language','ms-sm')} Tunnel 离线</span>`;
  } else {
    html += `<span class="status-badge muted">${msIcon('language','ms-sm')} Tunnel 未配置</span>`;
  }

  el.innerHTML = html;
}

// ── 3. 硬件指标卡片 ─────────────────────────────────────────

function _renderMetrics(sys) {
  const el = document.getElementById('overview-metrics');
  if (!el || !sys) return;

  let html = '';

  // GPU + VRAM (merged)
  if (sys.gpu && sys.gpu.length > 0) {
    for (const g of sys.gpu) {
      const vramPct = g.mem_total > 0 ? (g.mem_used / g.mem_total * 100) : 0;
      const vramColor = vramPct > 85 ? 'var(--red)' : vramPct > 60 ? 'var(--amber)' : 'var(--green)';
      const tempColor = g.temp > 85 ? 'var(--red)' : g.temp > 70 ? 'var(--amber)' : 'var(--t3)';
      html += `<div class="metric-card">
        <div class="metric-header">
          <span class="metric-icon">${msIcon('memory','ms-sm')}</span>
          <span class="metric-label">${escHtml(g.name)}</span>
        </div>
        <div class="metric-main">
          <span class="metric-value">${g.util}%</span>
          <span class="metric-unit">GPU</span>
        </div>
        <div class="metric-bar">
          <div class="metric-bar-fill" style="width:${vramPct.toFixed(0)}%;background:${vramColor}"></div>
        </div>
        <div class="metric-details">
          <span>VRAM ${g.mem_used}MB / ${g.mem_total}MB</span>
          <span style="color:${tempColor}">${g.temp}°C</span>
          ${g.power ? `<span>${g.power.toFixed(0)}W / ${g.power_limit ? g.power_limit.toFixed(0) + 'W' : '-'}</span>` : ''}
        </div>
      </div>`;
    }
  }

  // CPU
  const cpu = sys.cpu || {};
  const cpuPct = cpu.percent || 0;
  const cpuColor = cpuPct > 85 ? 'var(--red)' : cpuPct > 60 ? 'var(--amber)' : 'var(--ac)';
  html += `<div class="metric-card">
    <div class="metric-header">
      <span class="metric-icon">${msIcon('developer_board','ms-sm')}</span>
      <span class="metric-label">CPU</span>
    </div>
    <div class="metric-main">
      <span class="metric-value">${fmtPct(cpuPct)}</span>
      <span class="metric-unit">${cpu.cores || '?'} cores</span>
    </div>
    <div class="metric-bar">
      <div class="metric-bar-fill" style="width:${cpuPct}%;background:${cpuColor}"></div>
    </div>
    <div class="metric-details">
      <span>Load ${cpu.load ? (cpu.load['1m'] || 0).toFixed(1) : '?'}</span>
    </div>
  </div>`;

  // Memory
  const mem = sys.memory || {};
  const memPct = mem.percent || 0;
  const memColor = memPct > 85 ? 'var(--red)' : memPct > 60 ? 'var(--amber)' : 'var(--green)';
  html += `<div class="metric-card">
    <div class="metric-header">
      <span class="metric-icon">${msIcon('memory','ms-sm')}</span>
      <span class="metric-label">内存</span>
    </div>
    <div class="metric-main">
      <span class="metric-value">${fmtPct(memPct)}</span>
      <span class="metric-unit">${fmtBytes(mem.total || 0)}</span>
    </div>
    <div class="metric-bar">
      <div class="metric-bar-fill" style="width:${memPct}%;background:${memColor}"></div>
    </div>
    <div class="metric-details">
      <span>${fmtBytes(mem.used || 0)} / ${fmtBytes(mem.total || 0)}</span>
    </div>
  </div>`;

  // Disk
  const disk = sys.disk || {};
  const diskPct = disk.percent || 0;
  const diskColor = diskPct > 85 ? 'var(--red)' : diskPct > 60 ? 'var(--amber)' : 'var(--green)';
  html += `<div class="metric-card">
    <div class="metric-header">
      <span class="metric-icon">${msIcon('hard_drive_2','ms-sm')}</span>
      <span class="metric-label">磁盘 ${escHtml(disk.path || '')}</span>
    </div>
    <div class="metric-main">
      <span class="metric-value">${fmtPct(diskPct)}</span>
      <span class="metric-unit">${fmtBytes(disk.free || 0)} 可用</span>
    </div>
    <div class="metric-bar">
      <div class="metric-bar-fill" style="width:${diskPct}%;background:${diskColor}"></div>
    </div>
    <div class="metric-details">
      <span>${fmtBytes(disk.used || 0)} / ${fmtBytes(disk.total || 0)}</span>
    </div>
  </div>`;

  el.innerHTML = html;
}

// ── 4. 活动面板 ─────────────────────────────────────────────

function _updateActivity() {
  _renderActivity(_cachedData);
}

function _renderActivity(data) {
  const el = document.getElementById('overview-activity');
  if (!el) return;

  const items = [];

  // ComfyUI execution from SSE
  const _execState = _execTracker.getState();
  if (_execState) {
    items.push({
      icon: 'play_arrow',
      html: renderProgressBar(_execState, 'margin-top:6px;font-size:.72rem'),
      class: 'activity-executing'
    });
  }

  // Downloads
  if (data?.downloads) {
    const dl = data.downloads;
    if (dl.active_count > 0) {
      for (const d of (dl.active || [])) {
        const pct = (d.progress || 0).toFixed(1);
        const name = d.filename || d.model_name || '下载中...';
        items.push({
          icon: msIcon('download','ms-sm'),
          html: `<div class="activity-text">
            <span>${escHtml(name)}</span>
            <span class="activity-meta">${pct}%${d.speed ? ' • ' + d.speed : ''}</span>
          </div>
          <div class="activity-progress">
            <div class="activity-progress-fill" style="width:${pct}%"></div>
          </div>`,
          class: 'activity-download'
        });
      }
      if (dl.queue_count > 0) {
        items.push({
          icon: msIcon('queue','ms-sm'),
          html: `<div class="activity-text"><span>${dl.queue_count} 个下载等待中</span></div>`,
          class: ''
        });
      }
    }
  }

  // Sync activity
  if (data?.sync) {
    const sync = data.sync;
    if (sync.worker_running && sync.watch_rules > 0) {
      items.push({
        icon: msIcon('cloud','ms-sm'),
        html: `<div class="activity-text">
          <span>Sync Worker 监控中 (${sync.watch_rules} 条规则)</span>
        </div>`,
        class: ''
      });
    }
    // Last log line as activity indicator
    if (sync.last_log_lines?.length > 0) {
      const last = sync.last_log_lines[sync.last_log_lines.length - 1];
      items.push({
        icon: msIcon('brush','ms-sm'),
        html: `<div class="activity-text"><span class="activity-log-line">${escHtml(last)}</span></div>`,
        class: 'activity-log'
      });
    }
  }

  // Empty state
  if (items.length === 0) {
    el.innerHTML = `<div class="activity-empty">${msIcon('check_circle','ms-sm')} 一切就绪，等待任务</div>`;
    return;
  }

  el.innerHTML = items.map(item =>
    `<div class="activity-item ${item.class || ''}">
      <div class="activity-icon">${item.icon}</div>
      <div class="activity-content">${item.html}</div>
    </div>`
  ).join('');
}

// ── 5. 服务管理 ─────────────────────────────────────────────

function _renderServices(svcData) {
  const el = document.getElementById('overview-svc-tbody');
  if (!el) return;

  const services = svcData?.services || [];
  if (!services.length) {
    el.innerHTML = '<tr><td colspan="7" class="svc-empty">未发现服务</td></tr>';
    return;
  }

  el.innerHTML = services.map(s => {
    const st = s.status || 'unknown';
    const dotClass = st === 'online' ? 'online' : st === 'stopped' ? 'stopped' : 'errored';
    return `<tr>
      <td><strong>${escHtml(s.name)}</strong></td>
      <td><span class="svc-status"><span class="svc-dot ${dotClass}"></span>${st}</span></td>
      <td>${fmtUptime(s.uptime)}</td>
      <td>${(s.cpu || 0).toFixed(1)}%</td>
      <td>${fmtBytes(s.memory || 0)}</td>
      <td>${s.restarts || 0}</td>
      <td><div class="btn-group">
        <button class="btn btn-sm btn-success" onclick="window._svcAction('${escHtml(s.name)}','start')">${msIcon('play_arrow')}</button>
        <button class="btn btn-sm btn-danger" onclick="window._svcAction('${escHtml(s.name)}','stop')">${msIcon('stop')}</button>
        <button class="btn btn-sm" onclick="window._svcAction('${escHtml(s.name)}','restart')">${msIcon('refresh')}</button>
      </div></td>
    </tr>`;
  }).join('');
}

// 暴露到 window，供 onclick 调用
window._svcAction = async function(name, action) {
  try {
    await fetch(`/api/services/${name}/${action}`, { method: 'POST' });
    showToast(`${action} ${name} 完成`);
    setTimeout(refreshOverview, 1000);
  } catch (e) { showToast('操作失败: ' + e.message); }
};

// ── 6. 环境信息 ─────────────────────────────────────────────

function _renderEnvInfo(data) {
  const el = document.getElementById('overview-env-info');
  if (!el) return;

  const comfy = data.comfyui || {};
  const sys = data.system || {};
  const ver = data.version || {};
  const gpu = sys.gpu?.[0];

  const tags = [];
  if (comfy.version) tags.push(`ComfyUI ${comfy.version}`);
  if (comfy.pytorch_version) tags.push(`PyTorch ${comfy.pytorch_version}`);
  if (comfy.python_version) {
    const pyVer = comfy.python_version.split(' ')[0];
    tags.push(`Python ${pyVer}`);
  }
  if (gpu) tags.push(`${gpu.name} ${gpu.mem_total}MB`);
  if (sys.cpu?.cores) tags.push(`${sys.cpu.cores} CPU cores`);
  if (sys.memory?.total) tags.push(`${fmtBytes(sys.memory.total)} RAM`);
  if (ver.version) tags.push(`ComfyCarry ${ver.version}`);

  el.innerHTML = tags.map(t => `<span class="env-tag">${escHtml(t)}</span>`).join('');
}
