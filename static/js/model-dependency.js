/**
 * model-dependency.js — 模型依赖检测 + 下载共享模块
 *
 * 卡片布局: 每个模型一张卡片并排显示，各有独立下载按钮 + 进度条。
 * 任意一个模型下载完成后显示"进入控制页面"按钮，不自动切换。
 *
 * 用法:
 *   import { initModelDependency } from './model-dependency.js';
 *   initModelDependency({ containerId, paramsId, comfyuiDir, title, description, models, onReady });
 */

import { apiFetch } from './core.js';

/**
 * 初始化模型依赖组件
 * @param {Object} cfg
 * @param {string} cfg.containerId  - 下载区 DOM 容器 ID
 * @param {string} cfg.paramsId     - 参数面板 DOM ID (模型就绪后显示)
 * @param {string} cfg.comfyuiDir   - ComfyUI 根目录 (构建 save_dir)
 * @param {string} cfg.title        - 缺失状态标题
 * @param {string} cfg.description  - 缺失状态描述
 * @param {Array} cfg.models        - 模型列表 [{id, name, description?, size, files:[{filename,url,subdir}]}]
 * @param {Function} cfg.onReady    - 进入控制页面回调
 * @param {Function} [cfg.onMissing]- 模型缺失回调
 * @returns {{ recheck: Function }}  - 返回控制句柄
 */
export function initModelDependency(cfg) {
  const container = document.getElementById(cfg.containerId);
  const params = document.getElementById(cfg.paramsId);
  if (!container || !params) return { recheck() {}, destroy() {} };

  const state = {
    cfg,
    container,
    params,
    modelStatus: new Map(),   // id → { installed, downloading, download_id }
    rendered: false,          // 是否已渲染过卡片
    activeHandles: [],        // 活跃的 SSE waitHandle 列表 (防止泄漏)
  };

  // 首次检测前显示 loading 占位
  _showLoading(state);

  const recheck = () => _check(state);
  const destroy = () => _destroyHandles(state);
  recheck();
  return { recheck, destroy };
}

// ── 清理活跃 SSE 连接 ────────────────────────────────────────────────────────
function _destroyHandles(st) {
  for (const h of st.activeHandles) {
    h.abort();
  }
  st.activeHandles = [];
}

// ── Loading 占位 ─────────────────────────────────────────────────────────────
function _showLoading(st) {
  const { container, params } = st;
  params.classList.add('hidden');
  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="mdep-missing" style="padding:2rem;text-align:center">
      <div class="mdep-spinner" style="margin:0 auto 12px"></div>
      <div style="color:var(--t2);font-size:.85rem">正在检测模型…</div>
    </div>`;
}

// ── 检测逻辑 ────────────────────────────────────────────────────────────────
async function _check(st) {
  const { cfg, container, params } = st;
  if (!cfg.comfyuiDir) return;

  // 先关闭上一轮残留的 SSE 连接，防止重复 recheck 时累积
  _destroyHandles(st);

  const checkFiles = [];
  for (const m of cfg.models) {
    for (const f of m.files) {
      checkFiles.push({
        save_dir: cfg.comfyuiDir + '/' + f.subdir,
        filename: f.filename,
        _modelId: m.id,
      });
    }
  }

  try {
    const r = await apiFetch('/api/downloads/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: checkFiles.map(({ _modelId, ...rest }) => rest) }),
    });
    const results = r?.results || [];

    st.modelStatus.clear();
    for (const m of cfg.models) {
      st.modelStatus.set(m.id, { installed: true, downloading: false, download_id: null });
    }
    for (let i = 0; i < checkFiles.length; i++) {
      const mid = checkFiles[i]._modelId;
      const res = results[i];
      if (!res) continue;
      const ms = st.modelStatus.get(mid);
      if (!res.installed) ms.installed = false;
      if (res.downloading) { ms.downloading = true; ms.download_id = res.download_id; }
    }

    const anyInstalled = [...st.modelStatus.values()].some(s => s.installed);
    const allInstalled = [...st.modelStatus.values()].every(s => s.installed);

    if (allInstalled && !st.rendered) {
      // 首次检查 → 全部已就绪，直接显示参数面板
      container.classList.add('hidden');
      params.classList.remove('hidden');
      cfg.onAllInstalled?.();
    } else if (allInstalled && st.rendered) {
      // 下载完成后 recheck → 保持卡片页面，更新状态显示进入按钮
      _renderCards(st, true);
      cfg.onAllInstalled?.();
    } else {
      params.classList.add('hidden');
      container.classList.remove('hidden');
      _renderCards(st, anyInstalled);
      cfg.onMissing?.();
    }
  } catch {
    // 检测失败 → 显示重试提示，而不是静默隐藏
    params.classList.add('hidden');
    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="mdep-missing" style="padding:2rem;text-align:center">
        <span class="ms" style="font-size:2rem;color:var(--amber);opacity:.7">warning</span>
        <div class="mdep-title" style="margin-top:8px">模型检测失败</div>
        <div class="mdep-desc">无法连接到后端服务，请检查网络后重试</div>
        <button class="btn btn-sm" style="margin-top:12px;gap:4px">
          <span class="ms ms-sm">refresh</span> 重试
        </button>
      </div>`;
    container.querySelector('button')?.addEventListener('click', () => {
      _showLoading(st);
      _check(st);
    });
  }
}

