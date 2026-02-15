#!/usr/bin/env python3
"""
CivitAI Model Lookup Tool v3.1 (Hybrid)
- ID Lookup: Client-Side (Direct to Civitai)
- Search/Facets: Server-Side Proxy (To bypass CORS on search.civitai.com)

启动: python civitai_lookup.py [port]
访问: http://localhost:5000
"""

import json
import os
import sys
import threading
import requests
from pathlib import Path
from flask import Flask, jsonify, request, Response

app = Flask(__name__)

# --- 配置 ---
CONFIG_FILE = Path(__file__).parent / ".civitai_config.json"
MEILI_URL = 'https://search.civitai.com/multi-search'
MEILI_BEARER = '8c46eb2508e21db1e9828a97968d91ab1ca1caa5f70a00e88a2ba1e286603b61'

def _get_api_key():
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text()).get("api_key", "")
        except Exception:
            return ""
    return ""

# --- API 路由 ---

@app.route("/api/config", methods=["GET"])
def get_config():
    key = _get_api_key()
    return jsonify({
        "api_key": key,
        "has_key": bool(key),
        "key_preview": f"{key[:8]}...{key[-4:]}" if len(key) > 12 else ("****" if key else "")
    })

@app.route("/api/config", methods=["POST"])
def save_config():
    data = request.get_json()
    api_key = data.get("api_key", "").strip()
    CONFIG_FILE.write_text(json.dumps({"api_key": api_key}))
    return jsonify({"ok": True, "has_key": bool(api_key)})

@app.route("/api/search", methods=["POST"])
def proxy_search():
    """Proxy for Meilisearch to bypass CORS"""
    try:
        # Forward the request body to Meilisearch
        resp = requests.post(
            MEILI_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {MEILI_BEARER}"
            },
            json=request.get_json(),
            timeout=10
        )
        return Response(resp.content, status=resp.status_code, mimetype="application/json")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/")
def index():
    return Response(HTML_PAGE, mimetype="text/html")


# ====================================================================
# 前端 HTML / CSS / JS
# ====================================================================

HTML_PAGE = r'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CivitAI Model Lookup</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
/* CSS Reset & Variables */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0f0f13;--bg2:#1a1a24;--bg3:#1e1e2e;--bg4:#262638;--bg-in:#16161f;
  --bd:#2a2a3a;--bd-f:#7c5cfc;
  --t1:#e8e8f0;--t2:#9898b0;--t3:#686880;
  --ac:#7c5cfc;--ac2:#9078ff;--acg:rgba(124,92,252,0.25);
  --green:#4ade80;--blue:#60a5fa;--amber:#fbbf24;--red:#f87171;--pink:#f472b6;--cyan:#22d3ee;
  --r:12px;--rs:8px;--sh:0 4px 24px rgba(0,0,0,0.4);
}
html{font-size:14px}
body{font-family:'Inter',-apple-system,sans-serif;background:var(--bg);color:var(--t1);min-height:100vh;line-height:1.5}

