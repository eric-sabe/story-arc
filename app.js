/* ============================================================================
   STORY ARC — narrative-curve authoring tool
   ----------------------------------------------------------------------------
   A dependency-free, SVG-first editor for composing cinematic narrative curves.

   Code map (search these banners):
     [MODEL]     default scene + scene helpers
     [GEOMETRY]  coordinate transforms + cubic-Bezier path generation
     [SVG]       static SVG scaffold (layers, filters)
     [RENDER]    build + update of scene layers and editor overlay
     [VIEW]      zoom / pan via viewBox
     [EDIT]      pointer interactions (select, drag anchors/handles)
     [UI]        control panel wiring
     [EXPORT]    SVG + PNG export
     [IO]        save / load / autosave
   All curve geometry lives in NORMALIZED space (x:0..1 left→right,
   y:0..1 bottom→top). Screen mapping happens only at render time.
============================================================================ */

(() => {
'use strict';

const NS = 'http://www.w3.org/2000/svg';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const uid = (p = 'id') => p + '-' + Math.random().toString(36).slice(2, 9);
const clone = (o) => JSON.parse(JSON.stringify(o));

// --- defensive coercion helpers (used by normalizeScene to harden loaded JSON) ---
const num = (v, d = 0) => { const n = +v; return Number.isFinite(n) ? n : d; };
const toArray = (v) => (Array.isArray(v) ? v : []);
const SAFE_ID = /^[A-Za-z0-9_-]+$/; // ids are interpolated into element ids + CSS selectors
// Return a safe, unique id: keep it only if it's already selector-safe and unused,
// otherwise mint a fresh one. Records the result in `used` to guarantee uniqueness.
function safeId(raw, prefix, used) {
  let id = (typeof raw === 'string' && SAFE_ID.test(raw) && !used.has(raw)) ? raw : uid(prefix);
  while (used.has(id)) id = uid(prefix);
  used.add(id);
  return id;
}

/* ============================================================================
   [MODEL] Default scene
   ----------------------------------------------------------------------------
   Anchors are {x,y} in normalized space. hIn/hOut are absolute normalized
   handle positions; when omitted they are derived on load (spline mode).
   To tweak the starter geometry, edit the `anchors` arrays below (or the
   companion scene-default.json, which mirrors this).
============================================================================ */

const a = (x, y) => ({ x, y }); // shorthand for an anchor without explicit handles

/* The scene is modeled as TWO COUPLED PHASES sharing one artboard:
     • Phase 1 "primary crucible"  — left ~57% (Excitement → Mastery)
     • Phase 2 "post-mastery"      — right ~43%, itself two coupled movements:
         - the DECLINE track (complacency / erosion) on the upper band
         - the RENEWAL subsystem (a nested mini-crucible) on the lower band
   `regions` defines the handoff x, the focal branch node, and the split visuals.
   Every Phase-2 curve is a first-class curve object (same anchors+Bézier model
   as the primaries), grouped via `curve.group`. To tweak geometry, edit the
   `anchors` arrays below; scene-default.json mirrors this. */

const DEFAULT_SCENE = {
  meta: { name: 'The Crucible Curve', version: 2 },
  artboard: {
    width: 1920,
    height: 1080,
    padding: { top: 150, right: 120, bottom: 120, left: 130 },
    background: { color: '#05070d', haze: true, vignette: true },
  },
  style: {
    gridX: 12,
    gridY: 8,
    gridColor: '#2a3556',
    gridOpacity: 0.18,
    axisColor: '#5b6b94',
    guideColor: '#33406a',
    labelColor: '#8fa0c8',
  },
  // Phase-1 → Phase-2 handoff. branch.{x,y} is the focal fork node sitting on
  // the mature-state plateau, from which decline and renewal diverge.
  regions: {
    branchX: 0.605,
    branch: { x: 0.605, y: 0.89, show: true },
    divider: true,
    tint: true,
  },
  milestones: [
    // ---- Phase 1: primary crucible (labels on the axis, full-height guides) ----
    { id: uid('ms'), label: 'Excitement',       x: 0.04, showGuide: true,  phase: 'primary', group: 'primary' },
    { id: uid('ms'), label: 'Reality Friction', x: 0.17, showGuide: true,  phase: 'primary', group: 'primary' },
    { id: uid('ms'), label: 'Persistence',      x: 0.31, showGuide: true,  phase: 'primary', group: 'primary' },
    { id: uid('ms'), label: 'Proficiency',      x: 0.45, showGuide: true,  phase: 'primary', group: 'primary' },
    { id: uid('ms'), label: 'Mastery',          x: 0.57, showGuide: true,  phase: 'primary', group: 'primary' },

    // ---- Phase 2: section captions (optional, colored, placed by y) ----
    { id: uid('ms'), label: 'COMPLACENCY',           x: 0.80, y: 0.99, showGuide: false, phase: 'post', group: 'decline', optional: true, color: '#22d3ee' },
    { id: uid('ms'), label: 'RENEWING THE CRUCIBLE', x: 0.77, y: 0.40, showGuide: false, phase: 'post', group: 'renewal', optional: true, color: '#ffb24d' },

    // ---- Phase 2: decline track (mid-upper band) ----
    { id: uid('ms'), label: 'Comfort',     x: 0.66, y: 0.50, showGuide: false, phase: 'post', group: 'decline' },
    { id: uid('ms'), label: 'Bureaucracy', x: 0.75, y: 0.50, showGuide: false, phase: 'post', group: 'decline' },
    { id: uid('ms'), label: 'Stagnation',  x: 0.84, y: 0.50, showGuide: false, phase: 'post', group: 'decline' },
    { id: uid('ms'), label: 'Decline',     x: 0.95, y: 0.50, showGuide: false, phase: 'post', group: 'decline' },

    // ---- Phase 2: renewal subsystem (lower band) ----
    { id: uid('ms'), label: 'New Cost',              x: 0.70, y: 0.30, showGuide: false, phase: 'post', group: 'renewal' },
    { id: uid('ms'), label: 'New Resistance',        x: 0.79, y: 0.30, showGuide: false, phase: 'post', group: 'renewal' },
    { id: uid('ms'), label: 'Temporary Dip',         x: 0.87, y: 0.30, showGuide: false, phase: 'post', group: 'renewal' },
    { id: uid('ms'), label: 'Future Value Creation', x: 0.96, y: 0.30, showGuide: false, phase: 'post', group: 'renewal' },
  ],
  curves: [
    // ============ PHASE 1 — primary crucible (Excitement → Mastery) ============
    {
      id: uid('c'), name: 'Cost', color: '#ff7a2f', strokeWidth: 5,
      glow: 16, opacity: 1, blendMode: 'screen', visible: true, locked: false,
      smoothing: 'spline', highlight: true, group: 'primary',
      anchors: [ a(0.02,0.02), a(0.12,0.10), a(0.17,0.78), a(0.28,0.42), a(0.40,0.14), a(0.52,0.05), a(0.60,0.03) ],
    },
    {
      id: uid('c'), name: 'Resistance', color: '#3f8cff', strokeWidth: 5,
      glow: 16, opacity: 1, blendMode: 'screen', visible: true, locked: false,
      smoothing: 'spline', highlight: true, group: 'primary',
      anchors: [ a(0.0,0.04), a(0.10,0.28), a(0.17,0.72), a(0.24,0.54), a(0.30,0.62), a(0.37,0.52), a(0.44,0.40), a(0.52,0.18), a(0.60,0.08) ],
    },
    {
      id: uid('c'), name: 'Confidence', color: '#22d3ee', strokeWidth: 5,
      glow: 16, opacity: 1, blendMode: 'screen', visible: true, locked: false,
      smoothing: 'spline', highlight: true, group: 'primary',
      anchors: [ a(0.0,0.82), a(0.11,0.50), a(0.20,0.30), a(0.30,0.46), a(0.42,0.70), a(0.52,0.85), a(0.60,0.90) ],
    },
    {
      id: uid('c'), name: 'Value', color: '#ffc93c', strokeWidth: 5,
      glow: 16, opacity: 1, blendMode: 'screen', visible: true, locked: false,
      smoothing: 'spline', highlight: true, group: 'primary',
      anchors: [ a(0.0,0.02), a(0.16,0.06), a(0.30,0.18), a(0.42,0.42), a(0.52,0.72), a(0.60,0.88) ],
    },

    // ============ PHASE 2a — decline track (continues the mature state, erodes) ============
    {
      id: uid('c'), name: 'Complacency', color: '#22d3ee', strokeWidth: 5,
      glow: 16, opacity: 1, blendMode: 'screen', visible: true, locked: false,
      smoothing: 'spline', highlight: true, group: 'decline',
      anchors: [ a(0.605,0.895), a(0.70,0.94), a(0.82,0.95), a(0.92,0.90), a(1.0,0.82) ],
    },
    {
      id: uid('c'), name: 'Eroding Value', color: '#ffc93c', strokeWidth: 5,
      glow: 16, opacity: 1, blendMode: 'screen', visible: true, locked: false,
      smoothing: 'spline', highlight: true, group: 'decline',
      anchors: [ a(0.605,0.875), a(0.68,0.86), a(0.78,0.74), a(0.86,0.58), a(0.93,0.44), a(1.0,0.34) ],
    },
    {
      id: uid('c'), name: 'Resistance to Change', color: '#3f8cff', strokeWidth: 5,
      glow: 16, opacity: 1, blendMode: 'screen', visible: true, locked: false,
      smoothing: 'spline', highlight: true, group: 'decline',
      anchors: [ a(0.605,0.10), a(0.72,0.16), a(0.83,0.30), a(0.92,0.46), a(1.0,0.58) ],
    },

    // ============ PHASE 2b — renewal subsystem (nested mini-crucible, lower band) ============
    {
      id: uid('c'), name: 'New Cost', color: '#ff7a2f', strokeWidth: 3.5,
      glow: 11, opacity: 0.95, blendMode: 'screen', visible: true, locked: false,
      smoothing: 'spline', highlight: false, group: 'renewal',
      anchors: [ a(0.62,0.05), a(0.70,0.24), a(0.78,0.11), a(0.88,0.05), a(1.0,0.04) ],
    },
    {
      id: uid('c'), name: 'New Resistance', color: '#3f8cff', strokeWidth: 3.5,
      glow: 11, opacity: 0.9, blendMode: 'screen', visible: true, locked: false,
      smoothing: 'spline', highlight: false, group: 'renewal',
      anchors: [ a(0.64,0.04), a(0.74,0.09), a(0.80,0.21), a(0.86,0.12), a(0.94,0.06), a(1.0,0.05) ],
    },
    {
      id: uid('c'), name: 'Future Value', color: '#ffb24d', strokeWidth: 4,
      glow: 12, opacity: 1, blendMode: 'screen', visible: true, locked: false,
      smoothing: 'spline', highlight: true, group: 'renewal',
      anchors: [ a(0.62,0.07), a(0.74,0.10), a(0.85,0.05), a(0.92,0.13), a(1.0,0.26) ],
    },
  ],
  // Canvases group curves AND milestones. Each curve/milestone references a
  // canvas by id via its `group` field. Canvases are user-editable (add / rename
  // / delete) — see scene.canvases handling in normalizeScene + the Composition
  // panel. (Older scenes that used `layers` still load — see normalizeScene.)
  canvases: [
    { id: 'primary', name: 'Phase 1 · Primary Crucible' },
    { id: 'decline', name: 'Phase 2 · Complacency / Decline' },
    { id: 'renewal', name: 'Phase 2 · Renewing the Crucible' },
  ],
  export: { pngScale: 2 },
};

// Default canvas set + names, used to seed/migrate scenes that lack `canvases`.
const DEFAULT_CANVASES = [
  { id: 'primary', name: 'Phase 1 · Primary Crucible' },
  { id: 'decline', name: 'Phase 2 · Complacency / Decline' },
  { id: 'renewal', name: 'Phase 2 · Renewing the Crucible' },
];

// Convenience accessors for the active scene's layers.
function sceneCanvases() { return state.scene.canvases || []; }
function canvasName(id) { const l = sceneCanvases().find((x) => x.id === id); return l ? l.name : id; }

/* ============================================================================
   [THEMES]
   ----------------------------------------------------------------------------
   A theme is a palette: chart-chrome colors (background/grid/axis/guide/label)
   plus a curve color "role" map. Each curve carries a `role`
   (cost/resistance/confidence/value/accent); applying a theme recolors every
   curve by its role, so e.g. Cost and New Cost always share a hue. Applying a
   theme overwrites manual color tweaks; the user can save the current colors
   back out as a custom theme. Custom themes persist in localStorage.
============================================================================ */
const ROLE_KEYS = ['cost', 'resistance', 'confidence', 'value', 'accent'];
const ROLE_LABELS = { cost: 'Cost (orange)', resistance: 'Resistance (blue)', confidence: 'Confidence (cyan)', value: 'Value (gold)', accent: 'Accent (violet)' };

const BUILTIN_THEMES = [
  // ---- Dark themes (neon, additive 'screen' glow) ----
  { id: 'crucible-neon', name: 'Crucible Neon', mode: 'dark', blend: 'screen', background: '#05070d', grid: '#2a3556', axis: '#5b6b94', guide: '#33406a', label: '#8fa0c8',
    roles: { cost: '#ff7a2f', resistance: '#3f8cff', confidence: '#22d3ee', value: '#ffc93c', accent: '#9d8bff' } },
  { id: 'solar-flare', name: 'Solar Flare', mode: 'dark', blend: 'screen', background: '#0b0805', grid: '#3a2a1e', axis: '#8a6a48', guide: '#4a3522', label: '#e0b088',
    roles: { cost: '#ff5630', resistance: '#ff9f1c', confidence: '#ffd23f', value: '#ff7eb6', accent: '#c77dff' } },
  { id: 'aurora', name: 'Aurora', mode: 'dark', blend: 'screen', background: '#04090b', grid: '#173a36', axis: '#46897a', guide: '#15463c', label: '#8fe0cd',
    roles: { cost: '#ff6b9d', resistance: '#4cc9f0', confidence: '#64ffda', value: '#c5ff6b', accent: '#b388ff' } },
  { id: 'mono-ice', name: 'Mono Ice', mode: 'dark', blend: 'screen', background: '#060a14', grid: '#1f2b47', axis: '#5a6e9c', guide: '#28344f', label: '#aebfe0',
    roles: { cost: '#9fd0ff', resistance: '#4f8cff', confidence: '#cfe9ff', value: '#6fb3ff', accent: '#8aa2d8' } },
  { id: 'ember', name: 'Ember Slate', mode: 'dark', blend: 'screen', background: '#0c0a07', grid: '#2f2820', axis: '#7c6f57', guide: '#3a3020', label: '#d3bd95',
    roles: { cost: '#ff7a45', resistance: '#e08a4f', confidence: '#f3c44b', value: '#d98e3a', accent: '#b5895f' } },
  { id: 'vapor', name: 'Vaporwave', mode: 'dark', blend: 'screen', background: '#0d0618', grid: '#2e1a47', axis: '#7a5ba8', guide: '#341b58', label: '#dcb3ec',
    roles: { cost: '#ff6ad5', resistance: '#6a8dff', confidence: '#4dd2ff', value: '#ffd166', accent: '#c77dff' } },
  // ---- Light themes (for light slides; 'normal' blend) ----
  // Each has its own background hue + ink temperament so they read distinctly:
  //   Daylight  — bright cool near-white, vivid modern keynote inks
  //   Parchment — warm cream paper, muted earthy editorial inks
  //   Blueprint — cool steel-blue draft paper, cobalt/jewel technical inks
  //   Botanic   — pale mint paper, fresh spring inks
  { id: 'daylight', name: 'Daylight · bright', mode: 'light', blend: 'normal', background: '#f6f8fc', grid: '#dbe3f0', axis: '#64748b', guide: '#cfd9ea', label: '#334155',
    roles: { cost: '#ef5b1f', resistance: '#2563eb', confidence: '#0a9cc7', value: '#e1900a', accent: '#7c3aed' } },
  { id: 'parchment', name: 'Parchment · vintage', mode: 'light', blend: 'normal', background: '#f3ead6', grid: '#ddceae', axis: '#8a7551', guide: '#d6c6a2', label: '#4f4225',
    roles: { cost: '#b5402a', resistance: '#36618e', confidence: '#2e7d6b', value: '#a9791f', accent: '#7c4d70' } },
  { id: 'blueprint', name: 'Blueprint · technical', mode: 'light', blend: 'normal', background: '#e3ebf3', grid: '#b6c6d8', axis: '#4a5d74', guide: '#a9bccf', label: '#29384c',
    roles: { cost: '#d33f49', resistance: '#1559b0', confidence: '#0e8f9e', value: '#9f7016', accent: '#5a3fa3' } },
  { id: 'botanic', name: 'Botanic · fresh', mode: 'light', blend: 'normal', background: '#edf6f0', grid: '#cbe1d4', axis: '#5d7d6e', guide: '#c2dccb', label: '#2f4a3d',
    roles: { cost: '#e2553f', resistance: '#2389c9', confidence: '#0a9d72', value: '#cf8517', accent: '#8b4fd6' } },
];

// Map the default-scene colors back to roles so existing scenes (which have no
// `role`) get sensible roles inferred once on load.
const ROLE_BY_COLOR = { '#ff7a2f': 'cost', '#ffb24d': 'value', '#ffc93c': 'value', '#3f8cff': 'resistance', '#22d3ee': 'confidence' };
function inferRole(color) { return ROLE_BY_COLOR[(color || '').toLowerCase()] || 'accent'; }

const THEMES_KEY = 'crucible-curve-themes';
let customThemes = [];
try { customThemes = JSON.parse(localStorage.getItem(THEMES_KEY) || '[]') || []; } catch (_) { customThemes = []; }
function persistThemes() { try { localStorage.setItem(THEMES_KEY, JSON.stringify(customThemes)); } catch (_) {} }
function allThemes() { return [...BUILTIN_THEMES, ...customThemes]; }
function getThemeById(id) { return allThemes().find((t) => t.id === id) || BUILTIN_THEMES[0]; }

/* ============================================================================
   [STATE]
============================================================================ */

const state = {
  scene: null,
  selectedCurveId: null,
  selectedMilestoneId: null, // for the Milestones panel reorder/delete bar
  activeJunction: null, // id of the welded junction whose floating handle is shown
  view: { x: 0, y: 0, w: 1920, h: 1080 }, // viewBox
  ui: {
    grid: true, axes: true, guides: true, background: true, glow: true,
    snap: false, solo: false, regions: true, branch: true, labels: true,
    zoomLock: false,
  },
};

// transient pointer-drag bookkeeping
let drag = null;

/* ============================================================================
   [GEOMETRY] transforms + path generation
============================================================================ */

// Normalized (0..1) → artboard user coordinates (px within the 1920x1080 space).
function normToUser(nx, ny) {
  const ab = state.scene.artboard, p = ab.padding;
  const cw = ab.width - p.left - p.right;
  const ch = ab.height - p.top - p.bottom;
  return { x: p.left + nx * cw, y: p.top + (1 - ny) * ch };
}
// Inverse: artboard user → normalized.
function userToNorm(ux, uy) {
  const ab = state.scene.artboard, p = ab.padding;
  const cw = ab.width - p.left - p.right;
  const ch = ab.height - p.top - p.bottom;
  return { x: (ux - p.left) / cw, y: 1 - (uy - p.top) / ch };
}

/**
 * Catmull-Rom → cubic Bézier handle derivation.
 * For each anchor i, the smooth tangent is proportional to (P[i+1] - P[i-1]).
 * Returns {hIn,hOut} per anchor in normalized space. Endpoints use a
 * one-sided difference so the curve doesn't overshoot off the ends.
 */
function deriveSplineHandles(anchors, tension = 1) {
  const n = anchors.length;
  return anchors.map((pt, i) => {
    const prev = anchors[i - 1] || pt;
    const next = anchors[i + 1] || pt;
    const tx = (next.x - prev.x) / 6 * tension;
    const ty = (next.y - prev.y) / 6 * tension;
    return {
      hIn:  { x: pt.x - tx, y: pt.y - ty },
      hOut: { x: pt.x + tx, y: pt.y + ty },
    };
  });
}

/**
 * Build an SVG path "d" string for a curve as a chain of cubic Béziers.
 * In spline mode handles are derived fresh; in bezier mode the stored
 * per-anchor handles are used (and created on demand for new anchors).
 */
function buildPathD(curve) {
  const anchors = curve.anchors;
  if (anchors.length < 2) {
    if (anchors.length === 1) { const p = normToUser(anchors[0].x, anchors[0].y); return `M ${p.x} ${p.y}`; }
    return '';
  }
  let handles;
  if (curve.smoothing === 'spline') {
    // spline tension is driven by the curve's easing preset (default 1 = smooth)
    handles = deriveSplineHandles(anchors, curve.tension == null ? 1 : curve.tension);
  } else {
    handles = anchors.map((pt) => ({
      hIn:  pt.hIn  || { x: pt.x, y: pt.y },
      hOut: pt.hOut || { x: pt.x, y: pt.y },
    }));
  }
  // Where this curve's end is welded to another curve's end, reshape the
  // junction-side handle so the line flows smoothly through the connection,
  // scaled by this curve's own easing/tension.
  applyJunctionSmoothing(curve, handles);

  const U = (n) => normToUser(n.x, n.y);
  let p0 = U(anchors[0]);
  let d = `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)}`;
  for (let i = 0; i < anchors.length - 1; i++) {
    const c1 = U(handles[i].hOut);
    const c2 = U(handles[i + 1].hIn);
    const p  = U(anchors[i + 1]);
    d += ` C ${c1.x.toFixed(2)} ${c1.y.toFixed(2)}, ${c2.x.toFixed(2)} ${c2.y.toFixed(2)}, ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }
  return d;
}

// Ensure a curve has explicit handles on every anchor (used when switching to
// bezier mode, or when an anchor was created without handles).
function ensureExplicitHandles(curve) {
  const derived = deriveSplineHandles(curve.anchors);
  curve.anchors.forEach((pt, i) => {
    if (!pt.hIn)  pt.hIn  = clone(derived[i].hIn);
    if (!pt.hOut) pt.hOut = clone(derived[i].hOut);
  });
}

// Easing presets bias a curve's "feel" by setting its spline tension. In spline
// mode the tension is applied live at render time; in bezier mode we also bake
// the regenerated handles so the manual handles reflect the preset.
const EASING_TENSIONS = { linear: 0.0, smooth: 1.0, easeInOut: 1.6, dramatic: 2.4 };
function applyEasing(curve, kind) {
  if (!kind) return;                         // "— choose —" → leave as-is
  const t = EASING_TENSIONS[kind] ?? 1;
  curve.easing = kind;
  curve.tension = t;
  if (curve.smoothing === 'bezier') {
    const derived = deriveSplineHandles(curve.anchors, t);
    curve.anchors.forEach((pt, i) => { pt.hIn = clone(derived[i].hIn); pt.hOut = clone(derived[i].hOut); });
  }
}

/* ----------------------------------------------------------------------------
   [JUNCTIONS] welded curve ends
   ----------------------------------------------------------------------------
   When two curve ends are snapped onto the same point (a "weld"), we treat the
   shared point as a junction. The path is reshaped so the two curves flow
   smoothly through it (C1 continuity), and a single floating handle can move
   every joined anchor at once.
---------------------------------------------------------------------------- */

// Two ends count as welded only when their anchors are (essentially) identical —
// which is exactly what the weld-snap produces. Kept tight so endpoints that
// merely sit near each other are not mistaken for a deliberate junction.
const JUNCTION_EPS = 0.0015;

// Every endpoint anchor across visible curves (index 0 and the last anchor).
function endpointMembers() {
  const out = [];
  for (const c of state.scene.curves) {
    if (!c.visible || !c.anchors || c.anchors.length < 2) continue;
    out.push({ curve: c, idx: 0, isFirst: true });
    out.push({ curve: c, idx: c.anchors.length - 1, isFirst: false });
  }
  return out;
}

// A stable id for a junction from its members, so an "active" junction survives
// re-renders while the same ends remain welded.
function junctionId(members) {
  return members.map((m) => `${m.curve.id}:${m.idx}`).sort().join('|');
}

// Group welded endpoints into junctions. Returns [{ x, y, id, members:[{curve,idx,isFirst}] }].
function computeJunctions() {
  const pts = endpointMembers().map((m) => {
    const a = m.curve.anchors[m.idx];
    return { ...m, x: a.x, y: a.y };
  });
  const used = new Array(pts.length).fill(false);
  const junctions = [];
  for (let i = 0; i < pts.length; i++) {
    if (used[i]) continue;
    const group = [pts[i]]; used[i] = true;
    for (let j = i + 1; j < pts.length; j++) {
      if (used[j]) continue;
      if (Math.abs(pts[j].x - pts[i].x) <= JUNCTION_EPS && Math.abs(pts[j].y - pts[i].y) <= JUNCTION_EPS) {
        group.push(pts[j]); used[j] = true;
      }
    }
    if (group.length < 2) continue;
    const x = group.reduce((s, g) => s + g.x, 0) / group.length;
    const y = group.reduce((s, g) => s + g.y, 0) / group.length;
    const members = group.map(({ curve, idx, isFirst }) => ({ curve, idx, isFirst }));
    junctions.push({ x, y, id: junctionId(members), members });
  }
  return junctions;
}

// The anchor adjacent to an endpoint (its "interior" neighbor), in norm space.
function interiorNeighbor(member) {
  const a = member.curve.anchors;
  return member.isFirst ? a[1] : a[a.length - 2];
}

// Reshape an endpoint's junction-side handle for a smooth flow through the weld.
// For an endpoint J with interior neighbor I and the averaged interior neighbor
// P of the partner ends, the shared tangent direction is (I - P): both joined
// curves end up collinear at J. Magnitude follows the curve's easing/tension.
function applyJunctionSmoothing(curve, handles) {
  const n = curve.anchors.length;
  if (n < 2) return;
  // The joint magnitude follows the curve's easing/tension in either smoothing
  // mode (bezier curves carry a baked tension from their easing preset too).
  const tension = curve.tension == null ? 1 : curve.tension;
  if (tension === 0) return; // linear easing → keep the joint straight
  const juncs = computeJunctions();
  for (const ep of [{ idx: 0, isFirst: true }, { idx: n - 1, isFirst: false }]) {
    const a = curve.anchors[ep.idx];
    const J = juncs.find((jj) => jj.members.some((m) => m.curve === curve && m.idx === ep.idx));
    if (!J) continue;
    const partners = J.members.filter((m) => !(m.curve === curve && m.idx === ep.idx));
    if (!partners.length) continue;
    const I = curve.anchors[ep.isFirst ? 1 : n - 2];
    let px = 0, py = 0;
    for (const pm of partners) { const pn = interiorNeighbor(pm); px += pn.x; py += pn.y; }
    px /= partners.length; py /= partners.length;
    const scale = tension / 6;
    const h = { x: a.x + (I.x - px) * scale, y: a.y + (I.y - py) * scale };
    if (ep.isFirst) handles[ep.idx].hOut = h; else handles[ep.idx].hIn = h;
  }
}

/* ============================================================================
   [SVG] static scaffold
   ----------------------------------------------------------------------------
   The SVG is built once. Two top-level groups:
     #scene-root  — everything that gets exported (bg, grid, axes, curves)
     #overlay     — editor-only handles, never exported
   Both live inside #viewport so zoom/pan via viewBox affects all of them.
============================================================================ */

const svg = document.getElementById('art');
let L = {}; // layer references

function el(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

// SVG elements show a native tooltip only via a child <title>, not a title attr.
function withTip(svgEl, text) {
  const t = el('title'); t.textContent = text; svgEl.appendChild(t);
  return svgEl;
}

function buildSvgScaffold() {
  svg.innerHTML = '';
  const ab = state.scene.artboard;
  svg.setAttribute('viewBox', `0 0 ${ab.width} ${ab.height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // defs (filters built per-curve later)
  L.defs = el('defs');
  svg.appendChild(L.defs);

  // exportable content
  L.sceneRoot = el('g', { id: 'scene-root' });
  L.bg      = el('g', { id: 'layer-bg' });
  L.regions = el('g', { id: 'layer-regions' });   // phase-2 tint + handoff divider
  L.grid    = el('g', { id: 'layer-grid' });
  L.axes    = el('g', { id: 'layer-axes' });
  L.guides  = el('g', { id: 'layer-guides' });
  L.curves  = el('g', { id: 'layer-curves' });
  L.labels  = el('g', { id: 'layer-labels' });    // per-curve word labels (above curves)
  L.title   = el('g', { id: 'layer-title' });     // the visual's title (driven by meta.name)
  L.branch  = el('g', { id: 'layer-branch' });    // focal fork node (above curves)
  L.sceneRoot.append(L.bg, L.regions, L.grid, L.axes, L.guides, L.curves, L.labels, L.title, L.branch);

  // editor-only layers (NOT inside #scene-root → never exported):
  //   #hit-targets — wide invisible strokes that make thin/overlapping curves
  //                  easy to click-select
  //   #overlay     — anchor/handle dots for the selected curve
  L.hits = el('g', { id: 'hit-targets' });
  L.overlay = el('g', { id: 'overlay' });

  svg.append(L.sceneRoot, L.hits, L.overlay);
}

/* ============================================================================
   [RENDER]
============================================================================ */

function renderAll() {
  renderBackground();
  renderRegions();
  renderGrid();
  renderAxes();
  renderGuides();
  renderCurves();
  renderLabels();
  renderTitle();
  renderBranch();
  renderOverlay();
}

function renderBackground() {
  const ab = state.scene.artboard;
  L.bg.innerHTML = '';
  L.bg.style.display = state.ui.background ? '' : 'none';
  if (!state.ui.background) return;

  L.bg.appendChild(el('rect', { x: 0, y: 0, width: ab.width, height: ab.height, fill: ab.background.color }));

  // ambient blue/purple haze
  if (ab.background.haze) {
    const gid = 'haze-grad';
    let grad = L.defs.querySelector('#' + gid);
    if (!grad) {
      grad = el('radialGradient', { id: gid, cx: '50%', cy: '42%', r: '60%' });
      grad.appendChild(el('stop', { offset: '0%',  'stop-color': '#1b2a5e', 'stop-opacity': '0.55' }));
      grad.appendChild(el('stop', { offset: '45%', 'stop-color': '#241a4d', 'stop-opacity': '0.30' }));
      grad.appendChild(el('stop', { offset: '100%','stop-color': '#05070d', 'stop-opacity': '0' }));
      L.defs.appendChild(grad);
    }
    L.bg.appendChild(el('rect', { x: 0, y: 0, width: ab.width, height: ab.height, fill: `url(#${gid})` }));
  }

  // vignette
  if (ab.background.vignette) {
    const vid = 'vignette-grad';
    let v = L.defs.querySelector('#' + vid);
    if (!v) {
      v = el('radialGradient', { id: vid, cx: '50%', cy: '50%', r: '75%' });
      v.appendChild(el('stop', { offset: '55%',  'stop-color': '#000', 'stop-opacity': '0' }));
      v.appendChild(el('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': '0.55' }));
      L.defs.appendChild(v);
    }
    L.bg.appendChild(el('rect', { x: 0, y: 0, width: ab.width, height: ab.height, fill: `url(#${vid})` }));
  }
}

function renderGrid() {
  const ab = state.scene.artboard, s = state.scene.style, p = ab.padding;
  L.grid.innerHTML = '';
  L.grid.style.display = state.ui.grid ? '' : 'none';
  if (!state.ui.grid) return;

  const x0 = p.left, x1 = ab.width - p.right;
  const y0 = p.top,  y1 = ab.height - p.bottom;

  for (let i = 0; i <= s.gridX; i++) {
    const x = x0 + (x1 - x0) * (i / s.gridX);
    L.grid.appendChild(el('line', { x1: x, y1: y0, x2: x, y2: y1, stroke: s.gridColor, 'stroke-width': 1, 'stroke-opacity': s.gridOpacity }));
  }
  for (let j = 0; j <= s.gridY; j++) {
    const y = y0 + (y1 - y0) * (j / s.gridY);
    L.grid.appendChild(el('line', { x1: x0, y1: y, x2: x1, y2: y, stroke: s.gridColor, 'stroke-width': 1, 'stroke-opacity': s.gridOpacity }));
  }
}

function renderAxes() {
  const ab = state.scene.artboard, s = state.scene.style, p = ab.padding;
  L.axes.innerHTML = '';
  L.axes.style.display = state.ui.axes ? '' : 'none';
  if (!state.ui.axes) return;

  const x0 = p.left, x1 = ab.width - p.right;
  const y0 = p.top,  y1 = ab.height - p.bottom;

  // arrowhead marker
  if (!L.defs.querySelector('#axis-arrow')) {
    const m = el('marker', { id: 'axis-arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    m.appendChild(el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: s.axisColor }));
    L.defs.appendChild(m);
  }

  // Y axis (vertical) and X axis (horizontal), both rising from bottom-left origin
  L.axes.appendChild(el('line', { x1: x0, y1: y1, x2: x0, y2: y0 - 12, stroke: s.axisColor, 'stroke-width': 2.5, 'marker-end': 'url(#axis-arrow)' }));
  L.axes.appendChild(el('line', { x1: x0, y1: y1, x2: x1 + 12, y2: y1, stroke: s.axisColor, 'stroke-width': 2.5, 'marker-end': 'url(#axis-arrow)' }));

  const ax = state.scene.axes || {};

  // Y-axis scale: tick marks + low/high endpoint labels (so the scale is legible)
  if (ax.showTicks !== false) {
    for (let j = 0; j <= s.gridY; j++) {
      const yt = y1 - (y1 - y0) * (j / s.gridY);
      L.axes.appendChild(el('line', { x1: x0 - 7, y1: yt, x2: x0, y2: yt, stroke: s.axisColor, 'stroke-width': 1.5, 'stroke-opacity': 0.8 }));
    }
  }
  const scaleLabel = (text, yy, baseline) => {
    if (!text) return;
    const t = el('text', { x: x0 - 14, y: yy, fill: s.labelColor, 'font-size': 17, 'font-family': 'Helvetica, Arial, sans-serif', 'text-anchor': 'end', 'dominant-baseline': baseline });
    t.textContent = text;
    L.axes.appendChild(t);
  };
  scaleLabel(ax.yHigh, y0 + 4, 'hanging');
  scaleLabel(ax.yLow, y1 - 2, 'auto');

  // axis titles (editable)
  const yLabel = el('text', { x: p.left - 78, y: (y0 + y1) / 2, fill: s.labelColor, 'font-size': 22, 'font-family': 'Helvetica, Arial, sans-serif', 'letter-spacing': '2', 'text-anchor': 'middle', transform: `rotate(-90 ${p.left - 78} ${(y0 + y1) / 2})` });
  yLabel.textContent = ax.yLabel || '';
  L.axes.appendChild(yLabel);

  const xLabel = el('text', { x: (x0 + x1) / 2, y: ab.height - 34, fill: s.labelColor, 'font-size': 22, 'font-family': 'Helvetica, Arial, sans-serif', 'letter-spacing': '2', 'text-anchor': 'middle' });
  xLabel.textContent = ax.xLabel || '';
  L.axes.appendChild(xLabel);

  // Per-layer vertical axes on the right edge of the Phase-2 region — the
  // primary's Y scale, repeated separately for each stacked layer band.
  if (branchEnabled()) {
    for (const band of phase2Bands()) renderBandAxis(band, x1, ax, s);
  }
}

// One repeated Y axis at the right edge for a Phase-2 layer band: line + arrow,
// tick marks, Low/High endpoint labels (mirrored to the right), and the layer
// name as the band's rotated title. Matches the primary axis styling/theme.
function renderBandAxis(band, xR, ax, s) {
  const yTop = band.top, yBot = band.bottom;
  L.axes.appendChild(el('line', { x1: xR, y1: yBot, x2: xR, y2: yTop - 10, stroke: s.axisColor, 'stroke-width': 2.5, 'marker-end': 'url(#axis-arrow)' }));

  if (ax.showTicks !== false) {
    const ticks = state.scene.style.gridY;
    for (let j = 0; j <= ticks; j++) {
      const yt = yBot - (yBot - yTop) * (j / ticks);
      L.axes.appendChild(el('line', { x1: xR, y1: yt, x2: xR + 7, y2: yt, stroke: s.axisColor, 'stroke-width': 1.5, 'stroke-opacity': 0.8 }));
    }
  }

  const lab = (text, yy, baseline) => {
    if (!text) return;
    const t = el('text', { x: xR + 14, y: yy, fill: s.labelColor, 'font-size': 17, 'font-family': 'Helvetica, Arial, sans-serif', 'text-anchor': 'start', 'dominant-baseline': baseline });
    t.textContent = text;
    L.axes.appendChild(t);
  };
  lab(ax.yHigh, yTop + 4, 'hanging');
  lab(ax.yLow, yBot - 2, 'auto');

  // band title (rotated up the right side). An explicit canvas.axisTitle wins;
  // otherwise derive from the canvas name (trimming any "Phase N ·" prefix).
  // Hidden when the canvas's axisTitleShow is off.
  const derived = (band.canvas.name || '').replace(/^\s*phase\s*\d+\s*[·:.\-]?\s*/i, '').trim() || band.canvas.name || '';
  const name = band.canvas.axisTitleShow === false ? '' : ((band.canvas.axisTitle || '').trim() || derived);
  if (name) {
    const cy = (yTop + yBot) / 2, tx = xR + 74;
    const title = el('text', { x: tx, y: cy, fill: s.labelColor, 'font-size': 18, 'font-family': 'Helvetica, Arial, sans-serif', 'letter-spacing': '2', 'text-anchor': 'middle', transform: `rotate(90 ${tx} ${cy})` });
    title.textContent = name.toUpperCase();
    L.axes.appendChild(title);
  }
}

function renderGuides() {
  const ab = state.scene.artboard, s = state.scene.style, p = ab.padding;
  L.guides.innerHTML = '';
  L.guides.style.display = state.ui.guides ? '' : 'none';
  if (!state.ui.guides) return;

  const y0 = p.top, y1 = ab.height - p.bottom;
  for (const ms of state.scene.milestones) {
    if (ms.visible === false) continue;
    const u = normToUser(ms.x, 0);

    // full-height dashed guide line (typically Phase-1 milestones only)
    if (ms.showGuide) {
      L.guides.appendChild(el('line', { x1: u.x, y1: y0, x2: u.x, y2: y1, stroke: s.guideColor, 'stroke-width': 1.5, 'stroke-dasharray': '4 8', 'stroke-opacity': 0.6 }));
    }

    // Label: axis-anchored when no y given; otherwise floated at the normalized y
    // (used to stack the decline track high and the renewal track low).
    const section = !!ms.color; // colored captions read as section headers
    const isPost = ms.phase === 'post';
    const pos = (ms.y == null) ? { x: u.x, y: y1 + 34 } : normToUser(ms.x, ms.y);
    const t = el('text', {
      x: pos.x, y: pos.y,
      fill: ms.color || s.labelColor,
      'font-size': section ? 24 : (isPost ? 17 : 20),
      'font-weight': section ? 700 : 400,
      'letter-spacing': section ? '2' : '0',
      'font-family': 'Helvetica, Arial, sans-serif',
      'text-anchor': 'middle',
      opacity: isPost && !section ? 0.85 : 1,
    });
    t.textContent = ms.label;
    L.guides.appendChild(t);
  }
}

// The Branch feature only makes sense with 2+ layers (i.e. a fork into separate
// tracks). With a single layer it's auto-disabled and the chart is one
// continuous space spanning the full canvas.
function branchEnabled() {
  const r = state.scene.regions || {};
  return r.enabled !== false && sceneCanvases().length >= 2;
}

// The Phase-2 region (right of the divider) is split into one horizontal band
// per non-primary layer, stacked top→bottom in layer order. Each band gets its
// own right-edge vertical axis. Returns [{ layer, top, bottom }] in user space.
function phase2Bands() {
  const canvases = sceneCanvases();
  if (canvases.length < 2) return [];
  const ab = state.scene.artboard, p = ab.padding;
  const y0 = p.top, y1 = ab.height - p.bottom;
  const phase2 = canvases.slice(1); // every canvas after the primary
  const n = phase2.length;
  const gap = n > 1 ? 26 : 0;     // breathing room between stacked bands
  const bandH = (y1 - y0 - gap * (n - 1)) / n;
  return phase2.map((canvas, i) => {
    const top = y0 + i * (bandH + gap);
    return { canvas, top, bottom: top + bandH };
  });
}

// Branch region tint + the handoff divider.
function renderRegions() {
  const ab = state.scene.artboard, p = ab.padding;
  const r = state.scene.regions || {};
  L.regions.innerHTML = '';
  const on = state.ui.regions && branchEnabled();
  L.regions.style.display = on ? '' : 'none';
  if (!on) return;

  const y0 = p.top, y1 = ab.height - p.bottom;
  const bx = normToUser(r.branchX ?? 0.6, 0).x;
  const x1 = ab.width - p.right;

  // subtle tint over the post-mastery half so it reads as a second act.
  // Lighter/cooler and softer on light backgrounds so it doesn't read as a box.
  if (r.tint) {
    const light = state.scene.mode === 'light';
    const gid = 'phase2-tint-' + (light ? 'light' : 'dark');
    const col = light ? '#5566aa' : '#3a2a6a';
    const op = light ? '0.07' : '0.16';
    if (!L.defs.querySelector('#' + gid)) {
      const grad = el('linearGradient', { id: gid, x1: '0', y1: '0', x2: '1', y2: '0' });
      grad.appendChild(el('stop', { offset: '0%',   'stop-color': col, 'stop-opacity': '0' }));
      grad.appendChild(el('stop', { offset: '100%', 'stop-color': col, 'stop-opacity': op }));
      L.defs.appendChild(grad);
    }
    L.regions.appendChild(el('rect', { x: bx, y: y0, width: Math.max(0, x1 - bx), height: y1 - y0, fill: `url(#${gid})` }));
  }

  // handoff divider — a strong luminous seam the Phase-2 layers anchor to.
  // Colour comes from the theme's axis token so it flexes light/dark.
  if (r.divider) {
    const light = state.scene.mode === 'light';
    const s = state.scene.style;
    const col = s.axisColor;
    if (!L.defs.querySelector('#divider-glow')) {
      const f = el('filter', { id: 'divider-glow', x: '-400%', y: '-20%', width: '900%', height: '140%' });
      f.appendChild(el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: 5 }));
      L.defs.appendChild(f);
    }
    const yTop = y0 - 18, yBot = y1;
    // soft glow pass behind, then a crisp solid line on top
    L.regions.appendChild(el('line', { x1: bx, y1: yTop, x2: bx, y2: yBot, stroke: col, 'stroke-width': light ? 3 : 4, 'stroke-opacity': light ? 0.28 : 0.55, filter: 'url(#divider-glow)' }));
    L.regions.appendChild(el('line', { x1: bx, y1: yTop, x2: bx, y2: yBot, stroke: col, 'stroke-width': 2, 'stroke-opacity': light ? 0.9 : 0.95 }));
  }
}

// Focal branch node at the mature-state plateau, with faint connectors that
// fork up into the decline track and down into the renewal subsystem.
function renderBranch() {
  const r = state.scene.regions || {};
  const b = r.branch || {};
  L.branch.innerHTML = '';
  const on = state.ui.branch && b.show && branchEnabled();
  L.branch.style.display = on ? '' : 'none';
  if (!on) return;

  const c = normToUser(b.x, b.y);

  // fork connectors (decline = up/right, renewal = down) — purely indicative
  const up = normToUser(b.x + 0.05, Math.min(1, b.y + 0.04));
  const down = normToUser(b.x + 0.03, Math.max(0, b.y - 0.55));
  for (const tgt of [up, down]) {
    L.branch.appendChild(el('path', {
      d: `M ${c.x} ${c.y} Q ${c.x} ${(c.y + tgt.y) / 2}, ${tgt.x} ${tgt.y}`,
      fill: 'none', stroke: '#9fb4e8', 'stroke-width': 1.5, 'stroke-dasharray': '3 7', 'stroke-opacity': 0.4,
    }));
  }

  // node: soft glow ring + bright core
  if (!L.defs.querySelector('#branch-glow')) {
    const f = el('filter', { id: 'branch-glow', x: '-120%', y: '-120%', width: '340%', height: '340%' });
    f.appendChild(el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: 9 }));
    L.defs.appendChild(f);
  }
  L.branch.appendChild(el('circle', { cx: c.x, cy: c.y, r: 13, fill: '#bcd2ff', filter: 'url(#branch-glow)', opacity: 0.8 }));
  L.branch.appendChild(el('circle', { cx: c.x, cy: c.y, r: 6, fill: '#ffffff' }));
  L.branch.appendChild(el('circle', { cx: c.x, cy: c.y, r: 11, fill: 'none', stroke: '#bcd2ff', 'stroke-width': 1.5, 'stroke-opacity': 0.7 }));
}

// Build/refresh the per-curve glow filter in <defs>.
function ensureGlowFilter(curve) {
  const fid = 'glow-' + curve.id;
  let f = L.defs.querySelector('#' + fid);
  if (!f) {
    f = el('filter', { id: fid, x: '-30%', y: '-30%', width: '160%', height: '160%' });
    f.appendChild(el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: curve.glow, result: 'b' }));
    L.defs.appendChild(f);
  } else {
    f.querySelector('feGaussianBlur').setAttribute('stdDeviation', curve.glow);
  }
  return fid;
}

