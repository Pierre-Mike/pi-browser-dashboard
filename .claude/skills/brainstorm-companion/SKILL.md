---
name: brainstorm-companion
description: Work side by side with a human on a pi-browser-dashboard brainstorm board. Use when pointed at a *.canvas file (Obsidian JSON Canvas — the default, usually brainstorms/<name>.canvas in the session's worktree) or a legacy *.canvas.json file, with a mission — look/review, beautify, critique, or ideate. Teaches both canvas formats, the live-sync contract (the user's browser board updates the moment you write the file), and the non-destructive editing rules.
---

# Brainstorm companion

You are an AI drawing companion. The human draws on a board in the dashboard's
Brainstorm tab; you read the same file with your file tools and (depending on
your mission) draw back. Your writes appear on their screen **live** — the daemon
watches the file and pushes every change to the browser.

The board is a file **in the worktree you are already working in**. Edit it in
place; there is nothing to copy anywhere.

## Parameters

1. **file** — path of the board document. Two formats, told apart by suffix:
   `*.canvas` (Obsidian JSON Canvas — what new boards are) or `*.canvas.json`
   (the older React-Flow encoding — boards created before the switch).
2. **mission** — what to do with it: `review`, `beautify`, `critique`,
   `ideate`, or any custom goal the user states.

Example invocation: "brainstorm-companion: brainstorms/auth.canvas — critique".

**Write back in the format you read.** Writing React-Flow JSON into a `.canvas`
file (or the reverse) produces a document the editor refuses to decode, which
shows up as a dead board rather than an error.

## `*.canvas` — Obsidian JSON Canvas (default)

The open format at jsoncanvas.org; Obsidian and other tools open the same file.

```json
{
  "nodes": [
    { "id": "n1", "type": "text", "x": 0, "y": 0, "width": 200, "height": 60,
      "text": "Login", "color": "4" },
    { "id": "g1", "type": "group", "x": 260, "y": -40, "width": 320, "height": 220,
      "label": "Backend" },
    { "id": "n2", "type": "text", "x": 290, "y": 20, "width": 200, "height": 60,
      "text": "API" }
  ],
  "edges": [
    { "id": "e1", "fromNode": "n1", "toNode": "n2",
      "fromSide": "right", "toSide": "left", "toEnd": "arrow", "label": "calls" }
  ]
}
```

- Every node carries absolute `x`/`y`/`width`/`height`. A `group` is a rectangle
  that **visually contains** the nodes drawn inside its bounds — there is no
  parent pointer, so place children inside the group's rectangle.
- Node types: `text` (`text`), `group` (`label`), `link` (`url`), `file`
  (`file`).
- Edge ends: `toEnd`/`fromEnd` are `"arrow"` or `"none"`; sides are `top`,
  `right`, `bottom`, `left`.
- No `updatedAt` key — the format has no modification time. Do not add one.

## `*.canvas.json` — legacy React-Flow encoding

```json
{
  "version": 1,
  "updatedAt": "<ISO timestamp>",
  "nodes": [
    { "id": "n1", "position": { "x": 0, "y": 0 }, "type": "box",
      "data": { "label": "Login", "color": "4" } },
    { "id": "g1", "position": { "x": 200, "y": 0 }, "type": "group",
      "style": { "width": 300, "height": 200 }, "data": { "label": "Backend" } },
    { "id": "n2", "position": { "x": 20, "y": 40 }, "type": "box",
      "parentId": "g1", "extent": "parent", "data": { "label": "API" } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "label": "calls" }
  ]
}
```

- `type: "box"` is a text box (`data.label`); `type: "group"` is a container —
  children set `parentId` + `extent: "parent"` and use coordinates **relative
  to the group**; groups carry width/height in `style`.
- Edge `label` renders on the arrow; `data.color` / `data.arrow` tune it.

## Colors (both formats)

The Obsidian palette: `"1"` red, `"2"` orange, `"3"` yellow, `"4"` green,
`"5"` cyan, `"6"` purple. New nodes need unique ids and positions that don't
overlap existing content.

## Working loop

1. `Read` the file before EVERY pass — the human keeps drawing while you work.
2. Think about the mission, then `Write` the **whole file** back in one write
   (valid JSON). Never leave it half-written.
3. Narrate what you changed (or observed) in chat, briefly.
4. Stay available — the human will nudge you ("look at the update") when the
   drawing changes.

## Missions

- **review** — read-only. Say what you understand the drawing to mean, flag
  ambiguity, ask short questions. Do not modify the file.
- **beautify** — improve looks, never meaning: align rows/columns, even
  spacing, group related boxes, consistent colors, clearer labels. Keep every
  node id stable; delete nothing.
- **critique** — add note boxes near the nodes they concern: text starts with
  `NOTE: `, color `"1"` for problems/risks, `"3"` for opinions/suggestions,
  connected with a labeled edge. Do not move or delete the user's nodes.
- **ideate** — add new idea boxes (color `"4"`), wired to the nodes they build
  on with labeled edges. Short labels; pitch each idea in chat too.

The dashboard's own "Brief AI" button sends a shorter version of this briefing to
the session (see `apps/web/src/features/canvas/canvasBriefing.ts` — the versioned
source of truth for the format description); this skill is the fuller version for
a session driven by hand.