/* Header */
.header{background:linear-gradient(180deg,rgba(124,92,252,0.08),transparent);border-bottom:1px solid var(--bd);padding:14px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;backdrop-filter:blur(20px)}
.header h1{font-size:1.3rem;font-weight:700;background:linear-gradient(135deg,#7c5cfc,#e879f9);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.header-actions{display:flex;gap:8px;align-items:center}

/* Buttons */
.btn{padding:8px 16px;border:1px solid var(--bd);border-radius:var(--rs);background:var(--bg2);color:var(--t1);cursor:pointer;font-size:.85rem;font-family:inherit;font-weight:500;transition:all .15s;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.btn:hover{border-color:var(--bd-f);background:var(--bg3)}
.btn-primary{background:var(--ac);border-color:var(--ac);color:#fff}
.btn-primary:hover{background:var(--ac2)}
.btn-sm{padding:5px 10px;font-size:.8rem}
.btn-danger{border-color:rgba(248,113,113,.3);color:var(--red)}
.btn-danger:hover{background:rgba(248,113,113,.1)}

/* Tabs */
.tabs{display:flex;gap:0;padding:0 24px;border-bottom:1px solid var(--bd);background:var(--bg)}
.tab{padding:12px 20px;cursor:pointer;font-size:.9rem;font-weight:500;color:var(--t2);border-bottom:2px solid transparent;transition:all .15s;user-select:none}
.tab:hover{color:var(--t1)} .tab.active{color:var(--ac);border-bottom-color:var(--ac)}
.tab .badge-count{background:var(--ac);color:#fff;font-size:.7rem;padding:1px 6px;border-radius:10px;margin-left:6px}

/* Main */
.main{padding:20px 24px 40px;max-width:1400px;margin:0 auto}

/* Inputs */
textarea,input[type="text"],select{width:100%;padding:10px 14px;background:var(--bg-in);border:1px solid var(--bd);border-radius:var(--rs);color:var(--t1);font-family:inherit;font-size:.9rem;transition:border-color .15s;outline:none}
textarea:focus,input[type="text"]:focus,select:focus{border-color:var(--bd-f);box-shadow:0 0 0 3px var(--acg)}
textarea{resize:vertical;min-height:80px}
select{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%239898b0' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:32px;cursor:pointer}
.input-section{margin-bottom:20px}
.input-section label{display:block;font-size:.85rem;font-weight:500;color:var(--t2);margin-bottom:6px}

/* Multi-select chips */
.chip-select{display:flex;flex-wrap:wrap;gap:6px;padding:10px;background:var(--bg-in);border:1px solid var(--bd);border-radius:var(--rs);min-height:42px;cursor:pointer;position:relative}
.chip{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;background:rgba(124,92,252,.15);border:1px solid rgba(124,92,252,.3);border-radius:4px;font-size:.78rem;font-weight:500;color:var(--ac);cursor:pointer;transition:all .15s;white-space:nowrap}
.chip:hover{background:rgba(124,92,252,.25)}
.chip.active{background:var(--ac);color:#fff;border-color:var(--ac)}
.chip .chip-count{font-size:.68rem;color:var(--t3);margin-left:2px}
.chip.active .chip-count{color:rgba(255,255,255,.7)}
.chip-select-label{font-size:.8rem;color:var(--t3);padding:3px 0}

/* Search */
.search-bar{display:flex;gap:10px;margin-bottom:16px}
.search-bar input{flex:1}
.filters{display:flex;flex-direction:column;gap:12px;margin-bottom:20px}
.filter-row{display:flex;align-items:flex-start;gap:10px}
.filter-row label{min-width:90px;padding-top:8px;font-size:.82rem;font-weight:500;color:var(--t2);text-align:right}
.filter-row .chip-select{flex:1}
.filter-row select{width:auto;min-width:160px}
.id-input-area{display:flex;gap:10px;align-items:flex-start}
.id-input-area textarea{flex:1}

/* Grid */
.results-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}

/* Card */
.card{background:var(--bg3);border:1px solid var(--bd);border-radius:var(--r);overflow:hidden;transition:all .2s;position:relative}
.card:hover{border-color:rgba(124,92,252,.4);transform:translateY(-2px);box-shadow:var(--sh)}
.card-checkbox{position:absolute;top:12px;left:12px;z-index:10;width:22px;height:22px;cursor:pointer;accent-color:var(--ac)}
.card-image-wrap{width:100%;aspect-ratio:4/3;overflow:hidden;background:var(--bg-in);position:relative;cursor:pointer}
.card-image-wrap img{width:100%;height:100%;object-fit:cover;transition:transform .3s}
.card:hover .card-image-wrap img{transform:scale(1.05)}
.card-no-image{display:flex;align-items:center;justify-content:center;color:var(--t3);font-size:.85rem;height:100%}
.card-body{padding:14px}
.card-title{font-size:1rem;font-weight:600;margin-bottom:6px;line-height:1.3}
.card-title a{color:var(--t1);text-decoration:none} .card-title a:hover{color:var(--ac)}
.card-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.badge-checkpoint{background:rgba(96,165,250,.15);color:var(--blue)}
.badge-lora,.badge-locon,.badge-dora{background:rgba(74,222,128,.15);color:var(--green)}
.badge-controlnet{background:rgba(251,191,36,.15);color:var(--amber)}
.badge-textualinversion{background:rgba(244,114,182,.15);color:var(--pink)}
.badge-vae{background:rgba(34,211,238,.15);color:var(--cyan)}
.badge-upscaler{background:rgba(248,113,113,.15);color:var(--red)}
.badge-other,.badge-workflows,.badge-wildcards,.badge-poses,.badge-hypernetwork,.badge-motionmodule,.badge-detection,.badge-aestheticgradient{background:rgba(152,152,176,.15);color:var(--t2)}
.card-stats{display:flex;gap:12px;font-size:.8rem;color:var(--t2);margin-bottom:8px}
.card-stats span{display:inline-flex;align-items:center;gap:4px}
.card-tags{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px}
.tag{font-size:.7rem;padding:1px 6px;background:rgba(42,42,58,.6);border-radius:3px;color:var(--t2)}
.card-id{font-size:.75rem;color:var(--t3);font-family:monospace}
.card-size{font-size:.78rem;color:var(--amber);font-weight:500}
.version-base{font-size:.72rem;color:var(--t3);padding:1px 6px;background:rgba(42,42,58,.6);border-radius:3px}

/* Card version selector */
.card-version-select{margin-top:10px;border-top:1px solid var(--bd);padding-top:10px}
.card-version-select select{font-size:.82rem;padding:6px 10px}
.card-version-select .version-info{display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:.8rem;color:var(--t2)}

/* Loading / Error */
.loading{text-align:center;padding:40px;color:var(--t2)}
.spinner{display:inline-block;width:32px;height:32px;border:3px solid var(--bd);border-top-color:var(--ac);border-radius:50%;animation:spin .8s linear infinite;margin-bottom:12px}
@keyframes spin{to{transform:rotate(360deg)}}
.error-msg{background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);border-radius:var(--rs);padding:12px 16px;color:var(--red);font-size:.85rem;margin-bottom:16px}
.pagination{display:flex;justify-content:center;gap:8px;margin-top:24px;padding-bottom:20px}

/* ===== Cart Tab ===== */
.cart-empty{text-align:center;padding:60px 20px;color:var(--t3)}
.cart-empty .icon{font-size:3rem;margin-bottom:12px}
.cart-summary{display:flex;gap:20px;align-items:center;padding:16px 20px;background:var(--bg3);border:1px solid var(--bd);border-radius:var(--r);margin-bottom:20px}
.cart-summary .stat{display:flex;flex-direction:column;align-items:center}
.cart-summary .stat-value{font-size:1.4rem;font-weight:700;color:var(--ac)}
.cart-summary .stat-label{font-size:.78rem;color:var(--t3)}
.cart-summary .total-size{color:var(--amber)}
.cart-actions{margin-left:auto;display:flex;gap:8px}

.cart-table{width:100%;border-collapse:collapse}
.cart-table th{text-align:left;padding:10px 12px;font-size:.8rem;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--bd)}
.cart-table td{padding:10px 12px;border-bottom:1px solid rgba(42,42,58,.3);vertical-align:middle}
.cart-table tr:hover{background:rgba(124,92,252,.03)}
.cart-row-img{width:50px;height:50px;border-radius:6px;object-fit:cover;background:var(--bg-in)}
.cart-row-name{font-weight:500;font-size:.9rem}
.cart-row-name a{color:var(--t1);text-decoration:none} .cart-row-name a:hover{color:var(--ac)}
.cart-row-type{display:inline}
.cart-row-version select{font-size:.8rem;padding:4px 8px;min-width:120px}
.cart-row-size{font-weight:600;color:var(--amber);white-space:nowrap}
.cart-row-delete{cursor:pointer;color:var(--t3);font-size:1.1rem;transition:color .15s;background:none;border:none;padding:4px 8px}
.cart-row-delete:hover{color:var(--red)}

.cart-ids-section{margin-top:24px;padding:16px 20px;background:var(--bg3);border:1px solid var(--bd);border-radius:var(--r)}
.cart-ids-section h3{font-size:.9rem;font-weight:600;margin-bottom:10px;color:var(--t2)}
.cart-ids-section textarea{min-height:60px;font-family:'Courier New',monospace;font-size:.85rem}
.cart-ids-section .btn-row{display:flex;gap:8px;margin-top:10px;justify-content:flex-end}

/* Modals */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:200;display:flex;align-items:center;justify-content:center;cursor:zoom-out;opacity:0;visibility:hidden;transition:all .2s}
.modal-overlay.active{opacity:1;visibility:visible}
.modal-overlay img{max-width:90vw;max-height:90vh;border-radius:var(--r);object-fit:contain}
.config-modal{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:200;display:flex;align-items:center;justify-content:center;opacity:0;visibility:hidden;transition:all .2s}
.config-modal.active{opacity:1;visibility:visible}
.config-box{background:var(--bg3);border:1px solid var(--bd);border-radius:var(--r);padding:24px;width:420px;max-width:90vw}
.config-box h2{font-size:1.1rem;margin-bottom:16px}
.config-box .form-group{margin-bottom:16px}
.config-box .form-actions{display:flex;gap:8px;justify-content:flex-end}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--bg3);border:1px solid var(--green);color:var(--green);padding:10px 20px;border-radius:var(--rs);font-size:.85rem;z-index:300;opacity:0;transition:all .3s;pointer-events:none}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

@media(max-width:768px){.results-grid{grid-template-columns:1fr}.filters{flex-direction:column}.header{padding:12px 16px}.main{padding:16px}}
</style>
</head>
<body>

<header class="header">
  <h1>🔍 CivitAI Model Lookup</h1>
  <div class="header-actions">
    <span id="key-status" class="btn btn-sm" style="cursor:default;font-size:.75rem"></span>
    <button class="btn btn-sm" onclick="openConfig()">⚙️ API Key</button>
  </div>
</header>

<nav class="tabs">
  <div class="tab active" data-tab="lookup" onclick="switchTab('lookup')">📋 ID 查询</div>
  <div class="tab" data-tab="search" onclick="switchTab('search')">🔎 搜索</div>
  <div class="tab" data-tab="cart" onclick="switchTab('cart')">🛒 已选模型 <span class="badge-count" id="cart-badge" style="display:none">0</span></div>
</nav>

<main class="main">
  <!-- ID Lookup -->
  <section id="tab-lookup">
    <div class="input-section">
      <label>输入 Model ID（逗号/换行/空格分隔，支持 CivitAI URL）</label>
      <div class="id-input-area">
        <textarea id="id-input" placeholder="例如: 1102, 4384&#10;或: https://civitai.com/models/1102&#10;每行一个或用逗号分隔"></textarea>
        <button class="btn btn-primary" onclick="lookupIds()" id="btn-lookup">查询</button>
      </div>
    </div>
    <div id="lookup-error"></div>
    <div id="lookup-loading" class="loading" style="display:none"><div class="spinner"></div><div>正在查询...</div><div id="lookup-progress" style="margin-top:8px;font-size:.8rem"></div></div>
    <div id="lookup-results" class="results-grid"></div>
  </section>

  <!-- Search -->
  <section id="tab-search" style="display:none">
    <div class="search-bar">
      <input type="text" id="search-input" placeholder="搜索模型名称..." onkeydown="if(event.key==='Enter')searchModels()">
      <button class="btn btn-primary" onclick="searchModels()">搜索</button>
    </div>
    <div class="filters">
      <div class="filter-row">
        <label>类型</label>
        <div class="chip-select" id="filter-type-chips"></div>
      </div>
      <div class="filter-row">
        <label>Base Model</label>
        <div class="chip-select" id="filter-bm-chips" style="max-height:140px;overflow-y:auto"></div>
      </div>
      <div class="filter-row">
        <label>排序</label>
        <select id="filter-sort" style="flex:0 0 auto;width:auto;min-width:160px">
          <option value="Most Downloaded">最多下载</option>
          <option value="Highest Rated">最高评分</option>
          <option value="Newest">最新</option>
          <option value="Relevancy">相关性</option>
        </select>
      </div>
    </div>
    <div id="search-error"></div>
    <div id="search-loading" class="loading" style="display:none"><div class="spinner"></div><div>正在搜索...</div></div>
    <div id="search-results" class="results-grid"></div>
    <div id="search-pagination" class="pagination"></div>
  </section>

  <!-- Cart -->
  <section id="tab-cart" style="display:none">
    <div id="cart-content"></div>
  </section>
</main>

<!-- Image modal -->
<div class="modal-overlay" id="image-modal" onclick="closeImageModal()"><img id="modal-image" src="" alt=""></div>

<!-- Config modal -->
<div class="config-modal" id="config-modal">
  <div class="config-box">
    <h2>⚙️ CivitAI API Key 设置</h2>
    <div class="form-group">
      <label style="font-size:.82rem;color:var(--t2);margin-bottom:10px;display:block">
        API Key 从 <a href="https://civitai.com/user/account" target="_blank" style="color:var(--ac)">CivitAI 账户设置</a> 中生成。
      </label>
      <input type="text" id="config-apikey" placeholder="输入 CivitAI API Key...">
    </div>
    <div class="form-actions">
      <button class="btn btn-sm" onclick="closeConfig()">取消</button>
      <button class="btn btn-sm" onclick="clearApiKey()">清除</button>
      <button class="btn btn-sm btn-primary" onclick="saveConfig()">保存</button>
    </div>
  </div>
</div>
<div class="toast" id="toast"></div>

<script>
// ===================================================================
// Globals
// ===================================================================
const CIVITAI_API_BASE = 'https://civitai.com/api/v1';

let API_KEY = ''; // Fetched from local config
let selectedModels = new Map();
let facetData = {types:{}, baseModels:{}};
let activeTypeFilters = new Set();
let activeBmFilters = new Set();

// ===================================================================
// Init
// ===================================================================
(async function init() {
  await loadApiKey();
  loadCartFromStorage();
  updateCartBadge();
  await loadFacets();
})();

async function loadApiKey() {
  try {
    const r = await fetch('/api/config');
    const d = await r.json();
    API_KEY = d.api_key || '';
    updateKeyStatus(d);
  } catch(e) { console.error('Config load failed', e); }
}

function updateKeyStatus(d) {
  const el = document.getElementById('key-status');
  if (d.has_key) { el.textContent=`🔑 ${d.key_preview}`; el.style.color='var(--green)'; el.style.borderColor='rgba(74,222,128,.3)'; }
  else { el.textContent='🔒 未设置 Key'; el.style.color='var(--t3)'; el.style.borderColor='var(--bd)'; }
}

function getAuthHeaders() {
  const h = {'Content-Type': 'application/json'};
  if (API_KEY) h['Authorization'] = `Bearer ${API_KEY}`;
  return h;
}

// ===================================================================
// Facets (Via Proxy)
// ===================================================================
async function loadFacets() {
  try {
    const r = await fetch('/api/search', { // Proxy endpoint
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        queries: [{
          q: '', indexUid: 'models_v9',
          facets: ['type', 'version.baseModel'],
          limit: 0, filter: ['availability = Public']
        }]
      })
    });
    if (r.ok) {
      const data = await r.json();
      const fd = data.results?.[0]?.facetDistribution || {};
      facetData = { types: fd.type||{}, baseModels: fd['version.baseModel']||{} };
      renderFilterChips();
    } else {
        throw new Error('Proxy error');
    }
  } catch(e) { console.warn('Facets failed', e); renderFallbackFilters(); }
}

