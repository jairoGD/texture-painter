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

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function createTextureZip(textures, onProgress = () => {}) {
  const planned = planTextureExport(textures);
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [index, texture] of planned.entries()) {
    const blob = await new Promise((resolve, reject) => {
      texture.canvas.toBlob((result) => result ? resolve(result) :
        reject(new Error(`Could not encode ${texture.fileName}.`)), 'image/png');
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const name = encoder.encode(texture.fileName);
    if (bytes.length > 0xffffffff || name.length > 0xffff || offset > 0xffffffff)
      throw new Error('Texture export is too large for a ZIP file.');
    const checksum = crc32(bytes);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, bytes.length, true);
    localView.setUint32(22, bytes.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, bytes.length, true);
    centralView.setUint32(24, bytes.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    localParts.push(local, bytes);
    centralParts.push(central);
    offset += local.length + bytes.length;
    onProgress(index + 1, planned.length);
  }
  const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
  if (planned.length > 0xffff || offset + centralSize > 0xffffffff)
    throw new Error('Texture export is too large for a ZIP file.');
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, planned.length, true);
  endView.setUint16(10, planned.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}
