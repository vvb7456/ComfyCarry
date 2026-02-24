/**
 * ComfyCarry — page-comfyui.js
 * ComfyUI 页面模块: 状态监控、参数管理、日志流、实时事件
 */

import { registerPage, fmtBytes, fmtPct, showToast, escHtml, renderError, renderEmpty } from './core.js';
import { createLogStream } from './sse-log.js';

// ── 模块状态 ──────────────────────────────────────────────────

let comfyAutoRefresh = null;
let _comfyParamsSchema = null;
let _comfyEventSource = null;
let _comfyLogStream = null;
let _comfyExecState = null;   // Current execution state
let _comfyExecTimer = null;   // Timer for elapsed counter

// ── 页面入口 ──────────────────────────────────────────────────

async function loadComfyUIPage() {
  await Promise.all([loadComfyStatus(), loadComfyParams()]);
  startComfyEventStream();
  startComfyLogStream();
  _currentComfyTab = 'console';
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
    if (_currentComfyTab === 'queue') loadQueuePanel();
  }

  else if (t === 'execution_start') {
    const nodeNames = d.node_names || {};
    _comfyExecState = {
      start_time: d.start_time || (Date.now() / 1000),
      prompt_id: d.prompt_id,
      current_node: null,
      node_names: nodeNames,
      total_nodes: Object.keys(nodeNames).length,
      executed_nodes: new Set(),
      cached_nodes: new Set(),
      progress: null,
    };
    // If backend couldn't fetch node names (timing issue), fetch from frontend
    if (_comfyExecState.total_nodes === 0 && d.prompt_id) {
      _fetchAndFillNodeNames(d.prompt_id, _comfyExecState);
    }
    _updateAllBars();
    _startExecTimer();
  }

  // 页面刷新后 SSE 重连时收到的完整执行快照
  else if (t === 'execution_snapshot') {
    const nodeNames = d.node_names || {};
    _comfyExecState = {
      start_time: d.start_time || (Date.now() / 1000),
      prompt_id: d.prompt_id,
      current_node: d.current_node || null,
      node_names: nodeNames,
      total_nodes: Object.keys(nodeNames).length,
      executed_nodes: new Set(d.executed_nodes || []),
      cached_nodes: new Set(d.cached_nodes || []),
      progress: null,
    };
    if (_comfyExecState.total_nodes === 0 && d.prompt_id) {
      _fetchAndFillNodeNames(d.prompt_id, _comfyExecState);
    }
    _updateAllBars();
    _startExecTimer();
  }

  else if (t === 'progress') {
    if (_comfyExecState) _comfyExecState.progress = d;
    _updateAllBars();
  }

  else if (t === 'executing') {
    if (_comfyExecState && d.node) {
      _comfyExecState.current_node = d.node;
      _comfyExecState.executed_nodes.add(d.node);
      if (d.class_type) _comfyExecState.node_names[d.node] = d.class_type;
      _comfyExecState.progress = null;
      _updateAllBars();
    }
  }

  else if (t === 'execution_cached') {
    if (_comfyExecState && d.nodes) {
      for (const nid of d.nodes) _comfyExecState.cached_nodes.add(nid);
    }
  }

  else if (t === 'execution_done') {
    const elapsed = d.elapsed ? `${d.elapsed}s` : '';
    _comfyExecState = null;
    if (_comfyExecTimer) { clearInterval(_comfyExecTimer); _comfyExecTimer = null; }
    _updateAllBars();
    if (elapsed) showToast(`\u2705 生成完成 (${elapsed})`);
    loadComfyStatus();
    if (_currentComfyTab === 'queue') { loadQueuePanel(); loadComfyHistory(); }
  }

  else if (t === 'execution_error') {
    _comfyExecState = null;
    if (_comfyExecTimer) { clearInterval(_comfyExecTimer); _comfyExecTimer = null; }
    _updateAllBars();
    const errEl = document.getElementById('comfyui-exec-bar');
    if (errEl) {
      errEl.innerHTML = `<div class="comfy-exec-error">\u274c 执行出错: ${escHtml(d.exception_message || d.node_type || '未知错误')}</div>`;
      errEl.classList.remove('hidden');
      setTimeout(() => errEl.classList.add('hidden'), 8000);
    }
  }

  else if (t === 'execution_interrupted') {
    _comfyExecState = null;
    if (_comfyExecTimer) { clearInterval(_comfyExecTimer); _comfyExecTimer = null; }
    _updateAllBars();
    showToast('\u23f9 执行已中断');
    if (_currentComfyTab === 'queue') loadQueuePanel();
  }

  else if (t === 'monitor') {
    _updateMonitorData(d);
  }
}

