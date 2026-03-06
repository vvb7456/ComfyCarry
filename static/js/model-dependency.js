/**
 * model-dependency.js — 模型依赖欢迎页共享模块
 *
 * 欢迎页 (Welcome Page):
 *   每个容器生命周期内，每个 tab 首次进入时显示欢迎页。
 *   - 检测文件是否存在 → 已存在的模型自动打勾
 *   - 卡片可选中/反选（必选模型锁定勾选）
 *   - 统一下载按钮 + 进度条，顺序下载选中模型
 *   - 进度文案嵌入进度条内: "1/3 · ModelName · 45% · 12 MB/s"
 *   - 点击"进入"后写入 welcome state，同一容器不再显示
 *   - 全部已安装时自动 dismiss，不显示欢迎页
 *
 * 用法:
 *   import { initModelDependency } from './model-dependency.js';
 *   const handle = initModelDependency({ ... });
 *   // handle.destroy() — 页面离开时清理 SSE 连接
 */

import { apiFetch } from './core.js';

/**
 * @param {Object} cfg
 * @param {string} cfg.containerId  - 欢迎页 DOM 容器 ID
 * @param {string} cfg.paramsId     - 参数面板 DOM ID (欢迎页关闭后显示)
 * @param {string} cfg.comfyuiDir   - ComfyUI 根目录
 * @param {string} cfg.tab          - Tab 标识 ("pose"/"canny"/"depth"/"upscale")
 * @param {string} cfg.title        - 欢迎页标题
 * @param {Array}  cfg.models       - [{id, name, size, required?, files:[{filename,url,subdir}]}]
 * @param {Function} cfg.onEnter    - 点击"进入" / 自动 dismiss 后的回调
 * @returns {{ destroy: Function }}
 */
export function initModelDependency(cfg) {
  const container = document.getElementById(cfg.containerId);
  const params = document.getElementById(cfg.paramsId);
  if (!container || !params) return { destroy() {} };

  const st = {
    cfg,
    container,
    params,
    modelStatus: new Map(),   // id → { installed, downloading, download_id }
    selected: new Set(),      // 用户选中的 model id
    activeHandle: null,       // 当前 SSE { promise, abort }
    downloading: false,
  };

  _showLoading(st);
  _init(st);

  return {
    destroy() {
      if (st.activeHandle) { st.activeHandle.abort(); st.activeHandle = null; }
    },
  };
}

// ── Loading ──────────────────────────────────────────────────────────────────
function _showLoading(st) {
  st.params.classList.add('hidden');
  st.container.classList.remove('hidden');
  st.container.innerHTML = `
    <div class="mdep-welcome" style="padding:2rem;text-align:center">
      <div class="mdep-spinner" style="margin:0 auto 12px"></div>
      <div style="color:var(--t2);font-size:.85rem">正在检测模型…</div>
    </div>`;
}

// ── 初始化 ───────────────────────────────────────────────────────────────────
async function _init(st) {
  const { cfg, container, params } = st;

  // 1. 检查 welcome state — 已 dismiss 过则直接跳过
  try {
    const state = await apiFetch('/api/generate/welcome_state');
    if (state?.[cfg.tab]) {
      container.classList.add('hidden');
      params.classList.remove('hidden');
      cfg.onEnter?.();
      return;
    }
  } catch { /* 继续 */ }

  // 2. 检查文件
  if (!cfg.comfyuiDir) { _renderWelcome(st); return; }

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
  } catch {
    for (const m of cfg.models) {
      st.modelStatus.set(m.id, { installed: false, downloading: false, download_id: null });
    }
  }

  // 3. 全部已安装 → 自动 dismiss
  const allInstalled = cfg.models.every(m => st.modelStatus.get(m.id)?.installed);
  if (allInstalled) {
    _dismissWelcome(st);
    return;
  }

  // 4. 初始选中: installed 或 required
  for (const m of cfg.models) {
    const ms = st.modelStatus.get(m.id);
    if (ms?.installed || m.required) st.selected.add(m.id);
  }

  _renderWelcome(st);

  // 5. 恢复正在下载
  const dlModel = cfg.models.find(m => {
    const ms = st.modelStatus.get(m.id);
    return ms?.downloading && ms.download_id;
  });
  if (dlModel) {
    const ms = st.modelStatus.get(dlModel.id);
    st.selected.add(dlModel.id);
    _resumeDownload(st, dlModel, ms.download_id);
  }
}

