# Story Arc

A local, single-page, **SVG-first** tool for composing cinematic, keynote-style
**narrative curves** — glowing lines that tell a story across stages, like the
"Crucible Curve" it ships with as the default scene.

It is *not* a charting library: there's no statistics and no CSV. Every curve is a
hand-shaped geometric path you drag into the form you want, then export as clean
SVG or PNG to finish (titles, callouts) in Photoshop / Figma — or use straight out
of the editor.

- **Zero dependencies, no build step** — plain HTML/CSS/JS, one `app.js`.
- **SVG is the source of truth**; PNG is rasterized from it.
- **Everything is editable geometry** — anchors and cubic Bézier handles — and the
  whole scene round-trips through a human-readable JSON file.

---

## Run it

**Option A — just open it.** Double-click `story-arc.html` (or drag it into a
browser). When served over `http`, the starter scene is fetched from
`scene-default.json`; opened via `file://` (where `fetch` is blocked) it falls back
to the copy embedded in `app.js`. Save/load uses file download + `localStorage`, so
nothing needs a server.

**Option B — tiny static server** (recommended; restores autosave + PNG export):

```bash
cd story-arc
python3 -m http.server 8080
# open http://localhost:8080/story-arc.html
```

Tested in current Chrome / Safari / Firefox.

> **`file://` caveats.** Opening the file directly works for editing and **SVG**
> export, but browsers sandbox `file://` pages as "unique security origins", which
> **blocks `localStorage` autosave and PNG export** (the canvas gets tainted). If
> you see a console warning about `'file:' URLs … unique security origins`, or PNG
> export fails, switch to Option B. The app shows a one-time banner when it detects
> `file://`.

---

## The interface

Two regions:

- **Canvas** (left) — the 1920×1080 artboard with the live SVG chart and the
  editor overlay (anchor/handle dots, drag boxes, snap guides).
- **Control panel** (right) — stacked cards: Composition · Theme · Visual Title ·
  Selected Curve · Branch · Milestones · Export · Axes & Scale · Artboard.

A top **toolbar** holds the visual name, undo/redo, zoom controls, and the global
display toggles. When it's wider than the window, fade hints with round **‹ / ›
scroll buttons** appear at the edges (click them, or two-finger scroll).

**Global toggles** (toolbar): Grid · Axes · Guides · Background · Glow · Labels ·
Snap · Solo (show only the selected curve).

---

## Editing curves

- **Select** — click a curve's stroke on the canvas (there's a generous invisible
  hit area, so even thin curves are easy to grab), or click its row in *Composition*.
- **Shape** — drag the round **anchor** dots. In `bezier` smoothing mode each anchor
  also shows draggable **Bézier handles** with tangent lines.
- **Pan / zoom** — drag empty canvas to pan; scroll wheel to zoom toward the cursor,
  or use the toolbar `+ / − / Reset view`. Keyboard: `+`, `-`, `0`.
- **Per-curve style** (Selected-Curve panel): name, stroke color, opacity, stroke
  width, glow, blend mode, highlight pass, and the curve's **canvas** and **color
  role** (see below).
- **Add / remove anchors** — `+ Anchor` inserts at the longest gap; `− Anchor` drops
  the last one.
- **Smoothing mode** per curve:
  - `spline` — handles are auto-derived from the anchors (Catmull-Rom). You only drag
    anchors. Fast and organic.
  - `bezier` — explicit, fully draggable handles. Toggle **Mirror handles** for
    symmetric tangents.
