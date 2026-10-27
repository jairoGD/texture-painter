// A top-level vertex layer can be composited on the mesh instead of through UVs.
// This keeps mirrored UV islands independent in the viewport.
export function vertexDisplayPlan(graph) {
  const output = graph.links.find((link) => link.to === 'output' && link.toSocket === 'Color');
  const mix = graph.nodes.find((node) => node.id === output?.from);
  if (output?.fromSocket !== 'Result' || mix?.type !== 'blend' ||
      (mix.mode ?? 'mix') !== 'mix' || mix.layerVisible === false || mix.layerIsMask ||
      mix.layerInvert || mix.layerParentId ||
      graph.links.some((link) => link.to === mix.id && link.toSocket === 'Factor')) return null;
  const sourceLink = graph.links.find((link) => link.to === mix.id && link.toSocket === 'B');
  const source = graph.nodes.find((node) => node.id === sourceLink?.from);
  if (sourceLink?.fromSocket !== 'Color' || source?.type !== 'image' ||
      !source.vertexColor ||
      source.id !== mix.layerSourceId) return null;
  const factor = Math.max(0, Math.min(1, Number(mix.factor ?? 1) || 0));
  if (!factor) return null;
  return { mixId: mix.id, factor };
}

export function graphBelowVertexLayer(graph, plan) {
  const below = structuredClone(graph);
  below.links = below.links.filter((link) =>
    !(link.to === 'output' && link.toSocket === 'Color'));
  const input = below.links.find((link) => link.to === plan.mixId && link.toSocket === 'A');
  if (input) below.links.push({ from: input.from, fromSocket: input.fromSocket,
    to: 'output', toSocket: 'Color' });
  return below;
}