// ── 渲染卡片列表 ─────────────────────────────────────────────────────────────
function _renderCards(st, anyInstalled) {
  const { cfg, container } = st;
  st.rendered = true;

  let cardsHtml = '';
  for (const m of cfg.models) {
    const ms = st.modelStatus.get(m.id);
    const installed = ms?.installed;

    cardsHtml += `
      <div class="mdep-card${installed ? ' mdep-card-done' : ''}" data-model-id="${_esc(m.id)}">
        <div class="mdep-card-header">
          <span class="ms mdep-card-icon">${installed ? 'check_circle' : 'deployed_code'}</span>
          <div class="mdep-card-info">
            <div class="mdep-card-name">${_esc(m.name)}</div>
            ${m.description ? `<div class="mdep-card-desc">${_esc(m.description)}</div>` : ''}
          </div>
          <div class="mdep-card-size">${_esc(m.size || '')}</div>
        </div>
        <div class="mdep-card-actions">
          ${installed
            ? '<div class="mdep-card-status"><span class="ms" style="font-size:.9rem;color:var(--green)">check_circle</span> 已安装</div>'
            : `<button class="btn btn-sm mdep-card-dl" data-model-id="${_esc(m.id)}">
                <span class="ms ms-sm">download</span> 下载
              </button>
              <div class="mdep-card-progress hidden" data-model-id="${_esc(m.id)}">
                <div class="mdep-progress-row">
                  <div class="mdep-progress-wrap">
                    <div class="mdep-progress-bar" style="width:0%"></div>
                    <span class="mdep-progress-pct">0%</span>
                  </div>
                  <button class="btn btn-xs mdep-cancel-btn" data-model-id="${_esc(m.id)}">取消</button>
                </div>
              </div>`
          }
        </div>
      </div>`;
  }

  container.innerHTML = `
    <div class="mdep-missing">
      <span class="ms" style="font-size:2.2rem;color:var(--ac);opacity:.7">download</span>
      <div class="mdep-title">${_esc(cfg.title)}</div>
      <div class="mdep-desc">${_esc(cfg.description)}</div>
      <div class="mdep-card-grid">${cardsHtml}</div>
      <button class="btn btn-sm mdep-enter-btn${anyInstalled ? '' : ' hidden'}" style="margin-top:16px;gap:4px">
        <span class="ms ms-sm">arrow_forward</span> 进入控制页面
      </button>
    </div>`;

  // 绑定下载按钮
  container.querySelectorAll('.mdep-card-dl').forEach(btn => {
    btn.addEventListener('click', () => {
      const mid = btn.dataset.modelId;
      const model = cfg.models.find(m => m.id === mid);
      if (model) _startCardDownload(st, model);
    });
  });

  // 绑定进入按钮
  container.querySelector('.mdep-enter-btn')?.addEventListener('click', () => {
    container.classList.add('hidden');
    st.params.classList.remove('hidden');
    cfg.onReady?.();
  });

  // 恢复正在下载的任务
  for (const m of cfg.models) {
    const ms = st.modelStatus.get(m.id);
    if (ms?.downloading && ms.download_id) {
      _resumeCardDownload(st, m, ms.download_id);
    }
  }
}

