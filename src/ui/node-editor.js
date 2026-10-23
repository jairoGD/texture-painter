import { addTextureNode, BLEND_MODES, cloneTextureGraph, connectTextureNodes, NODE_TYPES, removeTextureNode } from '../editor/texture-graph.js';
import { readLayerStack, syncLayerMasks } from '../editor/layer-graph.js';
import { button, dropdown, element } from './index.js';
import { IMAGE_NUMBER_OPTIONS, IMAGE_SELECT_OPTIONS, imageNumberValue } from './image-node-options.js';
import './node-editor.css';

const NODE_WIDTH = 180;
export function createNodeEditor({ targets = [], onChange, onPreviewChange, onCreateImage, onImportImage,
  onPaintSourceChange, onError, onStateChange, onRecordGraphChange,
  onUndo, onRedo, onCanUndo, onCanRedo } = {}) {
  let targetMap = new Map();
  let activeId = null;
  let graph = null;
  let expanded = false;
  let selectedNode = null;
  let selectedLink = -1;
  let pendingLink = null;
  let externalWarpBefore = null;
  let externalWarpTarget = null;
  const view = { x: 0, y: 0, scale: 1 };

  const toggle = button({ label: 'Texture Nodes', icon: '▰', variant: 'ghost' });
  toggle.classList.add('node-editor__toggle');
  toggle.setAttribute('aria-expanded', 'false');
  const chevron = element('span', { className: 'node-editor__chevron', text: '▸', attributes: { 'aria-hidden': 'true' } });
  toggle.append(chevron);
  const header = element('div', { className: 'node-editor__header' }, [toggle,
    element('span', { className: 'node-editor__hint', text: 'Image layers → output' })]);
  const targetSelect = element('select', { className: 'node-editor__target',
    attributes: { 'aria-label': 'Active texture material' } });
  const undoButton = button({ label: 'Undo', variant: 'ghost', onClick: undo });
  const redoButton = button({ label: 'Redo', variant: 'ghost', onClick: redo });
  const frameButton = button({ label: 'Frame', variant: 'ghost', onClick: frameGraph });
  const addMenu = dropdown({ label: '+ Add Node', items: [
    { label: 'Solid Color', onSelect: () => addNode('color') },
    { label: 'Mix', onSelect: () => addNode('blend') },
    { label: 'Invert', onSelect: () => addNode('invert') },
    { label: 'Image', onSelect: () => addNode('image') }
  ] });
  const toolbar = element('div', { className: 'node-editor__toolbar' }, [
    addMenu, frameButton, undoButton, redoButton,
    element('span', { className: 'node-editor__spacer' }), targetSelect
  ]);
  const canvas = element('div', { className: 'node-editor__canvas', attributes: { tabindex: '0', 'aria-label': 'Texture node graph' } });
  const wires = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wires.classList.add('node-editor__wires');
  const stage = element('div', { className: 'node-editor__stage' });
  canvas.append(wires, stage);
  const body = element('div', { className: 'node-editor__body' }, [toolbar, canvas]);
  const root = element('section', { className: 'node-editor is-collapsed' }, [header, body]);

  function activeTarget() { return targetMap.get(activeId); }
  function validPaintSource(target, id) {
    return target.graph.nodes.some((node) => node.id === id && node.type === 'image' && node.imageKey);
  }
  function defaultPaintSource(target) {
    return readLayerStack(target.graph).layers.find((layer) =>
      validPaintSource(target, layer.source.id))?.source.id ?? null;
  }
  function ensurePaintSource(target) {
    if (validPaintSource(target, target.paintSource)) return false;
    const next = defaultPaintSource(target);
    const changed = target.paintSource !== next;
    target.paintSource = next;
    onPaintSourceChange?.(target.id, target.paintSource);
    return changed;
  }
  function getState() {
    return { targetId: activeId, graph: graph ? cloneTextureGraph(graph) : null,
      paintSource: activeTarget()?.paintSource ?? null,
      targets: [...targetMap.values()].map(({ id, label, color }) => ({ id, label, color })) };
  }
  function notifyState() { onStateChange?.(getState()); }
  function getProjectState() {
    const targets = [...targetMap.values()];
    return { activeIndex: Math.max(0, targets.findIndex((target) => target.id === activeId)),
      paintSources: targets.map((target) => target.paintSource), expanded };
  }
  function restoreProjectState(saved = {}) {
    const targets = [...targetMap.values()];
    targets.forEach((target, index) => {
      const source = saved.paintSources?.[index];
      target.paintSource = validPaintSource(target, source) ? source : defaultPaintSource(target);
      onPaintSourceChange?.(target.id, target.paintSource);
    });
    activeId = targets[saved.activeIndex]?.id ?? targets[0]?.id ?? null;
    graph = activeTarget()?.graph ?? null;
    targetSelect.value = activeId ?? '';
    setExpanded(Boolean(saved.expanded));
    renderGraph(); notifyState();
  }

  function updateHistoryButtons() {
    undoButton.disabled = onCanUndo ? !onCanUndo() : !activeTarget()?.history.length;
    redoButton.disabled = onCanRedo ? !onCanRedo() : !activeTarget()?.future.length;
  }

  function changed(before) {
    if (!graph || JSON.stringify(before) === JSON.stringify(graph)) return;
    if (JSON.stringify(before.links) !== JSON.stringify(graph.links) &&
        graph.nodes.some((node) => node.layerIsMask || node.layerGeneratedFor)) {
      syncLayerMasks(graph);
      renderGraph();
    }
    const target = activeTarget();
    const after = cloneTextureGraph(graph);
    if (!onRecordGraphChange) {
      target.history.push(before);
      target.future = [];
    }
    onChange?.(activeId, after);
    onRecordGraphChange?.(activeId, before, after);
    updateHistoryButtons();
    if (ensurePaintSource(target)) renderGraph();
    notifyState();
  }

  function previewChange() { onChange?.(activeId, cloneTextureGraph(graph)); }

  function beginWarpTransform(targetId, nodeId) {
    const target = targetMap.get(targetId);
    if (!target?.graph.nodes.some((node) => node.id === nodeId && node.type === 'image')) return;
    externalWarpBefore = cloneTextureGraph(target.graph);
    externalWarpTarget = { targetId, nodeId };
  }

  function previewWarpTransform(targetId, nodeId, warp) {
    if (externalWarpTarget?.targetId !== targetId || externalWarpTarget.nodeId !== nodeId) return;
    const target = targetMap.get(targetId);
    const node = target?.graph.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    node.warp = warp;
    onPreviewChange?.(targetId, cloneTextureGraph(target.graph));
  }

  function finishWarpTransform(targetId, nodeId, warp) {
    if (externalWarpTarget?.targetId !== targetId || externalWarpTarget.nodeId !== nodeId) return;
    previewWarpTransform(targetId, nodeId, warp);
    const before = externalWarpBefore;
    externalWarpBefore = null;
    externalWarpTarget = null;
    if (before && targetId === activeId) changed(before);
  }

  function undo() {
    if (onUndo) { onUndo(); return; }
    const target = activeTarget();
    if (!target?.history.length) return;
    target.future.push(cloneTextureGraph(graph));
    graph = target.graph = target.history.pop();
    selectedNode = null; selectedLink = -1;
    renderGraph(); previewChange();
    if (ensurePaintSource(target)) renderGraph();
    notifyState();
  }

  function redo() {
    if (onRedo) { onRedo(); return; }
    const target = activeTarget();
    if (!target?.future.length) return;
    target.history.push(cloneTextureGraph(graph));
    graph = target.graph = target.future.pop();
    selectedNode = null; selectedLink = -1;
    renderGraph(); previewChange();
    if (ensurePaintSource(target)) renderGraph();
    notifyState();
  }

  function selectTarget(id) {
    if (!targetMap.has(id) || activeId === id) return;
    activeId = id;
    graph = activeTarget().graph;
    targetSelect.value = id;
    selectedNode = null; selectedLink = -1; pendingLink = null;
    renderGraph();
    if (expanded) requestAnimationFrame(frameGraph);
    notifyState();
  }

  function applyHistoryGraph(targetId, restoredGraph) {
    const target = targetMap.get(targetId);
    if (!target) return;
    target.graph = cloneTextureGraph(restoredGraph);
    if (activeId === targetId) {
      graph = target.graph;
      if (!graph.nodes.some((node) => node.id === selectedNode)) selectedNode = null;
      selectedLink = -1;
      renderGraph();
      if (ensurePaintSource(target)) renderGraph();
      notifyState();
    }
    updateHistoryButtons();
  }

  function setTargets(next) {
    targetMap = new Map(next.map((target) => [target.id, {
      id: target.id, label: target.label, color: target.color, graph: cloneTextureGraph(target.graph),
      paintSource: null, history: [], future: []
    }]));
    targetSelect.replaceChildren(...[...targetMap.values()].map((target) =>
      element('option', { text: target.label, attributes: { value: target.id } })));
    activeId = targetMap.keys().next().value ?? null;
    graph = activeTarget()?.graph ?? null;
    for (const target of targetMap.values()) ensurePaintSource(target);
    selectedNode = null; selectedLink = -1; pendingLink = null;
    renderGraph();
    if (expanded) requestAnimationFrame(frameGraph);
    notifyState();
  }

  function replaceGraph(nextGraph) {
    if (!activeTarget() || !nextGraph) return;
    const before = cloneTextureGraph(graph);
    graph = activeTarget().graph = cloneTextureGraph(nextGraph);
    renderGraph(); changed(before);
    if (expanded) requestAnimationFrame(frameGraph);
  }

  function previewGraph(mutator) {
    if (!graph) return;
    mutator(graph);
    renderGraph(); previewChange();
  }

  function finishGraphChange(before) { changed(before); }

  function addNode(type) {
    if (!graph) return;
    const before = cloneTextureGraph(graph);
    const center = screenToGraph(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const node = addTextureNode(graph, type, { x: center.x - NODE_WIDTH / 2, y: center.y - 60 });
    if (!node) return;
    selectedNode = node.id; selectedLink = -1;
    renderGraph(); changed(before);
    requestAnimationFrame(frameGraph);
  }

  function deleteSelection() {
    if (!graph) return;
    const before = cloneTextureGraph(graph);
    if (selectedLink >= 0) graph.links.splice(selectedLink, 1);
    else if (!removeTextureNode(graph, selectedNode)) return;
    selectedNode = null; selectedLink = -1;
    renderGraph(); changed(before);
  }

  function screenToGraph(x, y) { return { x: (x - view.x) / view.scale, y: (y - view.y) / view.scale }; }
  function eventPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function applyView() {
    stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    canvas.style.backgroundPosition = `${view.x}px ${view.y}px`;
    canvas.style.backgroundSize = `${24 * view.scale}px ${24 * view.scale}px`;
    renderLinks();
  }

  function frameGraph() {
    if (!graph?.nodes.length || !canvas.clientWidth || !canvas.clientHeight) return;
    const minX = Math.min(...graph.nodes.map((node) => node.x));
    const minY = Math.min(...graph.nodes.map((node) => node.y));
    const maxX = Math.max(...graph.nodes.map((node) => node.x + NODE_WIDTH));
    const maxY = Math.max(...graph.nodes.map((node, index) => node.y + (stage.children[index]?.offsetHeight ?? 80)));
    const width = maxX - minX;
    const height = maxY - minY;
    view.scale = Math.min(1.25, Math.max(.35, Math.min(
      (canvas.clientWidth - 100) / width, (canvas.clientHeight - 65) / height)));
    view.x = (canvas.clientWidth - width * view.scale) / 2 - minX * view.scale;
    view.y = (canvas.clientHeight - height * view.scale) / 2 - minY * view.scale;
    applyView();
  }

  function curve(from, to) {
    const bend = Math.max(55, Math.abs(to.x - from.x) * .45);
    return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
  }

  function socketPoint(node, socket, side) {
    const nodeElement = [...stage.children].find((item) => item.dataset.nodeId === node.id);
    const pin = [...(nodeElement?.querySelectorAll('.node-editor__socket') ?? [])]
      .find((item) => item.dataset.socket === socket && item.dataset.socketSide === side);
    if (!pin) return null;
    const bounds = pin.getBoundingClientRect();
    const origin = canvas.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2 - origin.left,
      y: bounds.top + bounds.height / 2 - origin.top };
  }

  function renderLinks() {
    wires.replaceChildren();
    if (!graph) return;
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    graph.links.forEach((link, index) => {
      const source = nodes.get(link.from);
      const target = nodes.get(link.to);
      if (!source || !target) return;
      const from = socketPoint(source, link.fromSocket, 'out');
      const to = socketPoint(target, link.toSocket, 'in');
      if (!from || !to) return;
      const path = curve(from, to);
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const visible = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      visible.setAttribute('d', path);
      visible.setAttribute('class', `node-editor__wire${selectedLink === index ? ' is-selected' : ''}`);
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hit.setAttribute('d', path);
      hit.setAttribute('class', 'node-editor__wire-hit');
      hit.addEventListener('click', (event) => {
        event.stopPropagation(); selectedNode = null; selectedLink = index; renderGraph();
      });
      hit.addEventListener('contextmenu', (event) => {
        event.preventDefault(); event.stopPropagation();
        selectedLink = index; deleteSelection();
      });
      group.append(visible, hit);
      wires.append(group);
    });
    if (pendingLink) {
      const source = nodes.get(pendingLink.from);
      if (!source) return;
      const preview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const from = socketPoint(source, pendingLink.fromSocket, 'out');
      if (!from) return;
      preview.setAttribute('d', curve(from, pendingLink.point));
      preview.setAttribute('class', 'node-editor__wire is-pending');
      wires.append(preview);
    }
  }

  function startLink(event, node, socket) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    canvas.focus({ preventScroll: true });
    pendingLink = { from: node.id, fromSocket: socket, point: eventPoint(event) };
    renderLinks();
    const move = (moveEvent) => {
      pendingLink.point = eventPoint(moveEvent);
      renderLinks();
    };
    const end = (upEvent) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      const target = document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest('[data-socket-side="in"]');
      const link = pendingLink;
      pendingLink = null;
      if (target && link) {
        const before = cloneTextureGraph(graph);
        if (connectTextureNodes(graph, link.from, link.fromSocket, target.dataset.nodeId, target.dataset.socket)) {
          selectedNode = null; selectedLink = graph.links.length - 1;
          renderGraph(); changed(before); return;
        }
      }
      renderLinks();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
  }

  function startNodeDrag(event, node, nodeElement) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    canvas.focus({ preventScroll: true });
    selectedNode = node.id; selectedLink = -1;
    updateSelection();
    const before = cloneTextureGraph(graph);
    const start = { x: event.clientX, y: event.clientY, nodeX: node.x, nodeY: node.y };
    const move = (moveEvent) => {
      node.x = Math.round(start.nodeX + (moveEvent.clientX - start.x) / view.scale);
      node.y = Math.round(start.nodeY + (moveEvent.clientY - start.y) / view.scale);
      nodeElement.style.left = `${node.x}px`;
      nodeElement.style.top = `${node.y}px`;
      renderLinks();
    };
    const end = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      changed(before);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
  }

  function updateSelection() {
    stage.querySelectorAll('.node-editor__node').forEach((node) =>
      node.classList.toggle('is-selected', node.dataset.nodeId === selectedNode));
    renderLinks();
  }

  function choosePaintSource(nodeId) {
    if (!onPaintSourceChange?.(activeId, nodeId)) return;
    activeTarget().paintSource = nodeId;
    renderGraph();
    notifyState();
  }

  function assignImage(node, asset) {
    if (!asset) return;
    const before = cloneTextureGraph(graph);
    node.imageKey = asset.key;
    node.imageName = asset.name;
    node.extension = asset.imported ? 'clip' : 'repeat';
    changed(before);
    choosePaintSource(node.id);
  }

  function renderNode(node) {
    const definition = NODE_TYPES[node.type];
    const rootNode = element('div', { className: `node-editor__node node-editor__node--${node.type}`,
      attributes: { 'data-node-id': node.id } });
    rootNode.style.left = `${node.x}px`;
    rootNode.style.top = `${node.y}px`;
    const owner = graph.nodes.find((item) => item.id === (node.layerMaskOwner || node.layerInvertOwner));
    if (node.layerIsMask) rootNode.classList.add('is-mask-layer');
    const title = element('div', { className: 'node-editor__node-title',
      text: node.type === 'layerMask' ? `Apply Mask · ${owner?.layerName || 'Layer'}` :
        node.layerInvertOwner ? `Invert · ${owner?.layerName || 'Layer'}` :
        node.layerIsMask ? `Mask Layer · ${node.layerName || 'Layer'}` : definition.title });
    title.addEventListener('pointerdown', (event) => startNodeDrag(event, node, rootNode));
    rootNode.append(title);
    rootNode.addEventListener('pointerdown', (event) => {
      if (event.target.closest('[data-socket-side], input')) return;
      selectedNode = node.id; selectedLink = -1; updateSelection();
    });
    const socketRow = (side, socket, extra = null) => {
      const row = element('div', { className: `node-editor__row node-editor__row--${side}` });
      const pin = element('button', { className: `node-editor__socket node-editor__socket--${side}`,
        attributes: { type: 'button', 'data-node-id': node.id, 'data-socket': socket,
          'data-socket-side': side, 'aria-label': `${definition.title} ${socket} ${side === 'in' ? 'input' : 'output'}` } });
      if (side === 'out') pin.addEventListener('pointerdown', (event) => startLink(event, node, socket));
      row.append(pin, element('span', { text: socket }));
      if (extra) row.append(extra);
      return row;
    };
    if (node.type !== 'blend') {
      for (const socket of definition.inputs) rootNode.append(socketRow('in', socket));
      for (const socket of definition.outputs) rootNode.append(socketRow('out', socket));
    }
    if (node.type === 'color') {
      let before = cloneTextureGraph(graph);
      const field = element('input', { className: 'node-editor__color',
        attributes: { type: 'color', value: node.color, 'aria-label': 'Solid Color node color' },
        on: {
          input: (event) => { node.color = event.target.value; previewChange(); },
          change: () => { changed(before); before = cloneTextureGraph(graph); }
        } });
      rootNode.append(element('label', { className: 'node-editor__control' },
        [element('span', { text: 'Color' }), field]));
    }
    if (node.type === 'blend') {
      rootNode.append(socketRow('out', 'Result'));
      const mode = element('select', { className: 'node-editor__mode', attributes: { 'aria-label': 'Blending mode' } },
        BLEND_MODES.map(([value, label]) => element('option', { text: label, attributes: { value } })));
      mode.value = node.mode;
      mode.addEventListener('change', () => {
        const before = cloneTextureGraph(graph);
        node.mode = mode.value;
        changed(before);
      });
      rootNode.append(element('label', { className: 'node-editor__control' },
        [element('span', { text: 'Mode' }), mode]));
      let factorBefore = cloneTextureGraph(graph);
      const value = element('output', { text: Number(node.factor).toFixed(2) });
      const factor = element('input', { className: 'node-editor__range',
        attributes: { type: 'range', min: 0, max: 1, step: 0.01, value: node.factor, 'aria-label': 'Mix factor' },
        on: {
          input: (event) => { node.factor = Number(event.target.value); value.value = node.factor.toFixed(2); previewChange(); },
          change: () => { changed(factorBefore); factorBefore = cloneTextureGraph(graph); }
        } });
      rootNode.append(socketRow('in', 'Factor', value));
      rootNode.append(element('div', { className: 'node-editor__control node-editor__control--range' }, [factor]));
      for (const socket of ['A', 'B']) {
        let colorBefore = cloneTextureGraph(graph);
        const key = socket === 'A' ? 'colorA' : 'colorB';
        const color = element('input', { className: 'node-editor__color',
          attributes: { type: 'color', value: node[key], 'aria-label': `Mix ${socket} fallback color` },
          on: {
            input: (event) => { node[key] = event.target.value; previewChange(); },
            change: () => { changed(colorBefore); colorBefore = cloneTextureGraph(graph); }
          } });
        color.disabled = graph.links.some((link) => link.to === node.id && link.toSocket === socket);
        rootNode.append(socketRow('in', socket, color));
      }
    }
    if (node.type === 'image') {
      rootNode.append(element('div', { className: 'node-editor__image-name',
        text: node.imageName || 'No image selected' }));
      const fileInput = element('input', { attributes: {
        type: 'file', accept: 'image/png,image/jpeg,image/webp,image/bmp', hidden: ''
      } });
      const error = element('div', { className: 'node-editor__error' });
      const newButton = button({ label: 'New', variant: 'ghost', onClick: () => {
        assignImage(node, onCreateImage?.(activeId, node.id));
      } });
      const openButton = button({ label: 'Open', variant: 'ghost', onClick: () => fileInput.click() });
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        try {
          const asset = await onImportImage?.(activeId, node.id, file);
          assignImage(node, asset);
        } catch (cause) {
          error.textContent = cause.message || 'Could not open image';
          onError?.(error.textContent);
        } finally { fileInput.value = ''; }
      });
      rootNode.append(element('div', { className: 'node-editor__image-actions' },
        [newButton, openButton, fileInput]), error);
      for (const [key, label, choices] of IMAGE_SELECT_OPTIONS) {
        const field = element('select', { className: 'node-editor__mode',
          attributes: { 'aria-label': `Image ${label.toLowerCase()}` } },
          choices.map(([value, text]) => element('option', { text, attributes: { value } })));
        field.value = node[key];
        field.addEventListener('change', () => {
          const before = cloneTextureGraph(graph);
          node[key] = field.value;
          changed(before);
        });
        rootNode.append(element('label', { className: 'node-editor__control' },
          [element('span', { text: label }), field]));
      }
      for (const [key, label, min, max] of IMAGE_NUMBER_OPTIONS) {
        const field = element('input', { className: 'node-editor__number',
          attributes: { type: 'number', min, max, step: 0.1, value: node[key],
            'aria-label': `Image ${label.toLowerCase()}` } });
        field.addEventListener('change', () => {
          const before = cloneTextureGraph(graph);
          node[key] = imageNumberValue(key, field.value, min, max);
          field.value = node[key];
          changed(before);
        });
        rootNode.append(element('label', { className: 'node-editor__control' },
          [element('span', { text: label }), field]));
      }
      const active = activeTarget()?.paintSource === node.id;
      rootNode.append(button({ label: active ? 'Painting here' : 'Paint here', variant: 'ghost',
        disabled: !node.imageKey || active, onClick: () => choosePaintSource(node.id) }));
    }
    return rootNode;
  }

  function renderGraph() {
    stage.replaceChildren(...(graph?.nodes ?? []).map(renderNode));
    updateSelection();
    updateHistoryButtons();
    applyView();
  }

  function setExpanded(next) {
    expanded = next;
    root.classList.toggle('is-collapsed', !expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    chevron.textContent = expanded ? '▾' : '▸';
    if (expanded) requestAnimationFrame(frameGraph);
  }

  toggle.addEventListener('click', () => setExpanded(!expanded));
  targetSelect.addEventListener('change', () => selectTarget(targetSelect.value));
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const point = eventPoint(event);
    const before = screenToGraph(point.x, point.y);
    view.scale = Math.max(.3, Math.min(2, view.scale * (event.deltaY < 0 ? 1.12 : .89)));
    view.x = point.x - before.x * view.scale;
    view.y = point.y - before.y * view.scale;
    applyView();
  }, { passive: false });
  canvas.addEventListener('pointerdown', (event) => {
    const background = event.target === canvas || event.target === stage || event.target === wires;
    if (event.button === 0 && background && !event.altKey) {
      selectedNode = null; selectedLink = -1; updateSelection();
      canvas.focus({ preventScroll: true });
      return;
    }
    if (event.button !== 1 && !(event.button === 0 && event.altKey)) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
    canvas.classList.add('is-panning');
    const move = (moveEvent) => {
      view.x = start.viewX + moveEvent.clientX - start.x;
      view.y = start.viewY + moveEvent.clientY - start.y;
      applyView();
    };
    const end = () => {
      canvas.classList.remove('is-panning');
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  root.addEventListener('keydown', (event) => {
    if (!expanded || event.target.matches('input, select')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); event.stopPropagation();
      if (event.shiftKey) redo(); else undo();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); event.stopPropagation(); deleteSelection();
    } else if (event.key === 'Escape') {
      selectedNode = null; selectedLink = -1; pendingLink = null; updateSelection();
    }
  });
  setTargets(targets);
  return { element: root, setTargets, selectTarget, setExpanded, getState, getProjectState, restoreProjectState,
    replaceGraph, previewGraph, finishGraphChange, choosePaintSource,
    applyHistoryGraph, refreshHistoryButtons: updateHistoryButtons,
    beginWarpTransform, previewWarpTransform, finishWarpTransform };
}
