/**
 * ComfyCarry — page-generate.js  (v5 layout)
 * 生成图片页面 (Phase 1: SDXL T2I + 多 LoRA)
 */

import {
  registerPage, showToast, escHtml, escAttr, apiFetch
} from './core.js';
import { createExecTracker, renderProgressBar } from './comfyui-progress.js';
import { initModelDependency } from './model-dependency.js';

// ── 模块状态 ─────────────────────────────────────────────────────────────────
let _state = 'idle';
let _sse = null;
let _tracker = null;
let _currentPromptId = '';
let _loraOptions = [];    // [{name, basename, preview_path, has_preview, trigger_words}]
let _checkpointOptions = []; // [{name, basename, preview_path, has_preview}]
let _selectedCheckpoint = null; // checkpoint name (full path)
let _uiReady = false;

/** 命名的 click 监听器 — 用于关闭下拉菜单，支持 removeEventListener */
function _handleDocClick() {
  document.getElementById('gen-run-dropdown')?.classList.add('hidden');
}
let _seedMode = 'random';
let _seedValue = null;
let _loraSelected = new Map(); // name -> strength (0-2)
let _runMode = 'normal'; // 'normal' | 'onChange' | 'live'
let _saveTimer = null;
let _upscaleEnabled = false;
let _upscaleFactor = 2;
let _upscaleMode = '4x_overlapped_checkboard';
let _upscaleTile = 8;
let _upscaleDownscale = 'lanczos';
let _hiresEnabled = false;
let _hiresDenoise = 0.40;
let _hiresSteps = 20;
let _hiresCfg = 7.0;
let _hiresSampler = 'euler';
let _hiresScheduler = 'normal';
let _hiresSeedMode = 'random';
let _hiresSeedValue = null;
let _comfyuiDir = '';  // 从 options API 获取, 用于构建模型路径
let _deferSave = () => { };  // assigned in _bindUIEvents
const STORAGE_KEY = 'comfycarry_generate_params';

// ControlNet 状态 (pose / canny / depth 共用结构)
const _CN_TYPES = ['pose', 'canny', 'depth'];
let _cnEnabled = { pose: false, canny: false, depth: false };
let _cnModel = { pose: '', canny: '', depth: '' };
let _cnStrength = { pose: 1.0, canny: 1.0, depth: 1.0 };
let _cnStart = { pose: 0.0, canny: 0.0, depth: 0.0 };
let _cnEnd = { pose: 1.0, canny: 1.0, depth: 1.0 };
let _cnImage = { pose: '', canny: '', depth: '' };       // 上传后的文件名 (服务端)
let _cnImagePreview = { pose: '', canny: '', depth: '' }; // 本地预览 data URL
let _cnModelOptions = { pose: [], canny: [], depth: [] }; // 从 options API 获取
let _cnDepHandles = {};  // model-dependency 句柄
let _cnReady = { pose: false, canny: false, depth: false }; // welcome 页已通过
let _upscaleDepHandle = null;  // AuraSR model-dependency 句柄
let _upscaleModelReady = false; // AuraSR 模型是否已安装

// ControlNet 预处理状态
let _ppRunning = { pose: false, canny: false, depth: false };  // 预处理进行中
let _ppPromptId = { pose: '', canny: '', depth: '' };          // 预处理 prompt_id
let _ppOutputFile = { pose: '', canny: '', depth: '' };        // 预期输出文件名

// 图生图状态
let _i2iEnabled = false;
let _i2iImage = '';          // 上传后的文件名 (服务端)
let _i2iImagePreview = '';   // 本地预览 data URL
let _i2iDenoise = 0.7;

// ── 反推 (Tag Interrogation) 状态 ─────────────────────────────────────────
let _tagRunning = false;
let _tagPromptId = '';
let _tagModalFile = null;
let _tagModalFileName = '';
let _tagModalBound = false;
let _tagResultText = '';
let _tagParamValues = {};
let _tagMdep = null;
let _tagModelReady = false;

// ── AI 提示词 (LLM Assist) 状态 ──────────────────────────────────────────
let _llmConfigured = null;   // null=未检查, true/false
let _llmRunning = false;
let _llmResult = null;       // { positive, negative }
let _llmAbort = null;        // AbortController (流式)
let _llmMode = 'text';       // 'text' | 'image'
let _llmImageFile = null;    // File | string (filename)
let _llmImageFileName = '';
let _llmVisionSupport = false;
let _llmStream = false;
let _llmBound = false;

// ── 注册页面 ─────────────────────────────────────────────────────────────────
registerPage('generate', {
  enter() { _enterPage(); },
  leave() { _leavePage(); },
});

// ── 模型类型 Tab 切换 (当前仅 SDXL 可用) ─────────────────────────────────────
window.switchGenTab = function (tab) {
  document.querySelectorAll('#gen-type-tabs .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.gentab === tab);
  });
};

let _gatePollTimer = null; // ComfyUI 就绪轮询定时器

async function _enterPage() {
  // ── ComfyUI 就绪检查 — 未就绪时不初始化任何 UI ──────────────────────
  const ready = await _checkComfyGate();
  if (!ready) return; // 页面被门控，等待轮询自动刷新

  _bindUIEvents();
  await _loadOptions();
  _restoreState();     // 恢复持久化参数
  _initUpscaleModelDep();  // AuraSR 模型依赖检测 (仅注册, 不立即检查)
  _initCNModelDeps();  // ControlNet 模型依赖检测 (仅注册, 不立即检查)
  _restoreActiveModule(); // 恢复展开的功能模块 Tab
  for (const t of _CN_TYPES) _renderRefPreview(t);  // 渲染分区占位符
  _renderI2IPreview();  // 图生图预览
  _startSSE();
  _renderProgress();   // 初始渲染空闲状态
  _renderSeedUI();     // 初始种子值显示
}

function _leavePage() {
  _saveState();
  _stopGatePoll();
  // 预处理/反推进行中不关闭 SSE，避免丢失 execution_done
  if (!_CN_TYPES.some(t => _ppRunning[t]) && !_tagRunning) _stopSSE();
  // 关闭 model-dependency 的下载 SSE 连接，防止浏览器连接数耗尽
  _destroyModelDepHandles();
  document.removeEventListener('click', _handleDocClick);
}

/** 销毁所有 model-dependency 的 SSE 连接 */
function _destroyModelDepHandles() {
  if (_upscaleDepHandle?.destroy) _upscaleDepHandle.destroy();
  _upscaleDepHandle = null;
  for (const type of _CN_TYPES) {
    if (_cnDepHandles[type]?.destroy) _cnDepHandles[type].destroy();
  }
  _cnDepHandles = {};
  _cnReady = { pose: false, canny: false, depth: false };
  _upscaleModelReady = false;
  if (_tagMdep?.destroy) _tagMdep.destroy();
  _tagMdep = null;
  _tagModelReady = false;
}

// ── UI 事件绑定 ───────────────────────────────────────────────────────────────
function _bindUIEvents() {
  if (_uiReady) return;
  _uiReady = true;

  // 输出尺寸 select
  const resSelect = document.getElementById('gen-resolution');
  if (resSelect) {
    resSelect.addEventListener('change', () => {
      const custom = document.getElementById('gen-custom-size');
      const isCustom = resSelect.value === 'custom';
      if (custom) custom.style.display = isCustom ? 'flex' : 'none';
      _updateUpscaleSizeHint();
    });
  }

  _bindSlider('gen-steps', 'gen-steps-val', v => v);
  _bindSlider('gen-cfg', 'gen-cfg-val', v => parseFloat(v).toFixed(1));

  // 步数/CFG 可点击编辑
  _makeEditable('gen-steps-val', 'gen-steps', true);   // integer
  _makeEditable('gen-cfg-val', 'gen-cfg', false);       // float 0.5 step

  // 数字输入框主题化 spinner (种子不需要±1 spinner)
  _wrapSpinner('gen-batch', 1);
  _wrapSpinner('gen-width', 64);
  _wrapSpinner('gen-height', 64);

  // 输入校验
  _addValidation('gen-batch', { integer: true, min: 1, max: 16 });
  _addValidation('gen-width', { integer: true, min: 64, max: 8192, step: 64 });
  _addValidation('gen-height', { integer: true, min: 64, max: 8192, step: 64 });

  document.getElementById('gen-seed-toggle')?.addEventListener('click', () => {
    _setSeedMode(_seedMode === 'random' ? 'fixed' : 'random');
    _saveState();
  });

  document.getElementById('gen-seed-input')?.addEventListener('change', e => {
    _seedValue = parseInt(e.target.value) || 0;
  });

  // 自动持久化：页面内任何输入变化 → 延迟保存
  const page = document.getElementById('page-generate');
  if (page) {
    const debounceSave = () => { clearTimeout(_saveTimer); _saveTimer = setTimeout(_saveState, 500); };
    _deferSave = debounceSave; // expose for programmatic calls
    page.addEventListener('input', debounceSave);
    page.addEventListener('change', debounceSave);
  }
  window.addEventListener('beforeunload', _saveState);

  // LoRA add-card 在 _renderLoraPanel 中动态绑定

  document.getElementById('gen-positive')?.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
  });

  // 运行按钮 (idle=运行, generating=停止)
  document.getElementById('gen-run-btn')?.addEventListener('click', () => {
    if (_state === 'generating') {
      apiFetch('/api/comfyui/interrupt', { method: 'POST' });
      showToast('⏹ 已发送中断请求');
    } else {
      handleSubmit();
    }
  });

  // 下拉箭头
  document.getElementById('gen-run-arrow')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = document.getElementById('gen-run-dropdown');
    dd?.classList.toggle('hidden');
  });

  // 下拉选项
  document.querySelectorAll('.gen-run-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      const mode = opt.dataset.mode;
      _setRunMode(mode);
      document.getElementById('gen-run-dropdown')?.classList.add('hidden');
    });
  });

  // 点击其他区域关闭下拉
  document.addEventListener('click', _handleDocClick);

  // 提示词工具图标
  document.querySelector('[data-action="tag-interrogate"]')?.addEventListener('click', () => _openTagModal());
  document.querySelector('[data-action="llm-assist"]')?.addEventListener('click', () => _openLlmModal());

  // 功能模块 Tab 切换 (互斥：同一时间只显示一个面板)
  document.querySelectorAll('.gen-mod-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      // 如果点击的是 checkbox 本身，不触发 tab 切换
      if (e.target.classList.contains('gen-mod-tab-chk')) return;
      if (tab.disabled) return;
      const mod = tab.dataset.module;
      const panel = document.getElementById('gen-mod-' + mod);
      // 互斥切换
      document.querySelectorAll('.gen-mod-tab').forEach(t => {
        if (t !== tab) t.classList.remove('active');
      });
      document.querySelectorAll('.gen-mod-content').forEach(p => {
        if (p !== panel) p.classList.add('hidden');
      });
      const isNowActive = !tab.classList.contains('active');
      tab.classList.toggle('active', isNowActive);
      if (panel) panel.classList.toggle('hidden', !isNowActive);
    });
  });

  // Tab checkbox: 独立控制功能开关
  document.querySelectorAll('.gen-mod-tab-chk').forEach(chk => {
    chk.addEventListener('click', (e) => {
      e.stopPropagation(); // 不触发 tab 切换
    });
    chk.addEventListener('change', () => {
      const mod = chk.dataset.module;
      const tab = chk.closest('.gen-mod-tab');

      if (chk.checked) {
        // ── 前置校验: 开启时检查条件 ──
        if (mod === 'lora') {
          if (_loraSelected.size === 0) {
            chk.checked = false;
            if (tab) tab.classList.remove('gen-mod-tab-on');
            showToast('请先至少添加一个 LoRA', 'warning');
            return;
          }
        }
        if (_CN_TYPES.includes(mod)) {
          // welcome 页尚未完成 → 禁止开启
          if (!_cnReady[mod]) {
            chk.checked = false;
            if (tab) tab.classList.remove('gen-mod-tab-on');
            const cnLabels = { pose: '姿势控制', canny: '轮廓控制', depth: '景深控制' };
            showToast(`请先安装${cnLabels[mod]}模型`, 'warning');
            if (tab && !tab.classList.contains('active')) tab.click();
            return;
          }
          // 检查 CN 模型是否已安装
          if (_cnModelOptions[mod].length === 0) {
            chk.checked = false;
            if (tab) tab.classList.remove('gen-mod-tab-on');
            showToast('请先安装 ControlNet 模型', 'warning');
            // 展开该 tab 的下载面板
            if (tab && !tab.classList.contains('active')) tab.click();
            return;
          }
          // 检查是否已上传参考图
          if (!_cnImage[mod]) {
            chk.checked = false;
            if (tab) tab.classList.remove('gen-mod-tab-on');
            showToast('请先选择参考图', 'warning');
            // 展开该 tab
            if (tab && !tab.classList.contains('active')) tab.click();
            return;
          }
        }
        if (mod === 'upscale') {
          // 模型检测已完成，检查结果
          if (!_upscaleModelReady) {
            chk.checked = false;
            if (tab) tab.classList.remove('gen-mod-tab-on');
            showToast('请先安装放大模型', 'warning');
            if (tab && !tab.classList.contains('active')) tab.click();
            return;
          }
        }
        if (mod === 'i2i') {
          if (!_i2iImage) {
            chk.checked = false;
            if (tab) tab.classList.remove('gen-mod-tab-on');
            showToast('请先上传参考图', 'warning');
            if (tab && !tab.classList.contains('active')) tab.click();
            return;
          }
        }
      }

      if (tab) tab.classList.toggle('gen-mod-tab-on', chk.checked);
      if (mod === 'upscale') {
        _upscaleEnabled = chk.checked;
        _updateUpscaleSizeHint();
        _deferSave();
      }
      if (mod === 'hires') {
        _hiresEnabled = chk.checked;
        _deferSave();
      }
      if (mod === 'i2i') {
        _i2iEnabled = chk.checked;
        _deferSave();
      }
      if (_CN_TYPES.includes(mod)) {
        _cnEnabled[mod] = chk.checked;
        _deferSave();
      }
    });
  });

  // ── 高清放大 Tab ───────────────────────────────────────────────────────
  _bindSlider('gen-upscale-factor', 'gen-upscale-factor-val', v => parseFloat(v).toFixed(1) + 'x');
  const factorSlider = document.getElementById('gen-upscale-factor');
  if (factorSlider) {
    factorSlider.addEventListener('input', () => {
      _upscaleFactor = parseFloat(factorSlider.value) || 2;
      _updateUpscaleSizeHint();
      _deferSave();
    });
  }
  _bindSlider('gen-upscale-tile', 'gen-upscale-tile-val', v => v);
  const tileSlider = document.getElementById('gen-upscale-tile');
  if (tileSlider) {
    tileSlider.addEventListener('input', () => {
      _upscaleTile = parseInt(tileSlider.value) || 8;
      _deferSave();
    });
  }
  const modeSelect = document.getElementById('gen-upscale-mode');
  if (modeSelect) {
    modeSelect.addEventListener('change', () => {
      _upscaleMode = modeSelect.value;
      _deferSave();
    });
  }
  const dsSelect = document.getElementById('gen-upscale-downscale');
  if (dsSelect) {
    dsSelect.addEventListener('change', () => {
      _upscaleDownscale = dsSelect.value;
      _deferSave();
    });
  }

  // ── 二次采样 Tab ────────────────────────────────────────────────────────
  _bindSlider('gen-hires-denoise', 'gen-hires-denoise-val', v => parseFloat(v).toFixed(2));
  const hiresDenoiseSlider = document.getElementById('gen-hires-denoise');
  if (hiresDenoiseSlider) {
    hiresDenoiseSlider.addEventListener('input', () => {
      _hiresDenoise = parseFloat(hiresDenoiseSlider.value) || 0.4;
      _deferSave();
    });
  }
  _bindSlider('gen-hires-steps', 'gen-hires-steps-val', v => v);
  const hiresStepsSlider = document.getElementById('gen-hires-steps');
  if (hiresStepsSlider) {
    hiresStepsSlider.addEventListener('input', () => {
      _hiresSteps = parseInt(hiresStepsSlider.value) || 20;
      _deferSave();
    });
  }
  _bindSlider('gen-hires-cfg', 'gen-hires-cfg-val', v => parseFloat(v).toFixed(1));
  const hiresCfgSlider = document.getElementById('gen-hires-cfg');
  if (hiresCfgSlider) {
    hiresCfgSlider.addEventListener('input', () => {
      _hiresCfg = parseFloat(hiresCfgSlider.value) || 7.0;
      _deferSave();
    });
  }
  const hiresSamplerSel = document.getElementById('gen-hires-sampler');
  if (hiresSamplerSel) {
    hiresSamplerSel.addEventListener('change', () => {
      _hiresSampler = hiresSamplerSel.value;
      _deferSave();
    });
  }
  const hiresSchedulerSel = document.getElementById('gen-hires-scheduler');
  if (hiresSchedulerSel) {
    hiresSchedulerSel.addEventListener('change', () => {
      _hiresScheduler = hiresSchedulerSel.value;
      _deferSave();
    });
  }
  document.getElementById('gen-hires-seed-toggle')?.addEventListener('click', () => {
    _setHiresSeedMode(_hiresSeedMode === 'random' ? 'fixed' : 'random');
  });

  // ── ControlNet Tabs 绑定 ────────────────────────────────────────────────
  for (const type of _CN_TYPES) {
    // 滑块
    _bindSlider(`gen-${type}-strength`, `gen-${type}-strength-val`, v => parseFloat(v).toFixed(2));
    _bindSlider(`gen-${type}-start`, `gen-${type}-start-val`, v => parseFloat(v).toFixed(2));
    _bindSlider(`gen-${type}-end`, `gen-${type}-end-val`, v => parseFloat(v).toFixed(2));

    const strengthSl = document.getElementById(`gen-${type}-strength`);
    if (strengthSl) strengthSl.addEventListener('input', () => { _cnStrength[type] = parseFloat(strengthSl.value); _deferSave(); });
    const startSl = document.getElementById(`gen-${type}-start`);
    if (startSl) startSl.addEventListener('input', () => { _cnStart[type] = parseFloat(startSl.value); _deferSave(); });
    const endSl = document.getElementById(`gen-${type}-end`);
    if (endSl) endSl.addEventListener('input', () => { _cnEnd[type] = parseFloat(endSl.value); _deferSave(); });

    // 模型下拉
    const modelSel = document.getElementById(`gen-${type}-model`);
    if (modelSel) modelSel.addEventListener('change', () => { _cnModel[type] = modelSel.value; _deferSave(); });

    // 图片上传
    _bindRefUpload(type);
  }

  // ── 图生图 Tab 绑定 ─────────────────────────────────────────────────────
  _bindSlider('gen-i2i-denoise', 'gen-i2i-denoise-val', v => parseFloat(v).toFixed(2));
  const i2iDenoiseSl = document.getElementById('gen-i2i-denoise');
  if (i2iDenoiseSl) {
    i2iDenoiseSl.addEventListener('input', () => { _i2iDenoise = parseFloat(i2iDenoiseSl.value); _deferSave(); });
  }
  _bindI2IUpload();
}

