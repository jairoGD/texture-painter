const DATABASE = 'texture-painter-projects';
const STORE = 'recent';
const MODEL_HANDLES = 'model-handles';
export const PROJECT_VERSION = 3;

export function parseProject(text) {
  let project;
  try { project = JSON.parse(text); }
  catch { throw new Error('This is not a valid .tp3d project.'); }
  if (project?.format !== 'tp3d' || project.version !== PROJECT_VERSION ||
      typeof project.id !== 'string' || typeof project.name !== 'string' ||
      !project.scene || !Array.isArray(project.scene.textures) ||
      !['starter', 'glb', 'fbx'].includes(project.scene.model?.kind))
    throw new Error('Unsupported or incomplete .tp3d project.');
  if (project.scene.model.kind !== 'starter' &&
      (typeof project.scene.model.referenceId !== 'string' ||
        typeof project.scene.model.name !== 'string'))
    throw new Error('The project has no valid model reference.');
  return project;
}

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains(MODEL_HANDLES))
        request.result.createObjectStore(MODEL_HANDLES);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction(storeName, mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const result = action(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(result.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function saveRecent(project, handle = null) {
  await transaction(STORE, 'readwrite', (store) => store.put({
    id: project.id, name: project.name, updatedAt: new Date().toISOString(),
    document: JSON.stringify(project), handle
  }));
}

export async function listRecent() {
  const records = await transaction(STORE, 'readonly', (store) => store.getAll());
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10);
}

export async function removeRecent(id) {
  await transaction(STORE, 'readwrite', (store) => store.delete(id));
}

export async function saveModelHandle(referenceId, handle) {
  await transaction(MODEL_HANDLES, 'readwrite', (store) => store.put(handle, referenceId));
}

export async function getModelHandle(referenceId) {
  return transaction(MODEL_HANDLES, 'readonly', (store) => store.get(referenceId));
}

export function projectFileName(name) {
  return `${(name || 'Untitled Project').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.tp3d`;
}

export async function writeProjectFile(handle, project) {
  const writable = await handle.createWritable();
  try {
    await writable.write(new Blob([JSON.stringify(project)], { type: 'application/json' }));
    await writable.close();
  } catch (error) {
    try { await writable.abort(); } catch { /* The browser may already have closed the stream. */ }
    throw error;
  }
}
