/**
 * ComfyCarry — page-comfyui.js
 * ComfyUI 页面模块: 状态监控、参数管理、日志流、实时事件
 */

import { registerPage, fmtBytes, fmtPct, showToast, escHtml } from './core.js';

// ── 模块状态 ──────────────────────────────────────────────────

let comfyAutoRefresh = null;
let _comfyParamsSchema = null;
let _comfyEventSource = null;
let _comfyLogSource = null;
let _comfyExecState = null;   // Current execution state
let _comfyExecTimer = null;   // Timer for elapsed counter

// ── 页面入口 ──────────────────────────────────────────────────

async function loadComfyUIPage() {
  await Promise.all([loadComfyStatus(), loadComfyQueue(), loadComfyParams()]);
  startComfyEventStream();
  startComfyLogStream();
}

// ── SSE: ComfyUI real-time events ─────────────────────────────

function startComfyEventStream() {
  // Guard: only start if ComfyUI page is active
  const page = document.getElementById('page-comfyui');
  if (!page || page.classList.contains('hidden')) return;
  stopComfyEventStream();
  _comfyEventSource = new EventSource('/api/comfyui/events');
  _comfyEventSource.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data);
      handleComfyEvent(evt);
    } catch (_) {}
  };
  _comfyEventSource.onerror = () => {
    // Will auto-reconnect by default
  };
}

function stopComfyEventStream() {
  if (_comfyEventSource) { _comfyEventSource.close(); _comfyEventSource = null; }
}

function handleComfyEvent(evt) {
  const t = evt.type;
  const d = evt.data || {};

  if (t === 'status') {
    // Update queue display from WS status
    const qInfo = d.status || {};
    const qr = qInfo.exec_info || {};
    const qRemain = qr.queue_remaining || 0;
    const el = document.getElementById('comfyui-queue-info');
    if (el) {
      if (qRemain > 0) {
        el.innerHTML = `<span style="color:var(--green)">▶ 正在执行 (队列: ${qRemain})</span>`;
      } else if (!_comfyExecState) {
        el.innerHTML = '<span style="color:var(--t3)">空闲 — 无任务</span>';
      }
    }
  }

  else if (t === 'execution_start') {
    _comfyExecState = { start_time: d.start_time || (Date.now() / 1000) };
    _updateExecBar();
    // Start elapsed timer
    if (_comfyExecTimer) clearInterval(_comfyExecTimer);
    _comfyExecTimer = setInterval(_updateExecBar, 1000);
  }

  else if (t === 'progress') {
    if (_comfyExecState) {
      _comfyExecState.progress = d;
    }
    _updateExecBar();
  }

  else if (t === 'execution_done') {
    const elapsed = d.elapsed ? `${d.elapsed}s` : '';
    _comfyExecState = null;
    if (_comfyExecTimer) { clearInterval(_comfyExecTimer); _comfyExecTimer = null; }
    _updateExecBar();
    if (elapsed) showToast(`✅ 生成完成 (${elapsed})`);
    loadComfyStatus();
    loadComfyQueue();
  }

  else if (t === 'execution_error') {
    _comfyExecState = null;
    if (_comfyExecTimer) { clearInterval(_comfyExecTimer); _comfyExecTimer = null; }
    _updateExecBar();
    const errEl = document.getElementById('comfyui-exec-bar');
    if (errEl) {
      errEl.innerHTML = `<div class="comfy-exec-error">❌ 执行出错: ${escHtml(d.exception_message || d.node_type || '未知错误')}</div>`;
      errEl.classList.remove('hidden');
      setTimeout(() => errEl.classList.add('hidden'), 8000);
    }
  }

  else if (t === 'monitor') {
    // Crystools real-time GPU/CPU monitor data
    _updateMonitorData(d);
  }
}