function renderFilterChips() {
  const typeContainer = document.getElementById('filter-type-chips');
  const bmContainer = document.getElementById('filter-bm-chips');

  const sortedTypes = Object.entries(facetData.types).sort((a,b) => b[1]-a[1]);
  typeContainer.innerHTML = sortedTypes.map(([name, count]) =>
    `<span class="chip" data-value="${name}" onclick="toggleFilter('type','${name}',this)">${name} <span class="chip-count">${fmtNum(count)}</span></span>`
  ).join('');

  const sortedBm = Object.entries(facetData.baseModels).sort((a,b) => b[1]-a[1]);
  bmContainer.innerHTML = sortedBm.map(([name, count]) =>
    `<span class="chip" data-value="${name}" onclick="toggleFilter('bm','${esc(name)}',this)">${name} <span class="chip-count">${fmtNum(count)}</span></span>`
  ).join('');
}

function renderFallbackFilters() {
  const types = ['LORA','Checkpoint','LoCon','TextualInversion','Workflows','DoRA','Poses','Hypernetwork'];
  const bms = ['Illustrious','SD 1.5','Pony','Flux.1 D','SDXL 1.0','NoobAI','Flux.1 S'];
  document.getElementById('filter-type-chips').innerHTML = types.map(t => `<span class="chip" data-value="${t}" onclick="toggleFilter('type','${t}',this)">${t}</span>`).join('');
  document.getElementById('filter-bm-chips').innerHTML = bms.map(b => `<span class="chip" data-value="${b}" onclick="toggleFilter('bm','${esc(b)}',this)">${b}</span>`).join('');
}

