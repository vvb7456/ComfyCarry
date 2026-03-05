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
  if (!container || !params) return { recheck() {} };

  const state = {
    cfg,
    container,
    params,
    modelStatus: new Map(),   // id → { installed, downloading, download_id }
    rendered: false,          // 是否已渲染过卡片
  };

  const recheck = () => _check(state);
  recheck();
  return { recheck };
}

// ── 检测逻辑 ────────────────────────────────────────────────────────────────
async function _check(st) {
  const { cfg, container, params } = st;
  if (!cfg.comfyuiDir) return;

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
    } else if (allInstalled && st.rendered) {
      // 下载完成后 recheck → 保持卡片页面，更新状态显示进入按钮
      _renderCards(st, true);
    } else {
      params.classList.add('hidden');
      container.classList.remove('hidden');
      _renderCards(st, anyInstalled);
      cfg.onMissing?.();
    }
  } catch {
    container.classList.add('hidden');
    params.classList.remove('hidden');
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

  if (cancelBtn) {
    cancelBtn.onclick = async () => {
      cancelled = true;
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

      const success = await _waitForDownload(resp.download_id, (data) => {
        const dlPct = data.progress || 0;
        const total = baseProgress + (dlPct / 100) * fileWeight;
        if (bar) bar.style.width = total + '%';
        const speed = _fmtSpeed(data.speed || 0);
        if (pct) pct.textContent = speed ? `${total.toFixed(1)}% · ${speed}` : `${total.toFixed(1)}%`;
      });

      currentDownloadId = null;
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

  if (cancelBtn) {
    cancelBtn.onclick = async () => {
      await apiFetch(`/api/downloads/${downloadId}/cancel`, { method: 'POST' });
      _resetCard(card);
    };
  }

  _waitForDownload(downloadId, (data) => {
    const dlPct = data.progress || 0;
    if (bar) bar.style.width = dlPct + '%';
    const speed = _fmtSpeed(data.speed || 0);
    if (pct) pct.textContent = speed ? `${dlPct.toFixed(1)}% · ${speed}` : `${dlPct.toFixed(1)}%`;
  }).then(ok => {
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
function _waitForDownload(downloadId, onProgress) {
  return new Promise(resolve => {
    let retries = 0;
    const MAX_RETRIES = 5;

    function connect() {
      const evtSource = new EventSource(`/api/downloads/${downloadId}/events`);
      evtSource.onmessage = (e) => {
        retries = 0;
        try {
          const data = JSON.parse(e.data);
          if (data.error) { evtSource.close(); resolve(false); return; }
          onProgress?.(data);
          if (data.status === 'complete') { evtSource.close(); resolve(true); }
          else if (data.status === 'failed' || data.status === 'cancelled') { evtSource.close(); resolve(false); }
        } catch { /* ignore */ }
      };
      evtSource.onerror = () => {
        evtSource.close();
        if (retries < MAX_RETRIES) {
          retries++;
          setTimeout(connect, 2000 * retries);
        } else {
          resolve(false);
        }
      };
    }
    connect();
  });
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
