// ── page-sync.js  ·  Sync 页面模块 ──────────────────────────────
import { registerPage, registerEscapeHandler, fmtBytes, showToast, escHtml, renderEmpty, renderError } from './core.js';
import { createLogStream } from './sse-log.js';

// ── State ───────────────────────────────────────────────────────
let _syncRemotes = [];
let _syncRules = [];
let _syncTemplates = [];
let _syncRemoteTypes = null;
let _editingRuleIdx = -1;
let syncAutoRefresh = null;
let _syncLogStream = null;
let syncStorageCache = null;

// ── Sync Tab 切换 ───────────────────────────────────────────────

function switchSyncTab(tab) {
  ['remotes', 'rules', 'config'].forEach(t => {
    const el = document.getElementById('stab-' + t);
    const tabEl = document.querySelector(`.tab[data-stab="${t}"]`);
    if (el) el.classList.toggle('hidden', t !== tab);
    if (tabEl) tabEl.classList.toggle('active', t === tab);
  });
  if (tab === 'remotes') { loadSyncRemotes(); loadSyncLogs(); }
  else if (tab === 'rules') loadSyncRules();
  else if (tab === 'config') loadSyncConfigTab();
}

// ── 存储服务 Tab ────────────────────────────────────────────────

async function loadSyncRemotes() {
  const addCard = `<div class="sync-remote-card add-card" onclick="showAddRemoteModal()"><span class="add-icon">+</span><span>添加存储</span></div>`;
  try {
    const r = await fetch('/api/sync/remotes');
    const d = await r.json();
    _syncRemotes = d.remotes || [];
    const grid = document.getElementById('sync-remotes-grid');
    grid.innerHTML = _syncRemotes.map(renderSyncRemoteCard).join('') + addCard;
    if (syncStorageCache) {
      for (const r of _syncRemotes) {
        const el = document.getElementById('storage-' + r.name);
        if (el && syncStorageCache[r.name]) renderStorageResult(el, r.name, syncStorageCache[r.name]);
      }
    }
  } catch (e) {
    document.getElementById('sync-remotes-grid').innerHTML = renderError('加载失败');
  }
}

function renderSyncRemoteCard(r) {
  const authIcon = r.has_auth ? '✅ 已认证' : '⚠️ 未配置';
  return `<div class="sync-remote-card">
    <div class="sync-remote-header">
      <div class="sync-remote-name">${r.icon} ${r.display_name} <span class="sync-remote-type">${r.name} · ${r.type}</span></div>
      <span style="font-size:.75rem;color:var(--t3)">${authIcon}</span>
    </div>
    <div class="sync-storage-info" id="storage-${r.name}">
      <button class="btn btn-xs" onclick="refreshRemoteStorage('${r.name}')">🔄 查看容量</button>
    </div>
    <div style="margin-top:8px;display:flex;gap:4px">
      <button class="btn btn-sm" style="font-size:.7rem;color:var(--red)" onclick="deleteRemote('${r.name}')">🗑️ 删除</button>
    </div>
  </div>`;
}

async function deleteRemote(name) {
  if (!confirm(`确定删除 Remote "${name}"？`)) return;
  try {
    const r = await fetch('/api/sync/remote/delete', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name})
    });
    const d = await r.json();
    showToast(d.message || d.error);
    loadSyncRemotes();
  } catch (e) { showToast('删除失败: ' + e.message); }
}

async function refreshRemoteStorage(name) {
  const el = document.getElementById('storage-' + name);
  if (!el) return;
  el.innerHTML = '<span style="color:var(--t3);font-size:.75rem">查询中...</span>';
  try {
    const r = await fetch('/api/sync/storage');
    const d = await r.json();
    syncStorageCache = d.storage || {};
    renderStorageResult(el, name, syncStorageCache[name] || null);
  } catch (e) {
    el.innerHTML = `<span style="font-size:.75rem;color:var(--red)">查询失败</span>`;
  }
}

function renderStorageResult(el, name, info) {
  const btn = `<button class="btn btn-sm" style="font-size:.65rem;padding:1px 6px;margin-left:8px" onclick="refreshRemoteStorage('${name}')">🔄</button>`;
  if (!info) { el.innerHTML = `<span style="color:var(--t3);font-size:.75rem">—</span>${btn}`; return; }
  if (info.error) {
    el.innerHTML = `<span style="font-size:.75rem;color:var(--t3)">${escHtml(info.error)}</span>`;
    return;
  }
  const used = info.used || 0, total = info.total || 0, free = info.free || 0;
  const pct = total > 0 ? (used / total * 100) : 0;
  const barColor = pct > 90 ? '#e74c3c' : pct > 70 ? '#f39c12' : 'var(--ac)';
  el.innerHTML = `<div>已用: ${fmtBytes(used)} / ${fmtBytes(total)}${free ? ` (剩余 ${fmtBytes(free)})` : ''}${btn}</div>
    <div class="sync-storage-bar"><div class="sync-storage-bar-fill" style="width:${pct.toFixed(1)}%;background:${barColor}"></div></div>`;
}

