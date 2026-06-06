import { artifactPreviewKindFromPath } from "./chatLabArtifactPreviewKind.js";

/**
 * @typedef {{
 *   path: string;
 *   ext: string;
 *   kind: "text" | "bytes";
 *   mime: string;
 *   text?: string;
 *   blobUrl?: string;
 *   previewKind: ReturnType<typeof artifactPreviewKindFromPath>;
 * }} ArtifactFilePayload
 */

/**
 * @param {string} path
 * @param {*} result IPC read result
 * @returns {ArtifactFilePayload | { error: string }}
 */
export function artifactPayloadFromReadResult(path, result) {
  if (!result || !result.ok) {
    return { error: String(result?.message ?? "read_failed") };
  }
  const ext = String(result.ext ?? "").toLowerCase();
  const previewKind = artifactPreviewKindFromPath(path || result.filePath || ext);

  if (result.kind === "text" && typeof result.text === "string") {
    return {
      path: String(result.filePath ?? path),
      ext,
      kind: "text",
      mime: String(result.mime ?? "text/plain"),
      text: result.text,
      previewKind,
    };
  }

  if (result.kind === "bytes" && typeof result.base64 === "string") {
    const mime = String(result.mime ?? "application/octet-stream");
    const bin = atob(result.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    const blobUrl = URL.createObjectURL(blob);
    return {
      path: String(result.filePath ?? path),
      ext,
      kind: "bytes",
      mime,
      blobUrl,
      previewKind,
    };
  }

  return { error: "invalid_payload" };
}