// ── 图生图参考图上传 ──────────────────────────────────────────────────────
function _bindI2IUpload() {
  const uploadDiv = document.getElementById('gen-i2i-upload');
  const fileInput = document.getElementById('gen-i2i-file');
  if (!uploadDiv || !fileInput) return;

  uploadDiv.addEventListener('click', (e) => {
    if (e.target.closest('.gen-ref-clear')) return;
    const action = e.target.closest('[data-action]')?.dataset?.action;
    if (action === 'upload') {
      fileInput.click();
    } else {
      // 默认: 打开图片选择弹窗 (input/ 根目录，不含子文件夹)
      _openRefModal('i2i', '');
    }
  });

  uploadDiv.addEventListener('dragover', (e) => { e.preventDefault(); uploadDiv.classList.add('dragover'); });
  uploadDiv.addEventListener('dragleave', () => uploadDiv.classList.remove('dragover'));
  uploadDiv.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadDiv.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) _handleRefFile('i2i', file);
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) _handleRefFile('i2i', file);
    fileInput.value = '';
  });
}

/** 从 input/ 中选择图片时获取尺寸并自动填充分辨率 */
async function _autoFillI2IResolution(filename) {
  try {
    const img = new Image();
    img.onload = () => {
      const wEl = document.getElementById('gen-width');
      const hEl = document.getElementById('gen-height');
      const resSel = document.getElementById('gen-resolution');
      if (wEl) wEl.value = img.naturalWidth;
      if (hEl) hEl.value = img.naturalHeight;
      if (resSel) {
        resSel.value = 'custom';
        const custom = document.getElementById('gen-custom-size');
        if (custom) custom.style.display = 'flex';
      }
    };
    img.src = `/api/generate/input_image_preview?name=${encodeURIComponent(filename)}`;
  } catch { /* ignore */ }
}

function _renderI2IPreview() {
  const uploadDiv = document.getElementById('gen-i2i-upload');
  if (!uploadDiv) return;

  // 清理框外的分辨率标签
  uploadDiv.parentElement?.querySelector('.gen-ref-res')?.remove();

  if (_i2iImagePreview) {
    uploadDiv.innerHTML = `
      <img src="${_i2iImagePreview}" alt="参考图">
      <div class="gen-ref-fname">${escHtml(_i2iImage || '')}</div>
      <div class="gen-ref-clear" title="移除参考图"><span class="ms">close</span></div>`;
    // 显示分辨率
    let resEl = uploadDiv.parentElement?.querySelector('.gen-ref-res');
    if (!resEl) {
      resEl = document.createElement('div');
      resEl.className = 'gen-ref-res';
      uploadDiv.after(resEl);
    }
    const img = new Image();
    img.onload = () => { resEl.textContent = `${img.naturalWidth} × ${img.naturalHeight}`; };
    img.src = _i2iImagePreview;
    uploadDiv.querySelector('.gen-ref-clear')?.addEventListener('click', (e) => {
      e.stopPropagation();
      _i2iImage = '';
      _i2iImagePreview = '';
      _i2iEnabled = false;
      const chk = document.querySelector('.gen-mod-tab-chk[data-module="i2i"]');
      if (chk) {
        chk.checked = false;
        chk.closest('.gen-mod-tab')?.classList.remove('gen-mod-tab-on');
      }
      _renderI2IPreview();
      _deferSave();
    });
  } else {
    uploadDiv.innerHTML = `
      <div class="gen-ref-placeholder gen-ref-split">
        <div class="gen-ref-split-top" data-action="pick">
          <span class="ms" style="font-size:1.5rem;opacity:.4">image</span>
          <span>点击选择参考图</span>
        </div>
        <div class="gen-ref-split-divider"><span>或</span></div>
        <div class="gen-ref-split-bottom" data-action="upload">
          <span class="ms" style="font-size:1.5rem;opacity:.4">upload_file</span>
          <span>上传本地图片</span>
        </div>
      </div>`;
  }
}

// ── ControlNet 参考图选择 ─────────────────────────────────────────────────
let _refModalType = '';  // 当前弹窗对应的 CN 类型

function _bindRefUpload(type) {
  const uploadDiv = document.getElementById(`gen-${type}-upload`);
  const fileInput = document.getElementById(`gen-${type}-file`);
  if (!uploadDiv || !fileInput) return;

  // 点击上传区 — 根据 data-action 区分
  uploadDiv.addEventListener('click', (e) => {
    if (e.target.closest('.gen-ref-clear')) return;
    if (_ppRunning[type]) return;  // 预处理中不响应点击
    const action = e.target.closest('[data-action]')?.dataset?.action;
    if (action === 'preprocess') {
      // 点击"从新图片生成" → 打开预处理弹窗
      if (_state === 'generating') {
        showToast('请等待当前工作流完成或取消', 'warning');
        return;
      }
      _openPPModal(type);
    } else {
      // 默认: 打开图片选择弹窗（仅显示对应子目录中的图片）
      _openRefModal(type, _CN_SUBFOLDER[type]);
    }
  });

  // 拖放仍然直接上传
  uploadDiv.addEventListener('dragover', (e) => { e.preventDefault(); uploadDiv.classList.add('dragover'); });
  uploadDiv.addEventListener('dragleave', () => uploadDiv.classList.remove('dragover'));
  uploadDiv.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadDiv.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) _handleRefFile(type, file);
  });

  // 文件选择 (从弹窗触发)
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) _handleRefFile(type, file);
    fileInput.value = '';
  });

  // 预处理文件选择
}

const _CN_SUBFOLDER = { pose: 'openpose', canny: 'canny', depth: 'depth' };

async function _openRefModal(type, subfolder) {
  _refModalType = type;
  const labels = { pose: '骨骼图', canny: '边缘图', depth: '深度图', i2i: '参考图' };
  const titleEl = document.getElementById('gen-ref-modal-title');
  if (titleEl) titleEl.textContent = `选择${labels[type] || '参考图'}`;

  const grid = document.getElementById('gen-ref-modal-grid');
  if (grid) grid.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--t3)">加载中...</div>';

  document.getElementById('gen-ref-modal')?.classList.add('active');

  // 加载 input 文件夹图片列表（可选子目录）
  try {
    const qs = subfolder ? `?subfolder=${encodeURIComponent(subfolder)}` : '';
    const resp = await apiFetch(`/api/generate/input_images${qs}`);
    _renderRefModalGrid(resp?.images || []);
  } catch {
    _renderRefModalGrid([]);
  }
}

window._closeRefModal = function () {
  const rm = document.getElementById('gen-ref-modal');
  if (rm) { rm.classList.remove('active'); rm.style.zIndex = ''; }
};

function _renderRefModalGrid(images) {
  const grid = document.getElementById('gen-ref-modal-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // 已有图片卡片
  images.forEach(img => {
    const card = document.createElement('div');
    card.className = 'gen-ref-card';
    card.title = img.name;
    const sizeStr = img.size > 1024 * 1024
      ? (img.size / 1024 / 1024).toFixed(1) + ' MB'
      : (img.size / 1024).toFixed(0) + ' KB';
    card.innerHTML = `
      <div class="gen-ref-card-img">
        <img src="/api/generate/input_image_preview?name=${encodeURIComponent(img.name)}" alt="" loading="lazy"
             onerror="this.style.display='none';this.parentNode.innerHTML='<span class=\\'ms\\' style=\\'font-size:2rem;opacity:.25\\'>broken_image</span>'">
      </div>
      <div class="gen-ref-card-body">
        <div class="gen-ref-card-name">${escHtml(img.name)}</div>
        <div class="gen-ref-card-size">${sizeStr}</div>
      </div>`;
    card.addEventListener('click', () => {
      if (_refModalType === '__pp__') {
        // 来自预处理弹窗 → 回填到弹窗
        _ppModalFile = img.name;
        _ppModalFileName = img.name;
        window._closeRefModal();
        _renderPPImagePreview();
        _updatePPSubmitBtn();
        return;
      }
      if (_refModalType === '__tag__') {
        _tagModalFile = img.name;
        _tagModalFileName = img.name;
        window._closeRefModal();
        _renderTagImagePreview();
        _updateTagSubmitBtn();
        return;
      }
      if (_refModalType === 'i2i') {
        // 图生图: 选择已有图片
        _i2iImage = img.name;
        _i2iImagePreview = `/api/generate/input_image_preview?name=${encodeURIComponent(img.name)}`;
        _renderI2IPreview();
        _autoFillI2IResolution(img.name);
        _deferSave();
        window._closeRefModal();
        return;
      }
      // 正常模式: 选择已有图片
      _cnImage[_refModalType] = img.name;
      _cnImagePreview[_refModalType] = `/api/generate/input_image_preview?name=${encodeURIComponent(img.name)}`;
      _renderRefPreview(_refModalType);
      _deferSave();
      window._closeRefModal();
    });
    grid.appendChild(card);
  });

  // 最后一张: 上传本地图片
  const uploadCard = document.createElement('div');
  uploadCard.className = 'gen-ref-card upload-card';
  uploadCard.innerHTML = `
    <span class="ms" style="font-size:2rem">upload_file</span>
    <span>上传本地图片</span>`;
  uploadCard.addEventListener('click', () => {
    if (_refModalType === '__pp__') {
      // PP 模式: 本地上传 → 关闭 ref modal → 触发 pp file input
      window._closeRefModal();
      document.getElementById('gen-pp-file-input')?.click();
      return;
    }
    if (_refModalType === '__tag__') {
      window._closeRefModal();
      document.getElementById('gen-tag-file-input')?.click();
      return;
    }
    const fileInput = document.getElementById(`gen-${_refModalType}-file`);
    if (fileInput) fileInput.click();
    window._closeRefModal();
  });
  grid.appendChild(uploadCard);
}

async function _handleRefFile(type, file) {
  const uploadDiv = document.getElementById(`gen-${type}-upload`);
  if (!uploadDiv) return;

  const isI2I = type === 'i2i';

  // 本地预览
  const reader = new FileReader();
  reader.onload = (e) => {
    if (isI2I) {
      _i2iImagePreview = e.target.result;
      _renderI2IPreview();
    } else {
      _cnImagePreview[type] = e.target.result;
      _renderRefPreview(type);
    }
  };
  reader.readAsDataURL(file);

  // 上传到服务端
  const form = new FormData();
  form.append('file', file);
  form.append('type', type);

  try {
    const resp = await apiFetch('/api/generate/upload_image', { method: 'POST', body: form });
    if (resp?.filename) {
      if (isI2I) {
        _i2iImage = resp.filename;
        // 自动填充分辨率
        if (resp.width && resp.height) {
          const wEl = document.getElementById('gen-width');
          const hEl = document.getElementById('gen-height');
          const resSel = document.getElementById('gen-resolution');
          if (wEl) wEl.value = resp.width;
          if (hEl) hEl.value = resp.height;
          if (resSel) {
            resSel.value = 'custom';
            const custom = document.getElementById('gen-custom-size');
            if (custom) custom.style.display = 'flex';
          }
        }
      } else {
        _cnImage[type] = resp.filename;
      }
      _deferSave();
      showToast('参考图已上传', 'success');
    } else {
      showToast('上传失败: ' + (resp?.error || '未知错误'), 'error');
    }
  } catch (e) {
    showToast('上传失败: ' + e.message, 'error');
  }
}

// ── ControlNet 预处理: 从新图片生成参考图 ─────────────────────────────────────
async function _startPreprocess(type, file, params = {}) {
  if (_state === 'generating') {
    showToast('请等待当前工作流完成或取消', 'warning');
    return;
  }
  if (_ppRunning[type]) return;

  // 设置预处理状态
  _ppRunning[type] = true;
  _renderRefPreview(type);
  _startPPTimer();

  const form = new FormData();
  // file 可以是 File 对象或字符串（input/ 中的文件名）
  if (file instanceof File) {
    form.append('file', file);
  } else {
    form.append('input_name', file);  // 使用 input/ 中已有文件
  }
  form.append('type', type);
  // 附加预处理器参数
  if (Object.keys(params).length) {
    form.append('params', JSON.stringify(params));
  }

  try {
    const resp = await apiFetch('/api/generate/preprocess', { method: 'POST', body: form });
    if (!resp || resp?.error) {
      _ppRunning[type] = false;
      _stopPPTimer();
      _renderRefPreview(type);
      _renderProgress();
      if (resp?.error) showToast('预处理失败: ' + resp.error, 'error');
      return;
    }
    _ppPromptId[type] = resp.prompt_id || '';
    _ppOutputFile[type] = resp.output_filename || '';
    const labels = { pose: '骨骼图', canny: '边缘图', depth: '深度图' };
    showToast(`正在生成${labels[type]}…`);
  } catch (e) {
    _ppRunning[type] = false;
    _stopPPTimer();
    _renderRefPreview(type);
    _renderProgress();
    showToast('预处理请求失败: ' + e.message, 'error');
  }
}

/** 预处理完成回调 — 由 SSE handler 调用 */
function _onPreprocessDone(type, success) {
  _ppRunning[type] = false;
  _stopPPTimer();
  _renderProgress();  // 恢复主状态栏
  if (success && _ppOutputFile[type]) {
    // 自动选择生成的参考图
    _cnImage[type] = _ppOutputFile[type];
    _cnImagePreview[type] = `/api/generate/input_image_preview?name=${encodeURIComponent(_ppOutputFile[type])}`;
    _deferSave();
    const labels = { pose: '骨骼图', canny: '边缘图', depth: '深度图' };
    showToast(`${labels[type]}生成完成`, 'success');
  } else if (!success) {
    showToast('参考图生成失败', 'error');
  }
  _ppPromptId[type] = '';
  _ppOutputFile[type] = '';
  _renderRefPreview(type);
}

/** 检查 prompt_id 是否属于预处理工作流, 返回对应类型或 null */
function _findPreprocessType(promptId) {
  if (!promptId) return null;
  for (const t of _CN_TYPES) {
    if (_ppPromptId[t] && _ppPromptId[t] === promptId) return t;
  }
  return null;
}

function _renderRefPreview(type) {
  const uploadDiv = document.getElementById(`gen-${type}-upload`);
  if (!uploadDiv) return;

  // 清理框外的分辨率标签
  uploadDiv.parentElement?.querySelector('.gen-ref-res')?.remove();

  // 预处理进行中 → 显示加载状态
  if (_ppRunning[type]) {
    uploadDiv.innerHTML = `
      <div class="gen-ref-processing">
        <div class="gen-ref-spinner"></div>
        <span>正在生成参考图…</span>
      </div>`;
    return;
  }

  if (_cnImagePreview[type]) {
    uploadDiv.innerHTML = `
      <img src="${_cnImagePreview[type]}" alt="参考图">
      <div class="gen-ref-fname">${escHtml(_cnImage[type] || '')}</div>
      <div class="gen-ref-clear" title="移除参考图"><span class="ms">close</span></div>`;
    // 显示分辨率 (框外)
    let resEl = uploadDiv.parentElement?.querySelector('.gen-ref-res');
    if (!resEl) {
      resEl = document.createElement('div');
      resEl.className = 'gen-ref-res';
      uploadDiv.after(resEl);
    }
    const img = new Image();
    img.onload = () => { resEl.textContent = `${img.naturalWidth} × ${img.naturalHeight}`; };
    img.src = _cnImagePreview[type];
    uploadDiv.querySelector('.gen-ref-clear')?.addEventListener('click', (e) => {
      e.stopPropagation();
      _cnImage[type] = '';
      _cnImagePreview[type] = '';
      _renderRefPreview(type);
      _deferSave();
    });
  } else {
    const labels = { pose: '骨骼图', canny: '边缘图', depth: '深度图' };
    uploadDiv.innerHTML = `
      <div class="gen-ref-placeholder gen-ref-split">
        <div class="gen-ref-split-top" data-action="pick">
          <span class="ms" style="font-size:1.5rem;opacity:.4">image</span>
          <span>点击选择${labels[type] || '参考图'}</span>
        </div>
        <div class="gen-ref-split-divider"><span>或</span></div>
        <div class="gen-ref-split-bottom" data-action="preprocess">
          <span class="ms" style="font-size:1.5rem;opacity:.4">auto_fix_high</span>
          <span>从新图片生成</span>
        </div>
      </div>`;
  }
}

// ── ControlNet 可下载模型定义 ─────────────────────────────────────────────────
// ── 预处理弹窗 ─────────────────────────────────────────────────────────────
let _ppModalType = '';      // 当前弹窗对应的 CN 类型
let _ppModalFile = null;    // 选中的文件 (File 或 input 文件名字符串)
let _ppModalFileName = '';  // 显示用的文件名

const _PP_PARAMS_DEF = {
  pose: {
    title: '骨骼图',
    icon: 'accessibility_new',
    params: [
      { key: 'detect_body', label: '检测身体', type: 'toggle', default: true },
      { key: 'detect_hand', label: '检测手指', type: 'toggle', default: true },
      { key: 'detect_face', label: '检测面部', type: 'toggle', default: true },
      {
        key: 'resolution', label: '检测分辨率', type: 'select', default: 1024,
        options: [{ v: 512, l: '512' }, { v: 768, l: '768' }, { v: 1024, l: '1024' }, { v: 1536, l: '1536' }]
      },
    ],
  },
  canny: {
    title: '边缘图',
    icon: 'border_style',
    params: [
      { key: 'low_threshold', label: '低阈值', type: 'slider', min: 0, max: 255, step: 1, default: 100 },
      { key: 'high_threshold', label: '高阈值', type: 'slider', min: 0, max: 255, step: 1, default: 200 },
      {
        key: 'resolution', label: '检测分辨率', type: 'select', default: 1024,
        options: [{ v: 512, l: '512' }, { v: 768, l: '768' }, { v: 1024, l: '1024' }, { v: 1536, l: '1536' }]
      },
    ],
  },
  depth: {
    title: '深度图',
    icon: 'layers',
    params: [
      {
        key: 'resolution', label: '检测分辨率', type: 'select', default: 1024,
        options: [{ v: 512, l: '512' }, { v: 768, l: '768' }, { v: 1024, l: '1024' }, { v: 1536, l: '1536' }]
      },
    ],
  },
};

let _ppParamValues = {};  // { key: value } 当前弹窗参数

function _openPPModal(type) {
  _ppModalType = type;
  _ppModalFile = null;
  _ppModalFileName = '';
  const def = _PP_PARAMS_DEF[type];
  if (!def) return;

  // 初始化参数默认值
  _ppParamValues = {};
  for (const p of def.params) _ppParamValues[p.key] = p.default;

  // 标题
  const titleEl = document.getElementById('gen-pp-modal-title');
  if (titleEl) titleEl.textContent = `生成${def.title}`;

  // 渲染参数区
  _renderPPParams(type);
  // 重置图片预览
  _renderPPImagePreview();
  // 禁用提交
  _updatePPSubmitBtn();

  // 绑定事件（一次性）
  _bindPPModalEvents(type);

  document.getElementById('gen-pp-modal')?.classList.add('active');
}

window._closePPModal = function () {
  document.getElementById('gen-pp-modal')?.classList.remove('active');
  _ppModalFile = null;
};

/**
 * 通用参数行渲染器 —— PP Modal 和 Tag Modal 共用
 * @param {HTMLElement} container   目标容器
 * @param {Array}       paramsDef  参数定义数组 [{key,label,type,tip?,…}]
 * @param {Object}      values     参数值对象 (会被 change 事件就地修改)
 * @param {string}      dataAttr   data 属性名 (如 'pp' → data-pp-key)
 * @param {Object}      [opts]     可选 { title, selectAsNumber }
 */
function _renderParamRows(container, paramsDef, values, dataAttr, opts = {}) {
  const dk = `data-${dataAttr}-key`;
  const sliderCls = `gen-${dataAttr}-slider-val`;
  const _tip = t => t ? ` <span class="comfy-param-help-icon" data-tip="${escHtml(t)}">?</span>` : '';

  let html = '';
  if (opts.title) html += `<div style="font-weight:500;margin-bottom:12px;font-size:.85rem;color:var(--t2)">${escHtml(opts.title)}</div>`;

  for (const p of paramsDef) {
    const tipHtml = _tip(p.tip);
    if (p.type === 'toggle') {
      const checked = values[p.key] ? 'checked' : '';
      html += `<div class="gen-pp-param-row">
        <span>${escHtml(p.label)}${tipHtml}</span>
        <label class="comfy-param-toggle" style="margin-left:auto;gap:0">
          <input type="checkbox" ${dk}="${p.key}" ${checked}>
          <span class="comfy-toggle-slider"></span>
        </label>
      </div>`;
    } else if (p.type === 'slider') {
      html += `<div class="gen-pp-param-row" style="flex-direction:column;align-items:stretch;gap:4px">
        <div style="display:flex;justify-content:space-between">
          <span>${escHtml(p.label)}${tipHtml}</span>
          <span class="${sliderCls}" ${dk}="${p.key}" style="color:var(--ac);font-weight:600">${values[p.key]}</span>
        </div>
        <input type="range" ${dk}="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${values[p.key]}" style="width:100%">
      </div>`;
    } else if (p.type === 'select') {
      const optHtml = p.options.map(o =>
        `<option value="${o.v}"${values[p.key] == o.v ? ' selected' : ''}>${escHtml(o.l)}</option>`
      ).join('');
      html += `<div class="gen-pp-param-row">
        <span style="white-space:nowrap">${escHtml(p.label)}${tipHtml}</span>
        <select ${dk}="${p.key}" class="input-field" style="flex:1;min-width:0;margin-left:8px">${optHtml}</select>
      </div>`;
    } else if (p.type === 'text') {
      html += `<div class="gen-pp-param-row" style="flex-direction:column;align-items:stretch;gap:4px">
        <span>${escHtml(p.label)}${tipHtml}</span>
        <input type="text" ${dk}="${p.key}" class="input-field" value="${escHtml(values[p.key])}"
               placeholder="${escHtml(p.placeholder || '')}" style="width:100%;font-size:.8rem">
      </div>`;
    }
  }
  container.innerHTML = html;

  // 绑定事件
  const selectAsNum = opts.selectAsNumber !== false;  // PP 默认 Number, Tag 传 false
  container.querySelectorAll(`[${dk}]`).forEach(el => {
    const key = el.getAttribute(dk);
    if (el.type === 'checkbox') {
      el.addEventListener('change', () => { values[key] = el.checked; });
    } else if (el.type === 'range') {
      el.addEventListener('input', () => {
        values[key] = Number(el.value);
        const valEl = container.querySelector(`span.${sliderCls}[${dk}="${key}"]`);
        if (valEl) valEl.textContent = el.value;
      });
    } else if (el.tagName === 'SELECT') {
      el.addEventListener('change', () => { values[key] = selectAsNum ? Number(el.value) : el.value; });
    } else if (el.type === 'text') {
      el.addEventListener('input', () => { values[key] = el.value; });
    }
  });
}

function _renderPPParams(type) {
  const container = document.getElementById('gen-pp-params');
  if (!container) return;
  const def = _PP_PARAMS_DEF[type];
  _renderParamRows(container, def.params, _ppParamValues, 'pp', { title: '参数设置' });
}

function _renderPPImagePreview() {
  const container = document.getElementById('gen-pp-image-preview');
  if (!container) return;

  if (_ppModalFile) {
    // 有文件 → 显示预览
    let imgSrc;
    if (_ppModalFile instanceof File) {
      imgSrc = URL.createObjectURL(_ppModalFile);
    } else {
      imgSrc = `/api/generate/input_image_preview?name=${encodeURIComponent(_ppModalFile)}`;
    }
    container.innerHTML = `<img src="${imgSrc}" style="width:100%;height:100%;object-fit:contain">
      <div style="position:absolute;bottom:4px;left:4px;right:4px;text-align:center;font-size:.75rem;color:var(--t3);background:var(--bg2);border-radius:4px;padding:2px 4px;word-break:break-all">${escHtml(_ppModalFileName)}</div>
      <div class="gen-ref-clear" title="移除"><span class="ms">close</span></div>`;
    container.querySelector('.gen-ref-clear')?.addEventListener('click', (e) => {
      e.stopPropagation();
      _ppModalFile = null;
      _ppModalFileName = '';
      _renderPPImagePreview();
      _updatePPSubmitBtn();
    });
  } else {
    // 无文件 → split 布局（上方选已有、下方拖放上传）
    container.innerHTML = `
      <div class="gen-ref-placeholder gen-ref-split" style="width:100%;height:100%">
        <div class="gen-ref-split-top" data-action="pick-input">
          <span class="ms" style="font-size:1.5rem;opacity:.4">folder_open</span>
          <span>从 input 选择</span>
        </div>
        <div class="gen-ref-split-divider"><span>或</span></div>
        <div class="gen-ref-split-bottom" data-action="upload-local">
          <span class="ms" style="font-size:1.5rem;opacity:.4">upload</span>
          <span>拖放或点击上传</span>
        </div>
      </div>`;
  }
}

function _updatePPSubmitBtn() {
  const btn = document.getElementById('gen-pp-submit');
  if (btn) btn.disabled = !_ppModalFile;
}

let _ppModalBound = false;

function _bindPPModalEvents(type) {
  if (_ppModalBound) return;
  _ppModalBound = true;

  const previewArea = document.getElementById('gen-pp-image-preview');
  const submitBtn = document.getElementById('gen-pp-submit');

  // 创建一个专用 input
  let ppInput = document.getElementById('gen-pp-file-input');
  if (!ppInput) {
    ppInput = document.createElement('input');
    ppInput.type = 'file';
    ppInput.accept = 'image/*';
    ppInput.id = 'gen-pp-file-input';
    ppInput.style.display = 'none';
    document.body.appendChild(ppInput);
  }

  // 事件委托：点击 split 区域
  previewArea?.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    if (action === 'pick-input') {
      // 从 input 选择
      _ppPickInput();
    } else if (action === 'upload-local') {
      ppInput.click();
    }
  });

  // 拖放（仅在 split-bottom 区域生效，但为简单起见整个 previewArea 都支持）
  previewArea?.addEventListener('dragover', (e) => { e.preventDefault(); });
  previewArea?.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) {
      _ppModalFile = file;
      _ppModalFileName = file.name;
      _renderPPImagePreview();
      _updatePPSubmitBtn();
    }
  });

  // 本地文件选择
  ppInput.addEventListener('change', () => {
    const file = ppInput.files?.[0];
    if (file) {
      _ppModalFile = file;
      _ppModalFileName = file.name;
      _renderPPImagePreview();
      _updatePPSubmitBtn();
    }
    ppInput.value = '';
  });

  // 提交
  submitBtn?.addEventListener('click', () => {
    if (!_ppModalFile || !_ppModalType) return;
    const file = _ppModalFile;
    const type = _ppModalType;
    const params = { ..._ppParamValues };
    _closePPModal();
    _startPreprocess(type, file, params);
  });
}