// ── 添加 Remote Modal ───────────────────────────────────────────

async function showAddRemoteModal() {
  if (!_syncRemoteTypes) {
    try {
      const r = await fetch('/api/sync/remote/types');
      _syncRemoteTypes = (await r.json()).types || {};
    } catch (e) { showToast('加载类型失败'); return; }
  }
  const types = _syncRemoteTypes;
  const body = document.getElementById('add-remote-body');
  body.innerHTML = `
    <div style="margin-bottom:10px">
      <label style="font-size:.82rem;color:var(--t2);display:block;margin-bottom:4px">Remote 名称</label>
      <input type="text" id="new-remote-name" placeholder="例如 myr2" style="width:100%">
    </div>
    <div style="margin-bottom:10px">
      <label style="font-size:.82rem;color:var(--t2);display:block;margin-bottom:4px">类型</label>
      <select id="new-remote-type" style="width:100%" onchange="renderRemoteTypeFields()">
        <option value="">选择类型...</option>
        ${Object.entries(types).map(([k,v]) => `<option value="${k}">${v.icon} ${v.label}${v.oauth ? ' (需 OAuth)' : ''}</option>`).join('')}
      </select>
    </div>
    <div id="new-remote-fields"></div>`;
  document.getElementById('add-remote-modal').classList.add('active');
}

function closeSyncModal(id) { document.getElementById(id).classList.remove('active'); }
window.closeSyncModal = closeSyncModal;

function renderRemoteTypeFields() {
  const type = document.getElementById('new-remote-type').value;
  const container = document.getElementById('new-remote-fields');
  if (!type || !_syncRemoteTypes[type]) { container.innerHTML = ''; return; }
  const def = _syncRemoteTypes[type];
  let html = '';
  if (def.oauth) {
    html += `<div style="background:var(--bg2);border:1px solid var(--bd);border-radius:var(--r);padding:10px;margin-bottom:10px;font-size:.8rem;color:var(--t2)">
      <b>OAuth 授权步骤:</b><br>
      1. 在你本地电脑安装 <a href="https://rclone.org/downloads/" target="_blank" style="color:var(--ac)">rclone</a><br>
      2. 运行命令获取 token：<code style="background:var(--bg3);padding:2px 6px;border-radius:4px">rclone authorize "${type}"</code><br>
      3. 完成浏览器授权后，将终端输出的 token JSON 粘贴到下方</div>`;
  }
  for (const f of def.fields) {
    const val = f.default || '';
    const req = f.required ? ' <span style="color:var(--red)">*</span>' : '';
    html += `<div style="margin-bottom:8px">
      <label style="font-size:.82rem;color:var(--t2);display:block;margin-bottom:3px">${f.label}${req}</label>`;
    if (f.type === 'select') {
      html += `<select id="rf-${f.key}" style="width:100%">${(f.options||[]).map(o =>
        `<option value="${o}"${o===val?' selected':''}>${o}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      html += `<textarea id="rf-${f.key}" style="width:100%;min-height:80px;font-family:monospace;font-size:.78rem" placeholder="${f.placeholder||''}"></textarea>`;
      if (f.help) html += `<div style="font-size:.72rem;color:var(--t3);margin-top:2px">${f.help}</div>`;
    } else {
      html += `<input type="${f.type === 'password' ? 'password' : 'text'}" id="rf-${f.key}" value="${escHtml(val)}" placeholder="${f.placeholder||''}" style="width:100%">`;
    }
    html += '</div>';
  }
  container.innerHTML = html;
}

async function submitAddRemote() {
  const name = document.getElementById('new-remote-name').value.trim();
  const type = document.getElementById('new-remote-type').value;
  if (!name || !type) { showToast('请填写名称和类型'); return; }
  const def = _syncRemoteTypes[type];
  if (!def) return;
  const params = {};
  for (const f of def.fields) {
    const el = document.getElementById('rf-' + f.key);
    if (el) params[f.key] = el.value.trim();
    if (f.required && !params[f.key]) { showToast(`请填写 ${f.label}`); return; }
  }
  try {
    const r = await fetch('/api/sync/remote/create', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name, type, params})
    });
    const d = await r.json();
    if (d.ok) {
      showToast(d.message);
      closeSyncModal('add-remote-modal');
      loadSyncRemotes();
    } else {
      showToast('创建失败: ' + (d.error || '未知'));
    }
  } catch (e) { showToast('创建失败: ' + e.message); }
}

// ── 同步规则 Tab ────────────────────────────────────────────────

async function loadSyncRules() {
  try {
    const r = await fetch('/api/sync/status');
    const d = await r.json();
    _syncRules = d.rules || [];
    _syncTemplates = d.templates || [];
    renderSyncRulesList();
  } catch (e) {
    document.getElementById('sync-rules-list').innerHTML = renderError('加载失败');
  }
}