function _updateMonitorData(d) {
  // Update GPU stats in real-time from crystools.monitor
  const gpuCards = document.querySelectorAll('#comfyui-status-cards .stat-card.cyan');
  if (!gpuCards.length) return;
  // Crystools sends gpus array
  const gpus = d.gpus || [];
  gpus.forEach((gpu, i) => {
    if (!gpuCards[i]) return;
    const vramPct = gpu.gpu_utilization || 0;
    const vramUsed = gpu.vram_used || 0;
    const vramTotal = gpu.vram_total || 1;
    const usedPct = (vramUsed / vramTotal * 100);
    const bar = gpuCards[i].querySelector('.comfy-vram-bar .fill');
    const label = gpuCards[i].querySelector('.comfy-vram-bar .label');
    const valEl = gpuCards[i].querySelector('.stat-value');
    if (bar) bar.style.width = usedPct.toFixed(0) + '%';
    if (label) label.textContent = `${fmtBytes(vramUsed)} / ${fmtBytes(vramTotal)}`;
    if (valEl) valEl.textContent = usedPct.toFixed(0) + '%';
  });
}

// Parse log lines for step progress (e.g., "KSampler STEPS: 5/20", "10%|███")
function _parseLogProgress(line) {
  // Pattern 1: "XX%|" (tqdm-style progress)
  let m = line.match(/\b(\d{1,3})%\|/);
  if (m) return { percent: parseInt(m[1]) };
  // Pattern 2: "N/M" step counter in sampler logs
  m = line.match(/\b(\d+)\/(\d+)\b.*(?:step|sample|it)/i);
  if (m) {
    const val = parseInt(m[1]), max = parseInt(m[2]);
    if (max > 1 && val <= max) return { value: val, max, percent: Math.round(val / max * 100) };
  }
  // Pattern 3: "Prompt executed in X.XX seconds"
  m = line.match(/Prompt executed in ([\d.]+) seconds/i);
  if (m) return { done: true, elapsed: parseFloat(m[1]) };
  return null;
}

function _updateExecBar() {
  const bar = document.getElementById('comfyui-exec-bar');
  if (!bar) return;

  if (!_comfyExecState) {
    bar.classList.add('hidden');
    return;
  }

  bar.classList.remove('hidden');
  const st = _comfyExecState;
  const elapsed = Math.round(Date.now() / 1000 - st.start_time);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  let html = `<div class="comfy-exec-status">`;
  html += `<span class="comfy-exec-pulse"></span>`;
  html += `<span>⚡ 正在生成</span>`;
  html += `<span style="color:var(--t3);margin-left:auto">${timeStr}</span>`;
  html += `</div>`;

  // Progress bar (from log parsing or WS)
  if (st.progress && st.progress.percent != null) {
    const pct = st.progress.percent;
    const detail = st.progress.value != null ? `${st.progress.value}/${st.progress.max}` : '';
    html += `<div class="comfy-exec-progress">
      <div class="comfy-exec-progress-fill" style="width:${pct}%"></div>
      <span class="comfy-exec-progress-text">${detail ? detail + ' ' : ''}(${pct}%)</span>
    </div>`;
  }

  bar.innerHTML = html;
}

// ── SSE: Real-time log stream ─────────────────────────────────

function startComfyLogStream() {
  // Guard: only start if ComfyUI page is active
  const page = document.getElementById('page-comfyui');
  if (!page || page.classList.contains('hidden')) return;
  stopComfyLogStream();
  const el = document.getElementById('comfyui-log-content');
  if (!el) return;

  // Load initial logs first
  fetch('/api/logs/comfy?lines=200').then(r => r.json()).then(d => {
    if (d.logs) {
      const lines = d.logs.split('\n').filter(l => l.trim());
      el.innerHTML = lines.map(l => {
        let cls = '';
        if (/error|exception|traceback/i.test(l)) cls = 'log-error';
        else if (/warn/i.test(l)) cls = 'log-warn';
        else if (/loaded|model|checkpoint|lora/i.test(l)) cls = 'log-info';
        return `<div class="${cls}">${escHtml(l)}</div>`;
      }).join('');
      el.scrollTop = el.scrollHeight;
    }
  }).catch(() => {});

  // Then start SSE for new lines
  _comfyLogSource = new EventSource('/api/comfyui/logs/stream');
  _comfyLogSource.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data);
      const div = document.createElement('div');
      div.textContent = d.line;
      if (d.level === 'error') div.className = 'log-error';
      else if (d.level === 'warn') div.className = 'log-warn';

      // Check for progress in log lines
      const prog = _parseLogProgress(d.line);
      if (prog && !prog.done && _comfyExecState) {
        _comfyExecState.progress = prog;
        _updateExecBar();
      }

      // Auto-scroll if near bottom
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      el.appendChild(div);
      // Limit lines to 500
      while (el.children.length > 500) el.removeChild(el.firstChild);
      if (nearBottom) el.scrollTop = el.scrollHeight;
    } catch (_) {}
  };
}