async function _ppPickInput() {
  try {
    const resp = await apiFetch('/api/generate/input_images');
    const images = resp?.images || [];
    if (!images.length) { showToast('ComfyUI input/ 中没有图片', 'warning'); return; }
    _refModalType = '__pp__';
    const titleEl = document.getElementById('gen-ref-modal-title');
    if (titleEl) titleEl.textContent = '选择图片';
    _renderRefModalGrid(images);
    const rm = document.getElementById('gen-ref-modal');
    if (rm) { rm.style.zIndex = '210'; rm.classList.add('active'); }
  } catch { showToast('加载图片列表失败', 'error'); }
}

// ── 提示词反推 (Tag Interrogation) ──────────────────────────────────────────

const _TAG_PARAMS_DEF = [
  { key: 'model', label: '模型', type: 'select', default: 'wd-eva02-large-tagger-v3',
    options: [] },
  { key: 'threshold', label: '通用阈值', type: 'slider', min: 0.1, max: 0.9, step: 0.05, default: 0.35,
    tip: '通用标签的置信度阈值。值越低识别越多标签但可能不准确，值越高越精确但可能遗漏' },
  { key: 'character_threshold', label: '角色阈值', type: 'slider', min: 0.1, max: 0.9, step: 0.05, default: 0.85,
    tip: '角色标签的置信度阈值。角色识别建议较高阈值以减少误判' },
  { key: 'replace_underscore', label: '替换下划线', type: 'toggle', default: true,
    tip: '将标签中的下划线替换为空格，使输出更适合提示词使用' },
  { key: 'exclude_tags', label: '排除标签', type: 'text', default: '', placeholder: '逗号分隔, 如: simple background',
    tip: '指定需要排除的标签。常用于过滤背景、评级等无关标签' },
];

const _TAG_MODELS = [
  {
    id: 'wd-eva02-large-tagger-v3',
    name: 'WD EVA02 Large v3',
    size: '1.2 GB',
    description: '最高精度',
    files: [
      { filename: 'wd-eva02-large-tagger-v3.onnx', subdir: 'custom_nodes/ComfyUI-WD14-Tagger/models',
        url: 'https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3/resolve/main/model.onnx' },
      { filename: 'wd-eva02-large-tagger-v3.csv', subdir: 'custom_nodes/ComfyUI-WD14-Tagger/models',
        url: 'https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3/resolve/main/selected_tags.csv' },
    ],
  },
  {
    id: 'wd-vit-tagger-v3',
    name: 'WD ViT v3',
    size: '361 MB',
    description: '轻量快速',
    files: [
      { filename: 'wd-vit-tagger-v3.onnx', subdir: 'custom_nodes/ComfyUI-WD14-Tagger/models',
        url: 'https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/model.onnx' },
      { filename: 'wd-vit-tagger-v3.csv', subdir: 'custom_nodes/ComfyUI-WD14-Tagger/models',
        url: 'https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/selected_tags.csv' },
    ],
  },
];

async function _openTagModal() {
  const modal = document.getElementById('gen-tag-modal');
  if (!modal) return;

  // 检查 welcome state：用户是否已点击过「进入」
  if (!_tagModelReady) {
    try {
      const state = await apiFetch('/api/generate/welcome_state');
      if (state?.tagger) _tagModelReady = true;
    } catch { /* ignore */ }
  }

  if (!_tagModelReady) {
    // 显示欢迎页 (model-dependency)
    document.getElementById('gen-tag-welcome').style.display = '';
    document.getElementById('gen-tag-body').style.display = 'none';
    modal.classList.add('active');
    _initTagModelDep();
    return;
  }

  _showTagBody();
  modal.classList.add('active');
}

async function _showTagBody() {
  document.getElementById('gen-tag-welcome').style.display = 'none';
  const body = document.getElementById('gen-tag-body');
  body.classList.remove('hidden');
  body.style.display = '';

  // 动态加载已安装模型列表
  try {
    const resp = await apiFetch('/api/generate/tagger_models');
    const modelParam = _TAG_PARAMS_DEF.find(p => p.key === 'model');
    if (resp?.models?.length && modelParam) {
      modelParam.options = resp.models.map(m => ({ v: m, l: m }));
      if (!resp.models.includes(modelParam.default)) {
        modelParam.default = resp.models[0];
      }
    }
  } catch { /* fallback to empty options */ }

  // 初始化参数
  _tagParamValues = {};
  for (const p of _TAG_PARAMS_DEF) _tagParamValues[p.key] = p.default;
  _tagModalFile = null;
  _tagModalFileName = '';
  _renderTagParams();
  _renderTagImagePreview();
  _renderTagResult();
  _updateTagSubmitBtn();
  _bindTagModalEvents();
}

window._closeTagModal = function () {
  document.getElementById('gen-tag-modal')?.classList.remove('active');
};

function _renderTagParams() {
  const container = document.getElementById('gen-tag-params');
  if (!container) return;
  _renderParamRows(container, _TAG_PARAMS_DEF, _tagParamValues, 'tag', { title: '反推参数', selectAsNumber: false });
}

function _renderTagImagePreview() {
  const container = document.getElementById('gen-tag-image-preview');
  if (!container) return;

  // 移除旧的文件名标签
  container.parentElement?.querySelector('.gen-tag-fname')?.remove();

  if (_tagModalFile) {
    let imgSrc;
    if (_tagModalFile instanceof File) {
      imgSrc = URL.createObjectURL(_tagModalFile);
    } else {
      imgSrc = `/api/generate/input_image_preview?name=${encodeURIComponent(_tagModalFile)}`;
    }
    container.innerHTML = `<img src="${imgSrc}" style="width:100%;height:100%;object-fit:contain">
      <div class="gen-ref-clear" title="移除"><span class="ms">close</span></div>`;
    // 文件名放到容器外面
    if (_tagModalFileName) {
      const fnameEl = document.createElement('div');
      fnameEl.className = 'gen-tag-fname';
      fnameEl.textContent = _tagModalFileName;
      container.after(fnameEl);
    }
    container.querySelector('.gen-ref-clear')?.addEventListener('click', (e) => {
      e.stopPropagation();
      _tagModalFile = null;
      _tagModalFileName = '';
      _renderTagImagePreview();
      _updateTagSubmitBtn();
    });
  } else {
    container.innerHTML = `
      <div class="gen-ref-placeholder gen-ref-split" style="width:100%;height:100%">
        <div class="gen-ref-split-top" data-action="pick-input">
          <span class="ms" style="font-size:1.5rem;opacity:.4">folder_open</span>
          <span>从 input 选择</span>
        </div>
        <div class="gen-ref-split-divider"><span>或</span></div>
        <div class="gen-ref-split-bottom" data-action="upload-local">
          <span class="ms" style="font-size:1.5rem;opacity:.4">upload</span>
          <span>拖放或点击上传</span>
        </div>
      </div>`;
  }
}

function _renderTagResult() {
  const area = document.getElementById('gen-tag-result-area');
  if (!area) return;

  if (_tagRunning) {
    area.innerHTML = `<div class="gen-tag-result-empty">
      <div class="spinner" style="width:32px;height:32px"></div>
      <p style="color:var(--t3);margin:0">正在反推中…</p>
    </div>`;
  } else if (_tagResultText) {
    area.innerHTML = `<div class="gen-tag-result-content">
      <div class="gen-tag-result-tags">${escHtml(_tagResultText)}</div>
      <div class="gen-tag-result-actions">
        <button class="btn btn-primary btn-sm" data-action="fill-positive"><span class="ms ms-sm">input</span> 填入正面提示词</button>
        <button class="btn btn-sm" data-action="copy-tags"><span class="ms ms-sm">content_copy</span> 复制</button>
      </div>
    </div>`;
    area.querySelector('[data-action="fill-positive"]')?.addEventListener('click', () => {
      _fillPositivePrompt(_tagResultText);
    });
    area.querySelector('[data-action="copy-tags"]')?.addEventListener('click', () => {
      navigator.clipboard.writeText(_tagResultText).then(
        () => showToast('已复制到剪贴板', 'success'),
        () => showToast('复制失败', 'error')
      );
    });
  } else {
    area.innerHTML = `<div class="gen-tag-result-empty">
      <span class="ms" style="font-size:48px;color:var(--t3)">sell</span>
      <p style="color:var(--t3);margin:0">反推结果将显示在这里</p>
    </div>`;
  }
}

function _updateTagSubmitBtn() {
  const btn = document.getElementById('gen-tag-submit');
  if (btn) btn.disabled = !_tagModalFile || _tagRunning;
}

function _bindTagModalEvents() {
  if (_tagModalBound) return;
  _tagModalBound = true;

  const previewArea = document.getElementById('gen-tag-image-preview');
  const submitBtn = document.getElementById('gen-tag-submit');

  let tagInput = document.getElementById('gen-tag-file-input');
  if (!tagInput) {
    tagInput = document.createElement('input');
    tagInput.type = 'file';
    tagInput.accept = 'image/*';
    tagInput.id = 'gen-tag-file-input';
    tagInput.style.display = 'none';
    document.body.appendChild(tagInput);
  }

  previewArea?.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    if (action === 'pick-input') _tagPickInput();
    else if (action === 'upload-local') tagInput.click();
  });

  previewArea?.addEventListener('dragover', (e) => { e.preventDefault(); });
  previewArea?.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) {
      _tagModalFile = file;
      _tagModalFileName = file.name;
      _renderTagImagePreview();
      _updateTagSubmitBtn();
    }
  });

  tagInput.addEventListener('change', () => {
    const file = tagInput.files?.[0];
    if (file) {
      _tagModalFile = file;
      _tagModalFileName = file.name;
      _renderTagImagePreview();
      _updateTagSubmitBtn();
    }
    tagInput.value = '';
  });

  submitBtn?.addEventListener('click', () => {
    if (!_tagModalFile || _tagRunning) return;
    const file = _tagModalFile;
    const params = { ..._tagParamValues };
    _startTagInterrogate(file, params);
  });
}

