/**
 * ComfyCarry — generate-llm.js
 * AI 提示词弹窗 (LLM Assist) — 从 page-generate.js 分离
 */
import { apiFetch, showToast, escHtml, escAttr } from './core.js';

// ── 模块状态 ─────────────────────────────────────────────────────────────────
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
let _llmModelName = '';      // 当前 LLM 模型名

// ── 外部依赖 (由主模块注入) ──────────────────────────────────────────────────
let _deferSave = () => {};

/** 注入主模块的 deferSave 函数 */
export function setDeferSave(fn) { _deferSave = fn; }

/** 重置 LLM 模块状态 (页面离开时调用) */
export function resetLlmState() {
  if (_llmAbort) { _llmAbort.abort(); _llmAbort = null; }
  _llmBound = false;
}

// ── 主入口 ───────────────────────────────────────────────────────────────────

export async function openLlmModal() {
  const modal = document.getElementById('gen-llm-modal');
  if (!modal) return;

  // 每次打开都重新检查配置和 vision 能力
  try {
    const r = await apiFetch('/api/llm/config');
    const cfg = r?.data || r;
    _llmConfigured = !!(cfg?.provider && cfg?.api_key && cfg.api_key !== '****');
    _llmStream = !!cfg?.stream;
    _llmModelName = cfg?.model || '';

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
      closeLlmModal();
      window.showPage('settings');
      // 自动切到 LLM tab
      setTimeout(() => document.querySelector('[data-settab="llm"]')?.click(), 100);
    });
    body.style.display = 'none';
  } else {
    notCfg.style.display = 'none';
    body.style.display = '';
    _updateLlmModelLabel();
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

export function closeLlmModal() {
  document.getElementById('gen-llm-modal')?.classList.remove('active');
  if (_llmAbort) { _llmAbort.abort(); _llmAbort = null; }
}
window._closeLlmModal = closeLlmModal;

// ── 内部函数 ─────────────────────────────────────────────────────────────────

function _getCurrentTarget() {
  const active = document.querySelector('#gen-type-tabs .tab.active');
  return active?.dataset?.gentab || 'sdxl';
}

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

function _updateLlmModelLabel() {
  const el = document.getElementById('gen-llm-model-label');
  if (!el) return;
  el.textContent = _llmModelName ? `模型: ${_llmModelName}` : '';
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
        <button class="btn btn-primary btn-sm" data-action="llm-fill-pos"><span class="ms ms-sm">input</span> 使用提示词</button>
        <button class="btn btn-sm" data-action="llm-fill"><span class="ms ms-sm">done_all</span> 使用全部提示词</button>
        <button class="btn btn-sm" data-action="llm-copy"><span class="ms ms-sm">content_copy</span> 复制</button>
      </div>
    </div>`;

    area.querySelector('[data-action="llm-fill"]')?.addEventListener('click', () => _fillLlmResult('all'));
    area.querySelector('[data-action="llm-fill-pos"]')?.addEventListener('click', () => _fillLlmResult('positive-only'));
    area.querySelector('[data-action="llm-copy"]')?.addEventListener('click', _copyLlmResult);
  } else {
    area.innerHTML = `<div class="gen-tag-result-empty">
      <span class="ms" style="font-size:48px;color:var(--t3)">auto_awesome</span>
      <p style="color:var(--t3);margin:0">AI 生成的提示词将会出现在这里</p>
    </div>`;
  }
}

function _fillLlmResult(mode) {
  if (!_llmResult) return;

  const posEl = document.getElementById('gen-positive');
  if (posEl) posEl.value = _llmResult.positive;

  if (mode === 'all' && _llmResult.negative) {
    const negEl = document.getElementById('gen-negative');
    if (negEl) negEl.value = _llmResult.negative;
  }

  _deferSave();
  showToast(mode === 'all' ? '已使用全部提示词' : '已使用提示词', 'success');
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

  if (_llmImageFile) {
    let imgSrc;
    if (_llmImageFile instanceof File) {
      imgSrc = URL.createObjectURL(_llmImageFile);
    } else {
      imgSrc = `/api/generate/input_image_preview?name=${encodeURIComponent(_llmImageFile)}`;
    }
    container.innerHTML = `<img src="${imgSrc}" style="width:100%;height:100%;object-fit:contain">
      <div class="gen-ref-clear" title="移除"><span class="ms">close</span></div>`;
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
        modal.style.zIndex = '';
      });
    });

    // 打开弹窗 (临时覆盖 onclick, 提升 z-index 以覆盖 llm-modal)
    const origOnClick = modal.onclick;
    modal.style.zIndex = '210';
    modal.onclick = (e) => { if (e.target === modal) { modal.classList.remove('active'); modal.style.zIndex = ''; modal.onclick = origOnClick; } };
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
