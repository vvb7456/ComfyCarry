// ========== Plugin Management (ES Module) ==========
import { registerPage, showToast, escHtml, renderLoading, renderError } from './core.js';

// --- State ---
let pluginInstalledRaw = {};    // key -> {ver, cnr_id, aux_id, enabled} from /installed
let pluginGetlistCache = {};    // id -> full info from /getlist
let pluginBrowseData = [];      // flat array of all browsable packs
let pluginBrowseIndex = 0;      // pagination index for browse
const PLUGIN_PAGE_SIZE = 40;
let pluginQueuePollTimer = null;
let currentPluginTab = 'installed';

// --- Local helpers ---
function _esc(s) { return (s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }
function _h(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _shortHash(h) { return h && h.length > 8 ? h.substring(0, 8) : (h || 'unknown'); }

// --- Tab switching ---
function switchPluginTab(tab) {
  currentPluginTab = tab;
  document.querySelectorAll('[data-ptab]').forEach(t => t.classList.toggle('active', t.dataset.ptab === tab));
  document.getElementById('ptab-installed').classList.toggle('hidden', tab !== 'installed');
  document.getElementById('ptab-browse').classList.toggle('hidden', tab !== 'browse');
  document.getElementById('ptab-git').classList.toggle('hidden', tab !== 'git');
  if (tab === 'installed') loadInstalledPlugins();
  else if (tab === 'browse' && pluginBrowseData.length === 0) loadBrowsePlugins();
}

// --- Page lifecycle ---
async function loadPluginsPage() {
  await loadInstalledPlugins();
  pollPluginQueue();
}

// ---------- Installed Plugins ----------
async function loadInstalledPlugins() {
  const el = document.getElementById('plugin-installed-list');
  el.innerHTML = renderLoading('加载已安装插件...');
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
    el.innerHTML = renderError('加载失败: ' + e.message);
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

function filterInstalledPlugins() {
  renderInstalledPlugins();
}

// ---------- Browse Plugins ----------
async function loadBrowsePlugins() {
  const el = document.getElementById('plugin-browse-list');
  el.innerHTML = renderLoading('加载插件列表中 (首次可能较慢)...');
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
    el.innerHTML = renderError('加载失败: ' + e.message);
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
    el.innerHTML = renderError('渲染失败: ' + e.message);
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
    statusEl.innerHTML = renderError('安装失败: ' + e.message);
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
    body.innerHTML = renderError(e.message);
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

// ---------- Escape key handler for plugin version modal ----------
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closePluginVersionModal();
});

// ---------- Page registration ----------
registerPage('plugins', {
  enter() { loadPluginsPage(); },
  leave() { stopPluginQueuePoll(); }
});

// ---------- Check updates (fetch_updates) ----------
async function checkPluginUpdates() {
  showToast('🔍 正在检查更新...');
  try {
    const r = await fetch('/api/plugins/fetch_updates');
    const d = await r.json();
    if (d.error) {
      showToast(d.error);
      return;
    }
    if (d.has_updates) {
      showToast('✅ 发现新更新，正在刷新列表...');
      loadPluginsPage();
    } else {
      showToast('所有插件已是最新版本');
    }
  } catch (e) { showToast('检查失败: ' + e.message); }
}

// ---------- Window exports (for onclick in HTML) ----------
Object.assign(window, {
  switchPluginTab,
  filterInstalledPlugins,
  searchPlugins,
  loadMoreBrowsePlugins,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
  updateAllPlugins,
  togglePlugin,
  installPluginFromGit,
  openPluginVersionModal,
  closePluginVersionModal,
  installPluginVersion,
  loadPluginsPage,
  _checkPluginUpdates: checkPluginUpdates,
});
