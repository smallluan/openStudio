import { captureSidebarPreviewSnapshot, composeChatLabPreviewContextBlock } from "./chatLabPreviewSnapshot.js";

/** @typedef {{
 *   selector?: string;
 *   label?: string;
 *   placeholder?: string;
 *   title?: string;
 *   parentSelector?: string;
 *   text_contains?: string;
 *   url_contains?: string;
 *   title_contains?: string;
 *   value?: string;
 *   hidden?: boolean;
 *   visible?: boolean;
 *   active?: boolean;
 * }} SidebarAutomationVerifySpec */

/** @typedef {{
 *   action: string;
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
 *   verify?: SidebarAutomationVerifySpec | SidebarAutomationVerifySpec[];
 *   verifyHint?: string;
 *   text_contains?: string;
 *   url_contains?: string;
 *   title_contains?: string;
 *   value?: string;
 *   hidden?: boolean;
 *   visible?: boolean;
 *   active?: boolean;
 * }} SidebarAutomationStep */

export const SIDEBAR_AUTOMATION_STEP_INTERVAL_MS = 500;

const RETRYABLE_STEP_ERRORS = new Set(["element_not_found"]);
const STEP_RETRY_DELAYS_MS = [800, 1200, 1800];

/**
 * @param {unknown} raw
 * @returns {SidebarAutomationVerifySpec | null}
 */
function normalizeVerifySpecOne(raw) {
  if (!raw || typeof raw !== "object") return null;
  const row = /** @type {Record<string, unknown>} */ (raw);
  /** @type {SidebarAutomationVerifySpec} */
  const out = {};
  for (const key of [
    "selector",
    "label",
    "placeholder",
    "title",
    "parentSelector",
    "text_contains",
    "url_contains",
    "title_contains",
    "value",
  ]) {
    if (typeof row[key] === "string" && row[key].trim()) {
      out[/** @type {keyof SidebarAutomationVerifySpec} */ (key)] = row[key].trim();
    }
  }
  if (row.hidden === true) out.hidden = true;
  if (row.visible === true) out.visible = true;
  if (row.active === true) out.active = true;
  return Object.keys(out).length ? out : null;
}

/**
 * @param {unknown} raw
 * @returns {SidebarAutomationVerifySpec | SidebarAutomationVerifySpec[] | undefined}
 */
function normalizeVerifySpec(raw) {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) {
    const list = raw.map(normalizeVerifySpecOne).filter(Boolean);
    return list.length ? /** @type {SidebarAutomationVerifySpec[]} */ (list) : undefined;
  }
  const one = normalizeVerifySpecOne(raw);
  return one ?? undefined;
}

/**
 * @param {SidebarAutomationStep} step
 * @returns {SidebarAutomationVerifySpec | SidebarAutomationVerifySpec[] | undefined}
 */
function verifySpecFromStep(step) {
  /** @type {SidebarAutomationVerifySpec} */
  const out = {};
  for (const key of [
    "selector",
    "label",
    "placeholder",
    "title",
    "parentSelector",
    "text_contains",
    "url_contains",
    "title_contains",
    "value",
  ]) {
    const v = step[/** @type {keyof SidebarAutomationStep} */ (key)];
    if (typeof v === "string" && v.trim()) {
      out[/** @type {keyof SidebarAutomationVerifySpec} */ (key)] = v.trim();
    }
  }
  if (step.hidden === true) out.hidden = true;
  if (step.visible === true) out.visible = true;
  if (step.active === true) out.active = true;
  return Object.keys(out).length ? out : undefined;
}

/**
 * @param {unknown} raw
 * @param {{ maxSteps?: number }} [opts]
 * @returns {SidebarAutomationStep[]}
 */