function renderCurves() {
  L.curves.innerHTML = '';
  if (L.hits) L.hits.innerHTML = '';
  const solo = state.ui.solo ? state.selectedCurveId : null;
  const light = state.scene.mode === 'light';

  for (const curve of state.scene.curves) {
    if (!curve.visible) continue;
    if (solo && curve.id !== solo) continue;

    const d = buildPathD(curve);
    const g = el('g', { 'data-curve': curve.id });
    g.style.opacity = curve.opacity;
    g.style.mixBlendMode = curve.blendMode || 'normal';

    // wide invisible hit target (editor-only layer) — generous click area so
    // thin renewal curves and overlapping strokes are easy to select.
    if (L.hits) {
      const hit = el('path', {
        d, fill: 'none', stroke: '#000', 'stroke-opacity': 0,
        'stroke-width': Math.max(22, curve.strokeWidth * 3),
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'data-hit': curve.id,
      });
      hit.setAttribute('pointer-events', 'stroke'); // hittable regardless of paint
      hit.style.cursor = 'pointer';
      L.hits.appendChild(hit);
    }

    // glow pass (blurred, behind). On light backgrounds a heavy additive glow
    // would wash out, so it's rendered softer.
    if (state.ui.glow && curve.glow > 0) {
      const fid = ensureGlowFilter(curve);
      g.appendChild(el('path', {
        d, fill: 'none', stroke: curve.color,
        'stroke-width': curve.strokeWidth * (light ? 1.5 : 1.8),
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        filter: `url(#${fid})`, 'stroke-opacity': light ? 0.35 : 0.9,
      }));
    }

    // main bright stroke
    const main = el('path', {
      d, fill: 'none', stroke: curve.color,
      'stroke-width': curve.strokeWidth,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'data-hit': curve.id,
    });
    g.appendChild(main);

    // crisp inner highlight pass — a white core reads as neon on dark, but
    // washes out a colored line on light, so it's skipped in light mode.
    if (curve.highlight && !light) {
      g.appendChild(el('path', {
        d, fill: 'none', stroke: '#ffffff',
        'stroke-width': Math.max(1, curve.strokeWidth * 0.35),
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'stroke-opacity': 0.55,
      }));
    }

    // selection emphasis
    if (curve.id === state.selectedCurveId) {
      main.setAttribute('stroke-width', curve.strokeWidth + 0.5);
    }

    L.curves.appendChild(g);
  }
}

