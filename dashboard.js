// ====================================================================
// Workspace Manager - dashboard.js
// ====================================================================

const CIVITAI_API_BASE = 'https://civitai.com/api/v1';
let apiKey = '';
let selectedModels = new Map();
let searchResultsCache = {};
let autoLogInterval = null;
let metaSelectedWords = new Set();
let searchObserver = null;
let isSearchLoading = false;
let hasMoreResults = false;

// ========== Init ==========
document.addEventListener('DOMContentLoaded', async () => {
  await loadApiKey();
  loadCartFromStorage();
  updateCartBadge();
  showPage('dashboard');

  // Scroll-to-top FAB visibility
  const content = document.querySelector('.content');
  const fab = document.getElementById('scroll-top-fab');
  if (content && fab) {
    content.addEventListener('scroll', () => {
      fab.classList.toggle('visible', content.scrollTop > 300);
    });
  }
});

// ========== Navigation ==========
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.getElementById('page-' + page).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));

  // Stop all page-specific polling/SSE regardless of target page
  stopDlStatusPolling(); stopTunnelAutoRefresh(); stopSyncAutoRefresh(); stopPluginQueuePoll(); stopComfyAutoRefresh();

  if (page === 'dashboard') { refreshDashboard(); startDashboardSSE(); }
  else { stopDashboardSSE(); }
  if (page === 'models') loadLocalModels();
  else if (page === 'tunnel') { loadTunnelPage(); startTunnelAutoRefresh(); }
  else if (page === 'comfyui') { loadComfyUIPage(); startComfyAutoRefresh(); }
  else if (page === 'sync') { loadSyncPage(); startSyncAutoRefresh(); }
  else if (page === 'settings') loadSettingsPage();
  else if (page === 'plugins') loadPluginsPage();
}

let currentModelTab = 'local';
const modelTabIds = ['local', 'civitai', 'downloads'];
function switchModelTab(tab) {
  currentModelTab = tab;
  document.querySelectorAll('[data-mtab]').forEach(t => t.classList.toggle('active', t.dataset.mtab === tab));
  modelTabIds.forEach(id => document.getElementById('mtab-' + id).classList.toggle('hidden', id !== tab));
  if (tab === 'local') loadLocalModels();
  else if (tab === 'civitai') loadFacets();
  else if (tab === 'downloads') { renderDownloadsTab(); startDlStatusPolling(); }
}

// ========== Utils ==========
function fmtBytes(b) {
  if (!b || b === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + u[i];
}
function fmtPct(v) { return (v || 0).toFixed(1) + '%'; }
function showToast(msg) { const el = document.getElementById('toast'); el.textContent = msg; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2500); }
function copyText(text) { navigator.clipboard.writeText(text).then(() => showToast('已复制到剪贴板')).catch(() => { }); }
function getAuthHeaders() { return apiKey ? { Authorization: 'Bearer ' + apiKey } : {}; }
function openImg(url) {
  if (!url) return;
  const img = document.getElementById('modal-img');
  img.src = '';  // clear stale image
  document.getElementById('img-modal').classList.add('active');
  img.src = url;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { document.getElementById('img-modal').classList.remove('active'); closeMetaModal(); closeVersionPicker(); } });

// ========== Metadata Modal ==========
function openMetaModal(data) {
  metaSelectedWords = new Set();
  document.getElementById('meta-title').textContent = data.name || '模型详情';
  document.getElementById('meta-body').innerHTML = renderMetaContent(data);
  document.getElementById('meta-modal').classList.add('active');
}
function closeMetaModal() { document.getElementById('meta-modal').classList.remove('active'); }

function renderMetaContent(data) {
  const ver = data.selectedVersion || data.version || null;
  const versions = data.versions || (ver ? [ver] : []);
  const trainedWords = ver?.trainedWords || [];
  const images = data.images || ver?.images || [];
  const type = data.type || '';
  const baseModel = ver?.baseModel || '';
  const hashes = ver?.hashes || {};

  let html = '';

  // Tags
  html += '<div class="meta-tags">';
  if (type) html += `<span class="badge ${getBadgeClass(type.toLowerCase())}">${type}</span>`;
  if (baseModel) html += `<span class="badge badge-other">${baseModel}</span>`;
  html += '</div>';

  // Version selector (if multiple)
  let versionRow = '';
  if (versions.length > 1) {
    const opts = versions.map(v => {
      const sel = (ver && v.id === ver.id) ? 'selected' : '';
      return `<option value="${v.id}" ${sel}>${v.name || v.id}${v.baseModel ? ' (' + v.baseModel + ')' : ''}</option>`;
    }).join('');
    versionRow = `<tr><td>版本</td><td><select class="meta-version-select" onchange="switchMetaVersion(this.value, '${data.id}')">${opts}</select></td></tr>`;
  } else if (ver) {
    versionRow = `<tr><td>版本</td><td>${ver.name || ver.id || '-'}</td></tr>`;
  }

  // Info table
  html += '<table class="meta-info-table"><tbody>';
  html += `<tr><td>ID</td><td>${data.id || '-'}</td></tr>`;
  html += versionRow;
  if (data.user?.username) html += `<tr><td>作者</td><td>${data.user.username}</td></tr>`;
  html += `<tr><td>链接</td><td><a href="https://civitai.com/models/${data.id}" target="_blank">在 CivitAI 查看 ↗</a></td></tr>`;
  if (hashes?.SHA256) html += `<tr><td>SHA256</td><td style="word-break:break-all;font-family:monospace;font-size:.75rem">${hashes.SHA256}</td></tr>`;
  if (data.metrics) {
    const m = data.metrics;
    html += `<tr><td>统计</td><td>⬇️ ${(m.downloadCount||0).toLocaleString()} &nbsp; 👍 ${(m.thumbsUpCount||0).toLocaleString()}</td></tr>`;
  }
  // For local models with extra fields
  if (data.file) html += `<tr><td>文件</td><td style="word-break:break-all">${data.file}</td></tr>`;
  if (data.sha256) html += `<tr><td>SHA256</td><td style="word-break:break-all;font-family:monospace;font-size:.75rem">${data.sha256}</td></tr>`;
  html += '</tbody></table>';

  // Trained words
  if (trainedWords.length > 0) {
    html += '<div class="section-title" style="font-size:.88rem">🏷️ 触发词</div>';
    html += '<ul class="meta-tw-list">';
    trainedWords.forEach(w => {
      const word = typeof w === 'string' ? w : (w.word || '');
      if (word) html += `<li class="meta-tw-item" onclick="toggleMetaWord(this, '${word.replace(/'/g, "\\'")}')">${word}</li>`;
    });
    html += '</ul>';
    html += '<div class="meta-tw-actions"><span id="meta-tw-count">点击选择触发词</span> <button class="btn btn-sm btn-success" onclick="copyMetaWords()">📋 复制选中</button> <button class="btn btn-sm" onclick="copyAllMetaWords()">全部复制</button></div>';
  }

  // Images with generation params
  if (images.length > 0) {
    html += '<div class="section-title" style="font-size:.88rem;margin-top:16px">🖼️ 示例图片</div>';
    html += '<div class="meta-images">';
    images.forEach(img => {
      let imgUrl = '';
      if (img.url) {
        if (img.url.startsWith('http')) imgUrl = img.url;
        else if (img.url.startsWith('/')) imgUrl = img.url;  // local preview path
        else imgUrl = `https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/${img.url}/width=450/default.jpg`;
      }
      const fullUrl = imgUrl ? imgUrl.replace('/width=450', '') : '';
      if (!imgUrl) return;

      let caption = '';
      if (img.seed) caption += `<label>Seed</label>${img.seed}`;
      if (img.steps) caption += `<label>Steps</label>${img.steps}`;
      if (img.cfg) caption += `<label>CFG</label>${img.cfg}`;
      if (img.sampler) caption += `<label>Sampler</label>${img.sampler}`;
      if (img.model) caption += `<label>Model</label>${img.model}`;
      if (img.positive) caption += `<label>Positive</label><span class="prompt-text" onclick="copyText(this.textContent)" title="点击复制">${img.positive}</span>`;
      if (img.negative) caption += `<label>Negative</label><span class="prompt-text" onclick="copyText(this.textContent)" title="点击复制">${img.negative}</span>`;

      // Meilisearch images have meta in different structure
      if (img.meta) {
        const mt = img.meta;
        if (mt.seed) caption += `<label>Seed</label>${mt.seed}`;
        if (mt.steps) caption += `<label>Steps</label>${mt.steps}`;
        if (mt.cfgScale) caption += `<label>CFG</label>${mt.cfgScale}`;
        if (mt.sampler) caption += `<label>Sampler</label>${mt.sampler}`;
        if (mt.prompt) caption += `<label>Positive</label><span class="prompt-text" onclick="copyText(this.textContent)" title="点击复制">${mt.prompt}</span>`;
        if (mt.negativePrompt) caption += `<label>Negative</label><span class="prompt-text" onclick="copyText(this.textContent)" title="点击复制">${mt.negativePrompt}</span>`;
      }

      const isVideo = img.type === 'video' || (img.name && /\.(webm|mp4)$/i.test(img.name));
      const figcaptionHtml = caption ? `<figcaption>${caption}</figcaption>` : '';
      html += `<figure${isVideo ? ' style="position:relative"' : ''}><img src="${imgUrl}" alt="" onclick="openImg('${fullUrl.replace(/'/g, "\\'")}')" loading="lazy">${isVideo ? '<span style="position:absolute;top:6px;left:6px;background:rgba(0,0,0,.65);color:#fff;padding:2px 8px;border-radius:4px;font-size:.75rem">🎬 视频</span>' : ''}${figcaptionHtml}</figure>`;
    });
    html += '</div>';
  }

  return html;
}

function toggleMetaWord(el, word) {
  el.classList.toggle('selected');
  if (metaSelectedWords.has(word)) metaSelectedWords.delete(word);
  else metaSelectedWords.add(word);
  document.getElementById('meta-tw-count').textContent = metaSelectedWords.size > 0 ? `已选 ${metaSelectedWords.size} 个` : '点击选择触发词';
}
function copyMetaWords() {
  if (metaSelectedWords.size === 0) { showToast('请先点击选择触发词'); return; }
  copyText([...metaSelectedWords].join(', '));
}
function copyAllMetaWords() {
  const items = document.querySelectorAll('#meta-body .meta-tw-item');
  if (items.length === 0) return;
  copyText([...items].map(el => el.textContent.trim()).join(', '));
}

function switchMetaVersion(versionId, modelId) {
  const cached = searchResultsCache[String(modelId)];
  if (!cached || !cached.allVersions) return;
  const newVer = cached.allVersions.find(v => String(v.id) === String(versionId));
  if (!newVer) return;
  // Update cached selected version
  cached.version = newVer;
  // Also update cart if in cart
  if (selectedModels.has(String(modelId))) {
    const entry = selectedModels.get(String(modelId));
    entry.versionId = newVer.id;
    entry.versionName = newVer.name;
    entry.baseModel = newVer.baseModel;
    saveCartToStorage();
  }
  // Re-render modal with new version
  openMetaModal({
    ...cached, id: modelId, selectedVersion: newVer, versions: cached.allVersions
  });
}

// Open metadata for a search result / ID lookup item
function openMetaFromCache(modelId) {
  const data = searchResultsCache[String(modelId)];
  if (!data) { showToast('未找到缓存数据'); return; }
  openMetaModal({
    id: modelId, name: data.name, type: data.type,
    version: data.version, versions: data.allVersions || (data.version ? [data.version] : []),
    selectedVersion: data.version,
    images: data.images || [],
    metrics: data.metrics, user: data.user,
  });
}

