/**
 * ComfyCarry — page-ssh.js
 * SSH 管理页面: 服务状态/日志 + 密钥/密码配置 (双 Tab)
 */

import { registerPage, showToast, escHtml, copyText, renderError, msIcon, apiFetch } from './core.js';
import { createLogStream } from './sse-log.js';

let _autoRefresh = null;
let _sshLogStream = null;
let _currentTab = 'status';

// ── 页面生命周期 ─────────────────────────────────────────────

registerPage('ssh', {
  enter() { loadSSHPage(); _startAutoRefresh(); _startSSHLogStream(); },
  leave() { _stopAutoRefresh(); _stopSSHLogStream(); }
});

function _startAutoRefresh() {
  _stopAutoRefresh();
  _autoRefresh = setInterval(loadSSHStatus, 10000);
}
function _stopAutoRefresh() {
  if (_autoRefresh) { clearInterval(_autoRefresh); _autoRefresh = null; }
}

// ── Tab 切换 ────────────────────────────────────────────────

function switchSSHTab(tab) {
  ['status', 'config'].forEach(t => {
    const el = document.getElementById('sshtab-' + t);
    const tabEl = document.querySelector(`.tab[data-sshtab="${t}"]`);
    if (el) el.classList.toggle('hidden', t !== tab);
    if (tabEl) tabEl.classList.toggle('active', t === tab);
  });
  _currentTab = tab;
  if (tab === 'status') { loadSSHStatus(); _startSSHLogStream(); }
  else if (tab === 'config') { loadSSHKeys(); _stopSSHLogStream(); }
}

// ── SSE 日志流 ──────────────────────────────────────────────

function _startSSHLogStream() {
  _stopSSHLogStream();
  const el = document.getElementById('ssh-log-content');
  if (!el) return;

  _sshLogStream = createLogStream({
    el,
    historyUrl: '/api/ssh/logs?lines=200',
    streamUrl: '/api/ssh/logs/stream',
    classify: line => {
      if (/error|fatal|fail/i.test(line)) return 'log-error';
      if (/warn|invalid|refused/i.test(line)) return 'log-warn';
      if (/accepted|session opened|publickey/i.test(line)) return 'log-info';
      return '';
    },
  });
  _sshLogStream.start();
}

function _stopSSHLogStream() {
  if (_sshLogStream) { _sshLogStream.stop(); _sshLogStream = null; }
}

// ── 主加载 ──────────────────────────────────────────────────

async function loadSSHPage() {
  await Promise.all([loadSSHStatus(), loadSSHKeys()]);
}

// ── 状态 ────────────────────────────────────────────────────

