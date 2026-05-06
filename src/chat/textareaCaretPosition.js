/**
 * Caret coordinates in viewport for textarea `position` (UTF-16 offset).
 * Adapted from common textarea-caret-position patterns (MIT-style snippets).
 * @param {HTMLTextAreaElement} element
 * @param {number} position
 * @returns {{ left: number; top: number; height: number }}
 */
export function getTextareaCaretScreenPosition(element, position) {
  const copy = document.createElement("div");
  const style = window.getComputedStyle(element);

  /** @param {string} k */
  const num = (k) => parseFloat(style.getPropertyValue(k));

  [
    "boxSizing",
    "width",
    "height",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "fontStyle",
    "fontVariant",
    "fontWeight",
    "fontStretch",
    "fontSize",
    "lineHeight",
    "fontFamily",
    "textAlign",
    "textTransform",
    "letterSpacing",
    "wordSpacing",
    "tabSize",
    "MozTabSize",
    "whiteSpace",
    "wordBreak",
    "wordWrap",
    "overflowWrap",
    "overflowX",
    "overflowY",
  ].forEach((prop) => {
    const v = style.getPropertyValue(prop);
    if (v) copy.style.setProperty(prop === "MozTabSize" ? "-moz-tab-size" : prop, v);
  });

  copy.style.position = "absolute";
  copy.style.visibility = "hidden";
  copy.style.whiteSpace = "pre-wrap";
  copy.style.wordWrap = "break-word";
  copy.style.overflow = "hidden";

  const widthPx = element.clientWidth;
  if (widthPx > 0) copy.style.width = `${widthPx}px`;
  else copy.style.width = `${num("width")}px`;

  const text = element.value.slice(0, position);
  const marker = document.createElement("span");
  marker.textContent = element.value.slice(position, position + 1) || ".";
  copy.textContent = text;
  copy.appendChild(marker);

  document.body.appendChild(copy);

  const root = element.ownerDocument?.documentElement ?? document.documentElement;
  const scrollY = window.pageYOffset || root.scrollTop || 0;
  const scrollX = window.pageXOffset || root.scrollLeft || 0;
  const r = marker.getBoundingClientRect();
  const e = element.getBoundingClientRect();
  const lineHeight = num("lineHeight") || num("fontSize") * 1.25;

  document.body.removeChild(copy);

  return {
    left: r.left + scrollX,
    top: r.top + scrollY,
    height: r.height || lineHeight,
    viewportLeft: r.left,
    viewportTop: r.top,
    textareaLeft: e.left,
    textareaTop: e.top,
  };
}
