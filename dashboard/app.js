/* ============================================================
   METERLY DASHBOARD — APP.JS
   All values come from the live backend API via NGINX.
   The frontend never calculates billing or pricing.
   ============================================================ */

'use strict';

// ─── CONFIG ─────────────────────────────────────────────────
const API_BASE    = '';             // same origin — routed by NGINX
const AUTH_TOKEN  = 'demo-token';   // matches DEV_AUTH_TOKEN in .env
const PRICING     = {               // display-only decomposition, not billing
  freshInput:  300,
  cachedInput: 30,
  output:      1500,
};

// ─── STATE ──────────────────────────────────────────────────
let state = {
  planName:   null,
  jobPoller:  null,
  lastJobId:  null,
};

// ─── BOOT ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initOverview();
  initPlayground();
  initBilling();
  initEvents();
  resetSystemFlow();
});

// ─── NAVIGATION ─────────────────────────────────────────────
const PAGE_TITLES = {
  overview:   'Overview',
  playground: 'AI Playground',
  flow:       'System Flow',
  billing:    'Billing',
  events:     'Usage Events',
};

function initNavigation() {
  const nav = document.getElementById('sidebarNav');
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    switchPage(btn.dataset.target);
  });
}

function switchPage(target) {
  // Update nav items
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.target === target);
  });

  // Update pages
  document.querySelectorAll('.page').forEach(page => {
    page.classList.toggle('page--active', page.id === `page-${target}`);
  });

  // Update topbar title
  const title = document.getElementById('pageTitle');
  if (title) title.textContent = PAGE_TITLES[target] ?? target;
}

// ─── API HELPER ─────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const headers = {
    'Authorization': `Bearer ${AUTH_TOKEN}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const b = await res.json(); msg = b.message || msg; } catch (_) {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ─── TOAST ──────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ─── FORMATTING ─────────────────────────────────────────────
function fmtNum(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(1) + 'K';
  return v.toLocaleString();
}

function fmtMicrocents(mc) {
  if (mc == null) return '—';
  const v = Number(mc);
  const dollars = v / 100_000_000;
  if (dollars < 0.001) return `${v.toLocaleString()} µ¢`;
  return `$${dollars.toFixed(6)}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

// ─── HELPERS ────────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '—';
}

function setBadge(id, label, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = label;
  el.className = `badge${cls ? ' ' + cls : ''}`;
}

function setConn(status) {
  const el = document.getElementById('connectionStatus');
  const lbl = el.querySelector('.conn-label');
  el.className = `conn-badge ${status}`;
  const map = { connected: 'Connected', error: 'API Error', connecting: 'Connecting…' };
  lbl.textContent = map[status] ?? status;
}

