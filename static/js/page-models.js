/**
 * ComfyCarry — page-models.js
 * Models 页面模块：本地模型管理、CivitAI 搜索、ID 查询、购物车、下载状态
 */

import {
  registerPage, registerEscapeHandler,
  fmtBytes, fmtPct, showToast, copyText, openImg, escHtml,
  apiKey, getAuthHeaders, getBadgeClass, CIVITAI_API_BASE,
  renderLoading, renderError, renderEmpty, msIcon, apiFetch,
  renderSkeleton
} from './core.js';

// ── 页面内部状态 ─────────────────────────────────────────────

let localModelsData = [];
let selectedModels = new Map();
let searchResultsCache = {};
let metaSelectedWords = new Set();
let searchObserver = null;
let isSearchLoading = false;
let hasMoreResults = false;
let currentModelTab = 'local';
let currentDlTab = 'pending';

let searchPage = 0;
let facetsLoaded = false;
let dlStatusInterval = null;
let _dlCompletedIds = new Set();

const TYPE_MAP = { 'Checkpoint': 'Checkpoint', 'LORA': 'LORA', 'TextualInversion': 'Embedding', 'Controlnet': 'ControlNet', 'Upscaler': 'Upscaler', 'VAE': 'VAE', 'Poses': 'Poses' };

// ── 本地 helpers ─────────────────────────────────────────────

// ── Model Tab 切换 ───────────────────────────────────────────

const modelTabIds = ['local', 'civitai', 'downloads', 'workflow'];