// Open metadata for a local model
function openLocalMeta(idx) {
  const m = localModelsData[idx];
  if (!m) return;
  const trainedWords = (m.trained_words || []).map(w => typeof w === 'string' ? { word: w } : w);
  // Collect images: local preview first, then all CivitAI images from info
  const images = [];
  if (m.has_preview && m.preview_path) {
    images.push({ url: `/api/local_models/preview?path=${encodeURIComponent(m.preview_path)}` });
  }
  if (m.images && Array.isArray(m.images)) {
    m.images.forEach(img => images.push(img));
  } else if (m.civitai_image) {
    images.push({ url: m.civitai_image });
  }

  openMetaModal({
    id: m.civitai_id || '-', name: m.name || m.filename,
    type: m.category || '', file: m.filename,
    sha256: m.sha256 || '',
    version: {
      id: m.civitai_version_id || '',
      name: m.version_name || '',
      baseModel: m.base_model || '',
      trainedWords,
      hashes: m.sha256 ? { SHA256: m.sha256 } : {},
    },
    images,
  });
}

// ========== API Key ==========
async function loadApiKey() {
  try {
    const r = await fetch('/api/config');
    const d = await r.json();
    apiKey = d.api_key || '';
  } catch (e) { console.error(e); }
}
// Config modal removed — API key management moved to Settings page

// ========== Dashboard ==========
let dashboardRefreshTimer = null;
function startDashboardSSE() {
  stopDashboardSSE();
  dashboardRefreshTimer = setInterval(refreshDashboard, 3000);
}
function stopDashboardSSE() {
  if (dashboardRefreshTimer) { clearInterval(dashboardRefreshTimer); dashboardRefreshTimer = null; }
}

async function refreshDashboard() {
  const statsEl = document.getElementById('sys-stats');
  const svcEl = document.getElementById('svc-tbody');
  loadTunnelLinks();

  try {
    const [sysR, svcR] = await Promise.all([fetch('/api/system'), fetch('/api/services')]);
    const sys = await sysR.json();
    const svc = await svcR.json();

    // Stats cards
    let html = '';
    // CPU
    html += `<div class="stat-card"><div class="stat-label">CPU</div><div class="stat-value">${fmtPct(sys.cpu?.percent)}</div>
      <div class="stat-sub">${sys.cpu?.cores || '?'} cores • Load ${sys.cpu?.load ? (sys.cpu.load['1m'] || 0).toFixed(1) : '?'}</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${sys.cpu?.percent || 0}%;background:var(--ac)"></div></div></div>`;
    // Memory
    const memPct = sys.memory?.percent || 0;
    html += `<div class="stat-card green"><div class="stat-label">内存</div><div class="stat-value">${fmtPct(memPct)}</div>
      <div class="stat-sub">${fmtBytes(sys.memory?.used)} / ${fmtBytes(sys.memory?.total)}</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${memPct}%;background:var(--green)"></div></div></div>`;
    // Disk
    const diskPct = sys.disk?.percent || 0;
    html += `<div class="stat-card amber"><div class="stat-label">磁盘</div><div class="stat-value">${fmtPct(diskPct)}</div>
      <div class="stat-sub">${fmtBytes(sys.disk?.used)} / ${fmtBytes(sys.disk?.total)}</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${diskPct}%;background:var(--amber)"></div></div></div>`;
    // GPU
    if (sys.gpu && sys.gpu.length > 0) {
      for (const g of sys.gpu) {
        const vramPct = g.mem_total > 0 ? (g.mem_used / g.mem_total * 100) : 0;
        html += `<div class="stat-card cyan"><div class="stat-label">GPU ${g.index} - ${g.name}</div>
          <div class="stat-value">${g.util}%</div>
          <div class="stat-sub">VRAM ${g.mem_used}MB / ${g.mem_total}MB • ${g.temp}°C${g.power ? ' • ' + g.power.toFixed(0) + 'W' : ''}</div>
          <div class="progress-bar"><div class="progress-fill" style="width:${vramPct}%;background:var(--cyan)"></div></div></div>`;
      }
    }
    statsEl.innerHTML = html;

    // Services
    if (svc.services && svc.services.length > 0) {
      svcEl.innerHTML = svc.services.map(s => {
        const st = s.status || 'unknown';
        const dotClass = st === 'online' ? 'online' : st === 'stopped' ? 'stopped' : 'errored';
        return `<tr>
          <td><strong>${s.name}</strong><br><span style="font-size:.75rem;color:var(--t3)">PID: ${s.pid || '-'}</span></td>
          <td><span class="svc-status"><span class="svc-dot ${dotClass}"></span>${st}</span></td>
          <td>${(s.cpu || 0).toFixed(1)}%</td><td>${fmtBytes(s.memory || 0)}</td><td>${s.restarts}</td>
          <td><div class="btn-group">
            <button class="btn btn-sm btn-success" onclick="svcAction('${s.name}','start')">▶</button>
            <button class="btn btn-sm btn-danger" onclick="svcAction('${s.name}','stop')">⏹</button>
            <button class="btn btn-sm" onclick="svcAction('${s.name}','restart')">🔄</button>
          </div></td></tr>`;
      }).join('');
    } else {
      svcEl.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--t3);padding:20px">未发现 PM2 服务 (PM2 可能未安装或未运行)</td></tr>';
    }
  } catch (e) {
    statsEl.innerHTML = `<div class="error-msg">无法连接后端: ${e.message}</div>`;
  }
}

async function svcAction(name, action) {
  try {
    await fetch(`/api/services/${name}/${action}`, { method: 'POST' });
    showToast(`${action} ${name} 完成`);
    setTimeout(refreshDashboard, 1000);
  } catch (e) { showToast('操作失败: ' + e.message); }
}

// ========== Local Models ==========
let localModelsData = [];

async function loadLocalModels() {
  const grid = document.getElementById('local-models-grid');
  const status = document.getElementById('local-models-status');
  const cat = document.getElementById('model-category').value;
  grid.innerHTML = '<div class="loading"><div class="spinner"></div><div>扫描模型文件...</div></div>';
  status.innerHTML = '';

  try {
    const r = await fetch(`/api/local_models?category=${cat}`);
    const d = await r.json();
    localModelsData = d.models || [];
    status.innerHTML = `<div class="success-msg" style="display:flex;justify-content:space-between;align-items:center">
      <span>找到 ${d.total} 个模型文件</span>
      <span style="font-size:.78rem;color:var(--t2)">${localModelsData.filter(m => m.has_info).length} 已有元数据</span></div>`;

    if (localModelsData.length === 0) {
      grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--t3)">该类别下未找到模型文件</div>';
      return;
    }

    grid.innerHTML = localModelsData.map((m, i) => renderLocalModelCard(m, i)).join('');
  } catch (e) {
    grid.innerHTML = `<div class="error-msg">加载失败: ${e.message}</div>`;
  }
}

function renderLocalModelCard(m, idx) {
  const badgeClass = getBadgeClass(m.category);
  const sizeStr = fmtBytes(m.size_bytes);
  const twHtml = (m.trained_words || []).slice(0, 5).map(w =>
    `<span class="tw-tag" onclick="copyText('${w.replace(/'/g, "\\'")}')" title="点击复制">${w}</span>`
  ).join('');

  let imgHtml;
  if (m.has_preview && m.preview_path) {
    const pUrl = `/api/local_models/preview?path=${encodeURIComponent(m.preview_path)}`;
    imgHtml = `<img src="${pUrl}" alt="" onclick="openImg('${pUrl}')" style="cursor:zoom-in" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy"><div class="model-card-no-img" style="display:none;position:absolute;inset:0">📦 无预览</div>`;
  } else if (m.civitai_image) {
    imgHtml = `<img src="${m.civitai_image}" alt="" onclick="openImg('${m.civitai_image}')" style="cursor:zoom-in" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy"><div class="model-card-no-img" style="display:none;position:absolute;inset:0">📦</div>`;
  } else {
    imgHtml = `<div class="model-card-no-img">📦 无预览</div>`;
  }

  return `<div class="model-card" data-idx="${idx}">
    <div class="model-card-img">${imgHtml}</div>
    <div class="model-card-body">
      <div class="model-card-title" title="${(m.name || '').replace(/"/g, '&quot;')}">${m.name}</div>
      <div class="model-card-meta">
        <span class="badge ${badgeClass}">${m.category}</span>
        ${m.base_model ? `<span class="badge badge-other">${m.base_model}</span>` : ''}
        <span class="model-card-size">${sizeStr}</span>
        ${m.has_info ? '<span style="font-size:.7rem;color:var(--green)">✓ 已获取信息</span>' : ''}
      </div>
      ${twHtml ? `<div class="model-card-tags">${twHtml}</div>` : ''}
      <div class="model-card-actions">
        <button class="btn btn-sm" onclick="fetchModelInfo(${idx})" ${m.has_info ? 'title="重新获取"' : 'title="从 CivitAI 获取信息"'}>${m.has_info ? '🔄 刷新' : '📥 获取信息'}</button>
        <button class="btn btn-sm btn-success" onclick="openLocalMeta(${idx})">📄 详情</button>
        <button class="btn btn-sm btn-danger" onclick="deleteModel(${idx})">🗑️</button>
      </div>
    </div></div>`;
}

function getBadgeClass(cat) {
  const m = { checkpoints: 'badge-checkpoint', loras: 'badge-loras', controlnet: 'badge-controlnet', vae: 'badge-vae', embeddings: 'badge-embeddings', upscale_models: 'badge-other' };
  return m[cat] || 'badge-other';
}

async function fetchModelInfo(idx) {
  const m = localModelsData[idx];
  if (!m) return;
  showToast(`正在查询 ${m.filename}...`);
  try {
    const r = await fetch('/api/local_models/fetch_info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ abs_path: m.abs_path })
    });
    const d = await r.json();
    if (d.ok) { showToast(`✅ ${m.filename} 信息获取成功`); loadLocalModels(); }
    else showToast(`❌ ${d.error || '未知错误'}`);
  } catch (e) { showToast('请求失败: ' + e.message); }
}

async function fetchAllInfo() {
  const noInfo = localModelsData.filter(m => !m.has_info);
  if (noInfo.length === 0) { showToast('所有模型已有信息'); return; }
  if (!confirm(`将为 ${noInfo.length} 个模型获取信息，可能需要较长时间。继续？`)) return;

  for (let i = 0; i < noInfo.length; i++) {
    const m = noInfo[i];
    document.getElementById('local-models-status').innerHTML = `<div class="success-msg">⏳ 正在获取 (${i + 1}/${noInfo.length}): ${m.filename}</div>`;
    try {
      await fetch('/api/local_models/fetch_info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ abs_path: m.abs_path })
      });
    } catch (e) { console.error(m.filename, e); }
  }
  showToast(`✅ 全部完成`);
  loadLocalModels();
}

async function _autoFetchMetadataForNewDownloads() {
  // Silently scan local models and fetch metadata for any missing info
  try {
    const r = await fetch('/api/local_models');
    if (!r.ok) return;
    const data = await r.json();
    const allModels = data.models || [];
    const noInfo = allModels.filter(m => !m.has_info);
    if (noInfo.length === 0) return;
    showToast(`🔄 自动获取 ${noInfo.length} 个新模型的元数据...`);
    let ok = 0;
    for (const m of noInfo) {
      try {
        const fr = await fetch('/api/local_models/fetch_info', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ abs_path: m.abs_path })
        });
        if (fr.ok) ok++;
      } catch (e) { console.error('Auto-fetch metadata failed:', m.filename, e); }
    }
    showToast(`✅ 元数据自动获取完成 (${ok}/${noInfo.length})`);
    // Refresh model list if user is on models page
    if (document.getElementById('local-models-grid')) loadLocalModels();
  } catch (e) { console.error('_autoFetchMetadataForNewDownloads error:', e); }
}

async function deleteModel(idx) {
  const m = localModelsData[idx];
  if (!m) return;
  if (!confirm(`确定删除 ${m.filename}？\n此操作不可恢复！`)) return;
  try {
    const r = await fetch('/api/local_models/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ abs_path: m.abs_path })
    });
    const d = await r.json();
    if (d.ok) { showToast(`🗑️ 已删除 ${m.filename}`); loadLocalModels(); }
    else showToast('删除失败: ' + (d.error || ''));
  } catch (e) { showToast('请求失败: ' + e.message); }
}

// ========== CivitAI Search ==========
let searchPage = 0;
let facetsLoaded = false;
const TYPE_MAP = { 'Checkpoint': 'Checkpoint', 'LORA': 'LORA', 'TextualInversion': 'Embedding', 'Controlnet': 'ControlNet', 'Upscaler': 'Upscaler', 'VAE': 'VAE', 'Poses': 'Poses' };

