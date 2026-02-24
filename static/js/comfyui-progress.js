/**
 * ComfyCarry — comfyui-progress.js
 * Shared ComfyUI execution state machine + progress bar rendering.
 * Used by both page-dashboard.js (activity feed) and page-comfyui.js (exec bar).
 */

import { escHtml, fmtDuration } from './core.js';

/**
 * Create an execution state tracker.
 *
 * @param {Object} opts
 * @param {Function} opts.onUpdate  — called whenever state changes (render trigger)
 * @returns {{ handleEvent, getState, destroy }}
 */
export function createExecTracker({ onUpdate }) {
  let _state = null;
  let _timer = null;

  function _fetchNodeNames(promptId) {
    fetch('/api/comfyui/queue').then(r => r.json()).then(qData => {
      if (!_state || _state.prompt_id !== promptId) return;
      for (const item of (qData.queue_running || [])) {
        if (item[1] === promptId && item[2]) {
          for (const [nid, ndata] of Object.entries(item[2])) {
            if (typeof ndata === 'object' && ndata.class_type) {
              _state.node_names[nid] = ndata.class_type;
            }
          }
          _state.total_nodes = Object.keys(_state.node_names).length;
          onUpdate();
          break;
        }
      }
    }).catch(() => {});
  }

  function _startTimer() {
    if (_timer) clearInterval(_timer);
    _timer = setInterval(onUpdate, 1000);
  }

  function _clearState() {
    _state = null;
    if (_timer) { clearInterval(_timer); _timer = null; }
  }

  /**
   * Feed an SSE event into the state machine.
   * @returns {Object|boolean}
   *   - true if handled (state changed)
   *   - { finished: true, type, data } if execution ended
   *   - false if not an execution event
   */
  function handleEvent(evt) {
    const t = evt.type;
    const d = evt.data || {};

    if (t === 'execution_start' || t === 'execution_snapshot') {
      const nodeNames = d.node_names || {};
      _state = {
        start_time: d.start_time || (Date.now() / 1000),
        prompt_id: d.prompt_id || '',
        current_node: t === 'execution_snapshot' ? (d.current_node || null) : null,
        node_names: nodeNames,
        total_nodes: Object.keys(nodeNames).length,
        executed_nodes: new Set(d.executed_nodes || []),
        cached_nodes: new Set(d.cached_nodes || []),
        progress: null,
      };
      if (_state.total_nodes === 0 && d.prompt_id) {
        _fetchNodeNames(d.prompt_id);
      }
      onUpdate();
      _startTimer();
      return true;
    }

    if (t === 'progress') {
      if (_state) _state.progress = d;
      onUpdate();
      return true;
    }

    if (t === 'executing') {
      if (_state && d.node) {
        _state.current_node = d.node;
        _state.executed_nodes.add(d.node);
        if (d.class_type) _state.node_names[d.node] = d.class_type;
        _state.progress = null;
      }
      onUpdate();
      return true;
    }

    if (t === 'execution_cached') {
      if (_state && Array.isArray(d.nodes)) {
        d.nodes.forEach(n => _state.cached_nodes.add(n));
      }
      onUpdate();
      return true;
    }

    if (t === 'execution_done' || t === 'execution_error' || t === 'execution_interrupted') {
      _clearState();
      onUpdate();
      return { finished: true, type: t, data: d };
    }

    return false;
  }

  function getState() { return _state; }

  function destroy() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    _state = null;
  }

  return { handleEvent, getState, destroy };
}

/**
 * Render a progress bar HTML string from execution state.
 * @param {Object} st   — execution state from tracker.getState()
 * @param {string} [extraStyle] — optional inline style for the container
 */
export function renderProgressBar(st, extraStyle) {
  if (!st) return '';

  const elapsed = Math.round(Date.now() / 1000 - st.start_time);
  const timeStr = fmtDuration(elapsed);

  const completedCount = st.executed_nodes.size + st.cached_nodes.size;
  const totalNodes = st.total_nodes || '?';

  const nodeName = st.current_node
    ? (st.node_names?.[st.current_node] || st.current_node)
    : '';

  const hasSteps = st.progress && st.progress.percent != null;
  const stepPct = hasSteps ? st.progress.percent : 0;

  let fillPct = 0;
  if (totalNodes !== '?' && totalNodes > 0) {
    const baseProgress = Math.max(0, completedCount - 1) / totalNodes;
    const currentFraction = hasSteps ? (stepPct / 100) / totalNodes : 0;
    fillPct = Math.min(100, Math.round((baseProgress + currentFraction) * 100));
  } else if (hasSteps) {
    fillPct = stepPct;
  }

  const styleAttr = extraStyle ? ` style="${extraStyle}"` : '';
  let html = `<div class="comfy-progress-bar active"${styleAttr}>`;
  html += `<div class="comfy-progress-bar-fill" style="width:${fillPct}%"></div>`;
  html += `<span class="comfy-progress-pulse"></span>`;
  html += `<span class="comfy-progress-label">⚡ 正在生成</span>`;

  if (nodeName) {
    html += `<span class="comfy-progress-node">${completedCount}/${totalNodes} ${escHtml(nodeName)}</span>`;
  }

  if (hasSteps) {
    const stepDetail = st.progress.value != null ? `${st.progress.value}/${st.progress.max}` : '';
    html += `<span class="comfy-progress-steps">${stepDetail} (${stepPct}%)</span>`;
  } else {
    html += `<span class="comfy-progress-steps"></span>`;
  }

  html += `<span class="comfy-progress-time">${timeStr}</span>`;
  html += `</div>`;
  return html;
}