export function normalizeAutomationSteps(raw, opts = {}) {
  const maxSteps = Math.max(1, Math.min(16, Number(opts.maxSteps) || 16));
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  /** @type {SidebarAutomationStep[]} */
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = /** @type {Record<string, unknown>} */ (item);
    const action = typeof row.action === "string" ? row.action.trim().toLowerCase() : "";
    if (!action) continue;
    /** @type {SidebarAutomationStep} */
    const step = { action };
    if (typeof row.selector === "string" && row.selector.trim()) step.selector = row.selector.trim();
    if (typeof row.text === "string") step.text = row.text;
    if (typeof row.mode === "string" && row.mode.trim()) step.mode = row.mode.trim().toLowerCase();
    if (typeof row.intervalMs === "number" && Number.isFinite(row.intervalMs)) {
      step.intervalMs = Math.max(0, Math.min(300, Math.floor(row.intervalMs)));
    }
    if (typeof row.placeholder === "string" && row.placeholder.trim()) step.placeholder = row.placeholder.trim();
    if (typeof row.label === "string" && row.label.trim()) step.label = row.label.trim();
    if (typeof row.title === "string" && row.title.trim()) step.title = row.title.trim();
    if (typeof row.parentSelector === "string" && row.parentSelector.trim()) {
      step.parentSelector = row.parentSelector.trim();
    }
    const verify = normalizeVerifySpec(row.verify);
    if (verify) step.verify = verify;
    if (typeof row.verifyHint === "string" && row.verifyHint.trim()) {
      step.verifyHint = row.verifyHint.trim();
    }
    if (action === "verify") {
      if (typeof row.text_contains === "string" && row.text_contains.trim()) {
        step.text_contains = row.text_contains.trim();
      }
      if (typeof row.url_contains === "string" && row.url_contains.trim()) {
        step.url_contains = row.url_contains.trim();
      }
      if (typeof row.title_contains === "string" && row.title_contains.trim()) {
        step.title_contains = row.title_contains.trim();
      }
      if (typeof row.value === "string") step.value = row.value;
      if (row.hidden === true) step.hidden = true;
      if (row.visible === true) step.visible = true;
      if (row.active === true) step.active = true;
    }
    if (typeof row.url === "string" && row.url.trim()) step.url = row.url.trim();
    if (typeof row.key === "string" && row.key.trim()) step.key = row.key.trim();
    if (typeof row.ms === "number" && Number.isFinite(row.ms)) step.ms = Math.max(0, Math.min(15000, row.ms));
    if (typeof row.amount === "number" && Number.isFinite(row.amount)) step.amount = row.amount;
    out.push(step);
    if (out.length >= maxSteps) break;
  }
  return out;
}

/**
 * @param {SidebarAutomationStep} step
 */
function buildStepScript(step) {
  const payload = JSON.stringify(step);
  return `(async function(){
    var step = ${payload};
    var INPUT_SELECTOR = "input, textarea, [contenteditable], [contenteditable=true], [role=textbox]";
    var TARGET_SELECTOR = "button, a, input[type=submit], input[type=button], [role=button], " + INPUT_SELECTOR + ", label";
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
    function focusInput(el, skipClick) {
      if (!el) return false;
      try {
        if (typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      } catch (e) {}
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
        if (scope) {
          var scoped = queryWithin(scope, String(s.selector));
          if (scoped) return scoped;
        }
        return querySelectorDeep(String(s.selector));
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
    function setTextValue(el, value) {
      return writeNativeValue(el, value);
    }
    function setValue(el, value) {
      if (!isTextInput(el)) return false;
      focusInput(el, true);
      if (!setTextValue(el, value)) return false;
      el.dispatchEvent(new Event("input", { bubbles: true }));
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
        blurInput(blurEl);
        return { ok: true, action: "blur" };
      }
      if (action === "click") {
        var clickEl = resolveTarget(step);
        if (!clickEl) return { ok: false, action: "click", error: "element_not_found" };
        try {
          if (typeof clickEl.scrollIntoView === "function") {
            clickEl.scrollIntoView({ block: "nearest", inline: "nearest" });
          }
        } catch (e) {}
        clickEl.click();
        return { ok: true, action: "click" };
      }
      if (action === "type" || action === "type_chars") {
        var typeEl = resolveTarget(step);
        if (!typeEl) return { ok: false, action: action, error: "element_not_found" };
        var charMode = action === "type_chars" || String(step.mode || "").toLowerCase() === "char";
        if (charMode) {
          if (!(await typeChars(typeEl, String(step.text ?? ""), step.intervalMs))) {
            return { ok: false, action: action, error: "not_input" };
          }
          return { ok: true, action: "type_chars" };
        }
        if (!setValue(typeEl, String(step.text ?? ""))) return { ok: false, action: action, error: "not_input" };
        return { ok: true, action: "type" };
      }
      return { ok: false, action: action, error: "unknown_action" };
    } catch (e) {
      return { ok: false, action: String(step.action || ""), error: String(e && e.message ? e.message : e) };
    }
  })()`;
}