// ── 单卡片下载 ───────────────────────────────────────────────────────────────
async function _startCardDownload(st, model) {
  const { cfg, container } = st;
  const card = container.querySelector(`.mdep-card[data-model-id="${model.id}"]`);
  if (!card) return;
  const btn = card.querySelector('.mdep-card-dl');
  const prog = card.querySelector('.mdep-card-progress');
  const bar = card.querySelector('.mdep-progress-bar');
  const pct = card.querySelector('.mdep-progress-pct');
  const cancelBtn = card.querySelector('.mdep-cancel-btn');

  if (btn) btn.classList.add('hidden');
  if (prog) prog.classList.remove('hidden');
  if (bar) bar.style.width = '0%';
  if (pct) pct.textContent = '0%';

  let cancelled = false;
  let currentDownloadId = null;
  let currentWaitHandle = null;  // { promise, abort }

  if (cancelBtn) {
    cancelBtn.onclick = async () => {
      cancelled = true;
      // 先关闭 SSE 连接，再发取消请求
      if (currentWaitHandle) currentWaitHandle.abort();
      if (currentDownloadId) {
        await apiFetch(`/api/downloads/${currentDownloadId}/cancel`, { method: 'POST' });
      }
      _resetCard(card);
    };
  }

  const files = model.files;
  try {
    for (let i = 0; i < files.length; i++) {
      if (cancelled) return;
      const f = files[i];
      const saveDir = cfg.comfyuiDir + '/' + f.subdir;
      const baseProgress = (i / files.length) * 100;
      const fileWeight = 100 / files.length;

      const chk = await apiFetch('/api/downloads/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ save_dir: saveDir, filename: f.filename }),
      });
      if (chk?.installed) {
        const p = baseProgress + fileWeight;
        if (bar) bar.style.width = p + '%';
        if (pct) pct.textContent = p.toFixed(1) + '%';
        continue;
      }

      const resp = await apiFetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: f.url,
          save_dir: saveDir,
          filename: f.filename,
          meta: { source: 'model-dependency', model: model.name },
        }),
      });

      if (!resp || resp.error) {
        _resetCard(card);
        return;
      }

      if (resp.status === 'complete') {
        const p = baseProgress + fileWeight;
        if (bar) bar.style.width = p + '%';
        if (pct) pct.textContent = p.toFixed(1) + '%';
        continue;
      }

      currentDownloadId = resp.download_id;
      currentWaitHandle = _waitForDownload(resp.download_id, (data) => {
        const dlPct = data.progress || 0;
        const total = baseProgress + (dlPct / 100) * fileWeight;
        if (bar) bar.style.width = total + '%';
        const speed = _fmtSpeed(data.speed || 0);
        if (pct) pct.textContent = speed ? `${total.toFixed(1)}% · ${speed}` : `${total.toFixed(1)}%`;
      });
      st.activeHandles.push(currentWaitHandle);

      const success = await currentWaitHandle.promise;

      currentDownloadId = null;
      currentWaitHandle = null;
      if (!success) {
        if (cancelled) return;
        _resetCard(card);
        return;
      }
    }

    _markCardDone(card);
    const enterBtn = container.querySelector('.mdep-enter-btn');
    if (enterBtn) enterBtn.classList.remove('hidden');

  } catch {
    _resetCard(card);
  }
}

function _markCardDone(card) {
  card.classList.add('mdep-card-done');
  const icon = card.querySelector('.mdep-card-icon');
  if (icon) icon.textContent = 'check_circle';
  const actions = card.querySelector('.mdep-card-actions');
  if (actions) actions.innerHTML = '<div class="mdep-card-status"><span class="ms" style="font-size:.9rem;color:var(--green)">check_circle</span> 已安装</div>';
}