function toggleFilter(kind, value, el) {
  const set = kind === 'type' ? activeTypeFilters : activeBmFilters;
  if (set.has(value)) { set.delete(value); el.classList.remove('active'); }
  else { set.add(value); el.classList.add('active'); }
}

function esc(s) { return s.replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

// ===================================================================
// Tab switching
// ===================================================================
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  ['lookup','search','cart'].forEach(t => {
    document.getElementById('tab-'+t).style.display = t === tab ? '' : 'none';
  });
  if (tab === 'cart') renderCart();
}

// ===================================================================
// ID Lookup (Direct API)
// ===================================================================
function parseIds(text) {
  const items = text.split(/[,\n\r]+/).map(s => s.trim()).filter(Boolean);
  const ids = [];
  for (const item of items) {
    const m = item.match(/\/models\/(\d+)/);
    if (m) { ids.push(m[1]); continue; }
    const nums = item.match(/\d+/g);
    if (nums) nums.forEach(n => ids.push(n));
  }
  return [...new Set(ids)];
}

async function lookupIds() {
  const text = document.getElementById('id-input').value.trim();
  if (!text) return;
  const ids = parseIds(text);
  if (!ids.length) { document.getElementById('lookup-error').innerHTML = '<div class="error-msg">无法解析出有效的 Model ID</div>'; return; }
  
  document.getElementById('lookup-error').innerHTML = '';
  document.getElementById('lookup-results').innerHTML = '';
  document.getElementById('lookup-loading').style.display = '';
  document.getElementById('btn-lookup').disabled = true;

  const results = [];
  for (let i = 0; i < ids.length; i++) {
    document.getElementById('lookup-progress').textContent = `(${i+1}/${ids.length}) ID: ${ids[i]}`;
    try {
      // Direct Fetch
      const r = await fetch(`${CIVITAI_API_BASE}/models/${ids[i]}`, { headers: getAuthHeaders() });
      if (r.ok) results.push(await r.json());
      else { results.push({id:ids[i],_error:`HTTP ${r.status}`}); }
    } catch(e) { results.push({id:ids[i],_error:e.message}); }
    // Rate limit delay
    await new Promise(r => setTimeout(r, 200));
  }
  document.getElementById('lookup-loading').style.display = 'none';
  document.getElementById('btn-lookup').disabled = false;
  renderCards('lookup-results', results, true);
}