- **Easing preset** — sets the curve's spline **tension** (`linear / smooth /
  ease-in-out / dramatic`) to change its feel. The choice sticks (stored as
  `easing` + `tension`) and applies live in spline mode; in bezier mode it also
  bakes the handles.

`Delete` / `Backspace` removes the selected curve. `v` toggles Solo. **`Esc`**
deselects the current curve (and dismisses a junction handle).

**Rename a curve** by double-clicking its name in the *Composition* list (or via
the **Name** field in the Selected-Curve panel). **Edit any label on the slide in
place** — double-click a curve word-label, a milestone label, or the visual title on
the canvas, type, and press Enter (Esc cancels); the change is written straight to
the scene and its panel control.

### Snap & smart alignment guides

Toggle **Snap** (magnetic, ~9 px pull). While dragging an **anchor**, a **curve
label**, or a **milestone label**, it's attracted to nearby reference points,
PowerPoint-style:

1. **Anchor weld** (anchors only) — snaps to another curve's anchor on *both* axes,
   so two lines meet exactly. A magenta ring marks the weld (this forms a
   **junction** — see below).
2. **Edge-aware alignment** — on each axis independently, snaps to another anchor, a
   grid line, the branch/divider x, the **canvas center**, or any **edge** of another
   label/milestone box — left / center / right and top / middle / bottom — so you can
   line up *edges*, not just centers. A cyan guide marks the match.
3. **Equal spacing** — while dragging a **milestone label**, the labels in its canvas
   are measured edge-to-edge; equal gaps are drawn as pink **dimension lines with the
   measurement**, and the dragged label snaps so its gap matches a neighbouring one
   (or centres between two neighbours) — like PowerPoint's distribution guides.

Bézier handles always drag freely.

### Junctions (joining two curves)

Welding two curve ends together (snap rule 1) forms a **junction**. The line is
reshaped to flow **smoothly through the connection** — C1-continuous, with the tangent
magnitude following each curve's own **easing**, so two arcs read as one continuous
path. **Click the junction** to reveal a floating handle on a short stalk above it;
**drag that handle to move both joined anchors at once**, as if the seam were a single
anchor, with easing reapplied live. Click empty canvas to dismiss the handle. A
junction is detected only when the two ends sit at the *same* point, which is exactly
what the weld snap produces.

---

## Canvases

Curves are organized into **canvases** (the *Composition* panel). Canvases group both
curves **and** milestones. A composition holds **up to 3 canvases** (primary + two
Phase-2 tracks), matching the right-edge band layout.

- **+ Canvas** adds one (disabled once you reach 3); each canvas header name is
  **editable inline** — renaming it updates the Milestones grouping to match.
- The header eye toggles the whole canvas's visibility; **✕** deletes the canvas (its
  curves and milestones move to the first canvas — nothing is lost; the last canvas
  can't be deleted).
- **+ Curve** adds a curve to the selected curve's canvas. Per-curve: Duplicate,
  Delete, visibility (👁), and move between canvases via the **Canvas** dropdown in the
  Selected-Curve panel.
- **`▲ ▼`** reorder the selected curve within its canvas (draw order) and, at a canvas
  boundary, **move it into the adjacent canvas** — so you can duplicate a curve and
  walk the copy up or down into another canvas.

---

## Milestones

Named markers along the x-axis (the *Milestones* panel), **grouped under the same
canvas headers** as the curves — the panel mirrors the *Composition* UX. Each row is
a compact line: visibility · label · `x` (0–1) · `y` (blank = sits on the axis; a
value floats the label at that height) · guide-line toggle. **Click a row to select
it**, then the shared **`▲ ▼` / Delete** bar below the list reorders it within its
canvas — **crossing into the adjacent canvas at the boundary** — or removes it. `+ Add`
creates one in the selected curve's canvas.

You can also **drag a milestone label directly on the canvas** (hover shows a faint
grab box) — it moves the milestone's x and sets its label height, obeys **Snap**
(including the equal-spacing dimension guides above), and is undoable.

---

## Labels & the visual title

**Word labels** (per curve) — in the Selected-Curve panel, **+ Word** adds a text
label auto-styled in the **curve's color with matching glow**. Drag the dashed box
on the canvas to place it (grab from any edge — it won't jump; obeys Snap). Per
label: text, font size, **glow**, **leader** line. Each label *homes* to one of the
curve's anchors — **◀ / ▶** shift the homing anchor along the curve (the label jumps
there, the leader follows), **⤓** snaps it back onto its anchor. The toolbar
**Labels** toggle shows/hides all of them.

**Visual title** — the editable name top-left (next to "Story Arc") names the
visual, is saved in the scene (`meta.name`), and sets the browser tab title. The
**Visual Title** panel toggles **Show** to render that name *on the chart* as a full
label (color, size, glow, bold; draggable; obeys Snap; exports with the chart).

---

## Themes (dark + light)

The **Theme** panel switches the whole palette at once — **10 built-ins**:

- **Dark** (neon, additive `screen` glow): Crucible Neon, Solar Flare, Aurora,
  Mono Ice, Ember Slate, Vaporwave.
- **Light** (for light slides), each with its own background hue and ink temperament:
  **Daylight** (bright cool white, vivid modern inks), **Parchment** (warm cream,
  muted earthy editorial), **Blueprint** (cool steel-blue, cobalt/jewel technical),
  **Botanic** (pale mint, fresh spring).

Applying a theme **overwrites all curve colors and chart chrome** (background, grid,
axes, guides, labels). Curves recolor by their **color role** (`cost / resistance /
confidence / value / accent`, set per curve) so related curves stay matched across
themes — e.g. *Cost* and *New Cost* keep the same hue. Light themes also switch the
curve blend to `normal` (the neon `screen` blend washes out on white), drop the
haze/vignette, soften the glow, and keep title/labels dark for contrast;
`scene.mode` tracks dark/light.

Tweak any colors, then **Save as theme…** to store the current palette (and its
mode/blend) as a custom theme in `localStorage`; **Delete theme** removes a custom
one. Theme switches are undoable.

---

## Branch (canvas handoffs)

The **Branch** panel adds a visual "handoff" where the story forks into separate
tracks — useful for multi-act stories like the default scene's post-mastery split.
It renders a strong **divider**, a subtle **tint** over the region past the split,
and a glowing focal **node** with connectors.

- A master **Enabled** toggle turns the whole feature on/off.
- Branch needs **2+ canvases**. With a single canvas it auto-disables and the chart is
  one continuous space with curves spanning the full canvas.
- Controls: Divider · Tint · Node, plus the normalized **Split x** and **Node y**.
- The **divider** is a solid, glowing vertical **seam** at the split x — the line the
  Phase-2 tracks read as a continuation of Phase 1. Its color is drawn from the
  theme's axis token, so it flexes light/dark. Curves can **snap-anchor** to this x
  (it's a snap target) without having to weld.
- **Phase-2 canvas bands.** The region right of the divider is split into one
  horizontal **band per non-primary canvas**, stacked top→bottom in canvas order, each
  with its **own Y axis** repeated on the right edge (see *Axes & scale*).

---

## Axes & scale

The **Axes & Scale** panel edits the **X-axis title** and **Y-axis title**, plus the
Y-axis **Low / High** endpoint labels and a **Ticks** toggle. The Y axis is a
relative 0–1 scale, so the Low/High labels are how you tell readers what the height
means. Stored in `scene.axes`.

**Per-canvas right-edge axes.** When Branch is on (2+ canvases), the primary Y axis is
**repeated separately for each Phase-2 canvas band** on the right edge — line +
arrowhead, ticks, the same `Low`/`High` labels (mirrored to the right), and a rotated
band title. Each band is an even vertical slice of the post-divider region, so the
right side reads as stacked sub-charts. These honor the **Ticks** toggle and the
global **Axes** toggle, and export with the slide. Each band title can be **renamed
or hidden** from the **Branch** panel (it defaults to the canvas's name).

---

## Other controls

- **Undo / redo** — full history. **Undo** `⌘Z` / `Ctrl+Z`, **Redo** `⌘⇧Z` /
  `Ctrl+Y` (or the toolbar buttons). Rapid edits coalesce into one step (one drag =
  one undo; one slider sweep = one undo). Theme switches, color edits, drags,
  milestone/label changes — all undoable. Inside a text field, the browser's native
  text undo wins. Loading a scene resets history.
- **Zoom lock** — the zoom button (shortcut `L`) locks scroll/trackpad zoom so you
  stop zooming by accident. It reads **"🔓 Zoom"** when free and a bright amber
  **"🔒 Zoom Locked"** when locked; the `+ / − / Reset view` buttons still work. The
  setting persists across reloads.
- **Autosave** — edits autosave to `localStorage`; reopening restores your last
  scene. *Reset scene* reloads the starter from `scene-default.json` (falling back to
  the embedded default on `file://`). (The app is version-gated: a schema bump loads
  the new default instead of a stale saved scene.)

