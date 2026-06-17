/* INCYT Spikes dashboard — client-side decrypt + render. No external libs. */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PRIO = { P0: { c: 'var(--p0)', label: 'P0 · critical' }, P1: { c: 'var(--p1)', label: 'P1 · high' }, P2: { c: 'var(--p2)', label: 'P2 · normal' }, P3: { c: 'var(--p3)', label: 'P3 · later' } };
const PRIO_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };
const CS = { built: 'Built', partial: 'Partial', explored: 'Explored', none: 'Net-new' };
const BUCKETS = [['decide', 'Decide', '#04a1ff'], ['send', 'Send', '#a7deff'], ['spend', 'Spend', '#ffc24b'], ['platform', 'Platform', '#5fd39a'], ['physical', 'Physical', '#fe5b07']];
const ROLE = {
  Marinto: 'AI eng + software dev', Luke: 'HW / systems — REMOTE', Jonah: 'Industrial design / branding',
  Corey: 'PM / coordination / outreach', Cain: 'Robotics / AI', Linus: 'All-round', Thomas: 'Machines / laser',
  Katie: 'Sales', Unassigned: 'Needs an owner',
};

let DATA = null;
const state = { q: '', owner: '', status: '', prios: new Set(), rtg: 'all', group: 'owner', sort: 'ai' };
const review = location.hash.toLowerCase().includes('review') || location.search.toLowerCase().includes('review');

