// The message the "Brief AI" button types into a session's terminal: where the
// drawing lives and what shape to write it in. Pure so it is unit-testable —
// getting the format wrong means the agent writes a file the editor then refuses
// to decode, which is exactly the failure this repo tests for rather than hopes
// about.

// Two on-disk shapes reach the same editor. A `.canvas` file is Obsidian JSON
// Canvas; a `.canvas.json` file (and a session's scratch canvas) is the
// React-Flow encoding.
export type CanvasFormat = "jsonCanvas" | "reactFlow"

const JSON_CANVAS_SHAPE = [
  "It is an Obsidian JSON Canvas file (jsoncanvas.org):",
  '  { "nodes": [{ id, type: "text"|"group"|"link"|"file", x, y, width, height,',
  "                text?, label?, url?, file?, color? }],",
  '    "edges": [{ id, fromNode, toNode, fromSide?, toSide?, toEnd?, label?, color? }] }',
  "Coordinates are absolute; a group is a rectangle that visually contains the",
  'nodes drawn inside it. Colors are Obsidian\'s presets "1".."6".',
]

const REACT_FLOW_SHAPE = [
  "It is a JSON file with React-Flow shape:",
  "  { version: 1, nodes: [{ id, position:{x,y}, type?, data:{label?},",
  "                          parentId?, extent?: 'parent', style?:{width,height} }],",
  "    edges: [{ id, source, target, label? }] }",
  "Nodes with type 'group' act as containers; child nodes set parentId and",
  "extent:'parent' and use coordinates relative to the group's position.",
]

const SHAPE_BY_FORMAT: Record<CanvasFormat, readonly string[]> = {
  jsonCanvas: JSON_CANVAS_SHAPE,
  reactFlow: REACT_FLOW_SHAPE,
}

export const briefingMessage = (input: {
  readonly path: string
  readonly format: CanvasFormat
}): string =>
  [
    "You have a shared drawing at:",
    `  ${input.path}`,
    "",
    ...SHAPE_BY_FORMAT[input.format],
    "Edge labels render as text on the arrow.",
    "",
    "Use your Read tool to see what I drew, and your Write tool to update the",
    "whole file in one atomic write. The browser side syncs live — when you",
    "write, my canvas updates in real time, and I keep drawing meanwhile, so",
    "re-read the file before every write. Give new nodes unique ids.",
    "",
    "Help me improve the diagram: rename boxes, add arrows with labels,",
    "group related boxes, propose new nodes. Talk about your changes in chat.",
  ].join("\n")