// Per-curve word labels — styled in the curve's color, optional matching glow,
// optional leader line back to the anchor they describe. Rendered inside
// #scene-root so they export with the chart.
function ensureTextGlowFilter() {
  if (!L.defs.querySelector('#text-glow')) {
    const f = el('filter', { id: 'text-glow', x: '-60%', y: '-60%', width: '220%', height: '220%' });
    f.appendChild(el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: 4 }));
    L.defs.appendChild(f);
  }
  return 'text-glow';
}

function renderLabels() {
  if (!L.labels) return;
  L.labels.innerHTML = '';
  L.labels.style.display = state.ui.labels ? '' : 'none';
  if (!state.ui.labels) return;

  const solo = state.ui.solo ? state.selectedCurveId : null;
  for (const curve of state.scene.curves) {
    if (!curve.visible) continue;
    if (solo && curve.id !== solo) continue;
    if (!curve.labels || !curve.labels.length) continue;

    for (const lab of curve.labels) {
      const pos = normToUser(lab.x, lab.y);
      const size = lab.fontSize || 26;

      // optional leader line back to the anchor it annotates
      if (lab.leader && lab.anchor != null && curve.anchors[lab.anchor]) {
        const ap = normToUser(curve.anchors[lab.anchor].x, curve.anchors[lab.anchor].y);
        L.labels.appendChild(el('line', { x1: pos.x, y1: pos.y, x2: ap.x, y2: ap.y, stroke: curve.color, 'stroke-width': 1.5, 'stroke-opacity': 0.5 }));
      }

      const attrs = () => ({
        x: pos.x, y: pos.y,
        'font-size': size,
        'font-family': 'Helvetica, Arial, sans-serif',
        'font-weight': lab.bold === false ? 400 : 700,
        'letter-spacing': lab.tracking != null ? lab.tracking : 1,
        'text-anchor': lab.align || 'middle',
        'dominant-baseline': 'middle',
      });

      // glow pass (matches the curve's neon look)
      if (lab.glow !== false && state.ui.glow) {
        const fid = ensureTextGlowFilter();
        const tg = el('text', { ...attrs(), fill: curve.color, filter: `url(#${fid})`, opacity: 0.9 });
        tg.textContent = lab.text;
        L.labels.appendChild(tg);
      }
      const t = el('text', { ...attrs(), fill: curve.color, opacity: curve.opacity });
      t.textContent = lab.text;
      L.labels.appendChild(t);
    }
  }
}

// The visual's title — a styleable, draggable chart label whose TEXT is the
// visual name (scene.meta.name). Same rendering treatment as curve labels.
function renderTitle() {
  if (!L.title) return;
  L.title.innerHTML = '';
  const ti = state.scene.title;
  const text = (state.scene.meta && state.scene.meta.name) || '';
  if (!ti || !ti.show || !text) return;

  // colorAuto follows the light/dark mode for legibility; otherwise use the
  // explicit color the user picked (preserved across theme switches).
  const color = ti.colorAuto ? (state.scene.mode === 'light' ? '#1d2433' : '#ffffff') : (ti.color || '#ffffff');
  const pos = normToUser(ti.x, ti.y);
  const attrs = () => ({
    x: pos.x, y: pos.y,
    'font-size': ti.fontSize || 56,
    'font-family': 'Helvetica, Arial, sans-serif',
    'font-weight': ti.bold === false ? 400 : 700,
    'letter-spacing': ti.tracking != null ? ti.tracking : 2,
    'text-anchor': ti.align || 'middle',
    'dominant-baseline': 'middle',
  });
  if (ti.glow !== false && state.ui.glow) {
    const fid = ensureTextGlowFilter();
    const tg = el('text', { ...attrs(), fill: color, filter: `url(#${fid})`, opacity: 0.9 });
    tg.textContent = text;
    L.title.appendChild(tg);
  }
  const t = el('text', { ...attrs(), fill: color });
  t.textContent = text;
  L.title.appendChild(t);
}

// The title color that's effectively showing right now (for the color picker).
function effectiveTitleColor() {
  const ti = state.scene.title;
  return ti.colorAuto ? (state.scene.mode === 'light' ? '#1d2433' : '#ffffff') : (ti.color || '#ffffff');
}

/* ---- editor overlay: handles for the selected curve ---- */

function screenUnitsPerPx() {
  // user-units represented by one on-screen pixel (for constant handle sizing).
  // Guard against pre-layout boot frames where the rect can be ~0/2px wide,
  // which would otherwise blow handle radii up to thousands of units.
  const rect = svg.getBoundingClientRect();
  const w = rect.width > 50 ? rect.width : state.scene.artboard.width;
  return state.view.w / w;
}

function renderOverlay() {
  L.overlay.innerHTML = '';
  const upp = screenUnitsPerPx();

  // Milestone-label + title drag handles are always available (independent of
  // which curve is selected).
  renderMilestoneHandles(upp);
  renderTitleHandle(upp);
  // Welded-junction click targets + the floating joint handle (independent of
  // which curve is selected).
  renderJunctionHandles(upp);
  // PowerPoint-style spacing guides while dragging a milestone label.
  if (drag && drag.kind === 'mslabel') renderSpacingGuides(drag.msid, upp);

  const curve = getSelected();
  if (!curve || curve.locked) {
    if (drag && ['mslabel', 'title', 'junctionHandle'].includes(drag.kind) && drag.snapHint) renderSnapGuides(drag.snapHint, upp);
    return;
  }

  const R = 6 * upp;          // anchor radius
  const rh = 4.5 * upp;       // handle radius
  const lw = 1.4 * upp;       // line width

  const showBezier = curve.smoothing === 'bezier';
  if (showBezier) ensureExplicitHandles(curve);

  curve.anchors.forEach((pt, i) => {
    const pu = normToUser(pt.x, pt.y);

    if (showBezier) {
      // tangent lines + handles
      for (const which of ['hIn', 'hOut']) {
        const h = pt[which]; if (!h) continue;
        const hu = normToUser(h.x, h.y);
        L.overlay.appendChild(el('line', { x1: pu.x, y1: pu.y, x2: hu.x, y2: hu.y, stroke: '#7da2ff', 'stroke-width': lw, 'stroke-opacity': 0.8 }));
        const hc = el('circle', { cx: hu.x, cy: hu.y, r: rh, fill: '#0b0f1c', stroke: '#7da2ff', 'stroke-width': lw, class: 'ov-handle' });
        hc.dataset.kind = which; hc.dataset.idx = i; hc.style.cursor = 'move';
        withTip(hc, 'Bézier handle — drag to shape the curve into/out of this anchor');
        L.overlay.appendChild(hc);
      }
    }

    // anchor
    const ac = el('circle', { cx: pu.x, cy: pu.y, r: R, fill: curve.color, stroke: '#fff', 'stroke-width': lw });
    ac.dataset.kind = 'anchor'; ac.dataset.idx = i; ac.style.cursor = 'move';
    withTip(ac, `Anchor ${i + 1} of ${curve.anchors.length} — drag to move${state.ui.snap ? ' (Snap on: welds to nearby anchors / guides)' : ''}`);
    L.overlay.appendChild(ac);
  });

  // label drag handles: a hollow box sized to the word so the text stays
  // readable through it, and the whole box is grabbable (pointer-events: all).
  if (curve.labels && state.ui.labels) {
    curve.labels.forEach((lab, li) => {
      const lp = normToUser(lab.x, lab.y);
      const size = lab.fontSize || 26;
      const halfW = Math.max(size * (lab.text || ' ').length * 0.3, size * 0.8);
      const halfH = size * 0.7;
      const box = el('rect', {
        x: lp.x - halfW, y: lp.y - halfH, width: halfW * 2, height: halfH * 2, rx: 4,
        fill: 'transparent', stroke: curve.color, 'stroke-width': lw, 'stroke-dasharray': `${4 * upp} ${3 * upp}`, 'stroke-opacity': 0.8,
      });
      box.dataset.kind = 'label'; box.dataset.lidx = li; box.style.cursor = 'move';
      box.setAttribute('pointer-events', 'all');
      withTip(box, `Label “${lab.text || ''}” — drag to reposition, double-click to edit text`);
      L.overlay.appendChild(box);
    });
  }

  // live snap guides while dragging an anchor, a label, or a milestone label
  if (drag && ['anchor', 'label', 'mslabel', 'junctionHandle'].includes(drag.kind) && drag.snapHint) renderSnapGuides(drag.snapHint, upp);
}

