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
});

// ========== Navigation ==========
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.getElementById('page-' + page).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));

  if (page === 'dashboard') refreshDashboard();
  else { stopDlStatusPolling(); if (page === 'models') loadLocalModels(); }
  if (page === 'civitai') { loadFacets(); }
  else if (page === 'downloads') { refreshDownloadStatus(); startDlStatusPolling(); }
  else if (page === 'logs') loadLogs();
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
document.addEventListener('keydown', e => { if (e.key === 'Escape') { document.getElementById('img-modal').classList.remove('active'); closeConfigModal(); closeMetaModal(); closeVersionPicker(); } });

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

      html += `<figure><img src="${imgUrl}" alt="" onclick="openImg('${fullUrl.replace(/'/g, "\\'")}')" loading="lazy">`;
      if (caption) html += `<figcaption>${caption}</figcaption>`;
      html += '</figure>';
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
  const images = [];
  if (m.has_preview && m.preview_path) {
    images.push({ url: `/api/local_models/preview?path=${encodeURIComponent(m.preview_path)}` });
  }
  if (m.civitai_image) images.push({ url: m.civitai_image });
  // If weilin info has images, add them
  if (m.images && Array.isArray(m.images)) {
    m.images.forEach(img => images.push(img));
  }

  openMetaModal({
    id: m.civitai_id || '-', name: m.name || m.filename,
    type: m.category || '', file: m.filename,
    sha256: m.sha256 || '',
    version: { baseModel: m.base_model || '', trainedWords, hashes: {} },
    images,
  });
}

// ========== API Key ==========
async function loadApiKey() {
  try {
    const r = await fetch('/api/config');
    const d = await r.json();
    apiKey = d.api_key || '';
    document.getElementById('key-status').innerHTML = d.has_key ? `🔓 Key: ${d.key_preview}` : '🔒 未设置 Key';
  } catch (e) { console.error(e); }
}
function openConfigModal() {
  document.getElementById('config-apikey').value = apiKey;
  document.getElementById('config-modal').classList.add('active');
}
function closeConfigModal() { document.getElementById('config-modal').classList.remove('active'); }
async function saveApiKey() {
  const key = document.getElementById('config-apikey').value.trim();
  await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: key }) });
  closeConfigModal(); await loadApiKey(); showToast('API Key 已保存');
}
async function clearApiKey() {
  await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: '' }) });
  closeConfigModal(); await loadApiKey(); showToast('API Key 已清除');
}