function renderSyncRulesList() {
  const el = document.getElementById('sync-rules-list');
  const addCard = `<div class="sync-rule-card add-card" onclick="showAddRuleModal()" style="min-height:60px"><span class="add-icon">+</span><span>添加规则</span></div>`;
  if (_syncRules.length === 0) {
    el.innerHTML = addCard;
    return;
  }
  el.innerHTML = _syncRules.map((r, i) => {
    const dir = r.direction === 'pull' ? '⬇' : '⬆';
    const triggerMap = {deploy: '📦 部署时', watch: '👁 监控', manual: '🖐 手动'};
    const methodMap = {sync: '镜像同步', copy: '复制', move: '移动'};
    const arrows = '<span class="sync-flow-arrows"><span>▸</span><span>▸</span><span>▸</span></span>';
    const pathDetail = r.direction === 'push'
      ? `<span style="opacity:.6">📁</span> ${escHtml(r.local_path)} ${arrows} <span style="opacity:.6">☁️</span> ${escHtml(r.remote)}:${escHtml(r.remote_path)}`
      : `<span style="opacity:.6">☁️</span> ${escHtml(r.remote)}:${escHtml(r.remote_path)} ${arrows} <span style="opacity:.6">📁</span> ${escHtml(r.local_path)}`;
    return `<div class="sync-rule-card${r.enabled === false ? ' disabled' : ''}">
      <div class="sync-rule-dir">${dir}</div>
      <div class="sync-rule-info">
        <div class="sync-rule-name">${escHtml(r.name || r.id)}</div>
        <div class="sync-rule-detail">${pathDetail}</div>
        <div class="sync-rule-badges">
          <span class="sync-rule-badge">${triggerMap[r.trigger] || r.trigger}</span>
          <span class="sync-rule-badge">${methodMap[r.method] || r.method}</span>
          ${r.trigger === 'watch' ? `<span class="sync-rule-badge">${r.watch_interval || 15}s</span>` : ''}
        </div>
      </div>
      <div class="sync-rule-actions">
        <button class="btn btn-sm" onclick="runSingleRule('${r.id}')" title="立即执行">▶</button>
        <button class="btn btn-sm" onclick="editRule(${i})" title="编辑">✏️</button>
        <button class="btn btn-sm" onclick="toggleRule(${i})" title="${r.enabled !== false ? '禁用' : '启用'}">${r.enabled !== false ? '⏸' : '▶'}</button>
        <button class="btn btn-sm" onclick="deleteRule(${i})" title="删除" style="color:var(--red)">🗑️</button>
      </div>
    </div>`;
  }).join('') + addCard;
}

async function saveSyncRules() {
  try {
    const r = await fetch('/api/sync/rules/save', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({rules: _syncRules})
    });
    const d = await r.json();
    if (d.ok) showToast(d.message);
    else showToast('保存失败: ' + (d.error || ''));
  } catch (e) { showToast('保存失败: ' + e.message); }
}

async function runSingleRule(ruleId) {
  showToast('执行中...');
  try {
    await fetch('/api/sync/rules/run', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({rule_id: ruleId})
    });
    showToast('规则已开始执行，查看日志了解进度');
  } catch (e) { showToast('执行失败: ' + e.message); }
}

async function runDeployRules() {
  if (!confirm('执行全部「部署时」规则？')) return;
  try {
    await fetch('/api/sync/rules/run', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({})
    });
    showToast('开始执行部署规则...');
  } catch (e) { showToast('执行失败: ' + e.message); }
}

function toggleRule(idx) {
  _syncRules[idx].enabled = _syncRules[idx].enabled === false ? true : false;
  renderSyncRulesList();
  saveSyncRules();
}

function deleteRule(idx) {
  if (!confirm(`删除规则「${_syncRules[idx].name}」？`)) return;
  _syncRules.splice(idx, 1);
  renderSyncRulesList();
  saveSyncRules();
}

function editRule(idx) {
  _editingRuleIdx = idx;
  showRuleForm(_syncRules[idx]);
}

// ── 添加/编辑规则 Modal ─────────────────────────────────────────

function showAddRuleModal() {
  _editingRuleIdx = -1;
  showRuleForm(null);
}