// Welded curve ends get a small ring you can click; the active one grows a
// floating handle on a short stalk that drags every joined anchor at once.
function renderJunctionHandles(upp) {
  const juncs = computeJunctions();
  state._junctions = juncs; // cached for drag hit-testing
  // drop an active junction that no longer exists (ends were pulled apart)
  if (state.activeJunction && !juncs.some((j) => j.id === state.activeJunction)) state.activeJunction = null;
  for (const J of juncs) {
    const ju = normToUser(J.x, J.y);
    const active = state.activeJunction === J.id;
    const ring = el('circle', {
      cx: ju.x, cy: ju.y, r: 9 * upp, fill: 'transparent',
      stroke: '#ff5ed0', 'stroke-width': 1.4 * upp, 'stroke-opacity': active ? 0.9 : 0.45,
    });
    ring.dataset.kind = 'junctionHit'; ring.dataset.jid = J.id; ring.style.cursor = 'pointer';
    ring.setAttribute('pointer-events', 'all');
    withTip(ring, `Junction of ${J.members.length} ends — click to ${active ? 'hide' : 'reveal'} the joint handle`);
    L.overlay.appendChild(ring);
    if (!active) continue;
    const up = 30 * upp;
    const gx = ju.x, gy = ju.y - up;
    L.overlay.appendChild(el('line', { x1: ju.x, y1: ju.y, x2: gx, y2: gy, stroke: '#ff5ed0', 'stroke-width': 1.4 * upp, 'stroke-opacity': 0.9 }));
    L.overlay.appendChild(el('circle', { cx: ju.x, cy: ju.y, r: 3.5 * upp, fill: '#ff5ed0' }));
    const grip = el('circle', { cx: gx, cy: gy, r: 8 * upp, fill: '#0b0f1c', stroke: '#ff5ed0', 'stroke-width': 2 * upp, class: 'ov-handle' });
    grip.dataset.kind = 'junctionHandle'; grip.dataset.jid = J.id; grip.style.cursor = 'move';
    grip.setAttribute('pointer-events', 'all');
    withTip(grip, 'Drag to move both joined anchors together (easing applied through the joint)');
    L.overlay.appendChild(grip);
  }
}

/* ----------------------------------------------------------------------------
   [SPACING] PowerPoint-style equal-distance guides for milestone labels
   ----------------------------------------------------------------------------
   While a milestone label is dragged, the labels in its layer are measured
   edge-to-edge. Equal gaps are drawn with a dimension line + measurement, and
   the dragged label snaps so its gap matches a neighbouring one.
---------------------------------------------------------------------------- */

// User-space boxes for visible milestones in a layer, sorted left→right.
function layerMilestoneBoxes(group) {
  const ab = state.scene.artboard, p = ab.padding;
  const cw = ab.width - p.left - p.right;
  const axisY = ab.height - p.bottom + 34;
  return state.scene.milestones
    .filter((m) => m.visible !== false && (m.group || '') === (group || ''))
    .map((m) => {
      const halfW = milestoneExtents(m).hw * cw;
      const pos = (m.y == null) ? { x: normToUser(m.x, 0).x, y: axisY } : normToUser(m.x, m.y);
      return { ms: m, cx: pos.x, cy: pos.y, halfW, left: pos.x - halfW, right: pos.x + halfW };
    })
    .sort((a, b) => a.cx - b.cx);
}

// If the dragged label's gap to a neighbour can be made equal to another gap in
// the layer (or centred between its two neighbours), return the snapped norm x.
function equalSpacingSnapX(ms, proposedNormX, upp) {
  if (!state.ui.snap) return null;
  const ab = state.scene.artboard, p = ab.padding;
  const cw = ab.width - p.left - p.right;
  const others = layerMilestoneBoxes(ms.group).filter((b) => b.ms.id !== ms.id);
  if (others.length < 2) return null;
  const halfW = milestoneExtents(ms).hw * cw;
  const proposedCx = normToUser(proposedNormX, 0).x;
  let leftN = null, rightN = null;
  for (const b of others) {
    if (b.cx <= proposedCx) { if (!leftN || b.cx > leftN.cx) leftN = b; }
    else if (!rightN || b.cx < rightN.cx) rightN = b;
  }
  const refGaps = [];
  for (let i = 0; i < others.length - 1; i++) refGaps.push(others[i + 1].left - others[i].right);
  const cands = [];
  if (leftN) for (const V of refGaps) cands.push(leftN.right + V + halfW);
  if (rightN) for (const V of refGaps) cands.push(rightN.left - V - halfW);
  if (leftN && rightN) cands.push((leftN.right + rightN.left) / 2); // equal both sides
  let best = null, bestD = SNAP_PX * upp;
  for (const cx of cands) { const d = Math.abs(cx - proposedCx); if (d < bestD) { bestD = d; best = cx; } }
  return best == null ? null : userToNorm(best, 0).x;
}

// Draw dimension lines for every set of ≥2 equal edge-to-edge gaps in the
// dragged label's layer (so you can see which labels share a spacing).
function renderSpacingGuides(msid, upp) {
  if (!state.ui.snap) return;
  const ms = state.scene.milestones.find((m) => m.id === msid);
  if (!ms) return;
  const boxes = layerMilestoneBoxes(ms.group);
  if (boxes.length < 3) return; // need at least two gaps to compare
  const gaps = [];
  for (let i = 0; i < boxes.length - 1; i++) {
    const value = boxes[i + 1].left - boxes[i].right;
    if (value <= 4 * upp) continue; // overlapping / touching — nothing to dimension
    gaps.push({ x1: boxes[i].right, x2: boxes[i + 1].left, y: Math.max(boxes[i].cy, boxes[i + 1].cy), value });
  }
  const TOL = 2.5 * upp;
  const used = new Array(gaps.length).fill(false);
  for (let i = 0; i < gaps.length; i++) {
    if (used[i]) continue;
    const grp = [gaps[i]]; used[i] = true;
    for (let j = i + 1; j < gaps.length; j++) {
      if (!used[j] && Math.abs(gaps[j].value - gaps[i].value) <= TOL) { grp.push(gaps[j]); used[j] = true; }
    }
    if (grp.length >= 2) drawSpacingGroup(grp, upp);
  }
}