/* ---------------- decryption ---------------- */
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decryptPayload(payload, passphrase) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64(payload.salt), iterations: payload.iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(payload.iv) }, key, b64(payload.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

async function unlock(passphrase) {
  const res = await fetch('data/tasks.enc', { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load data file.');
  const payload = await res.json();
  const data = await decryptPayload(payload, passphrase); // throws on wrong passphrase
  sessionStorage.setItem('incyt_pp', passphrase);
  return data;
}

/* ---------------- RTG local overlay ---------------- */
const rtgKey = 'incyt_rtg_overrides';
const loadOverrides = () => { try { return JSON.parse(localStorage.getItem(rtgKey) || '{}'); } catch { return {}; } };
const saveOverrides = (o) => localStorage.setItem(rtgKey, JSON.stringify(o));
function isRTG(t) { if (!review) return !!t.rtg; const o = loadOverrides(); return o[t.id] != null ? o[t.id] : !!t.rtg; }

/* ---------------- helpers ---------------- */
const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
function filtered() {
  return DATA.tasks.filter((t) => {
    if (state.owner && t.owner !== state.owner) return false;
    if (state.status && t.companyStatus !== state.status) return false;
    if (state.prios.size && !state.prios.has(t.priority)) return false;
    if (state.rtg === 'rtg' && !isRTG(t)) return false;
    if (state.rtg === 'wait' && isRTG(t)) return false;
    if (state.q) {
      const hay = `${t.id} ${t.title} ${t.owner} ${t.fastestNextStep} ${t.gate}`.toLowerCase();
      if (!hay.includes(state.q.toLowerCase())) return false;
    }
    return true;
  });
}
function sortTasks(list) {
  const s = state.sort;
  return [...list].sort((a, b) => {
    if (s === 'ai') return (b.aiPercent || 0) - (a.aiPercent || 0);
    if (s === 'prio') return (PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority]) || ((b.aiPercent || 0) - (a.aiPercent || 0));
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });
}

/* ---------------- markdown (compact) ---------------- */
function mdInline(s) {
  return s
    .replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
      const safe = /^(https?:|\/|\.|#|mailto:)/i.test(u) ? u : '#';
      return `<a href="${safe}" target="_blank" rel="noopener">${t}</a>`;
    });
}
function md(src) {
  if (!src) return '';
  const L = esc(src).split('\n');
  let html = '', i = 0;
  const isBlock = (s) => /^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>|\||---)/.test(s);
  while (i < L.length) {
    let line = L[i];
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < L.length && /-/.test(L[i + 1]) && /^\s*\|?[\s:|-]+\|?\s*$/.test(L[i + 1])) {
      const head = line; const rows = []; i += 2;
      while (i < L.length && /\|/.test(L[i]) && L[i].trim() !== '') { rows.push(L[i]); i++; }
      const cells = (r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      html += '<table><thead><tr>' + cells(head).map((c) => `<th>${mdInline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + cells(r).map((c) => `<td>${mdInline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
      continue;
    }
    let h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const lv = Math.min(h[1].length + 1, 4); html += `<h${lv}>${mdInline(h[2])}</h${lv}>`; i++; continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { html += '<hr>'; i++; continue; }
    if (/^\s*>\s?/.test(line)) { const b = []; while (i < L.length && /^\s*>\s?/.test(L[i])) { b.push(L[i].replace(/^\s*>\s?/, '')); i++; } html += `<blockquote>${mdInline(b.join(' '))}</blockquote>`; continue; }
    if (/^\s*[-*+]\s+/.test(line)) { const b = []; while (i < L.length && /^\s*[-*+]\s+/.test(L[i])) { b.push(L[i].replace(/^\s*[-*+]\s+/, '')); i++; } html += '<ul>' + b.map((x) => `<li>${mdInline(x)}</li>`).join('') + '</ul>'; continue; }
    if (/^\s*\d+\.\s+/.test(line)) { const b = []; while (i < L.length && /^\s*\d+\.\s+/.test(L[i])) { b.push(L[i].replace(/^\s*\d+\.\s+/, '')); i++; } html += '<ol>' + b.map((x) => `<li>${mdInline(x)}</li>`).join('') + '</ol>'; continue; }
    if (line.trim() === '') { i++; continue; }
    const b = [line]; i++;
    while (i < L.length && L[i].trim() !== '' && !isBlock(L[i])) { b.push(L[i]); i++; }
    html += `<p>${mdInline(b.join(' '))}</p>`;
  }
  return html;
}

/* ---------------- detail slide-over ---------------- */
function openDetail(id) {
  const t = DATA.tasks.find((x) => x.id === id); if (!t) return;
  const d = t.detail || {};
  const rtg = isRTG(t);
  const sect = (title, body, cls = '') => (body && body.trim()) ? `<div class="sect ${cls}"><h3>${title}</h3><div class="md">${md(body)}</div></div>` : '';
  const arts = d.artifacts || [];
  const artHtml = arts.length ? `<div class="sect"><h3>Artifacts in work/ (${d.artifactCount || arts.length})</h3><div class="artlist">` +
    arts.map((a) => { const ext = (a.name.split('.').pop() || '?').slice(0, 4); return `<div class="art"><span class="ext">${esc(ext)}</span><span class="nm">${esc(a.name)}</span><span class="pth">${esc(a.path)}</span></div>`; }).join('') +
    `</div>${(d.artifactCount || 0) > arts.length ? `<div class="art-note">+${d.artifactCount - arts.length} more in the repo</div>` : ''}</div>` : '';
  $('#sheet-body').innerHTML = `
    <div class="sheet-id">${esc(t.id)}</div>
    <h2>${esc(t.title)}</h2>
    <div class="sheet-chips">
      <span class="pill prio" data-p="${esc(t.priority)}"><span class="dt"></span>${esc(t.priority)}</span>
      <span class="pill owner">${esc(t.owner)}</span>
      <span class="pill cs-${esc(t.companyStatus)}">${esc(CS[t.companyStatus] || t.companyStatus)}</span>
      ${t.rescope ? '<span class="pill rescope">⚠ extend, not build</span>' : ''}
      ${rtg ? '<span class="pill rtg-yes"><span class="dt"></span>RTG</span>' : '<span class="pill rtg-no">◌ awaiting review</span>'}
    </div>
    <div class="sheet-ai"><div class="ai-track"><div class="ai-fill" style="width:${t.aiPercent || 0}%"></div></div><span class="ai-val"><b>${t.aiPercent || 0}%</b> AI</span></div>
    ${t.gate ? `<div class="sheet-gate">⛓ <b>Gate:</b> ${esc(t.gate)}</div>` : ''}
    ${t.fastestNextStep ? `<div class="sect key"><h3>★ Fastest next step</h3><div class="md">${md(t.fastestNextStep)}</div></div>` : ''}
    ${sect('Best next steps', d.bestNextSteps, 'key')}
    ${sect('Residual — humans only', d.residual, 'warn-sect')}
    ${sect('AI-completed work', d.aiCompleted)}
    ${artHtml}
    ${sect('Objective', d.objective)}
    ${sect('Recommended approach / options', d.recommended)}
    ${sect('Research findings', d.research)}
    ${sect('Company knowledge — deep dive', d.companyKnowledge)}
    <div class="sheet-foot">Full brief + all files in the repo: <code>${esc(d.briefPath || '')}</code></div>`;
  const sh = $('#sheet');
  sh.classList.add('open'); sh.setAttribute('aria-hidden', 'false'); sh.scrollTop = 0;
  $('#sheet-backdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
  if (history.replaceState) history.replaceState(null, '', '#' + id);
}
function closeDetail() {
  $('#sheet').classList.remove('open'); $('#sheet').setAttribute('aria-hidden', 'true');
  $('#sheet-backdrop').classList.remove('open'); document.body.style.overflow = '';
  if (history.replaceState && /^#[A-Z]/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
}

/* ---------------- rendering ---------------- */
function card(t) {
  const rtg = isRTG(t);
  const cs = t.companyStatus;
  const buckets = BUCKETS.filter(([k]) => (t.buckets?.[k] || 0) > 0)
    .map(([k, lab]) => `<span class="bbadge">${lab} <b>${t.buckets[k]}</b></span>`).join('');
  const verdictPill = t.reviewVerdict && t.reviewVerdict !== 'pass'
    ? `<span class="pill verdict-${esc(t.reviewVerdict)}">${t.reviewVerdict === 'revised' ? '📝 revised' : '🚩 flag'}</span>` : '';
  const reviewBtn = review
    ? `<button class="rtg-toggle ${rtg ? 'on' : ''}" data-id="${esc(t.id)}">${rtg ? '✓ RTG' : 'mark RTG'}</button>` : '';
  return `<article class="card ${rtg ? 'rtg' : ''}" data-id="${esc(t.id)}">
    <div class="c-top">
      <span class="c-id">${esc(t.id)}</span>
      <span class="spacer"></span>
      ${rtg ? '<span class="pill rtg-yes"><span class="dt"></span>RTG</span>' : '<span class="pill rtg-no">◌ awaiting</span>'}
    </div>
    <div class="c-title">${esc(t.title)}</div>
    <div class="c-chips">
      <span class="pill prio" data-p="${esc(t.priority)}"><span class="dt"></span>${esc(t.priority)}</span>
      <span class="pill owner">${esc(t.owner)}</span>
      <span class="pill cs-${esc(cs)}">${esc(CS[cs] || cs)}</span>
      ${t.rescope ? '<span class="pill rescope">⚠ extend, not build</span>' : ''}
      ${verdictPill}
    </div>
    <div class="ai-row">
      <div class="ai-track"><div class="ai-fill" style="width:${t.aiPercent || 0}%"></div></div>
      <span class="ai-val"><b>${t.aiPercent || 0}%</b> AI</span>
    </div>
    ${t.fastestNextStep ? `<div class="c-step"><span class="lab">Fastest next step</span>${esc(t.fastestNextStep)}</div>` : ''}
    ${t.gate ? `<div class="c-gate">⛓ <b>Gate:</b> ${esc(t.gate)}</div>` : ''}
    ${buckets ? `<div class="c-buckets">${buckets}</div>` : ''}
    <div class="c-foot"><span class="open-hint">Open details →</span>${reviewBtn ? `<span class="spacer" style="flex:1"></span>${reviewBtn}` : ''}</div>
  </article>`;
}

function groupBy(list) {
  if (state.group === 'none') return [['All tasks', list]];
  if (state.group === 'priority') {
    return ['P0', 'P1', 'P2', 'P3'].map((p) => [PRIO[p].label, list.filter((t) => t.priority === p)]).filter((g) => g[1].length);
  }
  // by owner — order by task count desc
  const owners = [...new Set(list.map((t) => t.owner))];
  return owners.map((o) => [o, list.filter((t) => t.owner === o)]).sort((a, b) => b[1].length - a[1].length);
}

function render() {
  const list = sortTasks(filtered());
  const groups = groupBy(list);
  const cl = $('#count-line');
  const rtgCount = list.filter(isRTG).length;
  cl.innerHTML = `Showing <b>${list.length}</b> of <b>${DATA.tasks.length}</b> tasks · <b>${rtgCount}</b> RTG · avg <b>${avg(list.map((t) => t.aiPercent || 0))}%</b> AI-complete`;
  const res = $('#results');
  if (!list.length) { res.innerHTML = '<div class="empty">No tasks match these filters.</div>'; return; }
  res.innerHTML = groups.map(([name, items]) => {
    if (!items.length) return '';
    const role = state.group === 'owner' && ROLE[name] ? `<span class="grole">${ROLE[name]}</span>` : '';
    return `<section class="group">
      <div class="group-head"><h3>${esc(name)}</h3>${role}<span class="spacer" style="flex:1"></span>
      <span class="gmeta">${items.length} task${items.length > 1 ? 's' : ''} · ${items.filter(isRTG).length} RTG</span></div>
      <div class="grid">${items.map(card).join('')}</div>
    </section>`;
  }).join('');
  // wire review toggles + brief links
  $$('.rtg-toggle').forEach((b) => b.onclick = () => {
    const o = loadOverrides(); const id = b.dataset.id;
    o[id] = !isRTG(DATA.tasks.find((t) => t.id === id)); saveOverrides(o); render(); renderAids(); renderStats();
  });
  $$('#results .card').forEach((c) => c.onclick = (e) => { if (e.target.closest('button')) return; openDetail(c.dataset.id); });
}

function renderStats() {
  const t = DATA.tasks;
  const rtg = t.filter(isRTG).length;
  $('#top-stats').innerHTML = `
    <div class="stat"><b>${t.length}</b><span>tasks</span></div>
    <div class="stat accent"><b>${avg(t.map((x) => x.aiPercent || 0))}%</b><span>avg AI</span></div>
    <div class="stat live"><b>${rtg}</b><span>RTG</span></div>
    <div class="stat"><b>${DATA.meta?.owners?.length || new Set(t.map((x) => x.owner)).size}</b><span>owners</span></div>`;
}

function donut(parts, total) {
  let acc = 0; const stops = [];
  parts.forEach(([, , color, val]) => {
    const from = (acc / total) * 360, to = ((acc + val) / total) * 360; acc += val;
    stops.push(`${color} ${from}deg ${to}deg`);
  });
  return `conic-gradient(${stops.join(',')})`;
}

function renderAids() {
  const t = DATA.tasks;
  // bucket totals
  const bt = BUCKETS.map(([k, lab, c]) => [k, lab, c, t.reduce((s, x) => s + (x.buckets?.[k] || 0), 0)]);
  const btTotal = bt.reduce((s, b) => s + b[3], 0) || 1;
  const donutCss = donut(bt, btTotal);
  const legend = bt.map(([, lab, c, v]) => `<div><i style="background:${c}"></i><span>${lab}</span> <b>${v}</b></div>`).join('');
  // owner load
  const owners = (DATA.meta?.owners || [...new Set(t.map((x) => x.owner))].map((n) => ({ name: n, taskCount: t.filter((x) => x.owner === n).length })))
    .slice().sort((a, b) => b.taskCount - a.taskCount);
  const maxO = Math.max(...owners.map((o) => o.taskCount), 1);
  const ownerBars = owners.map((o) => `<div class="barrow"><span class="lab">${esc(o.name)}</span>
    <div class="track"><div class="fill" style="width:${(o.taskCount / maxO) * 100}%"></div></div><span class="val">${o.taskCount}</span></div>`).join('');
  // priority distribution
  const pr = ['P0', 'P1', 'P2', 'P3'].map((p) => [p, t.filter((x) => x.priority === p).length]);
  const maxP = Math.max(...pr.map((x) => x[1]), 1);
  const prBars = pr.map(([p, n]) => `<div class="barrow"><span class="lab" style="color:${PRIO[p].c}">${p}</span>
    <div class="track"><div class="fill" style="width:${(n / maxP) * 100}%;background:${PRIO[p].c}"></div></div><span class="val">${n}</span></div>`).join('');
  // rtg progress
  const rtg = t.filter(isRTG).length, pct = Math.round((rtg / t.length) * 100);

  $('#aids').innerHTML = `
    <div class="aid"><h3>Residual actions by type</h3>
      <div class="donut-wrap"><div class="donut" style="background:${donutCss}" data-total="${btTotal}">
        <div style="position:absolute;inset:14px;border-radius:999px;background:var(--ink-900)"></div></div>
        <div class="donut-legend">${legend}</div></div></div>
    <div class="aid"><h3>Tasks by owner</h3>${ownerBars}</div>
    <div class="aid"><h3>Priority mix</h3>${prBars}</div>
    <div class="aid"><h3>Review progress</h3><div class="big">${rtg}<span style="font-size:18px;color:var(--ink-500)"> / ${t.length}</span></div>
      <div class="sub">items marked RTG (${pct}%)</div>
      <div class="ai-track" style="margin-top:12px"><div class="ai-fill" style="width:${pct}%;background:var(--live)"></div></div>
      <div class="sub" style="margin-top:8px">avg AI-complete: <b style="color:var(--brand);font-family:var(--mono)">${avg(t.map((x) => x.aiPercent || 0))}%</b></div></div>`;
}

/* ---------------- controls wiring ---------------- */
function wire() {
  $('#q').oninput = (e) => { state.q = e.target.value; render(); };
  const sel = $('#f-owner');
  const owners = (DATA.meta?.owners?.map((o) => o.name)) || [...new Set(DATA.tasks.map((t) => t.owner))];
  owners.forEach((o) => { const opt = document.createElement('option'); opt.value = o; opt.textContent = o; sel.appendChild(opt); });
  sel.onchange = (e) => { state.owner = e.target.value; render(); };
  $('#f-status').onchange = (e) => { state.status = e.target.value; render(); };
  $('#f-sort').onchange = (e) => { state.sort = e.target.value; render(); };
  $$('#f-prio .pchip').forEach((b) => b.onclick = () => {
    const p = b.dataset.p; b.classList.toggle('on');
    state.prios.has(p) ? state.prios.delete(p) : state.prios.add(p); render();
  });
  $$('#f-rtg button').forEach((b) => b.onclick = () => {
    $$('#f-rtg button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); state.rtg = b.dataset.v; render();
  });
  $$('#f-group button').forEach((b) => b.onclick = () => {
    $$('#f-group button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); state.group = b.dataset.v; render();
  });
  if (review) {
    document.body.classList.add('review');
    $('#rtg-export').onclick = exportRTG;
    $('#rtg-clear').onclick = () => { localStorage.removeItem(rtgKey); render(); renderAids(); renderStats(); toast('RTG overrides reset'); };
  }
}

function exportRTG() {
  const o = loadOverrides();
  const merged = {};
  DATA.tasks.forEach((t) => { merged[t.id] = o[t.id] != null ? o[t.id] : !!t.rtg; });
  const blob = new Blob([JSON.stringify(merged, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'rtg-state.json'; a.click();
  navigator.clipboard?.writeText(JSON.stringify(merged)).catch(() => {});
  toast('Exported rtg-state.json — send it to Kate to bake in & redeploy');
}

let toastT;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3200); }

function boot(data) {
  DATA = data;
  $('#gate').style.display = 'none';
  $('#app').classList.add('show');
  wire(); renderStats(); renderAids(); render();
  $('#sheet-close').onclick = closeDetail;
  $('#sheet-backdrop').onclick = closeDetail;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });
  // deep-link: #<TASK-ID> opens that task
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (h && DATA.tasks.some((t) => t.id === h)) openDetail(h);
}

/* ---------------- gate ---------------- */
$('#gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#gate-err'); err.textContent = '';
  const pp = $('#gate-input').value.trim();
  if (!pp) return;
  const btn = $('#gate-form button'); btn.textContent = 'Unlocking…'; btn.disabled = true;
  try { boot(await unlock(pp)); }
  catch (ex) { err.textContent = 'Incorrect passphrase — try again.'; $('#gate-input').value = ''; $('#gate-input').focus(); }
  finally { btn.textContent = 'Unlock'; btn.disabled = false; }
});

// auto-unlock within a session
(async () => {
  const saved = sessionStorage.getItem('incyt_pp');
  if (!saved) return;
  try { boot(await unlock(saved)); } catch { sessionStorage.removeItem('incyt_pp'); }
})();