---

## Export

| Button | Contents | Background |
|---|---|---|
| **SVG · clean** | Curves + labels only (no grid/axes/guides/branch) | transparent |
| **SVG · presentation** | Full styled slide (background, grid, axes, guides, glow, branch) | themed |
| **PNG · transparent** | Curves + labels only | transparent |
| **PNG · full slide** | Full slide aesthetic baked in | themed |

Editor overlays (anchor/handle dots, snap guides) are **never** exported. PNG
resolution is `artboard × scale`; set the **PNG scale** slider (1×–4×, default 2× →
3840×2160). PNG export needs a same-origin context — serve locally if it fails on
`file://`.

**Save / load scene** — *Save JSON* downloads the whole scene; *Load JSON* restores
one. The format is human-editable (below).

---

## The default scene (the Crucible Curve)

The starter scene is a worked example of the canvas + branch system: a two-act
"crucible" story.

- **Canvas 1 — Primary Crucible** (left ~57%): milestones Excitement → Reality
  Friction → Persistence → Proficiency → Mastery. Curves **Cost** (spikes early then
  falls), **Resistance** (rises with turbulence then collapses), **Confidence** (dips
  then recovers to a plateau), **Value** (rises slowly then accelerates to a high
  plateau at Mastery).
- **Canvas 2 — Complacency / Decline** (upper-right band): **Complacency** holds high
  then erodes; **Eroding Value** declines through comfort/bureaucracy/stagnation/
  decline; **Resistance to Change** rises again.