async function loadFacets() {
  if (facetsLoaded) return;
  const typeChips = document.getElementById('filter-type-chips');
  const bmChips = document.getElementById('filter-bm-chips');

  typeChips.innerHTML = '<span class="loading-mini">Loading types...</span>';
  bmChips.innerHTML = '<span class="loading-mini">Loading base models...</span>';

  try {
    const r = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queries: [{
          indexUid: 'models_v9',
          q: '',
          limit: 0,
          facets: ['type', 'version.baseModel']
        }]
      })
    });

    const d = await r.json();
    if (!d.results || !d.results[0]) throw new Error('Invalid response');
    const facets = d.results[0].facetDistribution || {};

    const renderChips = (container, counts, labelMap = {}) => {
      const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      container.innerHTML = sorted.map(k => {
        const label = labelMap[k] || k;
        const count = counts[k];
        // Format count: 1.2k if > 1000
        const countStr = count > 1000 ? (count / 1000).toFixed(1) + 'k' : count;
        return `<span class="chip" data-val="${k}" onclick="toggleChip(this)">${label} <span style="font-size:0.75em;opacity:0.6;margin-left:4px">${countStr}</span></span>`;
      }).join('');
    };

    renderChips(typeChips, facets['type'] || {}, TYPE_MAP);
    renderChips(bmChips, facets['version.baseModel'] || {});

    facetsLoaded = true;
  } catch (e) {
    console.error("Failed to load facets", e);
    typeChips.innerHTML = '<span class="error-msg">Failed to load types</span>';
    bmChips.innerHTML = '<span class="error-msg">Failed to load base models</span>';
  }
}

function toggleChip(el) { el.classList.toggle('active'); }

function getActiveChips(containerId) {
  return [...document.querySelectorAll(`#${containerId} .chip.active`)].map(c => c.dataset.val);
}

function switchCivitTab(tab) {
  document.querySelectorAll('[data-ctab]').forEach(t => t.classList.toggle('active', t.dataset.ctab === tab));
  ['search', 'lookup', 'cart'].forEach(t => {
    const el = document.getElementById('ctab-' + t);
    if (el) el.classList.toggle('hidden', t !== tab);
  });
  if (tab === 'cart') renderCart();
}

function _isIdQuery(text) {
  // Check if ALL parts are numeric IDs or CivitAI URLs
  const parts = text.split(/[,\s\n]+/).filter(p => p.trim());
  if (parts.length === 0) return false;
  return parts.every(p => /^\d+$/.test(p.trim()) || /civitai\.com\/models\/\d+/.test(p.trim()));
}

function smartSearch() {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;
  if (_isIdQuery(query)) {
    lookupIds(query);
  } else {
    searchModels(0, false);
  }
}

async function searchModels(page = 0, append = false) {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;
  if (isSearchLoading) return;

  searchPage = page;
  isSearchLoading = true;
  const loading = document.getElementById('search-loading');
  const results = document.getElementById('search-results');
  const pag = document.getElementById('search-pagination');
  const errEl = document.getElementById('search-error');
  errEl.innerHTML = '';
  loading.classList.remove('hidden');
  if (!append) { results.innerHTML = ''; pag.innerHTML = ''; searchResultsCache = {}; }

  const types = getActiveChips('filter-type-chips');
  const bms = getActiveChips('filter-bm-chips');
  const sort = document.getElementById('filter-sort').value;
  const limit = 20;
  const offset = page * limit;

  // Build Meilisearch query
  const filter = [];
  if (types.length > 0) filter.push(types.map(t => `type = "${t}"`).join(' OR '));
  if (bms.length > 0) filter.push(bms.map(b => `version.baseModel = "${b}"`).join(' OR '));
  filter.push('nsfwLevel <= 4');

  const sortMap = {
    'Most Downloaded': ['metrics.downloadCount:desc'],
    'Highest Rated': ['metrics.thumbsUpCount:desc'],
    'Newest': ['createdAt:desc'],
    'Relevancy': []
  };

  const body = {
    queries: [{
      indexUid: 'models_v9', q: query, limit, offset,
      filter: filter.length > 0 ? filter : undefined,
      sort: sortMap[sort] || [],
      attributesToRetrieve: ['id', 'name', 'type', 'metrics', 'images', 'version', 'versions', 'lastVersionAtUnix', 'user', 'nsfwLevel'],
      attributesToHighlight: ['name'],
    }]
  };

  try {
    const r = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    loading.classList.add('hidden');
    isSearchLoading = false;

    const res = (d.results || [])[0] || {};
    const hits = res.hits || [];
    const total = res.estimatedTotalHits || 0;

    if (hits.length === 0 && !append) {
      results.innerHTML = '<div style="text-align:center;padding:40px;color:var(--t3)">没有找到匹配的模型</div>';
      hasMoreResults = false;
      return;
    }

    const cardsHtml = hits.map(h => renderCivitCard(h)).join('');
    if (append) {
      results.insertAdjacentHTML('beforeend', cardsHtml);
    } else {
      results.innerHTML = cardsHtml;
    }

    // Check if more results
    const loaded = (page + 1) * limit;
    hasMoreResults = loaded < total;

    // Infinite scroll sentinel
    pag.innerHTML = '';
    if (hasMoreResults) {
      pag.innerHTML = `<div id="scroll-sentinel" style="text-align:center;padding:16px;color:var(--t3);font-size:.82rem">⏳ 向下滚动加载更多 (${Math.min(loaded, total)}/${total})</div>`;
      setupScrollObserver();
    } else {
      pag.innerHTML = `<div style="text-align:center;padding:16px;color:var(--t3);font-size:.82rem">— 共 ${total} 个结果 —</div>`;
    }
  } catch (e) {
    loading.classList.add('hidden');
    isSearchLoading = false;
    errEl.innerHTML = `<div class="error-msg">搜索失败: ${e.message}</div>`;
  }
}

function setupScrollObserver() {
  if (searchObserver) searchObserver.disconnect();
  const sentinel = document.getElementById('scroll-sentinel');
  if (!sentinel) return;
  searchObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && hasMoreResults && !isSearchLoading) {
      searchModels(searchPage + 1, true);
    }
  }, { rootMargin: '200px' });
  searchObserver.observe(sentinel);
}

function renderCivitCard(h) {
  // Meilisearch returns 'version' (single object), not 'modelVersions' (array)
  const ver = h.version || null;
  const allVersions = h.versions || (ver ? [ver] : []);
  // Prefer first non-video image for card thumbnail
  const allImgs = h.images && h.images.length > 0 ? h.images : (ver?.images || []);
  const imageObj = allImgs.find(i => i.type !== 'video') || allImgs[0] || null;

  let imgUrl = '';
  if (imageObj && imageObj.url) {
    if (imageObj.url.startsWith('http')) imgUrl = imageObj.url;
    else imgUrl = `https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/${imageObj.url}/width=450/default.jpg`;
  }

  let fullUrl = imgUrl ? imgUrl.replace('/width=450', '') : '';

  const typeLower = (h.type || '').toLowerCase();
  let badgeKey = typeLower;
  if (typeLower === 'checkpoint') badgeKey = 'checkpoints';
  if (typeLower === 'lora') badgeKey = 'loras';
  if (typeLower === 'textualinversion') badgeKey = 'embeddings';

  const badgeClass = getBadgeClass(badgeKey);
  const bm = ver?.baseModel || '';
  const inCart = selectedModels.has(String(h.id));
  const vCount = allVersions.length;

  // Cache data for cart and metadata (avoids unsafe inline JSON)
  searchResultsCache[String(h.id)] = {
    name: h.name || 'Unknown', type: h.type || '',
    image: imgUrl, version: ver, allVersions,
    images: h.images || [], metrics: h.metrics || {},
    user: h.user || {},
  };

  return `<div class="model-card">
    <div class="model-card-img">${imgUrl ? `<img src="${imgUrl}" alt=""
      onclick="openImg('${fullUrl.replace(/'/g, "\\'")}')"
      style="cursor:zoom-in" onerror="if(!this.dataset.retry&&'${fullUrl.replace(/'/g, "\\'")}'.length>0){this.dataset.retry='1';this.src='${fullUrl.replace(/'/g, "\\'")}'}else{this.style.display='none'}" loading="lazy">` : '<div class="model-card-no-img">📦</div>'}</div>
    <div class="model-card-body">
      <div class="model-card-title" title="${(h.name || '').replace(/"/g, '&quot;')}">${h.name || 'Unknown'}</div>
      <div class="model-card-meta">
        <span class="badge ${badgeClass}">${h.type || ''}</span>
        ${bm ? `<span class="badge badge-other">${bm}</span>` : ''}
        ${vCount > 1 ? `<span class="badge badge-other" title="${vCount} 个版本">v${vCount}</span>` : ''}
        <span style="font-size:.75rem;color:var(--t2)">⬇️ ${(h.metrics?.downloadCount || 0).toLocaleString()}</span>
      </div>
      <div class="model-card-actions">
        <button class="btn btn-sm btn-success" onclick="openMetaFromCache('${h.id}')">📄 详情</button>
        <button class="btn btn-sm ${inCart ? 'btn-danger' : 'btn-primary'}" onclick="toggleCartFromSearch('${h.id}', this)">${inCart ? '✕ 移除' : '🛒 加入'}</button>
        <button class="btn btn-sm" onclick="downloadFromSearch('${h.id}', '${(h.type || 'Checkpoint').toLowerCase()}')">📥 下载</button>
      </div>
    </div></div>`;
}

function toggleCartFromSearch(id, btn) {
  id = String(id);
  if (selectedModels.has(id)) {
    selectedModels.delete(id);
    btn.textContent = '🛒 加入';
    btn.classList.remove('btn-danger'); btn.classList.add('btn-primary');
  } else {
    const data = searchResultsCache[id] || {};
    selectedModels.set(id, {
      name: data.name || 'Unknown', type: data.type || '',
      imageUrl: data.image || '',
      versionId: data.version?.id, versionName: data.version?.name,
      baseModel: data.version?.baseModel,
    });
    btn.textContent = '✕ 移除';
    btn.classList.add('btn-danger'); btn.classList.remove('btn-primary');
  }
  saveCartToStorage(); updateCartBadge();
}

async function downloadFromSearch(modelId, modelType) {
  // Check if multiple versions available → show picker
  const cached = searchResultsCache[String(modelId)];
  const allVersions = cached?.allVersions || [];
  if (allVersions.length > 1) {
    showVersionPicker(modelId, modelType, allVersions);
    return;
  }
  // Single version: download directly
  const versionId = cached?.version?.id || null;
  await doDownload(modelId, modelType, versionId);
}

async function doDownload(modelId, modelType, versionId) {
  showToast(`正在发送下载请求: ${modelId}${versionId ? ' (v' + versionId + ')' : ''}...`);
  try {
    const payload = { model_id: modelId, model_type: modelType };
    if (versionId) payload.version_id = versionId;
    const r = await fetch('/api/download', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const d = await r.json();
    if (d.error) showToast('❌ ' + d.error);
    else showToast('✅ ' + (d.message || '下载任务已提交'));
  } catch (e) { showToast('请求失败: ' + e.message); }
}

// ========== Version Picker ==========
function showVersionPicker(modelId, modelType, versions) {
  const title = document.getElementById('vp-title');
  const body = document.getElementById('vp-body');
  const cached = searchResultsCache[String(modelId)];
  title.textContent = `选择版本 - ${cached?.name || modelId}`;

  let html = '<div style="display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow-y:auto">';
  versions.forEach(v => {
    const bm = v.baseModel ? `<span class="badge badge-other" style="font-size:.72rem">${v.baseModel}</span>` : '';
    html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg2);border:1px solid var(--bd);border-radius:var(--rs)">
      <div>
        <span style="font-weight:500">${v.name || v.id}</span> ${bm}
      </div>
      <button class="btn btn-sm btn-primary" onclick="closeVersionPicker(); doDownload('${modelId}', '${modelType}', '${v.id}')">📥 下载</button>
    </div>`;
  });
  html += '</div>';
  body.innerHTML = html;
  document.getElementById('version-picker-modal').classList.add('active');
}