// ===================================================================
// Search (Via Proxy)
// ===================================================================
async function searchModels(page = 1) {
  const q = document.getElementById('search-input').value.trim();
  if (!q && activeTypeFilters.size === 0 && activeBmFilters.size === 0) {
    document.getElementById('search-error').innerHTML = '<div class="error-msg">请输入搜索关键词或选择筛选条件</div>'; return;
  }
  document.getElementById('search-error').innerHTML = '';
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-pagination').innerHTML = '';
  document.getElementById('search-loading').style.display = '';

  const sort = document.getElementById('filter-sort').value;
  const limit = 20;
  const offset = (page - 1) * limit;

  const sortMapping = {
    "Relevancy": null,
    "Most Downloaded": "metrics.downloadCount:desc",
    "Highest Rated": "metrics.thumbsUpCount:desc",
    "Newest": "createdAt:desc",
  };
  const meiliSort = sortMapping[sort] || "metrics.downloadCount:desc";
  
  const filterGroups = ["availability = Public"];
  if (activeTypeFilters.size > 0) {
    const arr = Array.from(activeTypeFilters).map(t => `"type"="${t}"`);
    filterGroups.push(arr); // OR group
  }
  if (activeBmFilters.size > 0) {
    const arr = Array.from(activeBmFilters).map(b => `"version.baseModel"="${b}"`);
    filterGroups.push(arr); // OR group
  }

  const query = {
    q: q, indexUid: "models_v9",
    facets: ["type", "version.baseModel"],
    limit: limit, offset: offset,
    filter: filterGroups
  };
  if (meiliSort) query.sort = [meiliSort];

  try {
    const r = await fetch('/api/search', {
      method: "POST",
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({queries: [query]})
    });
    
    if (!r.ok) throw new Error(`Proxy/Meilisearch HTTP ${r.status}`);
    const data = await r.json();
    const result = data.results?.[0];
    
    if (!result || !result.hits) {
      renderCards('search-results', [], false);
      document.getElementById('search-loading').style.display = 'none';
      return;
    }

    // Map Meili format to our card format
    const items = result.hits.map(hit => ({
      id: hit.id,
      name: hit.name,
      type: hit.type,
      tags: hit.tags || [],
      stats: hit.metrics,
      modelVersions: Array.isArray(hit.version) ? hit.version : [hit.version],
      _previewImages: hit.images
    }));
    
    renderCards('search-results', items, false);
    renderPagination({
      currentPage: page,
      totalItems: result.estimatedTotalHits,
      totalPages: Math.ceil(result.estimatedTotalHits / limit),
      nextPage: (offset + limit < result.estimatedTotalHits)
    });
    document.getElementById('search-loading').style.display = 'none';

  } catch(e) { 
    document.getElementById('search-loading').style.display = 'none';
    document.getElementById('search-error').innerHTML = `<div class="error-msg">${e.message}</div>`;
  }
}

