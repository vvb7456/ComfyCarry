/**
 * ComfyCarry — core.js
 * 共享工具函数、路由管理、Toast 通知、API 调用封装
 */

// ── 全局状态 ──────────────────────────────────────────────────

export const CIVITAI_API_BASE = 'https://civitai.com/api/v1';
export let apiKey = '';
export function setApiKey(k) { apiKey = k; }

// ── 页面注册表 ───────────────────────────────────────────────

const _pages = {};          // name → { enter, leave }
let _currentPage = null;

/**
 * 注册页面模块
 * @param {string} name  - 页面标识, 对应 #page-{name}
 * @param {object} hooks - { enter(): void, leave(): void }
 */
export function registerPage(name, hooks) {
  _pages[name] = hooks;
}

/** 切换页面 */
export function showPage(page) {
  // 调用当前页的 leave
  if (_currentPage && _pages[_currentPage]?.leave) {
    try { _pages[_currentPage].leave(); } catch (_) {}
  }
  // DOM 切换
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  const el = document.getElementById('page-' + page);
  if (el) el.classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n =>
    n.classList.toggle('active', n.dataset.page === page)
  );
  _currentPage = page;
  // 调用新页的 enter
  if (_pages[page]?.enter) {
    try { _pages[page].enter(); } catch (_) {}
  }
}

export function getCurrentPage() { return _currentPage; }

// ── 格式化工具 ───────────────────────────────────────────────

export function fmtBytes(b) {
  if (!b || b === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + u[i];
}

export function fmtPct(v) { return (v || 0).toFixed(1) + '%'; }

export function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 格式化 uptime: ms timestamp → "2h30m" */
export function fmtUptime(pmUptime) {
  if (!pmUptime) return '-';
  const sec = Math.floor((Date.now() - pmUptime) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

/** 格式化秒数 → "2m 30s" */
export function fmtDuration(seconds) {
  if (!seconds && seconds !== 0) return '-';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

// ── Toast ────────────────────────────────────────────────────

let _toastTimer = null;
export function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// ── 剪贴板 ──────────────────────────────────────────────────

export function copyText(text) {
  navigator.clipboard.writeText(text)
    .then(() => showToast('已复制到剪贴板'))
    .catch(() => {});
}

// ── 图片预览 ─────────────────────────────────────────────────

export function openImg(url) {
  const modal = document.getElementById('img-modal');
  const img = document.getElementById('modal-img');
  if (modal && img) {
    img.src = url;
    modal.classList.add('active');
  }
}

// ── API Key ──────────────────────────────────────────────────

export function getAuthHeaders() {
  return apiKey ? { Authorization: 'Bearer ' + apiKey } : {};
}

export async function loadApiKey() {
  try {
    const r = await fetch('/api/config');
    const d = await r.json();
    if (d.api_key) {
      apiKey = d.api_key;
    }
  } catch (_) {}
}

// ── 版本信息 ─────────────────────────────────────────────────

export async function loadVersionInfo() {
  const el = document.getElementById('version-info');
  if (!el) return;
  try {
    const r = await fetch('/api/version');
    const d = await r.json();
    const short = (d.commit || '').substring(0, 7);
    const branch = d.branch || 'main';
    const ver = d.version || 'v2.4';
    if (short) {
      el.innerHTML = `<a href="https://github.com/vvb7456/ComfyCarry/commit/${d.commit}" target="_blank"
        style="font-size:.68rem;color:var(--t3);text-decoration:none;font-family:'IBM Plex Mono',monospace" title="${branch}@${short}">
        <span style="background:rgba(124,92,252,.15);padding:1px 5px;border-radius:3px;color:var(--ac)">${branch}</span>
        <span style="margin-left:3px">${short}</span>
        <span style="margin-left:3px;color:var(--t3)">${ver}</span>
      </a>`;
    }
  } catch (_) {}
}

// ── Sidebar ──────────────────────────────────────────────────

export function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ct = document.querySelector('.content');
  sb.classList.toggle('collapsed');
  ct.classList.toggle('sidebar-collapsed');
  localStorage.setItem('sidebar_collapsed', sb.classList.contains('collapsed') ? '1' : '0');
}

export function restoreSidebar() {
  if (localStorage.getItem('sidebar_collapsed') === '1') {
    document.getElementById('sidebar')?.classList.add('collapsed');
    document.querySelector('.content')?.classList.add('sidebar-collapsed');
  }
}

// ── 全局 Escape 键 ──────────────────────────────────────────

export function setupGlobalKeys() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('img-modal')?.classList.remove('active');
      // 各页模块可用 registerEscapeHandler 注册自己的行为
      _escapeHandlers.forEach(fn => { try { fn(); } catch (_) {} });
    }
  });
}

const _escapeHandlers = [];
export function registerEscapeHandler(fn) {
  _escapeHandlers.push(fn);
}

// ── Scroll-to-top FAB ───────────────────────────────────────

export function setupScrollFab() {
  const content = document.querySelector('.content');
  const fab = document.getElementById('scroll-top-fab');
  if (content && fab) {
    content.addEventListener('scroll', () => {
      fab.classList.toggle('visible', content.scrollTop > 300);
    });
  }
}

// ── Badge / Model 分类颜色 ──────────────────────────────────

export function getBadgeClass(cat) {
  const key = (cat || '').toLowerCase().replace(/s$/, '');
  const m = { checkpoint: 'badge-checkpoint', lora: 'badge-lora', textualinversion: 'badge-embeddings',
    embedding: 'badge-embeddings', hypernetwork: 'badge-other', aestheticgradient: 'badge-other',
    controlnet: 'badge-controlnet', upscaler: 'badge-other', vae: 'badge-vae', pose: 'badge-other' };
  return m[key] || 'badge-other';
}