function switchModelTab(tab) {
  currentModelTab = tab;
  document.querySelectorAll('[data-mtab]').forEach(t => t.classList.toggle('active', t.dataset.mtab === tab));
  modelTabIds.forEach(id => document.getElementById('mtab-' + id).classList.toggle('hidden', id !== tab));
  if (tab === 'local') loadLocalModels();
  else if (tab === 'civitai') loadFacets();
  else if (tab === 'downloads') { renderDownloadsTab(); startDlStatusPolling(); }
  else if (tab === 'workflow') _initWorkflowDropZone();
}

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
    html += `<tr><td>统计</td><td>${msIcon('download')} ${(m.downloadCount||0).toLocaleString()} &nbsp; ${msIcon('thumb_up')} ${(m.thumbsUpCount||0).toLocaleString()}</td></tr>`;
  }
  // For local models with extra fields
  if (data.file) html += `<tr><td>文件</td><td style="word-break:break-all">${data.file}</td></tr>`;
  if (data.sha256) html += `<tr><td>SHA256</td><td style="word-break:break-all;font-family:monospace;font-size:.75rem">${data.sha256}</td></tr>`;
  html += '</tbody></table>';

  // Trained words
  if (trainedWords.length > 0) {
    html += `<div class="section-title" style="font-size:.88rem">${msIcon('label','ms-sm')} 触发词</div>`;
    html += '<ul class="meta-tw-list">';
    trainedWords.forEach(w => {
      const word = typeof w === 'string' ? w : (w.word || '');
      if (word) html += `<li class="meta-tw-item" onclick="toggleMetaWord(this, '${word.replace(/'/g, "\\'")}')">${word}</li>`;
    });
    html += '</ul>';
    html += '<div class="meta-tw-actions"><span id="meta-tw-count">点击选择触发词</span> <button class="btn btn-sm btn-success" onclick="copyMetaWords()">复制选中</button> <button class="btn btn-sm" onclick="copyAllMetaWords()">全部复制</button></div>';
  }

  // Images with generation params
  if (images.length > 0) {
    html += `<div class="section-title" style="font-size:.88rem;margin-top:16px">${msIcon('image','ms-sm')} 示例图片</div>`;
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
      if (img.positive) caption += `<label>Positive</label><span class="prompt-text" onclick="copyText(this.textContent)" title="点击复制">${escHtml(img.positive)}</span>`;
      if (img.negative) caption += `<label>Negative</label><span class="prompt-text" onclick="copyText(this.textContent)" title="点击复制">${escHtml(img.negative)}</span>`;

      // Meilisearch images have meta in different structure
      if (img.meta) {
        const mt = img.meta;
        if (mt.seed) caption += `<label>Seed</label>${mt.seed}`;
        if (mt.steps) caption += `<label>Steps</label>${mt.steps}`;
        if (mt.cfgScale) caption += `<label>CFG</label>${mt.cfgScale}`;
        if (mt.sampler) caption += `<label>Sampler</label>${mt.sampler}`;
        if (mt.prompt) caption += `<label>Positive</label><span class="prompt-text" onclick="copyText(this.textContent)" title="点击复制">${escHtml(mt.prompt)}</span>`;
        if (mt.negativePrompt) caption += `<label>Negative</label><span class="prompt-text" onclick="copyText(this.textContent)" title="点击复制">${escHtml(mt.negativePrompt)}</span>`;
      }

      const isVideo = img.type === 'video' || (img.name && /\.(webm|mp4)$/i.test(img.name));
      const figcaptionHtml = caption ? `<figcaption>${caption}</figcaption>` : '';
      html += `<figure${isVideo ? ' style="position:relative"' : ''}><img src="${imgUrl}" alt="" onclick="openImg('${fullUrl.replace(/'/g, "\\'")}')" loading="lazy">${isVideo ? `<span style="position:absolute;top:6px;left:6px;background:rgba(0,0,0,.65);color:#fff;padding:2px 8px;border-radius:4px;font-size:.75rem">${msIcon('videocam')} 视频</span>` : ''}${figcaptionHtml}</figure>`;
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

// ========== Local Models ==========

async function loadLocalModels() {
  const grid = document.getElementById('local-models-grid');
  const status = document.getElementById('local-models-status');
  const cat = document.getElementById('model-category').value;
  if (!grid.children.length || grid.querySelector('.skeleton-wrap')) {
    grid.innerHTML = renderSkeleton('model-grid', 6);
  }
  status.innerHTML = '';

  try {
    const r = await fetch(`/api/local_models?category=${cat}`);
    const d = await r.json();
    localModelsData = d.models || [];
    const infoCount = localModelsData.filter(m => m.has_info).length;
    status.innerHTML = `共 ${d.total} 个模型 · ${infoCount} 个已有元数据`;

    if (localModelsData.length === 0) {
      grid.innerHTML = renderEmpty('该类别下未找到模型文件');
      return;
    }

    grid.innerHTML = localModelsData.map((m, i) => renderLocalModelCard(m, i)).join('');
  } catch (e) {
    grid.innerHTML = renderError('加载失败: ' + e.message);
  }
}

function renderLocalModelCard(m, idx) {
  const badgeClass = getBadgeClass(m.category);
  const sizeStr = fmtBytes(m.size_bytes);
  const twHtml = (m.trained_words || []).slice(0, 8).map(w =>
    `<span class="tw-tag" onclick="copyText('${escHtml(w).replace(/'/g, "\\'")}')" title="点击复制">${escHtml(w)}</span>`
  ).join('');

  let imgTag = '', zoomUrl = '';
  if (m.has_preview && m.preview_path) {
    const pUrl = `/api/local_models/preview?path=${encodeURIComponent(m.preview_path)}`;
    zoomUrl = pUrl;
    imgTag = `<img src="${pUrl}" alt="" onerror="this.style.display='none';this.parentElement.querySelector('.model-card-no-img').style.display='flex'" loading="lazy"><div class="model-card-no-img" style="display:none;position:absolute;inset:0">${msIcon('image_not_supported')} 无预览</div>`;
  } else if (m.civitai_image) {
    zoomUrl = m.civitai_image;
    imgTag = `<img src="${m.civitai_image}" alt="" onerror="this.style.display='none';this.parentElement.querySelector('.model-card-no-img').style.display='flex'" loading="lazy"><div class="model-card-no-img" style="display:none;position:absolute;inset:0">${msIcon('image_not_supported')}</div>`;
  } else {
    imgTag = `<div class="model-card-no-img">${msIcon('image_not_supported')} 无预览</div>`;
  }

  const zoomIcon = zoomUrl ? `<span class="zoom-icon" onclick="event.stopPropagation();openImg('${zoomUrl.replace(/'/g, "\\'")}')" title="查看大图">${msIcon('zoom_in','ms-sm')}</span>` : '';
  const clickArea = `<div class="img-click-area" onclick="openLocalMeta(${idx})"></div>`;

  // Fetch button: shows status + allows re-fetch
  const fetchBtnText = m.has_info ? '已获取' : '获取信息';
  const fetchBtnClass = m.has_info ? 'btn btn-sm' : 'btn btn-sm btn-primary';
  const fetchBtnTitle = m.has_info ? '点击重新获取元数据' : '从 CivitAI 获取信息';

  return `<div class="model-card" data-idx="${idx}">
    <div class="model-card-img">${imgTag}${zoomIcon}${clickArea}</div>
    <div class="model-card-body">
      <div class="model-card-title" title="${(m.name || '').replace(/"/g, '&quot;')}" onclick="openLocalMeta(${idx})">${m.name}</div>
      <div class="model-card-meta">
        <span class="badge ${badgeClass}">${m.category}</span>
        ${m.base_model ? `<span class="badge badge-other">${m.base_model}</span>` : ''}
        <span class="model-card-size">${sizeStr}</span>
      </div>
      ${twHtml ? `<div class="model-card-tags">${twHtml}</div>` : ''}
      <div class="model-card-actions">
        <button class="btn btn-sm btn-success" onclick="openLocalMeta(${idx})">详情</button>
        <button class="${fetchBtnClass}" onclick="fetchModelInfo(${idx})" title="${fetchBtnTitle}">${fetchBtnText}</button>
        <button class="btn btn-sm btn-danger" onclick="deleteModel(${idx})">${msIcon('delete')}</button>
      </div>
    </div></div>`;
}

async function fetchModelInfo(idx) {
  const m = localModelsData[idx];
  if (!m) return;
  // Find the card and disable the fetch button
  const card = document.querySelector(`.model-card[data-idx="${idx}"]`);
  const btn = card?.querySelector('.model-card-actions button:nth-child(2)');
  if (btn) {
    if (btn.dataset.fetching === '1') return; // already in progress
    btn.dataset.fetching = '1';
    btn._origText = btn.textContent;
    btn.innerHTML = `${msIcon('hourglass_top')} 获取中…`;
    btn.disabled = true;
    btn.style.opacity = '0.6';
  }
  try {
    const r = await fetch('/api/local_models/fetch_info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ abs_path: m.abs_path })
    });
    const d = await r.json();
    if (d.ok) {
      showToast(`${m.filename} 信息获取成功`);
      // Refresh only this card's data
      await _refreshSingleCard(idx);
    } else {
      showToast(`${d.error || '未知错误'}`);
      _resetFetchBtn(btn);
    }
  } catch (e) {
    showToast('请求失败: ' + e.message);
    _resetFetchBtn(btn);
  }
}

