/* =============================================================================
   Mr. Pilo · carnet · la foto (opcional).

   La foto se queda en ESTE teléfono: se reduce a un cuadrado pequeño y se guarda
   en el almacenamiento del navegador, junto al identificador de la cuenta.
   Nunca se sube al servidor, ni va al código QR, ni a Google Wallet. Si el
   navegador no deja guardar (ventana privada), la foto dura mientras la
   pantalla está abierta.
   ========================================================================== */

const SIZE = 256;
const key = (userId: string) => `pilo-carnet-foto:${userId}`;

export function readPhoto(userId: string): string | null {
  try {
    const value = window.localStorage.getItem(key(userId));
    return value && value.startsWith("data:image/jpeg;base64,") ? value : null;
  } catch {
    return null;
  }
}

export function writePhoto(userId: string, dataUrl: string | null): void {
  try {
    if (dataUrl) window.localStorage.setItem(key(userId), dataUrl);
    else window.localStorage.removeItem(key(userId));
  } catch {
    /* sin almacenamiento: la foto vive en la pantalla */
  }
}

/** Un archivo de imagen, recortado al centro y reducido a un cuadrado JPEG; null si no se pudo leer. */
export async function squarePhoto(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/") || file.size > 15 * 1024 * 1024) return null;
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("imagen"));
      img.src = url;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) return null;
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
