// Studio Director, stage 9: the full-page map (docs/STUDIO_DIRECTOR.md §5.12).
// Pure: the memory graph in, one self-contained HTML page out (no network, no
// libraries): a mind map around one node with pan, zoom, fold, search and a
// node's details on a click. It holds rule names from the memory folder, so the
// caller writes it outside git (the graph's own folder under ~/.claude/projects).
import type { Graph } from './graph'
import { sourceOf } from './recall'
import { BRANCHES } from './map'

/** The graph as the page's data: nodes and links by index, the clusters, the branch table. */
export function mapData(g: Graph): string {
  const ids = [...g.nodes.keys()]
  const index = new Map(ids.map((id, i) => [id, i]))
  const nodes = ids.map(id => {
    const n = g.nodes.get(id)
    if (!n) return null
    return [n.id, n.label, n.kind, sourceOf(n), (n.text ?? '').slice(0, 400), n.at ?? '', n.status ?? '', g.cluster.get(id) ?? -1]
  })
  const edges = g.edges.flatMap(e => {
    const a = index.get(e.from)
    const b = index.get(e.to)
    return a === undefined || b === undefined ? [] : [[a, b, e.rel, e.conf, e.score, e.label ?? '', e.source]]
  })
  const clusters = g.clusters.map(c => ({ name: c.name, size: c.size, top: c.top.map(id => index.get(id) ?? -1).filter(i => i >= 0) }))
  const branches = BRANCHES.map(b => ({ key: b.key, label: b.label, side: b.side, kinds: b.kinds, order: b.order }))
  return JSON.stringify({ nodes, edges, clusters, branches, builtAt: g.builtAt }).replace(/</g, '\\u003c')
}

const STYLE = `
:root { --bg:#fbfaf7; --card:#ffffff; --text:#2c2c2a; --muted:#6b6a65; --line:#c9c7be; --left:#0f6e56; --right:#993c1d; --center:#534ab7; --hl:#fac775; --border:#e3e1d8; }
@media (prefers-color-scheme: dark) { :root { --bg:#1c1c1a; --card:#262624; --text:#ecebe6; --muted:#a9a7a0; --line:#5f5e5a; --left:#5dcaa5; --right:#f0997b; --center:#7f77dd; --hl:#854f0b; --border:#3a3a37; } }
* { box-sizing: border-box; }
body { margin:0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background:var(--bg); color:var(--text); height:100vh; display:flex; flex-direction:column; }
header { display:flex; gap:8px; align-items:center; padding:8px 12px; border-bottom:1px solid var(--border); flex-wrap:wrap; }
header input { padding:6px 8px; border:1px solid var(--border); border-radius:6px; background:var(--card); color:var(--text); width:260px; }
button { padding:5px 10px; border:1px solid var(--border); border-radius:6px; background:var(--card); color:var(--text); cursor:pointer; }
button:hover { border-color:var(--muted); }
#crumbs { color:var(--muted); font-size:13px; }
#crumbs a { color:var(--text); cursor:pointer; text-decoration:underline; }
main { flex:1; display:flex; min-height:0; }
#stage { flex:1; position:relative; overflow:hidden; cursor:grab; }
#stage.drag { cursor:grabbing; }
svg { position:absolute; left:0; top:0; }
aside { width:360px; border-left:1px solid var(--border); padding:12px; overflow:auto; font-size:13px; background:var(--card); }
aside h2 { font-size:15px; margin:0 0 6px; }
aside .k { color:var(--muted); }
aside li { margin:3px 0; }
aside a { color:var(--text); cursor:pointer; }
#results { position:absolute; top:44px; left:12px; z-index:2; background:var(--card); border:1px solid var(--border); border-radius:6px; max-height:50vh; overflow:auto; display:none; min-width:320px; }
#results div { padding:5px 10px; cursor:pointer; font-size:13px; }
#results div:hover { background:var(--bg); }
.legend { color:var(--muted); font-size:12px; margin-left:auto; }
@media (max-width: 760px) { main { flex-direction:column; } aside { width:auto; height:40vh; border-left:none; border-top:1px solid var(--border); } header input { width:100%; } }
`