// ── 渲染欢迎页 ──────────────────────────────────────────────────────────────
function _renderWelcome(st) {
  const { cfg, container } = st;

  const hasSelected = st.selected.size > 0;
  const needsDownload = cfg.models.some(m => st.selected.has(m.id) && !st.modelStatus.get(m.id)?.installed);

  let cardsHtml = '';
  for (const m of cfg.models) {
    const ms = st.modelStatus.get(m.id);
    const installed = ms?.installed;
    const isSelected = st.selected.has(m.id);
    const locked = installed || m.required;

    cardsHtml += `
      <div class="mdep-card${isSelected ? ' mdep-card-selected' : ''}${installed ? ' mdep-card-done' : ''}${locked ? ' mdep-card-locked' : ''}"
           data-model-id="${_esc(m.id)}">
        <div class="mdep-card-check">
          <span class="ms">${isSelected ? 'check_circle' : 'radio_button_unchecked'}</span>
        </div>
        <div class="mdep-card-body">
          <div class="mdep-card-name">${_esc(m.name)}</div>
          ${m.description ? `<div class="mdep-card-desc">${_esc(m.description)}</div>` : ''}
        </div>
        <div class="mdep-card-meta">
          <span class="mdep-card-size">${_esc(m.size || '')}</span>
          ${installed ? '<span class="mdep-card-badge">已安装</span>' : ''}
          ${m.required && !installed ? '<span class="mdep-card-badge mdep-badge-required">必需</span>' : ''}
        </div>
      </div>`;
  }

  // 按钮逻辑:
  // - needsDownload → "下载选中模型"
  // - hasSelected && !needsDownload → "进入" (所有选中的都已安装)
  // - !hasSelected → 不显示任何按钮
  let btnHtml = '';
  if (needsDownload) {
    btnHtml = `<button class="btn btn-sm mdep-download-btn">
      <span class="ms ms-sm">download</span> 下载选中模型
    </button>`;
  } else if (hasSelected) {
    btnHtml = `<button class="btn btn-sm mdep-enter-btn">
      <span class="ms ms-sm">arrow_forward</span> 进入
    </button>`;
  }

  container.innerHTML = `
    <div class="mdep-welcome">
      <div class="mdep-welcome-header">
        <span class="ms" style="font-size:2rem;color:var(--ac);opacity:.7">widgets</span>
        <div class="mdep-title">${_esc(cfg.title)}</div>
        <div class="mdep-desc">请选择需要下载的模型</div>
      </div>
      <div class="mdep-card-grid">${cardsHtml}</div>
      <div class="mdep-actions">
        <div class="mdep-progress-area hidden">
          <div class="mdep-progress-wrap">
            <div class="mdep-progress-bar" style="width:0%"></div>
            <div class="mdep-progress-pct"></div>
          </div>
          <button class="btn btn-xs mdep-cancel-btn" style="margin-top:6px">
            <span class="ms ms-sm">close</span> 取消
          </button>
        </div>
        <div class="mdep-btn-row">${btnHtml}</div>
      </div>
    </div>`;

  // 卡片点击
  container.querySelectorAll('.mdep-card').forEach(card => {
    card.addEventListener('click', () => {
      if (st.downloading) return;
      const mid = card.dataset.modelId;
      const model = cfg.models.find(m => m.id === mid);
      if (!model) return;
      const ms = st.modelStatus.get(mid);
      if (ms?.installed || model.required) return;

      if (st.selected.has(mid)) st.selected.delete(mid);
      else st.selected.add(mid);
      _renderWelcome(st);
    });
  });

  container.querySelector('.mdep-download-btn')?.addEventListener('click', () => {
    _startBatchDownload(st);
  });

  container.querySelector('.mdep-enter-btn')?.addEventListener('click', () => {
    _dismissWelcome(st);
  });
}