function closeVersionPicker() {
  document.getElementById('version-picker-modal').classList.remove('active');
}

// ========== ID Lookup ==========
function parseIds(text) {
  const ids = [];
  for (const part of text.split(/[,\s\n]+/)) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/models\/(\d+)/);
    if (m) ids.push(m[1]);
    else if (/^\d+$/.test(t)) ids.push(t);
  }
  return [...new Set(ids)];
}

async function lookupIds(text) {
  if (!text) text = document.getElementById('search-input')?.value?.trim() || '';
  const ids = parseIds(text);
  if (ids.length === 0) { showToast('请输入有效的模型 ID'); return; }

  const loading = document.getElementById('search-loading');
  const results = document.getElementById('search-results');
  const errEl = document.getElementById('search-error');
  const progress = document.getElementById('lookup-progress');
  const pag = document.getElementById('search-pagination');
  errEl.innerHTML = '';
  results.innerHTML = '';
  if (pag) pag.innerHTML = '';
  loading.classList.remove('hidden');

  const found = [];
  for (let i = 0; i < ids.length; i++) {
    progress.textContent = `(${i + 1}/${ids.length}) 查询 ID: ${ids[i]}`;
    try {
      const r = await fetch(`${CIVITAI_API_BASE}/models/${ids[i]}`, { headers: getAuthHeaders() });
      if (r.ok) {
        const data = await r.json();
        found.push(data);
      }
    } catch (e) { console.error(ids[i], e); }
  }

  loading.classList.add('hidden');
  if (found.length === 0) { errEl.innerHTML = '<div class="error-msg">未找到任何模型</div>'; return; }

  results.innerHTML = found.map(d => {
    const img = d.modelVersions?.[0]?.images?.[0]?.url || '';
    const bm = d.modelVersions?.[0]?.baseModel || '';
    const inCart = selectedModels.has(String(d.id));
    const vCount = (d.modelVersions || []).length;
    // Cache for cart and metadata
    searchResultsCache[String(d.id)] = {
      name: d.name || 'Unknown', type: d.type || '',
      image: img, version: d.modelVersions?.[0] || null,
      allVersions: d.modelVersions || [],
      images: d.modelVersions?.[0]?.images || [],
      metrics: d.stats || {}, user: d.creator || {},
    };
    return `<div class="model-card">
      <div class="model-card-img">${img ? `<img src="${img}" alt="" onclick="openImg('${img.replace(/'/g, "\\\'")}')" style="cursor:zoom-in" loading="lazy">` : '<div class="model-card-no-img">📦</div>'}</div>
      <div class="model-card-body">
        <div class="model-card-title">${d.name || ''}</div>
        <div class="model-card-meta">
          <span class="badge ${getBadgeClass((d.type || '').toLowerCase())}">${d.type || ''}</span>
          ${bm ? `<span class="badge badge-other">${bm}</span>` : ''}
          ${vCount > 1 ? `<span class="badge badge-other" title="${vCount} 个版本">v${vCount}</span>` : ''}
          <span style="font-size:.75rem;color:var(--t2)">⬇️ ${d.stats?.downloadCount?.toLocaleString() || 0}</span>
        </div>
        <div class="model-card-actions">
          <button class="btn btn-sm btn-success" onclick="openMetaFromCache('${d.id}')">📄 详情</button>
          <button class="btn btn-sm ${inCart ? 'btn-danger' : 'btn-primary'}" onclick="toggleCartFromSearch('${d.id}', this)">${inCart ? '✕ 移除' : '🛒 加入'}</button>
          <button class="btn btn-sm" onclick="downloadFromSearch('${d.id}', '${(d.type || 'Checkpoint').toLowerCase()}')">📥 下载</button>
        </div>
      </div></div>`;
  }).join('');
}

// ========== Cart ==========
function renderCart() {
  const container = document.getElementById('cart-content');
  if (selectedModels.size === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--t3)">🛒 购物车为空</div>';
    return;
  }
  let html = '<table class="svc-table"><thead><tr><th></th><th>模型</th><th>类型</th><th>版本</th><th>操作</th></tr></thead><tbody>';
  for (const [id, m] of selectedModels) {
    const safeName = (m.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cached = searchResultsCache[String(id)];
    const allVersions = cached?.allVersions || [];
    let versionCell = m.versionName || '-';
    if (allVersions.length > 1) {
      const opts = allVersions.map(v => {
        const sel = String(v.id) === String(m.versionId) ? 'selected' : '';
        return `<option value="${v.id}" ${sel}>${v.name || v.id}${v.baseModel ? ' (' + v.baseModel + ')' : ''}</option>`;
      }).join('');
      versionCell = `<select class="meta-version-select" onchange="changeCartVersion('${id}', this.value)" style="max-width:140px">${opts}</select>`;
    }
    html += `<tr>
      <td><img src="${m.imageUrl || ''}" style="width:48px;height:32px;object-fit:cover;border-radius:4px;cursor:zoom-in" onclick="openImg('${(m.imageUrl || '').replace(/'/g, "\\'")}')"
        onerror="this.style.display='none'"></td>
      <td><a href="https://civitai.com/models/${id}" target="_blank" style="color:var(--ac)">${safeName}</a><br><span style="font-size:.72rem;color:var(--t3)">ID: ${id}</span></td>
      <td><span class="badge ${getBadgeClass((m.type || '').toLowerCase())}">${m.type}</span></td>
      <td>${versionCell}</td>
      <td><button class="btn btn-sm btn-danger" onclick="removeFromCart('${id}')">✕</button></td></tr>`;
  }
  html += '</tbody></table>';

  // Batch download button
  html += `<div style="margin-top:12px;display:flex;gap:8px;align-items:center">
    <button class="btn btn-sm btn-primary" onclick="batchDownloadCart()">📥 一键下载全部 (${selectedModels.size})</button>
    <button class="btn btn-sm btn-danger" onclick="if(confirm('确定清空购物车?')){selectedModels.clear();saveCartToStorage();updateCartBadge();renderCart();}">🗑️ 清空购物车</button>
  </div>`;

  // Live ID textarea
  const ids = [...selectedModels.keys()].join(', ');
  html += `<div style="margin-top:16px">
    <label style="font-size:.82rem;color:var(--t2);display:block;margin-bottom:6px">模型 ID 列表 (可直接在文本框中编辑)</label>
    <textarea class="cart-ids-box" id="cart-ids-textarea" oninput="syncCartFromTextarea(this)">${ids}</textarea>
  </div>`;

  container.innerHTML = html;
}

function changeCartVersion(modelId, versionId) {
  modelId = String(modelId);
  const cached = searchResultsCache[modelId];
  if (!cached || !cached.allVersions) return;
  const newVer = cached.allVersions.find(v => String(v.id) === String(versionId));
  if (!newVer) return;
  const entry = selectedModels.get(modelId);
  if (entry) {
    entry.versionId = newVer.id;
    entry.versionName = newVer.name;
    entry.baseModel = newVer.baseModel;
    saveCartToStorage();
    updateCartIdsTextarea();
  }
}

function updateCartIdsTextarea() {
  const ta = document.getElementById('cart-ids-textarea');
  if (ta) ta.value = [...selectedModels.keys()].join(', ');
}

function syncCartFromTextarea(el) {
  // Parse IDs from textarea and sync cart
  const text = el.value;
  const ids = parseIds(text);
  // Remove IDs not in textarea
  for (const existingId of [...selectedModels.keys()]) {
    if (!ids.includes(existingId)) {
      selectedModels.delete(existingId);
    }
  }
  // Add new IDs (with minimal data)
  for (const id of ids) {
    if (!selectedModels.has(id)) {
      const cached = searchResultsCache[id];
      selectedModels.set(id, {
        name: cached?.name || `Model #${id}`, type: cached?.type || '',
        imageUrl: cached?.image || '',
        versionId: cached?.version?.id, versionName: cached?.version?.name,
        baseModel: cached?.version?.baseModel,
      });
    }
  }
  saveCartToStorage(); updateCartBadge();
  // Debounce pending list re-render
  clearTimeout(syncCartFromTextarea._timer);
  syncCartFromTextarea._timer = setTimeout(renderPendingList, 500);
}

function removeFromCart(id) { selectedModels.delete(String(id)); saveCartToStorage(); updateCartBadge(); renderPendingList(); updateCartIdsTextarea(); }

async function batchDownloadCart() {
  if (selectedModels.size === 0) return showToast('购物车为空');
  const total = selectedModels.size;
  showToast(`📥 开始批量下载 ${total} 个模型...`);
  let ok = 0, fail = 0;
  for (const [id, m] of selectedModels) {
    const modelType = (m.type || 'Checkpoint').toLowerCase();
    const versionId = m.versionId || null;
    try {
      const payload = { model_id: id, model_type: modelType };
      if (versionId) payload.version_id = versionId;
      const r = await fetch('/api/download', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const d = await r.json();
      if (d.error) { fail++; } else { ok++; }
    } catch (e) { fail++; }
  }
  showToast(`✅ 批量下载: ${ok} 个已提交${fail > 0 ? `, ${fail} 个失败` : ''}`);
}

function updateCartBadge() {
  const b = document.getElementById('cart-badge');
  b.textContent = selectedModels.size;
  b.style.display = selectedModels.size > 0 ? '' : 'none';
}
function saveCartToStorage() {
  const data = {};
  for (const [id, v] of selectedModels) data[id] = v;
  try { localStorage.setItem('civitai_cart', JSON.stringify(data)); } catch (e) { }
}
function loadCartFromStorage() {
  try {
    const raw = localStorage.getItem('civitai_cart');
    if (!raw) return;
    const data = JSON.parse(raw);
    for (const [id, v] of Object.entries(data)) selectedModels.set(id, v);
  } catch (e) { }
}

// ========== Logs (Settings page) ==========
async function loadSettingsLogs() {
  const lines = document.getElementById('log-lines')?.value || 100;
  const box = document.getElementById('log-content');
  if (!box) return;
  try {
    const r = await fetch(`/api/logs/dashboard?lines=${lines}`);
    const d = await r.json();
    box.textContent = d.logs || '(空)';
    box.scrollTop = box.scrollHeight;
  } catch (e) { box.textContent = '加载失败: ' + e.message; }
}

function toggleAutoLog() {
  if (document.getElementById('log-auto')?.checked) {
    autoLogInterval = setInterval(loadSettingsLogs, 3000);
  } else {
    clearInterval(autoLogInterval);
    autoLogInterval = null;
  }
}

// ========== Download Status ==========
let dlStatusInterval = null;
let _dlCompletedIds = new Set();  // track completed download IDs for auto-metadata

async function refreshDownloadStatus() {
  const activeEl = document.getElementById('dl-active-content');
  const completedEl = document.getElementById('dl-completed-content');
  const failedEl = document.getElementById('dl-failed-content');
  if (!activeEl) return;
  try {
    const r = await fetch('/api/download/status');
    const d = await r.json();
    const active = d.active || [];
    const queue = d.queue || [];
    const history = d.history || [];
    const completed = history.filter(h => h.status === 'completed');
    const failed = history.filter(h => h.status === 'failed' || h.status === 'cancelled');

    // Active + Queue
    if (active.length === 0 && queue.length === 0) {
      activeEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3)">无活跃的下载任务</div>';
    } else {
      let html = '';
      active.forEach(dl => {
        const pct = (dl.progress || 0).toFixed(1);
        const speed = dl.speed ? fmtBytes(dl.speed) + '/s' : '';
        html += `<div class="dl-item">
          <div class="dl-item-info">
            <span class="dl-item-name" title="${dl.filename || ''}">${dl.model_name || dl.filename || dl.id}</span>
            <span class="dl-item-meta">${dl.version_name || ''} ${speed ? '• ' + speed : ''}</span>
          </div>
          <div class="progress-bar" style="height:8px;margin:6px 0"><div class="progress-fill" style="width:${pct}%;background:var(--ac);transition:width .3s"></div></div>
          <div style="display:flex;justify-content:space-between;font-size:.75rem;color:var(--t3)">
            <span>${pct}%</span>
            <button class="btn btn-sm btn-danger" style="padding:2px 8px;font-size:.7rem" onclick="cancelDownload('${dl.id}')">取消</button>
          </div>
        </div>`;
      });
      queue.forEach(dl => {
        html += `<div class="dl-item">
          <div class="dl-item-info">
            <span class="dl-item-name">${dl.model_name || dl.filename || dl.id}</span>
            <span class="dl-item-meta">${dl.version_name || ''} • 等待中</span>
          </div>
          <button class="btn btn-sm btn-danger" style="padding:2px 8px;font-size:.7rem" onclick="cancelDownload('${dl.id}')">取消</button>
        </div>`;
      });
      activeEl.innerHTML = html;
    }

    // Check for new completions → auto-fetch metadata
    const prevSize = _dlCompletedIds.size;
    completed.forEach(dl => _dlCompletedIds.add(dl.id));
    if (prevSize > 0 && _dlCompletedIds.size > prevSize) {
      setTimeout(() => _autoFetchMetadataForNewDownloads(), 3000);
    }

    // Completed
    if (completed.length === 0) {
      completedEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3)">暂无已完成的下载</div>';
    } else {
      let html = '';
      completed.forEach(dl => {
        html += `<div class="dl-item"><div class="dl-item-info">
            <span class="dl-item-name">✅ ${dl.model_name || dl.filename || dl.id}</span>
            <span class="dl-item-meta">${dl.version_name || ''}</span>
          </div></div>`;
      });
      html += `<div style="text-align:right;margin-top:8px"><button class="btn btn-sm" onclick="clearDlHistory()">🗑️ 清除历史</button></div>`;
      completedEl.innerHTML = html;
    }

    // Failed
    if (failed.length === 0) {
      failedEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3)">暂无失败的下载</div>';
    } else {
      let html = '';
      failed.forEach(dl => {
        html += `<div class="dl-item"><div class="dl-item-info">
            <span class="dl-item-name">❌ ${dl.model_name || dl.filename || dl.id}</span>
            <span class="dl-item-meta">${dl.version_name || ''} ${dl.error ? '• ' + dl.error : ''}</span>
          </div>
          <button class="btn btn-sm" style="padding:2px 8px;font-size:.7rem" onclick="retryDownload('${dl.id}')">🔄 重试</button>
        </div>`;
      });
      failedEl.innerHTML = html;
    }

    // Update sub-tab counts
    document.querySelectorAll('[data-dltab="active"]').forEach(t => {
      t.textContent = `🔄 队列${active.length + queue.length > 0 ? ' (' + (active.length + queue.length) + ')' : ''}`;
    });
    document.querySelectorAll('[data-dltab="completed"]').forEach(t => {
      t.textContent = `✅ 已完成${completed.length > 0 ? ' (' + completed.length + ')' : ''}`;
    });
    document.querySelectorAll('[data-dltab="failed"]').forEach(t => {
      t.textContent = `❌ 失败${failed.length > 0 ? ' (' + failed.length + ')' : ''}`;
    });
  } catch (e) {
    activeEl.innerHTML = `<div class="error-msg">获取下载状态失败: ${e.message}</div>`;
  }
}

