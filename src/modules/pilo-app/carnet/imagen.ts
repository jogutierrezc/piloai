/* =============================================================================
   Mr. Pilo · carnet · «Guardar como imagen».

   Dibuja la cara de identidad del carnet en una imagen (con los colores del tema
   que esté puesto, leídos de la propia tarjeta) y la comparte o la descarga.
   El código QR NO va en la imagen: cambia cada 30 segundos y una captura vence
   en un minuto. La imagen sirve para mostrar el nombre y el perfil, no para
   pasar un lector. El código de estudiante y el RH van solo si la persona los
   dejó visibles en la tarjeta.
   ========================================================================== */

export interface CardImage {
  title: string;
  subtitle: string;
  name: string;
  role: string;
  detail: string;
  foot: string;
  state: string;
  photo: string | null;
}

const W = 1012;
const H = 638;

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, line: number, lines: number) {
  const words = text.split(/\s+/);
  let current = "";
  let row = 0;
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > max && current) {
      ctx.fillText(current, x, y + row * line);
      row++;
      current = word;
      if (row >= lines) return;
    } else current = test;
  }
  if (current) ctx.fillText(current, x, y + row * line);
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

/** Dibuja la tarjeta y devuelve un PNG; null si el navegador no puede. */
export async function drawCardImage(from: HTMLElement, card: CardImage): Promise<Blob | null> {
  const style = getComputedStyle(from);
  const v = (name: string) => style.getPropertyValue(name).trim();
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const font = style.fontFamily || "sans-serif";

  const gradient = ctx.createLinearGradient(0, 0, W, H);
  gradient.addColorStop(0, v("--s1") || "currentColor");
  gradient.addColorStop(1, v("--s3") || "currentColor");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 40);
  ctx.fill();

  const ink = v("--s-ink");
  const muted = v("--s-muted");
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = ink;
  ctx.font = `800 44px ${font}`;
  ctx.fillText(card.title, 56, 100);
  ctx.fillStyle = muted;
  ctx.font = `600 28px ${font}`;
  ctx.fillText(card.subtitle, 56 + 128, 100);

  const photoSize = 210;
  const top = 160;
  ctx.fillStyle = v("--s-chip") || muted;
  ctx.beginPath();
  ctx.roundRect(56, top, photoSize, photoSize, 28);
  ctx.fill();
  if (card.photo) {
    const img = await loadImage(card.photo);
    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(56, top, photoSize, photoSize, 28);
      ctx.clip();
      ctx.drawImage(img, 56, top, photoSize, photoSize);
      ctx.restore();
    }
  } else {
    ctx.fillStyle = ink;
    ctx.font = `800 96px ${font}`;
    ctx.textAlign = "center";
    ctx.fillText(card.name.trim().charAt(0).toUpperCase(), 56 + photoSize / 2, top + photoSize / 2 + 34);
    ctx.textAlign = "left";
  }

  const x = 56 + photoSize + 40;
  const max = W - x - 56;
  ctx.fillStyle = ink;
  ctx.font = `800 52px ${font}`;
  wrap(ctx, card.name, x, top + 56, max, 60, 2);
  ctx.fillStyle = muted;
  ctx.font = `700 32px ${font}`;
  ctx.fillText(card.role, x, top + 150, max);
  ctx.font = `600 30px ${font}`;
  wrap(ctx, card.detail, x, top + 196, max, 40, 2);

  ctx.fillStyle = muted;
  ctx.font = `700 30px ${font}`;
  ctx.fillText(card.foot, 56, H - 56, max);
  ctx.fillStyle = ink;
  ctx.font = `800 32px ${font}`;
  ctx.textAlign = "right";
  ctx.fillText(card.state, W - 56, H - 56);
  ctx.textAlign = "left";

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

/** Comparte la imagen (menú del teléfono) o la descarga. Devuelve cómo salió. */
export async function deliverImage(blob: Blob, name: string): Promise<"compartida" | "descargada" | "cancelada"> {
  const file = new File([blob], name, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "compartida";
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return "cancelada";
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "descargada";
}