function drawSpacingGroup(grp, upp) {
  const C = '#ff5ed0';
  const dy = 28 * upp;
  for (const g of grp) {
    const y = g.y + dy;
    L.overlay.appendChild(el('line', { x1: g.x1, y1: y, x2: g.x2, y2: y, stroke: C, 'stroke-width': 1.4 * upp }));
    for (const x of [g.x1, g.x2]) {
      L.overlay.appendChild(el('line', { x1: x, y1: y - 6 * upp, x2: x, y2: y + 6 * upp, stroke: C, 'stroke-width': 1.4 * upp }));
    }
    const mid = (g.x1 + g.x2) / 2;
    const txt = String(Math.round(g.value));
    const bw = (7 + txt.length * 4.2) * upp, bh = 11 * upp;
    L.overlay.appendChild(el('rect', { x: mid - bw, y: y - bh, width: bw * 2, height: bh * 2, rx: 3 * upp, fill: '#0b0f1c', stroke: C, 'stroke-width': upp, 'stroke-opacity': 0.85 }));
    const t = el('text', { x: mid, y: y + upp, fill: C, 'font-size': 13 * upp, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-family': 'Helvetica, Arial, sans-serif' });
    t.textContent = txt;
    L.overlay.appendChild(t);
  }
}

// Invisible, generously-sized grab areas over each milestone label so the
// labels can be dragged directly on the canvas (a faint outline shows on hover).
function renderMilestoneHandles(upp) {
  if (!state.ui.guides) return;
  const ab = state.scene.artboard, p = ab.padding;
  const axisY = ab.height - p.bottom + 34; // where axis-docked labels sit
  for (const ms of state.scene.milestones) {
    if (ms.visible === false) continue;
    const pos = (ms.y == null) ? { x: normToUser(ms.x, 0).x, y: axisY } : normToUser(ms.x, ms.y);
    const section = !!ms.color;
    const size = section ? 24 : (ms.phase === 'post' ? 17 : 20);
    const halfW = Math.max(size * (ms.label || ' ').length * 0.3, size);
    const halfH = size * 0.8;
    const box = el('rect', {
      x: pos.x - halfW, y: pos.y - halfH, width: halfW * 2, height: halfH * 2, rx: 4,
      fill: 'transparent', class: 'ov-mslabel',
    });
    box.dataset.kind = 'mslabel'; box.dataset.msid = ms.id; box.style.cursor = 'move';
    box.setAttribute('pointer-events', 'all');
    box.setAttribute('vector-effect', 'non-scaling-stroke');
    withTip(box, `Milestone “${ms.label}” — drag to move${state.ui.snap ? ' (Snap on)' : ''}, double-click to edit text`);
    L.overlay.appendChild(box);
  }
}

// Invisible grab box over the visual title (when shown) so it can be dragged.
function renderTitleHandle(upp) {
  const ti = state.scene.title;
  const text = (state.scene.meta && state.scene.meta.name) || '';
  if (!ti || !ti.show || !text) return;
  const pos = normToUser(ti.x, ti.y);
  const size = ti.fontSize || 56;
  const halfW = Math.max(size * text.length * 0.32, size);
  const halfH = size * 0.8;
  const box = el('rect', {
    x: pos.x - halfW, y: pos.y - halfH, width: halfW * 2, height: halfH * 2, rx: 4,
    fill: 'transparent', class: 'ov-mslabel',
  });
  box.dataset.kind = 'title'; box.style.cursor = 'move';
  box.setAttribute('pointer-events', 'all');
  box.setAttribute('vector-effect', 'non-scaling-stroke');
  withTip(box, `Title “${text}” — drag to move${state.ui.snap ? ' (Snap on)' : ''}, double-click to edit text`);
  L.overlay.appendChild(box);
}

// Visual feedback for the active snap: a magenta ring when welding to another
// anchor, or bright crosshair guide lines for axis-aligned snaps.
function renderSnapGuides(hint, upp) {
  const ab = state.scene.artboard, p = ab.padding;
  const x0 = p.left, x1 = ab.width - p.right, y0 = p.top, y1 = ab.height - p.bottom;
  const C = '#7CF5FF';
  if (hint.weld) {
    const w = normToUser(hint.weld.x, hint.weld.y);
    L.overlay.appendChild(el('circle', { cx: w.x, cy: w.y, r: 11 * upp, fill: 'none', stroke: '#ff5ed0', 'stroke-width': 2 * upp }));
    L.overlay.appendChild(el('circle', { cx: w.x, cy: w.y, r: 4 * upp, fill: '#ff5ed0' }));
    return;
  }
  if (hint.x != null) {
    const ux = normToUser(hint.x, 0).x;
    L.overlay.appendChild(el('line', { x1: ux, y1: y0, x2: ux, y2: y1, stroke: C, 'stroke-width': 1.2 * upp, 'stroke-opacity': 0.9 }));
  }
  if (hint.y != null) {
    const uy = normToUser(0, hint.y).y;
    L.overlay.appendChild(el('line', { x1: x0, y1: uy, x2: x1, y2: uy, stroke: C, 'stroke-width': 1.2 * upp, 'stroke-opacity': 0.9 }));
  }
}

// Fast geometry refresh during drag (no DOM rebuild → no jitter, keeps capture).
function refreshSelectedGeometry() {
  const curve = getSelected();
  if (!curve) return;
  const d = buildPathD(curve);
  const g = L.curves.querySelector(`g[data-curve="${curve.id}"]`);
  if (g) g.querySelectorAll('path').forEach((p) => p.setAttribute('d', d));
  const hp = L.hits && L.hits.querySelector(`path[data-hit="${curve.id}"]`);
  if (hp) hp.setAttribute('d', d);
  renderLabels(); // leader lines follow moved anchors
  renderOverlay();
}

function getSelected() { return state.scene.curves.find((c) => c.id === state.selectedCurveId) || null; }

/* ============================================================================
   [VIEW] zoom / pan
============================================================================ */

function applyView() {
  const v = state.view;
  svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  const ab = state.scene.artboard;
  const pct = Math.round((ab.width / v.w) * 100);
  document.getElementById('zoom-readout').textContent = pct + '%';
  renderOverlay(); // resize handles for new zoom
}

function resetView() {
  const ab = state.scene.artboard;
  state.view = { x: 0, y: 0, w: ab.width, h: ab.height };
  applyView();
}

function zoomBy(factor, cx, cy) {
  const v = state.view;
  // anchor zoom on a user-space point (defaults to center)
  cx = cx ?? v.x + v.w / 2;
  cy = cy ?? v.y + v.h / 2;
  const nw = clamp(v.w / factor, state.scene.artboard.width / 12, state.scene.artboard.width * 4);
  const nh = nw * (v.h / v.w);
  v.x = cx - (cx - v.x) * (nw / v.w);
  v.y = cy - (cy - v.y) * (nh / v.h);
  v.w = nw; v.h = nh;
  applyView();
}

// Convert a mouse/pointer event to artboard user coordinates via the SVG CTM.
function eventToUser(evt) {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const u = pt.matrixTransform(ctm.inverse());
  return { x: u.x, y: u.y };
}

/* ============================================================================
   [EDIT] pointer interactions
============================================================================ */

/**
 * Magnetic snapping for a dragged anchor. With Snap on, the anchor is attracted
 * (within ~9 screen px) to, in priority order:
 *   1. another curve's anchor — WELDS both x & y so two lines meet exactly
 *   2. independently on each axis: a milestone x, the phase divider / branch x,
 *      another anchor's x or y (alignment), or a grid line.
 * Returns { x, y, hint } where hint describes what was snapped (for the overlay
 * guide visuals). The pixel threshold is converted to normalized space per-axis
 * because the chart's width and height differ.
 */
const SNAP_PX = 9;
// PowerPoint-style smart snapping for any dragged item (anchor / curve label /
// milestone label). With Snap on, the item is attracted (within ~9 screen px) to:
//   • [anchors only] another curve's anchor — WELDS both x & y so lines meet
//   • per-axis alignment to other objects: anchors, curve labels, milestone
//     labels & milestone x's, the branch/divider x, the canvas center, grid lines
// A cyan guide line is drawn for whichever axis snapped. `exclude` keeps a
// dragged item from snapping to itself:
//   { kind:'anchor', curveId, anchorIdx } · { kind:'label', labelId } ·
//   { kind:'mslabel', milestoneId }
// Half extents (in normalized units) of a label/milestone text box, matching
// the on-canvas overlay grab boxes so snapped edges line up with what's drawn.
function curveLabelExtents(lab) {
  const ab = state.scene.artboard, p = ab.padding;
  const cw = ab.width - p.left - p.right, ch = ab.height - p.top - p.bottom;
  const size = lab.fontSize || 26;
  return { hw: Math.max(size * (lab.text || ' ').length * 0.3, size * 0.8) / cw, hh: (size * 0.7) / ch };
}
function milestoneExtents(ms) {
  const ab = state.scene.artboard, p = ab.padding;
  const cw = ab.width - p.left - p.right, ch = ab.height - p.top - p.bottom;
  const section = !!ms.color;
  const size = section ? 24 : (ms.phase === 'post' ? 17 : 20);
  return { hw: Math.max(size * (ms.label || ' ').length * 0.3, size) / cw, hh: (size * 0.8) / ch };
}

function computeSnap(n, exclude = {}) {
  if (!state.ui.snap) return { x: n.x, y: n.y, hint: null };
  const ab = state.scene.artboard, p = ab.padding, s = state.scene.style;
  const cw = ab.width - p.left - p.right, ch = ab.height - p.top - p.bottom;
  const upp = screenUnitsPerPx();
  const tx = (SNAP_PX * upp) / cw;  // x threshold in normalized units
  const ty = (SNAP_PX * upp) / ch;  // y threshold in normalized units
  const axisNormY = userToNorm(0, ab.height - p.bottom + 34).y; // where axis labels sit
  const isSelfAnchor = (c, j) => exclude.kind === 'anchor' && c.id === exclude.curveId && j === exclude.anchorIdx;
  const inJunction = (c, j) => exclude.kind === 'junction' && exclude.members.some((m) => m.curve === c && m.idx === j);
  const skipAnchor = (c, j) => isSelfAnchor(c, j) || inJunction(c, j);

  // 1) weld to another anchor — only when dragging an anchor
  if (exclude.kind === 'anchor') {
    let weld = null, weldD = Infinity;
    for (const c of state.scene.curves) {
      if (!c.visible) continue;
      c.anchors.forEach((a2, j) => {
        if (skipAnchor(c, j)) return;
        const dx = Math.abs(a2.x - n.x), dy = Math.abs(a2.y - n.y);
        if (dx <= tx && dy <= ty) {
          const d = (dx * dx) / (tx * tx) + (dy * dy) / (ty * ty);
          if (d < weldD) { weldD = d; weld = a2; }
        }
      });
    }
    if (weld) return { x: weld.x, y: weld.y, hint: { weld: { x: weld.x, y: weld.y } } };
  }

  // 2) per-axis alignment. Collect candidate guide coordinates. Labels and
  //    milestones contribute their left/center/right & top/middle/bottom edges
  //    (not just centers) so left/right alignment against them is detected.
  const xTargets = [], yTargets = [];
  const pushX = (x) => xTargets.push(x);
  const pushY = (y) => yTargets.push(y);
  const pushPt = (x, y) => { pushX(x); pushY(y); };
  const pushBox = (cx, cy, e) => { pushX(cx - e.hw); pushX(cx); pushX(cx + e.hw); pushY(cy - e.hh); pushY(cy); pushY(cy + e.hh); };
  // anchors (points — center only)
  for (const c of state.scene.curves) {
    if (!c.visible) continue;
    c.anchors.forEach((a2, j) => { if (skipAnchor(c, j)) return; pushPt(a2.x, a2.y); });
  }
  // curve label boxes
  for (const c of state.scene.curves) {
    if (!c.visible || !c.labels) continue;
    for (const lab of c.labels) { if (lab.id === exclude.labelId) continue; pushBox(lab.x, lab.y, curveLabelExtents(lab)); }
  }
  // milestone guide-x + label boxes
  for (const m of state.scene.milestones) {
    if (m.visible === false || m.id === exclude.milestoneId) continue;
    pushX(m.x); // the tick / guide line
    pushBox(m.x, m.y == null ? axisNormY : m.y, milestoneExtents(m));
  }
  // phase divider / branch x
  if (state.scene.regions) {
    if (state.scene.regions.branchX != null) xTargets.push(state.scene.regions.branchX);
    if (state.scene.regions.branch) xTargets.push(state.scene.regions.branch.x);
  }
  // canvas center + grid lines
  xTargets.push(0.5); yTargets.push(0.5);
  for (let i = 0; i <= s.gridX; i++) xTargets.push(i / s.gridX);
  for (let j = 0; j <= s.gridY; j++) yTargets.push(j / s.gridY);

  // The dragged item snaps by whichever of its own edges lands on a target. A
  // point (anchor / junction) has zero extent → only its center participates.
  const hw = exclude.hw || 0, hh = exclude.hh || 0;
  const xEdges = hw > 0 ? [-hw, 0, hw] : [0];
  const yEdges = hh > 0 ? [-hh, 0, hh] : [0];
  let rx = n.x, ry = n.y, snapX = null, snapY = null, dxBest = tx, dyBest = ty;
  for (const xt of xTargets) for (const e of xEdges) {
    const center = xt - e, d = Math.abs(center - n.x);
    if (d < dxBest) { dxBest = d; rx = center; snapX = xt; }
  }
  for (const yt of yTargets) for (const e of yEdges) {
    const center = yt - e, d = Math.abs(center - n.y);
    if (d < dyBest) { dyBest = d; ry = center; snapY = yt; }
  }

  const hint = (snapX != null || snapY != null) ? { x: snapX, y: snapY } : null;
  return { x: rx, y: ry, hint };
}

svg.addEventListener('pointerdown', (evt) => {
  const target = evt.target;

  // 0) clicking a welded junction toggles its floating joint handle (not a drag)
  if (target.dataset && target.dataset.kind === 'junctionHit') {
    state.activeJunction = state.activeJunction === target.dataset.jid ? null : target.dataset.jid;
    renderOverlay();
    return;
  }

  // 0b) double-click a text element (label / milestone / title) → edit in place.
  // Detected here (not via a native dblclick listener) because these elements are
  // re-rendered on every pointer-up, which would break dblclick targeting.
  const ekind = target.dataset && target.dataset.kind;
  if (ekind === 'label' || ekind === 'mslabel' || ekind === 'title') {
    const key = ekind + ':' + (target.dataset.msid || target.dataset.lidx || 'title');
    if (isDoubleTap(key, evt.timeStamp)) {
      evt.preventDefault();
      startInPlaceEditForTarget(target);
      return; // edit instead of starting a drag
    }
  }

  // 1) overlay handle / anchor / label drag
  if (target.dataset && target.dataset.kind) {
    evt.preventDefault();
    try { svg.setPointerCapture(evt.pointerId); } catch (_) {}
    drag = { type: 'edit', kind: target.dataset.kind, idx: +target.dataset.idx, lidx: +target.dataset.lidx, msid: target.dataset.msid, jid: target.dataset.jid };
    // for labels, remember where in the word it was grabbed so it doesn't jump
    if (drag.kind === 'label') {
      const c = getSelected();
      const lab = c && c.labels && c.labels[drag.lidx];
      const u = eventToUser(evt); const n = userToNorm(u.x, u.y);
      drag.offset = lab ? { x: lab.x - n.x, y: lab.y - n.y } : { x: 0, y: 0 };
    } else if (drag.kind === 'mslabel') {
      const ms = state.scene.milestones.find((m) => m.id === drag.msid);
      const ab = state.scene.artboard, p = ab.padding;
      const u = eventToUser(evt); const n = userToNorm(u.x, u.y);
      // axis-docked labels (no y) report their on-axis height so the grab doesn't jump
      const curY = ms.y == null ? userToNorm(0, ab.height - p.bottom + 34).y : ms.y;
      drag.offset = ms ? { x: ms.x - n.x, y: curY - n.y } : { x: 0, y: 0 };
    } else if (drag.kind === 'title') {
      const ti = state.scene.title;
      const u = eventToUser(evt); const n = userToNorm(u.x, u.y);
      drag.offset = ti ? { x: ti.x - n.x, y: ti.y - n.y } : { x: 0, y: 0 };
    } else if (drag.kind === 'junctionHandle') {
      const J = (state._junctions || []).find((j) => j.id === drag.jid);
      const u = eventToUser(evt); const n = userToNorm(u.x, u.y);
      // the grip floats above the junction; remember the junction's true position
      drag.offset = J ? { x: J.x - n.x, y: J.y - n.y } : { x: 0, y: 0 };
    }
    return;
  }

  // 2) clicking a curve selects it
  if (target.dataset && target.dataset.hit) {
    state.activeJunction = null;
    selectCurve(target.dataset.hit);
    return;
  }

  // 3) empty space → pan (and dismiss any active junction handle)
  if (state.activeJunction) { state.activeJunction = null; renderOverlay(); }
  evt.preventDefault();
  try { svg.setPointerCapture(evt.pointerId); } catch (_) {}
  svg.classList.add('panning');
  drag = { type: 'pan', start: eventToUser(evt), startView: { ...state.view } };
});

svg.addEventListener('pointermove', (evt) => {
  if (!drag) return;

  if (drag.type === 'pan') {
    // pan by the pixel delta converted to user-space units
    const v = state.view;
    const rect = svg.getBoundingClientRect();
    const upp = v.w / rect.width; // user units per on-screen pixel
    v.x -= evt.movementX * upp;
    v.y -= evt.movementY * upp;
    applyView();
    return;
  }

  if (drag.type === 'edit') {
    const u = eventToUser(evt);
    let n = userToNorm(u.x, u.y);
    n.x = clamp(n.x, -0.1, 1.1); n.y = clamp(n.y, -0.1, 1.15); // a bit of slack into the padding

    // the floating joint handle drags every welded anchor at once; the spline
    // tension re-derives smooth handles through the moved junction (easing).
    if (drag.kind === 'junctionHandle') {
      const J = (state._junctions || []).find((j) => j.id === drag.jid);
      if (J) {
        const off = drag.offset || { x: 0, y: 0 };
        const sn = computeSnap({ x: n.x + off.x, y: n.y + off.y }, { kind: 'junction', members: J.members });
        const nx = clamp(sn.x, -0.1, 1.1), ny = clamp(sn.y, -0.1, 1.15);
        const dx = nx - J.x, dy = ny - J.y;
        for (const m of J.members) {
          const pt = m.curve.anchors[m.idx];
          pt.x += dx; pt.y += dy;
          if (pt.hIn) { pt.hIn.x += dx; pt.hIn.y += dy; }
          if (pt.hOut) { pt.hOut.x += dx; pt.hOut.y += dy; }
        }
        J.x = nx; J.y = ny;
        drag.snapHint = sn.hint;
        renderCurves(); renderLabels(); renderOverlay();
      }
      return;
    }

    // the visual title moves independently of any selected curve, and obeys Snap
    if (drag.kind === 'title') {
      const ti = state.scene.title;
      if (ti) {
        const off = drag.offset || { x: 0, y: 0 };
        const tab = state.scene.artboard, tp = tab.padding;
        const tsize = ti.fontSize || 56;
        const tHw = Math.max(tsize * ((state.scene.meta && state.scene.meta.name || '').length) * 0.32, tsize) / (tab.width - tp.left - tp.right);
        const tHh = (tsize * 0.8) / (tab.height - tp.top - tp.bottom);
        const sn = computeSnap({ x: n.x + off.x, y: n.y + off.y }, { kind: 'title', hw: tHw, hh: tHh });
        ti.x = clamp(sn.x, -0.1, 1.1);
        ti.y = clamp(sn.y, -0.1, 1.15);
        drag.snapHint = sn.hint;
        renderTitle(); renderOverlay();
      }
      return;
    }

    // milestone labels move independently of any selected curve, and obey Snap
    if (drag.kind === 'mslabel') {
      const ms = state.scene.milestones.find((m) => m.id === drag.msid);
      if (ms) {
        const off = drag.offset || { x: 0, y: 0 };
        const me = milestoneExtents(ms);
        const sn = computeSnap({ x: n.x + off.x, y: n.y + off.y }, { kind: 'mslabel', milestoneId: ms.id, hw: me.hw, hh: me.hh });
        ms.x = clamp(sn.x, -0.05, 1.05);
        ms.y = clamp(sn.y, -0.05, 1.05); // dragging gives a milestone a fixed label height
        // PowerPoint-style equal-spacing snap (x only) takes priority over a
        // weaker alignment snap, so labels distribute evenly within the layer.
        const eq = equalSpacingSnapX(ms, ms.x, screenUnitsPerPx());
        if (eq != null) ms.x = clamp(eq, -0.05, 1.05);
        drag.snapHint = sn.hint;
        renderGuides(); renderOverlay();
      }
      return;
    }

    const curve = getSelected();
    if (!curve) return;

    // curve labels move freely, and obey Snap (alignment guides + welds)
    if (drag.kind === 'label') {
      const lab = curve.labels && curve.labels[drag.lidx];
      if (lab) {
        const off = drag.offset || { x: 0, y: 0 };
        const le = curveLabelExtents(lab);
        const sn = computeSnap({ x: n.x + off.x, y: n.y + off.y }, { kind: 'label', labelId: lab.id, hw: le.hw, hh: le.hh });
        lab.x = clamp(sn.x, -0.05, 1.05);
        lab.y = clamp(sn.y, -0.05, 1.05);
        drag.snapHint = sn.hint;
        renderLabels(); renderOverlay();
      }
      return;
    }

    const pt = curve.anchors[drag.idx];

    if (drag.kind === 'anchor') {
      const sn = computeSnap(n, { kind: 'anchor', curveId: curve.id, anchorIdx: drag.idx });
      n.x = sn.x; n.y = sn.y;
      drag.snapHint = sn.hint; // drives the overlay snap guides
      const dx = n.x - pt.x, dy = n.y - pt.y;
      pt.x = n.x; pt.y = n.y;
      // move handles with the anchor (keep their relative offset)
      if (pt.hIn)  { pt.hIn.x += dx;  pt.hIn.y += dy; }
      if (pt.hOut) { pt.hOut.x += dx; pt.hOut.y += dy; }
    } else {
      // dragging a bezier handle
      ensureExplicitHandles(curve);
      pt[drag.kind] = { x: n.x, y: n.y };
      if (pt.mirror) {
        const other = drag.kind === 'hOut' ? 'hIn' : 'hOut';
        pt[other] = { x: 2 * pt.x - n.x, y: 2 * pt.y - n.y };
      }
    }
    refreshSelectedGeometry();
    return;
  }
});

function endDrag(evt) {
  if (!drag) return;
  if (evt && evt.pointerId != null) { try { svg.releasePointerCapture(evt.pointerId); } catch (_) {} }
  svg.classList.remove('panning');
  const wasEdit = drag.type === 'edit';
  const wasMs = drag.kind === 'mslabel';
  drag = null;
  if (wasEdit) { renderOverlay(); scheduleAutosave(); } // renderOverlay clears snap guides
  if (wasMs) syncMilestones(); // its x/y fields in the panel changed
}
svg.addEventListener('pointerup', endDrag);
svg.addEventListener('pointercancel', endDrag);

// wheel zoom centered on cursor (disabled when zoom is locked)
svg.addEventListener('wheel', (evt) => {
  if (state.ui.zoomLock) return; // locked → let the page/trackpad do nothing here
  evt.preventDefault();
  const u = eventToUser(evt);
  zoomBy(evt.deltaY < 0 ? 1.12 : 1 / 1.12, u.x, u.y);
}, { passive: false });

/* ============================================================================
   [UI] control panel
============================================================================ */

function selectCurve(id) {
  state.selectedCurveId = id;
  renderCurves();      // selection emphasis
  renderOverlay();
  syncCanvasList();
  syncPropsPanel();
}

/* ---- in-place text editing ---- */

// Manual double-click detection keyed by a logical identity (not the DOM node),
// because the clicked element is often re-rendered between the two clicks (the
// overlay rebuilds on pointer-up; the layer list rebuilds on select), which
// suppresses the native `dblclick` event.
let _dtap = { key: null, t: 0 };
function isDoubleTap(key, ts) {
  const dbl = _dtap.key === key && (ts - _dtap.t) < 450;
  _dtap = dbl ? { key: null, t: 0 } : { key, t: ts };
  return dbl;
}

// Start the right in-place editor for an on-canvas overlay element.
function startInPlaceEditForTarget(el) {
  const kind = el.dataset.kind;
  if (kind === 'label') {
    const cur = getSelected(); const l = cur && cur.labels && cur.labels[+el.dataset.lidx];
    if (l) startCanvasTextEdit(el, l.text, (val) => { l.text = val; renderLabels(); renderOverlay(); syncLabels(); scheduleAutosave(); });
  } else if (kind === 'mslabel') {
    const ms = state.scene.milestones.find((m) => m.id === el.dataset.msid);
    if (ms) startCanvasTextEdit(el, ms.label, (val) => { ms.label = val; renderGuides(); renderOverlay(); syncMilestones(); scheduleAutosave(); });
  } else if (kind === 'title') {
    startCanvasTextEdit(el, (state.scene.meta && state.scene.meta.name) || '', (val) => {
      state.scene.meta = state.scene.meta || {}; state.scene.meta.name = val;
      syncVisualName(); renderTitle(); renderOverlay(); scheduleAutosave();
    });
  }
}

// Float a text input over an on-canvas element (label / milestone / title) so
// it can be edited where it sits. Commits on Enter or blur, cancels on Esc.
let activeTextEdit = null;
function startCanvasTextEdit(svgEl, current, commit) {
  if (activeTextEdit) activeTextEdit.cancel();
  const rect = svgEl.getBoundingClientRect();
  const input = document.createElement('input');
  input.type = 'text'; input.value = current || ''; input.className = 'canvas-text-edit';
  Object.assign(input.style, {
    left: Math.round(rect.left) + 'px', top: Math.round(rect.top) + 'px',
    width: Math.max(Math.round(rect.width), 90) + 'px', height: Math.max(Math.round(rect.height), 26) + 'px',
  });
  document.body.appendChild(input);
  input.focus(); input.select();
  let done = false;
  const finish = (save) => {
    if (done) return; done = true;
    input.remove(); activeTextEdit = null;
    if (save) commit(input.value);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  activeTextEdit = { cancel: () => finish(false) };
}

// Swap a list-row name span for an input to rename it inline (Composition).
function inlineEditSpan(span, current, commit) {
  const input = document.createElement('input');
  input.type = 'text'; input.value = current || ''; input.className = 'layer-name-input';
  span.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const finish = (save) => {
    if (done) return; done = true;
    if (save) commit(input.value); else syncCanvasList();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

function syncCanvasList() {
  const list = document.getElementById('layer-list');
  list.innerHTML = '';

  const makeRow = (curve) => {
    const li = document.createElement('li');
    li.className = 'layer-item' + (curve.id === state.selectedCurveId ? ' selected' : '');
    li.dataset.id = curve.id;
    li.title = 'Select this curve (then drag its dots on the canvas to edit)';

    const sw = document.createElement('span');
    sw.className = 'layer-swatch';
    sw.style.background = curve.color; sw.style.color = curve.color;
    sw.style.opacity = curve.visible ? '1' : '0.3';

    const nm = document.createElement('span');
    nm.className = 'layer-name';
    nm.textContent = curve.name;
    nm.title = 'Click to select · double-click to rename';

    const vis = document.createElement('button');
    vis.className = 'layer-vis' + (curve.visible ? ' on' : '');
    vis.textContent = curve.visible ? '👁' : '◌';
    vis.title = 'Toggle visibility';
    vis.addEventListener('click', (e) => { e.stopPropagation(); curve.visible = !curve.visible; renderCurves(); syncCanvasList(); scheduleAutosave(); });

    li.append(sw, nm, vis);
    li.addEventListener('click', (e) => {
      // double-click a row → rename it inline (detected manually because the list
      // is rebuilt on select, which would destroy the element mid-dblclick)
      if (isDoubleTap('curve:' + curve.id, e.timeStamp)) {
        selectCurve(curve.id); // ensure selected + rebuild
        const span = document.querySelector(`#layer-list .layer-item[data-id="${curve.id}"] .layer-name`);
        if (span) inlineEditSpan(span, curve.name, (val) => {
          curve.name = val.trim() || curve.name;
          renderLabels(); syncCanvasList(); syncPropsPanel(); scheduleAutosave();
        });
        return;
      }
      selectCurve(curve.id);
    });
    return li;
  };

  // Group curves by canvas, in scene.canvases order. Each canvas header has an
  // editable name, a whole-canvas visibility toggle, and a delete button.
  for (const canvas of sceneCanvases()) {
    const members = state.scene.curves.filter((c) => c.group === canvas.id);

    const head = document.createElement('li');
    head.className = 'layer-group-head';

    const nameInput = document.createElement('input');
    nameInput.type = 'text'; nameInput.value = canvas.name; nameInput.className = 'layer-name-input';
    nameInput.title = 'Rename this canvas (also updates the Milestones grouping)';
    nameInput.addEventListener('input', () => { canvas.name = nameInput.value; syncMilestones(); syncPropsPanel(); syncBandAxisControls(); renderAxes(); scheduleAutosave(); });

    const allVisible = members.length && members.every((c) => c.visible);
    const gvis = document.createElement('button');
    gvis.className = 'layer-vis' + (allVisible ? ' on' : '');
    gvis.textContent = allVisible ? '👁' : '◌';
    gvis.title = 'Show / hide all curves in this canvas';
    gvis.addEventListener('click', (e) => { e.stopPropagation(); members.forEach((c) => c.visible = !allVisible); renderCurves(); syncCanvasList(); scheduleAutosave(); });

    const del = document.createElement('button');
    del.className = 'ms-del'; del.textContent = '✕'; del.title = 'Delete this canvas (its curves & milestones move to the first canvas)';
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteCanvas(canvas.id); });

    head.append(nameInput, gvis, del);
    list.appendChild(head);

    // front-most (later in array) shown at top within each canvas
    [...members].reverse().forEach((c) => list.appendChild(makeRow(c)));
  }
  syncAddCanvasButton();
}

// --- canvas (group) management ---
const MAX_CANVASES = 3;
function syncAddCanvasButton() {
  const b = document.querySelector('[data-action="add-canvas"]');
  if (b) b.disabled = sceneCanvases().length >= MAX_CANVASES;
}
function addCanvas() {
  if (sceneCanvases().length >= MAX_CANVASES) { alert(`A composition is limited to ${MAX_CANVASES} canvases.`); return; }
  state.scene.canvases.push({ id: uid('canvas'), name: 'New Canvas' });
  renderAll(); syncCanvasList(); syncMilestones(); syncPropsPanel(); syncRegionControls(); scheduleAutosave();
}
function deleteCanvas(id) {
  if (sceneCanvases().length <= 1) { alert('At least one canvas is required.'); return; }
  const canvas = sceneCanvases().find((l) => l.id === id);
  const fallback = sceneCanvases().find((l) => l.id !== id).id;
  const nCurves = state.scene.curves.filter((c) => c.group === id).length;
  const nMs = state.scene.milestones.filter((m) => m.group === id).length;
  if ((nCurves || nMs) && !confirm(`Delete canvas “${canvas.name}”? Its ${nCurves} curve(s) and ${nMs} milestone(s) will move to “${canvasName(fallback)}”.`)) return;
  state.scene.curves.forEach((c) => { if (c.group === id) c.group = fallback; });
  state.scene.milestones.forEach((m) => { if (m.group === id) m.group = fallback; });
  state.scene.canvases = sceneCanvases().filter((l) => l.id !== id);
  renderAll(); syncCanvasList(); syncMilestones(); syncPropsPanel(); syncRegionControls(); scheduleAutosave();
}

function syncPropsPanel() {
  const curve = getSelected();
  const empty = document.getElementById('props-empty');
  const props = document.getElementById('props');
  if (!curve) { empty.hidden = false; props.hidden = true; return; }
  empty.hidden = true; props.hidden = false;

  document.getElementById('p-name').value = curve.name;
  document.getElementById('p-color').value = curve.color;
  document.getElementById('p-opacity').value = curve.opacity;
  document.getElementById('p-width').value = curve.strokeWidth;
  document.getElementById('p-width-val').textContent = curve.strokeWidth;
  document.getElementById('p-glow').value = curve.glow;
  document.getElementById('p-glow-val').textContent = curve.glow;
  document.getElementById('p-blend').value = curve.blendMode || 'normal';
  document.getElementById('p-smoothing').value = curve.smoothing;
  // rebuild the Layer dropdown from the current scene layers
  const pg = document.getElementById('p-group');
  pg.innerHTML = '';
  for (const l of sceneCanvases()) { const o = document.createElement('option'); o.value = l.id; o.textContent = l.name; pg.appendChild(o); }
  pg.value = curve.group;
  document.getElementById('p-role').value = curve.role || 'accent';
  document.getElementById('p-easing').value = curve.easing || '';
  document.getElementById('p-highlight').checked = !!curve.highlight;
  document.getElementById('p-mirror').checked = !!curve.anchors.some((p) => p.mirror);
  document.getElementById('anchor-readout').textContent = curve.anchors.length + ' anchors';
  syncLabels();
}

// --- property field bindings ---
function bindProp(id, fn) {
  document.getElementById(id).addEventListener('input', () => {
    const curve = getSelected(); if (!curve) return;
    fn(curve, document.getElementById(id));
    renderCurves(); renderOverlay(); scheduleAutosave();
  });
}
bindProp('p-name', (c, e) => { c.name = e.value; syncCanvasList(); });
bindProp('p-color', (c, e) => { c.color = e.value; syncCanvasList(); });
bindProp('p-opacity', (c, e) => { c.opacity = +e.value; });
bindProp('p-width', (c, e) => { c.strokeWidth = +e.value; document.getElementById('p-width-val').textContent = e.value; });
bindProp('p-glow', (c, e) => { c.glow = +e.value; document.getElementById('p-glow-val').textContent = e.value; });
bindProp('p-blend', (c, e) => { c.blendMode = e.value; });
bindProp('p-highlight', (c, e) => { c.highlight = e.checked; });
document.getElementById('p-group').addEventListener('change', (e) => {
  const c = getSelected(); if (!c) return;
  c.group = e.target.value;
  syncCanvasList(); scheduleAutosave();
});
document.getElementById('p-role').addEventListener('change', (e) => {
  const c = getSelected(); if (!c) return;
  c.role = e.target.value;
  // give immediate feedback by recoloring from the active theme's role color
  const t = getThemeById(state.scene.theme);
  if (t && t.roles[c.role]) { c.color = t.roles[c.role]; document.getElementById('p-color').value = c.color; }
  renderCurves(); renderLabels(); syncCanvasList(); scheduleAutosave();
});
document.getElementById('p-smoothing').addEventListener('change', (e) => {
  const c = getSelected(); if (!c) return;
  if (e.target.value === 'bezier') ensureExplicitHandles(c);
  c.smoothing = e.target.value;
  renderCurves(); renderOverlay(); scheduleAutosave();
});
document.getElementById('p-mirror').addEventListener('change', (e) => {
  const c = getSelected(); if (!c) return;
  c.anchors.forEach((p) => p.mirror = e.target.checked);
  scheduleAutosave();
});
document.getElementById('p-easing').addEventListener('change', (e) => {
  const c = getSelected(); if (!c || !e.target.value) return;
  applyEasing(c, e.target.value); // stores c.easing + c.tension and (bezier) bakes handles
  renderCurves(); renderOverlay(); scheduleAutosave();
});

// --- layer actions ---
function addCurve(src) {
  const base = src || {
    name: 'New Curve', color: '#9d8bff', strokeWidth: 4, glow: 12, opacity: 1,
    blendMode: 'screen', visible: true, locked: false, smoothing: 'spline', highlight: false,
    group: getSelected()?.group || sceneCanvases()[0]?.id || 'primary',
    anchors: [ a(0.0, 0.2), a(0.5, 0.5), a(1.0, 0.7) ],
  };
  const c = clone(base);
  c.id = uid('c');
  if (src) c.name = src.name + ' copy';
  state.scene.curves.push(c);
  selectCurve(c.id);
  renderCurves(); syncCanvasList();
  scheduleAutosave();
}

const actions = {
  'undo': () => History.doUndo(),
  'redo': () => History.doRedo(),
  'zoom-in':  () => zoomBy(1.2),
  'zoom-out': () => zoomBy(1 / 1.2),
  'reset-view': resetView,
  'toggle-zoomlock': () => {
    state.ui.zoomLock = !state.ui.zoomLock;
    try { localStorage.setItem('crucible-zoomlock', state.ui.zoomLock ? '1' : '0'); } catch (_) {}
    syncZoomLock();
  },
  'add-curve': () => addCurve(),
  'add-canvas': () => addCanvas(),
  'dup-curve': () => { const c = getSelected(); if (c) addCurve(c); },
  'del-curve': () => {
    const c = getSelected(); if (!c) return;
    state.scene.curves = state.scene.curves.filter((x) => x.id !== c.id);
    state.selectedCurveId = state.scene.curves.length ? state.scene.curves[state.scene.curves.length - 1].id : null;
    renderCurves(); syncCanvasList(); syncPropsPanel(); renderOverlay(); scheduleAutosave();
  },
  'up-curve':   () => reorder(+1),
  'down-curve': () => reorder(-1),
  'add-anchor': () => { const c = getSelected(); if (!c) return; addAnchorToCurve(c); },
  'add-label': () => { const c = getSelected(); if (!c) return; addLabelToCurve(c); },
  'del-anchor': () => {
    const c = getSelected(); if (!c || c.anchors.length <= 2) return;
    c.anchors.pop();
    renderCurves(); renderOverlay(); syncPropsPanel(); scheduleAutosave();
  },
  'save-theme': () => saveThemeFromScene(),
  'del-theme': () => deleteCurrentTheme(),
  'add-milestone': () => {
    const group = getSelected()?.group || sceneCanvases()[0]?.id || 'primary';
    const ms = { id: uid('ms'), label: 'New', x: 0.5, showGuide: true, phase: 'primary', group };
    state.scene.milestones.push(ms);
    state.selectedMilestoneId = ms.id;
    renderGuides(); syncMilestones(); scheduleAutosave();
  },
  'ms-up':   () => { const m = selectedMilestone(); if (m) milestoneMove(m, -1); },
  'ms-down': () => { const m = selectedMilestone(); if (m) milestoneMove(m, +1); },
  'ms-del':  () => {
    const m = selectedMilestone(); if (!m) return;
    state.scene.milestones = state.scene.milestones.filter((x) => x.id !== m.id);
    state.selectedMilestoneId = null;
    renderGuides(); syncMilestones(); scheduleAutosave();
  },
  'save-scene': saveScene,
  'load-scene': () => document.getElementById('file-input').click(),
  'reset-scene': () => { if (confirm('Reload the starter scene? Unsaved edits will be lost.')) { loadScene(clone(DEFAULT_SCENE)); } },
  'export-svg-clean': () => exportSVG('clean'),
  'export-svg-pres':  () => exportSVG('presentation'),
  'export-png-trans': () => exportPNG(false),
  'export-png-full':  () => exportPNG(true),
};

// Insert a new anchor at the midpoint of the longest gap (keeps shape sane).
function addAnchorToCurve(c) {
  let gi = 0, gmax = -1;
  for (let i = 0; i < c.anchors.length - 1; i++) {
    const dx = c.anchors[i + 1].x - c.anchors[i].x;
    const dy = c.anchors[i + 1].y - c.anchors[i].y;
    const dd = dx * dx + dy * dy;
    if (dd > gmax) { gmax = dd; gi = i; }
  }
  const p1 = c.anchors[gi], p2 = c.anchors[gi + 1];
  const mid = a((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
  c.anchors.splice(gi + 1, 0, mid);
  renderCurves(); renderOverlay(); syncPropsPanel(); scheduleAutosave();
}

// Create a word label anchored near the curve's middle anchor, offset upward
// so it doesn't sit directly on the stroke. Then it's freely draggable.
function addLabelToCurve(c) {
  c.labels = c.labels || [];
  const ai = Math.floor(c.anchors.length / 2);
  const at = c.anchors[ai] || c.anchors[0] || { x: 0.5, y: 0.5 };
  c.labels.push({
    id: uid('lab'), text: c.name, anchor: ai,
    x: clamp(at.x, 0, 1), y: clamp(at.y + 0.07, 0, 1),
    fontSize: 26, glow: true, leader: false, align: 'middle', bold: true,
  });
  renderLabels(); renderOverlay(); syncLabels(); scheduleAutosave();
}

// Render the editable list of a curve's labels in the props panel.
function syncLabels() {
  const list = document.getElementById('label-list');
  if (!list) return;
  list.innerHTML = '';
  const c = getSelected();
  if (!c || !c.labels) return;

  c.labels.forEach((lab, i) => {
    const li = document.createElement('li');
    li.className = 'label-item';

    const text = document.createElement('input');
    text.type = 'text'; text.value = lab.text; text.placeholder = 'word…'; text.title = 'Label text';
    text.addEventListener('input', () => { lab.text = text.value; renderLabels(); scheduleAutosave(); });

    const del = document.createElement('button');
    del.className = 'ms-del'; del.textContent = '✕'; del.title = 'Delete this label';
    del.addEventListener('click', () => { c.labels.splice(i, 1); renderLabels(); renderOverlay(); syncLabels(); scheduleAutosave(); });

    const row1 = document.createElement('div'); row1.className = 'label-row';
    row1.append(text, del);

    // size + glow + leader
    const size = document.createElement('input');
    size.type = 'number'; size.min = 8; size.max = 120; size.step = 1; size.value = lab.fontSize; size.title = 'font size';
    size.addEventListener('input', () => { lab.fontSize = clamp(+size.value || 26, 8, 200); renderLabels(); scheduleAutosave(); });

    const glow = document.createElement('label'); glow.className = 'chk'; glow.title = 'Add a glow behind the label (matches the curve)';
    const gcb = document.createElement('input'); gcb.type = 'checkbox'; gcb.checked = lab.glow !== false;
    gcb.addEventListener('change', () => { lab.glow = gcb.checked; renderLabels(); scheduleAutosave(); });
    glow.append(gcb, document.createTextNode(' glow'));

    const lead = document.createElement('label'); lead.className = 'chk'; lead.title = 'Draw a thin leader line from the label back to its homing anchor';
    const lcb = document.createElement('input'); lcb.type = 'checkbox'; lcb.checked = !!lab.leader;
    lcb.addEventListener('change', () => { lab.leader = lcb.checked; renderLabels(); scheduleAutosave(); });
    lead.append(lcb, document.createTextNode(' leader'));

    const row2 = document.createElement('div'); row2.className = 'label-row';
    row2.append(size, glow, lead);

    // row 3: homing-anchor stepper — shift the label along the curve's anchors.
    // ◀ / ▶ change which anchor the label homes to and reposition it there.
    const n = c.anchors.length;
    const moveToAnchor = (idx) => {
      idx = clamp(idx, 0, n - 1);
      lab.anchor = idx;
      const at = c.anchors[idx];
      if (at) { lab.x = at.x; lab.y = clamp(at.y + 0.07, -0.05, 1.05); }
      renderLabels(); renderOverlay(); syncLabels(); scheduleAutosave();
    };
    const prev = document.createElement('button');
    prev.className = 'btn small'; prev.textContent = '◀'; prev.title = 'Home to the previous anchor';
    prev.addEventListener('click', () => moveToAnchor((lab.anchor ?? 0) - 1));
    const cur = lab.anchor == null ? 0 : lab.anchor;
    const idxLabel = document.createElement('span');
    idxLabel.className = 'muted'; idxLabel.style.fontSize = '11px';
    idxLabel.textContent = `anchor ${cur + 1}/${n}`;
    const next = document.createElement('button');
    next.className = 'btn small'; next.textContent = '▶'; next.title = 'Home to the next anchor';
    next.addEventListener('click', () => moveToAnchor((lab.anchor ?? 0) + 1));
    const homeBtn = document.createElement('button');
    homeBtn.className = 'btn small'; homeBtn.textContent = '⤓'; homeBtn.title = 'Snap label back onto its current homing anchor';
    homeBtn.addEventListener('click', () => moveToAnchor(lab.anchor ?? 0));

    const row3 = document.createElement('div'); row3.className = 'label-row';
    row3.append(prev, idxLabel, next, homeBtn);

    li.append(row1, row2, row3);
    list.appendChild(li);
  });
}

// Move the selected curve one step in the Composition list. Within a canvas it
// swaps draw order; at a canvas boundary it crosses into the adjacent canvas
// (changing the curve's group) so ▲▼ can relocate a curve between canvases.
// dir: +1 = up the list (toward the top), -1 = down.
function reorder(dir) {
  const c = getSelected(); if (!c) return;
  const arr = state.scene.curves;
  const canvases = sceneCanvases();
  const li = canvases.findIndex((l) => l.id === c.group);
  // members of c's canvas, top→bottom as rendered (array order reversed)
  const vis = arr.filter((x) => x.group === c.group).reverse();
  const vi = vis.indexOf(c);

  const swap = (other) => { const i = arr.indexOf(c), j = arr.indexOf(other); arr[i] = other; arr[j] = c; };
  // Move c next to its new canvas's block at a visual end ('top' or 'bottom').
  const moveToCanvasEnd = (canvasId, end) => {
    c.group = canvasId;
    const k = arr.indexOf(c); arr.splice(k, 1);
    const members = arr.filter((x) => x.group === canvasId);
    if (!members.length) { arr.push(c); return; }
    if (end === 'bottom') arr.splice(arr.indexOf(members[0]), 0, c);        // visual bottom = first in array
    else arr.splice(arr.indexOf(members[members.length - 1]) + 1, 0, c);    // visual top = last in array
  };

  if (dir > 0) {                    // UP
    if (vi > 0) swap(vis[vi - 1]);
    else if (li > 0) moveToCanvasEnd(canvases[li - 1].id, 'bottom');
    else return;
  } else {                          // DOWN
    if (vi < vis.length - 1) swap(vis[vi + 1]);
    else if (li < canvases.length - 1) moveToCanvasEnd(canvases[li + 1].id, 'top');
    else return;
  }
  renderCurves(); renderOverlay(); syncCanvasList(); syncPropsPanel(); scheduleAutosave();
}

// toolbar/button delegation
document.body.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const fn = actions[btn.dataset.action];
  if (fn) fn();
});

// --- toggle checkboxes ---
const toggleMap = { 't-grid': 'grid', 't-axes': 'axes', 't-guides': 'guides', 't-bg': 'background', 't-glow': 'glow', 't-labels': 'labels', 't-snap': 'snap', 't-solo': 'solo' };
for (const [id, key] of Object.entries(toggleMap)) {
  document.getElementById(id).addEventListener('change', (e) => {
    state.ui[key] = e.target.checked;
    renderAll();
  });
}

// --- milestones list (grouped by the SAME canvases as Composition) ---
// Move a milestone one step in the Milestones list — same UX as Composition:
// reorder within its canvas, and at a canvas boundary cross into the adjacent
// canvas (changing its group). dir: -1 = up, +1 = down.
function milestoneMove(ms, dir) {
  const arr = state.scene.milestones;
  const canvases = sceneCanvases();
  const li = canvases.findIndex((l) => l.id === ms.group);
  const members = arr.filter((m) => m.group === ms.group); // visual order = array order
  const vi = members.indexOf(ms);

  const swap = (other) => { const i = arr.indexOf(ms), j = arr.indexOf(other); [arr[i], arr[j]] = [arr[j], arr[i]]; };
  const moveToCanvasEnd = (canvasId, end) => {
    ms.group = canvasId;
    const k = arr.indexOf(ms); arr.splice(k, 1);
    const mem = arr.filter((m) => m.group === canvasId);
    if (!mem.length) { arr.push(ms); return; }
    if (end === 'top') arr.splice(arr.indexOf(mem[0]), 0, ms);
    else arr.splice(arr.indexOf(mem[mem.length - 1]) + 1, 0, ms);
  };

  if (dir < 0) {                    // UP
    if (vi > 0) swap(members[vi - 1]);
    else if (li > 0) moveToCanvasEnd(canvases[li - 1].id, 'bottom');
    else return;
  } else {                          // DOWN
    if (vi < members.length - 1) swap(members[vi + 1]);
    else if (li < canvases.length - 1) moveToCanvasEnd(canvases[li + 1].id, 'top');
    else return;
  }
  renderGuides(); syncMilestones(); scheduleAutosave();
}

function syncMilestones() {
  const list = document.getElementById('milestone-list');
  list.innerHTML = '';

  // Compact, selectable single-line row (mirrors Composition): visibility ·
  // label · x · y · guide. The layer is shown by the group header, and reorder /
  // move-between-layers / delete live in the shared action bar below the list.
  const makeRow = (ms) => {
    const li = document.createElement('li');
    li.className = 'ms-item' + (ms.id === state.selectedMilestoneId ? ' selected' : '');
    li.dataset.id = ms.id;
    // selecting (without rebuilding, so focusing a field still works)
    li.addEventListener('mousedown', () => selectMilestone(ms.id));

    const show = document.createElement('button');
    show.className = 'layer-vis' + (ms.visible !== false ? ' on' : '');
    show.textContent = ms.visible !== false ? '👁' : '◌';
    show.title = 'Show / hide milestone';
    show.addEventListener('click', (e) => { e.stopPropagation(); ms.visible = !(ms.visible !== false); renderGuides(); syncMilestones(); scheduleAutosave(); });

    const label = document.createElement('input');
    label.type = 'text'; label.value = ms.label; label.title = 'Milestone label text';
    label.addEventListener('input', () => { ms.label = label.value; renderGuides(); scheduleAutosave(); });

    const x = document.createElement('input');
    x.type = 'number'; x.min = -0.05; x.max = 1.05; x.step = 0.01; x.value = ms.x; x.title = 'x position (0–1)';
    x.addEventListener('input', () => { ms.x = clamp(+x.value || 0, -0.05, 1.05); renderGuides(); scheduleAutosave(); });

    const y = document.createElement('input');
    y.type = 'number'; y.min = 0; y.max = 1; y.step = 0.01; y.placeholder = 'axis'; y.title = 'label height y (blank = sits on axis)';
    y.value = ms.y == null ? '' : ms.y;
    y.addEventListener('input', () => { ms.y = y.value === '' ? undefined : clamp(+y.value || 0, 0, 1); renderGuides(); scheduleAutosave(); });

    const guide = document.createElement('button');
    guide.className = 'layer-vis' + (ms.showGuide ? ' on' : '');
    guide.textContent = ms.showGuide ? '┊' : '·';
    guide.title = 'Toggle the dashed guide line';
    guide.addEventListener('click', (e) => { e.stopPropagation(); ms.showGuide = !ms.showGuide; renderGuides(); syncMilestones(); scheduleAutosave(); });

    li.append(show, label, x, y, guide);
    return li;
  };

  // group by layer, in scene.layers order, using the same names as Composition
  for (const layer of sceneCanvases()) {
    const members = state.scene.milestones.filter((m) => m.group === layer.id);
    if (!members.length) continue;
    const head = document.createElement('li');
    head.className = 'ms-group-head';
    head.textContent = layer.name;
    list.appendChild(head);
    members.forEach((m) => list.appendChild(makeRow(m)));
  }
  syncMilestoneActions();
}

function selectedMilestone() { return state.scene.milestones.find((m) => m.id === state.selectedMilestoneId) || null; }

// Highlight the selected milestone row + enable the action bar, without
// rebuilding the list (so a field click can still focus normally).
function selectMilestone(id) {
  state.selectedMilestoneId = id;
  document.querySelectorAll('#milestone-list .ms-item').forEach((li) => li.classList.toggle('selected', li.dataset.id === id));
  syncMilestoneActions();
}

function syncMilestoneActions() {
  const has = !!selectedMilestone();
  ['ms-up', 'ms-down', 'ms-del'].forEach((a) => {
    const b = document.querySelector(`[data-action="${a}"]`);
    if (b) b.disabled = !has;
  });
}

// --- artboard size ---
document.getElementById('ab-w').addEventListener('change', (e) => { state.scene.artboard.width = clamp(+e.target.value || 1920, 320, 8000); rebuildEverything(); });
document.getElementById('ab-h').addEventListener('change', (e) => { state.scene.artboard.height = clamp(+e.target.value || 1080, 320, 8000); rebuildEverything(); });
document.getElementById('png-scale').addEventListener('input', (e) => {
  state.scene.export.pngScale = +e.target.value;
  document.getElementById('png-scale-val').textContent = e.target.value + '×';
});

// --- theme switching ---
document.getElementById('theme-select').addEventListener('change', (e) => {
  applyTheme(getThemeById(e.target.value));
});

// --- visual name (the title shown top-left, saved in scene.meta.name) ---
document.getElementById('visual-name').addEventListener('input', (e) => {
  state.scene.meta = state.scene.meta || {};
  state.scene.meta.name = e.target.value;
  document.title = (e.target.value ? e.target.value + ' — ' : '') + 'Story Arc';
  renderTitle(); renderOverlay(); // title text follows the visual name
  scheduleAutosave();
});
function syncVisualName() {
  const inp = document.getElementById('visual-name');
  const name = (state.scene.meta && state.scene.meta.name) || '';
  if (inp && document.activeElement !== inp) inp.value = name;
  document.title = (name ? name + ' — ' : '') + 'Story Arc';
}

// --- branch controls ---
document.getElementById('r-enabled').addEventListener('change', (e) => { state.scene.regions.enabled = e.target.checked; renderRegions(); renderBranch(); syncRegionControls(); scheduleAutosave(); });
document.getElementById('r-divider').addEventListener('change', (e) => { state.scene.regions.divider = e.target.checked; renderRegions(); scheduleAutosave(); });
document.getElementById('r-tint').addEventListener('change', (e) => { state.scene.regions.tint = e.target.checked; renderRegions(); scheduleAutosave(); });
document.getElementById('r-branch').addEventListener('change', (e) => { state.scene.regions.branch.show = e.target.checked; renderBranch(); scheduleAutosave(); });
document.getElementById('r-branchx').addEventListener('input', (e) => {
  const v = clamp(+e.target.value || 0, 0, 1);
  state.scene.regions.branchX = v; state.scene.regions.branch.x = v;
  renderRegions(); renderBranch(); scheduleAutosave();
});
document.getElementById('r-branchy').addEventListener('input', (e) => {
  state.scene.regions.branch.y = clamp(+e.target.value || 0, 0, 1);
  renderBranch(); scheduleAutosave();
});

function syncRegionControls() {
  const r = state.scene.regions;
  const multi = sceneCanvases().length >= 2;           // branch needs 2+ layers
  const en = document.getElementById('r-enabled');
  en.checked = r.enabled !== false && multi;
  en.disabled = !multi;
  // sub-controls active only when the feature is actually on
  const active = en.checked;
  ['r-divider', 'r-tint', 'r-branch', 'r-branchx', 'r-branchy'].forEach((id) => { document.getElementById(id).disabled = !active; });
  document.getElementById('branch-controls').style.opacity = active ? '1' : '0.45';
  document.getElementById('r-divider').checked = !!r.divider;
  document.getElementById('r-tint').checked = !!r.tint;
  document.getElementById('r-branch').checked = !!r.branch.show;
  document.getElementById('r-branchx').value = r.branchX;
  document.getElementById('r-branchy').value = r.branch.y;
  document.getElementById('branch-note').textContent = multi
    ? 'A branch marks a handoff where the story forks into separate tracks — the node, divider and tint highlight where one canvas gives way to the next.'
    : 'Branch is unavailable with a single canvas — the chart is one continuous space and curves span the whole artboard. Add a second canvas to enable it.';
  syncBandAxisControls();
}

// One row per Phase-2 layer band: show/hide its right-edge axis title and edit
// the title text (blank falls back to the layer name).
function syncBandAxisControls() {
  const wrap = document.getElementById('band-axis-controls');
  if (!wrap) return;
  wrap.innerHTML = '';
  const bands = branchEnabled() ? sceneCanvases().slice(1) : [];
  if (!bands.length) return;
  const head = document.createElement('div');
  head.className = 'field-label tiny'; head.textContent = 'Canvas axis titles (right edge)';
  wrap.appendChild(head);
  for (const canvas of bands) {
    const row = document.createElement('div');
    row.className = 'row band-axis-row';
    const show = document.createElement('label');
    show.className = 'chk'; show.title = 'Show this canvas’s right-edge axis title';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = canvas.axisTitleShow !== false;
    cb.addEventListener('change', () => { canvas.axisTitleShow = cb.checked; renderAxes(); scheduleAutosave(); });
    show.appendChild(cb);
    const title = document.createElement('input');
    title.type = 'text'; title.className = 'grow';
    title.placeholder = (canvas.name || '').replace(/^\s*phase\s*\d+\s*[·:.\-]?\s*/i, '').trim() || canvas.name;
    title.value = canvas.axisTitle || '';
    title.title = 'Right-edge axis title for this canvas (blank = canvas name)';
    title.addEventListener('input', () => { canvas.axisTitle = title.value; renderAxes(); scheduleAutosave(); });
    row.append(show, title);
    wrap.appendChild(row);
  }
}

// --- visual title controls ---
document.getElementById('vt-show').addEventListener('change', (e) => { state.scene.title.show = e.target.checked; renderTitle(); renderOverlay(); syncTitleControls(); scheduleAutosave(); });
document.getElementById('vt-color').addEventListener('input', (e) => { state.scene.title.color = e.target.value; state.scene.title.colorAuto = false; renderTitle(); scheduleAutosave(); });
document.getElementById('vt-size').addEventListener('input', (e) => { state.scene.title.fontSize = clamp(+e.target.value || 56, 8, 400); renderTitle(); renderOverlay(); scheduleAutosave(); });
document.getElementById('vt-glow').addEventListener('change', (e) => { state.scene.title.glow = e.target.checked; renderTitle(); scheduleAutosave(); });
document.getElementById('vt-bold').addEventListener('change', (e) => { state.scene.title.bold = e.target.checked; renderTitle(); scheduleAutosave(); });

function syncTitleControls() {
  const t = state.scene.title;
  document.getElementById('vt-show').checked = !!t.show;
  document.getElementById('vt-color').value = effectiveTitleColor();
  document.getElementById('vt-size').value = t.fontSize || 56;
  document.getElementById('vt-glow').checked = t.glow !== false;
  document.getElementById('vt-bold').checked = t.bold !== false;
  document.getElementById('vt-controls').style.opacity = t.show ? '1' : '0.5';
}

// --- axes & scale controls ---
document.getElementById('ax-x').addEventListener('input', (e) => { state.scene.axes.xLabel = e.target.value; renderAxes(); scheduleAutosave(); });
document.getElementById('ax-y').addEventListener('input', (e) => { state.scene.axes.yLabel = e.target.value; renderAxes(); scheduleAutosave(); });
document.getElementById('ax-ylow').addEventListener('input', (e) => { state.scene.axes.yLow = e.target.value; renderAxes(); scheduleAutosave(); });
document.getElementById('ax-yhigh').addEventListener('input', (e) => { state.scene.axes.yHigh = e.target.value; renderAxes(); scheduleAutosave(); });
document.getElementById('ax-ticks').addEventListener('change', (e) => { state.scene.axes.showTicks = e.target.checked; renderAxes(); scheduleAutosave(); });

function syncAxesControls() {
  const ax = state.scene.axes;
  const set = (id, v) => { const el = document.getElementById(id); if (document.activeElement !== el) el.value = v; };
  set('ax-x', ax.xLabel || '');
  set('ax-y', ax.yLabel || '');
  set('ax-ylow', ax.yLow || '');
  set('ax-yhigh', ax.yHigh || '');
  document.getElementById('ax-ticks').checked = ax.showTicks !== false;
}

// --- themes ---
// Apply a theme's palette to the scene (overwrites curve colors + chrome).
function applyTheme(theme) {
  const sc = state.scene;
  const light = theme.mode === 'light';
  sc.theme = theme.id;
  sc.mode = light ? 'light' : 'dark';
  sc.artboard.background.color = theme.background;
  // dark themes use the ambient haze + vignette; light themes drop them
  sc.artboard.background.haze = !light;
  sc.artboard.background.vignette = !light;
  sc.style.gridColor = theme.grid;
  sc.style.axisColor = theme.axis;
  sc.style.guideColor = theme.guide;
  sc.style.labelColor = theme.label;
  const blend = theme.blend || (light ? 'normal' : 'screen');
  for (const c of sc.curves) {
    c.color = theme.roles[c.role || 'accent'] || theme.roles.accent || c.color;
    c.blendMode = blend; // screen washes out on white; normal reads on both
  }
  // recolor colored milestone captions by their own color role (layer-agnostic)
  for (const m of sc.milestones) {
    if (m.color && m.role && theme.roles[m.role]) m.color = theme.roles[m.role];
  }
  // Title color: if it's on auto it follows the new mode at render time (nothing
  // to do); an explicit custom title color is left untouched across theme switches.
  // re-render WITHOUT resetting zoom/pan (don't call rebuildEverything)
  renderAll(); syncCanvasList(); syncPropsPanel(); syncMilestones(); syncThemeUI(); syncTitleControls();
  scheduleAutosave();
}

// Capture the current colors as a new custom theme.
function saveThemeFromScene() {
  const name = (prompt('Save the current colors as a theme.\nTheme name:') || '').trim();
  if (!name) return;
  const sc = state.scene;
  const active = getThemeById(sc.theme);
  const roleColor = (role) => {
    const c = sc.curves.find((x) => (x.role || 'accent') === role);
    return c ? c.color : (active.roles[role] || '#9d8bff');
  };
  const theme = {
    id: uid('theme'), name, custom: true,
    mode: sc.mode === 'light' ? 'light' : 'dark',
    blend: (sc.curves[0] && sc.curves[0].blendMode) || (sc.mode === 'light' ? 'normal' : 'screen'),
    background: sc.artboard.background.color,
    grid: sc.style.gridColor, axis: sc.style.axisColor, guide: sc.style.guideColor, label: sc.style.labelColor,
    roles: { cost: roleColor('cost'), resistance: roleColor('resistance'), confidence: roleColor('confidence'), value: roleColor('value'), accent: roleColor('accent') },
  };
  customThemes.push(theme);
  persistThemes();
  state.scene.theme = theme.id;
  syncThemeUI();
  scheduleAutosave();
}

function deleteCurrentTheme() {
  const id = state.scene.theme;
  const idx = customThemes.findIndex((t) => t.id === id);
  if (idx < 0) { alert('Only custom (saved) themes can be deleted. Built-in themes are permanent.'); return; }
  if (!confirm(`Delete the custom theme “${customThemes[idx].name}”?`)) return;
  customThemes.splice(idx, 1);
  persistThemes();
  applyTheme(BUILTIN_THEMES[0]); // fall back to the default look
}

function syncThemeUI() {
  const sel = document.getElementById('theme-select');
  if (!sel) return;
  sel.innerHTML = '';
  const og1 = document.createElement('optgroup'); og1.label = 'Built-in';
  BUILTIN_THEMES.forEach((t) => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; og1.appendChild(o); });
  sel.appendChild(og1);
  if (customThemes.length) {
    const og2 = document.createElement('optgroup'); og2.label = 'Custom';
    customThemes.forEach((t) => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; og2.appendChild(o); });
    sel.appendChild(og2);
  }
  sel.value = state.scene.theme || BUILTIN_THEMES[0].id;
  const del = document.getElementById('btn-del-theme');
  if (del) del.disabled = !customThemes.some((t) => t.id === sel.value);
}

// keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Undo / redo first, so they work regardless of panel focus — except inside a
  // text field, where the browser's native text undo should win.
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
    const ae = document.activeElement;
    const inText = ae && /input|textarea/i.test(ae.tagName) && !['range', 'checkbox', 'color', 'number'].includes(ae.type);
    if (inText) return; // let native text undo handle it
    e.preventDefault();
    if (e.key === 'y' || e.key === 'Y' || e.shiftKey) History.doRedo();
    else History.doUndo();
    return;
  }

  // Esc: blur a focused field, or otherwise deselect the curve + dismiss the
  // active junction handle (cancelling an in-place edit is handled by the editor).
  if (e.key === 'Escape') {
    const ae = document.activeElement;
    if (ae && /input|select|textarea/i.test(ae.tagName)) { ae.blur(); return; }
    let changed = false;
    if (state.activeJunction) { state.activeJunction = null; changed = true; }
    if (state.selectedCurveId) { state.selectedCurveId = null; changed = true; }
    if (changed) { renderCurves(); renderOverlay(); syncCanvasList(); syncPropsPanel(); }
    return;
  }

  if (/input|select|textarea/i.test(document.activeElement.tagName)) return;
  if (e.key === '+' || e.key === '=') zoomBy(1.2);
  else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.2);
  else if (e.key === '0') resetView();
  else if (e.key === 'v') { document.getElementById('t-solo').click(); }
  else if (e.key === 'l' || e.key === 'L') { actions['toggle-zoomlock'](); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && getSelected()) { actions['del-curve'](); }
});

