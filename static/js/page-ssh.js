/**
 * ComfyCarry — page-ssh.js
 * SSH 管理页面: 服务状态/日志 + 密钥/密码配置 (双 Tab)
 */

import { registerPage, showToast, escHtml, copyText, renderError } from './core.js';
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
        ? `<button class="btn" onclick="window.sshStop()">⏹ 停止</button><button class="btn" onclick="window.sshRestart()">♻️ 重启</button>`
        : `<button class="btn" onclick="window.sshStart()">▶ 启动</button>`;
    }

    // Status cards
    if (cardsEl) {
      const pwAuthLabel = d.password_auth ? '已启用' : '已禁用';
      const pwAuthColor = d.password_auth ? 'var(--green)' : 'var(--t3)';
      const pwSetLabel = d.password_set ? '已设置 ✅' : '未设置 ⚠️';
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
    const urls = d.urls || {};
    for (const [name, url] of Object.entries(urls)) {
      if (name.toLowerCase() === 'ssh') {
        // 提取 hostname
        const hostname = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
        sshCmd = `ssh -o ProxyCommand="cloudflared access ssh --hostname %h" root@${hostname}`;
        sshHint = 'via Cloudflare Tunnel';
        break;
      }
    }
  } catch (_) {}

  if (!sshCmd) {
    sshHint = '请查看实例平台获取公网 IP / 端口';
    // 尝试从环境变量获取容器的公开端口信息
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px">
      <div style="color:var(--t3);font-size:.82rem">ℹ️ Tunnel 未配置 SSH 映射。${escHtml(sshHint)}</div>
      <code style="font-size:.8rem;color:var(--t2);background:var(--bg);padding:6px 12px;border-radius:var(--rs);font-family:'IBM Plex Mono',monospace">ssh root@&lt;实例公网地址&gt; -p &lt;映射端口&gt;</code>
    </div>`;
    return;
  }

  el.innerHTML = `<div style="display:flex;align-items:center;gap:8px">
    <code style="flex:1;font-size:.8rem;color:var(--t1);background:var(--bg);padding:8px 12px;border-radius:var(--rs);font-family:'IBM Plex Mono',monospace;overflow-x:auto;white-space:nowrap">${escHtml(sshCmd)}</code>
    <button class="btn btn-sm" onclick="copyText('${sshCmd.replace(/'/g, "\\'")}');showToast('已复制')" title="复制">📋</button>
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
          <div class="ssh-key-type">🔑 ${typeLabel}${sourceTag}</div>
          <div class="ssh-key-fp">${fp}</div>
          ${comment ? `<div class="ssh-key-comment">${comment}</div>` : ''}
        </div>
        <button class="btn btn-sm btn-danger" onclick="window.deleteSSHKey('${fp.replace(/'/g, "\\'")}')" title="删除">🗑</button>
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

  try {
    const r = await fetch('/api/ssh/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: val }),
    });
    const d = await r.json();
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
  } catch (e) {
    showToast('添加失败: ' + e.message);
  }
}

async function deleteSSHKey(fingerprint) {
  if (!confirm(`确认删除此公钥？\n${fingerprint}`)) return;

  try {
    const r = await fetch('/api/ssh/keys', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprint }),
    });
    const d = await r.json();
    if (d.error) { showToast(d.error); return; }
    showToast('已删除');
    loadSSHKeys();
  } catch (e) {
    showToast('删除失败: ' + e.message);
  }
}

// ── 密码管理 ────────────────────────────────────────────────

async function setSSHPassword() {
  const pw1 = document.getElementById('ssh-pw-new')?.value || '';
  const pw2 = document.getElementById('ssh-pw-confirm')?.value || '';

  if (!pw1) { showToast('请输入新密码'); return; }
  if (pw1 !== pw2) { showToast('两次密码不一致'); return; }
  if (pw1.length < 4) { showToast('密码长度至少 4 位'); return; }

  try {
    const r = await fetch('/api/ssh/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw1 }),
    });
    const d = await r.json();
    if (d.error) { showToast(d.error); return; }

    let msg = '密码已设置';
    if (d.sshd_restarted) msg += '，已自动启用密码认证并重启 sshd';
    showToast(msg);

    // 清空输入
    const el1 = document.getElementById('ssh-pw-new');
    const el2 = document.getElementById('ssh-pw-confirm');
    if (el1) el1.value = '';
    if (el2) el2.value = '';

    // 刷新状态
    loadSSHStatus();
  } catch (e) {
    showToast('设置失败: ' + e.message);
  }
}

// ── 服务控制 ────────────────────────────────────────────────

async function sshStart() {
  try {
    const r = await fetch('/api/ssh/start', { method: 'POST' });
    const d = await r.json();
    showToast(d.error || d.message || '已启动');
    loadSSHStatus();
  } catch (e) { showToast('启动失败: ' + e.message); }
}

async function sshStop() {
  if (!confirm('停止 SSH 服务后，所有 SSH 连接将断开。确认？')) return;
  try {
    const r = await fetch('/api/ssh/stop', { method: 'POST' });
    const d = await r.json();
    showToast(d.error || '已停止');
    loadSSHStatus();
  } catch (e) { showToast('停止失败: ' + e.message); }
}

async function sshRestart() {
  try {
    const r = await fetch('/api/ssh/restart', { method: 'POST' });
    const d = await r.json();
    showToast(d.error || '已重启');
    loadSSHStatus();
  } catch (e) { showToast('重启失败: ' + e.message); }
}

// ── Window exports ──────────────────────────────────────────

Object.assign(window, {
  loadSSHStatus, loadSSHKeys,
  showAddKeyDialog, addSSHKeys, deleteSSHKey,
  setSSHPassword,
  sshStart, sshStop, sshRestart,
  switchSSHTab,
});
