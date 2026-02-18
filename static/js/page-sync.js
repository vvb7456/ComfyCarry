// ── page-sync.js  ·  Sync 页面模块 ──────────────────────────────
import { registerPage, registerEscapeHandler, fmtBytes, showToast, escHtml } from './core.js';

// ── State ───────────────────────────────────────────────────────
let _syncRemotes = [];
let _syncRules = [];
let _syncTemplates = [];
let _syncRemoteTypes = null;
let _editingRuleIdx = -1;
let syncAutoRefresh = null;
let syncStorageCache = null;
let rcloneConfigLoaded = false;

// ── Sync Tab 切换 ───────────────────────────────────────────────

function switchSyncTab(tab) {
  ['remotes', 'rules'].forEach(t => {
    const el = document.getElementById('stab-' + t);
    const tabEl = document.querySelector(`.tab[data-stab="${t}"]`);
    if (el) el.classList.toggle('hidden', t !== tab);
    if (tabEl) tabEl.classList.toggle('active', t === tab);
  });
  if (tab === 'remotes') { loadSyncRemotes(); loadSyncLogs(); }
  else if (tab === 'rules') loadSyncRules();
}

// ── 存储服务 Tab ────────────────────────────────────────────────

async function loadSyncRemotes() {
  try {
    const r = await fetch('/api/sync/remotes');
    const d = await r.json();
    _syncRemotes = d.remotes || [];
    const grid = document.getElementById('sync-remotes-grid');
    if (_syncRemotes.length === 0) {
      grid.innerHTML = '<div style="color:var(--t3);font-size:.85rem;padding:8px 0">未检测到 rclone remote，请添加存储或导入配置</div>';
    } else {
      grid.innerHTML = _syncRemotes.map(renderSyncRemoteCard).join('');
      if (syncStorageCache) {
        for (const r of _syncRemotes) {
          const el = document.getElementById('storage-' + r.name);
          if (el && syncStorageCache[r.name]) renderStorageResult(el, r.name, syncStorageCache[r.name]);
        }
      }
    }
  } catch (e) {
    document.getElementById('sync-remotes-grid').innerHTML = '<div style="color:var(--red)">加载失败</div>';
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
      <button class="btn btn-sm" style="font-size:.7rem;padding:2px 8px" onclick="refreshRemoteStorage('${r.name}')">🔄 查看容量</button>
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

async function showSyncSettings() {
  try {
    const r = await fetch('/api/sync/settings');
    const s = await r.json();
    document.getElementById('sync-set-min-age').value = s.min_age ?? 30;
    document.getElementById('sync-set-interval').value = s.watch_interval ?? 60;
  } catch(e) {}
  document.getElementById('sync-settings-modal').classList.add('active');
}

async function saveSyncSettings() {
  const min_age = parseInt(document.getElementById('sync-set-min-age').value) || 30;
  const watch_interval = parseInt(document.getElementById('sync-set-interval').value) || 60;
  try {
    const r = await fetch('/api/sync/settings', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ min_age, watch_interval })
    });
    const d = await r.json();
    if (d.ok) {
      showToast('同步设置已保存');
      closeSyncModal('sync-settings-modal');
    } else {
      showToast('保存失败', 'error');
    }
  } catch(e) {
    showToast('保存失败: ' + e.message, 'error');
  }
}

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
    const [rulesR, statusR] = await Promise.allSettled([
      fetch('/api/sync/rules').then(r => r.json()),
      fetch('/api/sync/status').then(r => r.json())
    ]);
    if (rulesR.status === 'fulfilled') {
      _syncRules = rulesR.value.rules || [];
      _syncTemplates = rulesR.value.templates || [];
      renderSyncRulesList();
    }
    if (statusR.status === 'fulfilled') {
      const on = statusR.value.worker_running;
      const statusText = `<span style="color:${on?'var(--green)':'var(--t3)'}">● Worker ${on?'运行中':'已停止'}</span>`;
      const badge = document.getElementById('sync-worker-badge');
      if (badge) badge.innerHTML = statusText;
    }
  } catch (e) {
    document.getElementById('sync-rules-list').innerHTML = '<div style="color:var(--red)">加载失败</div>';
  }
}