// Reflect the zoom-lock state on its toolbar button — made unmistakable with an
// explicit text label + a warning-colored "locked" state.
function syncZoomLock() {
  const b = document.getElementById('btn-zoomlock');
  if (!b) return;
  const locked = state.ui.zoomLock;
  b.textContent = locked ? '🔒 Zoom Locked' : '🔓 Zoom';
  b.classList.toggle('zoomlocked', locked);
  b.title = (locked ? 'Zoom is LOCKED — scroll/trackpad zoom is ignored. Click to unlock (L). Buttons + / − still work.'
                    : 'Zoom is free. Click to LOCK so scroll/trackpad gestures don\'t zoom (L).');
  if (typeof updateToolbarHints === 'function') updateToolbarHints(); // label width changed
}

/* ============================================================================
   [EXPORT]
============================================================================ */

// Produce a standalone SVG string. `mode`:
//   'clean'        → curves only (+ optional thin axes), transparent
//   'presentation' → full bg + grid + axes + guides + glow
function buildExportSvg(mode) {
  const ab = state.scene.artboard;
  // snapshot current ui, render to a full (un-zoomed) artboard, then restore
  const savedUi = { ...state.ui };
  const savedView = { ...state.view };

  if (mode === 'clean') {
    state.ui.background = false; state.ui.grid = false; state.ui.guides = false; state.ui.axes = false;
    state.ui.regions = false; state.ui.branch = false;
  } else {
    state.ui.background = true; state.ui.grid = true; state.ui.guides = true; state.ui.axes = true; state.ui.glow = true;
    state.ui.regions = true; state.ui.branch = true;
  }
  renderBackground(); renderRegions(); renderGrid(); renderAxes(); renderGuides(); renderCurves(); renderLabels(); renderTitle(); renderBranch();

  const out = el('svg', { xmlns: NS, viewBox: `0 0 ${ab.width} ${ab.height}`, width: ab.width, height: ab.height });
  out.appendChild(L.defs.cloneNode(true));
  out.appendChild(L.sceneRoot.cloneNode(true)); // overlay deliberately excluded

  const str = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(out);

  // restore live editor state
  state.ui = savedUi; state.view = savedView;
  renderAll();
  return str;
}