async function _tagPickInput() {
  try {
    const resp = await apiFetch('/api/generate/input_images');
    const images = resp?.images || [];
    if (!images.length) { showToast('ComfyUI input/ 中没有图片', 'warning'); return; }
    _refModalType = '__tag__';
    const titleEl = document.getElementById('gen-ref-modal-title');
    if (titleEl) titleEl.textContent = '选择图片';
    _renderRefModalGrid(images);
    const rm = document.getElementById('gen-ref-modal');
    if (rm) { rm.style.zIndex = '210'; rm.classList.add('active'); }
  } catch { showToast('加载图片列表失败', 'error'); }
}

async function _startTagInterrogate(file, params) {
  _tagRunning = true;
  _tagResultText = '';
  _renderTagResult();
  _updateTagSubmitBtn();
  _startPPTimer();  // 复用预处理计时器

  const form = new FormData();
  if (file instanceof File) form.append('file', file);
  else form.append('input_name', file);
  form.append('params', JSON.stringify(params));

  try {
    const resp = await apiFetch('/api/generate/interrogate', { method: 'POST', body: form });
    _tagPromptId = resp?.prompt_id || '';
    if (!_tagPromptId) throw new Error('未获取到 prompt_id');
  } catch (e) {
    _tagRunning = false;
    _stopPPTimer();
    _renderTagResult();
    _updateTagSubmitBtn();
    showToast(`反推提交失败: ${e.message || e}`, 'error');
  }
}

async function _onTagDone(success) {
  _tagRunning = false;
  _stopPPTimer();
  _renderProgress();

  if (success && _tagPromptId) {
    try {
      const resp = await apiFetch(`/api/generate/interrogate_result?prompt_id=${encodeURIComponent(_tagPromptId)}`);
      _tagResultText = resp?.tags || '';
      if (_tagResultText) {
        showToast('反推完成', 'success');
      } else {
        showToast('反推完成但未获取到标签', 'warning');
      }
    } catch (e) {
      showToast(`获取反推结果失败: ${e.message || e}`, 'error');
    }
  } else if (!success) {
    showToast('反推失败', 'error');
  }

  _tagPromptId = '';
  _renderTagResult();
  _updateTagSubmitBtn();

  // 自动重新打开弹窗显示结果 (如果用户关闭了弹窗)
  const modal = document.getElementById('gen-tag-modal');
  if (modal && !modal.classList.contains('active') && _tagResultText) {
    modal.classList.add('active');
    document.getElementById('gen-tag-welcome').style.display = 'none';
    document.getElementById('gen-tag-body').style.display = '';
  }
}

function _fillPositivePrompt(tags) {
  const el = document.getElementById('gen-positive');
  if (!el) return;
  const existing = el.value.trim();
  el.value = existing ? existing + ', ' + tags : tags;
  _deferSave();
  showToast('已填入正面提示词', 'success');
}

function _renderTagProgress(evt) {
  const statusEl = document.getElementById('gen-bar-status');
  if (!statusEl) return;

  let nodeName = '';
  let stepInfo = '';
  if (evt.type === 'executing') {
    nodeName = evt.data?.class_type || evt.data?.node || '';
  } else if (evt.type === 'progress') {
    const v = evt.data?.value, m = evt.data?.max;
    if (v != null && m != null) stepInfo = `${v}/${m}`;
    nodeName = evt.data?.node || '';
  }

  const elapsed = _ppStartTime ? Math.round((Date.now() - _ppStartTime) / 1000) : 0;
  const mm = Math.floor(elapsed / 60), ss = String(elapsed % 60).padStart(2, '0');
  const timeStr = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
  const detail = [stepInfo, nodeName].filter(Boolean).join(' ');

  statusEl.innerHTML = `<div class="comfy-progress-bar active">
    <span class="comfy-progress-label" style="color:var(--ac)"><span class="ms ms-sm" style="font-size:14px;vertical-align:middle">image_search</span> 反推中</span>
    <span class="comfy-progress-steps" style="color:var(--t2)">${escHtml(detail)}</span>
    <span class="comfy-progress-time">${timeStr}</span>
  </div>`;
}

function _initTagModelDep() {
  if (_tagMdep) return;  // 已初始化
  _tagMdep = initModelDependency({
    containerId: 'gen-tag-welcome',
    paramsId: 'gen-tag-body',
    comfyuiDir: _comfyuiDir,
    tab: 'tagger',
    title: '该功能需下载反推模型',
    models: _TAG_MODELS,
    minOptional: 1,
    onEnter: () => {
      _tagModelReady = true;
      _showTagBody();
    },
  });
}

const _CN_MODELS = {
  // 共享: Xinsir Union ProMax (所有类型通用)
  union: {
    id: 'xinsir-union-promax',
    name: 'Xinsir Union ProMax',
    description: 'SDXL/Pony 通用',
    size: '~2.5 GB',
    files: [{
      filename: 'diffusion_pytorch_model_promax.safetensors',
      url: 'https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/resolve/main/diffusion_pytorch_model_promax.safetensors?download=true',
      subdir: 'models/controlnet',
    }],
  },
  // Pose 专用: windsingai OpenPose (Illustrious/NoobAI)
  pose_dedicated: {
    id: 'windsingai-openpose',
    name: 'windsingai OpenPose',
    description: 'Illustrious/NoobAI 专用',
    size: '~2.5 GB',
    files: [{
      filename: 'openpose_s6000.safetensors',
      url: 'https://huggingface.co/windsingai/openpose/resolve/main/openpose_s6000.safetensors?download=true',
      subdir: 'models/controlnet',
    }],
  },
  // Canny 专用: MIC-Lab Illustrious XL Canny (Illustrious/NoobAI)
  canny_dedicated: {
    id: 'illustrious-canny',
    name: 'Illustrious XL Canny',
    description: 'Illustrious/NoobAI 专用',
    size: '~1.2 GB',
    files: [{
      filename: 'illustriousXLv1.1_canny_fp16.safetensors',
      url: 'https://huggingface.co/MIC-Lab/illustriousXLv1.1_controlnet/resolve/main/illustriousXLv1.1_canny_fp16.safetensors?download=true',
      subdir: 'models/controlnet',
    }],
  },
  // Depth 专用: MIC-Lab Illustrious XL Depth (Illustrious/NoobAI)
  depth_dedicated: {
    id: 'illustrious-depth',
    name: 'Illustrious XL Depth',
    description: 'Illustrious/NoobAI 专用',
    size: '~1.2 GB',
    files: [{
      filename: 'illustriousXLv1.1_depth_midas_fp16.safetensors',
      url: 'https://huggingface.co/MIC-Lab/illustriousXLv1.1_controlnet/resolve/main/illustriousXLv1.1_depth_midas_fp16.safetensors?download=true',
      subdir: 'models/controlnet',
    }],
  },
  // ── 预处理器模型 (必选) ──────────────────────────────────────────────────
  dwpose: {
    id: 'dwpose',
    name: 'DWPose 姿态检测器',
    description: 'YOLO + 关键点估计',
    size: '~200 MB',
    required: true,
    files: [
      {
        filename: 'yolox_l.onnx',
        url: 'https://huggingface.co/yzd-v/DWPose/resolve/main/yolox_l.onnx?download=true',
        subdir: 'custom_nodes/comfyui_controlnet_aux/ckpts/yzd-v/DWPose',
      },
      {
        filename: 'dw-ll_ucoco_384_bs5.torchscript.pt',
        url: 'https://huggingface.co/hr16/DWPose-TorchScript-BatchSize5/resolve/main/dw-ll_ucoco_384_bs5.torchscript.pt?download=true',
        subdir: 'custom_nodes/comfyui_controlnet_aux/ckpts/hr16/DWPose-TorchScript-BatchSize5',
      },
    ],
  },
  depth_anything_v2: {
    id: 'depth-anything-v2',
    name: 'Depth Anything V2',
    description: '深度图估计',
    size: '~398 MB',
    required: true,
    files: [{
      filename: 'depth_anything_v2_vitl.pth',
      url: 'https://huggingface.co/depth-anything/Depth-Anything-V2-Large/resolve/main/depth_anything_v2_vitl.pth?download=true',
      subdir: 'custom_nodes/comfyui_controlnet_aux/ckpts/depth-anything/Depth-Anything-V2-Large',
    }],
  },
};

const _CN_MODEL_CFG = {
  pose: {
    tab: 'pose',
    title: '该功能需下载姿势控制模型',
    models: [_CN_MODELS.union, _CN_MODELS.pose_dedicated, _CN_MODELS.dwpose],
    minOptional: 1,
  },
  canny: {
    tab: 'canny',
    title: '该功能需下载轮廓控制模型',
    models: [_CN_MODELS.union, _CN_MODELS.canny_dedicated],
    minOptional: 1,
  },
  depth: {
    tab: 'depth',
    title: '该功能需下载景深控制模型',
    models: [_CN_MODELS.union, _CN_MODELS.depth_dedicated, _CN_MODELS.depth_anything_v2],
    minOptional: 1,
  },
};

// ── ControlNet model-dependency 初始化 ──────────────────────────────────────
function _initCNModelDeps() {
  if (!_comfyuiDir) return;

  for (const type of _CN_TYPES) {
    const cfg = _CN_MODEL_CFG[type];
    _cnDepHandles[type] = initModelDependency({
      containerId: `gen-${type}-download`,
      paramsId: `gen-${type}-params`,
      comfyuiDir: _comfyuiDir,
      tab: cfg.tab,
      title: cfg.title,
      models: cfg.models,
      minOptional: cfg.minOptional,
      onEnter: () => {
        _cnReady[type] = true;
        _loadOptions(true);
        _syncCNUI();
      },
    });
  }
}

function _bindSlider(sliderId, valId, fmt) {
  const slider = document.getElementById(sliderId);
  const val = document.getElementById(valId);
  if (slider && val) slider.addEventListener('input', () => { val.textContent = fmt(slider.value); });
}

// ── 加载选项 ─────────────────────────────────────────────────────────────────
async function _loadOptions(refresh = false) {
  const url = '/api/generate/options' + (refresh ? '?refresh=1' : '');
  const data = await apiFetch(url);
  if (!data) { _showOfflineBanner(true); return; }

  if (data.comfyui_dir) _comfyuiDir = data.comfyui_dir;

  const missing = document.getElementById('gen-ckpt-missing');

  // ── Checkpoint 列表 (卡片式) ──────────────────────────────────────────
  _checkpointOptions = (data.checkpoints || []).map(f => ({
    name: f,
    basename: _basename(f),
    preview_path: data.checkpoint_previews?.[f] || null,
    has_preview: !!(data.checkpoint_previews?.[f]),
    info: data.checkpoint_info?.[f] || null,
    arch: data.checkpoint_archs?.[f] || 'unknown',
  }));
  if (_checkpointOptions.length) {
    missing?.classList.add('hidden');
    _showOfflineBanner(false);
    // 若未选中 checkpoint，自动选第一个
    if (!_selectedCheckpoint || !_checkpointOptions.find(c => c.name === _selectedCheckpoint)) {
      _selectedCheckpoint = _checkpointOptions[0].name;
    }
  } else {
    missing?.classList.remove('hidden');
    if (!data.samplers?.length) _showOfflineBanner(true);
  }
  _renderCkptPanel();

  // ── LoRA 列表 ─────────────────────────────────────────────────────────
  _loraOptions = (data.loras || []).map(f => ({
    name: f, basename: _basename(f),
    preview_path: data.lora_previews?.[f] || null,
    has_preview: !!(data.lora_previews?.[f]),
    trigger_words: data.lora_triggers?.[f] || '',
    info: data.lora_info?.[f] || null,
    arch: data.lora_archs?.[f] || 'unknown',
  }));
  _renderLoraPanel();

  // ── ControlNet 模型列表 ───────────────────────────────────────────────
  const cnModels = data.controlnet_models || {};
  for (const type of _CN_TYPES) {
    _cnModelOptions[type] = cnModels[type] || [];
    const sel = document.getElementById(`gen-${type}-model`);
    if (sel) {
      const prevVal = sel.value;
      sel.innerHTML = _cnModelOptions[type]
        .map(n => `<option value="${escAttr(n)}">${escHtml(_basename(n))}</option>`).join('');
      // 还原之前的选择 (如果仍存在)
      if (prevVal && _cnModelOptions[type].includes(prevVal)) sel.value = prevVal;
      else if (_cnModel[type] && _cnModelOptions[type].includes(_cnModel[type])) sel.value = _cnModel[type];
    }
  }

  const samplerSel = document.getElementById('gen-sampler');
  if (samplerSel && data.samplers?.length) {
    const prev = samplerSel.value;
    samplerSel.innerHTML = data.samplers
      .map(s => `<option value="${escAttr(s)}"${s === 'euler' ? ' selected' : ''}>${escHtml(s)}</option>`).join('');
    if (prev && data.samplers.includes(prev)) samplerSel.value = prev;
  }

  const schedulerSel = document.getElementById('gen-scheduler');
  if (schedulerSel && data.schedulers?.length) {
    const prev = schedulerSel.value;
    schedulerSel.innerHTML = data.schedulers
      .map(s => `<option value="${escAttr(s)}"${s === 'normal' ? ' selected' : ''}>${escHtml(s)}</option>`).join('');
    if (prev && data.schedulers.includes(prev)) schedulerSel.value = prev;
  }

  // 二次采样 采样器/调度器 (与主采样器相同选项列表)
  const hiresSamSel = document.getElementById('gen-hires-sampler');
  if (hiresSamSel && data.samplers?.length) {
    const prev = hiresSamSel.value;
    hiresSamSel.innerHTML = data.samplers
      .map(s => `<option value="${escAttr(s)}"${s === 'euler' ? ' selected' : ''}>${escHtml(s)}</option>`).join('');
    if (prev && data.samplers.includes(prev)) hiresSamSel.value = prev;
    else if (_hiresSampler && data.samplers.includes(_hiresSampler)) hiresSamSel.value = _hiresSampler;
  }

  const hiresSchSel = document.getElementById('gen-hires-scheduler');
  if (hiresSchSel && data.schedulers?.length) {
    const prev = hiresSchSel.value;
    hiresSchSel.innerHTML = data.schedulers
      .map(s => `<option value="${escAttr(s)}"${s === 'normal' ? ' selected' : ''}>${escHtml(s)}</option>`).join('');
    if (prev && data.schedulers.includes(prev)) hiresSchSel.value = prev;
    else if (_hiresScheduler && data.schedulers.includes(_hiresScheduler)) hiresSchSel.value = _hiresScheduler;
  }
}

// ── Checkpoint 卡片选择器 ────────────────────────────────────────────────────
function _renderCkptPanel() {
  const grid = document.getElementById('gen-ckpt-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (_selectedCheckpoint) {
    // 已选 — 显示单个卡片，点击更换
    const ckpt = _checkpointOptions.find(c => c.name === _selectedCheckpoint);
    const shortName = ckpt ? _displayName(ckpt) : _stripExt(_basename(_selectedCheckpoint));
    const card = document.createElement('div');
    card.className = 'gen-ckpt-card';
    const imgSrc = ckpt?.has_preview && ckpt?.preview_path
      ? `/api/local_models/preview?path=${encodeURIComponent(ckpt.preview_path)}`
      : null;
    const civitImg = ckpt?.info?.images?.[0];
    const civitUrl = civitImg?.url?.startsWith?.('http') ? civitImg.url : null;
    const civitIsVid = civitImg?.type === 'video';
    let imgHtml;
    if (imgSrc) {
      if (civitUrl && civitIsVid) {
        imgHtml = `<img src="${escHtml(imgSrc)}" alt="" onerror="this.style.display='none';var v=document.createElement('video');v.src='${escHtml(civitUrl)}';v.muted=v.autoplay=v.loop=v.playsInline=true;v.preload='metadata';this.parentElement.insertBefore(v,this)" loading="lazy">`;
      } else if (civitUrl) {
        imgHtml = `<img src="${escHtml(imgSrc)}" alt="" onerror="if(!this.dataset.fb){this.dataset.fb='1';this.src='${escHtml(civitUrl)}'}else{this.style.display='none';this.nextElementSibling.style.display='flex'}" loading="lazy"><div class="gen-ckpt-no-img" style="display:none"><span class="ms" style="font-size:2rem;opacity:.3">deployed_code</span></div>`;
      } else {
        imgHtml = `<img src="${escHtml(imgSrc)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy"><div class="gen-ckpt-no-img" style="display:none"><span class="ms" style="font-size:2rem;opacity:.3">deployed_code</span></div>`;
      }
    } else if (civitUrl) {
      imgHtml = civitIsVid
        ? `<video src="${escHtml(civitUrl)}" muted autoplay loop playsinline preload="metadata"></video>`
        : `<img src="${escHtml(civitUrl)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy"><div class="gen-ckpt-no-img" style="display:none"><span class="ms" style="font-size:2rem;opacity:.3">deployed_code</span></div>`;
    } else {
      imgHtml = `<div class="gen-ckpt-no-img"><span class="ms" style="font-size:2rem;opacity:.25">deployed_code</span></div>`;
    }
    card.innerHTML = `
      <div class="gen-ckpt-img">${imgHtml}${ckpt ? _modelTagHtml(ckpt) : ''}</div>
      <div class="gen-ckpt-info">
        <div class="gen-ckpt-name" title="${escHtml(shortName)}">${escHtml(shortName)}</div>
        <span style="font-size:.7rem;color:var(--t3)">点击更换模型</span>
      </div>`;
    card.addEventListener('click', () => _openCkptModal());
    grid.appendChild(card);
  } else {
    // 未选 — 显示 add-card
    const addCard = document.createElement('div');
    addCard.className = 'gen-ckpt-card add-card';
    addCard.innerHTML = '<span class="add-icon">+</span><span>选择模型</span>';
    addCard.addEventListener('click', () => _openCkptModal());
    grid.appendChild(addCard);
  }
}

function _openCkptModal() {
  const search = document.getElementById('gen-ckpt-modal-search');
  if (search) {
    search.value = '';
    const newSearch = search.cloneNode(true);
    search.parentNode.replaceChild(newSearch, search);
    newSearch.addEventListener('input', () => _renderCkptModalGrid());
  }
  // 刷新选项 (实时获取最新模型)
  _loadOptions(true).then(() => _renderCkptModalGrid());
  _renderCkptModalGrid();
  document.getElementById('gen-ckpt-modal')?.classList.add('active');
}

window._closeCkptModal = function () {
  document.getElementById('gen-ckpt-modal')?.classList.remove('active');
};