function _updateMonitorData(d) {
  const gpuCards = document.querySelectorAll('#comfyui-status-cards .stat-card.cyan');
  if (!gpuCards.length) return;
  const gpus = d.gpus || [];
  gpus.forEach((gpu, i) => {
    if (!gpuCards[i]) return;
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

// ── 统一进度条渲染 ────────────────────────────────────────────

function _fetchAndFillNodeNames(promptId, stateRef) {
  fetch('/api/comfyui/queue').then(r => r.json()).then(qData => {
    if (!stateRef || stateRef.prompt_id !== promptId) return;
    for (const item of (qData.queue_running || [])) {
      if (item[1] === promptId && item[2]) {
        for (const [nid, ndata] of Object.entries(item[2])) {
          if (typeof ndata === 'object' && ndata.class_type) {
            stateRef.node_names[nid] = ndata.class_type;
          }
        }
        stateRef.total_nodes = Object.keys(stateRef.node_names).length;
        _updateAllBars();
        break;
      }
    }
  }).catch(() => {});
}

function _startExecTimer() {
  if (_comfyExecTimer) clearInterval(_comfyExecTimer);
  _comfyExecTimer = setInterval(() => { _updateAllBars(); if (_currentComfyTab === 'queue') loadQueuePanel(); }, 1000);
}

function _renderProgressBar(st) {
  const elapsed = Math.round(Date.now() / 1000 - st.start_time);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  const completedCount = st.executed_nodes.size + st.cached_nodes.size;
  const totalNodes = st.total_nodes || '?';

  const nodeName = st.current_node
    ? (st.node_names?.[st.current_node] || st.current_node)
    : '';

  const hasSteps = st.progress && st.progress.percent != null;
  const stepPct = hasSteps ? st.progress.percent : 0;

  let fillPct = 0;
  if (totalNodes !== '?' && totalNodes > 0) {
    const baseProgress = Math.max(0, completedCount - 1) / totalNodes;
    const currentFraction = hasSteps ? (stepPct / 100) / totalNodes : 0;
    fillPct = Math.min(100, Math.round((baseProgress + currentFraction) * 100));
  } else if (hasSteps) {
    fillPct = stepPct;
  }

  let html = `<div class="comfy-progress-bar active">`;
  html += `<div class="comfy-progress-bar-fill" style="width:${fillPct}%"></div>`;
  html += `<span class="comfy-progress-pulse"></span>`;
  html += `<span class="comfy-progress-label">\u26a1 正在生成</span>`;

  if (nodeName) {
    html += `<span class="comfy-progress-node">${completedCount}/${totalNodes} ${escHtml(nodeName)}</span>`;
  }

  if (hasSteps) {
    const stepDetail = st.progress.value != null ? `${st.progress.value}/${st.progress.max}` : '';
    html += `<span class="comfy-progress-steps">${stepDetail} (${stepPct}%)</span>`;
  } else {
    html += `<span class="comfy-progress-steps"></span>`;
  }

  html += `<span class="comfy-progress-time">${timeStr}</span>`;
  html += `</div>`;
  return html;
}

function _updateAllBars() {
  _updateExecBar();
  if (_currentComfyTab === 'queue') loadQueuePanel();
}

function _updateExecBar() {
  const bar = document.getElementById('comfyui-exec-bar');
  if (!bar) return;
  if (!_comfyExecState) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  bar.innerHTML = _renderProgressBar(_comfyExecState);
}

// ── SSE: Real-time log stream ─────────────────────────────────

function startComfyLogStream() {
  // Guard: only start if ComfyUI page is active
  const page = document.getElementById('page-comfyui');
  if (!page || page.classList.contains('hidden')) return;
  stopComfyLogStream();
  const el = document.getElementById('comfyui-log-content');
  if (!el) return;

  _comfyLogStream = createLogStream({
    el,
    historyUrl: '/api/logs/comfy?lines=200',
    streamUrl: '/api/comfyui/logs/stream',
    classify: line => {
      if (/error|exception|traceback/i.test(line)) return 'log-error';
      if (/warn/i.test(line)) return 'log-warn';
      if (/loaded|model|checkpoint|lora/i.test(line)) return 'log-info';
      return '';
    },
  });
  _comfyLogStream.start();
}

function stopComfyLogStream() {
  if (_comfyLogStream) { _comfyLogStream.stop(); _comfyLogStream = null; }
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
    const stColor = online ? 'var(--green)' : 'var(--red)';
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
          <div class="comfy-vram-bar"><div class="fill" style="width:${vramPct}%;background:${vramPct > 90 ? 'var(--red)' : vramPct > 70 ? 'var(--amber)' : 'var(--cyan)'}"></div>
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

    el.innerHTML = html || renderEmpty('无法获取状态');
  } catch (e) {
    el.innerHTML = renderError('加载失败: ' + e.message);
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
    el.innerHTML = renderError('加载参数失败: ' + e.message);
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
      status.style.color = 'var(--red)';
    }
  } catch (e) {
    status.textContent = '❌ 请求失败: ' + e.message;
    status.style.color = 'var(--red)';
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
    setTimeout(loadQueuePanel, 1000);
  } catch (e) { showToast('中断失败: ' + e.message); }
}

async function comfyFreeVRAM() {
  try {
    await fetch('/api/comfyui/free', { method: 'POST' });
    showToast('🧹 已释放 VRAM');
    setTimeout(loadComfyStatus, 2000);
  } catch (e) { showToast('释放失败: ' + e.message); }
}

// ── ComfyUI Sub-tab 切换 ─────────────────────────────────────

let _currentComfyTab = 'console';

function switchComfyTab(tab) {
  _currentComfyTab = tab;
  document.querySelectorAll('[data-comfy-tab]').forEach(el => {
    el.classList.toggle('active', el.dataset.comfyTab === tab);
  });
  ['console', 'queue', 'history'].forEach(t => {
    const el = document.getElementById('comfy-tab-' + t);
    if (el) el.classList.toggle('hidden', tab !== t);
  });

  if (tab === 'queue') {
    loadQueuePanel();
  } else if (tab === 'history') {
    loadComfyHistory();
  }
}

// ── 任务队列面板 ─────────────────────────────────────────────

let _queueRefreshTimer = null;

async function loadQueuePanel() {
  try {
    const r = await fetch('/api/comfyui/queue');
    const d = await r.json();
    const running = d.queue_running || [];
    const pending = d.queue_pending || [];

    // Summary
    const summaryEl = document.getElementById('queue-summary');
    if (summaryEl) {
      const parts = [];
      if (running.length) parts.push(`${running.length} 执行中`);
      if (pending.length) parts.push(`${pending.length} 等待中`);
      summaryEl.textContent = parts.length ? parts.join(' · ') : '空闲';
    }

    // Running
    const runEl = document.getElementById('queue-running');
    if (runEl) {
      if (running.length === 0) {
        runEl.innerHTML = '<div style="font-size:.85rem;color:var(--t3);padding:8px 0">无正在执行的任务</div>';
      } else {
        runEl.innerHTML = running.map(item => {
          const promptId = item[1] || '';
          const prompt = item[2] || {};
          const nodeCount = Object.keys(prompt).length;
          const shortId = promptId.substring(0, 8);

          let progressHtml = '';
          if (_comfyExecState && _comfyExecState.prompt_id === promptId) {
            progressHtml = _renderProgressBar(_comfyExecState);
          }

          return `<div class="queue-item running">
            <div class="queue-item-info">
              <div class="queue-item-id">${shortId}… · ${nodeCount} 个节点</div>
            </div>
            ${progressHtml}
          </div>`;
        }).join('');
      }
    }

    // Pending
    const pendEl = document.getElementById('queue-pending');
    if (pendEl) {
      if (pending.length === 0) {
        pendEl.innerHTML = '<div style="font-size:.85rem;color:var(--t3);padding:8px 0">无等待中的任务</div>';
      } else {
        pendEl.innerHTML = pending.map((item, idx) => {
          const promptId = item[1] || '';
          const prompt = item[2] || {};
          const nodeCount = Object.keys(prompt).length;
          const shortId = promptId.substring(0, 8);
          return `<div class="queue-item pending">
            <div class="queue-item-info">
              <div class="queue-item-id">#${idx + 1} · ${shortId}… · ${nodeCount} 个节点</div>
            </div>
            <button class="btn btn-sm btn-danger" style="font-size:.7rem;padding:2px 8px" onclick="comfyDeleteQueueItem('${promptId}')">✕</button>
          </div>`;
        }).join('');
      }
    }

    // Also refresh running items with progress
    if (_comfyExecState && _currentComfyTab === 'queue') {
      // Progress is rendered inline in running items
    }
  } catch (e) {
    const runEl = document.getElementById('queue-running');
    if (runEl) runEl.innerHTML = renderError('获取队列失败');
  }
}

async function comfyDeleteQueueItem(promptId) {
  try {
    await fetch('/api/comfyui/queue/delete', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({delete: [promptId]}),
    });
    showToast('已删除');
    loadQueuePanel();
  } catch (e) { showToast('删除失败: ' + e.message); }
}