function exportSVG(mode) {
  const str = buildExportSvg(mode);
  downloadBlob(new Blob([str], { type: 'image/svg+xml' }), `crucible-${mode}.svg`);
}

function exportPNG(withBackground) {
  const ab = state.scene.artboard;
  const scale = state.scene.export.pngScale || 2;
  const str = buildExportSvg(withBackground ? 'presentation' : 'clean');

  const img = new Image();
  const url = URL.createObjectURL(new Blob([str], { type: 'image/svg+xml' }));
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = ab.width * scale;
    canvas.height = ab.height * scale;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    try {
      // On file:// the canvas becomes "tainted" and toBlob throws SecurityError.
      canvas.toBlob((blob) => {
        if (!blob) { pngFailed(); return; }
        downloadBlob(blob, `crucible-${withBackground ? 'full' : 'transparent'}@${scale}x.png`);
      }, 'image/png');
    } catch (err) { pngFailed(err); }
  };
  img.onerror = () => { URL.revokeObjectURL(url); pngFailed(); };
  img.src = url;
}

function pngFailed(err) {
  const onFile = location.protocol === 'file:';
  alert(
    'PNG export failed' + (err ? ': ' + err.message : '') + '.\n\n' +
    (onFile
      ? 'You are running from a file:// URL, where the browser blocks canvas export for security. ' +
        'Serve the folder locally instead — e.g.\n\n    python3 -m http.server\n\n' +
        'then open http://localhost:8000/story-arc.html\n\n' +
        '(SVG export still works from file://.)'
      : 'Try the SVG export instead, or reload and retry.')
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================================================================
   [IO] save / load / autosave
============================================================================ */

const LS_KEY = 'crucible-curve-scene';

function saveScene() {
  const str = JSON.stringify(state.scene, null, 2);
  downloadBlob(new Blob([str], { type: 'application/json' }), 'crucible-scene.json');
}

document.getElementById('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { loadScene(JSON.parse(reader.result)); }
    catch (err) { alert('Could not parse scene JSON: ' + err.message); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// Normalize / validate an incoming scene so older, partial, or hand-edited (even
// hostile) files load safely. Every field is coerced to a sane type/range; ids
// are forced selector-safe + unique; null/garbage array entries are dropped.
function normalizeScene(input) {
  const s = (input && typeof input === 'object') ? input : {};
  const obj = (v) => (v && typeof v === 'object') ? v : {};
  const str = (v, d) => (v == null ? d : String(v));
  const col = (v, d) => (typeof v === 'string' ? v : d); // color tokens stay strings

  const meta = obj(s.meta);
  s.meta = { name: str(meta.name, 'Crucible Curve'), version: num(meta.version, 2) || 2 };

  const ab = obj(s.artboard), pad = obj(ab.padding), bg = obj(ab.background);
  s.artboard = {
    width: clamp(num(ab.width, 1920), 320, 20000),
    height: clamp(num(ab.height, 1080), 320, 20000),
    padding: {
      top: clamp(num(pad.top, 150), 0, 4000), right: clamp(num(pad.right, 120), 0, 4000),
      bottom: clamp(num(pad.bottom, 120), 0, 4000), left: clamp(num(pad.left, 130), 0, 4000),
    },
    background: { color: col(bg.color, '#05070d'), haze: bg.haze !== false, vignette: bg.vignette !== false },
  };

  const st = obj(s.style);
  s.style = {
    gridX: clamp(Math.round(num(st.gridX, 12)), 1, 240),
    gridY: clamp(Math.round(num(st.gridY, 8)), 1, 240),
    gridColor: col(st.gridColor, '#2a3556'), gridOpacity: clamp(num(st.gridOpacity, 0.18), 0, 1),
    axisColor: col(st.axisColor, '#5b6b94'), guideColor: col(st.guideColor, '#33406a'), labelColor: col(st.labelColor, '#8fa0c8'),
  };

  s.theme = typeof s.theme === 'string' ? s.theme : 'crucible-neon';
  s.mode = s.mode === 'light' ? 'light' : 'dark';

  const ax = obj(s.axes);
  s.axes = {
    xLabel: str(ax.xLabel, 'TRANSFORMATION PROGRESS'), yLabel: str(ax.yLabel, 'RELATIVE LEVEL'),
    yLow: str(ax.yLow, 'Low'), yHigh: str(ax.yHigh, 'High'), showTicks: ax.showTicks !== false,
  };

  const ti = obj(s.title);
  s.title = {
    show: !!ti.show,
    x: clamp(num(ti.x, 0.5), -0.1, 1.1), y: clamp(num(ti.y, 1.05), -0.1, 1.15),
    fontSize: clamp(num(ti.fontSize, 56), 8, 400),
    color: col(ti.color, '#ffffff'),
    colorAuto: ti.colorAuto !== false,   // true = follow light/dark mode; false = explicit color
    glow: ti.glow !== false, bold: ti.bold !== false,
    align: ['start', 'middle', 'end'].includes(ti.align) ? ti.align : 'middle',
  };

  const reg = obj(s.regions), br = obj(reg.branch);
  const bx = clamp(num(reg.branchX, 0.6), 0, 1);
  s.regions = {
    enabled: reg.enabled !== false, branchX: bx,
    branch: { x: clamp(num(br.x, bx), 0, 1), y: clamp(num(br.y, 0.89), 0, 1), show: br.show !== false },
    divider: reg.divider !== false, tint: reg.tint !== false,
  };

  // ---- Canvases (sanitize ids first; remember remaps so group refs can follow).
  // Back-compat: older scenes stored these under `layers`. ----
  const layerIds = new Set(), idMap = new Map();
  let canvases = toArray(s.canvases ?? s.layers).filter((l) => l && typeof l === 'object');
  if (!canvases.length) canvases = DEFAULT_CANVASES.map((l) => ({ ...l }));
  canvases = canvases.map((l) => {
    const id = safeId(l.id, 'canvas', layerIds);
    if (typeof l.id === 'string' && l.id !== id) idMap.set(l.id, id);
    return {
      id, name: str(l.name, 'Canvas'),
      // Phase-2 band axis title: text override (blank → derived from name) and
      // a show flag for the right-edge per-canvas axis title.
      axisTitle: typeof l.axisTitle === 'string' ? l.axisTitle : '',
      axisTitleShow: l.axisTitleShow !== false,
    };
  });
  // Resolve a curve/milestone group ref to a real canvas id (follow remaps;
  // auto-create a canvas for a safe-but-undeclared group; else use the first).
  const resolveGroup = (raw) => {
    let g = typeof raw === 'string' ? (idMap.get(raw) || raw) : '';
    if (layerIds.has(g)) return g;
    if (SAFE_ID.test(g)) {
      const def = DEFAULT_CANVASES.find((d) => d.id === g);
      canvases.push({ id: g, name: def ? def.name : g }); layerIds.add(g); return g;
    }
    return canvases[0].id;
  };

  const msIds = new Set();
  s.milestones = toArray(s.milestones).filter((m) => m && typeof m === 'object').map((m) => ({
    id: safeId(m.id, 'ms', msIds),
    label: str(m.label, ''),
    x: clamp(num(m.x, 0), -0.05, 1.05),
    y: (m.y == null || m.y === '') ? undefined : clamp(num(m.y, 0), 0, 1),
    showGuide: m.showGuide !== false, visible: m.visible !== false,
    phase: m.phase === 'post' ? 'post' : 'primary',
    group: resolveGroup(m.group),
    optional: !!m.optional,
    color: col(m.color, undefined),
    // color role (for theme-aware recoloring of colored captions); inferred from color
    role: typeof m.role === 'string' ? m.role : (typeof m.color === 'string' ? inferRole(m.color) : undefined),
  }));

  const curveIds = new Set(), labelIds = new Set();
  s.curves = toArray(s.curves).filter((c) => c && typeof c === 'object').map((c) => ({
    id: safeId(c.id, 'c', curveIds),
    name: str(c.name, 'Curve'),
    color: col(c.color, '#9d8bff'),
    strokeWidth: clamp(num(c.strokeWidth, 4), 0, 80),
    glow: clamp(num(c.glow, 12), 0, 200),
    opacity: clamp(num(c.opacity, 1), 0, 1),
    blendMode: typeof c.blendMode === 'string' ? c.blendMode : 'screen',
    visible: c.visible !== false, locked: !!c.locked,
    smoothing: c.smoothing === 'bezier' ? 'bezier' : 'spline',
    highlight: !!c.highlight,
    group: resolveGroup(c.group),
    role: typeof c.role === 'string' ? c.role : inferRole(c.color),
    easing: typeof c.easing === 'string' ? c.easing : '',
    tension: clamp(num(c.tension, 1), 0, 8),
    labels: toArray(c.labels).filter((l) => l && typeof l === 'object').map((l) => ({
      id: safeId(l.id, 'lab', labelIds),
      text: str(l.text, ''),
      x: clamp(num(l.x, 0.5), -0.1, 1.1), y: clamp(num(l.y, 0.5), -0.1, 1.1),
      anchor: l.anchor == null ? null : Math.max(0, Math.round(num(l.anchor, 0))),
      fontSize: clamp(num(l.fontSize, 26), 6, 400),
      glow: l.glow !== false, leader: !!l.leader,
      align: ['start', 'middle', 'end'].includes(l.align) ? l.align : 'middle',
      bold: l.bold !== false,
    })),
    anchors: toArray(c.anchors).filter((p) => p && typeof p === 'object').map((p) => ({
      x: num(p.x, 0), y: num(p.y, 0),
      hIn:  (p.hIn  && typeof p.hIn  === 'object') ? { x: num(p.hIn.x, 0),  y: num(p.hIn.y, 0) }  : undefined,
      hOut: (p.hOut && typeof p.hOut === 'object') ? { x: num(p.hOut.x, 0), y: num(p.hOut.y, 0) } : undefined,
      mirror: !!p.mirror,
    })),
  }));

  s.canvases = canvases;
  delete s.layers; // normalize to the new key (older scenes loaded via the fallback)
  s.export = { pngScale: clamp(Math.round(num(obj(s.export).pngScale, 2)), 1, 8) };
  return s;
}

function loadScene(sceneObj) {
  state.scene = normalizeScene(sceneObj);
  state.selectedCurveId = state.scene.curves[0]?.id || null;
  document.getElementById('ab-w').value = state.scene.artboard.width;
  document.getElementById('ab-h').value = state.scene.artboard.height;
  document.getElementById('png-scale').value = state.scene.export.pngScale;
  document.getElementById('png-scale-val').textContent = state.scene.export.pngScale + '×';
  rebuildEverything();
  History.init(state.scene);   // loading a scene starts a fresh undo history
  try { localStorage.setItem(LS_KEY, JSON.stringify(state.scene)); } catch (_) {}
}

let autosaveTimer = null;
function scheduleAutosave() {
  History.schedule(); // every committed change is also an undo checkpoint
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state.scene)); } catch (_) {}
  }, 400);
}