function startDlStatusPolling() {
  if (dlStatusInterval) return;
  refreshDownloadStatus();
  dlStatusInterval = setInterval(refreshDownloadStatus, 3000);
}
function stopDlStatusPolling() {
  if (dlStatusInterval) { clearInterval(dlStatusInterval); dlStatusInterval = null; }
}

async function cancelDownload(id) {
  try {
    await fetch('/api/download/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ download_id: id }) });
    showToast('已取消');
    refreshDownloadStatus();
  } catch (e) { showToast('取消失败: ' + e.message); }
}

async function retryDownload(id) {
  try {
    const r = await fetch('/api/download/retry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ download_id: id }) });
    const d = await r.json();
    showToast(d.message || '已重试');
    refreshDownloadStatus();
  } catch (e) { showToast('重试失败: ' + e.message); }
}

async function clearDlHistory() {
  try {
    await fetch('/api/download/clear_history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    showToast('历史已清除');
    refreshDownloadStatus();
  } catch (e) { showToast('清除失败: ' + e.message); }
}

let currentDlTab = 'pending';
function switchDlTab(tab) {
  currentDlTab = tab;
  document.querySelectorAll('[data-dltab]').forEach(t => t.classList.toggle('active', t.dataset.dltab === tab));
  ['pending', 'active', 'completed', 'failed'].forEach(id => {
    const el = document.getElementById('dl-' + id + '-content');
    if (el) el.classList.toggle('hidden', id !== tab);
  });
}

async function renderDownloadsTab() {
  // Update ID textarea
  const ta = document.getElementById('cart-ids-textarea');
  if (ta && document.activeElement !== ta) {
    ta.value = [...selectedModels.keys()].join(', ');
  }
  // Render pending (cart)
  renderPendingList();
  // Fetch and render download status
  await refreshDownloadStatus();
}

function renderPendingList() {
  const container = document.getElementById('dl-pending-content');
  if (!container) return;
  if (selectedModels.size === 0) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3)">暂无待下载模型，从 CivitAI 页添加或在上方 ID 框输入</div>';
    return;
  }
  let html = '<table class="svc-table"><thead><tr><th></th><th>模型</th><th>类型</th><th>版本</th><th>操作</th></tr></thead><tbody>';
  for (const [id, m] of selectedModels) {
    const safeName = (m.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cached = searchResultsCache[String(id)];
    const allVersions = cached?.allVersions || [];
    let versionCell = m.versionName || '-';
    if (allVersions.length > 1) {
      const opts = allVersions.map(v => {
        const sel = String(v.id) === String(m.versionId) ? 'selected' : '';
        return `<option value="${v.id}" ${sel}>${v.name || v.id}${v.baseModel ? ' (' + v.baseModel + ')' : ''}</option>`;
      }).join('');
      versionCell = `<select class="meta-version-select" onchange="changeCartVersion('${id}', this.value)" style="max-width:140px">${opts}</select>`;
    }
    html += `<tr>
      <td><img src="${m.imageUrl || ''}" style="width:48px;height:32px;object-fit:cover;border-radius:4px;cursor:zoom-in" onclick="openImg('${(m.imageUrl || '').replace(/'/g, "\\'")}')"
        onerror="this.style.display='none'"></td>
      <td><a href="https://civitai.com/models/${id}" target="_blank" style="color:var(--ac)">${safeName}</a><br><span style="font-size:.72rem;color:var(--t3)">ID: ${id}</span></td>
      <td><span class="badge ${getBadgeClass((m.type || '').toLowerCase())}">${m.type}</span></td>
      <td>${versionCell}</td>
      <td><button class="btn btn-sm btn-danger" onclick="removeFromCart('${id}')">✕</button></td></tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

// ========== Tunnel Links (Dashboard quick links) ==========
async function loadTunnelLinks() {
  const container = document.getElementById('tunnel-links');
  if (!container) return;
  try {
    const r = await fetch('/api/tunnel_links');
    const d = await r.json();
    const links = d.links || [];
    if (links.length === 0) { container.innerHTML = ''; return; }
    container.innerHTML = links.map(l =>
      `<a href="${l.url}" target="_blank" class="btn btn-sm" style="display:inline-flex;align-items:center;gap:4px">${l.icon || '🔗'} ${l.name}</a>`
    ).join(' ');
  } catch (e) { container.innerHTML = ''; }
}

// ========== Tunnel Page ==========
let tunnelAutoRefresh = null;

async function loadTunnelPage() {
  const statusEl = document.getElementById('tunnel-status-info');
  const logEl = document.getElementById('tunnel-log-content');
  try {
    const r = await fetch('/api/tunnel_status');
    const d = await r.json();

    // Status badge
    const st = d.status || 'unknown';
    const stColor = st === 'online' ? 'var(--green)' : st === 'stopped' ? 'var(--red, #e74c3c)' : 'var(--t3)';
    const stLabel = { online: '运行中', stopped: '已停止', errored: '错误', launching: '启动中' }[st] || st;

    // Service links
    const links = d.links || [];
    let linksHtml = '';
    if (links.length > 0) {
      linksHtml = '<div class="tunnel-services">' + links.map(l => {
        const proto = (l.service || '').split('://')[0] || 'http';
        const portInfo = l.port ? `:${l.port}` : '';
        return `<a href="${l.url}" target="_blank" class="tunnel-svc-card">
          <span class="tunnel-svc-icon">${l.icon || '🔗'}</span>
          <span class="tunnel-svc-name">${l.name}</span>
          <span class="tunnel-svc-detail">${l.url}</span>
          <span class="tunnel-svc-port">${proto}${portInfo}</span>
        </a>`;
      }).join('') + '</div>';
    } else {
      linksHtml = '<div style="color:var(--t3);font-size:.85rem;padding:8px 0">未检测到转发服务</div>';
    }

    statusEl.innerHTML = `
      <div class="tunnel-header-row">
        <div class="tunnel-status-badge" style="color:${stColor}">
          <span class="tunnel-dot" style="background:${stColor}"></span> ${stLabel}
        </div>
        <button class="btn btn-sm" onclick="restartTunnel()" style="font-size:.75rem;padding:3px 10px;margin-left:12px">♻️ 重启</button>
      </div>
      <div class="section-title" style="margin-top:16px">🔗 转发服务</div>
      ${linksHtml}`;

    // Logs
    if (d.logs) {
      // Strip PM2 log prefix timestamps if present, and color-code
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
    statusEl.innerHTML = `<div style="color:var(--red,#e74c3c)">加载失败: ${e.message}</div>`;
    logEl.innerHTML = '';
  }
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function restartTunnel() {
  if (!confirm('确定要重启 Cloudflare Tunnel 吗？')) return;
  try {
    await fetch('/api/services/tunnel/restart', { method: 'POST' });
    showToast('Tunnel 正在重启...');
    setTimeout(loadTunnelPage, 3000);
  } catch (e) { showToast('重启失败: ' + e.message); }
}

function startTunnelAutoRefresh() {
  stopTunnelAutoRefresh();
  tunnelAutoRefresh = setInterval(loadTunnelPage, 10000);
}
function stopTunnelAutoRefresh() {
  if (tunnelAutoRefresh) { clearInterval(tunnelAutoRefresh); tunnelAutoRefresh = null; }
}

// ========== ComfyUI Management Page ==========
let comfyAutoRefresh = null;
let _comfyParamsSchema = null;
let _comfyEventSource = null;
let _comfyLogSource = null;
let _comfyExecState = null;  // Current execution state
let _comfyExecTimer = null;  // Timer for elapsed counter

async function loadComfyUIPage() {
  await Promise.all([loadComfyStatus(), loadComfyQueue(), loadComfyParams()]);
  startComfyEventStream();
  startComfyLogStream();
}

// ── SSE: ComfyUI real-time events ──
function startComfyEventStream() {
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

// ── SSE: Real-time log stream ──
function startComfyLogStream() {
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

// ========== Cloud Sync Page ==========
let syncAutoRefresh = null;
let syncStorageCache = null;

async function loadSyncPage() {
  const [statusR, remotesR] = await Promise.allSettled([
    fetch('/api/sync/status').then(r => r.json()),
    fetch('/api/sync/remotes').then(r => r.json())
  ]);

  const status = statusR.status === 'fulfilled' ? statusR.value : {};
  const remotesData = remotesR.status === 'fulfilled' ? remotesR.value : {};
  const prefs = status.prefs || remotesData.prefs || {};

  // Status badge
  const st = status.status || 'unknown';
  const stColor = st === 'online' ? 'var(--green)' : st === 'stopped' ? 'var(--red, #e74c3c)' : 'var(--t3)';
  const stLabel = { online: '运行中', stopped: '已停止', errored: '错误', launching: '启动中' }[st] || st;
  document.getElementById('sync-status-badge').innerHTML = `
    <div class="tunnel-header-row">
      <div class="tunnel-status-badge" style="color:${stColor}">
        <span class="tunnel-dot" style="background:${stColor}"></span> ${stLabel}
      </div>
      <button class="btn btn-sm" onclick="restartSync()" style="font-size:.75rem;padding:3px 10px;margin-left:12px">♻️ 重启</button>
    </div>`;

  // Render structured remote cards
  const remotes = remotesData.remotes || [];
  const grid = document.getElementById('sync-remotes-grid');
  if (remotes.length === 0) {
    grid.innerHTML = '<div style="color:var(--t3);font-size:.85rem;padding:8px 0">未检测到 rclone remote，请通过下方导入配置</div>';
  } else {
    grid.innerHTML = remotes.map(r => renderSyncRemoteCard(r, prefs)).join('');
    // Restore cached storage info so auto-refresh doesn't wipe it
    if (syncStorageCache) {
      for (const r of remotes) {
        const el = document.getElementById(`storage-${r.name}`);
        if (el && syncStorageCache[r.name] !== undefined) {
          renderStorageResult(el, r.name, syncStorageCache[r.name]);
        }
      }
    }
  }

  // Log lines (raw text)
  renderSyncLog(status.log_lines || []);
}

function renderSyncRemoteCard(r, prefs) {
  const p = prefs[r.category] || {};
  const authIcon = r.has_auth ? '✅ 已认证' : '⚠️ 未配置';

  if (r.category === 'r2') {
    return `<div class="sync-remote-card">
      <div class="sync-remote-header">
        <div class="sync-remote-name">${r.icon} ${r.display_name} <span class="sync-remote-type">${r.name}</span></div>
        <span style="font-size:.75rem;color:var(--t3)">${authIcon}</span>
      </div>
      <div style="font-size:.78rem;color:var(--t2);margin:8px 0">部署时从 R2 拉取资产到本地</div>
      <div class="sync-settings">
        <label class="sync-checkbox"><input type="checkbox" ${p.sync_workflows !== false ? 'checked' : ''}
          onchange="updateSyncPref('r2','sync_workflows',this.checked)"> 同步工作流 (workflows)</label>
        <label class="sync-checkbox"><input type="checkbox" ${p.sync_loras !== false ? 'checked' : ''}
          onchange="updateSyncPref('r2','sync_loras',this.checked)"> 同步 LoRA</label>
        <label class="sync-checkbox"><input type="checkbox" ${p.sync_wildcards !== false ? 'checked' : ''}
          onchange="updateSyncPref('r2','sync_wildcards',this.checked)"> 同步 Wildcards</label>
      </div>
      <div class="sync-storage-info" id="storage-${r.name}">
        <button class="btn btn-sm" style="font-size:.7rem;padding:2px 8px" onclick="refreshRemoteStorage('${r.name}')">🔄 查看容量</button>
      </div>
    </div>`;
  }

  const isOutputSync = r.category === 'onedrive' || r.category === 'gdrive';
  const isEnabled = p.enabled || false;
  const dest = p.destination || 'ComfyUI_Transfer';

  return `<div class="sync-remote-card">
    <div class="sync-remote-header">
      <div class="sync-remote-name">${r.icon} ${r.display_name} <span class="sync-remote-type">${r.name}</span></div>
      ${isOutputSync ? `<label class="sync-toggle">
        <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="updateSyncPref('${r.category}','enabled',this.checked)">
        <span class="slider"></span>
      </label>` : ''}
    </div>
    <div style="font-size:.78rem;color:var(--t2);margin:4px 0">${authIcon}</div>
    ${isOutputSync ? `
    <div style="font-size:.78rem;color:var(--t2);margin:8px 0">运行时自动上传 ComfyUI 输出</div>
    <div class="sync-settings">
      <label style="font-size:.78rem;color:var(--t2);display:flex;align-items:center;gap:6px">
        目标文件夹:
        <input type="text" value="${escHtml(dest)}" style="width:180px;font-size:.78rem"
          onchange="updateSyncPref('${r.category}','destination',this.value)">
      </label>
    </div>` : ''}
    <div class="sync-storage-info" id="storage-${r.name}">
      <button class="btn btn-sm" style="font-size:.7rem;padding:2px 8px" onclick="refreshRemoteStorage('${r.name}')">🔄 查看容量</button>
    </div>
  </div>`;
}

async function refreshRemoteStorage(name) {
  const el = document.getElementById(`storage-${name}`);
  if (!el) return;
  el.innerHTML = '<span style="color:var(--t3);font-size:.75rem">查询中...</span>';
  try {
    const r = await fetch('/api/sync/storage');
    const d = await r.json();
    syncStorageCache = d.storage || {};
    const info = syncStorageCache[name];
    if (!info) { renderStorageResult(el, name, null); return; }
    renderStorageResult(el, name, info);
  } catch (e) {
    el.innerHTML = `<span style="font-size:.75rem;color:#e74c3c">查询失败</span>
      <button class="btn btn-sm" style="font-size:.7rem;padding:2px 8px;margin-left:8px" onclick="refreshRemoteStorage('${name}')">重试</button>`;
  }
}

function renderStorageResult(el, name, info) {
  const refreshBtn = `<button class="btn btn-sm" style="font-size:.65rem;padding:1px 6px;margin-left:8px;vertical-align:middle" onclick="refreshRemoteStorage('${name}')">🔄</button>`;
  if (!info) {
    el.innerHTML = `<span style="color:var(--t3);font-size:.75rem">—</span>${refreshBtn}`;
    return;
  }
  if (info.error) {
    const msg = name.toLowerCase().includes('r2') || info.error.includes('not supported')
      ? 'S3 对象存储 (不支持容量查询)' : info.error;
    el.innerHTML = `<span style="font-size:.75rem;color:var(--t3)">${msg}</span>${refreshBtn}`;
    return;
  }
  const used = info.used || 0;
  const total = info.total || 0;
  const free = info.free || 0;
  const pct = total > 0 ? (used / total * 100) : 0;
  const barColor = pct > 90 ? '#e74c3c' : pct > 70 ? '#f39c12' : 'var(--ac)';
  el.innerHTML = `
    <div>已用: ${fmtBytes(used)} / ${fmtBytes(total)}${free ? ` (剩余 ${fmtBytes(free)})` : ''}${refreshBtn}</div>
    <div class="sync-storage-bar">
      <div class="sync-storage-bar-fill" style="width:${pct.toFixed(1)}%;background:${barColor}"></div>
    </div>`;
}

// Legacy wrapper for batch refresh
async function loadSyncStorage(remotes) {
  for (const r of remotes) refreshRemoteStorage(r.name);
}

function renderSyncLog(lines) {
  const el = document.getElementById('sync-log-content');
  if (!lines || lines.length === 0) {
    el.innerHTML = '<div style="color:var(--t3)">暂无同步日志</div>';
    return;
  }
  el.innerHTML = lines.map(line => {
    const esc = escHtml(line);
    // Color-code based on emoji/content
    let cls = '';
    if (line.includes('✅')) cls = 'style="color:var(--green)"';
    else if (line.includes('❌')) cls = 'style="color:var(--red, #e74c3c)"';
    else if (line.includes('📤') || line.includes('🔍')) cls = 'style="color:var(--cyan)"';
    else if (line.includes('☁️') || line.includes('📂') || line.includes('📁')) cls = 'style="color:var(--t2)"';
    return `<div class="sync-log-entry" ${cls}>${esc}</div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

async function updateSyncPref(category, key, value) {
  try {
    const r = await fetch('/api/sync/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, updates: { [key]: value } })
    });
    const d = await r.json();
    if (d.ok) {
      showToast(d.message || '设置已更新');
      if (key === 'enabled') setTimeout(loadSyncPage, 2000);
    } else {
      showToast('操作失败: ' + (d.error || '未知错误'));
      loadSyncPage();
    }
  } catch (e) { showToast('更新失败: ' + e.message); }
}

async function restartSync() {
  if (!confirm('确定要重启 Cloud Sync 服务吗？')) return;
  try {
    await fetch('/api/services/sync/restart', { method: 'POST' });
    showToast('同步服务正在重启...');
    setTimeout(loadSyncPage, 3000);
  } catch (e) { showToast('重启失败: ' + e.message); }
}

let rcloneConfigLoaded = false;

function toggleImportConfig() {
  const box = document.getElementById('import-config-box');
  box.classList.toggle('hidden');
}

async function importConfigFromUrl() {
  const url = document.getElementById('import-url').value.trim();
  if (!url) { showToast('请输入 URL'); return; }
  showToast('正在从 URL 导入...');
  try {
    const r = await fetch('/api/sync/import_config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'url', value: url })
    });
    const d = await r.json();
    if (d.ok) {
      showToast(d.message || '导入成功');
      document.getElementById('import-url').value = '';
      rcloneConfigLoaded = false;
      setTimeout(loadSyncPage, 1000);
    } else {
      showToast('导入失败: ' + (d.error || '未知'));
    }
  } catch (e) { showToast('导入失败: ' + e.message); }
}

async function importConfigFromBase64() {
  const b64 = document.getElementById('import-base64').value.trim();
  if (!b64) { showToast('请输入 base64 编码内容'); return; }
  showToast('正在解码并导入...');
  try {
    const r = await fetch('/api/sync/import_config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'base64', value: b64 })
    });
    const d = await r.json();
    if (d.ok) {
      showToast(d.message || '导入成功');
      document.getElementById('import-base64').value = '';
      rcloneConfigLoaded = false;
      setTimeout(loadSyncPage, 1000);
    } else {
      showToast('导入失败: ' + (d.error || '未知'));
    }
  } catch (e) { showToast('导入失败: ' + e.message); }
}

async function loadRcloneConfig() {
  try {
    const r = await fetch('/api/sync/rclone_config');
    const d = await r.json();
    document.getElementById('rclone-config-content').value = d.config || '';
    rcloneConfigLoaded = true;
    document.getElementById('rclone-save-status').textContent = '';
  } catch (e) {
    document.getElementById('rclone-config-content').value = '加载失败: ' + e.message;
  }
}

async function saveRcloneConfig() {
  const content = document.getElementById('rclone-config-content').value;
  const statusEl = document.getElementById('rclone-save-status');
  if (!content.trim()) { showToast('配置不能为空'); return; }
  if (!confirm('确定要保存 rclone 配置？旧配置将自动备份为 rclone.conf.bak')) return;
  statusEl.textContent = '保存中...';
  try {
    const r = await fetch('/api/sync/rclone_config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: content })
    });
    const d = await r.json();
    if (d.ok) {
      statusEl.textContent = '✅ ' + d.message;
      showToast(d.message);
      // Refresh remotes
      setTimeout(loadSyncPage, 1000);
    } else {
      statusEl.textContent = '❌ ' + (d.error || '保存失败');
      showToast(d.error || '保存失败');
    }
  } catch (e) {
    statusEl.textContent = '❌ ' + e.message;
    showToast('保存失败: ' + e.message);
  }
}

