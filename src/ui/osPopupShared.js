/** @type {import("@popperjs/core").Modifier<any, any>[]} */
export const OS_POPUP_POPPER_MODIFIERS = [
  { name: "offset", options: { offset: [0, 8] } },
  { name: "flip", options: { padding: 8 } },
  { name: "preventOverflow", options: { padding: 8 } },
];

/** @param {HTMLElement | null | undefined} triggerNode */
export function osPopupAttach(triggerNode) {
  if (triggerNode instanceof Element) {
    const dialog = triggerNode.closest(".t-dialog");
    if (dialog instanceof HTMLElement) return dialog;
  }
  return document.body;
}

/** @param {number} [gap] @param {number} [padding] */
export function osPopupPopperOptions(gap = 8, padding = 8) {
  return {
    strategy: "fixed",
    modifiers: [
      { name: "offset", options: { offset: [0, gap] } },
      { name: "flip", options: { padding } },
      { name: "preventOverflow", options: { padding } },
    ],
  };
}

/**
 * Popup props for composer toolbar TSelect pickers (panelTopContent).
 * @param {number} zIndex
 * @param {string} innerClassName
 * @param {number} [gap]
 */
export function composerToolbarSelectPopupProps(zIndex, innerClassName, gap = 8) {
  return {
    attach: osPopupAttach,
    placement: "top-start",
    zIndex,
    destroyOnClose: false,
    overlayClassName: OS_POPUP_OVERLAY_CLASS,
    overlayInnerClassName: `${OS_POPUP_INNER_CLASS} ${innerClassName}`.trim(),
    overlayInnerStyle: { overflow: "visible", maxHeight: "none" },
    popperOptions: osPopupPopperOptions(gap, 8),
  };
}

export const OS_POPUP_OVERLAY_CLASS = "os-t-popup";
export const OS_POPUP_INNER_CLASS = "os-t-popup__inner";
export const OS_POPUP_ANCHOR_CLASS = "os-t-popup__anchor";
