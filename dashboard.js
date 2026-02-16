// ====================================================================
// Workspace Manager - dashboard.js
// ====================================================================

const CIVITAI_API_BASE = 'https://civitai.com/api/v1';
let apiKey = '';
let selectedModels = new Map();
let autoLogInterval = null;

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
  else if (page === 'models') loadLocalModels();
  else if (page === 'civitai') { loadFacets(); }
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
function openImg(url) { if (!url) return; document.getElementById('modal-img').src = url; document.getElementById('img-modal').classList.add('active'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') { document.getElementById('img-modal').classList.remove('active'); closeConfigModal(); } });

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
    imgHtml = `<img src="/api/local_models/preview?path=${encodeURIComponent(m.preview_path)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy"><div class="model-card-no-img" style="display:none;position:absolute;inset:0">📦 无预览</div>`;
  } else if (m.civitai_image) {
    imgHtml = `<img src="${m.civitai_image}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy"><div class="model-card-no-img" style="display:none;position:absolute;inset:0">📦</div>`;
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
        ${m.trained_words && m.trained_words.length > 0 ? `<button class="btn btn-sm btn-success" onclick="copyText('${(m.trained_words || []).join(', ').replace(/'/g, "\\'")}')">📋 触发词</button>` : ''}
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
  // Type chips
  const types = ['Checkpoint', 'LORA', 'TextualInversion', 'Controlnet', 'Upscaler', 'VAE'];
  document.getElementById('filter-type-chips').innerHTML = types.map(t =>
    `<span class="chip" data-val="${t}" onclick="toggleChip(this)">${TYPE_MAP[t] || t}</span>`
  ).join('');

  // Base Model chips - try from search
  const bms = ['Illustrious', 'Pony', 'SDXL 1.0', 'SD 1.5', 'Flux.1 D', 'Flux.1 S', 'SD 3.5', 'SD 3.5 Large', 'SD 3.5 Medium', 'Hunyuan 1', 'Other'];
  document.getElementById('filter-bm-chips').innerHTML = bms.map(b =>
    `<span class="chip" data-val="${b}" onclick="toggleChip(this)">${b}</span>`
  ).join('');

  facetsLoaded = true;
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

async function searchModels(page = 0) {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;

  searchPage = page;
  const loading = document.getElementById('search-loading');
  const results = document.getElementById('search-results');
  const pag = document.getElementById('search-pagination');
  const errEl = document.getElementById('search-error');
  errEl.innerHTML = '';
  loading.classList.remove('hidden');
  results.innerHTML = '';
  pag.innerHTML = '';

  const types = getActiveChips('filter-type-chips');
  const bms = getActiveChips('filter-bm-chips');
  const sort = document.getElementById('filter-sort').value;
  const limit = 20;
  const offset = page * limit;

  // Build Meilisearch query
  const filter = [];
  if (types.length > 0) filter.push(types.map(t => `type = ${t}`).join(' OR '));
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
      attributesToRetrieve: ['id', 'name', 'type', 'stats', 'images', 'version', 'lastVersionAtUnix', 'user', 'nsfwLevel'],
      attributesToHighlight: ['name'],
    }]
  };

  try {
    const r = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    loading.classList.add('hidden');

    const res = (d.results || [])[0] || {};
    const hits = res.hits || [];
    const total = res.estimatedTotalHits || 0;

    if (hits.length === 0) {
      results.innerHTML = '<div style="text-align:center;padding:40px;color:var(--t3)">没有找到匹配的模型</div>';
      return;
    }

    results.innerHTML = hits.map(h => renderCivitCard(h)).join('');

    // Pagination
    const totalPages = Math.ceil(total / limit);
    const curPage = page;
    let pagHtml = '';
    if (curPage > 0) pagHtml += `<button class="btn btn-sm" onclick="searchModels(${curPage - 1})">◀ 上一页</button>`;
    pagHtml += `<span style="padding:6px;color:var(--t2);font-size:.82rem">${curPage + 1} / ${totalPages} (共 ${total})</span>`;
    if (curPage < totalPages - 1) pagHtml += `<button class="btn btn-sm" onclick="searchModels(${curPage + 1})">下一页 ▶</button>`;
    pag.innerHTML = pagHtml;
  } catch (e) {
    loading.classList.add('hidden');
    errEl.innerHTML = `<div class="error-msg">搜索失败: ${e.message}</div>`;
  }
}