function showRuleForm(rule) {
  const isEdit = !!rule;
  document.getElementById('add-rule-title').textContent = isEdit ? '编辑同步规则' : '添加同步规则';
  const body = document.getElementById('add-rule-body');

  // 模板快捷按钮 (仅新增时显示)
  let tplHtml = '';
  if (!isEdit && _syncTemplates.length) {
    tplHtml = `<div style="margin-bottom:12px">
      <label style="font-size:.82rem;color:var(--t2);display:block;margin-bottom:6px">快捷模板:</label>
      <div style="display:flex;flex-wrap:wrap;gap:4px">
        ${_syncTemplates.map((t,i) => `<button class="btn btn-sm" style="font-size:.72rem" onclick="applyTemplate(${i})">${t.name}</button>`).join('')}
      </div>
    </div><hr style="border-color:var(--bd);margin:12px 0">`;
  }

  const remoteOpts = _syncRemotes.map(r => `<option value="${r.name}"${rule && rule.remote === r.name ? ' selected' : ''}>${r.icon} ${r.name}</option>`).join('');
  const r = rule || {};

  body.innerHTML = `${tplHtml}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label style="font-size:.82rem;color:var(--t2);display:block;margin-bottom:3px">规则名称</label>
        <input type="text" id="rule-name" value="${escHtml(r.name || '')}" placeholder="例如：下载工作流" style="width:100%">
      </div>
      <div>
        <label style="font-size:.82rem;color:var(--t2);display:block;margin-bottom:3px">方向</label>
        <select id="rule-direction" style="width:100%">
          <option value="pull"${r.direction === 'pull' ? ' selected' : ''}>⬇ Pull (远程→本地)</option>
          <option value="push"${r.direction === 'push' ? ' selected' : ''}>⬆ Push (本地→远程)</option>
        </select>
      </div>
      <div>
        <label style="font-size:.82rem;color:var(--t2);display:block;margin-bottom:3px">Remote</label>
        <select id="rule-remote" style="width:100%">
          <option value="">选择...</option>
          ${remoteOpts}
        </select>
      </div>
      <div>
        <label style="font-size:.82rem;color:var(--t2);display:block;margin-bottom:3px">远程路径</label>
        <div style="display:flex;gap:4px">
          <input type="text" id="rule-remote-path" value="${escHtml(r.remote_path || '')}" placeholder="bucket/folder" style="flex:1">
          <button class="btn btn-sm" onclick="window._browseRemotePath()" title="浏览远程目录" style="padding:4px 8px;flex-shrink:0">📂</button>
        </div>
      </div>
      <div>
        <label style="font-size:.82rem;color:var(--t2);display:block;margin-bottom:3px">本地路径 (相对 ComfyUI)</label>
        <div style="display:flex;gap:4px">
          <input type="text" id="rule-local-path" value="${escHtml(r.local_path || '')}" placeholder="models/loras" style="flex:1">
          <button class="btn btn-sm" onclick="window._browseLocalPath()" title="浏览本地目录" style="padding:4px 8px;flex-shrink:0">📂</button>
        </div>
      </div>
      <div>
        <label style="font-size:.82rem;color:var(--t2);display:block;margin-bottom:3px">方法 <span class="comfy-param-help-icon" data-tip="copy: 复制文件，保留源端&#10;sync: 镜像同步，目标多余文件会被删除&#10;move: 移动文件，完成后删除源端&#10;&#10;同目录多规则时 copy 会在 move 之前执行，不会冲突">?</span></label>
        <select id="rule-method" style="width:100%">
          <option value="copy"${r.method === 'copy' ? ' selected' : ''}>copy — 复制文件 (保留源端)</option>
          <option value="sync"${r.method === 'sync' ? ' selected' : ''}>sync — 镜像同步 (目标多余文件会被删除!)</option>
          <option value="move"${r.method === 'move' ? ' selected' : ''}>move — 移动文件 (完成后删除源端)</option>
        </select>
      </div>
      <div>
        <label style="font-size:.82rem;color:var(--t2);display:block;margin-bottom:3px">触发方式</label>
        <select id="rule-trigger" style="width:100%">
          <option value="deploy"${r.trigger === 'deploy' ? ' selected' : ''}>📦 部署时执行</option>
          <option value="watch"${r.trigger === 'watch' ? ' selected' : ''}>👁 持续监控</option>
          <option value="manual"${r.trigger === 'manual' ? ' selected' : ''}>🖐 仅手动执行</option>
        </select>
      </div>
    </div>
    <div style="margin-top:10px">
      <label style="font-size:.82rem;color:var(--t2);display:block;margin-bottom:3px">过滤规则 (每行一条 rclone filter)</label>
      <textarea id="rule-filters" style="width:100%;min-height:50px;font-family:monospace;font-size:.78rem" placeholder="+ *.{png,jpg}&#10;- .*/**&#10;- *">${(r.filters || []).join('\n')}</textarea>
    </div>`;

  document.getElementById('add-rule-modal').classList.add('active');
}

function applyTemplate(idx) {
  const t = _syncTemplates[idx];
  if (!t) return;
  document.getElementById('rule-name').value = t.name;
  document.getElementById('rule-direction').value = t.direction || 'pull';
  document.getElementById('rule-remote-path').value = t.remote_path || '';
  document.getElementById('rule-local-path').value = t.local_path || '';
  document.getElementById('rule-method').value = t.method || 'sync';
  document.getElementById('rule-trigger').value = t.trigger || 'deploy';
  document.getElementById('rule-filters').value = (t.filters || []).join('\n');
  // 自动选第一个 remote
  const sel = document.getElementById('rule-remote');
  if (sel.options.length > 1 && !sel.value) sel.selectedIndex = 1;
}