/**
 * @param {SidebarAutomationVerifySpec | SidebarAutomationVerifySpec[]} verifySpec
 */
function buildVerifyScript(verifySpec) {
  const checks = Array.isArray(verifySpec) ? verifySpec : [verifySpec];
  const payload = JSON.stringify(checks);
  return `(function(){
    var checks = ${payload};
    var INPUT_SELECTOR = "input, textarea, [contenteditable], [contenteditable=true], [role=textbox]";
    var TARGET_SELECTOR = "button, a, input[type=submit], input[type=button], [role=button], " + INPUT_SELECTOR + ", label, div, span, li";
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
    function queryWithin(root, selector) {
      if (!root) return null;
      try {
        var hit = root.querySelector(selector);
        if (hit && vis(hit)) return hit;
      } catch (e) {}
      return null;
    }
    function queryAllWithin(root, selector) {
      if (!root) return [];
      try {
        return Array.prototype.slice.call(root.querySelectorAll(selector));
      } catch (e) {
        return [];
      }
    }
    function resolveTarget(s) {
      var scope = null;
      if (s.parentSelector) {
        scope = querySelectorDeep(String(s.parentSelector));
        if (!scope) return null;
      }
      if (s.selector) {
        if (scope) {
          var scoped = queryWithin(scope, String(s.selector));
          if (scoped) return scoped;
        }
        return querySelectorDeep(String(s.selector));
      }
      if (s.title) {
        var titleNeedle = String(s.title);
        var titleNodes = scope
          ? queryAllWithin(scope, INPUT_SELECTOR + ", [title]")
          : querySelectorAllDeep(INPUT_SELECTOR + ", [title]");
        for (var ti = 0; ti < titleNodes.length; ti++) {
          var tel = titleNodes[ti];
          if (!vis(tel)) continue;
          if ((tel.getAttribute("title") || "").indexOf(titleNeedle) >= 0) return tel;
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
          ? [scope].concat(queryAllWithin(scope, TARGET_SELECTOR))
          : querySelectorAllDeep(TARGET_SELECTOR);
        for (var j = 0; j < nodes.length; j++) {
          var n = nodes[j];
          if (!vis(n)) continue;
          var t = (n.innerText || n.textContent || n.value || n.getAttribute("aria-label") || "").trim();
          if (t.indexOf(lbl) >= 0) return n;
        }
      }
      return null;
    }
    function readValue(el) {
      if (!el) return "";
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, "value");
        if (desc && desc.get) return String(desc.get.call(el));
      }
      return String(el.value != null ? el.value : el.textContent || el.innerText || "");
    }
    function runOne(v) {
      if (v.url_contains && String(location.href).indexOf(String(v.url_contains)) < 0) {
        return { ok: false, error: "url_mismatch", expected: v.url_contains, actual: String(location.href) };
      }
      if (v.title_contains && String(document.title || "").indexOf(String(v.title_contains)) < 0) {
        return { ok: false, error: "title_mismatch", expected: v.title_contains, actual: String(document.title || "") };
      }
      if (v.text_contains) {
        var bodyText = document.body ? String(document.body.innerText || document.body.textContent || "") : "";
        if (bodyText.indexOf(String(v.text_contains)) < 0) {
          return { ok: false, error: "text_missing", expected: v.text_contains };
        }
      }
      var needsEl = !!(v.selector || v.label || v.placeholder || v.title || v.parentSelector || v.value != null || v.active);
      if (needsEl) {
        var el = resolveTarget(v);
        var hide = v.hidden === true;
        if (!hide && (!el || !vis(el))) {
          return { ok: false, error: "element_not_found", expected: v };
        }
        if (hide && el && vis(el)) {
          return { ok: false, error: "element_still_visible", expected: v };
        }
        if (v.value != null && el) {
          var actual = readValue(el);
          if (actual.indexOf(String(v.value)) < 0) {
            return { ok: false, error: "value_mismatch", expected: v.value, actual: actual };
          }
        }
        if (v.active === true && el && document.activeElement !== el) {
          return { ok: false, error: "not_focused", expected: v };
        }
      }
      return { ok: true };
    }
    for (var c = 0; c < checks.length; c++) {
      var row = runOne(checks[c]);
      if (!row.ok) {
        row.checkIndex = c;
        row.checksTotal = checks.length;
        return row;
      }
    }
    return { ok: true, checks: checks.length };
  })()`;
}