function renderPagination(meta) {
  if (!meta) return;
  const c = document.getElementById('search-pagination');
  let h = '';
  if (meta.currentPage > 1) h += `<button class="btn btn-sm" onclick="searchModels(${meta.currentPage-1})">← 上一页</button>`;
  h += `<span class="btn btn-sm" style="cursor:default">第 ${meta.currentPage}/${meta.totalPages} 页 (${fmtNum(meta.totalItems)} 结果)</span>`;
  if (meta.nextPage) h += `<button class="btn btn-sm" onclick="searchModels(${meta.currentPage+1})">下一页 →</button>`;
  c.innerHTML = h;
}

// ===================================================================
// Card Rendering
// ===================================================================
function getTypeBadge(type) {
  const t = (type||'').toLowerCase();
  return 'badge-' + ({'checkpoint':'checkpoint','lora':'lora','locon':'locon','dora':'dora','controlnet':'controlnet','textualinversion':'textualinversion','vae':'vae','upscaler':'upscaler'}[t]||'other');
}

function fmtNum(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return n.toString();
}

function fmtSize(kb) {
  if (!kb) return '—';
  if (kb >= 1048576) return (kb/1048576).toFixed(2)+' GB';
  if (kb >= 1024) return (kb/1024).toFixed(1)+' MB';
  return kb.toFixed(0)+' KB';
}

function getPreviewImage(model) {
  if (model._previewImages?.length) {
    for (const img of model._previewImages) {
      if (img.nsfwLevel <= 4 && img.url) return civitaiImgUrl(img);
    }
    if (model._previewImages[0]?.url) return civitaiImgUrl(model._previewImages[0]);
  }
  for (const v of (model.modelVersions||[])) {
    for (const img of (v.images||[])) { if (img.url) return img.url; }
  }
  return null;
}

function civitaiImgUrl(img) {
  if (!img) return null;
  if (img.url?.startsWith('http')) return img.url;
  // Browser handles direct image link (depends on proxy)
  const id = img.url || img.id;
  if (id) return `https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/${id}/width=450`;
  return null;
}

function getVersionSizeKB(version) {
  if (!version?.files?.length) return 0;
  return version.files.filter(f => f.type === 'Model').reduce((s,f) => s + (f.sizeKB||0), 0)
    || version.files.reduce((s,f) => s + (f.sizeKB||0), 0);
}

function buildVersionList(model) {
  return (model.modelVersions||[]).map(v => ({
    id: v.id, name: v.name || 'v?',
    baseModel: v.baseModel || '',
    sizeKB: getVersionSizeKB(v),
    files: (v.files||[]).map(f => ({name:f.name, sizeKB:f.sizeKB, type:f.type}))
  }));
}

function renderCards(containerId, models, hasFullData) {
  const c = document.getElementById(containerId);
  if (!models.length) { c.innerHTML = '<div class="loading">没有找到结果</div>'; return; }
  let html = '';
  for (const m of models) {
    if (m._error) {
      html += `<div class="card" style="opacity:.6"><div class="card-body"><div class="card-title">❌ Model ID: ${m.id}</div><div class="error-msg" style="margin:0">${m._error}</div></div></div>`;
      continue;
    }
    const imgUrl = getPreviewImage(m);
    const versions = m.modelVersions || [];
    const latestVer = versions[0];
    const baseModel = latestVer?.baseModel || '';
    const sizeKB = hasFullData && latestVer ? getVersionSizeKB(latestVer) : 0;
    const tags = (m.tags||[]).slice(0,6);
    const stats = m.stats || {};
    const checked = selectedModels.has(String(m.id)) ? 'checked' : '';
    const safeName = (m.name||'').replace(/'/g,"\\'").replace(/"/g,'&quot;');
    const dlCount = stats.downloadCount||0;
    const favCount = stats.favoriteCount||stats.thumbsUpCount||0;

    html += `
      <div class="card" data-id="${m.id}">
        <input type="checkbox" class="card-checkbox" ${checked}
          onchange="handleCardSelect(${m.id},this.checked,${hasFullData})">
        <div class="card-image-wrap" onclick="openImage('${(imgUrl||'').replace(/'/g,"\\'")}')">
          ${imgUrl ? `<img src="${imgUrl}" alt="${safeName}" loading="lazy">` : '<div class="card-no-image">No Preview</div>'}
        </div>
        <div class="card-body">
          <div class="card-title"><a href="https://civitai.com/models/${m.id}" target="_blank">${m.name||'Unknown'}</a></div>
          <div class="card-meta">
            <span class="badge ${getTypeBadge(m.type)}">${m.type||'?'}</span>
            ${baseModel ? `<span class="version-base">${baseModel}</span>` : ''}
            <span class="card-id">ID: ${m.id}</span>
            ${sizeKB ? `<span class="card-size">📦 ${fmtSize(sizeKB)}</span>` : ''}
          </div>
          <div class="card-stats">
            <span>⬇ ${fmtNum(dlCount)}</span>
            <span>❤ ${fmtNum(favCount)}</span>
          </div>
          ${tags.length ? `<div class="card-tags">${tags.map(t=>`<span class="tag">${typeof t==='string'?t:t.name||''}</span>`).join('')}</div>` : ''}
          ${hasFullData && versions.length > 1 ? `
            <div class="card-version-select">
              <select onchange="handleCardVersionChange(${m.id},this.value)" id="ver-select-${m.id}">
                ${versions.map(v => `<option value="${v.id}">${v.name||'v?'} — ${v.baseModel||''} — ${fmtSize(getVersionSizeKB(v))}</option>`).join('')}
              </select>
            </div>` : ''}
        </div>
      </div>`;
  }
  c.innerHTML = html;

  for (const m of models) {
    if (!m._error && m.id) {
      c.querySelectorAll(`[data-id="${m.id}"]`).forEach(card => card._modelData = m);
    }
  }
}