function setProgress(id, used, limit) {
  const el = document.getElementById(id);
  if (!el) return;
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  el.style.width = `${pct}%`;
  el.className = 'progress-fill';
  if (pct >= 95) el.classList.add('danger');
  else if (pct >= 75) el.classList.add('warn');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══ OVERVIEW ═══════════════════════════════════════════════

function initOverview() {
  document.getElementById('btnRefresh').addEventListener('click', loadOverview);
  loadOverview();
}

async function loadOverview() {
  const icon = document.getElementById('refreshIcon');
  icon.classList.add('spinning');

  try {
    const data = await apiFetch('/api/usage');
    setConn('connected');
    renderOverview(data);
  } catch (err) {
    icon.classList.remove('spinning');

    if (err.status === 402) {
      setConn('connected');
      setText('tenantName', 'Demo Tenant');
      setBadge('planBadge', 'FREE', 'plan-free');
      setBadge('statusBadge', 'No Subscription', 'status-error');
      setText('periodValue', 'Run seed script');
      setText('metricApiUsed', '0');
      setText('metricApiLimit', '1,000 limit');
      setText('metricApiRemaining', 'Seed DB to activate');
      setProgress('progressApiCalls', 0, 100);
      setText('metricTokenUsed', '0');
      setText('metricTokenLimit', '100,000 limit');
      setText('metricTokenRemaining', 'Seed DB to activate');
      setProgress('progressAiTokens', 0, 100);
      setText('metricCostTotal', '$0.00');
      setText('costApiCalls', '$0.00');
      setText('costAiTokens', '$0.00');
      showToast('No subscription found — run: node database/seed.js', 'error');
      return;
    }

    setConn('error');
    showToast(`Overview failed: ${err.message}`, 'error');
    setText('tenantName', 'Demo Tenant');
    setBadge('planBadge', '—', '');
    setBadge('statusBadge', 'API Error', 'status-error');
  } finally {
    icon.classList.remove('spinning');
  }
}

function renderOverview(data) {
  setText('tenantName', 'Demo Tenant');

  const plan = data.plan?.name ?? 'unknown';
  state.planName = plan;
  setBadge('planBadge', plan.toUpperCase(), `plan-${plan}`);
  setBadge('statusBadge', 'Active', 'status-active');

  const pStart = data.period?.start ? new Date(data.period.start).toLocaleDateString('en-IN') : '—';
  const pEnd   = data.period?.end   ? new Date(data.period.end).toLocaleDateString('en-IN')   : '—';
  setText('periodValue', `${pStart} – ${pEnd}`);

  // API Calls
  const apiUsed  = Number(data.usage?.apiCalls ?? 0);
  const apiLimit = Number(data.plan?.apiCallLimit ?? 0);
  const apiRem   = Number(data.remaining?.apiCalls ?? 0);
  setText('metricApiUsed', fmtNum(apiUsed));
  setText('metricApiLimit', `${fmtNum(apiLimit)} limit`);
  setText('metricApiRemaining', `${fmtNum(apiRem)} remaining`);
  setProgress('progressApiCalls', apiUsed, apiLimit);

  // AI Tokens
  const tokUsed  = Number(data.usage?.aiTokens ?? 0);
  const tokLimit = Number(data.plan?.aiTokenLimit ?? 0);
  const tokRem   = Number(data.remaining?.aiTokens ?? 0);
  setText('metricTokenUsed', fmtNum(tokUsed));
  setText('metricTokenLimit', `${fmtNum(tokLimit)} limit`);
  setText('metricTokenRemaining', `${fmtNum(tokRem)} remaining`);
  setProgress('progressAiTokens', tokUsed, tokLimit);

  // Cost — from backend only, no frontend math
  const cost     = data.cost ?? {};
  setText('metricCostTotal', fmtMicrocents(cost.total ?? 0));
  setText('costApiCalls',    fmtMicrocents(cost.apiCalls ?? 0));
  setText('costAiTokens',    fmtMicrocents(cost.aiTokens ?? 0));

  updateBillingPlan(plan);
}

// ═══ PLAYGROUND ═════════════════════════════════════════════

function initPlayground() {
  document.getElementById('btnGenKey').addEventListener('click', generateKey);
  document.getElementById('btnGenerate').addEventListener('click', handleGenerate);
  generateKey();
}

function generateKey() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const key = 'req_' + Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  document.getElementById('idempotencyKeyInput').value = key;
}

async function handleGenerate() {
  const prompt = document.getElementById('promptInput').value.trim();
  const idempotencyKey = document.getElementById('idempotencyKeyInput').value.trim();

  if (!prompt)         { showToast('Please enter a prompt', 'error'); return; }
  if (!idempotencyKey) { showToast('Idempotency key is required', 'error'); return; }

  const btn   = document.getElementById('btnGenerate');
  const label = document.getElementById('generateLabel');
  btn.disabled = true;
  label.textContent = 'Submitting…';

  // Show job panel
  document.getElementById('jobEmpty').classList.add('hidden');
  document.getElementById('jobResult').classList.remove('hidden');
  document.getElementById('jobDetail').classList.add('hidden');
  document.getElementById('errorWrap').classList.add('hidden');
  document.getElementById('aiOutputWrap').classList.remove('hidden');

  setText('jobId', '…');
  setText('jobIdempKey', idempotencyKey);
  setText('jobDuplicate', '…');

  // Animate system flow
  activateFlow('browser', 'POST /api/ai/generate');
  await delay(140);
  activateFlow('nginx', 'Forwarding to Express');
  await delay(140);
  activateFlow('express', 'POST /api/ai/generate received');
  await delay(140);
  activateFlow('auth', 'Bearer token accepted');
  await delay(140);
  activateFlow('idempotency', `Key: ${idempotencyKey}`);
  await delay(140);
  activateFlow('quota', 'Checking token quota…');

  resetPipeline();
  setPipe('queued', 'active');

  try {
    const job = await apiFetch('/api/ai/generate', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ prompt, maxOutputTokens: 256 }),
    });

    const isDuplicate = job.status !== 'queued';
    setText('jobId', job.jobId);
    setText('jobDuplicate', isDuplicate ? 'Yes — cached result returned' : 'No — new request');

    state.lastJobId = job.jobId;
    doneFlow('db', 'Job row inserted');

    if (isDuplicate) {
      showJobComplete(job, true);
    } else {
      label.textContent = 'Polling…';
      pollJob(job.jobId);
    }
  } catch (err) {
    btn.disabled = false;
    label.textContent = 'Generate AI Response';
    setPipe('queued', 'failed');
    failFlow('quota', err.message);
    showToast(`Generate failed: ${err.message}`, 'error');
    document.getElementById('errorWrap').classList.remove('hidden');
    setText('errorMsg', err.message);
    document.getElementById('jobDetail').classList.remove('hidden');
  }
}

