/** @type {import("@popperjs/core").Modifier<any, any>[]} */
export const OS_POPUP_POPPER_MODIFIERS = [
  { name: "offset", options: { offset: [0, 8] } },
  { name: "flip", options: { padding: 8 } },
  { name: "preventOverflow", options: { padding: 8 } },
];

/** @param {number} [gap] @param {number} [padding] */
export function osPopupPopperOptions(gap = 8, padding = 8) {
  return {
    modifiers: [
      { name: "offset", options: { offset: [0, gap] } },
      { name: "flip", options: { padding } },
      { name: "preventOverflow", options: { padding } },
    ],
  };
}

export const OS_POPUP_OVERLAY_CLASS = "os-t-popup";
export const OS_POPUP_INNER_CLASS = "os-t-popup__inner";
export const OS_POPUP_ANCHOR_CLASS = "os-t-popup__anchor";