function submitAddRule() {
  const name = document.getElementById('rule-name').value.trim();
  const remote = document.getElementById('rule-remote').value;
  const localPath = document.getElementById('rule-local-path').value.trim();
  if (!name || !remote || !localPath) { showToast('请填写名称、Remote 和本地路径'); return; }

  const rule = {
    id: _editingRuleIdx >= 0 ? _syncRules[_editingRuleIdx].id : 'rule-' + Date.now(),
    name,
    direction: document.getElementById('rule-direction').value,
    remote,
    remote_path: document.getElementById('rule-remote-path').value.trim(),
    local_path: localPath,
    method: document.getElementById('rule-method').value,
    trigger: document.getElementById('rule-trigger').value,
    enabled: true,
  };
  const filtersText = document.getElementById('rule-filters').value.trim();
  if (filtersText) {
    rule.filters = filtersText.split('\n').map(l => l.trim()).filter(Boolean);
  }

  if (_editingRuleIdx >= 0) {
    rule.enabled = _syncRules[_editingRuleIdx].enabled;
    _syncRules[_editingRuleIdx] = rule;
  } else {
    _syncRules.push(rule);
  }

  closeSyncModal('add-rule-modal');
  renderSyncRulesList();
  saveSyncRules();
}

// ── 日志 Tab ────────────────────────────────────────────────────

async function loadSyncLogs() {
  try {
    const r = await fetch('/api/sync/status');
    const d = await r.json();
    const on = d.worker_running;
    // ── Header badge + controls ──
    const hBadge = document.getElementById('sync-header-badge');
    if (hBadge) {
      const color = on ? 'var(--green)' : 'var(--t3)';
      const label = on ? '运行中' : '已停止';
      hBadge.innerHTML = `<span class="page-status-dot" style="background:${color}"></span> <span style="color:${color}">${label}</span>`;
    }
    const hCtrl = document.getElementById('sync-header-controls');
    if (hCtrl) {
      hCtrl.innerHTML = on
        ? `<button class="btn" onclick="toggleSyncWorker()">⏹ 停止</button><button class="btn" onclick="_restartSyncWorker()">♻️ 重启</button>`
        : `<button class="btn" onclick="toggleSyncWorker()">▶ 启动</button>`;
    }
  } catch (e) {
    // header badge loading failed silently
  }
}

function _startSyncLogStream() {
  _stopSyncLogStream();
  const el = document.getElementById('sync-log-content');
  if (!el) return;
  _syncLogStream = createLogStream({
    el,
    historyUrl: '/api/sync/status',
    historyExtract: (data) => data.log_lines || [],
    streamUrl: '/api/sync/logs/stream',
    classify: line => {
      if (/❌|失败/i.test(line)) return 'log-error';
      if (/⬆|⬇|🔍/i.test(line)) return 'log-info';
      if (/✅/i.test(line)) return 'log-info';
      return '';
    },
  });
  _syncLogStream.start();
}

function _stopSyncLogStream() {
  if (_syncLogStream) { _syncLogStream.stop(); _syncLogStream = null; }
}

async function _restartSyncWorker() {
  try {
    await fetch('/api/sync/worker/stop', { method: 'POST' });
    await new Promise(r => setTimeout(r, 1000));
    await fetch('/api/sync/worker/start', { method: 'POST' });
    showToast('♻️ Sync Worker 已重启');
    setTimeout(loadSyncLogs, 2000);
  } catch (e) { showToast('重启失败: ' + e.message); }
}

async function toggleSyncWorker() {
  try {
    const r = await fetch('/api/sync/status');
    const d = await r.json();
    const running = d.worker_running;
    const url = running ? '/api/sync/worker/stop' : '/api/sync/worker/start';
    await fetch(url, {method: 'POST'});
    showToast(running ? 'Worker 已停止' : 'Worker 已启动');
    setTimeout(loadSyncLogs, 1500);
  } catch (e) {
    showToast('操作失败: ' + e.message);
  }
}

// ── Rclone 配置导入 (保留旧功能) ────────────────────────────────

async function importConfigFromUrl() {
  const url = document.getElementById('import-url').value.trim();
  if (!url) { showToast('请输入 URL'); return; }
  try {
    const r = await fetch('/api/sync/import_config', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({type: 'url', value: url})
    });
    const d = await r.json();
    if (d.ok) { showToast(d.message); document.getElementById('import-url').value = ''; loadSyncConfigTab(); }
    else showToast('导入失败: ' + (d.error || ''));
  } catch (e) { showToast('导入失败: ' + e.message); }
}