function stopComfyLogStream() {
  if (_comfyLogSource) { _comfyLogSource.close(); _comfyLogSource = null; }
}

// ── 状态 & 队列 ──────────────────────────────────────────────

async function loadComfyStatus() {
  const el = document.getElementById('comfyui-status-cards');
  try {
    const r = await fetch('/api/comfyui/status');
    const d = await r.json();
    let html = '';

    // Online status
    const online = d.online;
    const sys = d.system || {};
    const pm2St = d.pm2_status || 'unknown';
    const stColor = online ? 'var(--green)' : 'var(--red, #e74c3c)';
    const stLabel = online ? '运行中' : '已停止';

    // Status card
    html += `<div class="stat-card" style="border-left:3px solid ${stColor}">
      <div class="stat-label">ComfyUI</div>
      <div class="stat-value" style="font-size:1rem;color:${stColor}">${stLabel}</div>
      <div class="stat-sub">${online ? `v${sys.comfyui_version || '?'} • Python ${sys.python_version || '?'} • PyTorch ${sys.pytorch_version || '?'}` : `PM2: ${pm2St}`}</div>
    </div>`;

    // GPU/VRAM cards
    if (d.devices && d.devices.length > 0) {
      for (const gpu of d.devices) {
        const vramUsed = gpu.vram_total - gpu.vram_free;
        const vramPct = gpu.vram_total > 0 ? (vramUsed / gpu.vram_total * 100) : 0;
        const torchUsed = gpu.torch_vram_total - gpu.torch_vram_free;
        html += `<div class="stat-card cyan">
          <div class="stat-label">${gpu.name || 'GPU'}</div>
          <div class="stat-value">${vramPct.toFixed(0)}%</div>
          <div class="stat-sub">VRAM: ${fmtBytes(vramUsed)} / ${fmtBytes(gpu.vram_total)} • Torch: ${fmtBytes(torchUsed)}</div>
          <div class="comfy-vram-bar"><div class="fill" style="width:${vramPct}%;background:${vramPct > 90 ? 'var(--red,#e74c3c)' : vramPct > 70 ? 'var(--amber)' : 'var(--cyan)'}"></div>
            <div class="label">${fmtBytes(vramUsed)} / ${fmtBytes(gpu.vram_total)}</div></div>
        </div>`;
      }
    }

    // Uptime / restarts
    if (d.pm2_uptime) {
      const up = Date.now() - d.pm2_uptime;
      const hrs = Math.floor(up / 3600000);
      const mins = Math.floor((up % 3600000) / 60000);
      html += `<div class="stat-card green">
        <div class="stat-label">运行时间</div>
        <div class="stat-value" style="font-size:1rem">${hrs}h ${mins}m</div>
        <div class="stat-sub">重启次数: ${d.pm2_restarts || 0}</div>
      </div>`;
    }

    // Current args
    const argsRaw = document.getElementById('comfyui-args-raw');
    if (argsRaw) argsRaw.value = d.args ? d.args.join(' ') : '';

    el.innerHTML = html || '<div style="color:var(--t3);padding:16px">无法获取状态</div>';
  } catch (e) {
    el.innerHTML = `<div class="error-msg">加载失败: ${e.message}</div>`;
  }
}

