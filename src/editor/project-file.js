const DATABASE = 'texture-painter-projects';
const STORE = 'recent';
export const PROJECT_VERSION = 2;

export function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function parseProject(text) {
  let project;
  try { project = JSON.parse(text); }
  catch { throw new Error('This is not a valid .tp3d project.'); }
  if (project?.format !== 'tp3d' || project.version !== PROJECT_VERSION ||
      typeof project.id !== 'string' || typeof project.name !== 'string' ||
      !project.scene || !Array.isArray(project.scene.textures) ||
      !['starter', 'glb'].includes(project.scene.model?.kind))
    throw new Error('Unsupported or incomplete .tp3d project.');
  if (project.scene.model.kind === 'glb' && typeof project.scene.model.data !== 'string')
    throw new Error('The project has no embedded GLB model.');
  return project;
}

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction(mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function saveRecent(project, handle = null) {
  await transaction('readwrite', (store) => store.put({
    id: project.id, name: project.name, updatedAt: new Date().toISOString(),
    document: JSON.stringify(project), handle
  }));
}

export async function listRecent() {
  const records = await transaction('readonly', (store) => store.getAll());
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10);
}

export async function removeRecent(id) {
  await transaction('readwrite', (store) => store.delete(id));
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
