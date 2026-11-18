/**
 * The bridge: the small script the app injects as the first element of <head> of every questionnaire it serves.
 * It runs inside the sandboxed frame, binds the page's controls to the answer store held by the app, and exposes
 * `window.KQA` to the page. It speaks to the app (the parent window) only with postMessage.
 *
 * The JavaScript below is deliberately plain ES2015 with no template literals, so it can live in a TS string
 * and run unchanged in every current browser. Documented in docs/FORMAT.md ("The KQA runtime").
 */
export const BRIDGE_VERSION = 1;

export const BRIDGE_SOURCE = String.raw`(function () {
  "use strict";
  if (window.KQA) return;

  var listeners = { ready: [], change: [], lock: [], eligibility: [] };
  var state = { ready: false, locked: false, questions: [], qmap: {}, answers: {}, eligibility: {}, participant: null, probe: false, preview: false };
  var errors = [];
  var consoleErrors = [];
  var readyResolve;
  var readyPromise = new Promise(function (resolve) { readyResolve = resolve; });

  function post(msg) {
    msg.kqa = 1;
    try { parent.postMessage(msg, "*"); } catch (e) {}
  }
  function emit(name, payload) {
    var list = listeners[name] || [];
    for (var i = 0; i < list.length; i++) {
      try { list[i](payload); } catch (e) { errors.push({ message: "KQA listener threw: " + (e && e.message), line: 0 }); post({ type: "error", message: "A KQA." + "on(\"" + name + "\") listener threw: " + (e && e.message) }); }
    }
  }
  function setHtmlState(s) { document.documentElement.setAttribute("data-kqa-state", s); }
  setHtmlState("loading");

  function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function q(id) { return state.qmap[id]; }
  function answerOf(id) { return state.answers[id] || {}; }
  function isAnswered(id) {
    var v = answerOf(id).value;
    if (v === undefined || v === null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "string") return v.trim() !== "";
    return true;
  }
  function controls(id) {
    var out = [];
    var all = document.querySelectorAll("[data-kqa]");
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute("data-kqa") === id) out.push(all[i]);
    return out;
  }
  function canFocus(el) {
    if (!el || !el.isConnected || el.disabled || el.type === "hidden" || el.tabIndex < 0) return false;
    var node = el;
    while (node && node.nodeType === 1) {
      if (node.hidden || node.inert || node.getAttribute("aria-hidden") === "true") return false;
      var style = window.getComputedStyle ? window.getComputedStyle(node) : null;
      if (style && (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse")) return false;
      node = node.parentElement;
    }
    return typeof el.getClientRects !== "function" || el.getClientRects().length > 0;
  }
  function focusQuestion(id) {
    if (!q(id)) return;
    var els = controls(id);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!canFocus(el)) continue;
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
      if (typeof el.scrollIntoView === "function") {
        var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      }
      return;
    }
  }
  function noteControls(id) {
    var out = [];
    var all = document.querySelectorAll("[data-kqa-note]");
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute("data-kqa-note") === id) out.push(all[i]);
    return out;
  }

  // ---- reading a question's value from the page
  function readDom(id) {
    var question = q(id);
    var els = controls(id);
    if (!els.length || !question) return undefined;
    var t = question.type;
    if (t === "multi") {
      var vals = [];
      els.forEach(function (el) { if (el.checked) vals.push(el.value); });
      return vals;
    }
    if (t === "single" || (t === "scale" && els[0].type === "radio")) {
      for (var i = 0; i < els.length; i++) if (els[i].checked) return t === "scale" ? Number(els[i].value) : els[i].value;
      return null;
    }
    var el = els[0];
    if (t === "number" || t === "scale") return el.value === "" ? null : Number(el.value);
    return el.value === "" ? null : el.value;
  }

  // ---- writing a stored answer into the page, without firing events
  function writeDom(id) {
    var question = q(id);
    var els = controls(id);
    var v = answerOf(id).value;
    if (question && els.length) {
      var t = question.type;
      els.forEach(function (el) {
        if (el.type === "radio") el.checked = v !== undefined && v !== null && String(v) === el.value;
        else if (el.type === "checkbox") el.checked = Array.isArray(v) && v.indexOf(el.value) !== -1;
        else if (el.tagName === "SELECT") el.value = v === undefined || v === null ? "" : String(v);
        else if (el.type === "range") { if (v !== undefined && v !== null) el.value = String(v); }
        else el.value = v === undefined || v === null ? "" : String(v);
      });
    }
    var note = answerOf(id).note || "";
    noteControls(id).forEach(function (el) { if (el.value !== note) el.value = note; });
    var statuses = document.querySelectorAll("[data-kqa-status]");
    for (var i = 0; i < statuses.length; i++) if (statuses[i].getAttribute("data-kqa-status") === id) statuses[i].setAttribute("data-state", isAnswered(id) ? "answered" : "empty");
  }
  function writeAll() { state.questions.forEach(function (x) { writeDom(x.id); }); }

  function applyLock() {
    var els = document.querySelectorAll("[data-kqa], [data-kqa-note]");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var id = el.getAttribute("data-kqa") || el.getAttribute("data-kqa-note");
      if (!el.hasAttribute("data-kqa-condition-disabled")) el.setAttribute("data-kqa-condition-disabled", el.disabled ? "1" : "0");
      var baseline = el.getAttribute("data-kqa-condition-disabled") === "1";
      el.disabled = state.locked || baseline || !!(state.eligibility && state.eligibility[id] === false);
    }
    setHtmlState(state.ready ? (state.locked ? "locked" : "ready") : "loading");
  }

  // ---- changing an answer
  function normalise(question, value) {
    if (value === undefined || value === null) return null;
    var t = question.type;
    if (t === "multi") { var arr = Array.isArray(value) ? value.map(String) : [String(value)]; return arr.length ? arr : null; }
    if (t === "number" || t === "scale") { var n = Number(value); return isNaN(n) ? null : n; }
    return String(value);
  }
  function commit(id, patch, source) {
    var question = q(id);
    if (!question) { post({ type: "error", message: "KQA: unknown question id \"" + id + "\" (it is not in the manifest)." }); return; }
    if (state.locked) return;
    var cur = state.answers[id] || {};
    var next = { value: cur.value, note: cur.note };
    var changed = false;
    if ("value" in patch) {
      var nv = normalise(question, patch.value);
      if (!equal(nv, cur.value === undefined ? null : cur.value)) { next.value = nv === null ? undefined : nv; changed = true; }
    }
    if ("note" in patch) {
      var nn = patch.note === "" || patch.note === null || patch.note === undefined ? undefined : String(patch.note);
      if (nn !== cur.note) { next.note = nn; changed = true; }
    }
    if (!changed) return;
    if (next.value === undefined && next.note === undefined) delete state.answers[id]; else state.answers[id] = next;
    if (source !== "dom") writeDom(id); else writeStatus(id);
    var msg = { type: "set", id: id };
    if ("value" in patch) msg.value = next.value === undefined ? null : next.value;
    if ("note" in patch) msg.note = next.note === undefined ? null : next.note;
    post(msg);
    updateEligibility(true);
    emit("change", { id: id, value: next.value, note: next.note, source: source });
  }
  function writeStatus(id) {
    var statuses = document.querySelectorAll("[data-kqa-status]");
    for (var i = 0; i < statuses.length; i++) if (statuses[i].getAttribute("data-kqa-status") === id) statuses[i].setAttribute("data-state", isAnswered(id) ? "answered" : "empty");
  }

  // Conditional questions depend on earlier answers. Hiding a block never
  // clears its answer; the answer can become eligible again if its parent changes.
  function conditionMatches(condition, eligible) {
    if (!condition || typeof condition.question !== "string" || !eligible[condition.question]) return false;
    var actual = answerOf(condition.question).value;
    if (actual === undefined || actual === null) return false;
    var expected = condition.value;
    switch (condition.operator) {
      case "equals": return equal(actual, expected);
      case "notEquals": return !equal(actual, expected);
      case "contains":
        return Array.isArray(actual) ? actual.some(function (value) { return equal(value, expected); })
          : typeof actual === "string" && typeof expected === "string" ? actual.indexOf(expected) !== -1 : false;
      case "notContains":
        return Array.isArray(actual) ? !actual.some(function (value) { return equal(value, expected); })
          : typeof actual === "string" && typeof expected === "string" ? actual.indexOf(expected) === -1 : false;
      default: return false;
    }
  }
  function setConditionalVisibility(question, eligible) {
    var blocks = document.querySelectorAll("[data-kqa-question-id]");
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      if (block.getAttribute("data-kqa-question-id") !== question.id) continue;
      if (!block.hasAttribute("data-kqa-condition-state")) {
        block.setAttribute("data-kqa-condition-state", "1");
        block.setAttribute("data-kqa-condition-hidden", block.hidden ? "1" : "0");
        block.setAttribute("data-kqa-condition-aria-hidden", block.getAttribute("aria-hidden") === null ? "" : block.getAttribute("aria-hidden"));
        block.setAttribute("data-kqa-condition-inert", block.hasAttribute("inert") ? "1" : "0");
      }
      var shouldHide = !eligible[question.id] || block.getAttribute("data-kqa-condition-hidden") === "1";
      block.hidden = shouldHide;
      if (shouldHide) {
        block.setAttribute("aria-hidden", "true");
        block.setAttribute("inert", "");
      } else {
        var aria = block.getAttribute("data-kqa-condition-aria-hidden");
        if (aria === "") block.removeAttribute("aria-hidden"); else block.setAttribute("aria-hidden", aria);
        if (block.getAttribute("data-kqa-condition-inert") === "1") block.setAttribute("inert", ""); else block.removeAttribute("inert");
      }
      var controlsInBlock = block.querySelectorAll("[data-kqa], [data-kqa-note]");
      for (var c = 0; c < controlsInBlock.length; c++) {
        var control = controlsInBlock[c];
        if (!control.hasAttribute("data-kqa-condition-disabled")) control.setAttribute("data-kqa-condition-disabled", control.disabled ? "1" : "0");
        control.disabled = shouldHide || state.locked || control.getAttribute("data-kqa-condition-disabled") === "1";
      }
      var focusables = block.querySelectorAll("a[href], button, input, select, textarea, [tabindex]");
      for (var f = 0; f < focusables.length; f++) {
        var focusable = focusables[f];
        if (!focusable.hasAttribute("data-kqa-condition-tabindex")) focusable.setAttribute("data-kqa-condition-tabindex", focusable.getAttribute("tabindex") === null ? "__none__" : focusable.getAttribute("tabindex"));
        if (shouldHide) focusable.setAttribute("tabindex", "-1");
        else {
          var priorTab = focusable.getAttribute("data-kqa-condition-tabindex");
          if (priorTab === "__none__") focusable.removeAttribute("tabindex"); else focusable.setAttribute("tabindex", priorTab);
        }
      }
    }
  }
  function updateEligibility(announce) {
    var eligible = {};
    state.questions.forEach(function (question) {
      var when = question.when;
      var all = when && Array.isArray(when.all) ? when.all : [];
      var any = when && Array.isArray(when.any) ? when.any : [];
      var ok = all.every(function (condition) { return conditionMatches(condition, eligible); }) &&
        (!any.length || any.some(function (condition) { return conditionMatches(condition, eligible); }));
      eligible[question.id] = ok;
      setConditionalVisibility(question, eligible);
    });
    var changed = !equal(eligible, state.eligibility || {});
    state.eligibility = eligible;
    if (announce && changed) {
      post({ type: "eligibility", eligible: eligible });
      emit("eligibility", eligibilityCopy());
    }
  }
  function eligibilityCopy() {
    var out = {};
    Object.keys(state.eligibility || {}).forEach(function (id) { out[id] = state.eligibility[id]; });
    return out;
  }

  // ---- binding controls
  function onControl(ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) return;
    var id = el.getAttribute("data-kqa");
    if (id !== null && q(id)) { commit(id, { value: readDom(id) }, "dom"); return; }
    var nid = el.getAttribute("data-kqa-note");
    if (nid !== null && q(nid)) commit(nid, { note: el.value }, "dom");
  }
  document.addEventListener("input", onControl, true);
  document.addEventListener("change", onControl, true);

  // ---- messages from the app
  function applyAnswers(map) {
    state.answers = {};
    Object.keys(map || {}).forEach(function (id) {
      var a = map[id] || {};
      state.answers[id] = { value: a.value === null ? undefined : a.value, note: a.note === null ? undefined : a.note };
    });
    writeAll();
  }
  window.addEventListener("message", function (ev) {
    if (ev.source !== parent) return;
    var m = ev.data;
    if (!m || m.kqa !== 1) return;
    if (m.type === "init") {
      state.questions = m.questions || [];
      state.qmap = {};
      state.questions.forEach(function (x) { state.qmap[x.id] = x; });
      state.participant = m.participant || null;
      state.probe = !!m.probe;
      state.preview = !!m.preview;
      state.locked = !!m.locked;
      state.ready = true;
      applyAnswers(m.answers);
      updateEligibility(true);
      applyLock();
      readyResolve(snapshot());
      emit("ready", snapshot());
      if (state.probe) setTimeout(runProbe, 60);
    } else if (m.type === "answers") {
      applyAnswers(m.answers);
      updateEligibility(true);
      state.questions.forEach(function (x) { emit("change", { id: x.id, value: answerOf(x.id).value, note: answerOf(x.id).note, source: "app" }); });
    } else if (m.type === "lock") {
      state.locked = !!m.locked;
      applyLock();
      emit("lock", { locked: state.locked });
    } else if (m.type === "offline") {
      if (state.ready && !state.locked) setHtmlState(m.offline ? "offline" : "ready");
    } else if (m.type === "focus-question" && typeof m.id === "string") {
      focusQuestion(m.id);
    }
  });

  function snapshot() { return { answers: answersCopy(), locked: state.locked, questions: state.questions.slice(), participant: state.participant }; }
  function answersCopy() {
    var out = {};
    Object.keys(state.answers).forEach(function (id) { out[id] = { value: state.answers[id].value, note: state.answers[id].note }; });
    return out;
  }

  // ---- errors from the page, reported to the app (the admin checker shows them)
  window.addEventListener("error", function (e) {
    var item = { message: e.message || "Script error", source: e.filename || "", line: e.lineno || 0, column: e.colno || 0, stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 600) : "" };
    errors.push(item);
    post({ type: "error", message: item.message, line: item.line, column: item.column, stack: item.stack });
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    var item = { message: "Unhandled promise rejection: " + (r && r.message ? r.message : String(r)), line: 0, column: 0, rejection: true };
    errors.push(item);
    post({ type: "error", message: item.message, rejection: true });
  });
  var origError = console.error;
  console.error = function () {
    try { consoleErrors.push(Array.prototype.slice.call(arguments).map(function (a) { return a && a.message ? a.message : String(a); }).join(" ").slice(0, 300)); } catch (e) {}
    return origError.apply(console, arguments);
  };

  // ---- public API for pages
  window.KQA = {
    version: ${"1"},
    ready: readyPromise,
    get: function (id) { return answerOf(id).value; },
    getNote: function (id) { return answerOf(id).note; },
    set: function (id, value) { commit(id, { value: value }, "script"); },
    setNote: function (id, text) { commit(id, { note: text }, "script"); },
    clear: function (id) { commit(id, { value: null }, "script"); },
    isAnswered: isAnswered,
    isEligible: function (id) { return !state.ready || !state.eligibility ? true : state.eligibility[id] !== false; },
    eligibility: eligibilityCopy,
    answers: answersCopy,
    progress: function () { var n = 0; var total = 0; state.questions.forEach(function (x) { if (state.eligibility[x.id] === false) return; total++; if (isAnswered(x.id)) n++; }); return { answered: n, total: total }; },
    on: function (name, fn) { if (listeners[name] && typeof fn === "function") { listeners[name].push(fn); if (name === "ready" && state.ready) { try { fn(snapshot()); } catch (e) {} } } },
    off: function (name, fn) { var l = listeners[name]; if (l) { var i = l.indexOf(fn); if (i !== -1) l.splice(i, 1); } },
    get locked() { return state.locked; },
    get questions() { return state.questions.slice(); },
    get participant() { return state.participant; },
    get preview() { return state.preview; }
  };

  // Links to other sites open through the app, in a new window with no connection back to this page. The frame has no
  // popup permission of its own, so a page cannot open a window that could reach the respondent's tab.
  document.addEventListener("click", function (ev) {
    var node = ev.target;
    var a = node && node.closest ? node.closest("a[href]") : null;
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (/^(https?:|mailto:|tel:)/i.test(href)) {
      ev.preventDefault();
      post({ type: "open", url: a.href });
    }
  }, true);

  // Tell the app we are alive, and what the page declares, so it can send the answers.
  function hello() {
    var manifest = null;
    var el = document.getElementById("kqa-manifest");
    if (el) { try { manifest = JSON.parse(el.textContent || ""); } catch (e) { manifest = null; } }
    post({ type: "hello", version: ${"1"}, manifest: manifest });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hello); else hello();

  // ---- the probe: what the admin checker runs in the real frame to prove each control stores and restores its answer
  function sampleFor(question) {
    var o = question.options || [];
    switch (question.type) {
      case "single": case "select": return o.length ? o[0].value : null;
      case "multi": return o.slice(0, 2).map(function (x) { return x.value; });
      case "text": return "Probe text";
      case "longtext": return "Probe line one\nProbe line two";
      case "number": { var lo = question.min !== undefined ? question.min : 0; var hi = question.max !== undefined ? question.max : lo + 10; return Math.min(hi, Math.max(lo, lo + 1)); }
      case "scale": { var smin = question.min !== undefined ? question.min : 1; return smin + 1 <= (question.max !== undefined ? question.max : 5) ? smin + 1 : smin; }
      case "date": return "2026-01-15";
    }
    return null;
  }
  function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }
  function nativeSet(el, value) {
    var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
  }
  function simulate(question, value) {
    var els = controls(question.id);
    if (!els.length) return false;
    var t = question.type;
    if (t === "single" || (t === "scale" && els[0].type === "radio") || t === "multi") {
      var want = t === "multi" ? value : [value];
      els.forEach(function (el) {
        var should = want.map(String).indexOf(el.value) !== -1;
        if (el.checked !== should) { el.checked = should; fire(el, "input"); fire(el, "change"); }
      });
      return true;
    }
    var el = els[0];
    nativeSet(el, String(value));
    fire(el, "input"); fire(el, "change");
    return true;
  }
  function runProbe() {
    var results = [];
    var tested = 0;
    var snapshotBefore = JSON.stringify(state.answers);
    var wasLocked = state.locked;
    state.locked = false;
    var expected = {};
    state.questions.forEach(function (question) {
      var els = controls(question.id);
      if (!els.length) return;
      var sample = sampleFor(question);
      if (sample === null) return;
      tested++;
      expected[question.id] = sample;
      var before = state.answers[question.id];
      simulate(question, sample);
      var got = answerOf(question.id).value;
      if (!equal(got, sample)) results.push({ code: "KQA601", questionId: question.id, message: "Changed the control for \"" + question.id + "\" to " + JSON.stringify(sample) + " but the app recorded " + JSON.stringify(got === undefined ? null : got) + "." });
      void before;
    });
    // Custom controls have nothing to simulate. Set a sample value through the runtime and watch whether the page reacts.
    var mo = null;
    try { mo = new MutationObserver(function () {}); mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); mo.takeRecords(); } catch (e) { mo = null; }
    if (mo) {
      state.questions.forEach(function (question) {
        if (!question.custom || controls(question.id).length) return;
        var sample = sampleFor(question);
        if (sample === null) return;
        tested++;
        commit(question.id, { value: sample }, "script");
        var seen = mo.takeRecords().filter(function (r) {
          var node = r.target && r.target.nodeType === 1 ? r.target : r.target && r.target.parentElement;
          if (!node || (node.closest && node.closest("[data-kqa-status]"))) return false;
          if (r.type === "attributes" && /^data-kqa/.test(r.attributeName || "")) return false;
          return true;
        });
        if (!seen.length) results.push({ code: "KQA608", questionId: question.id, message: "Called KQA.set(\"" + question.id + "\", " + JSON.stringify(sample) + ") and nothing on the page changed. The custom control does not show its answer." });
      });
      mo.disconnect();
    }
    // Restore test: hand the same answers back, as the app does when someone returns to their link.
    var restoreMap = {};
    Object.keys(expected).forEach(function (id) { restoreMap[id] = { value: expected[id] }; });
    applyAnswers(restoreMap);
    Object.keys(expected).forEach(function (id) {
      var shown = readDom(id);
      if (!equal(shown, expected[id])) results.push({ code: "KQA602", questionId: id, message: "Supplied the saved answer " + JSON.stringify(expected[id]) + " for \"" + id + "\" but the page shows " + JSON.stringify(shown === undefined ? null : shown) + "." });
    });
    // Leave the page as we found it.
    try { state.answers = JSON.parse(snapshotBefore); } catch (e) { state.answers = {}; }
    writeAll();
    state.locked = wasLocked;
    applyLock();
    var shown = document.body && document.body.offsetHeight > 0 && getComputedStyle(document.body).visibility !== "hidden";
    var text = shown ? (document.body.innerText || "").trim() : "";
    var overflow = document.documentElement.scrollWidth - window.innerWidth;
    post({
      type: "probe-result",
      results: results,
      tested: tested,
      errors: errors.slice(0, 20),
      consoleErrors: consoleErrors.slice(0, 20),
      visibleTextLength: text.length,
      overflowPx: overflow > 1 ? overflow : 0,
      viewportWidth: window.innerWidth
    });
  }
})();`;

/** Insert the bridge as the very first element of <head> (or <html>, or the top of the file). */
export function injectBridge(html: string): string {
  const tag = `<script>${BRIDGE_SOURCE.replace(/<\/script/gi, "<\\/script")}</script>`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  const root = /<html(\s[^>]*)?>/i.exec(html);
  if (root) return html.slice(0, root.index + root[0].length) + tag + html.slice(root.index + root[0].length);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return html.slice(0, doctype[0].length) + tag + html.slice(doctype[0].length);
  return tag + html;
}

/** The Content-Security-Policy sent with every questionnaire frame. */
export function frameContentSecurityPolicy(assetOrigin?: string): string {
  let assetSource = "";
  if (assetOrigin) {
    try {
      const parsed = new URL(assetOrigin);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") assetSource = `${parsed.origin}/api/assets/`;
    } catch {
      // An invalid origin never widens the frame policy.
    }
  }
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com",
    "style-src 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src https://fonts.gstatic.com https://cdnjs.cloudflare.com data:",
    `img-src ${assetSource ? `${assetSource} ` : ""}data: blob:`,
    "media-src data: blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
    "sandbox allow-scripts allow-forms",
  ].join("; ");
}

export const FRAME_CSP = frameContentSecurityPolicy();