- **Canvas 3 — Renewing the Crucible** (lower-right band): a nested mini-crucible —
  **New Cost** and **New Resistance** bumps, then **Future Value** dips (temporary
  dip) and recovers.

A **branch node** sits on the mature-state plateau at the Mastery handoff. None of
this is hardcoded — it's just curves, milestones, and canvases you can rename, reshape,
delete, or rebuild for any story.

---

## Data model

The whole scene is one human-editable JSON object (see `scene-default.json`):

```jsonc
{
  "meta":   { "name", "version" },     // name = the editable visual title
  "mode":   "dark",                    // "dark" | "light" — drives blend / glow / contrast
  "theme":  "crucible-neon",           // id of the active color theme
  "canvases": [ { "id", "name" } ],      // groups curves AND milestones (by their `group` id); ≤3.
                                       //   (older scenes used "layers" — still loaded, then migrated)
  "artboard": { "width", "height",
                "padding": { top, right, bottom, left },
                "background": { "color", "haze", "vignette" } },
  "style":  { "gridX", "gridY", "gridColor", "gridOpacity",
              "axisColor", "guideColor", "labelColor" },
  "axes":   { "xLabel", "yLabel", "yLow", "yHigh", "showTicks" },
  "title":  { "show", "x", "y", "fontSize", "color", "glow", "bold", "align" }, // text = meta.name
  "regions": {                         // Branch (canvas-to-canvas handoff)
    "enabled": true,                   // master on/off (auto-off with <2 canvases)
    "branchX": 0.605,                  // normalized x of the split / divider
    "branch":  { "x", "y", "show" },   // focal fork node
    "divider": true,                   // dashed handoff line
    "tint":    true                    // tint over the region past the split
  },
  "milestones": [ {
    "id", "label",
    "x",                  // normalized 0..1
    "y",                  // optional label height (omit → sits on the axis)
    "showGuide", "visible",
    "group":  "<canvas id>",
    "phase":  "primary" | "post",   // styling hint (label size / placement)
    "color"                          // optional; colored captions read as section headers
  } ],
  "curves": [ {
    "id", "name", "color", "strokeWidth", "glow", "opacity",
    "blendMode", "visible", "locked", "highlight",
    "group":  "<canvas id>",
    "role":   "cost" | "resistance" | "confidence" | "value" | "accent", // theme slot
    "smoothing": "spline" | "bezier",
    "easing", "tension",             // spline feel (see Easing)
    "labels": [ { "id", "text", "x", "y", "anchor", "fontSize", "glow", "leader", "align", "bold" } ],
    "anchors": [ {
      "x", "y",             // normalized 0..1  (x: left→right, y: bottom→top)
      "hIn":  { "x", "y" }, // optional cubic handle (absolute, normalized)
      "hOut": { "x", "y" }, // optional; omitted handles are derived in spline mode
      "mirror": false
    } ]
  } ],
  "export": { "pngScale": 2 }
}
```

> **Backward compatibility.** Older scenes load fine — `normalizeScene()` fills in
> missing fields (canvases, mode, axes, title, roles, …) with sensible defaults and
> infers each curve's `role` from its color.

**Coordinate space.** All geometry is normalized: `x ∈ [0,1]` left→right, `y ∈ [0,1]`
**bottom→top** (y = 1 is the top of the chart area). At render time `normToUser()`
maps that into the padded artboard, and the SVG `viewBox` maps *that* to the screen.
Dragging converts pointer → user → normalized via the SVG CTM, so it stays accurate
under any zoom/pan.