function renderSyncRulesList() {
  const el = document.getElementById('sync-rules-list');
  if (_syncRules.length === 0) {
    el.innerHTML = '<div style="color:var(--t3);font-size:.85rem;padding:16px 0">暂无同步规则，点击右上角「+ 添加规则」开始配置</div>';
    return;
  }
  el.innerHTML = _syncRules.map((r, i) => {
    const dir = r.direction === 'pull' ? '⬇' : '⬆';
    const triggerMap = {deploy: '📦 部署时', watch: '👁 监控', manual: '🖐 手动'};
    const methodMap = {sync: '镜像同步', copy: '复制', move: '移动'};
    return `<div class="sync-rule-card${r.enabled === false ? ' disabled' : ''}">
      <div class="sync-rule-dir">${dir}</div>
      <div class="sync-rule-info">
        <div class="sync-rule-name">${escHtml(r.name || r.id)}</div>
        <div class="sync-rule-detail">${escHtml(r.remote)}:${escHtml(r.remote_path)} ↔ ${escHtml(r.local_path)}</div>
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
  }).join('');
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
        <input type="text" id="rule-name" value="${escHtml(r.name || '')}" placeholder="例如：下拉工作流" style="width:100%">
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
        <input type="text" id="rule-remote-path" value="${escHtml(r.remote_path || '')}" placeholder="bucket/folder" style="width:100%">
      </div>
      <div>
        <label style="font-size:.82rem;color:var(--t2);display:block;margin-bottom:3px">本地路径 (相对 ComfyUI)</label>
        <input type="text" id="rule-local-path" value="${escHtml(r.local_path || '')}" placeholder="models/loras" style="width:100%">
      </div>
      <div>
        <label style="font-size:.82rem;color:var(--t2);display:block;margin-bottom:3px">方法 <span title="copy: 复制文件，保留源端\nsync: 镜像同步，目标多余文件会被删除\nmove: 移动文件，完成后删除源端\n\n同目录多规则时 copy 会在 move 之前执行，不会冲突" style="cursor:help;opacity:.6">❓</span></label>
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
    // 更新所有 Worker 状态显示 (统一文本)
    const statusText = `<span style="color:${on ? 'var(--green)' : 'var(--t3)'}">● Worker ${on ? '运行中' : '已停止'}</span>`;
    const badge = document.getElementById('sync-status-badge');
    if (badge) badge.innerHTML = statusText;
    const badge2 = document.getElementById('sync-worker-badge');
    if (badge2) badge2.innerHTML = statusText;
    // Worker 按钮
    const btn = document.getElementById('sync-worker-btn');
    if (btn) btn.innerHTML = on ? '⏹ 停止 Worker' : '▶ 启动 Worker';
    renderSyncLog(d.log_lines || []);
  } catch (e) {
    document.getElementById('sync-log-content').innerHTML = '<div style="color:var(--red)">加载失败</div>';
  }
}

function renderSyncLog(lines) {
  const el = document.getElementById('sync-log-content');
  if (!lines || lines.length === 0) {
    el.innerHTML = '<div style="color:var(--t3)">暂无同步日志</div>';
    return;
  }
  el.innerHTML = lines.map(line => {
    const esc = escHtml(line);
    let cls = '';
    if (line.includes('✅')) cls = 'style="color:var(--green)"';
    else if (line.includes('❌') || line.includes('失败')) cls = 'style="color:var(--red, #e74c3c)"';
    else if (line.includes('⬆') || line.includes('⬇') || line.includes('🔍')) cls = 'style="color:var(--cyan)"';
    else if (line.includes('☁️') || line.includes('🛑')) cls = 'style="color:var(--t2)"';
    return `<div class="sync-log-entry" ${cls}>${esc}</div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

async function toggleSyncWorker() {
  const btn = document.getElementById('sync-worker-btn');
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/sync/status');
    const d = await r.json();
    const running = d.worker_running;
    const url = running ? '/api/sync/worker/stop' : '/api/sync/worker/start';
    await fetch(url, {method: 'POST'});
    showToast(running ? 'Worker 已停止' : 'Worker 已启动');
    setTimeout(() => { if (btn) btn.disabled = false; loadSyncLogs(); }, 1500);
  } catch (e) {
    showToast('操作失败: ' + e.message);
    if (btn) btn.disabled = false;
  }
}

// ── Rclone 配置导入 (保留旧功能) ────────────────────────────────

function toggleImportConfig() {
  document.getElementById('import-config-box').classList.toggle('hidden');
}

async function importConfigFromUrl() {
  const url = document.getElementById('import-url').value.trim();
  if (!url) { showToast('请输入 URL'); return; }
  try {
    const r = await fetch('/api/sync/import_config', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({type: 'url', value: url})
    });
    const d = await r.json();
    if (d.ok) { showToast(d.message); document.getElementById('import-url').value = ''; loadSyncRemotes(); }
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
    if (d.ok) { showToast(d.message); document.getElementById('import-base64').value = ''; loadSyncRemotes(); }
    else showToast('导入失败: ' + (d.error || ''));
  } catch (e) { showToast('导入失败: ' + e.message); }
}

async function loadRcloneConfig() {
  try {
    const r = await fetch('/api/sync/rclone_config');
    const d = await r.json();
    document.getElementById('rclone-config-content').value = d.config || '';
    rcloneConfigLoaded = true;
  } catch (e) { document.getElementById('rclone-config-content').value = '加载失败'; }
}

async function saveRcloneConfig() {
  const content = document.getElementById('rclone-config-content').value;
  if (!content.trim()) { showToast('配置不能为空'); return; }
  if (!confirm('确定保存？旧配置将备份为 rclone.conf.bak')) return;
  const statusEl = document.getElementById('rclone-save-status');
  statusEl.textContent = '保存中...';
  try {
    const r = await fetch('/api/sync/rclone_config', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({config: content})
    });
    const d = await r.json();
    statusEl.textContent = d.ok ? '✅ ' + d.message : '❌ ' + (d.error || '失败');
    if (d.ok) loadSyncRemotes();
  } catch (e) { statusEl.textContent = '❌ ' + e.message; }
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
  enter() { loadSyncPage(); startSyncAutoRefresh(); },
  leave() { stopSyncAutoRefresh(); }
});

registerEscapeHandler(() => {
  closeSyncModal('add-remote-modal');
  closeSyncModal('add-rule-modal');
  closeSyncModal('sync-settings-modal');
});

// ── Window Exports (for onclick attributes in HTML) ─────────────

Object.assign(window, {
  switchSyncTab,
  loadSyncRemotes,
  renderSyncRemoteCard,
  deleteRemote,
  refreshRemoteStorage,
  showAddRemoteModal,
  closeSyncModal,
  showSyncSettings,
  saveSyncSettings,
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
  toggleImportConfig,
  importConfigFromUrl,
  importConfigFromBase64,
  loadRcloneConfig,
  saveRcloneConfig,
  loadSyncPage,
  startSyncAutoRefresh,
  stopSyncAutoRefresh,
});
