import { openChatLabExternalUrl } from "./chatLabLinkOpenPreference.js";

/** @param {string} src @param {string | undefined} alt */
export function suggestFilename(src, alt) {
  try {
    const u = new URL(src, window.location.href);
    const base = u.pathname.split("/").pop() ?? "";
    if (base && /\.[a-z0-9]{2,5}$/i.test(base)) return decodeURIComponent(base);
  } catch {
    /* ignore */
  }
  const safe =
    String(alt ?? "image")
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
      .trim()
      .slice(0, 80) || "image";
  if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(safe)) return safe;
  return `${safe}.png`;
}

/** @param {string} src */
export async function resolveSaveUrl(src) {
  if (!src.startsWith("blob:")) return src;
  const res = await fetch(src);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? src));
    reader.onerror = () => reject(reader.error ?? new Error("read_failed"));
    reader.readAsDataURL(blob);
  });
}

/** @param {string} src @param {string | undefined} alt */
export async function saveImage(src, alt) {
  const saveUrl = await resolveSaveUrl(src);
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
  if (bridge && typeof bridge.saveImageFromUrl === "function") {
    const result = await bridge.saveImageFromUrl({
      url: saveUrl,
      suggestedName: suggestFilename(src, alt),
    });
    if (result?.ok || result?.canceled) return;
  }

  try {
    const res = await fetch(saveUrl);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = suggestFilename(src, alt);
    anchor.rel = "noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    return;
  } catch {
    /* fall through */
  }

  const anchor = document.createElement("a");
  anchor.href = saveUrl;
  anchor.download = suggestFilename(src, alt);
  anchor.target = "_blank";
  anchor.rel = "noreferrer noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** @param {string} src */
export async function copyImageToClipboard(src) {
  const saveUrl = await resolveSaveUrl(src);
  const res = await fetch(saveUrl);
  const blob = await res.blob();
  const type = blob.type && blob.type.startsWith("image/") ? blob.type : "image/png";
  const normalized =
    blob.type === type ? blob : new Blob([await blob.arrayBuffer()], { type });
  await navigator.clipboard.write([new ClipboardItem({ [type]: normalized })]);
}

/** @param {string} src */
export function openImageInNewTab(src) {
  const h = String(src ?? "").trim();
  if (!h) return;
  openChatLabExternalUrl(h);
}
