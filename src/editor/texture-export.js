export function textureFileName(name) {
  let stem = String(name ?? '').trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .slice(0, 180)
    .replace(/[. ]+$/g, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = `_${stem}`;
  return stem ? `${stem}.png` : null;
}

export function planTextureExport(textures) {
  if (!textures.length) throw new Error('No textures to export.');
  const used = new Set();
  return textures.map((texture) => {
    const fileName = textureFileName(texture.name);
    if (!fileName) throw new Error('Give every texture a name.');
    const key = fileName.toLocaleLowerCase();
    if (used.has(key)) throw new Error(`Duplicate export name: ${fileName}`);
    used.add(key);
    return { ...texture, fileName };
  });
}

export async function writeTexturePngs(directory, textures, onProgress = () => {}) {
  const planned = planTextureExport(textures);
  let completed = 0;
  for (const texture of planned) {
    const blob = await new Promise((resolve, reject) => {
      texture.canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error(`Could not encode ${texture.fileName}.`));
      }, 'image/png');
    });
    const handle = await directory.getFileHandle(texture.fileName, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }
    completed++;
    onProgress(completed, planned.length);
  }
  return completed;
}
