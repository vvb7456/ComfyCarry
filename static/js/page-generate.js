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
let _comfyuiDir = '';  // 从 options API 获取, 用于构建模型路径
let _deferSave = () => {};  // assigned in _bindUIEvents
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
let _upscaleDepHandle = null;  // AuraSR model-dependency 句柄

// ── 注册页面 ─────────────────────────────────────────────────────────────────
registerPage('generate', {
  enter() { _enterPage(); },
  leave() { _leavePage(); },
});

async function _enterPage() {
  _bindUIEvents();
  await _loadOptions();
  _restoreState();     // 恢复持久化参数
  _initUpscaleModelDep();  // AuraSR 模型依赖检测 (仅注册, 不立即检查)
  _initCNModelDeps();  // ControlNet 模型依赖检测 (仅注册, 不立即检查)
  _startSSE();
  _renderProgress();   // 初始渲染空闲状态
  _renderSeedUI();     // 初始种子值显示
}

function _leavePage() {
  _saveState();
  _stopSSE();
  document.removeEventListener('click', _handleDocClick);
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
      // 切换到高清放大时检查模型状态
      if (mod === 'upscale' && isNowActive && _upscaleDepHandle) _upscaleDepHandle.recheck();
      // 切换到 ControlNet tab 时检查模型
      if (_CN_TYPES.includes(mod) && isNowActive && _cnDepHandles[mod]) {
        _cnDepHandles[mod].recheck();
      }
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
      if (tab) tab.classList.toggle('gen-mod-tab-on', chk.checked);
      if (mod === 'upscale') {
        _upscaleEnabled = chk.checked;
        _updateUpscaleSizeHint();
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
}

// ── ControlNet 参考图选择 ─────────────────────────────────────────────────
let _refModalType = '';  // 当前弹窗对应的 CN 类型

function _bindRefUpload(type) {
  const uploadDiv = document.getElementById(`gen-${type}-upload`);
  const fileInput = document.getElementById(`gen-${type}-file`);
  if (!uploadDiv || !fileInput) return;

  // 点击上传区 → 打开图片选择弹窗
  uploadDiv.addEventListener('click', (e) => {
    if (e.target.closest('.gen-ref-clear')) return;
    _openRefModal(type);
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
}

async function _openRefModal(type) {
  _refModalType = type;
  const labels = { pose: '骨骼图', canny: '边缘图', depth: '深度图' };
  const titleEl = document.getElementById('gen-ref-modal-title');
  if (titleEl) titleEl.textContent = `选择${labels[type] || '参考图'}`;

  const grid = document.getElementById('gen-ref-modal-grid');
  if (grid) grid.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--t3)">加载中...</div>';

  document.getElementById('gen-ref-modal')?.classList.add('active');

  // 加载 input 文件夹图片列表
  try {
    const resp = await apiFetch('/api/generate/input_images');
    _renderRefModalGrid(resp?.images || []);
  } catch {
    _renderRefModalGrid([]);
  }
}

window._closeRefModal = function() {
  document.getElementById('gen-ref-modal')?.classList.remove('active');
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
      // 选择已有图片
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
    const fileInput = document.getElementById(`gen-${_refModalType}-file`);
    if (fileInput) fileInput.click();
    window._closeRefModal();
  });
  grid.appendChild(uploadCard);
}

async function _handleRefFile(type, file) {
  const uploadDiv = document.getElementById(`gen-${type}-upload`);
  if (!uploadDiv) return;

  // 本地预览
  const reader = new FileReader();
  reader.onload = (e) => {
    _cnImagePreview[type] = e.target.result;
    _renderRefPreview(type);
  };
  reader.readAsDataURL(file);

  // 上传到服务端
  const form = new FormData();
  form.append('file', file);
  form.append('type', type);

  try {
    const resp = await apiFetch('/api/generate/upload_image', { method: 'POST', body: form });
    if (resp?.filename) {
      _cnImage[type] = resp.filename;
      _deferSave();
      showToast('参考图已上传', 'success');
    } else {
      showToast('上传失败: ' + (resp?.error || '未知错误'), 'error');
    }
  } catch (e) {
    showToast('上传失败: ' + e.message, 'error');
  }
}