function _resetFetchBtn(btn) {
  if (!btn) return;
  btn.dataset.fetching = '';
  btn.textContent = btn._origText || '获取信息';
  btn.disabled = false;
  btn.style.opacity = '';
}

async function _refreshSingleCard(idx) {
  // Re-fetch model list and update single card in-place
  const cat = document.getElementById('model-category')?.value || 'all';
  try {
    const r = await fetch(`/api/local_models?category=${cat}`);
    const d = await r.json();
    localModelsData = d.models || [];
    // Update status bar
    const status = document.getElementById('local-models-status');
    if (status) {
      const infoCount = localModelsData.filter(m => m.has_info).length;
      status.innerHTML = `共 ${d.total} 个模型 · ${infoCount} 个已有元数据`;
    }
    // Replace only the target card
    const oldCard = document.querySelector(`.model-card[data-idx="${idx}"]`);
    if (oldCard && localModelsData[idx]) {
      const temp = document.createElement('div');
      temp.innerHTML = renderLocalModelCard(localModelsData[idx], idx);
      oldCard.replaceWith(temp.firstElementChild);
    }
  } catch (e) { console.error('Refresh single card failed:', e); }
}

async function fetchAllInfo() {
  const noInfo = localModelsData.filter(m => !m.has_info);
  if (noInfo.length === 0) { showToast('所有模型已有信息'); return; }
  if (!confirm(`将为 ${noInfo.length} 个模型获取信息，可能需要较长时间。继续？`)) return;

  for (let i = 0; i < noInfo.length; i++) {
    const m = noInfo[i];
    document.getElementById('local-models-status').innerHTML = `<div class="success-msg">${msIcon('hourglass_top')} 正在获取 (${i + 1}/${noInfo.length}): ${m.filename}</div>`;
    try {
      await fetch('/api/local_models/fetch_info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ abs_path: m.abs_path })
      });
    } catch (e) { console.error(m.filename, e); }
  }
  showToast(`全部完成`);
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
    showToast(`自动获取 ${noInfo.length} 个新模型的元数据...`);
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
    showToast(`元数据自动获取完成 (${ok}/${noInfo.length})`);
    // Refresh model list if user is on models page
    if (document.getElementById('local-models-grid')) loadLocalModels();
  } catch (e) { console.error('_autoFetchMetadataForNewDownloads error:', e); }
}

async function deleteModel(idx) {
  const m = localModelsData[idx];
  if (!m) return;
  if (!confirm(`确定删除 ${m.filename}？\n此操作不可恢复！`)) return;
  const d = await apiFetch('/api/local_models/delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ abs_path: m.abs_path })
  });
  if (!d) return;
  if (d.ok) { showToast(`已删除 ${m.filename}`); loadLocalModels(); }
  else showToast('删除失败: ' + (d.error || ''));
}

