import { captureSidebarPreviewSnapshot, composeChatLabPreviewContextBlock } from "./chatLabPreviewSnapshot.js";

/** @typedef {{
 *   action: string;
 *   ref?: string;
 *   selector?: string;
 *   text?: string;
 *   mode?: string;
 *   intervalMs?: number;
 *   placeholder?: string;
 *   label?: string;
 *   url?: string;
 *   ms?: number;
 *   key?: string;
 *   amount?: number;
 *   title?: string;
 *   parentSelector?: string;
 *   scroll?: boolean;
 *   button?: number;
 *   buttons?: number;
 *   x?: number;
 *   y?: number;
 *   offsetX?: number;
 *   offsetY?: number;
 *   toSelector?: string;
 *   toX?: number;
 *   toY?: number;
 *   toOffsetX?: number;
 *   toOffsetY?: number;
 *   dragSteps?: number;
 *   files?: string[];
 *   domRead?: "none" | "metadata" | "target" | "inventory" | "full";
 *   selectors?: string[];
 * }} SidebarAutomationStep */

/** @typedef {import("./chatLabPreviewSnapshot.js").SidebarPreviewInteractiveElement} SidebarPreviewInteractiveElement */

export const SIDEBAR_AUTOMATION_STEP_INTERVAL_MS = 500;
/** Default is configurable in Settings; this is also the renderer safety ceiling. */
export const SIDEBAR_AUTOMATION_DEFAULT_MAX_STEPS_PER_TURN = 20;
export const SIDEBAR_AUTOMATION_MAX_STEPS_PER_TURN = 100;

const RETRYABLE_STEP_ERRORS = new Set(["element_not_found"]);
const STEP_RETRY_DELAYS_MS = [800, 1200, 1800];
const SIDEBAR_INTERPOLATION_RE = /\{\{\s*([\s\S]+?)\s*\}\}/g;

/**
 * @param {string} expr
 * @returns {string | null}
 */