function _renderCkptModalGrid() {
  const grid = document.getElementById('gen-ckpt-modal-grid');
  const search = document.getElementById('gen-ckpt-modal-search');
  if (!grid) return;
  const q = (search?.value || '').toLowerCase();
  grid.innerHTML = '';
  const filtered = q ? _checkpointOptions.filter(c => c.basename.toLowerCase().includes(q) || _displayName(c).toLowerCase().includes(q)) : _checkpointOptions;
  if (!filtered.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--t3)"><span class="ms ms-sm">deployed_code_alert</span> 未找到 Checkpoint</div>';
  } else {
    filtered.forEach(ckpt => {
      const card = document.createElement('div');
      card.className = 'gen-lora-card' + (ckpt.name === _selectedCheckpoint ? ' selected' : '');
      card.title = _displayName(ckpt);
      const imgSrc = ckpt.has_preview && ckpt.preview_path
        ? `/api/local_models/preview?path=${encodeURIComponent(ckpt.preview_path)}`
        : null;
      // Fallback to CivitAI cover image from metadata
      const civitImg = ckpt.info?.images?.[0];
      const civitUrl = civitImg?.url?.startsWith?.('http') ? civitImg.url : null;
      const civitIsVid = civitImg?.type === 'video';
      let imgHtml;
      if (imgSrc) {
        if (civitUrl && civitIsVid) {
          imgHtml = `<img src="${escHtml(imgSrc)}" alt="" onerror="this.style.display='none';var v=document.createElement('video');v.src='${escHtml(civitUrl)}';v.muted=v.autoplay=v.loop=v.playsInline=true;v.preload='metadata';this.parentElement.insertBefore(v,this)" loading="lazy">`;
        } else if (civitUrl) {
          imgHtml = `<img src="${escHtml(imgSrc)}" alt="" onerror="if(!this.dataset.fb){this.dataset.fb='1';this.src='${escHtml(civitUrl)}'}else{this.style.display='none';this.nextElementSibling.style.display='flex'}" loading="lazy"><div class="gen-lora-card-no-img" style="display:none"><span class="ms" style="font-size:1.8rem;opacity:.3">image_not_supported</span></div>`;
        } else {
          imgHtml = `<img src="${escHtml(imgSrc)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy"><div class="gen-lora-card-no-img" style="display:none"><span class="ms" style="font-size:1.8rem;opacity:.3">image_not_supported</span></div>`;
        }
      } else if (civitUrl) {
        imgHtml = civitIsVid
          ? `<video src="${escHtml(civitUrl)}" muted autoplay loop playsinline preload="metadata"></video>`
          : `<img src="${escHtml(civitUrl)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy"><div class="gen-lora-card-no-img" style="display:none"><span class="ms" style="font-size:1.8rem;opacity:.3">image_not_supported</span></div>`;
      } else {
        imgHtml = `<div class="gen-lora-card-no-img"><span class="ms" style="font-size:1.8rem;opacity:.25">image_not_supported</span></div>`;
      }
      card.innerHTML = `
        <div class="gen-lora-card-img">
          ${imgHtml}
          ${_modelTagHtml(ckpt)}
          <div class="gen-lora-card-check"><span class="ms" style="font-size:13px">check</span></div>
        </div>
        <div class="gen-lora-card-body">
          <div class="gen-lora-card-name">${escHtml(_displayName(ckpt))}</div>
        </div>`;
      card.addEventListener('click', () => {
        _selectedCheckpoint = ckpt.name;
        _renderCkptPanel();
        _saveState(); // 持久化 checkpoint 选择
        window._closeCkptModal();
        showToast('✅ 已选择 ' + _displayName(ckpt));
      });
      grid.appendChild(card);
    });
  }
}

// ── LoRA 弹窗选择器 ──────────────────────────────────────────────────────────
let _loraModalPending = new Map(); // 弹窗内临时选中状态

function _openLoraModal() {
  _loraModalPending = new Map(_loraSelected);
  const search = document.getElementById('gen-lora-modal-search');
  if (search) {
    search.value = '';
    // 防止重复绑定
    const newSearch = search.cloneNode(true);
    search.parentNode.replaceChild(newSearch, search);
    newSearch.addEventListener('input', () => _renderLoraModalGrid());
  }
  _renderLoraModalGrid();
  document.getElementById('gen-lora-modal')?.classList.add('active');
  // 实时刷新 LoRA 列表 (后台获取最新，完成后重新渲染)
  _loadOptions(true).then(() => _renderLoraModalGrid());
}

window._closeLoraModal = function () {
  document.getElementById('gen-lora-modal')?.classList.remove('active');
};

window._confirmLoraModal = function () {
  _loraSelected = new Map(_loraModalPending);
  _renderLoraPanel();
  _saveState(); // 持久化 LoRA 选择
  window._closeLoraModal();
};

function _renderLoraModalGrid() {
  const grid = document.getElementById('gen-lora-modal-grid');
  const countSpan = document.getElementById('gen-lora-modal-count');
  const search = document.getElementById('gen-lora-modal-search');
  if (!grid) return;
  const q = (search?.value || '').toLowerCase();
  grid.innerHTML = '';

  // L1 架构过滤: 只显示与当前 checkpoint 兼容的 LoRA
  const ckptArch = _checkpointOptions.find(c => c.name === _selectedCheckpoint)?.arch || 'unknown';
  let archFiltered = _loraOptions;
  if (ckptArch && ckptArch !== 'unknown') {
    archFiltered = _loraOptions.filter(l => l.arch === ckptArch || l.arch === 'unknown');
  }

  const filtered = q ? archFiltered.filter(l => l.basename.toLowerCase().includes(q) || _displayName(l).toLowerCase().includes(q) || l.trigger_words.toLowerCase().includes(q)) : archFiltered;
  if (!filtered.length) {
    grid.innerHTML = '<div class="gen-lora-empty-hint" style="grid-column:1/-1"><span class="ms ms-sm" style="color:var(--t3)">extension_off</span> 未找到 LoRA</div>';
  } else {
    filtered.forEach(lora => {
      const card = document.createElement('div');
      card.className = 'gen-lora-card' + (_loraModalPending.has(lora.name) ? ' selected' : '');
      card.title = _displayName(lora);
      const imgSrc = lora.has_preview && lora.preview_path
        ? `/api/local_models/preview?path=${encodeURIComponent(lora.preview_path)}`
        : null;
      const civitImg = lora.info?.images?.[0];
      const civitUrl = civitImg?.url?.startsWith?.('http') ? civitImg.url : null;
      const civitIsVid = civitImg?.type === 'video';
      let imgHtml;
      if (imgSrc) {
        if (civitUrl && civitIsVid) {
          imgHtml = `<img src="${escHtml(imgSrc)}" alt="" onerror="this.style.display='none';var v=document.createElement('video');v.src='${escHtml(civitUrl)}';v.muted=v.autoplay=v.loop=v.playsInline=true;v.preload='metadata';this.parentElement.insertBefore(v,this)" loading="lazy">`;
        } else if (civitUrl) {
          imgHtml = `<img src="${escHtml(imgSrc)}" alt="" onerror="if(!this.dataset.fb){this.dataset.fb='1';this.src='${escHtml(civitUrl)}'}else{this.style.display='none';this.nextElementSibling.style.display='flex'}" loading="lazy"><div class="gen-lora-card-no-img" style="display:none"><span class="ms" style="font-size:1.8rem;opacity:.3">image_not_supported</span></div>`;
        } else {
          imgHtml = `<img src="${escHtml(imgSrc)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy"><div class="gen-lora-card-no-img" style="display:none"><span class="ms" style="font-size:1.8rem;opacity:.3">image_not_supported</span></div>`;
        }
      } else if (civitUrl) {
        imgHtml = civitIsVid
          ? `<video src="${escHtml(civitUrl)}" muted autoplay loop playsinline preload="metadata"></video>`
          : `<img src="${escHtml(civitUrl)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy"><div class="gen-lora-card-no-img" style="display:none"><span class="ms" style="font-size:1.8rem;opacity:.3">image_not_supported</span></div>`;
      } else {
        imgHtml = `<div class="gen-lora-card-no-img"><span class="ms" style="font-size:1.8rem;opacity:.25">image_not_supported</span></div>`;
      }
      card.innerHTML = `
        <div class="gen-lora-card-img">
          ${imgHtml}
          ${_modelTagHtml(lora)}
          <div class="gen-lora-card-check"><span class="ms" style="font-size:13px">check</span></div>
        </div>
        <div class="gen-lora-card-body">
          <div class="gen-lora-card-name">${escHtml(_displayName(lora))}</div>
        </div>`;
      card.addEventListener('click', () => {
        if (_loraModalPending.has(lora.name)) {
          _loraModalPending.delete(lora.name);
          card.classList.remove('selected');
        } else {
          _loraModalPending.set(lora.name, 1.0);
          card.classList.add('selected');
        }
        if (countSpan) countSpan.textContent = `${_loraModalPending.size} 个已选`;
      });
      grid.appendChild(card);
    });
  }
  if (countSpan) countSpan.textContent = `${_loraModalPending.size} 个已选`;
}

function _renderLoraPanel() {
  const grid = document.getElementById('gen-lora-grid');
  if (!grid) return;
  grid.innerHTML = '';
  // 同步 LoRA Tab checkbox
  const loraChk = document.querySelector('.gen-mod-tab-chk[data-module="lora"]');
  if (loraChk) {
    const on = _loraSelected.size > 0;
    loraChk.checked = on;
    loraChk.closest('.gen-mod-tab')?.classList.toggle('gen-mod-tab-on', on);
  }

  // 已选 LoRA 卡片
  _loraSelected.forEach((strength, name) => {
    const lora = _loraOptions.find(l => l.name === name);
    const shortName = lora ? _displayName(lora) : _stripExt(_basename(name));
    const card = document.createElement('div');
    card.className = 'gen-lora-card selected';
    const imgSrc = lora?.has_preview && lora?.preview_path
      ? `/api/local_models/preview?path=${encodeURIComponent(lora.preview_path)}`
      : null;
    const imgHtml = imgSrc
      ? `<img src="${escHtml(imgSrc)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy"><div class="gen-lora-card-no-img" style="display:none"><span class="ms" style="font-size:1.8rem;opacity:.3">image_not_supported</span></div>`
      : `<div class="gen-lora-card-no-img"><span class="ms" style="font-size:1.8rem;opacity:.25">image_not_supported</span></div>`;
    card.innerHTML = `
      <div class="gen-lora-card-img">
        ${imgHtml}
        ${_modelTagHtml(lora)}
        <button class="gen-lora-card-del" title="移除"><span class="ms ms-sm">close</span></button>
      </div>
      <div class="gen-lora-card-body">
        <div class="gen-lora-card-name" title="${escHtml(shortName)}">${escHtml(shortName)}</div>
        <div class="gen-lora-card-strength">
          <span style="font-size:.7rem;color:var(--t3)">strength</span>
          <input type="range" class="gen-range" min="0" max="2" step="0.05" value="${strength}" data-lora="${escAttr(name)}">
          <span class="gen-lora-card-str-val">${strength.toFixed(2)}</span>
        </div>
      </div>`;
    // 点击封面 → 详情弹窗 (排除删除按钮)
    card.querySelector('.gen-lora-card-img')?.addEventListener('click', (e) => {
      if (e.target.closest('.gen-lora-card-del')) return;
      e.stopPropagation();
      _openModelDetail(lora || { name, basename: _basename(name) }, 'lora');
    });
    // 强度滑块
    const slider = card.querySelector('input[type=range]');
    const valSpan = card.querySelector('.gen-lora-card-str-val');
    slider?.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      _loraSelected.set(name, v);
      valSpan.textContent = v.toFixed(2);
    });
    // 删除按钮
    card.querySelector('.gen-lora-card-del')?.addEventListener('click', (e) => {
      e.stopPropagation();
      _loraSelected.delete(name);
      _renderLoraPanel();
    });
    grid.appendChild(card);
  });

  // 末尾“添加 LoRA” add-card
  const addCard = document.createElement('div');
  addCard.className = 'gen-lora-card add-card';
  addCard.innerHTML = '<div class="gen-lora-add-inner"><span class="add-icon">+</span><span>添加 LoRA</span></div>';
  addCard.addEventListener('click', () => _openLoraModal());
  grid.appendChild(addCard);
}

function _collectLoras() {
  const loras = [];
  _loraSelected.forEach((strength, name) => { loras.push({ name, strength }); });
  return loras;
}

function _collectControlnets() {
  const list = [];
  for (const type of _CN_TYPES) {
    if (!_cnEnabled[type] || !_cnImage[type]) continue;
    const model = _cnModel[type] || _cnModelOptions[type]?.[0] || '';
    if (!model) continue;
    list.push({
      type,
      model,
      image: _cnImage[type],
      strength: _cnStrength[type],
      start_percent: _cnStart[type],
      end_percent: _cnEnd[type],
    });
  }
  return list;
}

// ── 种子 UI ──────────────────────────────────────────────────────────────────
function _setSeedMode(mode, value) {
  _seedMode = mode;
  if (mode === 'fixed') {
    // 固定种子：使用传入值 > 已有值 > 新随机值
    if (value != null) _seedValue = value;
    else if (_seedValue == null) _seedValue = Math.floor(Math.random() * 4294967295);
  }
  _renderSeedUI();
}

function _renderSeedUI() {
  const input = document.getElementById('gen-seed-input');
  const icon = document.getElementById('gen-seed-icon');
  const lockBtn = document.getElementById('gen-seed-toggle');

  if (_seedMode === 'random') {
    // 随机模式：显示当前种子值（灰色），每次提交会变
    if (_seedValue == null) _seedValue = Math.floor(Math.random() * 4294967295);
    if (input) { input.value = _seedValue; input.readOnly = true; input.style.color = 'var(--t3)'; }
    if (icon) icon.textContent = 'casino';
    if (lockBtn) lockBtn.classList.remove('locked');
  } else {
    // 固定模式：显示种子值（正常色），可编辑
    const val = _seedValue ?? 0;
    if (input) { input.value = val; input.readOnly = false; input.style.color = ''; }
    if (icon) icon.textContent = 'lock_open';
    if (lockBtn) lockBtn.classList.add('locked');
  }
}

function _getCurrentSeed() {
  if (_seedMode === 'random') {
    // 每次提交前生成新随机种子并显示
    _seedValue = Math.floor(Math.random() * 4294967295);
    const input = document.getElementById('gen-seed-input');
    if (input) { input.value = _seedValue; input.style.color = 'var(--t3)'; }
    return _seedValue;
  }
  return parseInt(document.getElementById('gen-seed-input')?.value ?? _seedValue ?? -1);
}

// ── 二次采样 种子 UI ─────────────────────────────────────────────────────────
function _setHiresSeedMode(mode, value) {
  _hiresSeedMode = mode;
  if (mode === 'fixed') {
    if (value != null) _hiresSeedValue = value;
    else if (_hiresSeedValue == null) _hiresSeedValue = Math.floor(Math.random() * 4294967295);
  }
  _renderHiresSeedUI();
  _deferSave();
}

function _renderHiresSeedUI() {
  const input = document.getElementById('gen-hires-seed-input');
  const icon = document.getElementById('gen-hires-seed-icon');
  const lockBtn = document.getElementById('gen-hires-seed-toggle');

  if (_hiresSeedMode === 'random') {
    if (_hiresSeedValue == null) _hiresSeedValue = Math.floor(Math.random() * 4294967295);
    if (input) { input.value = _hiresSeedValue; input.readOnly = true; input.style.color = 'var(--t3)'; }
    if (icon) icon.textContent = 'casino';
    if (lockBtn) lockBtn.classList.remove('locked');
  } else {
    const val = _hiresSeedValue ?? 0;
    if (input) { input.value = val; input.readOnly = false; input.style.color = ''; }
    if (icon) icon.textContent = 'lock_open';
    if (lockBtn) lockBtn.classList.add('locked');
  }
}

function _getHiresSeed() {
  if (_hiresSeedMode === 'random') {
    _hiresSeedValue = Math.floor(Math.random() * 4294967295);
    const input = document.getElementById('gen-hires-seed-input');
    if (input) { input.value = _hiresSeedValue; input.style.color = 'var(--t3)'; }
    return _hiresSeedValue;
  }
  return parseInt(document.getElementById('gen-hires-seed-input')?.value ?? _hiresSeedValue ?? -1);
}

