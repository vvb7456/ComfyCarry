/**
 * ComfyCarry — main.js
 * 前端入口: 初始化、加载所有页面模块、启动路由
 */

import {
  showPage, loadApiKey, loadVersionInfo,
  restoreSidebar, setupGlobalKeys, setupScrollFab,
  toggleSidebar
} from './core.js';

// ── 导入所有页面模块 (副作用: 自动注册 registerPage) ──
import './page-dashboard.js';
import './page-models.js';
import './page-comfyui.js';
import './page-plugins.js';
import './page-tunnel.js';
import './page-jupyter.js';
import './page-sync.js';
import './page-ssh.js';
import './page-settings.js';

// ── 初始化 ──────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadApiKey();
  restoreSidebar();
  setupGlobalKeys();
  setupScrollFab();
  showPage('dashboard');
  loadVersionInfo();
});

// ── 暴露到 window (供 HTML onclick 使用) ────────────────────

window.showPage = showPage;
window.toggleSidebar = toggleSidebar;
