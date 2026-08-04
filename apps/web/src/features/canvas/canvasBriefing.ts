// The message the "Brief AI" button types into a session's terminal: that a
// brainstorm board is now open beside that terminal, where it lives on disk, and
// what shape to write it in. Pure so it is unit-testable — getting the format
// wrong means the agent writes a file the editor then refuses to decode, which is
// exactly the failure this repo tests for rather than hopes about.

// Three on-disk shapes reach three editors. A `.canvas` file is Obsidian JSON
// Canvas; a `.canvas.json` file is the legacy React-Flow encoding; a
// `.excalidraw` file is a native Excalidraw scene.
export type CanvasFormat = "jsonCanvas" | "reactFlow" | "excalidraw"

const JSON_CANVAS_SHAPE = [
  "It is an Obsidian JSON Canvas file (jsoncanvas.org):",
  '  { "nodes": [{ id, type: "text"|"group"|"link"|"file", x, y, width, height,',
  "                text?, label?, url?, file?, color? }],",
  '    "edges": [{ id, fromNode, toNode, fromSide?, toSide?, toEnd?, label?, color? }] }',
  "Coordinates are absolute; a group is a rectangle that visually contains the",
  'nodes drawn inside it. Colors are Obsidian\'s presets "1".."6".',
  "Edge labels render as text on the arrow.",
]

const REACT_FLOW_SHAPE = [
  "It is a JSON file with React-Flow shape:",
  "  { version: 1, nodes: [{ id, position:{x,y}, type?, data:{label?},",
  "                          parentId?, extent?: 'parent', style?:{width,height} }],",
  "    edges: [{ id, source, target, label? }] }",
  "Nodes with type 'group' act as containers; child nodes set parentId and",
  "extent:'parent' and use coordinates relative to the group's position.",
  "Edge labels render as text on the arrow.",
]

// Excalidraw's own scene format. Only `elements` is synced — appState (zoom,
// scroll, selection) is deliberately not persisted per edit, so writing it back
// is harmless but pointless.
const EXCALIDRAW_SHAPE = [
  "It is an Excalidraw scene file:",
  '  { "type": "excalidraw", "version": 2, "elements": [ … ], "appState": {},',
  '    "files": {} }',
  "Every shape is one entry in `elements`, each with a unique string id, a type",
  '("rectangle"|"ellipse"|"diamond"|"text"|"arrow"|"line"|"freedraw"), absolute',
  "x/y, width/height, angle, strokeColor, backgroundColor, fillStyle,",
  "strokeWidth, roughness, opacity, seed and version.",
  "Label a shape by adding a `text` element whose containerId is the shape's id,",
  'and listing it in the shape\'s boundElements as { id, type: "text" }.',
  "An arrow connects two shapes via startBinding / endBinding",
  "({ elementId, focus, gap }) and its own points array.",
  "Only `elements` is read back — appState and files are ignored.",
]

const SHAPE_BY_FORMAT: Record<CanvasFormat, readonly string[]> = {
  jsonCanvas: JSON_CANVAS_SHAPE,
  reactFlow: REACT_FLOW_SHAPE,
  excalidraw: EXCALIDRAW_SHAPE,
}

export const briefingMessage = (input: {
  readonly path: string
  readonly format: CanvasFormat
}): string =>
  [
    "We're running a brainstorm session together: I just opened a shared drawing",
    "beside your terminal, at:",
    `  ${input.path}`,
    "",
    ...SHAPE_BY_FORMAT[input.format],
    "",
    "Use your Read tool to see what I drew, and your Write tool to update the",
    "whole file in one atomic write. The browser side syncs live — when you",
    "write, my board updates in real time, and I keep drawing meanwhile, so",
    "re-read the file before every write. Give new elements unique ids.",
    "",
    "Help me improve the diagram: rename boxes, add arrows with labels,",
    "group related boxes, propose new nodes. Tell me what you changed here in",
    "the terminal — this pane is where I'm reading your replies.",
  ].join("\n")