function evalSidebarAutomationInterpolationExpr(expr) {
  const s = String(expr ?? "").trim();
  if (!s) return null;

  const numCall = /^Number\s*\(\s*(-?\d+(?:\.\d+)?)\s*\)$/i.exec(s);
  if (numCall) return String(Number(numCall[1]));

  if (/^-?\d+(?:\.\d+)?$/.test(s)) return String(Number(s));

  const strCall = /^String\s*\(\s*(['"])([\s\S]*?)\1\s*\)$/i.exec(s);
  if (strCall) return strCall[2];

  if (/^true$/i.test(s)) return "true";
  if (/^false$/i.test(s)) return "false";

  return null;
}

/**
 * @param {unknown} raw
 * @returns {string | undefined}
 */
function normalizeAutomationStepText(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "boolean") return String(raw);
  if (typeof raw !== "string") return undefined;

  const text = raw;
  const trimmed = text.trim();
  if (/^\{\{[\s\S]+\}\}$/.test(trimmed)) {
    const inner = trimmed.slice(2, -2);
    const whole = evalSidebarAutomationInterpolationExpr(inner);
    if (whole != null) return whole;
  }

  return text.replace(SIDEBAR_INTERPOLATION_RE, (match, expr) => {
    const resolved = evalSidebarAutomationInterpolationExpr(expr);
    return resolved != null ? resolved : match;
  });
}

/**
 * @param {unknown} raw
 * @param {{ maxSteps?: number }} [opts]
 * @returns {SidebarAutomationStep[]}
 */
export function normalizeAutomationSteps(raw, opts = {}) {
  const maxSteps = Math.max(
    1,
    Math.min(
      SIDEBAR_AUTOMATION_MAX_STEPS_PER_TURN,
      Number.isFinite(Number(opts.maxSteps))
        ? Math.floor(Number(opts.maxSteps))
        : SIDEBAR_AUTOMATION_DEFAULT_MAX_STEPS_PER_TURN,
    ),
  );
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  /** @type {SidebarAutomationStep[]} */
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = /** @type {Record<string, unknown>} */ (item);
    const action = typeof row.action === "string" ? row.action.trim().toLowerCase() : "";
    if (!action || action === "verify") continue;
    /** @type {SidebarAutomationStep} */
    const step = { action };
    if (typeof row.ref === "string" && row.ref.trim()) step.ref = row.ref.trim();
    if (typeof row.selector === "string" && row.selector.trim()) step.selector = row.selector.trim();
    const text = normalizeAutomationStepText(row.text);
    if (text !== undefined) step.text = text;
    if (typeof row.mode === "string" && row.mode.trim()) step.mode = row.mode.trim().toLowerCase();
    if (typeof row.intervalMs === "number" && Number.isFinite(row.intervalMs)) {
      step.intervalMs = Math.max(0, Math.min(300, Math.floor(row.intervalMs)));
    }
    if (typeof row.placeholder === "string" && row.placeholder.trim()) step.placeholder = row.placeholder.trim();
    if (typeof row.label === "string" && row.label.trim()) step.label = row.label.trim();
    // Models often misuse `target`: ref id (e12) or natural-language guess.
    if (typeof row.target === "string" && row.target.trim()) {
      const target = row.target.trim();
      if (!step.ref && /^e\d+$/i.test(target)) {
        step.ref = target.toLowerCase();
      } else if (!step.label) {
        step.label = target;
      }
    }
    // Same for label mistakenly set to a ref id.
    if (!step.ref && step.label && /^e\d+$/i.test(step.label)) {
      step.ref = step.label.toLowerCase();
      delete step.label;
    }
    if (typeof row.title === "string" && row.title.trim()) step.title = row.title.trim();
    if (typeof row.parentSelector === "string" && row.parentSelector.trim()) {
      step.parentSelector = row.parentSelector.trim();
    }
    if (typeof row.domRead === "string" && row.domRead.trim()) {
      step.domRead = row.domRead.trim().toLowerCase();
    }
    if (Array.isArray(row.selectors)) {
      step.selectors = row.selectors.map((selector) => String(selector ?? "").trim()).filter(Boolean).slice(0, 60);
    }
    if (typeof row.url === "string" && row.url.trim()) step.url = row.url.trim();
    if (typeof row.key === "string" && row.key.trim()) step.key = row.key.trim();
    if (typeof row.ms === "number" && Number.isFinite(row.ms)) step.ms = Math.max(0, Math.min(15000, row.ms));
    if (typeof row.amount === "number" && Number.isFinite(row.amount)) step.amount = row.amount;
    if (typeof row.scroll === "boolean") step.scroll = row.scroll;
    if (typeof row.toSelector === "string" && row.toSelector.trim()) {
      step.toSelector = row.toSelector.trim();
    } else if (typeof row.toRef === "string" && row.toRef.trim()) {
      // resolved later via resolveAutomationStepRefs
      step.toSelector = `__ref__:${row.toRef.trim()}`;
    }
    if (typeof row.button === "number" && Number.isFinite(row.button)) {
      step.button = Math.max(0, Math.min(2, Math.floor(row.button)));
    }
    if (typeof row.buttons === "number" && Number.isFinite(row.buttons)) {
      step.buttons = Math.max(0, Math.min(7, Math.floor(row.buttons)));
    }
    for (const coordKey of [
      "x",
      "y",
      "offsetX",
      "offsetY",
      "toX",
      "toY",
      "toOffsetX",
      "toOffsetY",
      "dragSteps",
    ]) {
      if (typeof row[coordKey] === "number" && Number.isFinite(row[coordKey])) {
        step[coordKey] = row[coordKey];
      }
    }
    if (Array.isArray(row.files)) {
      step.files = row.files.map((f) => String(f ?? "").trim()).filter(Boolean);
    } else if (typeof row.file === "string" && row.file.trim()) {
      step.files = [row.file.trim()];
    } else if (typeof row.path === "string" && row.path.trim()) {
      step.files = [row.path.trim()];
    }
    out.push(step);
    if (out.length >= maxSteps) break;
  }
  return out;
}

/**
 * Resolve inventory `ref` / `toRef` into concrete selectors from the latest snapshot.
 * @param {SidebarAutomationStep[]} steps
 * @param {SidebarPreviewInteractiveElement[] | undefined | null} elements
 * @returns {SidebarAutomationStep[]}
 */
export function resolveAutomationStepRefs(steps, elements) {
  const list = Array.isArray(steps) ? steps : [];
  const inventory = Array.isArray(elements) ? elements : [];
  /** @type {Map<string, SidebarPreviewInteractiveElement>} */
  const byRef = new Map();
  for (const el of inventory) {
    if (el?.ref) byRef.set(el.ref, el);
  }
  return list.map((step) => {
    /** @type {SidebarAutomationStep} */
    const next = { ...step };
    if (next.ref) {
      const hit = byRef.get(next.ref);
      if (hit?.selector) {
        if (!next.selector) next.selector = hit.selector;
        if (!next.label && hit.name) next.label = hit.name;
        if (!next.placeholder && hit.placeholder) next.placeholder = hit.placeholder;
      }
    }
    if (typeof next.toSelector === "string" && next.toSelector.startsWith("__ref__:")) {
      const toRef = next.toSelector.slice("__ref__:".length);
      const hit = byRef.get(toRef);
      if (hit?.selector) next.toSelector = hit.selector;
      else delete next.toSelector;
    }
    return next;
  });
}

/**
 * @param {SidebarAutomationStep} step
 */
function buildStepScript(step) {
  const payload = JSON.stringify(step);
  return `(async function(){
    var step = ${payload};
    var INPUT_SELECTOR = "input, textarea, [contenteditable], [contenteditable=true], [role=textbox]";
    var TARGET_SELECTOR = "button, a, input[type=submit], input[type=button], [role=button], " + INPUT_SELECTOR + ", label, span, li, div, [role=menuitem], [role=option], [role=treeitem]";
    function sleep(ms) {
      return new Promise(function(resolve) { setTimeout(resolve, ms); });
    }
    function vis(el) {
      if (!el || el.nodeType !== 1) return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      var st = window.getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
      var r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    }
    function walkShadowHosts(node, visit) {
      if (!node || node.nodeType !== 1) return;
      visit(node);
      var kids = node.children || [];
      for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        if (kid.shadowRoot) {
          visit(kid.shadowRoot);
          walkShadowHosts(kid.shadowRoot, visit);
        }
        walkShadowHosts(kid, visit);
      }
    }
    function collectRoots(depth) {
      if (depth > 3) return [document];
      var roots = [document];
      walkShadowHosts(document.documentElement, function(node) {
        if (node && node.nodeType === 11) roots.push(node);
      });
      var frames = document.querySelectorAll("iframe");
      for (var f = 0; f < frames.length; f++) {
        try {
          var fd = frames[f].contentDocument;
          if (!fd) continue;
          roots.push(fd);
          walkShadowHosts(fd.documentElement, function(node) {
            if (node && node.nodeType === 11) roots.push(node);
          });
          if (depth < 3) {
            var inner = fd.querySelectorAll("iframe");
            for (var g = 0; g < inner.length; g++) {
              try {
                var fd2 = inner[g].contentDocument;
                if (fd2) {
                  roots.push(fd2);
                  walkShadowHosts(fd2.documentElement, function(node) {
                    if (node && node.nodeType === 11) roots.push(node);
                  });
                }
              } catch (e2) {}
            }
          }
        } catch (e) {}
      }
      return roots;
    }
    function querySelectorDeep(selector) {
      var roots = collectRoots(0);
      for (var i = 0; i < roots.length; i++) {
        try {
          var hit = roots[i].querySelector(selector);
          if (hit && vis(hit)) return hit;
        } catch (e) {}
      }
      return null;
    }
    function querySelectorAllDeep(selector) {
      var roots = collectRoots(0);
      var out = [];
      var seen = [];
      for (var i = 0; i < roots.length; i++) {
        try {
          var nodes = roots[i].querySelectorAll(selector);
          for (var j = 0; j < nodes.length; j++) {
            if (seen.indexOf(nodes[j]) < 0) {
              seen.push(nodes[j]);
              out.push(nodes[j]);
            }
          }
        } catch (e) {}
      }
      return out;
    }
    function parseContainsSelector(selector) {
      var s = String(selector || "");
      var re = /:contains\\(\\s*(['"])([\\s\\S]*?)\\1\\s*\\)/;
      var m = re.exec(s);
      if (!m) return { base: s, needle: "" };
      return { base: s.replace(re, "").trim(), needle: m[2] };
    }
    function queryDeepWithContains(selector) {
      var parsed = parseContainsSelector(selector);
      if (!parsed.needle) return querySelectorDeep(parsed.base);
      /** @type {string[]} */
      var bases = [];
      if (parsed.base) bases.push(parsed.base);
      if (parsed.base && parsed.base.indexOf(" > ") >= 0) {
        bases.push(parsed.base.replace(/ > /g, " "));
      }
      if (!bases.length) bases.push("");
      for (var bi = 0; bi < bases.length; bi++) {
        var base = bases[bi];
        var nodes = base ? querySelectorAllDeep(base) : querySelectorAllDeep(TARGET_SELECTOR);
        for (var ci = 0; ci < nodes.length; ci++) {
          var cn = nodes[ci];
          if (!vis(cn)) continue;
          var ctext = (cn.innerText || cn.textContent || "").trim();
          if (ctext.indexOf(parsed.needle) >= 0) return cn;
        }
      }
      return null;
    }
    function queryWithinWithContains(root, selector) {
      var parsed = parseContainsSelector(selector);
      if (!parsed.needle) return queryWithin(root, parsed.base);
      /** @type {string[]} */
      var bases = [];
      if (parsed.base) bases.push(parsed.base);
      if (parsed.base && parsed.base.indexOf(" > ") >= 0) {
        bases.push(parsed.base.replace(/ > /g, " "));
      }
      if (!bases.length) bases.push("");
      for (var bi = 0; bi < bases.length; bi++) {
        var base = bases[bi];
        var cnodes = base ? queryAllWithin(root, base) : queryAllWithin(root, TARGET_SELECTOR);
        for (var cj = 0; cj < cnodes.length; cj++) {
          var cel = cnodes[cj];
          if (!vis(cel)) continue;
          var ctxt = (cel.innerText || cel.textContent || "").trim();
          if (ctxt.indexOf(parsed.needle) >= 0) return cel;
        }
      }
      return null;
    }
    function queryTargetBySelector(scope, selector) {
      var sel = String(selector || "");
      if (!sel) return null;
      var usesContains = /:contains\\(\\s*(['"])/.test(sel);
      var hit = null;
      if (scope) {
        hit = usesContains ? queryWithinWithContains(scope, sel) : queryWithin(scope, sel);
      }
      if (!hit) hit = usesContains ? queryDeepWithContains(sel) : querySelectorDeep(sel);
      if (!usesContains && hit) {
        var active = document.activeElement;
        if (active && active.nodeType === 1 && vis(active)) {
          try {
            var inScope =
              !scope ||
              scope === active ||
              (typeof scope.contains === "function" && scope.contains(active));
            if (inScope && typeof active.matches === "function" && active.matches(sel)) {
              return active;
            }
          } catch (e) {}
        }
      }
      return hit;
    }
    function isTextInput(el) {
      if (!el || el.nodeType !== 1) return false;
      var tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return true;
      if (el.isContentEditable) return true;
      return el.getAttribute("role") === "textbox";
    }
    function dispatchFocus(el, type) {
      try {
        el.dispatchEvent(new FocusEvent(type, { bubbles: true, cancelable: true }));
      } catch (e) {
        el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
      }
    }
    function scrollTargetIntoView(el) {
      if (step.scroll === false || !el || el.nodeType !== 1) return;
      try {
        if (typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ block: "center", inline: "center" });
        }
      } catch (e) {}
    }
    function focusInput(el, skipClick) {
      if (!el) return false;
      scrollTargetIntoView(el);
      if (!skipClick) {
        try {
          if (typeof el.click === "function") el.click();
        } catch (e2) {}
      }
      if (typeof el.focus === "function") {
        try {
          el.focus({ preventScroll: true });
        } catch (e3) {
          el.focus();
        }
      }
      dispatchFocus(el, "focusin");
      dispatchFocus(el, "focus");
      return true;
    }
    function blurInput(el) {
      if (!el) return false;
      dispatchFocus(el, "focusout");
      dispatchFocus(el, "blur");
      if (typeof el.blur === "function") el.blur();
      try {
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) {}
      return true;
    }
    function queryWithin(root, selector) {
      if (!root) return null;
      try {
        var hit = root.querySelector(selector);
        if (hit && vis(hit)) return hit;
      } catch (e) {}
      var found = null;
      walkShadowHosts(root, function(host) {
        if (found) return;
        try {
          var inner = host.shadowRoot.querySelector(selector);
          if (inner && vis(inner)) found = inner;
        } catch (e2) {}
      });
      return found;
    }
    function queryAllWithin(root, selector) {
      if (!root) return [];
      var out = [];
      var seen = [];
      try {
        var nodes = root.querySelectorAll(selector);
        for (var i = 0; i < nodes.length; i++) {
          if (seen.indexOf(nodes[i]) < 0) {
            seen.push(nodes[i]);
            out.push(nodes[i]);
          }
        }
      } catch (e) {}
      walkShadowHosts(root, function(host) {
        try {
          var inner = host.shadowRoot.querySelectorAll(selector);
          for (var j = 0; j < inner.length; j++) {
            if (seen.indexOf(inner[j]) < 0) {
              seen.push(inner[j]);
              out.push(inner[j]);
            }
          }
        } catch (e2) {}
      });
      return out;
    }
    function resolveTarget(s) {
      var scope = null;
      if (s.parentSelector) {
        scope = querySelectorDeep(String(s.parentSelector));
        if (!scope) return null;
      }
      if (s.selector) {
        var selHit = queryTargetBySelector(scope, s.selector);
        if (selHit) return selHit;
      }
      if (s.title) {
        var titleNeedle = String(s.title);
        var titleNodes = scope
          ? queryAllWithin(scope, INPUT_SELECTOR + ", [title]")
          : querySelectorAllDeep(INPUT_SELECTOR + ", [title]");
        for (var ti = 0; ti < titleNodes.length; ti++) {
          var tel = titleNodes[ti];
          if (!vis(tel)) continue;
          var tAttr = tel.getAttribute("title") || "";
          if (tAttr.indexOf(titleNeedle) >= 0) return tel;
        }
      }
      if (s.placeholder) {
        var p = String(s.placeholder);
        var inputs = scope ? queryAllWithin(scope, INPUT_SELECTOR) : querySelectorAllDeep(INPUT_SELECTOR);
        for (var i = 0; i < inputs.length; i++) {
          var el = inputs[i];
          if (!vis(el)) continue;
          var ph = el.getAttribute("placeholder") || el.getAttribute("aria-placeholder") || "";
          if (ph.indexOf(p) >= 0) return el;
        }
      }
      if (s.label) {
        var lbl = String(s.label);
        var nodes = scope
          ? [scope].concat(Array.prototype.slice.call(queryAllWithin(scope, TARGET_SELECTOR)))
          : querySelectorAllDeep(TARGET_SELECTOR);
        for (var j = 0; j < nodes.length; j++) {
          var n = nodes[j];
          if (!vis(n)) continue;
          if (n.tagName === "LABEL") {
            var linked = n.control;
            if (!linked) {
              var forId = n.getAttribute("for");
              if (forId) {
                var esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(forId) : forId;
                linked = scope ? queryWithin(scope, "#" + esc) : querySelectorDeep("#" + esc);
              }
              if (!linked) linked = queryWithin(n, INPUT_SELECTOR) || n.querySelector(INPUT_SELECTOR);
            }
            var labelText = (n.innerText || n.textContent || "").trim();
            if (labelText.indexOf(lbl) >= 0 && linked && vis(linked)) return linked;
          }
          var t = (n.innerText || n.textContent || n.value || n.getAttribute("aria-label") || "").trim();
          if (t.indexOf(lbl) >= 0) return n;
        }
      }
      return null;
    }
    function resolveClickableTarget(el) {
      if (!el || el.nodeType !== 1) return el;
      var interactive = { A: 1, BUTTON: 1, INPUT: 1, LABEL: 1 };
      var cur = el;
      for (var depth = 0; cur && depth < 8; depth++) {
        var tag = cur.tagName;
        if (interactive[tag]) return cur;
        var role = cur.getAttribute("role") || "";
        if (role === "button" || role === "menuitem" || role === "option" || role === "treeitem" || role === "link") {
          return cur;
        }
        if (tag === "LI") return cur;
        if (cur.getAttribute("onclick") || cur.onclick) return cur;
        try {
          var pst = window.getComputedStyle(cur);
          if (pst && pst.cursor === "pointer") return cur;
        } catch (e) {}
        cur = cur.parentElement;
      }
      return el;
    }
    function parseMouseButton(step) {
      var b = Number(step.button);
      if (!Number.isFinite(b) || b < 0 || b > 2) return 0;
      return Math.floor(b);
    }
    function buttonsMaskForButton(button, pressed) {
      if (!pressed) return 0;
      if (button === 2) return 2;
      if (button === 1) return 4;
      return 1;
    }
    function resolveClientPoint(el, step) {
      var absX = Number(step.x);
      var absY = Number(step.y);
      if (Number.isFinite(absX) && Number.isFinite(absY)) {
        return { x: absX, y: absY };
      }
      if (!el || el.nodeType !== 1) {
        return { x: Number.isFinite(absX) ? absX : 0, y: Number.isFinite(absY) ? absY : 0 };
      }
      var rect = el.getBoundingClientRect();
      var offX = Number(step.offsetX);
      var offY = Number(step.offsetY);
      if (!Number.isFinite(offX)) offX = 0;
      if (!Number.isFinite(offY)) offY = 0;
      return { x: rect.left + rect.width / 2 + offX, y: rect.top + rect.height / 2 + offY };
    }
    function elementAtPoint(x, y) {
      try {
        var hit = document.elementFromPoint(x, y);
        return hit && hit.nodeType === 1 ? hit : null;
      } catch (e) {
        return null;
      }
    }
    function ptrTypeForMouse(type) {
      var map = {
        mousedown: "pointerdown",
        mouseup: "pointerup",
        mousemove: "pointermove",
        mouseover: "pointerover",
        mouseenter: "pointerenter",
        mouseout: "pointerout",
        mouseleave: "pointerleave",
      };
      return map[type] || null;
    }
    function dispatchPointerAndMouse(target, type, point, step, extra) {
      extra = extra || {};
      if (!target || target.nodeType !== 1) target = document.body;
      var button = extra.button != null ? extra.button : parseMouseButton(step);
      var pressed = extra.pressed;
      if (pressed == null) {
        pressed = type === "mousedown";
        if (type === "mousemove") {
          pressed = Number(extra.buttons) > 0 || Number(step.buttons) > 0;
        }
      }
      var buttons =
        extra.buttons != null ? Number(extra.buttons) : buttonsMaskForButton(button, pressed);
      var detail = extra.detail != null ? extra.detail : type === "dblclick" ? 2 : 1;
      var bubbles = extra.bubbles != null ? extra.bubbles : true;
      var mouseInit = {
        bubbles: bubbles,
        cancelable: true,
        composed: true,
        view: window,
        detail: detail,
        clientX: point.x,
        clientY: point.y,
        screenX: point.x,
        screenY: point.y,
        button: button,
        buttons: buttons,
        relatedTarget: extra.relatedTarget || null,
      };
      var ptrType = ptrTypeForMouse(type);
      if (ptrType && typeof PointerEvent === "function") {
        try {
          target.dispatchEvent(
            new PointerEvent(ptrType, {
              bubbles: bubbles,
              cancelable: true,
              composed: true,
              view: window,
              detail: detail,
              clientX: point.x,
              clientY: point.y,
              screenX: point.x,
              screenY: point.y,
              button: button,
              buttons: buttons,
              pointerId: 1,
              pointerType: "mouse",
              isPrimary: true,
              pressure: pressed ? 0.5 : 0,
              width: 1,
              height: 1,
              relatedTarget: extra.relatedTarget || null,
            }),
          );
        } catch (ePtr) {}
      }
      try {
        target.dispatchEvent(new MouseEvent(type, mouseInit));
      } catch (eMouse) {
        target.dispatchEvent(new Event(type, { bubbles: bubbles, cancelable: true }));
      }
      return target;
    }
    function resolveMouseTarget(step, clickable) {
      var el = resolveTarget(step);
      if (!el) return null;
      if (clickable) el = resolveClickableTarget(el);
      scrollTargetIntoView(el);
      return el;
    }
    function dispatchSyntheticClick(el, step) {
      var pt = resolveClientPoint(el, step);
      var button = parseMouseButton(step);
      var target = elementAtPoint(pt.x, pt.y) || el;
      dispatchPointerAndMouse(target, "mousedown", pt, step, { button: button, pressed: true });
      dispatchPointerAndMouse(target, "mouseup", pt, step, { button: button, pressed: false, buttons: 0 });
      dispatchPointerAndMouse(target, "click", pt, step, { button: button, pressed: false, buttons: 0 });
    }
    function dispatchHover(el, step) {
      var pt = resolveClientPoint(el, step);
      var target = elementAtPoint(pt.x, pt.y) || el;
      dispatchPointerAndMouse(target, "mouseover", pt, step, { pressed: false, buttons: 0 });
      dispatchPointerAndMouse(target, "mouseenter", pt, step, { pressed: false, buttons: 0, bubbles: false });
    }
    function dispatchDblClick(el, step) {
      var pt = resolveClientPoint(el, step);
      var button = parseMouseButton(step);
      var target = elementAtPoint(pt.x, pt.y) || el;
      dispatchPointerAndMouse(target, "mousedown", pt, step, { button: button, pressed: true, detail: 1 });
      dispatchPointerAndMouse(target, "mouseup", pt, step, { button: button, pressed: false, buttons: 0, detail: 1 });
      dispatchPointerAndMouse(target, "click", pt, step, { button: button, pressed: false, buttons: 0, detail: 1 });
      dispatchPointerAndMouse(target, "mousedown", pt, step, { button: button, pressed: true, detail: 2 });
      dispatchPointerAndMouse(target, "mouseup", pt, step, { button: button, pressed: false, buttons: 0, detail: 2 });
      dispatchPointerAndMouse(target, "click", pt, step, { button: button, pressed: false, buttons: 0, detail: 2 });
      dispatchPointerAndMouse(target, "dblclick", pt, step, { button: button, pressed: false, buttons: 0, detail: 2 });
    }
    function dispatchRightClick(el, step) {
      var pt = resolveClientPoint(el, step);
      var patched = Object.assign({}, step, { button: 2 });
      var target = elementAtPoint(pt.x, pt.y) || el;
      dispatchPointerAndMouse(target, "mousedown", pt, patched, { button: 2, pressed: true });
      dispatchPointerAndMouse(target, "mouseup", pt, patched, { button: 2, pressed: false, buttons: 0 });
      dispatchPointerAndMouse(target, "contextmenu", pt, patched, { button: 2, pressed: false, buttons: 0 });
    }
    async function performDrag(step) {
      var srcEl = resolveTarget(step);
      if (!srcEl) return { ok: false, action: "drag", error: "element_not_found" };
      scrollTargetIntoView(srcEl);
      var fromPt = resolveClientPoint(srcEl, step);
      var toPt = null;
      if (step.toSelector) {
        var toScope = null;
        if (step.parentSelector) toScope = querySelectorDeep(String(step.parentSelector));
        var toEl = queryTargetBySelector(toScope, String(step.toSelector));
        if (!toEl) return { ok: false, action: "drag", error: "target_not_found" };
        scrollTargetIntoView(toEl);
        toPt = resolveClientPoint(toEl, {
          x: step.toX,
          y: step.toY,
          offsetX: step.toOffsetX,
          offsetY: step.toOffsetY,
        });
      } else if (Number.isFinite(Number(step.toX)) && Number.isFinite(Number(step.toY))) {
        toPt = { x: Number(step.toX), y: Number(step.toY) };
      } else {
        return { ok: false, action: "drag", error: "missing_drag_target" };
      }
      var dragSteps = Number(step.dragSteps);
      if (!Number.isFinite(dragSteps) || dragSteps < 1) dragSteps = 12;
      var button = parseMouseButton(step);
      var btnMask = buttonsMaskForButton(button, true);
      var srcTarget = elementAtPoint(fromPt.x, fromPt.y) || srcEl;
      dispatchPointerAndMouse(srcTarget, "mousedown", fromPt, step, { button: button, pressed: true });
      for (var di = 1; di <= dragSteps; di++) {
        var t = di / dragSteps;
        var mx = fromPt.x + (toPt.x - fromPt.x) * t;
        var my = fromPt.y + (toPt.y - fromPt.y) * t;
        var moveTarget = elementAtPoint(mx, my) || document.body;
        dispatchPointerAndMouse(moveTarget, "mousemove", { x: mx, y: my }, step, {
          button: button,
          pressed: true,
          buttons: btnMask,
        });
        if (di < dragSteps) await sleep(16);
      }
      var endTarget = elementAtPoint(toPt.x, toPt.y) || document.body;
      dispatchPointerAndMouse(endTarget, "mouseup", toPt, step, { button: button, pressed: false, buttons: 0 });
      return { ok: true, action: "drag", from: fromPt, to: toPt, steps: dragSteps };
    }
    function nativeInputProto(el) {
      if (!el || el.nodeType !== 1) return null;
      if (el.tagName === "TEXTAREA") return window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;
      if (el.tagName === "INPUT") return window.HTMLInputElement && window.HTMLInputElement.prototype;
      return null;
    }
    function readNativeValue(el) {
      var proto = nativeInputProto(el);
      if (!proto) return el.value != null ? String(el.value) : "";
      var desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc && desc.get) return String(desc.get.call(el));
      return String(el.value ?? "");
    }
    function writeNativeValue(el, value) {
      var str = String(value ?? "");
      var proto = nativeInputProto(el);
      if (proto) {
        var desc = Object.getOwnPropertyDescriptor(proto, "value");
        if (desc && desc.set) {
          desc.set.call(el, str);
          return true;
        }
      }
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        el.value = str;
        return true;
      }
      if (el.isContentEditable || el.getAttribute("role") === "textbox") {
        el.textContent = str;
        return true;
      }
      return false;
    }
    function resetReactInputTracker(el) {
      try {
        var tracker = el._valueTracker;
        if (tracker && typeof tracker.setValue === "function") {
          tracker.setValue(String(el.value != null ? el.value : ""));
        }
      } catch (e) {}
    }
    function setTextValue(el, value) {
      return writeNativeValue(el, value);
    }
    function setValue(el, value) {
      if (!isTextInput(el)) return false;
      var alreadyFocused = document.activeElement === el;
      focusInput(el, alreadyFocused);
      var str = String(value ?? "");
      resetReactInputTracker(el);
      writeNativeValue(el, "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      resetReactInputTracker(el);
      if (!setTextValue(el, str)) return false;
      try {
        el.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            inputType: "insertFromPaste",
            data: str,
          }),
        );
      } catch (e1) {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    async function typeChars(el, value, intervalMs) {
      if (!isTextInput(el)) return false;
      var delay = Number(intervalMs);
      if (!Number.isFinite(delay) || delay < 0) delay = 24;
      var str = String(value ?? "");
      focusInput(el, true);
      writeNativeValue(el, "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      for (var i = 0; i < str.length; i++) {
        var ch = str.charAt(i);
        el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
          writeNativeValue(el, readNativeValue(el) + ch);
        } else {
          el.textContent = String(el.textContent || "") + ch;
        }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
        if (delay > 0) await sleep(delay);
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    try {
      var action = String(step.action || "").toLowerCase();
      if (action === "query" || action === "inspect") {
        var querySelector = String(step.selector || "").trim();
        if (!querySelector) {
          return { ok: false, action: "query", error: "missing_selector" };
        }
        var queryNodes = querySelectorAllDeep(querySelector);
        var queryMatches = [];
        for (var qi = 0; qi < queryNodes.length && queryMatches.length < 12; qi++) {
          var queryNode = queryNodes[qi];
          queryMatches.push({
            tag: String(queryNode.tagName || "").toLowerCase(),
            role: String(queryNode.getAttribute("role") || queryNode.tagName || "").toLowerCase(),
            name: String(
              queryNode.getAttribute("aria-label") ||
                queryNode.getAttribute("placeholder") ||
                queryNode.innerText ||
                queryNode.textContent ||
                "",
            )
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 120),
            visible: vis(queryNode),
          });
        }
        return {
          ok: true,
          action: "query",
          selector: querySelector,
          count: queryNodes.length,
          visibleCount: queryNodes.filter(function(node) { return vis(node); }).length,
          matches: queryMatches,
        };
      }
      if (action === "wait") {
        return { ok: true, action: "wait", ms: Number(step.ms) || 0 };
      }
      if (action === "scroll") {
        var amt = Number(step.amount);
        if (!Number.isFinite(amt)) amt = 480;
        window.scrollBy(0, amt);
        return { ok: true, action: "scroll", amount: amt };
      }
      if (action === "press") {
        var key = String(step.key || "Enter");
        var keyNorm = key.toLowerCase();
        var pressEl = resolveTarget(step);
        var target = pressEl || document.activeElement || document.body;
        if (pressEl) focusInput(pressEl, true);
        else if (target && target.nodeType === 1) scrollTargetIntoView(target);
        var code = key;
        var keyCode = 0;
        if (keyNorm === "enter") {
          code = "Enter";
          keyCode = 13;
        } else if (keyNorm === "escape" || keyNorm === "esc") {
          code = "Escape";
          keyCode = 27;
        } else if (keyNorm === "tab") {
          code = "Tab";
          keyCode = 9;
        } else if (key.length === 1) {
          code = "Key" + key.toUpperCase();
          keyCode = key.toUpperCase().charCodeAt(0);
        }
        function kbEvent(type) {
          return new KeyboardEvent(type, {
            key: keyNorm === "enter" ? "Enter" : key,
            code: code,
            keyCode: keyCode,
            which: keyCode,
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
          });
        }
        target.dispatchEvent(kbEvent("keydown"));
        if (keyCode === 13) {
          try {
            target.dispatchEvent(
              new KeyboardEvent("keypress", {
                key: "Enter",
                code: "Enter",
                keyCode: 13,
                which: 13,
                charCode: 13,
                bubbles: true,
                cancelable: true,
                composed: true,
                view: window,
              }),
            );
          } catch (ePress) {}
        }
        target.dispatchEvent(kbEvent("keyup"));
        if (keyNorm === "enter" && target && target !== document.body) {
          var form = null;
          try {
            form = typeof target.closest === "function" ? target.closest("form") : null;
          } catch (eForm) {}
          if (form) {
            try {
              if (typeof form.requestSubmit === "function") form.requestSubmit();
              else {
                var submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
                if (submitBtn && typeof submitBtn.click === "function") submitBtn.click();
              }
            } catch (eSubmit) {}
          }
          try {
            target.dispatchEvent(new Event("search", { bubbles: true, cancelable: true }));
          } catch (eSearch) {}
        }
        return { ok: true, action: "press", key: key };
      }
      if (action === "focus") {
        var focusEl = resolveTarget(step);
        if (!focusEl) {
          return { ok: false, action: "focus", error: "element_not_found" };
        }
        focusInput(focusEl);
        return { ok: true, action: "focus" };
      }
      if (action === "blur") {
        var blurEl = resolveTarget(step);
        if (!blurEl) blurEl = document.activeElement;
        if (!blurEl || blurEl === document.body || blurEl === document.documentElement) {
          return { ok: false, action: "blur", error: "element_not_found" };
        }
        scrollTargetIntoView(blurEl);
        blurInput(blurEl);
        return { ok: true, action: "blur" };
      }
      if (action === "click") {
        var clickEl = resolveTarget(step);
        if (!clickEl) return { ok: false, action: "click", error: "element_not_found" };
        clickEl = resolveClickableTarget(clickEl);
        scrollTargetIntoView(clickEl);
        var clickMode = String(step.mode || "").toLowerCase();
        if (clickMode === "synthetic" || clickMode === "chain") {
          dispatchSyntheticClick(clickEl, step);
        } else {
          clickEl.click();
        }
        return {
          ok: true,
          action: "click",
          mode: clickMode === "synthetic" || clickMode === "chain" ? "synthetic" : "native",
          target: clickEl.tagName,
          text: String(clickEl.innerText || clickEl.textContent || "").trim().slice(0, 80),
        };
      }
      if (action === "measure-click") {
        var measuredEl = resolveTarget(step);
        if (!measuredEl) return { ok: false, action: "measure-click", error: "element_not_found" };
        measuredEl = resolveClickableTarget(measuredEl);
        scrollTargetIntoView(measuredEl);
        var measuredRect = measuredEl.getBoundingClientRect();
        var measuredPoint = resolveClientPoint(measuredEl, step);
        var measuredHit = elementAtPoint(measuredPoint.x, measuredPoint.y) || measuredEl;
        return {
          ok: true,
          action: "measure-click",
          selector: step.selector || null,
          target: measuredEl.tagName,
          hitTarget: measuredHit.tagName,
          x: measuredPoint.x,
          y: measuredPoint.y,
          rect: {
            left: measuredRect.left,
            top: measuredRect.top,
            width: measuredRect.width,
            height: measuredRect.height,
          },
        };
      }
      if (action === "mousedown" || action === "pointerdown") {
        var downEl = resolveMouseTarget(step, true);
        if (!downEl) return { ok: false, action: action, error: "element_not_found" };
        var downPt = resolveClientPoint(downEl, step);
        var downTarget = elementAtPoint(downPt.x, downPt.y) || downEl;
        dispatchPointerAndMouse(downTarget, "mousedown", downPt, step, { pressed: true });
        return { ok: true, action: action, x: downPt.x, y: downPt.y, button: parseMouseButton(step) };
      }
      if (action === "mouseup" || action === "pointerup") {
        var upEl = resolveMouseTarget(step, false);
        if (!upEl) upEl = document.body;
        var upPt = resolveClientPoint(upEl, step);
        var upTarget = elementAtPoint(upPt.x, upPt.y) || upEl;
        dispatchPointerAndMouse(upTarget, "mouseup", upPt, step, { pressed: false, buttons: 0 });
        return { ok: true, action: action, x: upPt.x, y: upPt.y, button: parseMouseButton(step) };
      }
      if (action === "mousemove" || action === "pointermove") {
        var moveEl = null;
        if (step.selector || step.label || step.placeholder || step.title || step.parentSelector) {
          moveEl = resolveTarget(step);
          if (!moveEl) return { ok: false, action: action, error: "element_not_found" };
          scrollTargetIntoView(moveEl);
        }
        var movePt = resolveClientPoint(moveEl || document.body, step);
        var moveButtons = Number(step.buttons);
        if (!Number.isFinite(moveButtons)) moveButtons = buttonsMaskForButton(parseMouseButton(step), true);
        var moveTarget = elementAtPoint(movePt.x, movePt.y) || moveEl || document.body;
        dispatchPointerAndMouse(moveTarget, "mousemove", movePt, step, {
          buttons: moveButtons,
          pressed: moveButtons > 0,
        });
        return { ok: true, action: action, x: movePt.x, y: movePt.y, buttons: moveButtons };
      }
      if (action === "hover") {
        var hoverEl = resolveMouseTarget(step, true);
        if (!hoverEl) return { ok: false, action: action, error: "element_not_found" };
        dispatchHover(hoverEl, step);
        return { ok: true, action: "hover" };
      }
      if (action === "dblclick") {
        var dblEl = resolveMouseTarget(step, true);
        if (!dblEl) return { ok: false, action: action, error: "element_not_found" };
        dispatchDblClick(dblEl, step);
        return { ok: true, action: "dblclick" };
      }
      if (action === "rightclick" || action === "contextmenu") {
        var rcEl = resolveMouseTarget(step, true);
        if (!rcEl) return { ok: false, action: action, error: "element_not_found" };
        dispatchRightClick(rcEl, step);
        return { ok: true, action: action };
      }
      if (action === "drag") {
        return await performDrag(step);
      }
      if (action === "type" || action === "type_chars") {
        var typeEl = resolveTarget(step);
        if (!typeEl) return { ok: false, action: action, error: "element_not_found" };
        if (step.selector) {
          var activeType = document.activeElement;
          if (activeType && activeType.nodeType === 1 && vis(activeType)) {
            try {
              if (typeof activeType.matches === "function" && activeType.matches(String(step.selector))) {
                typeEl = activeType;
              }
            } catch (eType) {}
          }
        }
        var charMode = action === "type_chars" || String(step.mode || "").toLowerCase() === "char";
        if (charMode) {
          if (!(await typeChars(typeEl, String(step.text ?? ""), step.intervalMs))) {
            return { ok: false, action: action, error: "not_input" };
          }
          await sleep(150);
          return { ok: true, action: "type_chars", value: readNativeValue(typeEl) };
        }
        if (!setValue(typeEl, String(step.text ?? ""))) return { ok: false, action: action, error: "not_input" };
        await sleep(150);
        return { ok: true, action: "type", value: readNativeValue(typeEl) };
      }
      return { ok: false, action: action, error: "unknown_action" };
    } catch (e) {
      return { ok: false, action: String(step.action || ""), error: String(e && e.message ? e.message : e) };
    }
  })()`;
}

/**
 * @param {SidebarAutomationStep} step
 */
function buildFindFileInputScript(step) {
  const payload = JSON.stringify(step);
  return `(function(){
    var step = ${payload};
    var INPUT_SELECTOR = "input[type=file], input[type='file']";
    function vis(el) {
      if (!el || el.nodeType !== 1) return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      var st = window.getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
      return true;
    }
    function cssEscape(value) {
      var s = String(value || "");
      if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(s);
      return s.replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
    }
    function uniqueSelector(sel) {
      try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; }
    }
    function buildSelector(el) {
      var tag = String(el.tagName || "").toLowerCase();
      var id = String(el.getAttribute("id") || "").trim();
      if (id && !/\\s/.test(id)) {
        var byId = "#" + cssEscape(id);
        if (uniqueSelector(byId)) return byId;
      }
      var name = String(el.getAttribute("name") || "").trim();
      if (name) {
        var byName = tag + "[name='" + name.replace(/'/g, "\\\\'") + "']";
        if (uniqueSelector(byName)) return byName;
      }
      var nodes = document.querySelectorAll(tag + "[type=file]");
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i] === el) return tag + "[type=file]:nth-of-type(" + (i + 1) + ")";
      }
      return tag + "[type=file]";
    }
    function walkShadow(node, visit) {
      if (!node || node.nodeType !== 1) return;
      visit(node);
      if (node.shadowRoot) {
        visit(node.shadowRoot);
        walkShadow(node.shadowRoot, visit);
      }
      var kids = node.children || [];
      for (var i = 0; i < kids.length; i++) walkShadow(kids[i], visit);
    }
    function queryAllFileInputs(root) {
      var out = [];
      var seen = [];
      function scan(doc) {
        if (!doc || !doc.querySelectorAll) return;
        var nodes = doc.querySelectorAll(INPUT_SELECTOR);
        for (var i = 0; i < nodes.length; i++) {
          if (seen.indexOf(nodes[i]) < 0) {
            seen.push(nodes[i]);
            out.push(nodes[i]);
          }
        }
      }
      scan(root || document);
      walkShadow(document.documentElement, function(node) {
        if (node && node.nodeType === 11) scan(node);
      });
      return out;
    }
    function resolveTarget(s) {
      if (s.selector) {
        try {
          var hit = document.querySelector(String(s.selector));
          if (hit) return hit;
        } catch (e) {}
      }
      if (s.label) {
        var lbl = String(s.label);
        var nodes = document.querySelectorAll("button, a, label, span, div, input");
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          var t = String(n.innerText || n.textContent || n.value || "").trim();
          if (t.indexOf(lbl) >= 0) return n;
        }
      }
      return null;
    }
    function pickFileInput(anchor) {
      if (anchor && anchor.tagName === "INPUT" && String(anchor.type).toLowerCase() === "file") {
        return anchor;
      }
      var list = queryAllFileInputs(document);
      if (!list.length) return null;
      if (anchor) {
        var parent = anchor;
        for (var depth = 0; parent && depth < 8; depth++) {
          for (var i = 0; i < list.length; i++) {
            if (parent.contains && parent.contains(list[i])) return list[i];
          }
          parent = parent.parentElement;
        }
      }
      for (var j = 0; j < list.length; j++) {
        if (vis(list[j])) return list[j];
      }
      return list[0];
    }
    try {
      var anchor = resolveTarget(step);
      var input = pickFileInput(anchor);
      if (!input) return { ok: false, error: "file_input_not_found" };
      return { ok: true, selector: buildSelector(input), inputType: "file" };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  })()`;
}

/**
 * @param {import("electron").WebviewTag} wv
 * @param {SidebarAutomationStep} step
 */
async function runSetFilesOnWebview(wv, step) {
  const files = Array.isArray(step.files) ? step.files.filter(Boolean) : [];
  if (!files.length) {
    return { ok: false, action: "set_files", error: "missing_files" };
  }
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
  if (typeof bridge?.setGuestFileInputFiles !== "function") {
    return { ok: false, action: "set_files", error: "electron_only" };
  }
  focusWebviewHost(wv);
  const found = await wv.executeJavaScript(buildFindFileInputScript(step), false);
  if (!found || found.ok === false || !found.selector) {
    return {
      ok: false,
      action: "set_files",
      error: String(found?.error || "file_input_not_found"),
      hint: "Do not click the native upload button. Use set_files with absolute file paths on the hidden input[type=file] (ref/selector/label of upload control).",
    };
  }
  const webContentsId = typeof wv.getWebContentsId === "function" ? wv.getWebContentsId() : 0;
  const result = await bridge.setGuestFileInputFiles({
    webContentsId,
    selector: String(found.selector),
    files,
  });
  return result && typeof result === "object"
    ? { ...result, action: "set_files" }
    : { ok: false, action: "set_files", error: "bad_result" };
}

const WEBVIEW_INTERACTION_ACTIONS = new Set([
  "click",
  "measure-click",
  "focus",
  "blur",
  "type",
  "type_chars",
  "press",
  "mousedown",
  "mouseup",
  "pointerdown",
  "pointerup",
  "mousemove",
  "pointermove",
  "hover",
  "dblclick",
  "rightclick",
  "contextmenu",
  "drag",
]);

/**
 * @param {import("electron").WebviewTag} wv
 */
function focusWebviewHost(wv) {
  try {
    wv.focus();
  } catch {
    /* ignore */
  }
}

/**
 * @param {import("electron").WebviewTag} wv
 * @param {SidebarAutomationStep} step
 */
async function runStepOnWebview(wv, step) {
  const action = String(step.action || "").toLowerCase();
  if (action === "set_files" || action === "upload" || action === "attach") {
    return runSetFilesOnWebview(wv, { ...step, action: "set_files" });
  }
  if (step.action === "wait") {
    await new Promise((r) => window.setTimeout(r, step.ms ?? 500));
    return { ok: true, action: "wait", ms: step.ms ?? 500 };
  }
  if (step.action === "navigate") {
    const url = String(step.url ?? "").trim();
    if (!url) return { ok: false, action: "navigate", error: "missing_url" };
    wv.loadURL(url);
    return { ok: true, action: "navigate", url };
  }
  if (step.action === "reload" || step.action === "refresh") {
    try {
      wv.reload();
    } catch (e) {
      return {
        ok: false,
        action: "reload",
        error: "reload_failed",
        message: e instanceof Error ? e.message : String(e),
      };
    }
    const waitMs = Math.max(0, Math.min(15_000, Number(step.ms) || 800));
    if (waitMs > 0) {
      await new Promise((r) => window.setTimeout(r, waitMs));
    }
    let url = "";
    try {
      url = String(wv.getURL?.() ?? "");
    } catch {
      /* ignore */
    }
    return { ok: true, action: "reload", waitMs, url };
  }
  if (action === "measure-click") {
    focusWebviewHost(wv);
    const measured = await wv.executeJavaScript(buildStepScript(step), false);
    if (!measured || measured.ok === false) {
      return measured && typeof measured === "object"
        ? measured
        : { ok: false, action: "measure-click", error: "measurement_failed" };
    }
    const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
    if (typeof bridge?.guestMouseClick !== "function") {
      return { ...measured, ok: false, error: "electron_input_unavailable" };
    }
    const webContentsId = typeof wv.getWebContentsId === "function" ? wv.getWebContentsId() : 0;
    const inputResult = await bridge.guestMouseClick({
      webContentsId,
      x: measured.x,
      y: measured.y,
      button: step.button === 2 ? "right" : step.button === 1 ? "middle" : "left",
      clickCount: 1,
    });
    return {
      ...measured,
      ...inputResult,
      action: "measure-click",
      measured: true,
    };
  }
  if (WEBVIEW_INTERACTION_ACTIONS.has(step.action)) {
    focusWebviewHost(wv);
  }
  const raw = await wv.executeJavaScript(buildStepScript(step), false);
  return raw && typeof raw === "object" ? raw : { ok: false, action: step.action, error: "bad_result" };
}

/**
 * @param {import("electron").WebviewTag} wv
 * @param {SidebarAutomationStep} step
 */
async function runStepOnWebviewWithRetry(wv, step) {
  const retryable = !["wait", "snapshot", "navigate", "reload", "refresh", "scroll", "set_files", "upload", "attach"].includes(
    step.action,
  );
  const maxAttempts = retryable ? 1 + STEP_RETRY_DELAYS_MS.length : 1;
  /** @type {Record<string, unknown>} */
  let last = { ok: false, action: step.action, error: "unknown" };
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await runStepOnWebview(wv, step);
    if (last.ok !== false || !RETRYABLE_STEP_ERRORS.has(String(last.error)) || attempt === maxAttempts - 1) {
      if (attempt > 0) last.retries = attempt;
      return last;
    }
    const delay = STEP_RETRY_DELAYS_MS[attempt] ?? 1800;
    await new Promise((r) => window.setTimeout(r, delay));
  }
  return last;
}