async function loadComfyQueue() {
  const el = document.getElementById('comfyui-queue-info');
  try {
    const r = await fetch('/api/comfyui/queue');
    const d = await r.json();
    const running = d.queue_running || [];
    const pending = d.queue_pending || [];

    if (running.length === 0 && pending.length === 0) {
      el.innerHTML = '<span style="color:var(--t3)">空闲 — 无任务</span>';
    } else {
      let html = '';
      if (running.length > 0) html += `<span style="color:var(--green)">▶ 正在执行 ${running.length} 个任务</span>`;
      if (pending.length > 0) html += `<span style="margin-left:12px;color:var(--amber)">⏳ 等待中 ${pending.length} 个</span>`;
      el.innerHTML = html;
    }
  } catch (e) {
    el.innerHTML = `<span style="color:var(--red,#e74c3c)">队列获取失败</span>`;
  }
}

// ── 参数管理 ──────────────────────────────────────────────────

async function loadComfyParams() {
  const el = document.getElementById('comfyui-params-form');
  try {
    const r = await fetch('/api/comfyui/params');
    const d = await r.json();
    _comfyParamsSchema = d.schema;
    const current = d.current || {};

    let html = '';
    for (const [key, schema] of Object.entries(d.schema)) {
      // Skip if depends_on not met
      if (schema.depends_on) {
        const depMet = Object.entries(schema.depends_on).every(([dk, dv]) => current[dk] === dv);
        if (!depMet) continue;
      }

      const helpIcon = schema.help ? ` <span class="comfy-param-help-icon" data-tip="${escHtml(schema.help)}">?</span>` : '';

      html += `<div class="comfy-param-group">`;
      if (schema.type === 'select') {
        html += `<label>${escHtml(schema.label)}${helpIcon}</label>`;
        html += `<select id="cparam-${key}" data-param="${key}">`;
        for (const [val, label] of schema.options) {
          html += `<option value="${val}" ${val === String(schema.value) || val === schema.value ? 'selected' : ''}>${escHtml(label)}</option>`;
        }
        html += '</select>';
      } else if (schema.type === 'bool') {
        html += `<label>${escHtml(schema.label)}${helpIcon}</label>`;
        html += `<label class="comfy-param-toggle">
          <input type="checkbox" id="cparam-${key}" data-param="${key}" ${schema.value ? 'checked' : ''}>
          <span class="comfy-toggle-slider"></span>
        </label>`;
      } else if (schema.type === 'number') {
        html += `<label>${escHtml(schema.label)}${helpIcon}</label>`;
        html += `<input type="number" id="cparam-${key}" data-param="${key}" value="${schema.value || 0}" min="0" max="100">`;
      }
      html += '</div>';
    }
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = `<div class="error-msg">加载参数失败: ${e.message}</div>`;
  }
}

function _collectComfyParams() {
  const params = {};
  document.querySelectorAll('#comfyui-params-form [data-param]').forEach(el => {
    const key = el.dataset.param;
    if (el.type === 'checkbox') params[key] = el.checked;
    else if (el.type === 'number') params[key] = parseInt(el.value) || 0;
    else params[key] = el.value;
  });
  // Always ensure listen + port
  if (!params.listen) params.listen = '0.0.0.0';
  if (!params.port) params.port = 8188;
  return params;
}