// ── 参数持久化 ──────────────────────────────────────────────────────────────
function _saveState() {
  try {
    const state = {
      positive: document.getElementById('gen-positive')?.value || '',
      negative: document.getElementById('gen-negative')?.value || '',
      checkpoint: _selectedCheckpoint,
      resolution: document.getElementById('gen-resolution')?.value || '1024x1024',
      width: document.getElementById('gen-width')?.value || '1024',
      height: document.getElementById('gen-height')?.value || '1024',
      steps: document.getElementById('gen-steps')?.value || '20',
      cfg: document.getElementById('gen-cfg')?.value || '7.0',
      sampler: document.getElementById('gen-sampler')?.value || 'euler',
      scheduler: document.getElementById('gen-scheduler')?.value || 'normal',
      seedMode: _seedMode,
      seedValue: _seedValue,
      batch: document.getElementById('gen-batch')?.value || '1',
      prefix: document.getElementById('gen-prefix')?.value || '',
      format: document.getElementById('gen-format')?.value || 'png',
      loras: Object.fromEntries(_loraSelected),
      runMode: _runMode,
      upscaleEnabled: _upscaleEnabled,
      upscaleFactor: _upscaleFactor,
      upscaleMode: _upscaleMode,
      upscaleTile: _upscaleTile,
      upscaleDownscale: _upscaleDownscale,
      hiresEnabled: _hiresEnabled,
      hiresDenoise: _hiresDenoise,
      hiresSteps: _hiresSteps,
      hiresCfg: _hiresCfg,
      hiresSampler: _hiresSampler,
      hiresScheduler: _hiresScheduler,
      hiresSeedMode: _hiresSeedMode,
      hiresSeedValue: _hiresSeedValue,
      cnEnabled: { ..._cnEnabled },
      cnModel: { ..._cnModel },
      cnStrength: { ..._cnStrength },
      cnStart: { ..._cnStart },
      cnEnd: { ..._cnEnd },
      cnImage: { ..._cnImage },
      activeModule: document.querySelector('.gen-mod-tab.active')?.dataset?.module || '',
      i2iEnabled: _i2iEnabled,
      i2iImage: _i2iImage,
      i2iDenoise: _i2iDenoise,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { /* quota exceeded etc */ }
}

function _restoreState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);

    // 提示词
    const pos = document.getElementById('gen-positive');
    const neg = document.getElementById('gen-negative');
    if (pos && s.positive) pos.value = s.positive;
    if (neg && s.negative) neg.value = s.negative;

    // Checkpoint
    if (s.checkpoint && _checkpointOptions.find(c => c.name === s.checkpoint)) {
      _selectedCheckpoint = s.checkpoint;
      _renderCkptPanel();
    }

    // 分辨率
    const resSel = document.getElementById('gen-resolution');
    if (resSel && s.resolution) {
      resSel.value = s.resolution;
      const custom = document.getElementById('gen-custom-size');
      if (custom) custom.style.display = s.resolution === 'custom' ? 'flex' : 'none';
    }
    if (s.width) { const el = document.getElementById('gen-width'); if (el) el.value = s.width; }
    if (s.height) { const el = document.getElementById('gen-height'); if (el) el.value = s.height; }

    // Steps + CFG (slider + display)
    if (s.steps) {
      const sl = document.getElementById('gen-steps');
      const val = document.getElementById('gen-steps-val');
      if (sl) sl.value = s.steps;
      if (val) val.textContent = s.steps;
    }
    if (s.cfg) {
      const sl = document.getElementById('gen-cfg');
      const val = document.getElementById('gen-cfg-val');
      if (sl) sl.value = s.cfg;
      if (val) val.textContent = parseFloat(s.cfg).toFixed(1);
    }

    // Sampler / Scheduler
    const samSel = document.getElementById('gen-sampler');
    const schSel = document.getElementById('gen-scheduler');
    if (samSel && s.sampler) samSel.value = s.sampler;
    if (schSel && s.scheduler) schSel.value = s.scheduler;

    // 种子
    if (s.seedMode) _seedMode = s.seedMode;
    if (s.seedValue != null) _seedValue = s.seedValue;

    // 生成数量 / 文件名 / 格式
    if (s.batch) { const el = document.getElementById('gen-batch'); if (el) el.value = s.batch; }
    if (s.prefix) { const el = document.getElementById('gen-prefix'); if (el) el.value = s.prefix; }
    if (s.format) { const el = document.getElementById('gen-format'); if (el) el.value = s.format; }

    // LoRA 选中状态
    if (s.loras && typeof s.loras === 'object') {
      _loraSelected = new Map(
        Object.entries(s.loras)
          .filter(([name]) => _loraOptions.find(l => l.name === name))
          .map(([k, v]) => [k, parseFloat(v)])
      );
      _renderLoraPanel();
    }

    // 运行模式
    if (s.runMode) _setRunMode(s.runMode);

    // 高清放大
    if (s.upscaleEnabled != null) _upscaleEnabled = !!s.upscaleEnabled;
    if (s.upscaleFactor) _upscaleFactor = parseFloat(s.upscaleFactor) || 2;
    if (s.upscaleMode) _upscaleMode = s.upscaleMode;
    if (s.upscaleTile) _upscaleTile = parseInt(s.upscaleTile) || 8;
    if (s.upscaleDownscale) _upscaleDownscale = s.upscaleDownscale;
    _syncUpscaleUI();

    // 二次采样
    if (s.hiresEnabled != null) _hiresEnabled = !!s.hiresEnabled;
    if (s.hiresDenoise != null) _hiresDenoise = parseFloat(s.hiresDenoise) || 0.4;
    if (s.hiresSteps) _hiresSteps = parseInt(s.hiresSteps) || 20;
    if (s.hiresCfg != null) _hiresCfg = parseFloat(s.hiresCfg) || 7.0;
    if (s.hiresSampler) _hiresSampler = s.hiresSampler;
    if (s.hiresScheduler) _hiresScheduler = s.hiresScheduler;
    if (s.hiresSeedMode) _hiresSeedMode = s.hiresSeedMode;
    if (s.hiresSeedValue != null) _hiresSeedValue = s.hiresSeedValue;
    _syncHiresUI();

    // ControlNet
    if (s.cnEnabled) for (const t of _CN_TYPES) if (s.cnEnabled[t] != null) _cnEnabled[t] = !!s.cnEnabled[t];
    if (s.cnModel) for (const t of _CN_TYPES) if (s.cnModel[t]) _cnModel[t] = s.cnModel[t];
    if (s.cnStrength) for (const t of _CN_TYPES) if (s.cnStrength[t] != null) _cnStrength[t] = parseFloat(s.cnStrength[t]);
    if (s.cnStart) for (const t of _CN_TYPES) if (s.cnStart[t] != null) _cnStart[t] = parseFloat(s.cnStart[t]);
    if (s.cnEnd) for (const t of _CN_TYPES) if (s.cnEnd[t] != null) _cnEnd[t] = parseFloat(s.cnEnd[t]);
    if (s.cnImage) for (const t of _CN_TYPES) if (s.cnImage[t]) _cnImage[t] = s.cnImage[t];
    _syncCNUI();

    // 图生图
    if (s.i2iEnabled != null) _i2iEnabled = !!s.i2iEnabled;
    if (s.i2iImage) _i2iImage = s.i2iImage;
    if (s.i2iDenoise != null) _i2iDenoise = Math.max(0.10, Math.min(parseFloat(s.i2iDenoise) || 0.7, 0.90));
    _syncI2IUI();
  } catch (e) { /* corrupted data etc */ }
}

// ── 高清放大 ─────────────────────────────────────────────────────────────────
function _syncUpscaleUI() {
  // checkbox 状态
  const chk = document.querySelector('.gen-mod-tab-chk[data-module="upscale"]');
  if (chk) {
    chk.checked = _upscaleEnabled;
    chk.closest('.gen-mod-tab')?.classList.toggle('gen-mod-tab-on', _upscaleEnabled);
  }
  // factor 滑块
  const factorSl = document.getElementById('gen-upscale-factor');
  const factorVal = document.getElementById('gen-upscale-factor-val');
  if (factorSl) factorSl.value = _upscaleFactor;
  if (factorVal) factorVal.textContent = parseFloat(_upscaleFactor).toFixed(1) + 'x';
  // mode select
  const modeSel = document.getElementById('gen-upscale-mode');
  if (modeSel) modeSel.value = _upscaleMode;
  // tile slider
  const tileSl = document.getElementById('gen-upscale-tile');
  const tileVal = document.getElementById('gen-upscale-tile-val');
  if (tileSl) tileSl.value = _upscaleTile;
  if (tileVal) tileVal.textContent = _upscaleTile;
  // downscale method
  const dsSel = document.getElementById('gen-upscale-downscale');
  if (dsSel) dsSel.value = _upscaleDownscale;
  _updateUpscaleSizeHint();
}

// ── 二次采样 ─────────────────────────────────────────────────────────────────
function _syncHiresUI() {
  const chk = document.querySelector('.gen-mod-tab-chk[data-module="hires"]');
  if (chk) {
    chk.checked = _hiresEnabled;
    chk.closest('.gen-mod-tab')?.classList.toggle('gen-mod-tab-on', _hiresEnabled);
  }
  // denoise slider
  const denoiseSl = document.getElementById('gen-hires-denoise');
  const denoiseVal = document.getElementById('gen-hires-denoise-val');
  if (denoiseSl) denoiseSl.value = _hiresDenoise;
  if (denoiseVal) denoiseVal.textContent = parseFloat(_hiresDenoise).toFixed(2);
  // steps slider
  const stepsSl = document.getElementById('gen-hires-steps');
  const stepsVal = document.getElementById('gen-hires-steps-val');
  if (stepsSl) stepsSl.value = _hiresSteps;
  if (stepsVal) stepsVal.textContent = _hiresSteps;
  // cfg slider
  const cfgSl = document.getElementById('gen-hires-cfg');
  const cfgVal = document.getElementById('gen-hires-cfg-val');
  if (cfgSl) cfgSl.value = _hiresCfg;
  if (cfgVal) cfgVal.textContent = parseFloat(_hiresCfg).toFixed(1);
  // sampler / scheduler selects
  const samSel = document.getElementById('gen-hires-sampler');
  const schSel = document.getElementById('gen-hires-scheduler');
  if (samSel && _hiresSampler) samSel.value = _hiresSampler;
  if (schSel && _hiresScheduler) schSel.value = _hiresScheduler;
  // seed
  _renderHiresSeedUI();
}

function _syncCNUI() {
  for (const type of _CN_TYPES) {
    // checkbox — welcome 页未完成时强制关闭
    const enabled = _cnEnabled[type] && _cnReady[type];
    const chk = document.querySelector(`.gen-mod-tab-chk[data-module="${type}"]`);
    if (chk) {
      chk.checked = enabled;
      chk.closest('.gen-mod-tab')?.classList.toggle('gen-mod-tab-on', enabled);
    }
    // model select
    const modelSel = document.getElementById(`gen-${type}-model`);
    if (modelSel && _cnModel[type]) modelSel.value = _cnModel[type];
    // sliders
    const strengthSl = document.getElementById(`gen-${type}-strength`);
    const strengthVal = document.getElementById(`gen-${type}-strength-val`);
    if (strengthSl) strengthSl.value = _cnStrength[type];
    if (strengthVal) strengthVal.textContent = parseFloat(_cnStrength[type]).toFixed(2);
    const startSl = document.getElementById(`gen-${type}-start`);
    const startVal = document.getElementById(`gen-${type}-start-val`);
    if (startSl) startSl.value = _cnStart[type];
    if (startVal) startVal.textContent = parseFloat(_cnStart[type]).toFixed(2);
    const endSl = document.getElementById(`gen-${type}-end`);
    const endVal = document.getElementById(`gen-${type}-end-val`);
    if (endSl) endSl.value = _cnEnd[type];
    if (endVal) endVal.textContent = parseFloat(_cnEnd[type]).toFixed(2);
    // 参考图预览 (通过 API 获取预览)
    if (_cnImage[type] && !_cnImagePreview[type]) {
      _cnImagePreview[type] = `/api/generate/input_image_preview?name=${encodeURIComponent(_cnImage[type])}`;
      _renderRefPreview(type);
    }
  }
}

function _syncI2IUI() {
  const chk = document.querySelector('.gen-mod-tab-chk[data-module="i2i"]');
  if (chk) {
    chk.checked = _i2iEnabled;
    chk.closest('.gen-mod-tab')?.classList.toggle('gen-mod-tab-on', _i2iEnabled);
  }
  // denoise slider
  const denoiseSl = document.getElementById('gen-i2i-denoise');
  const denoiseVal = document.getElementById('gen-i2i-denoise-val');
  if (denoiseSl) denoiseSl.value = _i2iDenoise;
  if (denoiseVal) denoiseVal.textContent = parseFloat(_i2iDenoise).toFixed(2);
  // 参考图预览 (从服务端恢复)
  if (_i2iImage && !_i2iImagePreview) {
    _i2iImagePreview = `/api/generate/input_image_preview?name=${encodeURIComponent(_i2iImage)}`;
    _renderI2IPreview();
  }
}

/** 从 localStorage 恢复上次展开的功能模块 Tab (在所有 init 完成后调用) */
function _restoreActiveModule() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (!s.activeModule) return;
    const tab = document.querySelector(`.gen-mod-tab[data-module="${s.activeModule}"]`);
    if (tab && !tab.classList.contains('active') && !tab.disabled) tab.click();
  } catch { /* ignore */ }
}

function _updateUpscaleSizeHint() {
  const hint = document.getElementById('gen-upscale-size');
  if (hint) {
    const { width, height } = _getResolution();
    const w = Math.round(width * _upscaleFactor);
    const h = Math.round(height * _upscaleFactor);
    hint.textContent = `→ ${w} × ${h}`;
  }
  // 4x 时禁用缩放算法（不经过 ImageScale）
  const dsSel = document.getElementById('gen-upscale-downscale');
  if (dsSel) {
    const is4x = _upscaleFactor >= 4;
    dsSel.disabled = is4x;
    dsSel.style.opacity = is4x ? '.4' : '';
  }
}

// ── 高清放大：模型检测 (通过 model-dependency.js 欢迎页管理) ────────────────
function _initUpscaleModelDep() {
  if (!_comfyuiDir) return;
  _upscaleDepHandle = initModelDependency({
    containerId: 'gen-upscale-download',
    paramsId: 'gen-upscale-params',
    comfyuiDir: _comfyuiDir,
    tab: 'upscale',
    title: '该功能需下载高清放大模型',
    models: [{
      id: 'aurasr-v2',
      name: 'AuraSR v2',
      description: '4× 超分辨率放大',
      size: '~2.3 GB',
      required: true,
      files: [
        { filename: 'config.json', url: 'https://huggingface.co/fal/AuraSR-v2/resolve/main/config.json?download=true', subdir: 'models/Aura-SR' },
        { filename: 'model.safetensors', url: 'https://huggingface.co/fal/AuraSR-v2/resolve/main/model.safetensors?download=true', subdir: 'models/Aura-SR' },
      ],
    }],
    onEnter: () => { _upscaleModelReady = true; },
  });
}

// ── 分辨率 ───────────────────────────────────────────────────────────────────
function _getResolution() {
  const sel = document.getElementById('gen-resolution');
  if (!sel) return { width: 1024, height: 1024 };
  if (sel.value === 'custom') {
    return {
      width: parseInt(document.getElementById('gen-width')?.value) || 1024,
      height: parseInt(document.getElementById('gen-height')?.value) || 1024,
    };
  }
  const [w, h] = sel.value.split('x').map(Number);
  return { width: w || 1024, height: h || 1024 };
}