async function loadSSHStatus() {
  const cardsEl = document.getElementById('ssh-status-cards');

  try {
    const r = await fetch('/api/ssh/status');
    const d = await r.json();

    const running = d.running;
    const stColor = running ? 'var(--green)' : 'var(--red)';
    const stLabel = running ? '运行中' : '已停止';

    // Header badge
    const badge = document.getElementById('ssh-header-badge');
    if (badge) {
      badge.innerHTML = `<span class="page-status-dot" style="background:${stColor}"></span> <span style="color:${stColor}">${stLabel}</span>`;
    }

    // Header controls
    const controls = document.getElementById('ssh-header-controls');
    if (controls) {
      controls.innerHTML = running
        ? `<button class="btn" onclick="window.sshStop()">${msIcon('stop')} 停止</button><button class="btn" onclick="window.sshRestart()">${msIcon('restart_alt')} 重启</button>`
        : `<button class="btn" onclick="window.sshStart()">${msIcon('play_arrow')} 启动</button>`;
    }

    // Status cards
    if (cardsEl) {
      const pwAuthLabel = d.password_auth ? '已启用' : '已禁用';
      const pwAuthColor = d.password_auth ? 'var(--green)' : 'var(--t3)';
      const pwSetLabel = d.password_set ? `${msIcon('check_circle')} 已设置` : `${msIcon('warning')} 未设置`;
      const pwSetColor = d.password_set ? 'var(--green)' : 'var(--amber)';

      cardsEl.innerHTML = `
        <div class="stat-card" style="border-left:3px solid ${stColor}">
          <div class="stat-label">SSH 服务</div>
          <div class="stat-value" style="font-size:1rem;color:${stColor}">${stLabel}</div>
          <div class="stat-sub">${running ? `PID: ${d.pid || '-'}` : '服务未启动'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">监听端口</div>
          <div class="stat-value" style="font-size:1rem">${d.port || 22}</div>
          <div class="stat-sub">TCP</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">活跃连接</div>
          <div class="stat-value" style="font-size:1rem">${d.active_connections || 0}</div>
          <div class="stat-sub">ESTABLISHED</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">密码认证</div>
          <div class="stat-value" style="font-size:1rem;color:${pwAuthColor}">${pwAuthLabel}</div>
          <div class="stat-sub">Root 密码: <span style="color:${pwSetColor}">${pwSetLabel}</span></div>
        </div>
      `;
    }

    // SSH command
    _updateSSHCommand(running);

    // 同步复选框状态
    const syncCb = document.getElementById('ssh-pw-sync');
    if (syncCb && d.pw_sync !== undefined) {
      syncCb.checked = !!d.pw_sync;
      _toggleSSHPwSync();
    }

  } catch (e) {
    if (cardsEl) cardsEl.innerHTML = renderError('获取 SSH 状态失败');
  }
}

// ── SSH 连接命令 ─────────────────────────────────────────────

async function _updateSSHCommand(running) {
  const el = document.getElementById('ssh-connect-cmd');
  if (!el) return;

  if (!running) {
    el.innerHTML = `<div style="color:var(--t3);font-size:.85rem">SSH 未运行，无法连接</div>`;
    return;
  }

  // 尝试从 Tunnel 获取 SSH 命令
  let sshCmd = '';
  let sshHint = '';
  try {
    const r = await fetch('/api/tunnel/status');
    const d = await r.json();
    // 检查自定义 Tunnel 的 urls
    const urls = d.urls || {};
    for (const [name, url] of Object.entries(urls)) {
      if (name.toLowerCase() === 'ssh') {
        const hostname = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
        sshCmd = `ssh -o ProxyCommand="cloudflared access ssh --hostname %h" root@${hostname}`;
        sshHint = 'via Cloudflare Tunnel';
        break;
      }
    }
    // 检查公共 Tunnel 的 urls
    if (!sshCmd && d.tunnel_mode === 'public' && d.public?.urls) {
      const pubUrls = d.public.urls;
      const sshUrl = pubUrls.ssh || pubUrls.SSH;
      if (sshUrl) {
        const hostname = sshUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
        sshCmd = `ssh -o ProxyCommand="cloudflared access ssh --hostname %h" root@${hostname}`;
        sshHint = 'via ComfyCarry 公共 Tunnel';
      }
    }
  } catch (_) {}

  if (!sshCmd) {
    sshHint = '请查看实例平台获取公网 IP / 端口';
    // 尝试从环境变量获取容器的公开端口信息
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px">
      <div style="color:var(--t3);font-size:.82rem">${msIcon('info')} Tunnel 未配置 SSH 映射。${escHtml(sshHint)}</div>
      <code style="font-size:.8rem;color:var(--t2);background:var(--bg);padding:6px 12px;border-radius:var(--rs);font-family:'IBM Plex Mono',monospace">ssh root@&lt;实例公网地址&gt; -p &lt;映射端口&gt;</code>
    </div>`;
    return;
  }

  el.innerHTML = `<div style="display:flex;align-items:center;gap:8px">
    <code style="flex:1;font-size:.8rem;color:var(--t1);background:var(--bg);padding:8px 12px;border-radius:var(--rs);font-family:'IBM Plex Mono',monospace;overflow-x:auto;white-space:nowrap">${escHtml(sshCmd)}</code>
    <button class="btn btn-sm" onclick="copyText('${sshCmd.replace(/'/g, "\\'")}');showToast('已复制')" title="复制">${msIcon('content_copy')}</button>
  </div>
  <div style="font-size:.72rem;color:var(--t3);margin-top:4px">${escHtml(sshHint)}
    · 需要本地安装 <a href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" target="_blank" style="color:var(--ac)">cloudflared</a></div>`;
}

