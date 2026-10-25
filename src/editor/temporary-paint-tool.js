export function resolveTemporaryPaintTool(activeTool, settings, { ctrlKey = false, shiftKey = false } = {}) {
  if (activeTool !== 'brush') return { kind: activeTool, options: settings[activeTool] };
  if (ctrlKey) return { kind: 'eraser', options: { ...settings.brush } };
  if (shiftKey) return { kind: 'blur', options: settings.blur };
  return { kind: 'brush', options: settings.brush };
}