async function importConfigFromBase64() {
  const b64 = document.getElementById('import-base64').value.trim();
  if (!b64) { showToast('请输入 base64 内容'); return; }
  try {
    const r = await fetch('/api/sync/import_config', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({type: 'base64', value: b64})
    });
    const d = await r.json();
    if (d.ok) { showToast(d.message); document.getElementById('import-base64').value = ''; loadSyncConfigTab(); }
    else showToast('导入失败: ' + (d.error || ''));
  } catch (e) { showToast('导入失败: ' + e.message); }
}

// ── Config Tab (rclone GUI + sync settings) ─────────────────────

function _parseRcloneConf(text) {
  const sections = [];
  let current = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const secMatch = trimmed.match(/^\[(.+)\]$/);
    if (secMatch) {
      current = { name: secMatch[1], fields: [] };
      sections.push(current);
    } else if (current) {
      const kvMatch = trimmed.match(/^(\S+)\s*=\s*(.*)$/);
      if (kvMatch) {
        current.fields.push({ key: kvMatch[1], value: kvMatch[2].trim() });
      }
    }
  }
  return sections;
}

function _serializeRcloneConf(sections) {
  return sections.map(s => {
    let text = `[${s.name}]\n`;
    for (const f of s.fields) {
      text += `${f.key} = ${f.value}\n`;
    }
    return text;
  }).join('\n');
}

function _fieldType(key, value) {
  const k = key.toLowerCase();
  if (value.length > 100 || value.startsWith('{')) return 'textarea';
  if (value === 'true' || value === 'false') return 'toggle';
  if (/secret|password|^pass$/.test(k)) return 'password';
  return 'text';
}

async function loadSyncConfigTab() {
  // Load sync settings
  try {
    const r = await fetch('/api/sync/settings');
    const s = await r.json();
    document.getElementById('cfg-min-age').value = s.min_age ?? 30;
    document.getElementById('cfg-watch-interval').value = s.watch_interval ?? 60;
  } catch(e) {}

  // Load rclone config
  const formEl = document.getElementById('rclone-config-form');
  try {
    const r = await fetch('/api/sync/rclone_config');
    const d = await r.json();
    if (!d.exists || !d.config.trim()) {
      formEl.innerHTML = renderEmpty('暂无 rclone 配置，可上传本地文件或使用「存储」tab 添加 Remote');
      return;
    }
    const sections = _parseRcloneConf(d.config);
    if (sections.length === 0) {
      formEl.innerHTML = renderEmpty('配置文件为空或格式无法识别');
      return;
    }
    _renderRcloneForm(formEl, sections);
  } catch (e) {
    formEl.innerHTML = renderError('加载配置失败: ' + e.message);
  }
}

function _renderRcloneForm(container, sections) {
  let html = '';
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    const typeField = sec.fields.find(f => f.key === 'type');
    const typeLabel = typeField ? typeField.value : '';
    html += `<div class="rclone-section-card" data-section="${si}">
      <div class="rclone-section-header">
        <div>
          <span class="rclone-section-name">${escHtml(sec.name)}</span>
          ${typeLabel ? `<span class="rclone-section-type">${escHtml(typeLabel)}</span>` : ''}
        </div>
        <button class="btn btn-sm" style="color:var(--red);font-size:.72rem" onclick="removeRcloneSection(${si})" title="删除此 Remote">🗑️ 删除</button>
      </div>
      <div class="rclone-fields-grid">`;

    for (let fi = 0; fi < sec.fields.length; fi++) {
      const f = sec.fields[fi];
      const ft = _fieldType(f.key, f.value);
      const inputId = `rcf-${si}-${fi}`;
      const isWide = ft === 'textarea';

      html += `<div class="rclone-field${isWide ? ' wide' : ''}">
        <label for="${inputId}">${escHtml(f.key)}</label>`;

      if (ft === 'toggle') {
        html += `<label class="comfy-param-toggle" style="margin:0">
          <input type="checkbox" id="${inputId}" data-sec="${si}" data-fi="${fi}" ${f.value === 'true' ? 'checked' : ''}>
          <span class="comfy-toggle-slider"></span>
          <span style="font-size:.78rem;color:var(--t2)">${f.value === 'true' ? 'true' : 'false'}</span>
        </label>`;
      } else if (ft === 'textarea') {
        html += `<textarea id="${inputId}" data-sec="${si}" data-fi="${fi}" spellcheck="false">${escHtml(f.value)}</textarea>`;
      } else if (ft === 'password') {
        html += `<div class="field-input-wrap">
          <input type="password" id="${inputId}" data-sec="${si}" data-fi="${fi}" value="${escHtml(f.value)}">
          <button class="btn btn-sm" onclick="this.previousElementSibling.type=this.previousElementSibling.type==='password'?'text':'password'" title="显示/隐藏" style="flex-shrink:0">👁️</button>
        </div>`;
      } else {
        html += `<input type="text" id="${inputId}" data-sec="${si}" data-fi="${fi}" value="${escHtml(f.value)}">`;
      }

      html += '</div>';
    }

    html += '</div></div>';
  }
  container.innerHTML = html;

  // Bind toggle label updates
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const label = cb.parentElement.querySelector('span:last-child');
      if (label) label.textContent = cb.checked ? 'true' : 'false';
    });
  });
}