function pollJob(jobId) {
  if (state.jobPoller) clearInterval(state.jobPoller);

  setPipe('queued', 'done');
  setPipe('processing', 'active');
  activateFlow('worker', 'Picked up from queue');

  let elapsed = 0;
  const MAX   = 45_000;
  const TICK  = 1_500;

  state.jobPoller = setInterval(async () => {
    elapsed += TICK;
    if (elapsed > MAX) {
      clearInterval(state.jobPoller);
      setPipe('processing', 'failed');
      showToast('Job timed out after 45 seconds', 'error');
      const btn = document.getElementById('btnGenerate');
      btn.disabled = false;
      document.getElementById('generateLabel').textContent = 'Generate AI Response';
      return;
    }
    try {
      const job = await apiFetch(`/api/ai/jobs/${jobId}`);
      if (job.status === 'completed' || job.status === 'failed') {
        clearInterval(state.jobPoller);
        showJobComplete(job, false);
      }
    } catch (_) { /* keep polling on transient error */ }
  }, TICK);
}

function showJobComplete(job, duplicate) {
  const btn   = document.getElementById('btnGenerate');
  const label = document.getElementById('generateLabel');
  btn.disabled = false;
  label.textContent = 'Generate AI Response';

  if (job.status === 'completed') {
    setPipe('processing', 'done');
    setPipe('provider',   'done');
    setPipe('metering',   'done');
    setPipe('done',       'active');

    doneFlow('groq',      'Completion received');
    doneFlow('tokens',    `In: ${job.usage?.inputTokens ?? 0}  Out: ${job.usage?.outputTokens ?? 0}`);
    doneFlow('cost',      `${fmtNum(job.costMicrocents)} µ¢`);
    doneFlow('event',     'Usage event persisted');
    doneFlow('complete',  'Status → completed');
    doneFlow('dashboard', 'Poll returned result');
    setTimeout(() => setPipe('done', 'done'), 500);

    // Token breakdown
    const u = job.usage ?? {};
    setText('detailInputTokens',    String(u.inputTokens       ?? 0));
    setText('detailCachedTokens',   String(u.cachedInputTokens ?? 0));
    setText('detailOutputTokens',   String(u.outputTokens      ?? 0));
    setText('detailReasoningTokens',String(u.reasoningTokens   ?? 0));

    // Cost decomposition (display only — sourced from job total)
    const inCost  = (u.inputTokens ?? 0) * PRICING.freshInput;
    const cacCost = (u.cachedInputTokens ?? 0) * PRICING.cachedInput;
    const outCost = ((u.outputTokens ?? 0) + (u.reasoningTokens ?? 0)) * PRICING.output;
    setText('detailInputCost',  inCost.toLocaleString());
    setText('detailCachedCost', cacCost.toLocaleString());
    setText('detailOutputCost', outCost.toLocaleString());
    setText('detailTotalCost',  Number(job.costMicrocents ?? 0).toLocaleString());

    setText('aiOutput', job.output ?? '(no text output returned)');

    document.getElementById('jobDetail').classList.remove('hidden');
    document.getElementById('errorWrap').classList.add('hidden');

    showToast(duplicate ? 'Idempotent: cached result returned' : 'AI generation complete!', 'success');
    setTimeout(loadOverview, 800);
    setTimeout(loadEvents, 1000);

  } else if (job.status === 'failed') {
    setPipe('processing', 'failed');
    failFlow('groq', job.error ?? 'Provider error');
    setText('errorMsg', job.error ?? 'Job failed');
    document.getElementById('errorWrap').classList.remove('hidden');
    document.getElementById('aiOutputWrap').classList.add('hidden');
    document.getElementById('jobDetail').classList.remove('hidden');
    showToast(`Job failed: ${job.error}`, 'error');
  }
}

// Pipeline
function resetPipeline() {
  ['queued','processing','provider','metering','done'].forEach(s => {
    const el = document.getElementById(`pipe-${s}`);
    if (el) el.className = 'pipe-step';
  });
}
function setPipe(step, cls) {
  const el = document.getElementById(`pipe-${step}`);
  if (el) el.className = `pipe-step ${cls}`;
}

// System flow
const FLOW_IDS = ['browser','nginx','express','auth','idempotency','quota','db','worker','groq','tokens','cost','event','complete','dashboard'];

function resetSystemFlow() {
  FLOW_IDS.forEach(id => {
    const el = document.getElementById(`flow-${id}`);
    if (el) el.className = 'flow-node flow-node-idle';
  });
}