// ========== CivitAI Search ==========

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
  if (tab === 'cart') renderPendingList();
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
  if (!append) {
    results.innerHTML = renderSkeleton('model-grid', 6); pag.innerHTML = '';
    // Preserve cache entries for models already in cart
    const cartKeys = new Set(selectedModels.keys());
    searchResultsCache = Object.fromEntries(
      Object.entries(searchResultsCache).filter(([k]) => cartKeys.has(k))
    );
  }

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
      pag.innerHTML = `<div id="scroll-sentinel" style="text-align:center;padding:16px;color:var(--t3);font-size:.82rem">${msIcon('hourglass_top')} 向下滚动加载更多 (${Math.min(loaded, total)}/${total})</div>`;
      setupScrollObserver();
    } else {
      pag.innerHTML = `<div style="text-align:center;padding:16px;color:var(--t3);font-size:.82rem">— 共 ${total} 个结果 —</div>`;
    }
  } catch (e) {
    loading.classList.add('hidden');
    isSearchLoading = false;
    errEl.innerHTML = renderError('搜索失败: ' + e.message);
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

  const zoomIcon = fullUrl ? `<span class="zoom-icon" onclick="event.stopPropagation();openImg('${fullUrl.replace(/'/g, "\\'")}')" title="查看大图">${msIcon('zoom_in','ms-sm')}</span>` : '';
  const clickArea = `<div class="img-click-area" onclick="openMetaFromCache('${h.id}')"></div>`;

  return `<div class="model-card">
    <div class="model-card-img">${imgUrl ? `<img src="${imgUrl}" alt=""
      onerror="if(!this.dataset.retry&&'${fullUrl.replace(/'/g, "\\'")}'.length>0){this.dataset.retry='1';this.src='${fullUrl.replace(/'/g, "\\'")}'}else{this.style.display='none'}" loading="lazy">` : `<div class="model-card-no-img">${msIcon('image_not_supported')}</div>`}${zoomIcon}${clickArea}</div>
    <div class="model-card-body">
      <div class="model-card-title" title="${(h.name || '').replace(/"/g, '&quot;')}" onclick="openMetaFromCache('${h.id}')">${h.name || 'Unknown'}</div>
      <div class="model-card-meta">
        <span class="badge ${badgeClass}">${h.type || ''}</span>
        ${bm ? `<span class="badge badge-other">${bm}</span>` : ''}
        ${vCount > 1 ? `<span class="badge badge-other" title="${vCount} 个版本">v${vCount}</span>` : ''}
        <span style="font-size:.75rem;color:var(--t2)">${msIcon('download')} ${(h.metrics?.downloadCount || 0).toLocaleString()}</span>
      </div>
      <div class="model-card-actions">
        <button class="btn btn-sm btn-success" onclick="openMetaFromCache('${h.id}')">详情</button>
        <button class="btn btn-sm ${inCart ? 'btn-danger' : 'btn-primary'}" onclick="toggleCartFromSearch('${h.id}', this)">${inCart ? '移除' : '收藏'}</button>
        <button class="btn btn-sm" onclick="downloadFromSearch('${h.id}', '${(h.type || 'Checkpoint').toLowerCase()}')">下载</button>
      </div>
    </div></div>`;
}

function toggleCartFromSearch(id, btn) {
  id = String(id);
  if (selectedModels.has(id)) {
    selectedModels.delete(id);
    btn.textContent = '收藏';
    btn.classList.remove('btn-danger'); btn.classList.add('btn-primary');
  } else {
    const data = searchResultsCache[id] || {};
    selectedModels.set(id, {
      name: data.name || 'Unknown', type: data.type || '',
      imageUrl: data.image || '',
      versionId: data.version?.id, versionName: data.version?.name,
      baseModel: data.version?.baseModel,
    });
    btn.textContent = '移除';
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
  const payload = { model_id: modelId, model_type: modelType };
  if (versionId) payload.version_id = versionId;
  const d = await apiFetch('/api/download', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!d) return;
  if (d.error) showToast(d.error);
  else showToast(d.message || '下载任务已提交');
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
      <button class="btn btn-sm btn-primary" onclick="closeVersionPicker(); doDownload('${modelId}', '${modelType}', '${v.id}')">下载</button>
    </div>`;
  });
  html += '</div>';
  body.innerHTML = html;
  document.getElementById('version-picker-modal').classList.add('active');
}

function closeVersionPicker() {
  document.getElementById('version-picker-modal').classList.remove('active');
}