**Path generation.** Each curve renders as a chain of cubic Béziers (`M … C … C …`).
In `spline` mode the per-segment control points are derived from neighboring anchors
(Catmull-Rom → Bézier, scaled by the curve's `tension`). In `bezier` mode the stored
`hIn`/`hOut` are used verbatim. See the `[GEOMETRY]` section of `app.js`.

**Render order** (`app.js`, `[RENDER]`): background → regions (tint + divider) →
grid → axes → guides → curves (glow + main stroke + highlight) → labels → visual
title → branch node → editor overlay. Everything up to the branch node lives in
`#scene-root` and exports; the overlay is excluded from every export.

---

## Customizing the defaults

- **Starter geometry** — edit on the canvas (it autosaves), or change the permanent
  default by editing **`scene-default.json`** — it's what *Reset scene* and a fresh
  load fetch when served over `http`. (Easiest: shape it in the editor, **Save JSON**,
  and replace `scene-default.json` with the result.) The `a(x, y)` helper used in the
  embedded fallback is `{x, y}` shorthand; add/remove anchors freely (handles
  auto-derive unless you add explicit `hIn`/`hOut`). **`DEFAULT_SCENE`** inside `app.js`
  (marked `[MODEL]`) is the `file://` fallback when `fetch` is unavailable — keep it
  roughly in sync if you rely on offline use.
- **Artboard** — the *Artboard* panel (W/H) or `DEFAULT_SCENE.artboard`. Inner chart
  margin is `artboard.padding`.
- **Aesthetic tokens** — grid density/color/opacity, axis/guide/label colors:
  `DEFAULT_SCENE.style`. Background haze/vignette: `artboard.background`.
- **Export / themes** — `DEFAULT_SCENE.export.pngScale`; built-in themes live in
  `BUILTIN_THEMES` (`app.js`, `[THEMES]`).
- **Console API** — `window.crucible` exposes `scene`, `reset()`, `load(obj)`,
  `exportSVG('clean'|'presentation')`, `exportPNG(withBg)`, `buildExportSvg(mode)`.

---

## Favicon / app icon

The tab/app icon lives in `assets/` (a Crucible-Neon crossing-curves mark):
`favicon-16/32/192/512.png`, `apple-touch-icon.png` (180), the full-res
`icon-1024.png`, and `site.webmanifest` — referenced from the `<head>` of
`story-arc.html`. To swap in a new one, drop a square PNG and regenerate (macOS):

```bash
SRC=my-icon.png
for SZ in 512 192 180 32 16; do sips -s format png -z $SZ $SZ "$SRC" --out assets/favicon-$SZ.png; done
cp assets/favicon-180.png assets/apple-touch-icon.png
```

> PNG favicons load fine from `file://`; the `manifest` (PWA metadata) only fetches
> over `http://` — harmless either way.

---

## Architecture notes

- Plain ES, one `app.js`, organized by banner sections: `[MODEL] [GEOMETRY] [THEMES]
  [SVG] [RENDER] [VIEW] [EDIT] [HISTORY] [UI] [EXPORT] [IO]`. Model, renderer,
  interaction, and export are kept separate.
- **No frameworks, no charting lib, no D3.** Scales/ticks/gridlines are a few lines
  of arithmetic — not worth a dependency that would also break offline `file://` use.
- Redraw is deterministic. Structural changes do a full re-render; live dragging
  takes a fast path (`refreshSelectedGeometry`) that only rewrites the affected path
  `d` and overlay positions — no node recreation, so pointer capture and drag stay
  jitter-free.
- **Undo/redo** is snapshot-based with debounced, coalescing commits (`History` in
  `[HISTORY]`).

### Files

```
story-arc.html    markup + panel structure + favicon links
styles.css           editor chrome (the artboard aesthetic is driven by the SVG)
app.js               the whole engine (model, render, edit, themes, export, history)
scene-default.json   the served starter scene (fetched on Reset / first load over http)
assets/              favicon + app-icon set + web manifest
```

---

## Future improvements

- **Parametric branches** — branch-track anchors tied to a parent curve's value at
  the split x (so editing an earlier canvas propagates), plus one-click
  "fork / collapse / renew" generators that emit a whole canvas.
- **Import an existing SVG path** → editable anchors/handles (parse `M/C/S/Q`).
- **Multi-select / box-select** of anchors; **corner vs. smooth** anchor toggle
  (independent handle break) and per-anchor handle-length presets.
- **Richer labels** — multi-line, and text-on-path that follows the curve's slope.
- **Higher-end visuals** — animated draw-on for video export, layered additive bloom,
  grain/scanline overlays, gradient strokes along a curve.
- **Curve math options** — monotone interpolation, per-anchor tension, B-spline mode.
- **Reassign a milestone's canvas from the UI** (currently set via JSON / its default).

---

## License

[MIT](LICENSE) © 2026 Eric Sabe.