function activateFlow(id, detail) {
  const el = document.getElementById(`flow-${id}`);
  if (!el) return;
  el.className = 'flow-node active';
  const d = document.getElementById(`flow-${id}-detail`);
  if (d && detail) d.textContent = detail;
}

function doneFlow(id, detail) {
  const el = document.getElementById(`flow-${id}`);
  if (!el) return;
  el.className = 'flow-node done';
  const d = document.getElementById(`flow-${id}-detail`);
  if (d && detail) d.textContent = detail;
}

function failFlow(id, detail) {
  const el = document.getElementById(`flow-${id}`);
  if (!el) return;
  el.className = 'flow-node failed';
  const d = document.getElementById(`flow-${id}-detail`);
  if (d && detail) d.textContent = detail;
}

// ═══ BILLING ════════════════════════════════════════════════

function initBilling() {
  document.getElementById('btnUpgrade').addEventListener('click', handleUpgrade);
}

function updateBillingPlan(plan) {
  const name  = document.getElementById('currentPlanLabel');
  const label = document.getElementById('upgradeLabel');
  if (name) name.textContent = plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : '—';

  const freeCard = document.getElementById('planFreeCard');
  const proCard  = document.getElementById('planProCard');
  const btn      = document.getElementById('btnUpgrade');

  if (!freeCard || !proCard) return;

  if (plan?.toLowerCase() === 'pro') {
    freeCard.classList.remove('current-plan');
    proCard.classList.add('current-plan');
    if (btn)   btn.disabled = true;
    if (label) label.textContent = 'Already on Pro';
  } else {
    freeCard.classList.add('current-plan');
    proCard.classList.remove('current-plan');
    if (btn)   btn.disabled = false;
    if (label) label.textContent = 'Upgrade to Pro';
  }
}

async function handleUpgrade() {
  const btn   = document.getElementById('btnUpgrade');
  const label = document.getElementById('upgradeLabel');
  btn.disabled = true;
  if (label) label.textContent = 'Creating checkout…';

  try {
    const data = await apiFetch('/api/billing/checkout', { method: 'POST' });
    if (data.checkoutUrl) {
      document.getElementById('billingSuccess').classList.remove('hidden');
      showToast('Opening Stripe Checkout…', 'success');
      setTimeout(() => { window.location.href = data.checkoutUrl; }, 600);
    } else {
      throw new Error('No checkout URL returned');
    }
  } catch (err) {
    btn.disabled = false;
    if (label) label.textContent = 'Upgrade to Pro';
    showToast(`Checkout failed: ${err.message}`, 'error');
  }
}

// ═══ USAGE EVENTS ═══════════════════════════════════════════

function initEvents() {
  document.getElementById('btnRefreshEvents').addEventListener('click', loadEvents);
  loadEvents();
}

async function loadEvents() {
  try {
    const data = await apiFetch('/api/usage');
    renderEventsFromUsage(data);
  } catch (_) { /* silently fail — overview shows errors */ }
}

function renderEventsFromUsage(data) {
  const tbody = document.getElementById('eventsTableBody');
  if (!tbody) return;

  const usage = data.usage ?? {};
  const cost  = data.cost  ?? {};
  const rows  = [];

  if (Number(usage.aiTokens) > 0) {
    rows.push({
      ts:   new Date().toISOString(),
      type: 'ai_tokens',
      qty:  `${fmtNum(usage.aiTokens)} tokens`,
      cost: fmtMicrocents(cost.aiTokens ?? 0),
      key:  '(period aggregate)',
      id:   '—',
    });
  }

  if (Number(usage.apiCalls) > 0) {
    rows.push({
      ts:   new Date().toISOString(),
      type: 'api_call',
      qty:  `${fmtNum(usage.apiCalls)} calls`,
      cost: fmtMicrocents(cost.apiCalls ?? 0),
      key:  '(period aggregate)',
      id:   '—',
    });
  }

  if (rows.length === 0) {
    tbody.innerHTML = `<tr class="table-empty"><td colspan="6">No usage events this period. Generate a request above.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${fmtTime(r.ts)}</td>
      <td style="font-family:var(--mono);font-size:10px">${r.id}</td>
      <td><span class="type-chip ${r.type === 'ai_tokens' ? 'type-ai' : 'type-api'}">${r.type === 'ai_tokens' ? 'AI Tokens' : 'API Call'}</span></td>
      <td style="font-family:var(--mono);font-size:10px">${r.qty}</td>
      <td style="font-family:var(--mono);font-size:10px">${r.cost}</td>
      <td style="font-family:var(--mono);font-size:9px;color:var(--text-3)">${r.key}</td>
    </tr>
  `).join('');
}