// ===================================================================
// Selection / Cart Management (Async Data Fetch)
// ===================================================================
async function handleCardSelect(modelId, checked, hasFullData) {
  const id = String(modelId);
  if (!checked) {
    selectedModels.delete(id);
    saveCartToStorage(); updateCartBadge();
    return;
  }

  let cardEl = document.querySelector(`.card[data-id="${id}"]`);
  let modelData = cardEl?._modelData;

  // Search results don't have file details, need full fetch
  if (!hasFullData || !modelData?.modelVersions?.[0]?.files) {
    try {
      const r = await fetch(`${CIVITAI_API_BASE}/models/${id}`, { headers: getAuthHeaders() });
      if (r.ok) modelData = await r.json();
    } catch(e) {}
  }

  if (!modelData) { showToast('无法获取模型数据'); return; }

  const versions = buildVersionList(modelData);
  const imgUrl = getPreviewImage(modelData);
  const ver = versions[0] || {};
  
  const verSelect = document.getElementById(`ver-select-${id}`);
  let selectedVer = ver;
  if (verSelect) {
    const chosen = versions.find(v => String(v.id) === verSelect.value);
    if (chosen) selectedVer = chosen;
  }

  selectedModels.set(id, {
    name: modelData.name || 'Unknown',
    type: modelData.type || '',
    imageUrl: imgUrl || '',
    selectedVersionId: selectedVer.id,
    selectedVersionName: selectedVer.name,
    baseModel: selectedVer.baseModel,
    sizeKB: selectedVer.sizeKB,
    versions: versions
  });

  saveCartToStorage();
  updateCartBadge();
  showToast(`已添加: ${modelData.name}`);
}

function handleCardVersionChange(modelId, versionId) {
  const id = String(modelId);
  const entry = selectedModels.get(id);
  if (!entry) return;
  const ver = entry.versions.find(v => String(v.id) === String(versionId));
  if (ver) {
    entry.selectedVersionId = ver.id;
    entry.selectedVersionName = ver.name;
    entry.baseModel = ver.baseModel;
    entry.sizeKB = ver.sizeKB;
    saveCartToStorage();
    if (document.getElementById('tab-cart').style.display !== 'none') renderCart();
  }
}

function removeFromCart(modelId) {
  selectedModels.delete(String(modelId));
  document.querySelectorAll(`.card[data-id="${modelId}"] .card-checkbox`).forEach(cb => cb.checked = false);
  saveCartToStorage(); updateCartBadge(); renderCart();
}

function clearCart() {
  selectedModels.clear();
  document.querySelectorAll('.card-checkbox').forEach(cb => cb.checked = false);
  saveCartToStorage(); updateCartBadge(); renderCart();
}

// ===================================================================
// Cart Rendering
// ===================================================================
function renderCart() {
  const container = document.getElementById('cart-content');
  if (selectedModels.size === 0) {
    container.innerHTML = `<div class="cart-empty"><div class="icon">🛒</div><div>还没有选择任何模型</div><div style="margin-top:8px;font-size:.85rem;color:var(--t3)">在「ID 查询」或「搜索」中勾选模型添加到这里</div></div>`;
    return;
  }

  let totalSizeKB = 0;
  const entries = [...selectedModels.entries()];
  entries.forEach(([,v]) => totalSizeKB += (v.sizeKB || 0));

  let html = `
    <div class="cart-summary">
      <div class="stat"><div class="stat-value">${entries.length}</div><div class="stat-label">模型数量</div></div>
      <div class="stat"><div class="stat-value total-size">${fmtSize(totalSizeKB)}</div><div class="stat-label">总磁盘空间</div></div>
      <div class="cart-actions">
        <button class="btn btn-sm btn-danger" onclick="clearCart()">🗑️ 清空</button>
      </div>
    </div>
    <table class="cart-table">
      <thead><tr>
        <th style="width:60px"></th><th>模型</th><th>类型</th><th>版本</th><th>大小</th><th style="width:50px"></th>
      </tr></thead>
      <tbody>`;

  for (const [id, m] of entries) {
    html += `
      <tr>
        <td><img class="cart-row-img" src="${m.imageUrl||''}" alt="" onerror="this.style.display='none'"></td>
        <td class="cart-row-name"><a href="https://civitai.com/models/${id}" target="_blank">${m.name}</a><br><span class="card-id">ID: ${id}</span></td>
        <td><span class="badge ${getTypeBadge(m.type)} cart-row-type">${m.type}</span></td>
        <td class="cart-row-version">
          ${m.versions.length > 1
            ? `<select onchange="cartVersionChange('${id}',this.value)">
                ${m.versions.map(v => `<option value="${v.id}" ${v.id==m.selectedVersionId?'selected':''}>${v.name} (${v.baseModel||'?'})</option>`).join('')}
               </select>`
            : `<span style="font-size:.85rem">${m.selectedVersionName||'—'}</span>`}
        </td>
        <td class="cart-row-size">${fmtSize(m.sizeKB)}</td>
        <td><button class="cart-row-delete" onclick="removeFromCart('${id}')" title="移除">✕</button></td>
      </tr>`;
  }

  html += `</tbody></table>`;

  const idStr = entries.map(([id]) => id).join(',');
  html += `
    <div class="cart-ids-section">
      <h3>📋 Model ID 列表</h3>
      <textarea id="cart-ids-textarea">${idStr}</textarea>
      <div class="btn-row">
        <button class="btn btn-sm" onclick="applyManualIds()">应用修改</button>
        <button class="btn btn-sm" onclick="copyText(document.getElementById('cart-ids-textarea').value)">📋 复制 IDs</button>
        <button class="btn btn-sm btn-primary" onclick="copyText('ALL_MODEL_IDS=&quot;'+document.getElementById('cart-ids-textarea').value+'&quot;')">📋 复制为 ALL_MODEL_IDS</button>
      </div>
    </div>`;

  container.innerHTML = html;
}

