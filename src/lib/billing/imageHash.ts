// dHash de 64 bits (16 hex) de uma imagem, calculado no telemóvel: imagens quase iguais (cortadas, recomprimidas)
// têm hashes a poucos bits de distância. Ajuda o servidor a apanhar o mesmo comprovativo usado duas vezes.
export async function dHash(file: Blob): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas'); c.width = 9; c.height = 8;
    const x = c.getContext('2d', { willReadFrequently: true }); if (!x) return null;
    x.drawImage(bmp, 0, 0, 9, 8); bmp.close?.();
    const d = x.getImageData(0, 0, 9, 8).data;
    const g = (px: number, py: number) => { const i = (py * 9 + px) * 4; return 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!; };
    let hex = '';
    for (let y = 0; y < 8; y++) {
      let byte = 0;
      for (let px = 0; px < 8; px++) byte = (byte << 1) | (g(px, y) > g(px + 1, y) ? 1 : 0);
      hex += byte.toString(16).padStart(2, '0');
    }
    return hex;
  } catch { return null; }
}