function startSyncAutoRefresh() {
  stopSyncAutoRefresh();
  syncAutoRefresh = setInterval(loadSyncPage, 15000);
}
function stopSyncAutoRefresh() {
  if (syncAutoRefresh) { clearInterval(syncAutoRefresh); syncAutoRefresh = null; }
}

// ========== Settings Page ==========
async function loadSettingsPage() {
  try {
    const [settingsR, debugR] = await Promise.all([
      fetch('/api/settings'),
      fetch('/api/settings/debug')
    ]);
    const settings = await settingsR.json();
    const debugData = await debugR.json();

    // CivitAI status
    const civStatus = document.getElementById('settings-civitai-status');
    if (civStatus) {
      civStatus.textContent = settings.civitai_key_set ? `已配置: ${settings.civitai_key_masked}` : '未设置 API Key';
    }

    // Debug toggle
    const debugToggle = document.getElementById('settings-debug-toggle');
    if (debugToggle) debugToggle.checked = debugData.debug;

    // Show/hide log card based on debug mode
    const logCard = document.getElementById('settings-log-card');
    if (logCard) {
      logCard.style.display = debugData.debug ? 'block' : 'none';
      if (debugData.debug) loadSettingsLogs();
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

async function changePassword() {
  const current = document.getElementById('settings-pw-current').value;
  const newPw = document.getElementById('settings-pw-new').value;
  const confirmPw = document.getElementById('settings-pw-confirm').value;
  if (!current) return showToast('请输入当前密码');
  if (!newPw) return showToast('请输入新密码');
  if (newPw.length < 4) return showToast('密码至少 4 个字符');
  if (newPw !== confirmPw) return showToast('两次输入的密码不一致');
  try {
    const r = await fetch('/api/settings/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current, new: newPw })
    });
    const d = await r.json();
    if (!r.ok) return showToast(d.error || '修改失败');
    showToast('✅ ' + d.message);
    document.getElementById('settings-pw-current').value = '';
    document.getElementById('settings-pw-new').value = '';
    document.getElementById('settings-pw-confirm').value = '';
  } catch (e) {
    showToast('修改失败: ' + e.message);
  }
}

async function saveSettingsCivitaiKey() {
  const key = document.getElementById('settings-civitai-key').value.trim();
  if (!key) return showToast('请输入 API Key');
  try {
    const r = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key })
    });
    const d = await r.json();
    showToast(d.status === 'ok' ? '✅ API Key 已保存' : (d.error || '保存失败'));
    document.getElementById('settings-civitai-key').value = '';
    loadSettingsPage();
    loadApiKey();
  } catch (e) {
    showToast('保存失败: ' + e.message);
  }
}