/* ============================================================================
   [HISTORY] undo / redo
   ----------------------------------------------------------------------------
   Snapshot-based. Each committed change (anything that calls scheduleAutosave)
   schedules a coalesced commit ~350ms later, so a flurry of edits — a drag, a
   slider sweep — collapses into ONE undo step (like Office). `baseline` always
   mirrors the current scene; undo pops a prior snapshot, redo re-applies.
============================================================================ */
const History = {
  past: [], future: [], baseline: null, timer: null, MAX: 200,

  init(scene) { this.past = []; this.future = []; this.baseline = JSON.stringify(scene); clearTimeout(this.timer); this.timer = null; updateUndoButtons(); },

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(), 350);
    updateUndoButtons();
  },

  // Capture the net change since the last commit as one undo step.
  commit() {
    clearTimeout(this.timer); this.timer = null;
    const cur = JSON.stringify(state.scene);
    if (cur === this.baseline) { updateUndoButtons(); return; }
    this.past.push(this.baseline);
    if (this.past.length > this.MAX) this.past.shift();
    this.baseline = cur;
    this.future.length = 0; // a new change invalidates the redo chain
    updateUndoButtons();
  },

  flush() { if (this.timer) this.commit(); },

  doUndo() {
    this.flush();
    if (!this.past.length) return;
    this.future.push(this.baseline);
    this.baseline = this.past.pop();
    applyHistorySnapshot(this.baseline);
  },

  doRedo() {
    this.flush();
    if (!this.future.length) return;
    this.past.push(this.baseline);
    this.baseline = this.future.pop();
    applyHistorySnapshot(this.baseline);
  },

  // dirty = pending (uncommitted) change waiting on the debounce timer
  isDirty() { return this.baseline != null && JSON.stringify(state.scene) !== this.baseline; },
  canUndo() { return this.past.length > 0 || this.isDirty(); },
  canRedo() { return this.future.length > 0 && !this.isDirty(); },
};

// Restore a scene snapshot WITHOUT recording new history (preserves selection
// when possible) and re-persist it.
function applyHistorySnapshot(jsonStr) {
  const sel = state.selectedCurveId;
  state.scene = normalizeScene(JSON.parse(jsonStr));
  state.selectedCurveId = state.scene.curves.some((c) => c.id === sel) ? sel : (state.scene.curves[0]?.id || null);
  document.getElementById('ab-w').value = state.scene.artboard.width;
  document.getElementById('ab-h').value = state.scene.artboard.height;
  document.getElementById('png-scale').value = state.scene.export.pngScale;
  document.getElementById('png-scale-val').textContent = state.scene.export.pngScale + '×';
  rebuildEverything();
  try { localStorage.setItem(LS_KEY, JSON.stringify(state.scene)); } catch (_) {}
  updateUndoButtons();
}

function updateUndoButtons() {
  const u = document.getElementById('btn-undo'), r = document.getElementById('btn-redo');
  if (u) u.disabled = !History.canUndo();
  if (r) r.disabled = !History.canRedo();
}

function rebuildEverything() {
  buildSvgScaffold();
  resetView();
  renderAll();
  syncCanvasList();
  syncPropsPanel();
  syncMilestones();
  syncRegionControls();
  syncThemeUI();
  syncVisualName();
  syncTitleControls();
  syncAxesControls();
}

/* ============================================================================
   [BOOT]
============================================================================ */

function boot() {
  let initial = null;
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Only reuse an autosaved scene when its schema matches the current
      // default. A version bump (e.g. v1 → v2 two-phase model) means the saved
      // scene predates new structure, so we start fresh from the new default
      // rather than silently showing an incomplete chart.
      if (parsed && parsed.meta && parsed.meta.version === DEFAULT_SCENE.meta.version) {
        initial = parsed;
      } else if (parsed) {
        console.info('[crucible] Saved scene is from an older version — loading the new default. Your old scene was not overwritten until you make an edit; use Load JSON to recover a saved file.');
      }
    }
  } catch (_) { /* localStorage blocked (e.g. file://) — fall back to default */ }
  try { state.ui.zoomLock = localStorage.getItem('crucible-zoomlock') === '1'; } catch (_) {}
  loadScene(initial || clone(DEFAULT_SCENE));
  syncZoomLock();
}

boot();

// One-time notice when running from file:// (autosave + PNG export are limited).
function showEnvNotice() {
  if (location.protocol !== 'file:') return;
  const bar = document.createElement('div');
  bar.id = 'env-notice';
  bar.innerHTML =
    '⚠︎ Running from <code>file://</code> — autosave and PNG export may be blocked by the browser. ' +
    'For full functionality, serve locally (<code>python3 -m http.server</code>) and open via <code>http://localhost</code>. ' +
    '<button id="env-dismiss">Dismiss</button>';
  document.body.appendChild(bar);
  document.getElementById('env-dismiss').addEventListener('click', () => bar.remove());
}
showEnvNotice();

// Re-fit handle sizing once layout settles and whenever the window resizes
// (handle radius depends on the SVG's on-screen pixel width).
requestAnimationFrame(() => renderOverlay());
window.addEventListener('resize', () => renderOverlay());

// Toolbar scroll affordance: show the left/right fade+chevron hints only when
// there's more toolbar content to scroll to in that direction. (Self-contained
// so it's safe to call from anywhere, including during boot.)
function updateToolbarHints() {
  const tb = document.getElementById('toolbar');
  const wrap = document.getElementById('toolbar-wrap');
  if (!tb || !wrap) return;
  const max = tb.scrollWidth - tb.clientWidth;
  wrap.classList.toggle('can-left', tb.scrollLeft > 2);
  wrap.classList.toggle('can-right', tb.scrollLeft < max - 2);
}
{
  const tb = document.getElementById('toolbar');
  if (tb) {
    tb.addEventListener('scroll', updateToolbarHints, { passive: true });
    window.addEventListener('resize', updateToolbarHints);
    if (window.ResizeObserver) new ResizeObserver(updateToolbarHints).observe(tb);
    requestAnimationFrame(updateToolbarHints);
    // click the edge chevrons to scroll the toolbar by ~70% of its width
    // (for mouse/keyboard users who can't two-finger scroll).
    document.querySelectorAll('.tb-scroll').forEach((btn) => {
      btn.addEventListener('click', () => {
        const delta = (+btn.dataset.scroll || 1) * tb.clientWidth * 0.7;
        const max = tb.scrollWidth - tb.clientWidth;
        tb.scrollLeft = Math.max(0, Math.min(max, tb.scrollLeft + delta));
        updateToolbarHints();
      });
    });
  }
}

// expose a tiny console API for power users / debugging
window.crucible = {
  get scene() { return state.scene; },
  load: loadScene,
  reset: () => loadScene(clone(DEFAULT_SCENE)),
  exportSVG, exportPNG, buildExportSvg,
};

})();
