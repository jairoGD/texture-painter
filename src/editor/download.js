export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.position = 'fixed';
  link.style.left = '-9999px';
  link.setAttribute('aria-hidden', 'true');
  document.body.append(link);
  try {
    link.click();
  } catch (error) {
    link.remove();
    URL.revokeObjectURL(url);
    throw error;
  }
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
}