function cartVersionChange(modelId, versionId) {
  const entry = selectedModels.get(modelId);
  if (!entry) return;
  const ver = entry.versions.find(v => String(v.id) === String(versionId));
  if (ver) {
    entry.selectedVersionId = ver.id;
    entry.selectedVersionName = ver.name;
    entry.baseModel = ver.baseModel;
    entry.sizeKB = ver.sizeKB;
    saveCartToStorage();
    renderCart(); // re-render to update total size
  }
}

async function applyManualIds() {
  const text = document.getElementById('cart-ids-textarea').value.trim();
  const ids = parseIds(text);
  for (const existingId of [...selectedModels.keys()]) {
    if (!ids.includes(existingId)) selectedModels.delete(existingId);
  }
  for (const id of ids) {
    if (!selectedModels.has(id)) {
      try {
        const r = await fetch(`${CIVITAI_API_BASE}/models/${id}`, { headers: getAuthHeaders() });
        if (r.ok) {
          const data = await r.json();
          const versions = buildVersionList(data);
          const ver = versions[0] || {};
          selectedModels.set(id, {
            name: data.name||'Unknown', type: data.type||'',
            imageUrl: getPreviewImage(data)||'',
            selectedVersionId: ver.id, selectedVersionName: ver.name,
            baseModel: ver.baseModel, sizeKB: ver.sizeKB, versions
          });
        }
      } catch(e) {}
    }
  }
  saveCartToStorage(); updateCartBadge(); renderCart();
  showToast('ID 列表已更新');
}

function updateCartBadge() {
  const badge = document.getElementById('cart-badge');
  const count = selectedModels.size;
  badge.textContent = count;
  badge.style.display = count > 0 ? '' : 'none';
}

// ===================================================================
// LocalStorage persistence
// ===================================================================
function saveCartToStorage() {
  const data = {};
  for (const [id, v] of selectedModels) data[id] = v;
  try { localStorage.setItem('civitai_cart', JSON.stringify(data)); } catch(e) {}
}

function loadCartFromStorage() {
  try {
    const raw = localStorage.getItem('civitai_cart');
    if (!raw) return;
    const data = JSON.parse(raw);
    for (const [id, v] of Object.entries(data)) selectedModels.set(id, v);
  } catch(e) {}
}

// ===================================================================
// UI Helpers
// ===================================================================
function openImage(url) { if (!url) return; document.getElementById('modal-image').src=url; document.getElementById('image-modal').classList.add('active'); }
function closeImageModal() { document.getElementById('image-modal').classList.remove('active'); }
document.addEventListener('keydown', e => { if (e.key==='Escape') { closeImageModal(); closeConfig(); } });

function openConfig() { document.getElementById('config-modal').classList.add('active'); }
function closeConfig() { document.getElementById('config-modal').classList.remove('active'); }
async function saveConfig() {
  const key = document.getElementById('config-apikey').value.trim();
  await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:key})});
  closeConfig(); await loadApiKey(); showToast('API Key 已保存');
  setTimeout(()=>window.location.reload(), 1000); // Reload to re-fetch facets/data with new key
}
async function clearApiKey() {
  document.getElementById('config-apikey').value='';
  await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:''})});
  closeConfig(); await loadApiKey(); showToast('API Key 已清除');
  setTimeout(()=>window.location.reload(), 1000);
}
function copyText(text) { navigator.clipboard.writeText(text).then(() => showToast('已复制到剪贴板')); }
function showToast(msg) { const el=document.getElementById('toast'); el.textContent=msg; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2500); }
</script>
</body>
</html>
'''

if __name__ == "__main__":
    import webbrowser
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    if os.environ.get("CIVITAI_TOKEN") and not _get_api_key():
        CONFIG_FILE.write_text(json.dumps({"api_key": os.environ["CIVITAI_TOKEN"]}))
        print(f"  📝 已从环境变量 CIVITAI_TOKEN 导入 API Key")
    print(f"\n{'='*50}")
    print(f"  🔍 CivitAI Model Lookup Tool")
    print(f"  访问地址: http://localhost:{port}")
    print(f"{'='*50}\n")
    # threading.Timer(1.5, lambda: webbrowser.open(f"http://localhost:{port}")).start()
    app.run(host="0.0.0.0", port=port, debug=False)