async function saveComfyUIParams() {
  const status = document.getElementById('comfyui-params-status');
  const params = _collectComfyParams();

  // Extract extra args from the raw input that aren't covered by schema
  const rawInput = document.getElementById('comfyui-args-raw')?.value || '';
  const knownFlags = new Set();
  if (_comfyParamsSchema) {
    for (const [, schema] of Object.entries(_comfyParamsSchema)) {
      if (schema.flag) knownFlags.add(schema.flag);
      if (schema.flag_map) Object.values(schema.flag_map).forEach(f => knownFlags.add(f));
      if (schema.flag_prefix) knownFlags.add(schema.flag_prefix);
    }
  }
  knownFlags.add('--listen'); knownFlags.add('--port');
  // Parse raw input to find extra flags not in schema
  const rawParts = rawInput.replace(/^main\.py\s*/, '').split(/\s+/).filter(Boolean);
  const extraParts = [];
  let i = 0;
  while (i < rawParts.length) {
    if (knownFlags.has(rawParts[i])) {
      i++; // skip known flag
      if (i < rawParts.length && !rawParts[i].startsWith('--')) i++; // skip its value
    } else {
      extraParts.push(rawParts[i]);
      i++;
    }
  }
  const extraArgs = extraParts.join(' ');

  if (!confirm('保存参数将重启 ComfyUI，确定继续？')) return;

  status.textContent = '保存中...';
  status.style.color = 'var(--amber)';
  try {
    const r = await fetch('/api/comfyui/params', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params, extra_args: extraArgs })
    });
    const d = await r.json();
    if (d.ok) {
      status.textContent = '✅ 已保存，ComfyUI 正在重启...';
      status.style.color = 'var(--green)';
      showToast('ComfyUI 正在使用新参数重启...');
      setTimeout(() => { status.textContent = ''; loadComfyUIPage(); }, 5000);
    } else {
      status.textContent = '❌ ' + (d.error || '保存失败');
      status.style.color = 'var(--red, #e74c3c)';
    }
  } catch (e) {
    status.textContent = '❌ 请求失败: ' + e.message;
    status.style.color = 'var(--red, #e74c3c)';
  }
}

// ── 操作按钮 ──────────────────────────────────────────────────

async function restartComfyUI() {
  if (!confirm('确定要重启 ComfyUI 吗？')) return;
  try {
    await fetch('/api/services/comfy/restart', { method: 'POST' });
    showToast('ComfyUI 正在重启...');
    setTimeout(loadComfyUIPage, 5000);
  } catch (e) { showToast('重启失败: ' + e.message); }
}

async function comfyInterrupt() {
  try {
    await fetch('/api/comfyui/interrupt', { method: 'POST' });
    showToast('已发送中断信号');
    setTimeout(loadComfyQueue, 1000);
  } catch (e) { showToast('中断失败: ' + e.message); }
}

async function comfyFreeVRAM() {
  try {
    await fetch('/api/comfyui/free', { method: 'POST' });
    showToast('🧹 已释放 VRAM');
    setTimeout(loadComfyStatus, 2000);
  } catch (e) { showToast('释放失败: ' + e.message); }
}

// ── 自动刷新 ──────────────────────────────────────────────────

function startComfyAutoRefresh() {
  stopComfyAutoRefresh();
  comfyAutoRefresh = setInterval(() => {
    loadComfyStatus();
    loadComfyQueue();
  }, 10000);
}

function stopComfyAutoRefresh() {
  if (comfyAutoRefresh) { clearInterval(comfyAutoRefresh); comfyAutoRefresh = null; }
  if (_comfyExecTimer) { clearInterval(_comfyExecTimer); _comfyExecTimer = null; }
  stopComfyEventStream();
  stopComfyLogStream();
}

// ── 页面生命周期注册 ──────────────────────────────────────────

registerPage('comfyui', {
  enter() { loadComfyUIPage(); startComfyAutoRefresh(); },
  leave() { stopComfyAutoRefresh(); stopComfyEventStream(); stopComfyLogStream(); }
});

// ── Window exports (供 HTML onclick 调用) ─────────────────────

window.loadComfyStatus = loadComfyStatus;
window.loadComfyQueue = loadComfyQueue;
window.loadComfyParams = loadComfyParams;
window.saveComfyUIParams = saveComfyUIParams;
window.comfyInterrupt = comfyInterrupt;
window.comfyFreeVRAM = comfyFreeVRAM;
window.restartComfyUI = restartComfyUI;
