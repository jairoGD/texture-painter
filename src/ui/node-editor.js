import { addTextureNode, cloneTextureGraph, connectTextureNodes, NODE_TYPES, removeTextureNode } from '../editor/texture-graph.js';
import { button, dropdown, element } from './index.js';
import './node-editor.css';

const NODE_WIDTH = 180;
const HEADER_HEIGHT = 29;
const ROW_HEIGHT = 30;
const BODY_PADDING = 9;

function nodeHeight(node) {
  const definition = NODE_TYPES[node.type];
  return HEADER_HEIGHT + BODY_PADDING * 2 +
    (definition.inputs.length + definition.outputs.length) * ROW_HEIGHT +
    (node.type === 'color' ? 40 : node.type === 'blend' ? 52 : 0);
}

function socketY(node, socket, side) {
  const definition = NODE_TYPES[node.type];
  const index = side === 'in' ? definition.inputs.indexOf(socket) :
    definition.inputs.length + definition.outputs.indexOf(socket);
  return node.y + HEADER_HEIGHT + BODY_PADDING + (index + .5) * ROW_HEIGHT;
}

export function createNodeEditor({ targets = [], onChange } = {}) {
  let targetMap = new Map();
  let activeId = null;
  let graph = null;
  let expanded = false;
  let selectedNode = null;
  let selectedLink = -1;
  let pendingLink = null;
  const view = { x: 0, y: 0, scale: 1 };

  const toggle = button({ label: 'Texture Nodes', icon: '▰', variant: 'ghost' });
  toggle.classList.add('node-editor__toggle');
  toggle.setAttribute('aria-expanded', 'false');
  const chevron = element('span', { className: 'node-editor__chevron', text: '▸', attributes: { 'aria-hidden': 'true' } });
  toggle.append(chevron);
  const header = element('div', { className: 'node-editor__header' }, [toggle,
    element('span', { className: 'node-editor__hint', text: 'Paint texture → output' })]);
  const targetSelect = element('select', { className: 'node-editor__target',
    attributes: { 'aria-label': 'Active texture material' } });
  const undoButton = button({ label: 'Undo', variant: 'ghost', onClick: undo });
  const redoButton = button({ label: 'Redo', variant: 'ghost', onClick: redo });
  const frameButton = button({ label: 'Frame', variant: 'ghost', onClick: frameGraph });
  const addMenu = dropdown({ label: '+ Add Node', items: [
    { label: 'Solid Color', onSelect: () => addNode('color') },
    { label: 'Mix', onSelect: () => addNode('blend') }
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

  function updateHistoryButtons() {
    undoButton.disabled = !activeTarget()?.history.length;
    redoButton.disabled = !activeTarget()?.future.length;
  }

  function changed(before) {
    if (!graph || JSON.stringify(before) === JSON.stringify(graph)) return;
    const target = activeTarget();
    target.history.push(before);
    target.future = [];
    updateHistoryButtons();
    onChange?.(activeId, cloneTextureGraph(graph));
  }

  function previewChange() { onChange?.(activeId, cloneTextureGraph(graph)); }

  function undo() {
    const target = activeTarget();
    if (!target?.history.length) return;
    target.future.push(cloneTextureGraph(graph));
    graph = target.graph = target.history.pop();
    selectedNode = null; selectedLink = -1;
    renderGraph(); previewChange();
  }

  function redo() {
    const target = activeTarget();
    if (!target?.future.length) return;
    target.history.push(cloneTextureGraph(graph));
    graph = target.graph = target.future.pop();
    selectedNode = null; selectedLink = -1;
    renderGraph(); previewChange();
  }

  function selectTarget(id) {
    if (!targetMap.has(id) || activeId === id) return;
    activeId = id;
    graph = activeTarget().graph;
    targetSelect.value = id;
    selectedNode = null; selectedLink = -1; pendingLink = null;
    renderGraph();
    if (expanded) requestAnimationFrame(frameGraph);
  }

  function setTargets(next) {
    targetMap = new Map(next.map((target) => [target.id, {
      id: target.id, label: target.label, graph: cloneTextureGraph(target.graph), history: [], future: []
    }]));
    targetSelect.replaceChildren(...[...targetMap.values()].map((target) =>
      element('option', { text: target.label, attributes: { value: target.id } })));
    activeId = targetMap.keys().next().value ?? null;
    graph = activeTarget()?.graph ?? null;
    selectedNode = null; selectedLink = -1; pendingLink = null;
    renderGraph();
    if (expanded) requestAnimationFrame(frameGraph);
  }

  function addNode(type) {
    if (!graph) return;
    const before = cloneTextureGraph(graph);
    const center = screenToGraph(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const node = addTextureNode(graph, type, { x: center.x - NODE_WIDTH / 2, y: center.y - 60 });
    if (!node) return;
    selectedNode = node.id; selectedLink = -1;
    renderGraph(); changed(before);
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
  function worldToScreen(x, y) { return { x: x * view.scale + view.x, y: y * view.scale + view.y }; }
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
    const maxY = Math.max(...graph.nodes.map((node) => node.y + nodeHeight(node)));
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
    return worldToScreen(node.x + (side === 'out' ? NODE_WIDTH : 0), socketY(node, socket, side));
  }

  function renderLinks() {
    wires.replaceChildren();
    if (!graph) return;
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    graph.links.forEach((link, index) => {
      const source = nodes.get(link.from);
      const target = nodes.get(link.to);
      if (!source || !target) return;
      const path = curve(socketPoint(source, link.fromSocket, 'out'), socketPoint(target, link.toSocket, 'in'));
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
      preview.setAttribute('d', curve(socketPoint(source, pendingLink.fromSocket, 'out'), pendingLink.point));
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

  function renderNode(node) {
    const definition = NODE_TYPES[node.type];
    const rootNode = element('div', { className: `node-editor__node node-editor__node--${node.type}`,
      attributes: { 'data-node-id': node.id } });
    rootNode.style.left = `${node.x}px`;
    rootNode.style.top = `${node.y}px`;
    const title = element('div', { className: 'node-editor__node-title', text: definition.title });
    title.addEventListener('pointerdown', (event) => startNodeDrag(event, node, rootNode));
    rootNode.append(title);
    rootNode.addEventListener('pointerdown', (event) => {
      if (event.target.closest('[data-socket-side], input')) return;
      selectedNode = node.id; selectedLink = -1; updateSelection();
    });
    for (const [side, sockets] of [['in', definition.inputs], ['out', definition.outputs]]) {
      for (const socket of sockets) {
        const row = element('div', { className: `node-editor__row node-editor__row--${side}` });
        const pin = element('button', { className: `node-editor__socket node-editor__socket--${side}`,
          attributes: { type: 'button', 'data-node-id': node.id, 'data-socket': socket,
            'data-socket-side': side, 'aria-label': `${definition.title} ${socket} ${side === 'in' ? 'input' : 'output'}` } });
        if (side === 'out') pin.addEventListener('pointerdown', (event) => startLink(event, node, socket));
        row.append(pin, element('span', { text: socket }));
        rootNode.append(row);
      }
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
      let before = cloneTextureGraph(graph);
      const value = element('output', { text: `${node.opacity}%` });
      const field = element('input', { className: 'node-editor__range',
        attributes: { type: 'range', min: 0, max: 100, value: node.opacity, 'aria-label': 'Mix opacity' },
        on: {
          input: (event) => { node.opacity = Number(event.target.value); value.value = `${node.opacity}%`; previewChange(); },
          change: () => { changed(before); before = cloneTextureGraph(graph); }
        } });
      rootNode.append(element('label', { className: 'node-editor__control node-editor__control--range' },
        [element('span', { text: 'Opacity' }), value, field]));
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
  return { element: root, setTargets, selectTarget, setExpanded };
}