// ========== ID Lookup + Cart ==========

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
  if (found.length === 0) { errEl.innerHTML = renderEmpty('未找到任何模型'); return; }

  results.innerHTML = found.map(d => {
    const img = d.modelVersions?.[0]?.images?.[0]?.url || '';
    const fullImg = img ? img.replace('/width=450', '') : '';
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
    const zoomIcon = img ? `<span class="zoom-icon" onclick="event.stopPropagation();openImg('${fullImg.replace(/'/g, "\\'")}')" title="查看大图">${msIcon('zoom_in','ms-sm')}</span>` : '';
    const clickArea = `<div class="img-click-area" onclick="openMetaFromCache('${d.id}')"></div>`;
    return `<div class="model-card">
      <div class="model-card-img">${img ? `<img src="${img}" alt="" loading="lazy">` : `<div class="model-card-no-img">${msIcon('image_not_supported')}</div>`}${zoomIcon}${clickArea}</div>
      <div class="model-card-body">
        <div class="model-card-title" onclick="openMetaFromCache('${d.id}')">${d.name || ''}</div>
        <div class="model-card-meta">
          <span class="badge ${getBadgeClass((d.type || '').toLowerCase())}">${d.type || ''}</span>
          ${bm ? `<span class="badge badge-other">${bm}</span>` : ''}
          ${vCount > 1 ? `<span class="badge badge-other" title="${vCount} 个版本">v${vCount}</span>` : ''}
          <span style="font-size:.75rem;color:var(--t2)">${msIcon('download')} ${d.stats?.downloadCount?.toLocaleString() || 0}</span>
        </div>
        <div class="model-card-actions">
          <button class="btn btn-sm btn-success" onclick="openMetaFromCache('${d.id}')">详情</button>
          <button class="btn btn-sm ${inCart ? 'btn-danger' : 'btn-primary'}" onclick="toggleCartFromSearch('${d.id}', this)">${inCart ? '移除' : '收藏'}</button>
          <button class="btn btn-sm" onclick="downloadFromSearch('${d.id}', '${(d.type || 'Checkpoint').toLowerCase()}')">下载</button>
        </div>
      </div></div>`;
  }).join('');
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
  if (selectedModels.size === 0) return showToast('已选列表为空');
  const total = selectedModels.size;
  showToast(`开始批量下载 ${total} 个模型...`);
  let ok = 0, fail = 0;
  for (const [id, m] of selectedModels) {
    const modelType = (m.type || 'Checkpoint').toLowerCase();
    const versionId = m.versionId || null;
    const payload = { model_id: id, model_type: modelType };
    if (versionId) payload.version_id = versionId;
    const d = await apiFetch('/api/download', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!d) { fail++; continue; }
    if (d.error) { fail++; } else { ok++; }
  }
  showToast(`批量下载: ${ok} 个已提交${fail > 0 ? `, ${fail} 个失败` : ''}`);
}