// ── 提交生成 ─────────────────────────────────────────────────────────────────
export async function handleSubmit() {
  if (_state !== 'idle' && _state !== 'done' && _state !== 'error') return;

  // 预处理进行中不允许提交主工作流
  if (_CN_TYPES.some(t => _ppRunning[t])) {
    showToast('正在生成参考图，请稍候', 'warning');
    return;
  }

  const ckpt = _selectedCheckpoint || '';
  const positive = document.getElementById('gen-positive')?.value?.trim();

  if (!ckpt) { _showError('请选择基础模型'); return; }
  if (!positive) { _showError('请填写画面描述'); return; }

  // 检测 "已配置但未开启" 的模块 (ControlNet + 图生图)
  if (!localStorage.getItem('gen_skip_inactive_warn')) {
    const inactive = [];
    for (const type of _CN_TYPES) {
      if (!_cnEnabled[type] && _cnImage[type] && _cnReady[type]) {
        const labels = { pose: '姿势控制', canny: '轮廓控制', depth: '景深控制' };
        inactive.push({ mod: type, label: labels[type] });
      }
    }
    if (!_i2iEnabled && _i2iImage) {
      inactive.push({ mod: 'i2i', label: '图生图' });
    }
    if (inactive.length > 0) {
      const action = await _showInactiveConfirm(inactive);
      if (action === 'cancel') return;
      if (action === 'enable') {
        for (const { mod } of inactive) {
          const chk = document.querySelector(`.gen-mod-tab-chk[data-module="${mod}"]`);
          if (chk) {
            chk.checked = true;
            chk.closest('.gen-mod-tab')?.classList.toggle('gen-mod-tab-on', true);
            if (_CN_TYPES.includes(mod)) _cnEnabled[mod] = true;
            if (mod === 'i2i') _i2iEnabled = true;
          }
        }
      }
    }
  }

  // ControlNet 校验: 已启用的 CN 必须有参考图
  for (const type of _CN_TYPES) {
    if (!_cnEnabled[type]) continue;
    if (!_cnImage[type]) {
      const labels = { pose: '姿势控制', canny: '轮廓控制', depth: '景深控制' };
      _showError(`${labels[type]}已启用但未上传参考图，请上传或取消勾选`);
      return;
    }
    if (!_cnModel[type] && _cnModelOptions[type].length > 0) {
      _cnModel[type] = _cnModelOptions[type][0]; // 自动选第一个
    }
    if (!_cnModel[type] && !_cnModelOptions[type]?.length) {
      const labels = { pose: '姿势控制', canny: '轮廓控制', depth: '景深控制' };
      _showError(`${labels[type]}未检测到可用模型，请确认 ComfyUI 已启动`);
      return;
    }
  }

  // 图生图校验: 已启用必须有参考图
  if (_i2iEnabled && !_i2iImage) {
    _showError('图生图已启用但未上传参考图，请上传或取消勾选');
    return;
  }

  const { width, height } = _getResolution();
  const params = {
    upscale_mode: _upscaleMode,
    upscale_tile_batch_size: _upscaleTile,
    upscale_downscale_method: _upscaleDownscale,
    model_type: 'sdxl',
    checkpoint: ckpt,
    positive_prompt: positive,
    negative_prompt: document.getElementById('gen-negative')?.value?.trim() || '',
    width, height,
    seed: _getCurrentSeed(),
    steps: parseInt(document.getElementById('gen-steps')?.value) || 20,
    cfg: parseFloat(document.getElementById('gen-cfg')?.value) || 7.0,
    sampler: document.getElementById('gen-sampler')?.value || 'euler',
    scheduler: document.getElementById('gen-scheduler')?.value || 'normal',
    batch_size: parseInt(document.getElementById('gen-batch')?.value) || 1,
    save_prefix: document.getElementById('gen-prefix')?.value?.trim() || '[time(%Y-%m-%d)]/ComfyCarry_[time(%H%M%S)]',
    output_format: document.getElementById('gen-format')?.value || 'png',
    loras: _collectLoras(),
    upscale_enabled: _upscaleEnabled,
    upscale_factor: _upscaleFactor,
    hires_enabled: _hiresEnabled,
    hires_denoise: _hiresDenoise,
    hires_steps: _hiresSteps,
    hires_cfg: _hiresCfg,
    hires_sampler: _hiresSampler,
    hires_scheduler: _hiresScheduler,
    hires_seed: _hiresEnabled ? _getHiresSeed() : -1,
    controlnets: _collectControlnets(),
    i2i_image: _i2iEnabled ? _i2iImage : '',
    i2i_denoise: _i2iDenoise,
  };

  _setState('submitting');
  _hideError();

  const result = await apiFetch('/api/generate/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!result) { _setState('error'); _showError('提交失败，请检查网络或查看后台日志'); return; }
  if (result.error) { _setState('error'); _showError(result.error); return; }

  _currentPromptId = result.prompt_id || '';
  _setState('generating');
  showToast('⚡ 已加入队列 (' + _currentPromptId.slice(0, 8) + ')');
}

/** 显示"已配置但未启用"确认弹窗, 返回 'enable' | 'submit' | 'cancel' */
function _showInactiveConfirm(inactiveList) {
  return new Promise(resolve => {
    const names = inactiveList.map(i => i.label).join('、');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
      <div class="modal-box" style="width:420px;padding:24px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
          <span class="ms" style="color:var(--amber)">warning</span>
          <h3 style="margin:0;font-size:1rem">部分功能已配置但未启用</h3>
          <button class="btn btn-sm" data-action="cancel" style="margin-left:auto"><span class="ms ms-sm" style="color:var(--red)">close</span></button>
        </div>
        <p style="color:var(--t2);margin:0 0 20px;line-height:1.6;font-size:.88rem">
          <b>${escHtml(names)}</b> 已配置参数但开关未打开，提交后将不会生效。
        </p>
        <div style="display:flex;align-items:center;gap:12px;justify-content:space-between">
          <label style="display:flex;align-items:center;gap:6px;font-size:.8rem;color:var(--t3);cursor:pointer;white-space:nowrap">
            <input type="checkbox" id="gen-inactive-skip">
            不再提示
          </label>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm" data-action="submit">不启用，直接提交</button>
            <button class="btn btn-sm btn-primary" data-action="enable">启用并提交</button>
          </div>
        </div>
      </div>`;
    overlay.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action && e.target !== overlay) return;
      if (document.getElementById('gen-inactive-skip')?.checked) {
        localStorage.setItem('gen_skip_inactive_warn', '1');
      }
      overlay.remove();
      resolve(action || 'cancel');
    });
    document.body.appendChild(overlay);
  });
}

// ── SSE ──────────────────────────────────────────────────────────────────────
function _startSSE() {
  if (_sse) return;
  _tracker = createExecTracker({ onUpdate: _renderProgress });
  _sse = new EventSource('/api/comfyui/events');
  _sse.onmessage = e => { try { _handleSSEEvent(JSON.parse(e.data)); } catch (_) { } };
  _sse.onerror = () => {
    // 连接断开 → 延迟重连
    _stopSSE();
    setTimeout(() => {
      // 仅当 generate 页面还在显示时重连
      if (document.getElementById('page-generate')?.classList.contains('active')) {
        _startSSE();
      }
    }, 3000);
  };
  // SSE (重)连后验证：若前端认为正在生成，检查 ComfyUI 队列是否仍有该任务
  if (_state === 'generating' && _currentPromptId) {
    _validateGeneratingState();
  }
}

/** 检查 ComfyUI 队列中是否仍有当前 prompt，若无则重置为 idle */
async function _validateGeneratingState() {
  try {
    const data = await apiFetch('/api/comfyui/queue');
    if (!data) return;
    const running = (data.queue_running || []).map(item => item[1]);
    const pending = (data.queue_pending || []).map(item => item[1]);
    if (!running.includes(_currentPromptId) && !pending.includes(_currentPromptId)) {
      // 任务已不在队列中，可能在断连期间已完成/被取消
      // 尝试获取历史记录中的输出图片
      _fetchAndRenderImages(_currentPromptId)
        .then(() => _setState('done'))
        .catch(() => _setState('idle'));
    }
  } catch (e) {
    // 查询失败（ComfyUI 可能已重启），直接重置
    _setState('idle');
  }
}

function _stopSSE() {
  if (_sse) { _sse.close(); _sse = null; }
  if (_tracker) { _tracker.destroy?.(); _tracker = null; }
}

function _handleSSEEvent(evt) {
  // ── 预处理工作流事件拦截 ──
  const evtPid = evt.data?.prompt_id || '';
  const ppType = evtPid ? _findPreprocessType(evtPid) : null;

  if (ppType) {
    // 带 prompt_id 且匹配预处理 → 拦截
    if (evt.type === 'execution_done') {
      _onPreprocessDone(ppType, true);
    } else if (evt.type === 'execution_error' || evt.type === 'execution_interrupted') {
      _onPreprocessDone(ppType, false);
    } else if (evt.type === 'progress' || evt.type === 'executing') {
      // 更新预处理进度到状态栏
      _renderPreprocessProgress(ppType, evt);
    }
    return;  // 不让 tracker 处理
  }

  // ── 反推工作流事件拦截 ──
  if (evtPid && evtPid === _tagPromptId) {
    if (evt.type === 'execution_done') _onTagDone(true);
    else if (evt.type === 'execution_error' || evt.type === 'execution_interrupted') _onTagDone(false);
    else if (evt.type === 'progress' || evt.type === 'executing') _renderTagProgress(evt);
    return;
  }

  // 实时预览帧
  if (evt.type === 'preview_image') {
    const img = document.getElementById('gen-preview-img');
    if (img && evt.data?.b64) {
      img.src = 'data:' + (evt.data.mime || 'image/jpeg') + ';base64,' + evt.data.b64;
      img.classList.remove('hidden');
      document.getElementById('gen-preview-empty')?.classList.add('hidden');
      document.getElementById('gen-preview-grid')?.classList.add('hidden');
      document.getElementById('gen-preview-overlay')?.classList.remove('hidden');
    }
    return;
  }

  if (!_tracker) return;
  const result = _tracker.handleEvent(evt);

  // 只在 generating 状态处理完成/错误; 其他状态仅让 tracker 跟踪进度
  if (_state !== 'generating') return;
  if (!result || result === true) return;

  if (result.finished) {
    const finishedPid = result.data?.prompt_id || '';
    if (finishedPid && _currentPromptId && finishedPid !== _currentPromptId) return;

    document.getElementById('gen-preview-overlay')?.classList.add('hidden');

    if (result.type === 'execution_done') {
      _fetchAndRenderImages(_currentPromptId)
        .then(() => _setState('done'))
        .catch(() => { _setState('error'); _showError('获取输出图片失败'); });
    } else if (result.type === 'execution_error') {
      const msg = result.data?.exception_message || result.data?.node_type || '未知错误';
      _setState('error');
      _showError('ComfyUI 执行出错: ' + msg);
      showToast('❌ 生成失败');
    } else if (result.type === 'execution_interrupted') {
      _setState('idle');
      showToast('⏹ 生成已中断');
    }
  }
}

// ── 进度条（常驻模式 — 空闲用统一进度条样式显示"空闲"）──────────────────────
function _renderProgress() {
  const statusEl = document.getElementById('gen-bar-status');
  const stepEl = document.getElementById('gen-preview-step');
  const runBtn = document.getElementById('gen-run-btn');
  if (!statusEl) return;

  // 预处理运行中 → 禁用运行按钮
  const ppBusy = _CN_TYPES.some(t => _ppRunning[t]);
  if (runBtn && _state !== 'generating') runBtn.disabled = ppBusy;

  const st = _tracker?.getState();
  if (!st) {
    // 空闲：用 comfy-progress-bar 且无 .active，保持同等高度
    statusEl.innerHTML = `<div class="comfy-progress-bar">
      <span class="comfy-progress-label" style="color:var(--t3)"><span class="ms ms-sm" style="font-size:14px;vertical-align:middle">hourglass_empty</span> 空闲</span>
      <span class="comfy-progress-steps"></span>
      <span class="comfy-progress-time"></span>
    </div>`;
    if (stepEl) stepEl.textContent = '';
    return;
  }

  // 有状态时渲染统一进度条
  statusEl.innerHTML = renderProgressBar(st);

  // 更新预览区覆盖层
  if (stepEl) {
    const hasSteps = st.progress && st.progress.percent != null;
    const pct = hasSteps ? st.progress.percent : 0;
    const nodeName = st.current_node ? (st.node_names?.[st.current_node] || st.current_node) : '准备中';
    const stepDetail = hasSteps && st.progress.value != null ? ` ${st.progress.value}/${st.progress.max}` : '';
    stepEl.textContent = pct + '%' + stepDetail + ' \u2014 ' + nodeName;
  }
}

// ── 运行模式 ─────────────────────────────────────────────────────────────────
let _ppTimer = null;   // 预处理计时器
let _ppStartTime = 0;  // 预处理开始时间

/** 预处理进度渲染到主状态栏 */
function _renderPreprocessProgress(type, evt) {
  const statusEl = document.getElementById('gen-bar-status');
  if (!statusEl) return;

  const labels = { pose: '骨骼图', canny: '边缘图', depth: '深度图' };
  const label = labels[type] || '参考图';

  let nodeName = '';
  let stepInfo = '';

  if (evt.type === 'executing') {
    nodeName = evt.data?.class_type || evt.data?.node || '';
  } else if (evt.type === 'progress') {
    const v = evt.data?.value, m = evt.data?.max;
    if (v != null && m != null) stepInfo = `${v}/${m}`;
    nodeName = evt.data?.node || '';
  }

  const elapsed = _ppStartTime ? Math.round((Date.now() - _ppStartTime) / 1000) : 0;
  const mm = Math.floor(elapsed / 60), ss = String(elapsed % 60).padStart(2, '0');
  const timeStr = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
  const detail = [stepInfo, nodeName].filter(Boolean).join(' ');

  statusEl.innerHTML = `<div class="comfy-progress-bar active">
    <span class="comfy-progress-label" style="color:var(--ac)"><span class="ms ms-sm" style="font-size:14px;vertical-align:middle">auto_fix_high</span> 生成${label}</span>
    <span class="comfy-progress-steps" style="color:var(--t2)">${escHtml(detail)}</span>
    <span class="comfy-progress-time">${timeStr}</span>
  </div>`;
}

/** 开始预处理计时 */
function _startPPTimer() {
  _ppStartTime = Date.now();
  _stopPPTimer();
  _ppTimer = setInterval(() => {
    // 只在预处理/反推还在跑时更新计时
    if (!_CN_TYPES.some(t => _ppRunning[t]) && !_tagRunning) { _stopPPTimer(); _renderProgress(); return; }
    // 只更新时间部分
    const statusEl = document.getElementById('gen-bar-status');
    const timeEl = statusEl?.querySelector('.comfy-progress-time');
    if (!timeEl) return;
    const elapsed = Math.round((Date.now() - _ppStartTime) / 1000);
    const mm = Math.floor(elapsed / 60), ss = String(elapsed % 60).padStart(2, '0');
    timeEl.textContent = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
  }, 1000);
}

function _stopPPTimer() {
  if (_ppTimer) { clearInterval(_ppTimer); _ppTimer = null; }
  _ppStartTime = 0;
}

const _RUN_MODE_LABELS = { normal: '运行', onChange: '运行（修改时）', live: '运行（实时）' };
const _RUN_MODE_ICONS = { normal: 'play_arrow', onChange: 'edit_note', live: 'loop' };

function _setRunMode(mode) {
  _runMode = mode;
  // 生成中不更新按钮文字/图标，防止 .stop 样式与 "运行" 文字冲突
  if (_state !== 'generating') {
    const label = document.getElementById('gen-run-label');
    const icon = document.querySelector('#gen-run-btn .ms');
    if (label) label.textContent = _RUN_MODE_LABELS[mode] || '运行';
    if (icon) icon.textContent = _RUN_MODE_ICONS[mode] || 'play_arrow';
  }
  // 高亮当前选项
  document.querySelectorAll('.gen-run-opt').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.mode === mode);
  });
}

// ── 获取并渲染输出图片 (多图自适应网格) ──────────────────────────────────────
async function _fetchAndRenderImages(promptId) {
  if (!promptId) return;
  let retries = 6;
  while (retries-- > 0) {
    const data = await apiFetch('/api/comfyui/history?prompt_id=' + encodeURIComponent(promptId));
    const entry = data?.history?.[0];
    if (entry?.images?.length) {
      const images = entry.images;
      const grid = document.getElementById('gen-preview-grid');
      const previewImg = document.getElementById('gen-preview-img');
      const emptyEl = document.getElementById('gen-preview-empty');

      if (emptyEl) emptyEl.classList.add('hidden');

      if (images.length === 1) {
        // 单图: 直接用 gen-preview-img 显示
        if (grid) grid.classList.add('hidden');
        if (previewImg) {
          previewImg.src = _imageUrl(images[0]);
          previewImg.classList.remove('hidden');
        }
      } else {
        // 多图: 用网格 — 动态计算列数
        if (previewImg) previewImg.classList.add('hidden');
        if (grid) {
          grid.innerHTML = '';
          const cols = Math.ceil(Math.sqrt(images.length));
          grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
          images.forEach(img => {
            const el = document.createElement('img');
            el.src = _imageUrl(img);
            el.alt = img.filename;
            el.addEventListener('click', () => window.open(el.src, '_blank'));
            grid.appendChild(el);
          });
          grid.classList.remove('hidden');
        }
      }
      // 显示本次使用的种子（随机模式下种子值已在 _getCurrentSeed 中更新到输入框）
      return;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  showToast('⚠️ 无法获取输出图片，请前往 ComfyUI 页查看');
}

function _imageUrl(img) {
  return '/api/comfyui/view?filename=' + encodeURIComponent(img.filename) +
    '&subfolder=' + encodeURIComponent(img.subfolder || '') +
    '&type=' + encodeURIComponent(img.type || 'output');
}

// ── 状态机 ───────────────────────────────────────────────────────────────────
function _setState(newState) {
  _state = newState;
  const runBtn = document.getElementById('gen-run-btn');
  const runIcon = document.getElementById('gen-run-icon');
  const runLabel = document.getElementById('gen-run-label');
  const arrow = document.getElementById('gen-run-arrow');

  const isGenerating = newState === 'generating';

  // 按钮状态切换
  if (runBtn) {
    runBtn.disabled = (newState === 'submitting');
    runBtn.classList.toggle('stop', isGenerating);
  }
  if (arrow) {
    arrow.classList.toggle('stop', isGenerating);
  }

  if (isGenerating) {
    // 切换为停止按钮
    if (runIcon) runIcon.textContent = 'stop_circle';
    if (runLabel) runLabel.textContent = '停止';
  } else {
    // 恢复为运行按钮
    if (runIcon) runIcon.textContent = _RUN_MODE_ICONS[_runMode] || 'play_arrow';
    if (runLabel) runLabel.textContent = _RUN_MODE_LABELS[_runMode] || '运行';
  }

  if (newState === 'done') {
    _renderProgress(); // 刷新为空闲
    if (_runMode === 'live') {
      setTimeout(() => { if (_state === 'done') handleSubmit(); }, 500);
    } else {
      setTimeout(() => { if (_state === 'done') _setState('idle'); }, 2000);
    }
  } else if (newState === 'idle' || newState === 'error') {
    _renderProgress(); // 刷新为空闲
  }
}

// ── 辅助 ─────────────────────────────────────────────────────────────────────

// ── ComfyUI 就绪门控 ────────────────────────────────────────────────────────
async function _checkComfyGate() {
  const gate = document.getElementById('gen-gate');
  const main = document.getElementById('gen-main-content');
  const icon = document.getElementById('gen-gate-icon');
  const msg = document.getElementById('gen-gate-msg');
  const btn = document.getElementById('gen-gate-btn');
  if (!gate || !main) return true;

  try {
    const d = await apiFetch('/api/comfyui/status');
    if (d?.online) {
      // ComfyUI 在线 — 显示主内容
      gate.classList.add('hidden');
      main.classList.remove('hidden');
      return true;
    }

    // ComfyUI 未在线
    main.classList.add('hidden');
    gate.classList.remove('hidden');

    const pm2 = d?.pm2_status;
    if (pm2 === 'online') {
      // PM2 进程存在但 HTTP 未通 → 启动中
      icon.textContent = 'hourglass_top';
      icon.style.color = 'var(--amber)';
      msg.textContent = 'ComfyUI 正在启动，请稍候…';
      btn.classList.add('hidden');
      _startGatePoll();
    } else {
      // PM2 进程不在 → 未运行
      icon.textContent = 'power_off';
      icon.style.color = 'var(--amber)';
      msg.textContent = 'ComfyUI 未运行，生成功能需要 ComfyUI 服务';
      btn.classList.remove('hidden');
      _startGatePoll();
    }
    return false;
  } catch {
    // API 异常 — 也当作未就绪
    main.classList.add('hidden');
    gate.classList.remove('hidden');
    if (icon) { icon.textContent = 'error'; icon.style.color = 'var(--red)'; }
    if (msg) msg.textContent = '无法连接 Dashboard 服务';
    if (btn) btn.classList.add('hidden');
    return false;
  }
}

function _startGatePoll() {
  _stopGatePoll();
  _gatePollTimer = setInterval(async () => {
    try {
      const d = await apiFetch('/api/comfyui/status');
      if (d?.online) {
        _stopGatePoll();
        // ComfyUI 就绪 — 重新触发 enterPage 来初始化完整 UI
        _enterPage();
      } else {
        // 更新启动中状态
        const icon = document.getElementById('gen-gate-icon');
        const msg = document.getElementById('gen-gate-msg');
        const btn = document.getElementById('gen-gate-btn');
        if (d?.pm2_status === 'online') {
          if (icon) { icon.textContent = 'hourglass_top'; icon.style.color = 'var(--amber)'; }
          if (msg) msg.textContent = 'ComfyUI 正在启动，请稍候…';
          if (btn) btn.classList.add('hidden');
        } else {
          if (icon) { icon.textContent = 'power_off'; icon.style.color = 'var(--amber)'; }
          if (msg) msg.textContent = 'ComfyUI 未运行，生成功能需要 ComfyUI 服务';
          if (btn) btn.classList.remove('hidden');
        }
      }
    } catch { /* 静默重试 */ }
  }, 5000);
}

function _stopGatePoll() {
  if (_gatePollTimer) { clearInterval(_gatePollTimer); _gatePollTimer = null; }
}

function _showOfflineBanner(show) {
  document.getElementById('gen-offline-banner')?.classList.toggle('hidden', !show);
}

function _showError(msg) {
  const el = document.getElementById('gen-error');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function _hideError() {
  document.getElementById('gen-error')?.classList.add('hidden');
}

function _basename(path) {
  return path.split('/').pop().split('\\').pop();
}

// 模型文件扩展名列表
const _MODEL_EXTS = ['.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.onnx', '.gguf', '.sft'];

function _stripExt(filename) {
  const lower = filename.toLowerCase();
  for (const ext of _MODEL_EXTS) {
    if (lower.endsWith(ext)) return filename.slice(0, -ext.length);
  }
  return filename;
}

/** 返回模型显示名称: 有 CivitAI 元数据用 name，否则用去扩展名的文件名 */
function _displayName(model) {
  if (model?.info?.name) return model.info.name;
  return _stripExt(model?.basename || '');
}

/** 返回 baseModel / arch 标签 HTML (覆盖在图片左上角) */
function _modelTagHtml(model) {
  const baseModel = model?.info?.baseModel;
  if (baseModel) return `<span class="gen-model-tag">${escHtml(baseModel)}</span>`;
  // 无 CivitAI 信息时显示架构
  const arch = model?.arch;
  if (arch && arch !== 'unknown') {
    const labels = { sd15: 'SD 1.5', sdxl: 'SDXL', flux: 'Flux', sd3: 'SD3' };
    return `<span class="gen-model-tag dim">${labels[arch] || arch}</span>`;
  }
  return '';
}

/**
 * 打开模型详情弹窗 (复用 Models 页的 meta-modal)
 * @param {object} model — _loraOptions / _checkpointOptions 中的条目
 * @param {string} type  — 'lora' | 'checkpoint'
 */
function _openModelDetail(model, type) {
  if (!window.openMetaModal) { showToast('详情功能需要先访问模型管理页加载'); return; }
  const info = model.info || {};
  const trainedWords = (info.trainedWords || []).map(w => typeof w === 'string' ? { word: w } : w);
  const images = [];
  // 本地预览优先
  if (model.has_preview && model.preview_path) {
    images.push({ url: `/api/local_models/preview?path=${encodeURIComponent(model.preview_path)}` });
  }
  // CivitAI 图片
  if (info.images?.length) info.images.forEach(img => images.push(img));

  window.openMetaModal({
    id: info.civitai_id || '-',
    name: _displayName(model),
    type: type === 'lora' ? 'LORA' : 'Checkpoint',
    file: model.name,
    version: {
      id: '', name: '',
      baseModel: info.baseModel || '',
      trainedWords,
      hashes: {},
    },
    images,
  });
}

// ── 主题化 Spinner ──────────────────────────────────────────────────────────
function _wrapSpinner(inputId, step) {
  const input = document.getElementById(inputId);
  if (!input || input.closest('.gen-spinner-wrap')) return;
  const wrap = document.createElement('div');
  wrap.className = 'gen-spinner-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const btns = document.createElement('div');
  btns.className = 'gen-spinner-btns';
  const up = document.createElement('button');
  up.className = 'gen-spinner-btn';
  up.type = 'button';
  up.innerHTML = '<span class="ms" style="font-size:12px">expand_less</span>';
  up.addEventListener('click', () => {
    const s = parseFloat(input.step) || step;
    input.value = Math.min(parseFloat(input.max) || Infinity, (parseFloat(input.value) || 0) + s);
    input.dispatchEvent(new Event('change'));
  });
  const down = document.createElement('button');
  down.className = 'gen-spinner-btn';
  down.type = 'button';
  down.innerHTML = '<span class="ms" style="font-size:12px">expand_more</span>';
  down.addEventListener('click', () => {
    const s = parseFloat(input.step) || step;
    input.value = Math.max(parseFloat(input.min) || 0, (parseFloat(input.value) || 0) - s);
    input.dispatchEvent(new Event('change'));
  });
  btns.appendChild(up);
  btns.appendChild(down);
  wrap.appendChild(btns);
}

// ── 可编辑数值标签 ──────────────────────────────────────────────────────────
function _makeEditable(spanId, sliderId, isInteger) {
  const span = document.getElementById(spanId);
  const slider = document.getElementById(sliderId);
  if (!span || !slider) return;

  span.addEventListener('click', (e) => {
    e.stopPropagation();
    if (span.querySelector('input')) return; // 已在编辑中
    const current = span.textContent;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.value = current;
    inp.min = slider.min;
    inp.max = slider.max;
    inp.step = slider.step;
    span.textContent = '';
    span.appendChild(inp);
    inp.focus();
    inp.select();

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      let v = parseFloat(inp.value);
      const min = parseFloat(slider.min);
      const max = parseFloat(slider.max);
      if (isNaN(v)) v = parseFloat(current);
      v = Math.max(min, Math.min(max, v));
      if (isInteger) v = Math.round(v);
      slider.value = v;
      span.textContent = isInteger ? String(v) : v.toFixed(1);
      slider.dispatchEvent(new Event('input'));
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', (ke) => {
      if (ke.key === 'Enter') { ke.preventDefault(); inp.blur(); }
      if (ke.key === 'Escape') { committed = true; span.textContent = current; }
    });
  });
}

// ── 输入校验 ────────────────────────────────────────────────────────────────
function _addValidation(inputId, rules) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('change', () => {
    let v = parseFloat(input.value);
    if (isNaN(v)) v = parseFloat(input.min) || 0;
    if (rules.integer) v = Math.round(v);
    if (rules.min != null) v = Math.max(rules.min, v);
    if (rules.max != null) v = Math.min(rules.max, v);
    if (rules.step) v = Math.round(v / rules.step) * rules.step;
    input.value = v;
  });
}

// ── AI 提示词弹窗 (LLM Assist) ──────────────────────────────────────────────

async function _openLlmModal() {
  const modal = document.getElementById('gen-llm-modal');
  if (!modal) return;

  // 每次打开都重新检查配置和 vision 能力
  try {
    const r = await apiFetch('/api/llm/config');
    const cfg = r?.data || r;
    _llmConfigured = !!(cfg?.provider && cfg?.api_key && cfg.api_key !== '****');
    _llmStream = !!cfg?.stream;

    // vision 能力判断
    _llmVisionSupport = false;
    if (_llmConfigured && cfg.provider) {
      try {
        const prov = await apiFetch('/api/llm/providers');
        const p = prov?.providers?.find(x => x.id === cfg.provider);
        _llmVisionSupport = !!p?.supports_vision;
      } catch { _llmVisionSupport = false; }
    }
  } catch {
    _llmConfigured = false;
  }

  const notCfg = document.getElementById('gen-llm-not-configured');
  const body = document.getElementById('gen-llm-body');

  if (!_llmConfigured) {
    // 未配置状态
    notCfg.style.display = '';
    notCfg.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:32px 16px;text-align:center">
        <span class="ms" style="font-size:48px;color:var(--t3)">settings</span>
        <p style="color:var(--t2);margin:0;font-size:.85rem">AI 提示词功能需要先配置 LLM 服务</p>
        <button class="btn btn-sm btn-primary" data-action="goto-llm-settings">
          <span class="ms ms-sm">settings</span> 前往设置
        </button>
      </div>`;
    notCfg.querySelector('[data-action="goto-llm-settings"]')?.addEventListener('click', () => {
      _closeLlmModal();
      window.showPage('settings');
      // 自动切到 LLM tab
      setTimeout(() => document.querySelector('[data-settab="llm"]')?.click(), 100);
    });
    body.style.display = 'none';
  } else {
    notCfg.style.display = 'none';
    body.style.display = '';
    _updateLlmTarget();
    // 更新 vision tab 状态
    const imgTab = document.querySelector('.gen-llm-mode-tab[data-mode="image"]');
    if (imgTab) {
      imgTab.disabled = !_llmVisionSupport;
      imgTab.title = _llmVisionSupport ? '' : '当前 LLM 不支持 Vision';
    }
    // 如果当前是图片模式但 vision 不可用，切回文字模式
    if (_llmMode === 'image' && !_llmVisionSupport) _llmMode = 'text';
    _setLlmMode(_llmMode);
    _renderLlmResult();
    _renderLlmImagePreview();
    _bindLlmModalEvents();
  }

  modal.classList.add('active');
}

function _closeLlmModal() {
  document.getElementById('gen-llm-modal')?.classList.remove('active');
  if (_llmAbort) { _llmAbort.abort(); _llmAbort = null; }
}
window._closeLlmModal = _closeLlmModal;

function _setLlmMode(mode) {
  _llmMode = mode;
  const textArea = document.getElementById('gen-llm-text-area');
  const imageArea = document.getElementById('gen-llm-image-area');
  const label = document.getElementById('gen-llm-submit-label');

  if (textArea) textArea.style.display = mode === 'text' ? 'flex' : 'none';
  if (imageArea) imageArea.style.display = mode === 'image' ? 'flex' : 'none';
  if (label) label.textContent = mode === 'text' ? '生成' : '反推';

  // tab active
  document.querySelectorAll('.gen-llm-mode-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });
}

function _getCurrentTarget() {
  const active = document.querySelector('#gen-type-tabs .tab.active');
  return active?.dataset?.gentab || 'sdxl';
}

function _updateLlmTarget() {
  const t = _getCurrentTarget();
  const el = document.getElementById('gen-llm-target-label');
  if (!el) return;
  if (t === 'flux') {
    el.textContent = '目标: Flux (自然语言)';
  } else {
    el.textContent = '目标: SDXL (Danbooru 标签)';
  }
}

function _bindLlmModalEvents() {
  if (_llmBound) return;
  _llmBound = true;

  // 模式切换
  document.querySelectorAll('.gen-llm-mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.disabled) return;
      _setLlmMode(tab.dataset.mode);
    });
  });

  // 提交按钮
  document.getElementById('gen-llm-submit')?.addEventListener('click', _submitLlmPrompt);

  // Ctrl+Enter 快捷键
  document.getElementById('gen-llm-input')?.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); _submitLlmPrompt(); }
  });
}