function _collectRcloneFromForm() {
  const container = document.getElementById('rclone-config-form');
  const cards = container.querySelectorAll('.rclone-section-card');
  const sections = [];
  for (const card of cards) {
    const si = parseInt(card.dataset.section);
    const nameEl = card.querySelector('.rclone-section-name');
    const name = nameEl ? nameEl.textContent : `remote${si}`;
    const fields = [];
    card.querySelectorAll('[data-fi]').forEach(el => {
      const key = el.closest('.rclone-field')?.querySelector('label')?.textContent || '';
      let value;
      if (el.type === 'checkbox') {
        value = el.checked ? 'true' : 'false';
      } else {
        value = el.value;
      }
      fields.push({ key, value });
    });
    sections.push({ name, fields });
  }
  return sections;
}

function removeRcloneSection(si) {
  const card = document.querySelector(`.rclone-section-card[data-section="${si}"]`);
  if (!card) return;
  const name = card.querySelector('.rclone-section-name')?.textContent || '';
  if (!confirm(`确定删除 Remote "${name}"？\n保存后生效。`)) return;
  card.remove();
  showToast(`已标记删除 "${name}"，点击保存生效`);
}

async function saveSyncConfigAll() {
  // 1. Save sync settings
  const min_age = parseInt(document.getElementById('cfg-min-age').value) || 30;
  const watch_interval = parseInt(document.getElementById('cfg-watch-interval').value) || 60;
  try {
    await fetch('/api/sync/settings', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ min_age, watch_interval })
    });
  } catch(e) {
    showToast('同步设置保存失败: ' + e.message, 'error');
    return;
  }

  // 2. Save rclone config (if form has sections)
  const cards = document.querySelectorAll('.rclone-section-card');
  if (cards.length > 0) {
    const sections = _collectRcloneFromForm();
    const configText = _serializeRcloneConf(sections);
    try {
      const r = await fetch('/api/sync/rclone_config', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ config: configText })
      });
      const d = await r.json();
      if (d.ok) {
        showToast('✅ ' + d.message);
      } else {
        showToast('❌ ' + (d.error || '保存失败'), 'error');
        return;
      }
    } catch(e) {
      showToast('rclone 配置保存失败: ' + e.message, 'error');
      return;
    }
  } else {
    showToast('✅ 同步设置已保存');
  }
}

async function uploadRcloneFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    if (!text.trim()) { showToast('文件为空'); return; }
    if (!confirm('确定上传并覆盖当前 rclone 配置？旧配置将备份为 rclone.conf.bak')) return;
    const r = await fetch('/api/sync/rclone_config', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ config: text })
    });
    const d = await r.json();
    if (d.ok) {
      showToast('✅ ' + d.message);
      loadSyncConfigTab();
      loadSyncRemotes();
    } else {
      showToast('❌ ' + (d.error || '上传失败'), 'error');
    }
  } catch(e) {
    showToast('上传失败: ' + e.message, 'error');
  }
  // Reset file input
  event.target.value = '';
}

// ── Sync Page Lifecycle ─────────────────────────────────────────

async function loadSyncPage() {
  loadSyncRemotes();
  loadSyncLogs();
}

function startSyncAutoRefresh() {
  stopSyncAutoRefresh();
  syncAutoRefresh = setInterval(() => {
    const remotesTab = document.getElementById('stab-remotes');
    if (remotesTab && !remotesTab.classList.contains('hidden')) loadSyncLogs();
  }, 10000);
}

function stopSyncAutoRefresh() {
  if (syncAutoRefresh) { clearInterval(syncAutoRefresh); syncAutoRefresh = null; }
}

// ── Page Registration ───────────────────────────────────────────

registerPage('sync', {
  enter() { loadSyncPage(); startSyncAutoRefresh(); _startSyncLogStream(); },
  leave() { stopSyncAutoRefresh(); _stopSyncLogStream(); }
});

registerEscapeHandler(() => {
  closeSyncModal('add-remote-modal');
  closeSyncModal('add-rule-modal');
  closeSyncModal('remote-browse-modal');
});

// ── 目录浏览 (树状图，支持远程和本地) ──────────────────────────

let _browsePath = '';
let _browseRemote = '';
let _browseMode = 'remote'; // 'remote' | 'local'

window._browseRemotePath = function() {
  const remote = document.getElementById('rule-remote')?.value;
  if (!remote) { showToast('请先选择 Remote'); return; }
  _browseMode = 'remote';
  _browseRemote = remote;
  _browsePath = document.getElementById('rule-remote-path')?.value || '';
  document.getElementById('browse-modal-title').textContent = '📂 浏览远程目录';
  document.getElementById('remote-browse-modal')?.classList.add('active');
  _browseLoadDir(_browsePath);
};