// ── 公钥管理 ────────────────────────────────────────────────

async function loadSSHKeys() {
  const el = document.getElementById('ssh-keys-list');
  if (!el) return;

  try {
    const r = await fetch('/api/ssh/keys');
    const d = await r.json();
    const keys = d.keys || [];

    // 每个 key 渲染为一张卡片
    const keyCards = keys.map(k => {
      const sourceTag = k.source === 'env'
        ? '<span style="font-size:.68rem;background:var(--bg4);color:var(--amber);padding:1px 6px;border-radius:3px;margin-left:6px">环境变量</span>'
        : k.source === 'config'
          ? '<span style="font-size:.68rem;background:var(--bg4);color:var(--cyan);padding:1px 6px;border-radius:3px;margin-left:6px">已保存</span>'
          : '';
      const fp = escHtml(k.fingerprint || '');
      const comment = escHtml(k.comment || '');
      const typeLabel = escHtml(k.type || '');

      return `<div class="ssh-key-card">
        <div class="ssh-key-info">
          <div class="ssh-key-type">${msIcon('key')} ${typeLabel}${sourceTag}</div>
          <div class="ssh-key-fp">${fp}</div>
          ${comment ? `<div class="ssh-key-comment">${comment}</div>` : ''}
        </div>
        <button class="btn btn-sm btn-danger" onclick="window.deleteSSHKey('${fp.replace(/'/g, "\\'")}')" title="删除">${msIcon('delete')}</button>
      </div>`;
    }).join('');

    // 添加公钥的 add-card（始终显示）
    const addCard = `<div class="ssh-key-card add-card" onclick="window.showAddKeyDialog()" id="ssh-add-card" style="min-height:52px;cursor:pointer">
      <span class="add-icon">+</span>
      <span>添加公钥</span>
    </div>`;

    // 添加公钥输入区（展开在 add-card 下方）
    const addArea = `<div id="ssh-add-key-area" class="ssh-add-key-card hidden">
      <textarea rows="4" placeholder="粘贴一个或多个 SSH 公钥（每行一个）"
                style="width:100%;font-family:'IBM Plex Mono',monospace;font-size:.78rem;background:var(--bg);border:1px solid var(--bd);border-radius:6px;padding:8px 10px;color:var(--t1);resize:vertical"></textarea>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">
        <button class="btn btn-sm" onclick="window.showAddKeyDialog()">取消</button>
        <button class="btn btn-sm btn-primary" onclick="window.addSSHKeys()">确认添加</button>
      </div>
    </div>`;

    el.innerHTML = keyCards + addCard + addArea;

  } catch (e) {
    el.innerHTML = renderError('获取公钥列表失败');
  }
}

function showAddKeyDialog() {
  const area = document.getElementById('ssh-add-key-area');
  const card = document.getElementById('ssh-add-card');
  if (!area) return;
  const showing = !area.classList.contains('hidden');
  area.classList.toggle('hidden');
  if (card) card.style.display = showing ? '' : 'none';
  if (!showing) {
    const textarea = area.querySelector('textarea');
    if (textarea) { textarea.value = ''; textarea.focus(); }
  }
}

async function addSSHKeys() {
  const textarea = document.querySelector('#ssh-add-key-area textarea');
  if (!textarea) return;
  const val = textarea.value.trim();
  if (!val) { showToast('请输入公钥'); return; }

  const d = await apiFetch('/api/ssh/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: val }),
  });
  if (!d) return;
  if (d.error) { showToast(d.error); return; }

  const msg = `已添加 ${d.added} 个公钥`;
  if (d.errors && d.errors.length) {
    showToast(`${msg}，${d.errors.length} 个失败`);
  } else {
    showToast(msg);
  }

  textarea.value = '';
  document.getElementById('ssh-add-key-area')?.classList.add('hidden');
  loadSSHKeys();
}