function updateCartBadge() {
  const b = document.getElementById('cart-badge');
  if (!b) return;
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

// ========== Download Status ==========

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
        const thumbHtml = dl.image_url ? `<div class="dl-item-thumb"><img src="${dl.image_url}" onerror="this.parentElement.style.display='none'" alt=""></div>` : '';
        const typeHtml = dl.model_type ? `<span class="badge ${getBadgeClass(dl.model_type)}" style="font-size:.65rem">${dl.model_type}</span>` : '';
        html += `<div class="dl-item" style="flex-wrap:wrap">
          ${thumbHtml}
          <div class="dl-item-info">
            <span class="dl-item-name" title="${dl.filename || ''}">${dl.model_name || dl.filename || dl.id}</span>
            <div class="dl-item-meta">${typeHtml}<span>${dl.version_name || ''}</span>${speed ? `<span>${speed}</span>` : ''}</div>
          </div>
          <div class="dl-item-actions">
            <button class="btn btn-sm btn-danger" style="font-size:.7rem" onclick="cancelDownload('${dl.id}')">取消</button>
          </div>
          <div style="width:100%;margin-top:4px"><div class="progress-bar" style="height:6px"><div class="progress-fill" style="width:${pct}%;background:var(--ac);transition:width .3s"></div></div><span style="font-size:.72rem;color:var(--t3)">${pct}%</span></div>
        </div>`;
      });
      queue.forEach(dl => {
        const thumbHtml = dl.image_url ? `<div class="dl-item-thumb"><img src="${dl.image_url}" onerror="this.parentElement.style.display='none'" alt=""></div>` : '';
        const typeHtml = dl.model_type ? `<span class="badge ${getBadgeClass(dl.model_type)}" style="font-size:.65rem">${dl.model_type}</span>` : '';
        html += `<div class="dl-item">
          ${thumbHtml}
          <div class="dl-item-info">
            <span class="dl-item-name">${dl.model_name || dl.filename || dl.id}</span>
            <div class="dl-item-meta">${typeHtml}<span>${dl.version_name || ''}</span><span>等待中</span></div>
          </div>
          <div class="dl-item-actions">
            <button class="btn btn-sm btn-danger" style="font-size:.7rem" onclick="cancelDownload('${dl.id}')">取消</button>
          </div>
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
        const thumbHtml = dl.image_url ? `<div class="dl-item-thumb"><img src="${dl.image_url}" onerror="this.parentElement.style.display='none'" alt=""></div>` : '';
        const typeHtml = dl.model_type ? `<span class="badge ${getBadgeClass(dl.model_type)}" style="font-size:.65rem">${dl.model_type}</span>` : '';
        html += `<div class="dl-item">
          ${thumbHtml}
          <div class="dl-item-info">
            <span class="dl-item-name">${dl.model_name || dl.filename || dl.id}</span>
            <div class="dl-item-meta">${typeHtml}<span>${dl.version_name || ''}</span></div>
          </div>
        </div>`;
      });
      html += `<div style="text-align:right;margin-top:8px"><button class="btn btn-sm" onclick="clearDlHistory()">清除历史</button></div>`;
      completedEl.innerHTML = html;
    }

    // Failed
    if (failed.length === 0) {
      failedEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3)">暂无失败的下载</div>';
    } else {
      let html = '';
      failed.forEach(dl => {
        const thumbHtml = dl.image_url ? `<div class="dl-item-thumb"><img src="${dl.image_url}" onerror="this.parentElement.style.display='none'" alt=""></div>` : '';
        const typeHtml = dl.model_type ? `<span class="badge ${getBadgeClass(dl.model_type)}" style="font-size:.65rem">${dl.model_type}</span>` : '';
        html += `<div class="dl-item">
          ${thumbHtml}
          <div class="dl-item-info">
            <span class="dl-item-name">${dl.model_name || dl.filename || dl.id}</span>
            <div class="dl-item-meta">${typeHtml}<span>${dl.version_name || ''}</span>${dl.error ? `<span style="color:var(--red)">${dl.error}</span>` : ''}</div>
          </div>
          <div class="dl-item-actions">
            <button class="btn btn-sm" style="font-size:.7rem" onclick="retryDownload('${dl.id}')">重试</button>
          </div>
        </div>`;
      });
      failedEl.innerHTML = html;
    }

    // Update sub-tab counts
    document.querySelectorAll('[data-dltab="active"]').forEach(t => {
      t.textContent = `队列${active.length + queue.length > 0 ? ' (' + (active.length + queue.length) + ')' : ''}`;
    });
    document.querySelectorAll('[data-dltab="completed"]').forEach(t => {
      t.innerHTML = `${msIcon('check_circle','ms-sm')} 已完成${completed.length > 0 ? ' (' + completed.length + ')' : ''}`;
    });
    document.querySelectorAll('[data-dltab="failed"]').forEach(t => {
      t.innerHTML = `${msIcon('error','ms-sm')} 失败${failed.length > 0 ? ' (' + failed.length + ')' : ''}`;
    });
  } catch (e) {
    activeEl.innerHTML = renderError('获取下载状态失败: ' + e.message);
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
  const d = await apiFetch('/api/download/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ download_id: id }) });
  if (!d) return;
  showToast('已取消');
  refreshDownloadStatus();
}

async function retryDownload(id) {
  const d = await apiFetch('/api/download/retry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ download_id: id }) });
  if (!d) return;
  showToast(d.message || '已重试');
  refreshDownloadStatus();
}

async function clearDlHistory() {
  const d = await apiFetch('/api/download/clear_history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (!d) return;
  showToast('历史已清除');
  refreshDownloadStatus();
}

// ========== Download Tabs ==========

function switchDlTab(tab) {
  currentDlTab = tab;
  document.querySelectorAll('[data-dltab]').forEach(t => t.classList.toggle('active', t.dataset.dltab === tab));
  ['pending', 'active', 'completed', 'failed'].forEach(id => {
    const el = document.getElementById('dl-' + id + '-content');
    if (el) el.classList.toggle('hidden', id !== tab);
  });
}

async function renderDownloadsTab() {
  // Render pending (selected models + ID input)
  renderPendingList();
  // Fetch and render download status
  await refreshDownloadStatus();
}

function renderPendingList() {
  const container = document.getElementById('dl-pending-content');
  if (!container) return;

  // ID textarea + action bar (always shown at top of this tab)
  const taVal = document.activeElement?.id === 'cart-ids-textarea' ? '' : ` value="${[...selectedModels.keys()].join(', ')}"`;
  let html = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;margin-top:8px">
    <span style="font-size:.85rem;font-weight:600;color:var(--t1)">模型 ID 列表</span>
    <div style="flex:1"></div>
    <button class="btn btn-sm btn-primary" onclick="batchDownloadCart()">一键下载全部</button>
    <button class="btn btn-sm btn-danger" onclick="if(confirm('确定清空?')){selectedModels.clear();saveCartToStorage();updateCartBadge();renderDownloadsTab();}">清空</button>
  </div>
  <textarea class="cart-ids-box" id="cart-ids-textarea" oninput="syncCartFromTextarea(this)" style="min-height:50px;margin-bottom:12px" placeholder="输入模型 ID（逗号分隔）或从 CivitAI 页添加"></textarea>`;

  if (selectedModels.size === 0) {
    html += '<div style="text-align:center;padding:20px;color:var(--t3)">暂无已选模型，从 CivitAI 页添加或在上方输入 ID</div>';
  } else {
    for (const [id, m] of selectedModels) {
      const safeName = (m.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const badgeClass = getBadgeClass((m.type || '').toLowerCase());
      const cached = searchResultsCache[String(id)];
      const allVersions = cached?.allVersions || [];
      let versionHtml = m.versionName || '-';
      if (allVersions.length > 1) {
        const opts = allVersions.map(v => {
          const sel = String(v.id) === String(m.versionId) ? 'selected' : '';
          return `<option value="${v.id}" ${sel}>${v.name || v.id}${v.baseModel ? ' (' + v.baseModel + ')' : ''}</option>`;
        }).join('');
        versionHtml = `<select class="meta-version-select" onchange="changeCartVersion('${id}', this.value)" style="max-width:140px;font-size:.75rem">${opts}</select>`;
      }
      const imgUrl = m.imageUrl || '';
      const thumbHtml = imgUrl ? `<div class="dl-item-thumb"><img src="${imgUrl}" onerror="this.parentElement.style.display='none'" alt=""></div>` : '';
      html += `<div class="dl-item">
        ${thumbHtml}
        <div class="dl-item-info">
          <span class="dl-item-name"><a href="https://civitai.com/models/${id}" target="_blank" style="color:var(--ac)">${safeName}</a></span>
          <div class="dl-item-meta">
            <span class="badge ${badgeClass}" style="font-size:.65rem">${m.type || ''}</span>
            <span>ID: ${id}</span>
            ${versionHtml !== '-' ? versionHtml : `<span>${versionHtml}</span>`}
          </div>
        </div>
        <div class="dl-item-actions">
          <button class="btn btn-sm" onclick="downloadFromSearch('${id}', '${(m.type || 'Checkpoint').toLowerCase()}')" title="立即下载">${msIcon('download')}</button>
          <button class="btn btn-sm btn-danger" onclick="removeFromCart('${id}')" title="移除">${msIcon('delete')}</button>
        </div>
      </div>`;
    }
  }
  container.innerHTML = html;

  // Restore textarea value if not focused
  const ta = document.getElementById('cart-ids-textarea');
  if (ta && document.activeElement !== ta) {
    ta.value = [...selectedModels.keys()].join(', ');
  }

  // Update tab badge count
  document.querySelectorAll('[data-dltab="pending"]').forEach(t => {
    t.textContent = `已选${selectedModels.size > 0 ? ' (' + selectedModels.size + ')' : ''}`;
  });
}

// ── 页面生命周期注册 ─────────────────────────────────────────

registerPage('models', {
  enter() { loadLocalModels(); loadCartFromStorage(); updateCartBadge(); },
  leave() { stopDlStatusPolling(); if (searchObserver) { searchObserver.disconnect(); searchObserver = null; } }
});

registerEscapeHandler(() => { closeMetaModal(); closeVersionPicker(); });

// ── window 绑定 (HTML onclick 需要) ─────────────────────────

// Model tab
window.switchModelTab = switchModelTab;
window.loadLocalModels = loadLocalModels;
window.fetchModelInfo = fetchModelInfo;
window.deleteModel = deleteModel;
window.openLocalMeta = openLocalMeta;
window.fetchAllInfo = fetchAllInfo;

// Metadata modal
window.openMetaFromCache = openMetaFromCache;
window.openMetaModal = openMetaModal;
window.closeMetaModal = closeMetaModal;
window.toggleMetaWord = toggleMetaWord;
window.copyMetaWords = copyMetaWords;
window.copyAllMetaWords = copyAllMetaWords;
window.switchMetaVersion = switchMetaVersion;

// CivitAI search
window.searchModels = searchModels;
window.smartSearch = smartSearch;
window.toggleChip = toggleChip;
window.switchCivitTab = switchCivitTab;
window.toggleCartFromSearch = toggleCartFromSearch;
window.downloadFromSearch = downloadFromSearch;
window.doDownload = doDownload;

// Version picker
window.showVersionPicker = showVersionPicker;
window.closeVersionPicker = closeVersionPicker;

// ID lookup + cart
window.lookupIds = lookupIds;
window.changeCartVersion = changeCartVersion;
window.syncCartFromTextarea = syncCartFromTextarea;
window.removeFromCart = removeFromCart;
window.batchDownloadCart = batchDownloadCart;

// Download status
window.switchDlTab = switchDlTab;
window.cancelDownload = cancelDownload;
window.retryDownload = retryDownload;
window.clearDlHistory = clearDlHistory;
window.renderDownloadsTab = renderDownloadsTab;
window.renderPendingList = renderPendingList;

// Re-export from core (needed by HTML onclick in meta images)
window.openImg = openImg;
window.copyText = copyText;

// Expose cart internals for inline onclick in renderPendingList
window.selectedModels = selectedModels;
window.saveCartToStorage = saveCartToStorage;
window.updateCartBadge = updateCartBadge;

// ── 工作流解析 ──────────────────────────────────────────────

let _wfDropInited = false;

function _initWorkflowDropZone() {
  if (_wfDropInited) return;
  _wfDropInited = true;
  const zone = document.getElementById('wf-drop-zone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleWorkflowFile(file);
  });
}

/**
 * 从 PNG 文件的 tEXt chunk 中提取 ComfyUI 元数据
 */
async function _extractPNGMetadata(file) {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);

  // 验证 PNG signature
  if (view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) {
    throw new Error('不是有效的 PNG 文件');
  }

  let offset = 8; // 跳过 signature
  const decoder = new TextDecoder('latin1');
  const result = {};

  while (offset < view.byteLength) {
    const length = view.getUint32(offset);
    offset += 4;
    const typeBytes = new Uint8Array(buf, offset, 4);
    const type = String.fromCharCode(...typeBytes);
    offset += 4;

    if (type === 'tEXt') {
      const data = new Uint8Array(buf, offset, length);
      // tEXt: keyword\0value
      const nullIdx = data.indexOf(0);
      if (nullIdx > 0) {
        const key = decoder.decode(data.slice(0, nullIdx));
        const val = new TextDecoder('utf-8').decode(data.slice(nullIdx + 1));
        if (key === 'prompt' || key === 'workflow') {
          try { result[key] = JSON.parse(val); } catch (_) {}
        }
      }
    } else if (type === 'IEND') {
      break;
    }

    offset += length + 4; // 跳过 data + CRC
  }

  return result;
}