/**
 * @param {import("electron").WebviewTag} wv
 * @param {SidebarAutomationVerifySpec | SidebarAutomationVerifySpec[] | undefined} verifySpec
 */
async function runVerifyOnWebview(wv, verifySpec) {
  if (!verifySpec) return { ok: true, skipped: true };
  focusWebviewHost(wv);
  const raw = await wv.executeJavaScript(buildVerifyScript(verifySpec), false);
  return raw && typeof raw === "object" ? raw : { ok: false, error: "bad_verify_result" };
}

/**
 * @param {SidebarAutomationStep} step
 * @param {Record<string, unknown>} row
 */
async function applyStepVerification(wv, step, row) {
  if (row.ok === false || step.action === "verify") return row;
  const spec = step.verify;
  if (!spec) return row;
  const verifyResult = await runVerifyOnWebview(wv, spec);
  if (verifyResult.ok === false) {
    return {
      ...row,
      ok: false,
      error: String(verifyResult.error || "verify_failed"),
      verify: verifyResult,
      verifyHint: step.verifyHint,
    };
  }
  return { ...row, verify: verifyResult, verifyHint: step.verifyHint };
}

const WEBVIEW_INTERACTION_ACTIONS = new Set([
  "click",
  "focus",
  "blur",
  "type",
  "type_chars",
  "press",
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
  if (step.action === "verify") {
    focusWebviewHost(wv);
    const spec = verifySpecFromStep(step) || step.verify;
    const row = await runVerifyOnWebview(wv, spec);
    return { ...row, action: "verify" };
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
  const retryable = !["wait", "snapshot", "navigate", "scroll"].includes(step.action);
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
 * }} input
 */
export async function runSidebarPreviewAutomation(input) {
  const steps = normalizeAutomationSteps(input.steps);
  if (!steps.length) return { ok: false, error: "no_steps", steps: [] };
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
      });
      const block = input.t ? composeChatLabPreviewContextBlock(input.t, snap) : "";
      results.push({
        ok: Boolean(snap?.ok),
        action: "snapshot",
        url: snap?.url ?? "",
        title: snap?.title ?? "",
        text: snap?.text ?? "",
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
          stoppedAt: stepIndex,
          stopReason: "webview_unavailable",
        };
      }
      continue;
    }
    const wv = /** @type {import("electron").WebviewTag} */ (webviewNode);
    let row = await runStepOnWebviewWithRetry(wv, step);
    row = await applyStepVerification(wv, step, row);
    results.push(row);
    if (input.onStepComplete) {
      await input.onStepComplete({ step, row, index: stepIndex, results: [...results] });
    }
    if (stopOnFailure && row.ok === false) {
      return {
        ok: false,
        steps: results,
        stoppedAt: stepIndex,
        stopReason: String(row.error || "step_failed"),
      };
    }
    if (
      step.action === "click" ||
      step.action === "focus" ||
      step.action === "type" ||
      step.action === "type_chars" ||
      step.action === "blur" ||
      step.action === "press" ||
      step.action === "navigate" ||
      step.action === "wait" ||
      step.action === "scroll" ||
      step.action === "verify"
    ) {
      await new Promise((r) => window.setTimeout(r, SIDEBAR_AUTOMATION_STEP_INTERVAL_MS));
    }
  }

  return { ok: results.every((r) => r.ok !== false), steps: results };
}