async function deleteSSHKey(fingerprint) {
  if (!confirm(`确认删除此公钥？\n${fingerprint}`)) return;

  const d = await apiFetch('/api/ssh/keys', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fingerprint }),
  });
  if (!d) return;
  if (d.error) { showToast(d.error); return; }
  showToast('已删除');
  loadSSHKeys();
}

// ── 密码管理 ────────────────────────────────────────────────

/** 切换"使用 ComfyCarry 密码"复选框 */
function _toggleSSHPwSync() {
  const cb = document.getElementById('ssh-pw-sync');
  const pw1 = document.getElementById('ssh-pw-new');
  const pw2 = document.getElementById('ssh-pw-confirm');
  const btn = document.getElementById('ssh-pw-submit-btn');
  if (!cb || !pw1 || !pw2) return;
  const synced = cb.checked;
  pw1.disabled = synced;
  pw2.disabled = synced;
  pw1.style.opacity = synced ? '0.5' : '1';
  pw2.style.opacity = synced ? '0.5' : '1';
  if (synced) {
    pw1.value = '';
    pw2.value = '';
    pw1.placeholder = '使用 ComfyCarry 密码';
    pw2.placeholder = '使用 ComfyCarry 密码';
    if (btn) btn.textContent = '同步密码';
  } else {
    pw1.placeholder = '新密码';
    pw2.placeholder = '确认密码';
    if (btn) btn.textContent = '设置密码';
  }
}

async function setSSHPassword() {
  const syncMode = document.getElementById('ssh-pw-sync')?.checked;
  let pw;

  if (syncMode) {
    // 从后端获取 ComfyCarry 密码并同步
    pw = '_sync_dashboard_password_';
  } else {
    const pw1 = document.getElementById('ssh-pw-new')?.value || '';
    const pw2 = document.getElementById('ssh-pw-confirm')?.value || '';
    if (!pw1) { showToast('请输入新密码'); return; }
    if (pw1 !== pw2) { showToast('两次密码不一致'); return; }
    if (pw1.length < 4) { showToast('密码长度至少 4 位'); return; }
    pw = pw1;
  }

  const d = await apiFetch('/api/ssh/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw }),
  });
  if (!d) return;
  if (d.error) { showToast(d.error); return; }

  let msg = syncMode ? 'SSH 密码已同步为 ComfyCarry 密码' : '密码已设置';
  if (d.sshd_restarted) msg += '，已自动启用密码认证并重启 sshd';
  showToast(msg);

  if (!syncMode) {
    const el1 = document.getElementById('ssh-pw-new');
    const el2 = document.getElementById('ssh-pw-confirm');
    if (el1) el1.value = '';
    if (el2) el2.value = '';
  }

  loadSSHStatus();
}

// ── 服务控制 ────────────────────────────────────────────────

async function sshStart() {
  const d = await apiFetch('/api/ssh/start', { method: 'POST' });
  if (!d) return;
  showToast(d.error || d.message || '已启动');
  loadSSHStatus();
}

async function sshStop() {
  if (!confirm('停止 SSH 服务后，所有 SSH 连接将断开。确认？')) return;
  const d = await apiFetch('/api/ssh/stop', { method: 'POST' });
  if (!d) return;
  showToast(d.error || '已停止');
  loadSSHStatus();
}

async function sshRestart() {
  const d = await apiFetch('/api/ssh/restart', { method: 'POST' });
  if (!d) return;
  showToast(d.error || '已重启');
  loadSSHStatus();
}

// ── Window exports ──────────────────────────────────────────

Object.assign(window, {
  loadSSHStatus, loadSSHKeys,
  showAddKeyDialog, addSSHKeys, deleteSSHKey,
  setSSHPassword, _toggleSSHPwSync,
  sshStart, sshStop, sshRestart,
  switchSSHTab,
});