async function handleWorkflowFile(file) {
  if (!file) return;

  const statusEl = document.getElementById('wf-parse-status');
  const resultsEl = document.getElementById('wf-results');
  const listEl = document.getElementById('wf-results-list');
  const summaryEl = document.getElementById('wf-results-summary');

  statusEl.style.display = 'block';
  statusEl.innerHTML = `<span style="color:var(--t2)"><span class="ms ms-sm" style="color:var(--ac)">hourglass_empty</span> 正在解析 ${escHtml(file.name)}...</span>`;
  resultsEl.style.display = 'none';

  try {
    let payload;

    if (file.name.endsWith('.json')) {
      const text = await file.text();
      const json = JSON.parse(text);
      // 判断是 prompt 还是 workflow 格式
      if (json.nodes && Array.isArray(json.nodes)) {
        payload = { workflow: json };
      } else {
        payload = { prompt: json };
      }
    } else if (file.name.endsWith('.png')) {
      const meta = await _extractPNGMetadata(file);
      if (meta.prompt) {
        payload = { prompt: meta.prompt };
      } else if (meta.workflow) {
        payload = { workflow: meta.workflow };
      } else {
        statusEl.innerHTML = `<span style="color:var(--red)"><span class="ms ms-sm">error</span> PNG 文件中未找到 ComfyUI 工作流数据</span>`;
        return;
      }
    } else {
      statusEl.innerHTML = `<span style="color:var(--red)"><span class="ms ms-sm">error</span> 不支持的文件格式，请上传 PNG 或 JSON 文件</span>`;
      return;
    }

    const data = await apiFetch('/api/models/parse-workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!data) {
      statusEl.innerHTML = `<span style="color:var(--red)"><span class="ms ms-sm">error</span> 解析请求失败</span>`;
      return;
    }

    if (!data.models || data.models.length === 0) {
      statusEl.innerHTML = `<span style="color:var(--amber)"><span class="ms ms-sm">info</span> 未找到模型引用</span>`;
      return;
    }

    statusEl.style.display = 'none';
    resultsEl.style.display = 'block';
    summaryEl.textContent = `共 ${data.total} 个模型，${data.missing} 个缺失`;

    listEl.innerHTML = '<div class="card" style="padding:0;overflow:hidden">' +
      data.models.map(m => {
        const icon = m.exists
          ? '<span class="ms ms-sm" style="color:var(--green)">check_circle</span>'
          : '<span class="ms ms-sm" style="color:var(--red)">cancel</span>';
        const statusText = m.exists
          ? '<span style="color:var(--green);font-size:.8rem">已有</span>'
          : '<span style="color:var(--red);font-size:.8rem">缺失</span>';
        const searchBtn = m.exists
          ? ''
          : ` <button class="btn btn-sm btn-primary" onclick="searchModelFromWorkflow('${escHtml(m.name)}')" style="font-size:.75rem;padding:2px 8px">搜索</button>`;
        return `<div class="wf-model-row">
          <div class="wf-model-status">${icon}</div>
          <div class="wf-model-name">${escHtml(m.name)}</div>
          <div class="wf-model-type">${escHtml(m.type)}</div>
          <div>${statusText}${searchBtn}</div>
        </div>`;
      }).join('') + '</div>';

  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--red)"><span class="ms ms-sm">error</span> 解析失败: ${escHtml(e.message)}</span>`;
  }

  // 清空文件输入，允许再次选择同一文件
  document.getElementById('wf-file-input').value = '';
}

function searchModelFromWorkflow(name) {
  // 切换到 CivitAI 搜索 tab 并填入模型名
  const searchInput = document.getElementById('search-input');
  // 去掉扩展名作为搜索关键词
  const keyword = name.replace(/\.(safetensors|ckpt|pt|pth|bin)$/i, '').replace(/[_-]/g, ' ');
  if (searchInput) searchInput.value = keyword;
  switchModelTab('civitai');
  setTimeout(() => smartSearch(), 100);
}

window.handleWorkflowFile = handleWorkflowFile;
window.searchModelFromWorkflow = searchModelFromWorkflow;
