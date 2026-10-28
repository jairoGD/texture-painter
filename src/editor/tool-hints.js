const TOOL_HINTS = {
  brush: 'Drag: paint · Shift+Drag: blur · Ctrl+Drag: erase · Right-click: pick color',
  vertexBrush: 'Drag: paint vertex colors on the selected material',
  vertexBlur: 'Drag: soften neighboring vertex colors',
  vertexBucket: 'Click: fill selected vertices or the entire material',
  vertexFaces: 'Click/Drag: select faces · Shift: add · Alt: subtract',
  vertexSelect: 'Click/Drag: select vertices · Shift: add · Alt: subtract',
  eraser: 'Drag: erase pixels · Right-click: pick color',
  bucket: 'Click: fill connected area · Right-click: pick color',
  line: 'Drag: draw line · Ctrl+Drag: draw through the model',
  gradient: 'Drag: project gradient · X-ray: include the back of the model',
  blur: 'Drag: soften painted pixels · A selection limits the effect',
  lasso: 'Drag: select area · Shift+Drag: add · Alt+Drag: subtract · Drag inside: move',
  wand: 'Click: select matching pixels · Shift+Click: add · Alt+Click: subtract',
  faces: 'Click: select face · Ctrl+Click: shortest path · Double-click: connected faces · Alt+Click edge: face loop · Shift+Alt+Click edge: add loop · Drag: box select · Alt+Click face: subtract',
  eyedropper: 'Click: pick color from the model'
};

export function toolHint(toolId, settings = {}) {
  if (toolId === 'faces' && settings.geometry)
    return 'Click/Drag: select faces · Ctrl+Click: shortest path · Alt+Click edge: face loop · Shift+Alt+Click: add loop · Double-click: connected faces · Ctrl+I: invert · H: hide · Alt+H: show all';
  if (toolId === 'stamp') return settings.stroke ?
    settings.proportionalStroke === false ?
      'Drag: stretch length · Size: fixed width · Right-click: pick color' :
      'Drag: scale image proportionally · Right-click: pick color' :
    'Click: place image · Right-click: pick color';
  if (toolId === 'curve') return settings.curveMethod === 'precise' ?
    'Click: add point · Drag point: move · Enter: paint · Esc: cancel' :
    'Drag: set endpoints · Drag twice: shape handles · Esc: cancel';
  return TOOL_HINTS[toolId] ?? '';
}
