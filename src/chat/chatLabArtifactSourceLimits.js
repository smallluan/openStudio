/** Lines at or above this count use virtual scroll (no full-file syntax highlight). */
export const ARTIFACT_VIRTUAL_MIN_LINES = 320;

/** Character count fallback when line count is cheap to exceed. */
export const ARTIFACT_VIRTUAL_MIN_CHARS = 160_000;

/** Max lines loaded into the preview pane (rest truncated). */
export const ARTIFACT_PREVIEW_MAX_LINES = 12_000;

/**
 * @param {string} text
 * @returns {{ lineCount: number; charCount: number; isLarge: boolean }}
 */
export function analyzeArtifactSource(text) {
  const body = String(text ?? "");
  let lineCount = body.length ? 1 : 0;
  for (let i = 0; i < body.length; i += 1) {
    if (body.charCodeAt(i) === 10) lineCount += 1;
  }
  const charCount = body.length;
  return {
    lineCount,
    charCount,
    isLarge: lineCount >= ARTIFACT_VIRTUAL_MIN_LINES || charCount >= ARTIFACT_VIRTUAL_MIN_CHARS,
  };
}

/**
 * Split source into lines for preview, truncating very large buffers.
 * @param {string} text
 * @param {number} [maxLines]
 * @returns {{ lines: string[]; truncated: boolean; totalLines: number }}
 */
export function splitArtifactSourceLines(text, maxLines = ARTIFACT_PREVIEW_MAX_LINES) {
  const body = String(text ?? "");
  if (!body) return { lines: [], truncated: false, totalLines: 0 };

  let totalLines = 1;
  for (let i = 0; i < body.length; i += 1) {
    if (body.charCodeAt(i) === 10) totalLines += 1;
  }

  if (totalLines <= maxLines) {
    return { lines: body.split("\n"), truncated: false, totalLines };
  }

  /** @type {string[]} */
  const lines = [];
  let start = 0;
  for (let n = 0; n < maxLines; n += 1) {
    const idx = body.indexOf("\n", start);
    if (idx === -1) {
      lines.push(body.slice(start));
      break;
    }
    lines.push(body.slice(start, idx));
    start = idx + 1;
  }

  return { lines, truncated: true, totalLines };
}
