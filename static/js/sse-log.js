/**
 * ComfyCarry — sse-log.js
 * 共享 SSE 日志流模块: 加载历史 + 实时追加
 *
 * 用法:
 *   import { createLogStream } from './sse-log.js';
 *   const stream = createLogStream({
 *     el: document.getElementById('my-log'),
 *     historyUrl: '/api/xxx/logs?lines=200',
 *     streamUrl:  '/api/xxx/logs/stream',
 *     classify:   line => /error/i.test(line) ? 'log-error' : /warn/i.test(line) ? 'log-warn' : '',
 *   });
 *   stream.start();   // 开始
 *   stream.stop();    // 停止
 */

import { escHtml, renderEmpty } from './core.js';

/**
 * 默认日志行分类器
 * @param {string} line
 * @returns {string} CSS class name
 */
function defaultClassify(line) {
  if (/error|exception|traceback/i.test(line)) return 'log-error';
  if (/warn/i.test(line)) return 'log-warn';
  return '';
}

/**
 * 创建一个 SSE 日志流实例
 * @param {object} opts
 * @param {HTMLElement} opts.el          - 日志容器元素
 * @param {string}      opts.historyUrl  - 历史日志 API (返回 { logs: string })
 * @param {string}      opts.streamUrl   - SSE 流地址 (每条 JSON { line, level })
 * @param {function}    [opts.classify]  - 行分类器, 返回 CSS class
 * @param {function}    [opts.historyExtract] - 自定义历史提取器，接收 JSON 数据，返回行数组 string[]
 * @param {number}      [opts.maxLines=500] - 最大保留行数
 * @param {string}      [opts.emptyMsg='暂无日志'] - 空日志提示
 * @returns {{ start(): void, stop(): void }}
 */
export function createLogStream(opts) {
  const {
    el,
    historyUrl,
    streamUrl,
    classify = defaultClassify,
    historyExtract = null,
    maxLines = 500,
    emptyMsg = '暂无日志',
  } = opts;

  let _source = null;

  function start() {
    stop();
    if (!el) return;

    // 加载历史日志
    fetch(historyUrl).then(r => r.json()).then(d => {
      let lines;
      if (historyExtract) {
        // 自定义提取: 返回 string[]
        lines = historyExtract(d);
      } else if (d.logs && d.logs.trim()) {
        lines = d.logs.split('\n').filter(l => l.trim());
      } else {
        lines = [];
      }
      if (lines.length > 0) {
        el.innerHTML = lines.map(l => {
          const cls = classify(l);
          return `<div${cls ? ` class="${cls}"` : ''}>${escHtml(l)}</div>`;
        }).join('');
        el.scrollTop = el.scrollHeight;
      } else {
        el.innerHTML = renderEmpty(emptyMsg);
      }
    }).catch(() => {});

    // SSE 实时推送
    _source = new EventSource(streamUrl);
    _source.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        // 收到第一条数据时清除空状态
        const emptyEl = el.querySelector('.empty-state');
        if (emptyEl) el.innerHTML = '';

        const div = document.createElement('div');
        div.textContent = d.line;
        if (d.level === 'error') div.className = 'log-error';
        else if (d.level === 'warn') div.className = 'log-warn';

        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        el.appendChild(div);
        while (el.children.length > maxLines) el.removeChild(el.firstChild);
        if (nearBottom) el.scrollTop = el.scrollHeight;
      } catch (_) {}
    };
  }

  function stop() {
    if (_source) { _source.close(); _source = null; }
  }

  return { start, stop };
}