async function clearSettingsCivitaiKey() {
  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: '' })
    });
    showToast('✅ API Key 已清除');
    loadSettingsPage();
    loadApiKey();
  } catch (e) {
    showToast('清除失败: ' + e.message);
  }
}

async function toggleDebugMode() {
  const enabled = document.getElementById('settings-debug-toggle')?.checked || false;
  try {
    await fetch('/api/settings/debug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    const logCard = document.getElementById('settings-log-card');
    if (logCard) {
      logCard.style.display = enabled ? 'block' : 'none';
      if (enabled) loadSettingsLogs();
    }
    showToast(enabled ? '✅ Debug 模式已开启' : 'Debug 模式已关闭');
  } catch (e) {
    showToast('操作失败: ' + e.message);
  }
}

async function restartDashboard() {
  if (!confirm('确定要重启 Dashboard 吗? 页面将短暂不可用')) return;
  try {
    await fetch('/api/settings/restart', { method: 'POST' });
    showToast('🔄 Dashboard 正在重启, 3 秒后自动刷新...');
    setTimeout(() => location.reload(), 3000);
  } catch (e) {
    showToast('重启失败: ' + e.message);
  }
}

async function reinitialize() {
  const keepModels = document.getElementById('reinit-keep-models')?.checked ?? true;
  const msg = keepModels
    ? '确定要重新初始化吗?\n\n将删除 ComfyUI 安装 (保留模型文件)，停止 ComfyUI 和同步服务，重新进入部署向导。\n\n系统依赖、PyTorch、Tunnel 不受影响。'
    : '确定要重新初始化吗?\n\n将删除整个 ComfyUI 目录 (包括所有模型文件)，停止 ComfyUI 和同步服务，重新进入部署向导。\n\n⚠️ 模型文件将被永久删除！';
  if (!confirm(msg)) return;
  if (!keepModels && !confirm('再次确认: 所有模型文件将被永久删除，无法恢复。继续？')) return;
  try {
    showToast('⏳ 正在重新初始化...');
    const r = await fetch('/api/settings/reinitialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keep_models: keepModels })
    });
    const d = await r.json();
    if (d.ok) {
      showToast('✅ 已重置, 正在跳转到部署向导...');
      setTimeout(() => location.reload(), 1500);
    } else {
      showToast('❌ 部分操作失败: ' + (d.errors || []).join('; '));
    }
  } catch (e) {
    showToast('重新初始化失败: ' + e.message);
  }
}

// ========== Import/Export Modal ==========
function openIEModal() { document.getElementById('ie-modal').classList.add('active'); }
function closeIEModal() { document.getElementById('ie-modal').classList.remove('active'); }

async function exportConfig() {
  try {
    const r = await fetch('/api/settings/export-config');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comfyui-config-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('✅ 配置已导出');
  } catch (e) {
    showToast('导出失败: ' + e.message);
  }
}

async function importConfig(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  event.target.value = '';  // 允许重复选择同一文件
  try {
    const text = await file.text();
    const config = JSON.parse(text);
    if (!config._version) {
      showToast('❌ 无效的配置文件格式');
      return;
    }
    if (!confirm(`确定要导入配置吗?\n\n导出于: ${config._exported_at || '未知'}\n将覆盖当前的密码、API Key、Tunnel Token 等设置。`)) return;
    const r = await fetch('/api/settings/import-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: text
    });
    const d = await r.json();
    showToast(d.ok ? '✅ ' + d.message : '⚠️ ' + d.message);
    closeIEModal();
    if (document.getElementById('page-settings')?.classList.contains('hidden') === false) loadSettingsPage();
  } catch (e) {
    showToast('导入失败: ' + e.message);
  }
}


// ========== Plugin Management ==========
let pluginInstalledRaw = {};    // key -> {ver, cnr_id, aux_id, enabled} from /installed
let pluginGetlistCache = {};    // id -> full info from /getlist
let pluginBrowseData = [];      // flat array of all browsable packs
let pluginBrowseIndex = 0;      // pagination index for browse
const PLUGIN_PAGE_SIZE = 40;
let pluginQueuePollTimer = null;
let currentPluginTab = 'installed';

function switchPluginTab(tab) {
  currentPluginTab = tab;
  document.querySelectorAll('[data-ptab]').forEach(t => t.classList.toggle('active', t.dataset.ptab === tab));
  document.getElementById('ptab-installed').classList.toggle('hidden', tab !== 'installed');
  document.getElementById('ptab-browse').classList.toggle('hidden', tab !== 'browse');
  document.getElementById('ptab-git').classList.toggle('hidden', tab !== 'git');
  if (tab === 'installed') loadInstalledPlugins();
  else if (tab === 'browse' && pluginBrowseData.length === 0) loadBrowsePlugins();
}

async function loadPluginsPage() {
  await loadInstalledPlugins();
  pollPluginQueue();
}

// ---------- Installed Plugins ----------
async function loadInstalledPlugins() {
  const el = document.getElementById('plugin-installed-list');
  el.innerHTML = '<div class="loading"><div class="spinner"></div><br>加载已安装插件...</div>';
  try {
    // Fetch installed list and getlist in parallel to enrich data
    const [instR, listR] = await Promise.allSettled([
      fetch('/api/plugins/installed').then(r => r.ok ? r.json() : Promise.reject(r.statusText)),
      fetch('/api/plugins/available').then(r => r.ok ? r.json() : null)
    ]);
    if (instR.status !== 'fulfilled') throw new Error(instR.reason || '获取已安装列表失败');
    pluginInstalledRaw = instR.value;
    // Cache getlist data for enrichment
    if (listR.status === 'fulfilled' && listR.value) {
      const packs = listR.value.node_packs || listR.value;
      pluginGetlistCache = packs;
      // Also populate browse data
      pluginBrowseData = Object.entries(packs).map(([id, info]) => ({
        id, ...info,
        _title: (info.title || id).toLowerCase(),
        _desc: (info.description || '').toLowerCase(),
      }));
    }
    renderInstalledPlugins();
  } catch (e) {
    el.innerHTML = `<div class="error-msg">加载失败: ${e.message}</div>`;
  }
}

function renderInstalledPlugins() {
  const el = document.getElementById('plugin-installed-list');
  const statsEl = document.getElementById('plugin-installed-stats');
  const filter = (document.getElementById('plugin-installed-filter')?.value || '').toLowerCase();
  const statusFilter = document.getElementById('plugin-installed-status')?.value || 'all';

  // Merge installed data with getlist enrichment
  const packs = Object.entries(pluginInstalledRaw).map(([dirName, inst]) => {
    const cnrId = inst.cnr_id || '';
    const enriched = pluginGetlistCache[cnrId] || {};
    return {
      dirName,
      cnrId,
      title: enriched.title || dirName,
      description: enriched.description || '',
      repository: enriched.repository || enriched.reference || (inst.aux_id ? `https://github.com/${inst.aux_id}` : ''),
      author: enriched.author || (inst.aux_id ? inst.aux_id.split('/')[0] : ''),
      stars: enriched.stars != null ? enriched.stars : 0,
      ver: inst.ver || '',
      activeVersion: enriched.active_version || inst.ver || '',
      cnrLatest: enriched.cnr_latest || '',
      enabled: inst.enabled !== false,
      updateState: enriched['update-state'] === 'true' || enriched['update-state'] === true,
    };
  });

  let filtered = packs.filter(p => {
    if (filter && !p.title.toLowerCase().includes(filter) && !p.description.toLowerCase().includes(filter) && !p.cnrId.includes(filter) && !p.dirName.toLowerCase().includes(filter)) return false;
    if (statusFilter === 'enabled' && !p.enabled) return false;
    if (statusFilter === 'disabled' && p.enabled) return false;
    if (statusFilter === 'update' && !p.updateState) return false;
    return true;
  });

  // Sort: updates first, then by title
  filtered.sort((a, b) => {
    if (a.updateState && !b.updateState) return -1;
    if (!a.updateState && b.updateState) return 1;
    return a.title.localeCompare(b.title);
  });

  const totalCount = packs.length;
  const enabledCount = packs.filter(p => p.enabled).length;
  const updateCount = packs.filter(p => p.updateState).length;
  statsEl.textContent = `共 ${totalCount} 个插件, ${enabledCount} 个启用, ${updateCount} 个有更新 | 显示 ${filtered.length} 个`;

  if (filtered.length === 0) {
    el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--t3)">没有匹配的插件</div>';
    return;
  }

  el.innerHTML = filtered.map(p => {
    const isNightly = p.activeVersion === 'nightly';
    const installedVer = isNightly ? _shortHash(p.ver) : (p.activeVersion || _shortHash(p.ver));
    const latestVer = p.cnrLatest || '';

    let badgeHtml = '';
    if (p.updateState) badgeHtml += '<span class="plugin-badge update">有更新</span>';
    if (!p.enabled) badgeHtml += '<span class="plugin-badge disabled">已禁用</span>';
    else badgeHtml += '<span class="plugin-badge installed">已安装</span>';

    let actionsHtml = '';
    if (p.updateState) actionsHtml += `<button class="btn btn-sm btn-success" onclick="updatePlugin('${_esc(p.cnrId || p.dirName)}','${_esc(p.ver)}')">⬆️ 更新</button>`;
    actionsHtml += `<button class="btn btn-sm" onclick="openPluginVersionModal('${_esc(p.cnrId || p.dirName)}','${_esc(p.title)}')">📋 版本</button>`;
    if (!p.enabled) {
      actionsHtml += `<button class="btn btn-sm btn-primary" onclick="togglePlugin('${_esc(p.cnrId || p.dirName)}','${_esc(p.ver)}')">▶️ 启用</button>`;
    } else {
      actionsHtml += `<button class="btn btn-sm" onclick="togglePlugin('${_esc(p.cnrId || p.dirName)}','${_esc(p.ver)}')">⏸️ 禁用</button>`;
    }
    actionsHtml += `<button class="btn btn-sm btn-danger" onclick="uninstallPlugin('${_esc(p.cnrId || p.dirName)}','${_esc(p.ver)}','${_esc(p.title)}')">🗑️</button>`;

    return `<div class="plugin-item">
      <div class="plugin-item-header">
        <div class="plugin-item-title">${p.repository ? `<a href="${p.repository}" target="_blank">${_h(p.title)}</a>` : _h(p.title)}</div>
        ${badgeHtml}
      </div>
      ${p.description ? `<div class="plugin-item-desc">${_h(p.description)}</div>` : ''}
      <div class="plugin-item-meta">
        <span>📦 ${_h(p.cnrId || p.dirName)}</span>
        <span style="color:var(--cyan)">${isNightly ? '🔧 ' + _h(installedVer) : 'v' + _h(installedVer)}</span>
        ${latestVer ? `<span style="color:var(--t3)">(latest: ${_h(latestVer)})</span>` : ''}
        ${p.stars > 0 ? `<span>⭐ ${p.stars}</span>` : ''}
        ${p.author ? `<span>👤 ${_h(p.author)}</span>` : ''}
        <div class="plugin-item-actions">${actionsHtml}</div>
      </div>
    </div>`;
  }).join('');
}