window._browseLocalPath = function() {
  _browseMode = 'local';
  _browsePath = document.getElementById('rule-local-path')?.value || '';
  document.getElementById('browse-modal-title').textContent = '📂 浏览本地目录';
  document.getElementById('remote-browse-modal')?.classList.add('active');
  _browseLoadDir(_browsePath);
};

async function _browseLoadDir(path) {
  _browsePath = path;
  const treeEl = document.getElementById('browse-tree');
  const breadEl = document.getElementById('browse-breadcrumb');

  // 面包屑导航
  const parts = path ? path.split('/').filter(Boolean) : [];
  const rootLabel = _browseMode === 'remote' ? `☁️ ${escHtml(_browseRemote)}:/` : '📁 ComfyUI/';
  let crumb = `<span style="cursor:pointer;color:var(--ac)" onclick="window._browseNav('')">${rootLabel}</span>`;
  let acc = '';
  for (const p of parts) {
    acc += (acc ? '/' : '') + p;
    const escaped = acc.replace(/'/g, "\\'");
    crumb += ` / <span style="cursor:pointer;color:var(--ac)" onclick="window._browseNav('${escaped}')">${escHtml(p)}</span>`;
  }
  breadEl.innerHTML = crumb;

  treeEl.innerHTML = '<div style="padding:16px;color:var(--t3);text-align:center">加载中...</div>';

  try {
    const apiUrl = _browseMode === 'remote' ? '/api/sync/remote/browse' : '/api/sync/local/browse';
    const body = _browseMode === 'remote'
      ? { remote: _browseRemote, path }
      : { path };
    const r = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if (!d.ok && d.error) { treeEl.innerHTML = `<div style="padding:16px;color:var(--red)">${escHtml(d.error)}</div>`; return; }

    const dirs = d.dirs || [];
    let html = '';

    if (path) {
      const parentPath = parts.slice(0, -1).join('/');
      html += `<div class="browse-item" onclick="window._browseNav('${parentPath.replace(/'/g, "\\'")}')" style="cursor:pointer;padding:6px 10px;display:flex;align-items:center;gap:6px;border-radius:6px" onmouseenter="this.style.background='var(--bg2)'" onmouseleave="this.style.background=''">
        <span style="font-size:1.1em">⬆️</span>
        <span style="color:var(--t2)">..</span>
      </div>`;
    }

    if (dirs.length === 0 && !path) {
      html += '<div style="padding:16px;color:var(--t3);text-align:center">根目录下无子目录</div>';
    } else if (dirs.length === 0) {
      html += '<div style="padding:16px;color:var(--t3);text-align:center">无子目录</div>';
    }

    for (const dir of dirs) {
      const fullPath = path ? `${path}/${dir}` : dir;
      const escaped = fullPath.replace(/'/g, "\\'");
      html += `<div class="browse-item" onclick="window._browseNav('${escaped}')" style="cursor:pointer;padding:6px 10px;display:flex;align-items:center;gap:6px;border-radius:6px" onmouseenter="this.style.background='var(--bg2)'" onmouseleave="this.style.background=''">
        <span style="font-size:1.1em">📁</span>
        <span>${escHtml(dir)}</span>
      </div>`;
    }

    treeEl.innerHTML = html;
  } catch (e) {
    treeEl.innerHTML = `<div style="padding:16px;color:var(--red)">加载失败: ${escHtml(e.message)}</div>`;
  }
}

window._browseNav = function(path) {
  _browseLoadDir(path);
};

window._browseSelect = function() {
  const targetId = _browseMode === 'remote' ? 'rule-remote-path' : 'rule-local-path';
  document.getElementById(targetId).value = _browsePath;
  closeSyncModal('remote-browse-modal');
  showToast(`✅ 已选择: ${_browsePath || '/'}`);
};

// ── Window Exports (for onclick attributes in HTML) ─────────────

Object.assign(window, {
  switchSyncTab,
  loadSyncRemotes,
  renderSyncRemoteCard,
  deleteRemote,
  refreshRemoteStorage,
  showAddRemoteModal,
  closeSyncModal,
  renderRemoteTypeFields,
  submitAddRemote,
  loadSyncRules,
  saveSyncRules,
  runSingleRule,
  runDeployRules,
  toggleRule,
  deleteRule,
  editRule,
  showAddRuleModal,
  applyTemplate,
  submitAddRule,
  loadSyncLogs,
  toggleSyncWorker,
  _restartSyncWorker,
  importConfigFromUrl,
  importConfigFromBase64,
  loadSyncConfigTab,
  saveSyncConfigAll,
  uploadRcloneFile,
  removeRcloneSection,
  loadSyncPage,
  startSyncAutoRefresh,
  stopSyncAutoRefresh,
});
