export const TEXTURE_RESOLUTIONS = [512, 1024, 2048, 4096];

export let textureResolution = 1024;

export function setTextureResolution(value) {
  const resolution = Number(value);
  if (!TEXTURE_RESOLUTIONS.includes(resolution))
    throw new Error('Unsupported texture resolution.');
  textureResolution = resolution;
}
