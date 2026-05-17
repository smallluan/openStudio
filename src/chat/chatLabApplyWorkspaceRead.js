import {
  csvToHtmlDocument,
  svgToHtmlDocument,
  wrapLooseHtmlFragmentForSrcDoc,
} from "./chatLabDocumentPreview.js";

/**
 * Apply IPC `readWorkspacePreviewFile` payload to the preview dock.
 * @param {*} result
 * @param {{
 *   openSrcDoc: (html: string, title: string, opts?: { sandbox?: string }) => void;
 *   openBlob: (blob: Blob, title: string) => void;
 *   openPlaceholder: (title: string, body: string) => void;
 * }} api
 * @param {(k: string, vars?: Record<string, string | number>) => string} t
 * @param {string} title
 */
export function applyWorkspacePreviewReadResult(result, api, t, title) {
  const { openSrcDoc, openBlob, openPlaceholder } = api;
  if (!result || !result.ok) {
    const rawDetail = String(result?.message ?? "unknown");
    const detail =
      rawDetail === "outside_openclaw_state" ? t("chatLab.previewErrOutsideOpenClawState") : rawDetail;
    openPlaceholder(title, t("chatLab.previewReadFailed", { detail }));
    return;
  }
  const ext = String(result.ext ?? "").toLowerCase();
  if (result.kind === "text" && typeof result.text === "string") {
    if (ext === ".csv") {
      openSrcDoc(csvToHtmlDocument(result.text), title);
      return;
    }
    if (ext === ".svg") {
      openSrcDoc(svgToHtmlDocument(result.text), title);
      return;
    }
    openSrcDoc(wrapLooseHtmlFragmentForSrcDoc(result.text), title);
    return;
  }
  if (result.kind === "bytes" && typeof result.base64 === "string") {
    const mime = typeof result.mime === "string" ? result.mime : "application/octet-stream";
    const bin = atob(result.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    if (ext === ".pdf") {
      openBlob(blob, title);
      return;
    }
    if (ext === ".xlsx" || ext === ".xls" || ext === ".pptx" || ext === ".ppt") {
      openPlaceholder(title, t("chatLab.previewOfficeLocalBinary"));
      return;
    }
    openBlob(blob, title);
    return;
  }
  openPlaceholder(title, t("chatLab.previewReadFailed", { detail: "invalid_payload" }));
}