function _resetCard(card) {
  const btn = card.querySelector('.mdep-card-dl');
  const prog = card.querySelector('.mdep-card-progress');
  if (btn) btn.classList.remove('hidden');
  if (prog) prog.classList.add('hidden');
}

// ── 恢复已有下载 ─────────────────────────────────────────────────────────────
function _resumeCardDownload(st, model, downloadId) {
  const { container } = st;
  const card = container.querySelector(`.mdep-card[data-model-id="${model.id}"]`);
  if (!card) return;
  const btn = card.querySelector('.mdep-card-dl');
  const prog = card.querySelector('.mdep-card-progress');
  const bar = card.querySelector('.mdep-progress-bar');
  const pct = card.querySelector('.mdep-progress-pct');
  const cancelBtn = card.querySelector('.mdep-cancel-btn');

  if (btn) btn.classList.add('hidden');
  if (prog) prog.classList.remove('hidden');

  const waitHandle = _waitForDownload(downloadId, (data) => {
    const dlPct = data.progress || 0;
    if (bar) bar.style.width = dlPct + '%';
    const speed = _fmtSpeed(data.speed || 0);
    if (pct) pct.textContent = speed ? `${dlPct.toFixed(1)}% · ${speed}` : `${dlPct.toFixed(1)}%`;
  });
  st.activeHandles.push(waitHandle);

  if (cancelBtn) {
    cancelBtn.onclick = async () => {
      waitHandle.abort();
      await apiFetch(`/api/downloads/${downloadId}/cancel`, { method: 'POST' });
      _resetCard(card);
    };
  }

  waitHandle.promise.then(ok => {
    if (ok) {
      _markCardDone(card);
      const enterBtn = container.querySelector('.mdep-enter-btn');
      if (enterBtn) enterBtn.classList.remove('hidden');
    } else {
      _resetCard(card);
    }
  });
}

// ── SSE 下载监听 ─────────────────────────────────────────────────────────────
// 返回 { promise: Promise<boolean>, abort: Function }
function _waitForDownload(downloadId, onProgress) {
  let evtSource = null;
  let settled = false;
  let retryTimer = null;
  let resolveRef = null;

  const promise = new Promise(resolve => {
    resolveRef = resolve;
    let retries = 0;
    const MAX_RETRIES = 5;

    function connect() {
      if (settled) return;
      evtSource = new EventSource(`/api/downloads/${downloadId}/events`);
      evtSource.onmessage = (e) => {
        retries = 0;
        try {
          const data = JSON.parse(e.data);
          if (data.error) { _finish(false); return; }
          onProgress?.(data);
          if (data.status === 'complete') _finish(true);
          else if (data.status === 'failed' || data.status === 'cancelled') _finish(false);
        } catch { /* ignore */ }
      };
      evtSource.onerror = () => {
        if (settled) { evtSource.close(); return; }
        evtSource.close();
        evtSource = null;
        if (retries < MAX_RETRIES) {
          retries++;
          retryTimer = setTimeout(connect, 2000 * retries);
        } else {
          _finish(false);
        }
      };
    }

    function _finish(ok) {
      if (settled) return;
      settled = true;
      if (evtSource) { evtSource.close(); evtSource = null; }
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      resolve(ok);
    }

    connect();
  });

  function abort() {
    if (settled) return;
    settled = true;
    if (evtSource) { evtSource.close(); evtSource = null; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    resolveRef?.(false);
  }

  return { promise, abort };
}

// ── 工具 ─────────────────────────────────────────────────────────────────────
function _esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function _fmtSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '';
  if (bytesPerSec >= 1073741824) return (bytesPerSec / 1073741824).toFixed(1) + ' GB/s';
  if (bytesPerSec >= 1048576) return (bytesPerSec / 1048576).toFixed(1) + ' MB/s';
  if (bytesPerSec >= 1024) return (bytesPerSec / 1024).toFixed(0) + ' KB/s';
  return bytesPerSec + ' B/s';
}