// The page's script: plain JS, no template literals (it lives inside one here).
const SCRIPT = `
var D = window.STUDIO_MAP;
var N = D.nodes, E = D.edges;
var byId = {}; N.forEach(function (n, i) { if (n) byId[n[0]] = i; });
var adj = N.map(function () { return []; });
E.forEach(function (e, k) { adj[e[0]].push(k); adj[e[1]].push(k); });
var AROUND = { topic: 1, milestone: 1, workstream: 1 };
var state = { focus: 'home', trail: [], open: {}, scale: 1, x: 0, y: 0, sel: null };
var svgNS = 'http://www.w3.org/2000/svg';

function other(k, i) { var e = E[k]; return e[0] === i ? e[1] : e[0]; }
function near(i) {
  var best = {};
  function add(j, k) { if (j === i) return; if (best[j] === undefined || E[k][4] > E[best[j]][4]) best[j] = k; }
  adj[i].forEach(function (k) { add(other(k, i), k); });
  if (AROUND[N[i][2]]) {
    adj[i].forEach(function (k) {
      var j = other(k, i), e = E[k];
      if (N[j][2] === 'workstream' && e[2] === 'part-of' && e[1] === i) adj[j].forEach(function (k2) { add(other(k2, j), k2); });
    });
    Object.keys(best).forEach(function (j) {
      j = +j; if (N[j][2] !== 'chat') return;
      var via = best[j];
      adj[j].forEach(function (k2) { var o = other(k2, j); if (N[o][2] === 'ask' || N[o][2] === 'commit') add(o, via); });
    });
  }
  return Object.keys(best).map(function (j) { return { i: +j, k: best[j] }; });
}
function view(focus) {
  if (focus === 'home') {
    return { label: 'Studio', kind: 'home', branches: D.clusters.slice(0, 12).map(function (c, b) {
      return { key: 'c' + b, label: c.name, side: b % 2 ? 'right' : 'left', items: c.top.map(function (i) { return { i: i, k: -1 }; }), total: c.size };
    }) };
  }
  var i = byId[focus], list = near(i), seen = {}, out = [];
  D.branches.forEach(function (b) {
    var items = list.filter(function (x) { return b.kinds.indexOf(N[x.i][2]) >= 0 && !seen[x.i]; });
    items.sort(function (p, q) {
      var dt = (N[q.i][5] || '').localeCompare(N[p.i][5] || ''), ds = E[q.k][4] - E[p.k][4];
      return b.order === 'newest' ? (dt || ds) : (ds || dt);
    });
    if (!items.length) return;
    items.forEach(function (x) { seen[x.i] = 1; });
    out.push({ key: b.key, label: b.label, side: b.side, items: items, total: items.length });
  });
  return { label: N[i][1], kind: N[i][2], branches: out };
}
function el(tag, attrs, text) {
  var e = document.createElementNS(svgNS, tag);
  for (var a in attrs) e.setAttribute(a, attrs[a]);
  if (text !== undefined) e.textContent = text;
  return e;
}
function clip(s, n) { return s.length <= n ? s : s.slice(0, n - 1) + '\\u2026'; }
function colour(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function draw() {
  var v = view(state.focus);
  var stage = document.getElementById('stage');
  var old = stage.querySelector('svg'); if (old) old.remove();
  var ROW = 20, BOX = 150, PER = 6;
  function shown(b) { return state.open[state.focus + '/' + b.key] ? b.items : b.items.slice(0, PER); }
  function rows(bs) { return bs.reduce(function (s, b) { return s + Math.max(1, shown(b).length + (b.items.length > shown(b).length ? 1 : 0)) + 1; }, 0); }
  var L = v.branches.filter(function (b) { return b.side === 'left'; }), R = v.branches.filter(function (b) { return b.side === 'right'; });
  var H = Math.max(rows(L), rows(R), 4) * ROW + 40, W = 1400, cx = W / 2, cy = H / 2;
  var cw = Math.min(260, Math.max(110, v.label.length * 8 + 30));
  var svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H });
  var g = el('g', {}); svg.appendChild(g);
  [['left', L, -1], ['right', R, 1]].forEach(function (s) {
    var bs = s[1], sign = s[2], total = rows(bs), y = cy - total * ROW / 2 + ROW / 2;
    var bx = sign < 0 ? cx - cw / 2 - 50 - BOX : cx + cw / 2 + 50, col = colour(sign < 0 ? '--left' : '--right');
    bs.forEach(function (b) {
      var items = shown(b), n = Math.max(1, items.length + (b.items.length > items.length ? 1 : 0)), by = y + (n - 1) * ROW / 2;
      var from = cx + sign * cw / 2, to = sign < 0 ? bx + BOX : bx, mid = (from + to) / 2;
      g.appendChild(el('path', { d: 'M' + from + ' ' + cy + ' C ' + mid + ' ' + cy + ', ' + mid + ' ' + by + ', ' + to + ' ' + by, fill: 'none', stroke: colour('--line'), 'stroke-width': 1.6 }));
      var bg = el('g', { style: 'cursor:pointer' });
      bg.appendChild(el('title', {}, (state.open[state.focus + '/' + b.key] ? 'Fold ' : 'Unfold ') + b.label));
      bg.appendChild(el('rect', { x: bx, y: by - 11, width: BOX, height: 22, rx: 5, fill: col }));
      bg.appendChild(el('text', { x: bx + BOX / 2, y: by + 4, 'font-size': 12.5, 'text-anchor': 'middle', fill: '#fff' }, clip(b.label + ' (' + b.total + ')', 22)));
      bg.addEventListener('click', function (ev) { ev.stopPropagation(); var key = state.focus + '/' + b.key; state.open[key] = !state.open[key]; draw(); });
      g.appendChild(bg);
      var lx = sign < 0 ? bx - 16 : bx + BOX + 16;
      items.forEach(function (x, k) {
        var iy = y + k * ROW, sx = sign < 0 ? bx : bx + BOX, m2 = (sx + lx) / 2;
        var conf = x.k >= 0 ? E[x.k][3] : 'extracted';
        var dash = conf === 'extracted' ? '' : conf === 'ambiguous' ? '1.5 3' : '5 3';
        g.appendChild(el('path', { d: 'M' + sx + ' ' + by + ' C ' + m2 + ' ' + by + ', ' + m2 + ' ' + iy + ', ' + lx + ' ' + iy, fill: 'none', stroke: col, 'stroke-opacity': 0.6, 'stroke-width': 1.3, 'stroke-dasharray': dash }));
        var nd = N[x.i], label = nd[2] === 'section' ? nd[3].split(':')[0].split('/').pop() + ' \\u00a7' + nd[1] : nd[1];
        var t = el('text', { x: sign < 0 ? lx - 4 : lx + 4, y: iy + 4, 'font-size': 12.5, 'text-anchor': sign < 0 ? 'end' : 'start', fill: colour('--text'), style: 'cursor:pointer' }, clip(label, 44));
        if (state.sel === x.i) t.setAttribute('font-weight', 'bold');
        t.appendChild(el('title', {}, label + ' (' + nd[2] + ') \\u00b7 ' + nd[3]));
        t.addEventListener('click', function (ev) { ev.stopPropagation(); select(x.i); });
        t.addEventListener('dblclick', function (ev) { ev.stopPropagation(); go(nd[0]); });
        g.appendChild(t);
      });
      if (b.items.length > items.length) {
        var my = y + items.length * ROW;
        var more = el('text', { x: sign < 0 ? lx - 4 : lx + 4, y: my + 4, 'font-size': 12, 'text-anchor': sign < 0 ? 'end' : 'start', fill: colour('--muted'), style: 'cursor:pointer' }, '+' + (b.items.length - items.length) + ' more');
        more.addEventListener('click', function (ev) { ev.stopPropagation(); state.open[state.focus + '/' + b.key] = true; draw(); });
        g.appendChild(more);
      }
      y += (n + 1) * ROW;
    });
  });
  var c = el('g', {});
  c.appendChild(el('rect', { x: cx - cw / 2, y: cy - 18, width: cw, height: 36, rx: 18, fill: colour('--center') }));
  c.appendChild(el('text', { x: cx, y: cy + 5, 'font-size': 15, 'font-weight': 'bold', 'text-anchor': 'middle', fill: '#fff' }, clip(v.label, 30)));
  g.appendChild(c);
  g.setAttribute('transform', 'translate(' + state.x + ',' + state.y + ') scale(' + state.scale + ')');
  svg.style.width = '100%'; svg.style.height = '100%';
  svg.setAttribute('width', stage.clientWidth); svg.setAttribute('height', stage.clientHeight);
  svg.setAttribute('viewBox', '0 0 ' + stage.clientWidth + ' ' + stage.clientHeight);
  if (state.fit) { state.fit = false; state.scale = Math.min(1.2, stage.clientWidth / W, stage.clientHeight / H); state.x = (stage.clientWidth - W * state.scale) / 2; state.y = (stage.clientHeight - H * state.scale) / 2; g.setAttribute('transform', 'translate(' + state.x + ',' + state.y + ') scale(' + state.scale + ')'); }
  stage.appendChild(svg);
  crumbs();
}
function crumbs() {
  var c = document.getElementById('crumbs'); c.innerHTML = '';
  var home = document.createElement('a'); home.textContent = 'Studio'; home.onclick = function () { go('home'); }; c.appendChild(home);
  state.trail.forEach(function (id) {
    c.appendChild(document.createTextNode(' \\u203a '));
    var a = document.createElement('a'); a.textContent = clip(N[byId[id]][1], 28); a.onclick = function () { go(id); }; c.appendChild(a);
  });
}
function go(id) {
  if (id === 'home') state.trail = [];
  else { var at = state.trail.indexOf(id); state.trail = at >= 0 ? state.trail.slice(0, at + 1) : state.trail.concat([id]).slice(-12); }
  state.focus = id; state.fit = true; if (id !== 'home') select(byId[id], true); draw();
}
function select(i, quiet) {
  state.sel = i;
  var n = N[i], a = document.getElementById('details'), h = [];
  a.innerHTML = '';
  var t = document.createElement('h2'); t.textContent = n[1]; a.appendChild(t);
  function line(k, v) { if (!v) return; var p = document.createElement('div'); var s = document.createElement('span'); s.className = 'k'; s.textContent = k + ': '; p.appendChild(s); p.appendChild(document.createTextNode(v)); a.appendChild(p); }
  line('kind', n[2]); line('source', n[3]); line('when', n[5]); line('status', n[6]);
  if (n[7] >= 0 && D.clusters[n[7]]) line('cluster', D.clusters[n[7]].name);
  if (n[4]) { var p = document.createElement('p'); p.textContent = n[4]; a.appendChild(p); }
  var f = document.createElement('button'); f.textContent = 'Put this in the middle'; f.onclick = function () { go(n[0]); }; a.appendChild(f);
  var ul = document.createElement('ul');
  adj[i].slice().sort(function (p, q) { return E[q][4] - E[p][4]; }).slice(0, 60).forEach(function (k) {
    var e = E[k], j = other(k, i), li = document.createElement('li'), l = document.createElement('a');
    l.textContent = N[j][1]; l.onclick = function () { select(j); };
    li.appendChild(document.createTextNode((e[0] === i ? e[2] + ' \\u2192 ' : '\\u2190 ' + e[2] + ' ') ));
    li.appendChild(l);
    li.appendChild(document.createTextNode(' (' + N[j][2] + ', ' + (e[3] === 'extracted' ? 'stated' : e[3] === 'ambiguous' ? 'unsure' : 'guessed ' + e[4]) + (e[5] ? ', "' + e[5] + '"' : '') + ')'));
    ul.appendChild(li);
  });
  var lh = document.createElement('div'); lh.className = 'k'; lh.textContent = adj[i].length + ' links'; a.appendChild(lh); a.appendChild(ul);
  if (!quiet) draw();
}
var q = document.getElementById('q'), res = document.getElementById('results');
q.addEventListener('input', function () {
  var s = q.value.trim().toLowerCase(); res.innerHTML = '';
  if (s.length < 2) { res.style.display = 'none'; return; }
  var hits = [];
  N.forEach(function (n, i) { if (!n) return; var l = n[1].toLowerCase(); var r = l === s ? 0 : l.indexOf(s) === 0 ? 1 : l.indexOf(s) >= 0 ? 2 : n[4].toLowerCase().indexOf(s) >= 0 ? 3 : 9; if (r < 9) hits.push([r, -adj[i].length, i]); });
  hits.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  hits.slice(0, 30).forEach(function (h) { var d = document.createElement('div'); d.textContent = N[h[2]][1] + ' (' + N[h[2]][2] + ')'; d.onclick = function () { res.style.display = 'none'; q.value = ''; go(N[h[2]][0]); }; res.appendChild(d); });
  res.style.display = hits.length ? 'block' : 'none';
});
var stage = document.getElementById('stage'), drag = null;
stage.addEventListener('mousedown', function (e) { drag = { x: e.clientX - state.x, y: e.clientY - state.y }; stage.classList.add('drag'); });
window.addEventListener('mouseup', function () { drag = null; stage.classList.remove('drag'); });
window.addEventListener('mousemove', function (e) { if (!drag) return; state.x = e.clientX - drag.x; state.y = e.clientY - drag.y; var g = stage.querySelector('svg > g'); if (g) g.setAttribute('transform', 'translate(' + state.x + ',' + state.y + ') scale(' + state.scale + ')'); });
function zoom(f, px, py) { var r = stage.getBoundingClientRect(); px = px === undefined ? r.width / 2 : px; py = py === undefined ? r.height / 2 : py; state.x = px - (px - state.x) * f; state.y = py - (py - state.y) * f; state.scale *= f; draw(); }
stage.addEventListener('wheel', function (e) { e.preventDefault(); var r = stage.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
document.getElementById('zin').onclick = function () { zoom(1.2); };
document.getElementById('zout').onclick = function () { zoom(1 / 1.2); };
document.getElementById('fit').onclick = function () { state.fit = true; draw(); };
document.getElementById('home').onclick = function () { go('home'); };
window.addEventListener('resize', function () { state.fit = true; draw(); });
state.fit = true; draw();
`

/** The whole page: the data, the style and the script inline. */
export function mapHtml(g: Graph, built: string): string {
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Studio map</title>',
    `<style>${STYLE}</style></head><body>`,
    '<header><button id="home">Studio</button><input id="q" placeholder="Search the graph (a topic, a rule, a chat…)" autocomplete="off">',
    '<button id="zin" aria-label="Zoom in">+</button><button id="zout" aria-label="Zoom out">−</button><button id="fit">Fit</button>',
    '<span id="crumbs"></span>',
    `<span class="legend">solid: a file says it · dashed: guessed · dotted: unsure · click a name for its details, double-click to centre it, click a branch to fold · built ${built}</span>`,
    '</header><div id="results"></div>',
    '<main><div id="stage"></div><aside id="details"><h2>Studio map</h2><p class="k">The director’s memory graph. Pick a name on the map, or search.</p></aside></main>',
    `<script>window.STUDIO_MAP = ${mapData(g)};</script>`,
    `<script>${SCRIPT}</script>`,
    '</body></html>',
  ].join('\n')
}