async function comfyClearQueue() {
  try {
    await fetch('/api/comfyui/queue/clear', { method: 'POST' });
    showToast('队列已清空');
    loadQueuePanel();
  } catch (e) { showToast('清空失败: ' + e.message); }
}

// ── 生成历史 ──────────────────────────────────────────────────

let _historySortAsc = false;   // false = newest first
let _historySize = 'md';      // 'sm' | 'md' | 'lg'

function setHistorySort(value) {
  _historySortAsc = (value === 'asc');
  loadComfyHistory();
}

function setHistorySize(size) {
  _historySize = size;
  const grid = document.querySelector('#queue-history .history-grid');
  if (grid) {
    grid.classList.remove('size-sm', 'size-md', 'size-lg');
    grid.classList.add('size-' + size);
  }
}

async function loadComfyHistory() {
  const el = document.getElementById('queue-history');
  if (!el) return;

  try {
    const r = await fetch('/api/comfyui/history?max_items=20');
    const d = await r.json();
    const items = d.history || [];

    if (items.length === 0) {
      el.innerHTML = '<div class="history-empty">暂无生成记录</div>';
      return;
    }

    // Sort
    if (_historySortAsc) items.reverse();

    el.innerHTML = `<div class="history-grid size-${_historySize}">${items.map(item => {
      const images = item.images || [];
      const status = item.completed ? 'success' : 'error';
      const shortId = (item.prompt_id || '').substring(0, 8);
      const ts = item.timestamp ? new Date(item.timestamp).toLocaleString('zh-CN') : '';

      let imagesHtml = '';
      if (images.length > 0) {
        const showImages = images.slice(0, 3);
        imagesHtml = `<div class="history-card-images">${showImages.map(img =>
          `<img src="/api/comfyui/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}"
                loading="lazy" alt="" onclick="window.open(this.src,'_blank')">`
        ).join('')}</div>`;
      } else {
        imagesHtml = `<div class="history-card-images" style="align-items:center;justify-content:center;color:var(--t3);font-size:.8rem">无预览图</div>`;
      }

      return `<div class="history-card">
        ${imagesHtml}
        <div class="history-card-info">
          <span class="status-dot ${status}"></span>
          <div class="history-card-meta">
            <div>${shortId}…${images.length > 0 ? ` · ${images.length} 张图` : ''}</div>
            <div style="font-size:.7rem;color:var(--t3)">${ts}</div>
          </div>
        </div>
      </div>`;
    }).join('')}</div>`;
  } catch (e) {
    el.innerHTML = renderError('获取历史失败');
  }
}

// ── 自动刷新 ──────────────────────────────────────────────────

function startComfyAutoRefresh() {
  stopComfyAutoRefresh();
  comfyAutoRefresh = setInterval(() => {
    loadComfyStatus();
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

Object.assign(window, {
  loadComfyStatus, loadComfyParams, saveComfyUIParams,
  comfyInterrupt, comfyFreeVRAM, restartComfyUI,
  switchComfyTab, comfyDeleteQueueItem, comfyClearQueue,
  loadComfyHistory, loadQueuePanel, setHistorySort, setHistorySize,
});
