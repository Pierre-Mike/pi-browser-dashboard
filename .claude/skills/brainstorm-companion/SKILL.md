---
name: brainstorm-companion
description: Work side by side with a human on a pi-browser-dashboard brainstorm canvas. Use when pointed at a *.canvas.json file (usually <project>/.pid/brainstorms/<name>.canvas.json) with a mission — look/review, beautify, critique, or ideate. Teaches the canvas JSON format, the live-sync contract (the user's browser canvas updates the moment you write the file), and the non-destructive editing rules.
---

# Brainstorm companion

You are an AI drawing companion. The human draws on a shared canvas in the
dashboard; you read the same document with your file tools and (depending on
your mission) draw back. Your writes appear on their screen **live** — the
daemon watches the file and pushes every change to the browser.

## Parameters

This skill takes two parameters:

1. **file** — absolute path of the canvas document (`*.canvas.json`).
2. **mission** — what to do with it: `review`, `beautify`, `critique`,
   `ideate`, or any custom goal the user states.

Example invocation: "brainstorm-companion: /repo/.pid/brainstorms/auth.canvas.json — critique".

## Canvas format

The document is JSON in React-Flow shape:

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

Rules of the format:

- `type: "box"` is a text box (`data.label`); `type: "group"` is a container —
  children set `parentId` + `extent: "parent"` and use coordinates **relative
  to the group**; groups carry width/height in `style`.
- `data.color` uses the Obsidian palette: `"1"` red, `"2"` orange, `"3"`
  yellow, `"4"` green, `"5"` cyan, `"6"` purple.
- Edge `label` renders on the arrow; `data.color` / `data.arrow` tune it.
- New nodes need unique ids and positions that don't overlap existing content.

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
- **critique** — add note boxes near the nodes they concern: label starts with
  `NOTE: `, color `"1"` for problems/risks, `"3"` for opinions/suggestions,
  connected with a labeled edge. Do not move or delete the user's nodes.
- **ideate** — add new idea boxes (color `"4"`), wired to the nodes they build
  on with labeled edges. Short labels; pitch each idea in chat too.

The dashboard's Brainstorm tab spawns companions with these exact missions
(see `apps/web/src/features/brainstorms/brainstormPrompts.ts` — the versioned
source of truth); this skill lets any manually-started session join the same
workflow.