/**
 * @param {{
 *   steps: SidebarAutomationStep[];
 *   session: { kind?: string } | null;
 *   webviewRef?: import("react").RefObject<HTMLElement | null>;
 *   iframeRef?: import("react").RefObject<HTMLIFrameElement | null>;
 *   previewTabs?: Array<{ id: string; src: string; title: string }>;
 *   activePreviewTabId?: string;
 *   artifactsPanel?: unknown;
 *   navigatePreviewTo?: (url: string, title?: string) => void;
 *   t?: (key: string, vars?: Record<string, string | number>) => string;
 *   onStepComplete?: (payload: {
 *     step: SidebarAutomationStep;
 *     row: Record<string, unknown>;
 *     index: number;
 *     results: Array<Record<string, unknown>>;
 *   }) => void | Promise<void>;
 *   stopOnFailure?: boolean;
 *   forceSidebar?: boolean;
 *   elements?: SidebarPreviewInteractiveElement[];
 *   domRead?: "auto" | "none" | "metadata" | "target" | "inventory" | "full";
 *   maxSteps?: number;
 * }} input
 */
export async function runSidebarPreviewAutomation(input) {
  const steps = resolveAutomationStepRefs(
    normalizeAutomationSteps(input.steps, { maxSteps: input.maxSteps }),
    /** @type {SidebarPreviewInteractiveElement[] | undefined} */ (input.elements),
  );
  if (!steps.length) return { ok: false, error: "no_steps", steps: [], domRead: input.domRead ?? "full" };
  const stopOnFailure = input.stopOnFailure !== false;

  /** @type {Array<Record<string, unknown>>} */
  const results = [];
  const webviewNode = input.webviewRef?.current ?? null;
  const isWv =
    webviewNode &&
    typeof /** @type {import("electron").WebviewTag} */ (webviewNode).executeJavaScript === "function";

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
    const step = steps[stepIndex];
    if (step.action === "navigate" && input.navigatePreviewTo && step.url) {
      input.navigatePreviewTo(step.url, step.text || step.url);
      results.push({ ok: true, action: "navigate", url: step.url });
      await new Promise((r) => window.setTimeout(r, 800));
      if (input.onStepComplete) {
        await input.onStepComplete({
          step,
          row: results[results.length - 1],
          index: stepIndex,
          results: [...results],
        });
      }
      continue;
    }
    if (step.action === "snapshot") {
      const snap = await captureSidebarPreviewSnapshot({
        session: input.session,
        webviewRef: input.webviewRef,
        iframeRef: input.iframeRef,
        previewTabs: input.previewTabs,
        activePreviewTabId: input.activePreviewTabId,
        artifactsPanel: input.artifactsPanel,
        forceSidebar: input.forceSidebar,
        domRead: step.domRead ?? input.domRead,
        selectors: step.selectors ?? (step.selector ? [step.selector] : []),
      });
      const block = input.t ? composeChatLabPreviewContextBlock(input.t, snap) : "";
      results.push({
        ok: Boolean(snap?.ok),
        action: "snapshot",
        url: snap?.url ?? "",
        title: snap?.title ?? "",
        text: snap?.text ?? "",
        elements: Array.isArray(snap?.elements) ? snap.elements : [],
        domRead: snap?.domRead ?? "full",
        excerpt: block,
      });
      if (input.onStepComplete) {
        await input.onStepComplete({
          step,
          row: results[results.length - 1],
          index: stepIndex,
          results: [...results],
        });
      }
      continue;
    }
    if (!isWv) {
      results.push({ ok: false, action: step.action, error: "webview_unavailable" });
      if (input.onStepComplete) {
        await input.onStepComplete({
          step,
          row: results[results.length - 1],
          index: stepIndex,
          results: [...results],
        });
      }
      if (stopOnFailure) {
        return {
          ok: false,
          error: "webview_unavailable",
          steps: results,
          domRead: input.domRead ?? "full",
          stoppedAt: stepIndex,
          stopReason: "webview_unavailable",
        };
      }
      continue;
    }
    const wv = /** @type {import("electron").WebviewTag} */ (webviewNode);
    let row = await runStepOnWebviewWithRetry(wv, step);
    results.push(row);
    if (input.onStepComplete) {
      await input.onStepComplete({ step, row, index: stepIndex, results: [...results] });
    }
    if (stopOnFailure && row.ok === false) {
      return {
        ok: false,
        steps: results,
        domRead: input.domRead ?? "full",
        stoppedAt: stepIndex,
        stopReason: String(row.error || "step_failed"),
      };
    }
    if (
      step.action === "click" ||
      step.action === "measure-click" ||
      step.action === "focus" ||
      step.action === "type" ||
      step.action === "type_chars" ||
      step.action === "blur" ||
      step.action === "press" ||
      step.action === "navigate" ||
      step.action === "reload" ||
      step.action === "refresh" ||
      step.action === "wait" ||
      step.action === "scroll" ||
      step.action === "mousedown" ||
      step.action === "mouseup" ||
      step.action === "pointerdown" ||
      step.action === "pointerup" ||
      step.action === "mousemove" ||
      step.action === "pointermove" ||
      step.action === "hover" ||
      step.action === "dblclick" ||
      step.action === "rightclick" ||
      step.action === "contextmenu" ||
      step.action === "drag" ||
      step.action === "set_files" ||
      step.action === "upload" ||
      step.action === "attach"
    ) {
      await new Promise((r) => window.setTimeout(r, SIDEBAR_AUTOMATION_STEP_INTERVAL_MS));
    }
  }

  return {
    ok: results.every((r) => r.ok !== false),
    steps: results,
    domRead: input.domRead ?? "full",
  };
}