async function _submitLlmPrompt() {
  if (_llmRunning) return;

  let body;
  if (_llmMode === 'text') {
    const input = document.getElementById('gen-llm-input')?.value?.trim();
    if (!input) { showToast('请输入描述', 'warning'); return; }
    body = { input, target: _getCurrentTarget(), stream: _llmStream };
  } else {
    if (!_llmImageFile) { showToast('请先选择图片', 'warning'); return; }
    const base64 = await _fileToBase64(_llmImageFile);
    body = { image: base64, target: _getCurrentTarget(), stream: _llmStream };
  }

  _llmRunning = true;
  _llmResult = null;
  _renderLlmResult();
  document.getElementById('gen-llm-submit').disabled = true;

  try {
    if (_llmStream) {
      await _submitLlmSSE(body);
    } else {
      await _submitLlmJSON(body);
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      showToast('AI 生成出错: ' + (e.message || e), 'error');
    }
  }

  _llmRunning = false;
  document.getElementById('gen-llm-submit').disabled = false;
  _renderLlmResult();
}

async function _submitLlmJSON(body) {
  const resp = await apiFetch('/api/llm/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (resp?.ok) {
    _llmResult = resp.data;
  } else {
    showToast(resp?.error || 'AI 生成失败', 'error');
  }
}

async function _submitLlmSSE(body) {
  _llmAbort = new AbortController();

  const resp = await fetch('/api/llm/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: _llmAbort.signal,
  });

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let streamText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6);
      if (payload === '[DONE]') continue;
      try {
        const evt = JSON.parse(payload);
        if (evt.type === 'chunk') {
          streamText += evt.content;
          const el = document.getElementById('gen-llm-stream-text');
          if (el) el.textContent = streamText;
        } else if (evt.type === 'result') {
          _llmResult = evt.data;
        } else if (evt.type === 'error') {
          showToast(evt.message || 'AI 生成失败', 'error');
        }
      } catch { /* ignore */ }
    }
  }
  _llmAbort = null;
}

function _renderLlmResult() {
  const area = document.getElementById('gen-llm-result-area');
  if (!area) return;

  if (_llmRunning) {
    if (_llmStream) {
      area.innerHTML = `<div class="gen-tag-result-content">
        <div id="gen-llm-stream-text" style="flex:1;overflow-y:auto;font-size:.85rem;line-height:1.6;color:var(--t2);white-space:pre-wrap"></div>
      </div>`;
    } else {
      area.innerHTML = `<div class="gen-tag-result-empty">
        <div class="spinner" style="width:32px;height:32px"></div>
        <p style="color:var(--t3);margin:0">正在生成…</p>
      </div>`;
    }
  } else if (_llmResult) {
    const target = _getCurrentTarget();
    const showNeg = target !== 'flux' && _llmResult.negative;
    area.innerHTML = `<div class="gen-tag-result-content">
      <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:var(--sp-3)">
        <div>
          <div style="font-size:.72rem;color:var(--t3);text-transform:uppercase;margin-bottom:4px;font-weight:500">
            <span class="ms" style="font-size:14px;vertical-align:middle">add_circle</span> Positive
          </div>
          <div style="font-size:.85rem;color:var(--t1);line-height:1.6;background:var(--bg3);padding:10px;border-radius:var(--r-sm);border:1px solid var(--bd);white-space:pre-wrap;max-height:200px;overflow-y:auto;user-select:text">${escHtml(_llmResult.positive)}</div>
        </div>
        ${showNeg ? `<div>
          <div style="font-size:.72rem;color:var(--t3);text-transform:uppercase;margin-bottom:4px;font-weight:500">
            <span class="ms" style="font-size:14px;vertical-align:middle">remove_circle</span> Negative
          </div>
          <div style="font-size:.85rem;color:var(--t2);line-height:1.6;background:var(--bg3);padding:10px;border-radius:var(--r-sm);border:1px solid var(--bd);white-space:pre-wrap;max-height:120px;overflow-y:auto;user-select:text">${escHtml(_llmResult.negative)}</div>
        </div>` : ''}
      </div>
      <div class="gen-tag-result-actions">
        <button class="btn btn-primary btn-sm" data-action="llm-fill"><span class="ms ms-sm">input</span> 填入提示词</button>
        <button class="btn btn-sm" data-action="llm-fill-pos"><span class="ms ms-sm">add</span> 仅填入正面</button>
        <button class="btn btn-sm" data-action="llm-copy"><span class="ms ms-sm">content_copy</span> 复制</button>
      </div>
    </div>`;

    area.querySelector('[data-action="llm-fill"]')?.addEventListener('click', () => _fillLlmResult('all'));
    area.querySelector('[data-action="llm-fill-pos"]')?.addEventListener('click', () => _fillLlmResult('positive-only'));
    area.querySelector('[data-action="llm-copy"]')?.addEventListener('click', _copyLlmResult);
  } else {
    area.innerHTML = `<div class="gen-tag-result-empty">
      <span class="ms" style="font-size:48px;color:var(--t3)">auto_awesome</span>
      <p style="color:var(--t3);margin:0">描述你想要的画面，AI 将生成对应的提示词</p>
    </div>`;
  }
}

function _fillLlmResult(mode) {
  if (!_llmResult) return;

  // 追加正面提示词
  const posEl = document.getElementById('gen-positive');
  if (posEl) {
    const existing = posEl.value.trim();
    posEl.value = existing ? existing + ', ' + _llmResult.positive : _llmResult.positive;
  }

  // 填入全部: 替换负面提示词
  if (mode === 'all' && _llmResult.negative) {
    const negEl = document.getElementById('gen-negative');
    if (negEl) negEl.value = _llmResult.negative;
  }

  _deferSave();
  showToast('已填入提示词', 'success');
  if (mode === 'all') _closeLlmModal();
}

function _copyLlmResult() {
  if (!_llmResult) return;
  let text = _llmResult.positive;
  if (_llmResult.negative) text += '\n\n[Negative]\n' + _llmResult.negative;
  navigator.clipboard.writeText(text).then(
    () => showToast('已复制到剪贴板', 'success'),
    () => showToast('复制失败', 'error')
  );
}

function _renderLlmImagePreview() {
  const container = document.getElementById('gen-llm-image-preview');
  if (!container) return;

  // 清空文件名槽
  const fnameSlot = document.getElementById('gen-llm-fname-slot');
  if (fnameSlot) fnameSlot.textContent = '';

  if (_llmImageFile) {
    let imgSrc;
    if (_llmImageFile instanceof File) {
      imgSrc = URL.createObjectURL(_llmImageFile);
    } else {
      imgSrc = `/api/generate/input_image_preview?name=${encodeURIComponent(_llmImageFile)}`;
    }
    container.innerHTML = `<img src="${imgSrc}" style="width:100%;height:100%;object-fit:contain">
      <div class="gen-ref-clear" title="移除"><span class="ms">close</span></div>`;
    if (_llmImageFileName && fnameSlot) {
      fnameSlot.textContent = _llmImageFileName;
    }
    container.querySelector('.gen-ref-clear')?.addEventListener('click', (e) => {
      e.stopPropagation();
      _llmImageFile = null;
      _llmImageFileName = '';
      _renderLlmImagePreview();
    });
  } else {
    container.innerHTML = `
      <div class="gen-ref-placeholder gen-ref-split" style="width:100%;height:100%">
        <div class="gen-ref-split-top" data-action="llm-pick-input">
          <span class="ms" style="font-size:1.5rem;opacity:.4">folder_open</span>
          <span>从 input 选择</span>
        </div>
        <div class="gen-ref-split-divider"><span>或</span></div>
        <div class="gen-ref-split-bottom" data-action="llm-upload-local">
          <span class="ms" style="font-size:1.5rem;opacity:.4">upload</span>
          <span>拖放或点击上传</span>
        </div>
      </div>`;

    // 从 input 选择
    container.querySelector('[data-action="llm-pick-input"]')?.addEventListener('click', () => {
      _llmPickInput();
    });

    // 本地上传
    const uploadZone = container.querySelector('[data-action="llm-upload-local"]');
    if (uploadZone) {
      uploadZone.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
          const file = e.target.files?.[0];
          if (file) {
            _llmImageFile = file;
            _llmImageFileName = file.name;
            _renderLlmImagePreview();
          }
        };
        input.click();
      });

      // 拖拽
      uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
      uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
      uploadZone.addEventListener('drop', e => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        const file = e.dataTransfer?.files?.[0];
        if (file && file.type.startsWith('image/')) {
          _llmImageFile = file;
          _llmImageFileName = file.name;
          _renderLlmImagePreview();
        }
      });
    }
  }
}

async function _llmPickInput() {
  // 复用 gen-ref-modal (参考图片选择弹窗)
  try {
    const resp = await apiFetch('/api/generate/input_images');
    const images = resp?.images || [];
    const modal = document.getElementById('gen-ref-modal');
    if (!modal) return;

    // 设置标题
    const title = document.getElementById('gen-ref-modal-title');
    if (title) title.textContent = '选择图片';

    const grid = document.getElementById('gen-ref-modal-grid');
    if (!grid) return;

    grid.innerHTML = images.map(img => `
      <div class="gen-ref-card" data-name="${escAttr(img.name)}" style="cursor:pointer">
        <img src="/api/generate/input_image_preview?name=${encodeURIComponent(img.name)}" loading="lazy" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--r-sm)">
        <div style="font-size:.68rem;color:var(--t3);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 4px">${escHtml(img.name)}</div>
      </div>`).join('');

    if (!images.length) {
      grid.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px;color:var(--t3)">
        <span class="ms" style="font-size:48px">folder_off</span>
        <p style="margin:8px 0 0">input 目录暂无图片</p>
      </div>`;
    }

    // 绑定卡片点击
    grid.querySelectorAll('.gen-ref-card').forEach(card => {
      card.addEventListener('click', () => {
        const name = card.dataset.name;
        _llmImageFile = name;
        _llmImageFileName = name;
        _renderLlmImagePreview();
        modal.classList.remove('active');
      });
    });

    // 打开弹窗 (临时覆盖 onclick)
    const origOnClick = modal.onclick;
    modal.onclick = (e) => { if (e.target === modal) { modal.classList.remove('active'); modal.onclick = origOnClick; } };
    modal.classList.add('active');
  } catch {
    showToast('获取图片列表失败', 'error');
  }
}

function _fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (typeof file === 'string') {
      // 服务端文件名 → 通过 canvas 获取 base64
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = `/api/generate/input_image_preview?name=${encodeURIComponent(file)}`;
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