// ========== Dashboard ==========
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
      <div class="model-card-title" title="${m.name}">${m.name}</div>
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
  if (!append) { results.innerHTML = ''; pag.innerHTML = ''; }

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
  const imageObj = (h.images && h.images[0]) ? h.images[0] : (ver?.images?.[0] || null);

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
      style="cursor:zoom-in" onerror="this.style.display='none'" loading="lazy">` : '<div class="model-card-no-img">📦</div>'}</div>
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

async function lookupIds() {
  const text = document.getElementById('id-input').value.trim();
  const ids = parseIds(text);
  if (ids.length === 0) { showToast('请输入有效的模型 ID'); return; }

  const loading = document.getElementById('lookup-loading');
  const results = document.getElementById('lookup-results');
  const errEl = document.getElementById('lookup-error');
  const progress = document.getElementById('lookup-progress');
  errEl.innerHTML = '';
  results.innerHTML = '';
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
      <div class="model-card-img">${img ? `<img src="${img}" alt="" onclick="openImg('${img}')" style="cursor:zoom-in" loading="lazy">` : '<div class="model-card-no-img">📦</div>'}</div>
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
}

function removeFromCart(id) { selectedModels.delete(String(id)); saveCartToStorage(); updateCartBadge(); renderCart(); }
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

// ========== Logs ==========
async function loadLogs() {
  const name = document.getElementById('log-service').value;
  const lines = document.getElementById('log-lines').value;
  const box = document.getElementById('log-content');
  try {
    const r = await fetch(`/api/logs/${name}?lines=${lines}`);
    const d = await r.json();
    box.textContent = d.logs || '(空)';
    box.scrollTop = box.scrollHeight;
  } catch (e) { box.textContent = '加载失败: ' + e.message; }
}

function toggleAutoLog() {
  if (document.getElementById('log-auto').checked) {
    autoLogInterval = setInterval(loadLogs, 3000);
  } else {
    clearInterval(autoLogInterval);
    autoLogInterval = null;
  }
}

// ========== Download Status ==========
let dlStatusInterval = null;

async function refreshDownloadStatus() {
  const container = document.getElementById('dl-status-content');
  if (!container) return;
  try {
    const r = await fetch('/api/download/status');
    const d = await r.json();
    const active = d.active || [];
    const queue = d.queue || [];
    const history = d.history || [];

    if (active.length === 0 && queue.length === 0 && history.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--t3)">暂无下载任务</div>';
      return;
    }

    let html = '';

    // Active downloads
    if (active.length > 0) {
      html += '<div class="section-title">🔄 下载中</div>';
      active.forEach(dl => {
        const pct = (dl.progress || 0).toFixed(1);
        const speed = dl.speed ? fmtBytes(dl.speed) + '/s' : '';
        html += `<div class="dl-item">
          <div class="dl-item-info">
            <span class="dl-item-name" title="${dl.filename || ''}">${dl.model_name || dl.filename || dl.id}</span>
            <span class="dl-item-meta">${dl.version_name || ''} ${speed ? '• ' + speed : ''} ${dl.connection_type || ''}</span>
          </div>
          <div class="progress-bar" style="height:8px;margin:6px 0"><div class="progress-fill" style="width:${pct}%;background:var(--ac);transition:width .3s"></div></div>
          <div style="display:flex;justify-content:space-between;font-size:.75rem;color:var(--t3)">
            <span>${pct}%</span>
            <button class="btn btn-sm btn-danger" style="padding:2px 8px;font-size:.7rem" onclick="cancelDownload('${dl.id}')">取消</button>
          </div>
        </div>`;
      });
    }

    // Queued
    if (queue.length > 0) {
      html += '<div class="section-title" style="margin-top:12px">⏳ 队列中</div>';
      queue.forEach(dl => {
        html += `<div class="dl-item">
          <div class="dl-item-info">
            <span class="dl-item-name">${dl.model_name || dl.filename || dl.id}</span>
            <span class="dl-item-meta">${dl.version_name || ''} • 等待中</span>
          </div>
          <button class="btn btn-sm btn-danger" style="padding:2px 8px;font-size:.7rem" onclick="cancelDownload('${dl.id}')">取消</button>
        </div>`;
      });
    }

    // History
    if (history.length > 0) {
      html += '<div class="section-title" style="margin-top:12px">📋 历史</div>';
      history.slice(0, 20).forEach(dl => {
        const statusIcon = dl.status === 'completed' ? '✅' : dl.status === 'failed' ? '❌' : '⛔';
        const canRetry = dl.status === 'failed' || dl.status === 'cancelled';
        html += `<div class="dl-item">
          <div class="dl-item-info">
            <span class="dl-item-name">${statusIcon} ${dl.model_name || dl.filename || dl.id}</span>
            <span class="dl-item-meta">${dl.version_name || ''} ${dl.error ? '• ' + dl.error : ''}</span>
          </div>
          ${canRetry ? `<button class="btn btn-sm" style="padding:2px 8px;font-size:.7rem" onclick="retryDownload('${dl.id}')">🔄 重试</button>` : ''}
        </div>`;
      });
      html += `<div style="text-align:right;margin-top:8px"><button class="btn btn-sm" onclick="clearDlHistory()">🗑️ 清除历史</button></div>`;
    }

    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<div class="error-msg">获取下载状态失败: ${e.message}</div>`;
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

// ========== Tunnel Links ==========
async function loadTunnelLinks() {
  const container = document.getElementById('tunnel-links');
  if (!container) return;
  try {
    const r = await fetch('/api/tunnel_links');
    const d = await r.json();
    const links = d.links || [];
    if (links.length === 0) {
      container.innerHTML = '<span style="font-size:.82rem;color:var(--t3)">未检测到 Tunnel 链接</span>';
      return;
    }
    container.innerHTML = links.map(l =>
      `<a href="${l.url}" target="_blank" class="btn btn-sm" style="display:inline-flex;align-items:center;gap:4px">${l.icon || '🔗'} ${l.name}</a>`
    ).join(' ');
  } catch (e) {
    container.innerHTML = '<span style="font-size:.82rem;color:var(--t3)">无法获取链接</span>';
  }
}
