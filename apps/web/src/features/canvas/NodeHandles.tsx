import { Handle, Position } from "@xyflow/react"

// Box, link, and file nodes all expose the same eight connection points: a
// source+target pair on each of the four sides. Centralized here so the node
// components don't each carry the identical handle block.

const HANDLE_STYLE = { width: 8, height: 8 }

export const NodeHandles = () => (
  <>
    <Handle id="top" type="target" position={Position.Top} style={HANDLE_STYLE} />
    <Handle id="top" type="source" position={Position.Top} style={HANDLE_STYLE} />
    <Handle id="right" type="target" position={Position.Right} style={HANDLE_STYLE} />
    <Handle id="right" type="source" position={Position.Right} style={HANDLE_STYLE} />
    <Handle id="bottom" type="target" position={Position.Bottom} style={HANDLE_STYLE} />
    <Handle id="bottom" type="source" position={Position.Bottom} style={HANDLE_STYLE} />
    <Handle id="left" type="target" position={Position.Left} style={HANDLE_STYLE} />
    <Handle id="left" type="source" position={Position.Left} style={HANDLE_STYLE} />
  </>
)