function renderCivitCard(h) {
  const img = (h.images && h.images[0]) ? (h.images[0].url || '') : '';
  const badgeClass = getBadgeClass((h.type || '').toLowerCase() === 'lora' ? 'loras' : (h.type || '').toLowerCase());
  const bm = h.version?.baseModel || '';
  const inCart = selectedModels.has(String(h.id));

  return `<div class="model-card">
    <div class="model-card-img">${img ? `<img src="${img}" alt="" onerror="this.style.display='none'" loading="lazy">` : '<div class="model-card-no-img">📦</div>'}</div>
    <div class="model-card-body">
      <div class="model-card-title" title="${h.name || ''}">${h.name || 'Unknown'}</div>
      <div class="model-card-meta">
        <span class="badge ${badgeClass}">${h.type || ''}</span>
        ${bm ? `<span class="badge badge-other">${bm}</span>` : ''}
        <span style="font-size:.75rem;color:var(--t2)">⬇️ ${h.stats?.downloadCount?.toLocaleString() || 0}</span>
      </div>
      <div class="model-card-actions">
        <a class="btn btn-sm" href="https://civitai.com/models/${h.id}" target="_blank">🔗 查看</a>
        <button class="btn btn-sm ${inCart ? 'btn-danger' : 'btn-primary'}" onclick="toggleCartFromSearch('${h.id}', this, ${JSON.stringify(h).replace(/"/g, '&quot;')})">${inCart ? '✕ 移除' : '🛒 加入'}</button>
        <button class="btn btn-sm btn-success" onclick="downloadFromSearch('${h.id}', '${(h.type || 'Checkpoint').toLowerCase()}')">📥 下载</button>
      </div>
    </div></div>`;
}

function toggleCartFromSearch(id, btn, data) {
  id = String(id);
  if (selectedModels.has(id)) {
    selectedModels.delete(id);
    btn.textContent = '🛒 加入';
    btn.classList.remove('btn-danger'); btn.classList.add('btn-primary');
  } else {
    selectedModels.set(id, {
      name: data.name || 'Unknown', type: data.type || '',
      imageUrl: (data.images && data.images[0]) ? data.images[0].url : '',
      versionId: data.version?.id, versionName: data.version?.name,
      baseModel: data.version?.baseModel,
    });
    btn.textContent = '✕ 移除';
    btn.classList.add('btn-danger'); btn.classList.remove('btn-primary');
  }
  saveCartToStorage(); updateCartBadge();
}

async function downloadFromSearch(modelId, modelType) {
  showToast(`正在发送下载请求: ${modelId}...`);
  try {
    const r = await fetch('/api/download', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId, model_type: modelType })
    });
    const d = await r.json();
    if (d.error) showToast('❌ ' + d.error);
    else showToast('✅ 下载任务已提交');
  } catch (e) { showToast('请求失败: ' + e.message); }
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
    return `<div class="model-card">
      <div class="model-card-img">${img ? `<img src="${img}" alt="" loading="lazy">` : '<div class="model-card-no-img">📦</div>'}</div>
      <div class="model-card-body">
        <div class="model-card-title">${d.name || ''}</div>
        <div class="model-card-meta">
          <span class="badge ${getBadgeClass((d.type || '').toLowerCase())}">${d.type || ''}</span>
          ${bm ? `<span class="badge badge-other">${bm}</span>` : ''}
          <span style="font-size:.75rem;color:var(--t2)">⬇️ ${d.stats?.downloadCount?.toLocaleString() || 0}</span>
        </div>
        <div class="model-card-actions">
          <a class="btn btn-sm" href="https://civitai.com/models/${d.id}" target="_blank">🔗</a>
          <button class="btn btn-sm btn-success" onclick="downloadFromSearch('${d.id}', '${(d.type || 'Checkpoint').toLowerCase()}')">📥 下载</button>
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
  let html = '<table class="svc-table"><thead><tr><th></th><th>模型</th><th>类型</th><th>操作</th></tr></thead><tbody>';
  for (const [id, m] of selectedModels) {
    html += `<tr>
      <td><img src="${m.imageUrl || ''}" style="width:48px;height:32px;object-fit:cover;border-radius:4px" onerror="this.style.display='none'"></td>
      <td><a href="https://civitai.com/models/${id}" target="_blank" style="color:var(--ac)">${m.name}</a><br><span style="font-size:.72rem;color:var(--t3)">ID: ${id}</span></td>
      <td><span class="badge ${getBadgeClass((m.type || '').toLowerCase())}">${m.type}</span></td>
      <td><button class="btn btn-sm btn-danger" onclick="removeFromCart('${id}')">✕</button></td></tr>`;
  }
  html += '</tbody></table>';

  const idStr = [...selectedModels.keys()].join(',');
  html += `<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
    <button class="btn btn-sm" onclick="copyText('${idStr}')">📋 复制 IDs</button>
    <button class="btn btn-sm btn-primary" onclick="copyText('ALL_MODEL_IDS=\\'${idStr}\\'')">📋 复制为 ALL_MODEL_IDS</button>
  </div>`;

  container.innerHTML = html;
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