function _shortHash(h) { return h && h.length > 8 ? h.substring(0, 8) : (h || 'unknown'); }

function filterInstalledPlugins() {
  renderInstalledPlugins();
}

function _esc(s) { return (s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }
function _h(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ---------- Browse Plugins ----------
async function loadBrowsePlugins() {
  const el = document.getElementById('plugin-browse-list');
  el.innerHTML = '<div class="loading"><div class="spinner"></div><br>加载插件列表中 (首次可能较慢)...</div>';
  try {
    // Use cached data if available (loaded by installed tab)
    if (pluginBrowseData.length > 0) {
      searchPlugins();
      return;
    }
    const r = await fetch('/api/plugins/available');
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || r.statusText); }
    const data = await r.json();
    const packs = data.node_packs || data;
    pluginGetlistCache = packs;
    pluginBrowseData = Object.entries(packs).map(([id, info]) => ({
      id, ...info,
      _title: (info.title || id).toLowerCase(),
      _desc: (info.description || '').toLowerCase(),
    }));
    pluginBrowseIndex = 0;
    searchPlugins();
  } catch (e) {
    el.innerHTML = `<div class="error-msg">加载失败: ${e.message}</div>`;
  }
}

function searchPlugins() {
  const query = (document.getElementById('plugin-search-input')?.value || '').toLowerCase().trim();
  const sort = document.getElementById('plugin-browse-sort')?.value || 'stars';

  let results = pluginBrowseData;
  if (query) {
    results = results.filter(p =>
      p._title.includes(query) || p._desc.includes(query) || p.id.includes(query)
    );
  }

  if (sort === 'stars') results.sort((a, b) => (b.stars || 0) - (a.stars || 0));
  else if (sort === 'update') results.sort((a, b) => (b.last_update || '').localeCompare(a.last_update || ''));
  else if (sort === 'name') results.sort((a, b) => a._title.localeCompare(b._title));

  pluginBrowseIndex = 0;
  const statsEl = document.getElementById('plugin-browse-stats');
  statsEl.textContent = `共 ${results.length} 个插件${query ? ` (匹配 "${query}")` : ''}`;

  window._pluginFilteredBrowse = results;
  renderBrowsePage();
}

function _renderBrowseItem(p) {
  const title = p.title || p.id;
  const ver = p.version || '';
  const desc = p.description || '';
  const repo = p.repository || p.reference || '';
  // Use 'state' from getlist API: 'enabled', 'disabled', 'not-installed'
  const state = p.state || 'not-installed';
  const isInstalled = state === 'enabled' || state === 'disabled';
  const isDisabled = state === 'disabled';

  let badgeHtml = '';
  if (isInstalled && !isDisabled) badgeHtml = '<span class="plugin-badge installed">已安装</span>';
  else if (isInstalled && isDisabled) badgeHtml = '<span class="plugin-badge disabled">已禁用</span>';
  else badgeHtml = '<span class="plugin-badge not-installed">未安装</span>';

  const activeVer = p.active_version || '';

  let actionsHtml = '';
  if (!isInstalled) {
    actionsHtml += `<button class="btn btn-sm btn-primary" onclick="installPlugin('${_esc(p.id)}','latest')">安装</button>`;
    actionsHtml += `<button class="btn btn-sm" onclick="openPluginVersionModal('${_esc(p.id)}','${_esc(title)}')">📋 版本</button>`;
  } else {
    actionsHtml += '<span style="font-size:.78rem;color:var(--green)">✅ 已安装</span>';
  }

  return `<div class="plugin-item">
    <div class="plugin-item-header">
      <div class="plugin-item-title">${repo ? `<a href="${repo}" target="_blank">${_h(title)}</a>` : _h(title)}</div>
      ${badgeHtml}
    </div>
    ${desc ? `<div class="plugin-item-desc">${_h(desc)}</div>` : ''}
    <div class="plugin-item-meta">
      <span>📦 ${_h(p.id)}</span>
      ${ver ? `<span>v${_h(ver)}</span>` : ''}
      ${p.cnr_latest ? `<span style="color:var(--t3)">latest: ${_h(p.cnr_latest)}</span>` : ''}
      ${p.stars > 0 ? `<span>⭐ ${p.stars}</span>` : ''}
      ${p.author ? `<span>👤 ${_h(p.author)}</span>` : ''}
      ${p.last_update ? `<span>🕐 ${p.last_update.split('T')[0]}</span>` : ''}
      <div class="plugin-item-actions">${actionsHtml}</div>
    </div>
  </div>`;
}

function renderBrowsePage() {
  const results = window._pluginFilteredBrowse || [];
  const el = document.getElementById('plugin-browse-list');
  const moreEl = document.getElementById('plugin-browse-more');
  const end = Math.min(pluginBrowseIndex + PLUGIN_PAGE_SIZE, results.length);
  const slice = results.slice(0, end);
  pluginBrowseIndex = end;

  if (slice.length === 0) {
    el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--t3)">没有匹配的插件</div>';
    moreEl.classList.add('hidden');
    return;
  }

  try {
    const htmlParts = [];
    for (let i = 0; i < slice.length; i++) {
      try { htmlParts.push(_renderBrowseItem(slice[i])); }
      catch (itemErr) { console.error('_renderBrowseItem error at index', i, slice[i]?.id, itemErr); }
    }
    el.innerHTML = htmlParts.join('');
  } catch (e) {
    console.error('renderBrowsePage error:', e);
    el.innerHTML = `<div class="error-msg">渲染失败: ${e.message}</div>`;
  }
  moreEl.classList.toggle('hidden', end >= results.length);
}

function loadMoreBrowsePlugins() {
  const results = window._pluginFilteredBrowse || [];
  const el = document.getElementById('plugin-browse-list');
  const moreEl = document.getElementById('plugin-browse-more');
  const start = pluginBrowseIndex;
  const end = Math.min(start + PLUGIN_PAGE_SIZE, results.length);
  const slice = results.slice(start, end);
  pluginBrowseIndex = end;

  try {
    const htmlParts = [];
    for (let i = 0; i < slice.length; i++) {
      try { htmlParts.push(_renderBrowseItem(slice[i])); }
      catch (itemErr) { console.error('_renderBrowseItem error at index', start + i, slice[i]?.id, itemErr); }
    }
    el.innerHTML += htmlParts.join('');
  } catch (e) { console.error('loadMoreBrowsePlugins error:', e); }
  moreEl.classList.toggle('hidden', end >= results.length);
}

// ---------- Plugin Actions ----------
async function installPlugin(id, selectedVersion) {
  showToast(`📥 正在安装 ${id}...`);
  try {
    const r = await fetch('/api/plugins/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, selected_version: selectedVersion || 'latest' })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    showToast(`✅ ${d.message}`);
    startPluginQueuePoll();
  } catch (e) {
    showToast('❌ 安装失败: ' + e.message);
  }
}

async function uninstallPlugin(id, version, title) {
  if (!confirm(`确定要卸载插件 "${title || id}" 吗？`)) return;
  showToast(`🗑️ 正在卸载 ${title || id}...`);
  try {
    const r = await fetch('/api/plugins/uninstall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, version })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    showToast(`✅ ${d.message}`);
    startPluginQueuePoll();
  } catch (e) {
    showToast('❌ 卸载失败: ' + e.message);
  }
}

async function updatePlugin(id, version) {
  showToast(`⬆️ 正在更新 ${id}...`);
  try {
    const r = await fetch('/api/plugins/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, version })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    showToast(`✅ ${d.message}`);
    startPluginQueuePoll();
  } catch (e) {
    showToast('❌ 更新失败: ' + e.message);
  }
}

async function updateAllPlugins() {
  if (!confirm('确定要更新所有已安装插件吗？这可能需要一些时间。')) return;
  showToast('⬆️ 正在提交全部更新...');
  try {
    const r = await fetch('/api/plugins/update_all', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    showToast(`✅ ${d.message}`);
    startPluginQueuePoll();
  } catch (e) {
    showToast('❌ 更新失败: ' + e.message);
  }
}

async function togglePlugin(id, version) {
  showToast(`⏳ 操作中...`);
  try {
    const r = await fetch('/api/plugins/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, version })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    showToast(`✅ ${d.message}`);
    startPluginQueuePoll();
  } catch (e) {
    showToast('❌ 操作失败: ' + e.message);
  }
}

async function installPluginFromGit() {
  const url = document.getElementById('plugin-git-url')?.value.trim();
  if (!url) { showToast('请输入 Git URL'); return; }
  if (!url.startsWith('http')) { showToast('请输入有效的 URL'); return; }
  const btn = document.getElementById('plugin-git-btn');
  const statusEl = document.getElementById('plugin-git-status');
  btn.disabled = true;
  btn.textContent = '安装中...';
  statusEl.innerHTML = '<div style="color:var(--amber);font-size:.82rem">⏳ 正在克隆并安装, 请稍候...</div>';
  try {
    const r = await fetch('/api/plugins/install_git', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    statusEl.innerHTML = `<div class="success-msg">${d.message}</div>`;
    showToast('✅ 安装完成');
    document.getElementById('plugin-git-url').value = '';
    if (currentPluginTab === 'installed') loadInstalledPlugins();
  } catch (e) {
    statusEl.innerHTML = `<div class="error-msg">安装失败: ${e.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '安装';
  }
}

// ---------- Plugin Version Modal ----------
async function openPluginVersionModal(id, title) {
  const modal = document.getElementById('plugin-version-modal');
  document.getElementById('pv-title').textContent = `${title || id} - 版本选择`;
  const body = document.getElementById('pv-body');
  body.innerHTML = '<div class="loading"><div class="spinner"></div><br>加载版本列表...</div>';
  modal.classList.add('active');
  try {
    const r = await fetch(`/api/plugins/versions/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error('获取版本失败');
    const versions = await r.json();
    if (!versions || versions.length === 0) {
      body.innerHTML = '<div style="text-align:center;padding:16px;color:var(--t3)">无版本信息 (可能为 nightly 安装)</div>';
      return;
    }
    body.innerHTML = `<div style="max-height:50vh;overflow-y:auto">${versions.map(v => {
      const ver = v.version || v;
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--bd)">
        <span style="font-size:.88rem;font-weight:500">${_h(typeof ver === 'string' ? ver : JSON.stringify(ver))}</span>
        <button class="btn btn-sm btn-primary" onclick="installPluginVersion('${_esc(id)}','${_esc(typeof ver === 'string' ? ver : '')}')">安装此版本</button>
      </div>`;
    }).join('')}</div>`;
  } catch (e) {
    body.innerHTML = `<div class="error-msg">${e.message}</div>`;
  }
}

function closePluginVersionModal() {
  document.getElementById('plugin-version-modal').classList.remove('active');
}

async function installPluginVersion(id, version) {
  closePluginVersionModal();
  await installPlugin(id, version);
}

// ---------- Queue Polling ----------
function stopPluginQueuePoll() {
  if (pluginQueuePollTimer) { clearInterval(pluginQueuePollTimer); pluginQueuePollTimer = null; }
}

function startPluginQueuePoll() {
  pollPluginQueue();
  if (pluginQueuePollTimer) clearInterval(pluginQueuePollTimer);
  pluginQueuePollTimer = setInterval(pollPluginQueue, 2000);
}

async function pollPluginQueue() {
  try {
    const r = await fetch('/api/plugins/queue_status');
    if (!r.ok) return;
    const d = await r.json();
    const indicator = document.getElementById('plugin-queue-indicator');
    if (d.is_processing && d.total_count > 0) {
      indicator.classList.remove('hidden');
      indicator.textContent = `⏳ 队列: ${d.done_count}/${d.total_count} 完成`;
    } else {
      indicator.classList.add('hidden');
      if (pluginQueuePollTimer) {
        clearInterval(pluginQueuePollTimer);
        pluginQueuePollTimer = null;
        if (currentPluginTab === 'installed') loadInstalledPlugins();
      }
    }
  } catch (e) { /* silent */ }
}

// Escape key handler for plugin version modal
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closePluginVersionModal();
});

