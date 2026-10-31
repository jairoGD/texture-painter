export function createBakeWorker(kind) {
  if (kind === 'ambient-occlusion')
    return new Worker(new URL('./ambient-occlusion-worker.js', import.meta.url),
      { type: 'module' });
  if (kind === 'curvature')
    return new Worker(new URL('./curvature-worker.js', import.meta.url),
      { type: 'module' });
  throw new Error(`Unknown bake worker: ${kind}`);
}