// ── 批量下载 ─────────────────────────────────────────────────────────────────
async function _startBatchDownload(st) {
  const { cfg, container } = st;

  const toDownload = cfg.models.filter(m =>
    st.selected.has(m.id) && !st.modelStatus.get(m.id)?.installed
  );
  if (!toDownload.length) return;

  st.downloading = true;
  const progressArea = container.querySelector('.mdep-progress-area');
  const progressPct = container.querySelector('.mdep-progress-pct');
  const progressBar = container.querySelector('.mdep-progress-bar');
  const cancelBtn = container.querySelector('.mdep-cancel-btn');
  const btnRow = container.querySelector('.mdep-btn-row');

  if (progressArea) progressArea.classList.remove('hidden');
  if (btnRow) btnRow.classList.add('hidden');
  container.querySelectorAll('.mdep-card').forEach(c => c.style.pointerEvents = 'none');

  let cancelled = false;
  let currentDownloadId = null;

  if (cancelBtn) {
    cancelBtn.onclick = async () => {
      cancelled = true;
      if (st.activeHandle) st.activeHandle.abort();
      if (currentDownloadId) {
        await apiFetch(`/api/downloads/${currentDownloadId}/cancel`, { method: 'POST' });
      }
      st.downloading = false;
      _renderWelcome(st);
    };
  }

  const total = toDownload.length;

  for (let mi = 0; mi < total; mi++) {
    if (cancelled) return;
    const model = toDownload[mi];
    const files = model.files;
    const label = `${mi + 1}/${total} · ${model.name}`;

    if (progressPct) progressPct.textContent = label;
    if (progressBar) progressBar.style.width = '0%';

    for (let fi = 0; fi < files.length; fi++) {
      if (cancelled) return;
      const f = files[fi];
      const saveDir = cfg.comfyuiDir + '/' + f.subdir;

      // 已存在则跳过
      const chk = await apiFetch('/api/downloads/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ save_dir: saveDir, filename: f.filename }),
      });
      if (chk?.installed) continue;

      // 检查是否正在下载
      let downloadId = chk?.downloading ? chk.download_id : null;

      if (!downloadId) {
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
          if (progressPct) progressPct.textContent = `下载失败: ${model.name}`;
          st.downloading = false;
          setTimeout(() => _renderWelcome(st), 2000);
          return;
        }

        if (resp.status === 'complete') continue;
        downloadId = resp.download_id;
      }

      currentDownloadId = downloadId;

      st.activeHandle = _waitForDownload(downloadId, (data) => {
        const pct = data.progress || 0;
        if (progressBar) progressBar.style.width = pct + '%';
        const speed = _fmtSpeed(data.speed || 0);
        const pctText = Math.round(pct) + '%';
        if (progressPct) {
          progressPct.textContent = speed
            ? `${label} · ${pctText} · ${speed}`
            : `${label} · ${pctText}`;
        }
      });

      const success = await st.activeHandle.promise;
      st.activeHandle = null;
      currentDownloadId = null;

      if (!success) {
        if (cancelled) return;
        if (progressPct) progressPct.textContent = `下载失败: ${model.name}`;
        st.downloading = false;
        setTimeout(() => _renderWelcome(st), 2000);
        return;
      }
    }

    // model 所有文件完成
    const ms = st.modelStatus.get(model.id);
    if (ms) ms.installed = true;
    const card = container.querySelector(`.mdep-card[data-model-id="${model.id}"]`);
    if (card) {
      card.classList.add('mdep-card-done', 'mdep-card-selected');
      const check = card.querySelector('.mdep-card-check .ms');
      if (check) check.textContent = 'check_circle';
      const meta = card.querySelector('.mdep-card-meta');
      if (meta && !meta.querySelector('.mdep-card-badge')) {
        meta.insertAdjacentHTML('beforeend', '<span class="mdep-card-badge">已安装</span>');
      }
    }
  }

  // 全部完成
  st.downloading = false;
  if (progressBar) progressBar.style.width = '100%';
  if (progressPct) progressPct.textContent = '全部下载完成';
  setTimeout(() => _renderWelcome(st), 1000);
}

// ── 恢复下载 ─────────────────────────────────────────────────────────────────
function _resumeDownload(st, model, downloadId) {
  const { container } = st;
  st.downloading = true;

  const progressArea = container.querySelector('.mdep-progress-area');
  const progressPct = container.querySelector('.mdep-progress-pct');
  const progressBar = container.querySelector('.mdep-progress-bar');
  const cancelBtn = container.querySelector('.mdep-cancel-btn');
  const btnRow = container.querySelector('.mdep-btn-row');

  if (progressArea) progressArea.classList.remove('hidden');
  if (btnRow) btnRow.classList.add('hidden');
  if (progressPct) progressPct.textContent = `${model.name}`;
  container.querySelectorAll('.mdep-card').forEach(c => c.style.pointerEvents = 'none');

  if (cancelBtn) {
    cancelBtn.onclick = async () => {
      if (st.activeHandle) st.activeHandle.abort();
      await apiFetch(`/api/downloads/${downloadId}/cancel`, { method: 'POST' });
      st.downloading = false;
      _renderWelcome(st);
    };
  }

  st.activeHandle = _waitForDownload(downloadId, (data) => {
    const pct = data.progress || 0;
    if (progressBar) progressBar.style.width = pct + '%';
    const speed = _fmtSpeed(data.speed || 0);
    const pctText = Math.round(pct) + '%';
    if (progressPct) {
      progressPct.textContent = speed
        ? `${model.name} · ${pctText} · ${speed}`
        : `${model.name} · ${pctText}`;
    }
  });

  st.activeHandle.promise.then(ok => {
    st.activeHandle = null;
    st.downloading = false;
    if (ok) {
      const ms = st.modelStatus.get(model.id);
      if (ms) ms.installed = true;
    }
    _renderWelcome(st);
  });
}

// ── Dismiss ──────────────────────────────────────────────────────────────────
async function _dismissWelcome(st) {
  const { cfg, container, params } = st;

  await apiFetch('/api/generate/welcome_state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tab: cfg.tab }),
  });

  container.classList.add('hidden');
  params.classList.remove('hidden');
  cfg.onEnter?.();
}

// ── SSE 下载监听 ─────────────────────────────────────────────────────────────
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
