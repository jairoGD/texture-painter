export function createBakeWorker(kind) {
  const source = __FILE_WORKER_SOURCES__[kind];
  if (!source) throw new Error(`Unknown bake worker: ${kind}`);
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    const worker = new Worker(url);
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return worker;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