function _renderRefPreview(type) {
  const uploadDiv = document.getElementById(`gen-${type}-upload`);
  if (!uploadDiv) return;

  if (_cnImagePreview[type]) {
    uploadDiv.innerHTML = `
      <img src="${_cnImagePreview[type]}" alt="参考图">
      <div class="gen-ref-fname">${escHtml(_cnImage[type] || '')}</div>
      <div class="gen-ref-clear" title="移除参考图"><span class="ms">close</span></div>`;
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
      <div class="gen-ref-placeholder">
        <span class="ms" style="font-size:2rem;opacity:.4">image</span>
        <span>点击选择${labels[type] || '参考图'}</span>
      </div>`;
  }
}

// ── ControlNet 可下载模型定义 ─────────────────────────────────────────────────
const _CN_MODELS = {
  // 共享: Xinsir Union ProMax (所有类型通用)
  union: {
    id: 'xinsir-union-promax',
    name: 'Xinsir Union ProMax',
    description: 'SDXL/写实/Pony 通用 · 单模型覆盖所有控制类型',
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
    description: 'Illustrious/NoobAI 专用 · 姿态控制优化',
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
    description: 'Illustrious/NoobAI 专用 · 轮廓控制优化',
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
    description: 'Illustrious/NoobAI 专用 · 景深控制优化',
    size: '~1.2 GB',
    files: [{
      filename: 'illustriousXLv1.1_depth_midas_fp16.safetensors',
      url: 'https://huggingface.co/MIC-Lab/illustriousXLv1.1_controlnet/resolve/main/illustriousXLv1.1_depth_midas_fp16.safetensors?download=true',
      subdir: 'models/controlnet',
    }],
  },
};

const _CN_MODEL_CFG = {
  pose: {
    title: '姿势控制模型未安装',
    description: '请选择要下载的姿势控制模型（至少一个）',
    models: [_CN_MODELS.union, _CN_MODELS.pose_dedicated],
  },
  canny: {
    title: '轮廓控制模型未安装',
    description: '请选择要下载的轮廓控制模型（至少一个）',
    models: [_CN_MODELS.union, _CN_MODELS.canny_dedicated],
  },
  depth: {
    title: '景深控制模型未安装',
    description: '请选择要下载的景深控制模型（至少一个）',
    models: [_CN_MODELS.union, _CN_MODELS.depth_dedicated],
  },
};

// ── ControlNet model-dependency 初始化 (惰性: tab 点击时才检测) ─────────────
function _initCNModelDeps() {
  if (!_comfyuiDir) return;

  for (const type of _CN_TYPES) {
    // 如果后端已检测到该类型有可用模型, 直接显示参数面板
    if (_cnModelOptions[type].length > 0) {
      const dlArea = document.getElementById(`gen-${type}-download`);
      const params = document.getElementById(`gen-${type}-params`);
      if (dlArea) dlArea.classList.add('hidden');
      if (params) params.classList.remove('hidden');
      _cnDepHandles[type] = {
        recheck: async () => {
          await _loadOptions(true);
          _refreshCNPanel(type);
        },
      };
      continue;
    }

    // 无模型 → 注册惰性初始化 (tab 首次点击时才创建 model-dependency)
    const cfg = _CN_MODEL_CFG[type];
    _cnDepHandles[type] = {
      _lazy: true,
      recheck() {
        // 首次 recheck 时初始化 model-dependency
        const handle = initModelDependency({
          containerId: `gen-${type}-download`,
          paramsId: `gen-${type}-params`,
          comfyuiDir: _comfyuiDir,
          title: cfg.title,
          description: cfg.description,
          models: cfg.models,
          onReady: () => {
            _loadOptions(true).then(() => _refreshCNPanel(type));
          },
        });
        // 替换自身为真实句柄
        _cnDepHandles[type] = handle;
      },
    };
  }
}

/** 刷新单个 CN type 的面板可见性 (模型列表变化后调用) */
function _refreshCNPanel(type) {
  const dlArea = document.getElementById(`gen-${type}-download`);
  const params = document.getElementById(`gen-${type}-params`);
  if (!dlArea || !params) return;

  if (_cnModelOptions[type].length > 0) {
    dlArea.classList.add('hidden');
    params.classList.remove('hidden');
  } else {
    params.classList.add('hidden');
    dlArea.classList.remove('hidden');
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
      .map(s => `<option value="${escAttr(s)}"${s==='euler'?' selected':''}>${escHtml(s)}</option>`).join('');
    if (prev && data.samplers.includes(prev)) samplerSel.value = prev;
  }

  const schedulerSel = document.getElementById('gen-scheduler');
  if (schedulerSel && data.schedulers?.length) {
    const prev = schedulerSel.value;
    schedulerSel.innerHTML = data.schedulers
      .map(s => `<option value="${escAttr(s)}"${s==='normal'?' selected':''}>${escHtml(s)}</option>`).join('');
    if (prev && data.schedulers.includes(prev)) schedulerSel.value = prev;
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
    const imgHtml = imgSrc
      ? `<img src="${escHtml(imgSrc)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy"><div class="gen-ckpt-no-img" style="display:none"><span class="ms" style="font-size:2rem;opacity:.3">deployed_code</span></div>`
      : `<div class="gen-ckpt-no-img"><span class="ms" style="font-size:2rem;opacity:.25">deployed_code</span></div>`;
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

window._closeCkptModal = function() {
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
      const imgHtml = imgSrc
        ? `<img src="${escHtml(imgSrc)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy"><div class="gen-lora-card-no-img" style="display:none"><span class="ms" style="font-size:1.8rem;opacity:.3">image_not_supported</span></div>`
        : `<div class="gen-lora-card-no-img"><span class="ms" style="font-size:1.8rem;opacity:.25">image_not_supported</span></div>`;
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

window._closeLoraModal = function() {
  document.getElementById('gen-lora-modal')?.classList.remove('active');
};

window._confirmLoraModal = function() {
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
      const imgHtml = imgSrc
        ? `<img src="${escHtml(imgSrc)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy"><div class="gen-lora-card-no-img" style="display:none"><span class="ms" style="font-size:1.8rem;opacity:.3">image_not_supported</span></div>`
        : `<div class="gen-lora-card-no-img"><span class="ms" style="font-size:1.8rem;opacity:.25">image_not_supported</span></div>`;
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
      cnEnabled: { ..._cnEnabled },
      cnModel: { ..._cnModel },
      cnStrength: { ..._cnStrength },
      cnStart: { ..._cnStart },
      cnEnd: { ..._cnEnd },
      cnImage: { ..._cnImage },
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

    // ControlNet
    if (s.cnEnabled) for (const t of _CN_TYPES) if (s.cnEnabled[t] != null) _cnEnabled[t] = !!s.cnEnabled[t];
    if (s.cnModel) for (const t of _CN_TYPES) if (s.cnModel[t]) _cnModel[t] = s.cnModel[t];
    if (s.cnStrength) for (const t of _CN_TYPES) if (s.cnStrength[t] != null) _cnStrength[t] = parseFloat(s.cnStrength[t]);
    if (s.cnStart) for (const t of _CN_TYPES) if (s.cnStart[t] != null) _cnStart[t] = parseFloat(s.cnStart[t]);
    if (s.cnEnd) for (const t of _CN_TYPES) if (s.cnEnd[t] != null) _cnEnd[t] = parseFloat(s.cnEnd[t]);
    if (s.cnImage) for (const t of _CN_TYPES) if (s.cnImage[t]) _cnImage[t] = s.cnImage[t];
    _syncCNUI();
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

function _syncCNUI() {
  for (const type of _CN_TYPES) {
    // checkbox
    const chk = document.querySelector(`.gen-mod-tab-chk[data-module="${type}"]`);
    if (chk) {
      chk.checked = _cnEnabled[type];
      chk.closest('.gen-mod-tab')?.classList.toggle('gen-mod-tab-on', _cnEnabled[type]);
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

// ── 高清放大：模型检测 (通过 model-dependency.js 模块管理) ──────────────────
function _initUpscaleModelDep() {
  if (!_comfyuiDir) return;
  // 惰性初始化: tab 首次点击时才检测
  _upscaleDepHandle = {
    _lazy: true,
    recheck() {
      const handle = initModelDependency({
        containerId: 'gen-upscale-download',
        paramsId: 'gen-upscale-params',
        comfyuiDir: _comfyuiDir,
        title: 'AuraSR v2 模型未安装',
        description: '高清放大功能需要下载约 2.3 GB 模型文件',
        models: [{
          id: 'aurasr-v2',
          name: 'AuraSR v2',
          description: '4× 超分辨率模型',
          size: '~2.3 GB',
          files: [
            { filename: 'config.json', url: 'https://huggingface.co/fal/AuraSR-v2/resolve/main/config.json?download=true', subdir: 'models/Aura-SR' },
            { filename: 'model.safetensors', url: 'https://huggingface.co/fal/AuraSR-v2/resolve/main/model.safetensors?download=true', subdir: 'models/Aura-SR' },
          ],
        }],
        onReady: () => {},
      });
      _upscaleDepHandle = handle;
    },
  };
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

  const ckpt = _selectedCheckpoint || '';
  const positive = document.getElementById('gen-positive')?.value?.trim();

  if (!ckpt) { _showError('请选择基础模型'); return; }
  if (!positive) { _showError('请填写画面描述'); return; }

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
    controlnets: _collectControlnets(),
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

// ── SSE ──────────────────────────────────────────────────────────────────────
function _startSSE() {
  if (_sse) return;
  _tracker = createExecTracker({ onUpdate: _renderProgress });
  _sse = new EventSource('/api/comfyui/events');
  _sse.onmessage = e => { try { _handleSSEEvent(JSON.parse(e.data)); } catch(_){} };
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
}

function _stopSSE() {
  if (_sse) { _sse.close(); _sse = null; }
  if (_tracker) { _tracker.destroy?.(); _tracker = null; }
}

function _handleSSEEvent(evt) {
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
  if (!statusEl) return;

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
const _RUN_MODE_LABELS = { normal: '运行', onChange: '运行（修改时）', live: '运行（实时）' };
const _RUN_MODE_ICONS = { normal: 'play_arrow', onChange: 'edit_note', live: 'loop' };

function _setRunMode(mode) {
  _runMode = mode;
  const label = document.getElementById('gen-run-label');
  const icon = document.querySelector('#gen-run-btn .ms');
  if (label) label.textContent = _RUN_MODE_LABELS[mode] || '运行';
  if (icon) icon.textContent = _RUN_MODE_ICONS[mode] || 'play_arrow';
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
    '&subfolder=' + encodeURIComponent(img.subfolder||'') +
    '&type=' + encodeURIComponent(img.type||'output');
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
