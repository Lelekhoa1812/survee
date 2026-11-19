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

  var listeners = { ready: [], change: [], lock: [], eligibility: [], validation: [] };
  var state = { ready: false, locked: false, questions: [], qmap: {}, answers: {}, recordGroups: {}, eligibility: {}, eligibilityReady: false, participant: null, probe: false, preview: false, guided: false, guidedSection: null, guidedQuestion: null, guidedQuestionMode: false, locale: "en-AU", messages: {} };
  var errors = [];
  var consoleErrors = [];
  var routingStatusNode = null;
  var lengthDrafts = {};
  var lengthDraftValues = {};
  var pendingRecordOperations = [];
  var recordDrafts = {};
  var recordAnnouncements = {};
  var readyResolve;
  var readyPromise = new Promise(function (resolve) { readyResolve = resolve; });

  function post(msg) {
    msg.kqa = 1;
    try { parent.postMessage(msg, "*"); } catch (e) {}
  }
  function localized(key, values) {
    var template = state.messages && state.messages[key];
    if (values && values.count === 1 && state.messages && typeof state.messages[key + "One"] === "string") template = state.messages[key + "One"];
    if (typeof template !== "string") {
      var defaults = { lengthCount: "{count} of {max} characters used", lengthLimitReached: "limit reached", lengthOverLimit: "over the limit", lengthApproaching: "Character limit approaching.", lengthReachedAnnouncement: "Character limit reached.", lengthExceededAnnouncement: "Character limit exceeded. This text has not been saved; shorten it to the limit.", maxSelections: "Choose no more than {count} options.", maxSelectionsOne: "Choose no more than {count} option.", minSelections: "Choose at least {count} options, or leave this question blank.", minSelectionsOne: "Choose at least {count} option, or leave this question blank.", exclusiveHelp: "Exclusive options must be chosen by themselves.", exclusiveError: "Choose an exclusive option by itself.", rankError: "Rank every option exactly once to continue.", rankMoveUp: "Move up", rankMoveDown: "Move down", rankConfirm: "Use this order", rankPosition: "Currently position {index} of {total}.", rankMoveLabel: "Move {label} {direction}", rankUseLabel: "Use this order for {label}", browseAnswered: "{answered} of {total} answered", questionShown: "Questions shown: {count}.", questionHidden: "Questions hidden: {count}. Hidden answers are retained.", rankMoved: "{label} moved to position {index} of {total}.", rankChanged: "This ranking's options changed. Rank every current option exactly once, then choose Use this order.", savedMaxSelections: "This saved answer has {selected} choices. Remove choices until no more than {maximum} remain.", removeChoices: "Remove {count} more choices to continue.", exclusiveSelected: "Exclusive option selected; other choices cleared.", exclusiveCleared: "Exclusive choice cleared.", repeatAdd: "Add {item}", repeatRemove: "Remove {item} {index}", repeatRowLabel: "{item} {index}", repeatRowAdded: "{item} {index} added.", repeatRowRemoved: "{item} removed.", repeatConflict: "This {item} changed elsewhere. Review the saved value before continuing.", repeatFieldInvalid: "This value is invalid and has not been saved. Check this field." };
      template = values && values.count === 1 ? defaults[key + "One"] || defaults[key] : defaults[key];
      if (typeof template !== "string") return "";
    }
    return template.replace(/\{([a-zA-Z]+)\}/g, function (_, name) {
      var value = values && values[name];
      return typeof value === "number" ? new Intl.NumberFormat(state.locale || "en-AU").format(value) : String(value == null ? "" : value);
    });
  }
  function markLocalized(el) {
    if (!el) return;
    el.lang = state.locale || "en-AU";
    el.dir = state.locale === "ar" ? "rtl" : "ltr";
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
    var question = q(id);
    if (question && question.type === "repeat") return (state.recordGroups[id] || []).some(function (row) { return !row.deletedAt; });
    var v = answerOf(id).value;
    if (v === undefined || v === null) return false;
    if (question && question.type === "rank") {
      var allowed = (question.options || []).map(function (option) { return option.value; });
      return Array.isArray(v) && v.length > 0 && v.length === allowed.length && new Set(v).size === allowed.length && v.every(function (value) { return allowed.indexOf(value) !== -1; });
    }
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
  function canFocus(el, allowProgrammatic) {
    if (!el || !el.isConnected || el.disabled || el.type === "hidden" || (el.tabIndex < 0 && !allowProgrammatic)) return false;
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
    var block = null;
    var programmaticBlock = false;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!canFocus(el)) continue;
      block = el;
      break;
    }
    // Script-backed custom questions have no [data-kqa] control. Their marked
    // question block provides a stable jump target and a fallback focus scope.
    if (!block) {
      var blocks = document.querySelectorAll("[data-kqa-question-id]");
      for (var j = 0; j < blocks.length; j++) {
        if (blocks[j].getAttribute("data-kqa-question-id") === id) { block = blocks[j]; break; }
      }
      if (block) {
        var candidates = block.querySelectorAll("button, input, select, textarea, a[href], [tabindex]");
        var target = null;
        for (var k = 0; k < candidates.length; k++) {
          if (canFocus(candidates[k])) { target = candidates[k]; break; }
        }
        if (target) block = target;
        else if (!block.hasAttribute("tabindex")) {
          block.setAttribute("tabindex", "-1");
          programmaticBlock = true;
        }
      }
    }
    if (!block || !canFocus(block, programmaticBlock || block.tabIndex < 0)) return;
    try { block.focus({ preventScroll: true }); } catch (e) { block.focus(); }
    if (typeof block.scrollIntoView === "function") {
      var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      block.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    }
  }
  function noteControls(id) {
    var out = [];
    var all = document.querySelectorAll("[data-kqa-note]");
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute("data-kqa-note") === id) out.push(all[i]);
    return out;
  }
  function lengthLimit(question, isNote) {
    if (isNote) {
      var note = question.note;
      return note && typeof note === "object" && typeof note.maxLength === "number" ? note.maxLength : 5000;
    }
    return typeof question.maxLength === "number" ? question.maxLength : (question.type === "text" ? 500 : 20000);
  }
  function retainLengthDraft(id, isNote, el, invalid) {
    var key = id + (isNote ? ":note" : ":answer");
    var previous = !!lengthDraftValues[key];
    if (invalid) lengthDraftValues[key] = { element: el, value: el.value };
    else delete lengthDraftValues[key];
    if (!lengthDrafts[id]) lengthDrafts[id] = { answer: false, note: false };
    lengthDrafts[id][isNote ? "note" : "answer"] = invalid;
    if (!lengthDrafts[id].answer && !lengthDrafts[id].note) delete lengthDrafts[id];
    if (previous !== invalid) {
      var otherKey = id + (isNote ? ":answer" : ":note");
      var remaining = lengthDraftValues[otherKey];
      var otherIsNote = !isNote;
      post({ type: "length-draft", id: id, valid: !lengthDrafts[id], count: invalid ? el.value.length : remaining ? remaining.value.length : undefined, max: invalid ? lengthLimit(q(id), isNote) : remaining ? lengthLimit(q(id), otherIsNote) : undefined });
    }
  }
  function restoreLengthDrafts() {
    Object.keys(lengthDraftValues).forEach(function (key) {
      var draft = lengthDraftValues[key];
      if (draft.element && draft.element.isConnected) {
        draft.element.value = draft.value;
        var id = key.slice(0, key.lastIndexOf(":"));
        updateLengthFeedback(id, false);
      }
    });
  }
  function appendDescription(el, id, include) {
    var ids = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    var index = ids.indexOf(id);
    if (include && index === -1) ids.push(id);
    if (!include && index !== -1) ids.splice(index, 1);
    if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
    else el.removeAttribute("aria-describedby");
  }
  function lengthFeedback(el, question, isNote, announce) {
    if (!el || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA")) return;
    if (!isNote && question.type !== "text" && question.type !== "longtext") return;
    var attr = isNote ? "data-kqa-note" : "data-kqa";
    var key = el.getAttribute(attr) || question.id;
    var kind = isNote ? "note" : "answer";
    var id = el.getAttribute("data-kqa-length-id") || "kqa-length-" + key + "-" + kind;
    var counter = document.querySelector('[data-kqa-length-counter="' + id + '"]');
    if (!counter) {
      var baseId = id;
      var suffix = 1;
      while (document.getElementById(id)) id = baseId + "-" + suffix++;
      counter = document.createElement("p");
      markLocalized(counter);
      counter.id = id;
      counter.setAttribute("data-kqa-length-counter", id);
      counter.setAttribute("aria-live", "off");
      counter.style.cssText = "font-size:0.875em;font-weight:400;margin:0.25rem 0 0;text-align:right;color:inherit";
      var anchor = el.closest ? el.closest("label") || el : el;
      anchor.insertAdjacentElement("afterend", counter);
      var status = document.createElement("span");
      markLocalized(status);
      status.setAttribute("data-kqa-length-status", id);
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.style.cssText = "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
      counter.insertAdjacentElement("afterend", status);
      el.setAttribute("data-kqa-length-id", id);
    }
    var statusNode = document.querySelector('[data-kqa-length-status="' + counter.getAttribute("data-kqa-length-counter") + '"]');
    markLocalized(counter);
    markLocalized(statusNode);
    var max = lengthLimit(question, isNote);
    var count = el.value.length;
    var stage = count > max ? "over" : count === max ? "limit" : count >= Math.ceil(max * 0.8) ? "approaching" : "below";
    var visible = stage !== "below" && count > 0;
    counter.hidden = !visible;
    appendDescription(el, counter.id, visible);
    counter.textContent = localized("lengthCount", { count: count, max: max }) + (stage === "limit" ? " — " + localized("lengthLimitReached") : stage === "over" ? " — " + localized("lengthOverLimit") : "");
    counter.style.color = stage === "limit" || stage === "over" ? "var(--danger, currentColor)" : "inherit";
    counter.style.fontWeight = stage === "limit" || stage === "over" ? "600" : "400";
    if (statusNode) {
      var previous = statusNode.getAttribute("data-stage") || "below";
      if (announce && stage !== previous && (stage === "approaching" || stage === "limit" || stage === "over")) {
        statusNode.textContent = stage === "approaching" ? localized("lengthApproaching") : stage === "limit" ? localized("lengthReachedAnnouncement") : localized("lengthExceededAnnouncement");
      } else if (stage === "below") statusNode.textContent = "";
      statusNode.setAttribute("data-stage", stage);
    }
  }
  function updateLengthFeedback(id, announce) {
    var question = q(id);
    if (!question) return;
    controls(id).forEach(function (el) { lengthFeedback(el, question, false, announce); });
    noteControls(id).forEach(function (el) { lengthFeedback(el, question, true, announce); });
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
    if (t === "rank") {
      return Array.prototype.filter.call(els[0].children, function (item) { return item.tagName === "LI"; }).map(function (item) { return item.getAttribute("data-value"); });
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
      if (t === "rank" && Array.isArray(v)) {
        var rankList = els[0];
        var rankItems = Array.prototype.slice.call(rankList.children).filter(function (item) { return item.tagName === "LI"; });
        var rankByValue = Object.create(null);
        rankItems.forEach(function (item) { rankByValue[item.getAttribute("data-value")] = item; });
        v.forEach(function (value) { if (rankByValue[value]) rankList.appendChild(rankByValue[value]); });
        refreshRankControls(id);
      }
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
    updateLengthFeedback(id, false);
    var statuses = document.querySelectorAll("[data-kqa-status]");
    for (var i = 0; i < statuses.length; i++) if (statuses[i].getAttribute("data-kqa-status") === id) statuses[i].setAttribute("data-state", isAnswered(id) ? "answered" : "empty");
    updateRankConfirmation(id);
  }
  function writeAll() { state.questions.forEach(function (x) { writeDom(x.id); }); }

  function selectionLimitMessage(question) { return localized("maxSelections", { count: question.maxSelections }); }
  function selectionLimitError(id, message) {
    var els = controls(id);
    var group = els.length && els[0].closest ? els[0].closest("fieldset") : null;
    var block = els.length && els[0].closest ? els[0].closest("[data-kqa-question-id]") : null;
    var host = group && group.parentElement ? group.parentElement : block || (els[0] && els[0].parentElement);
    if (!host) return;
    var feedback = host.querySelector('[data-kqa-selection-error="' + id + '"]');
    if (!message) { if (feedback) feedback.remove(); return; }
    if (!feedback) {
      feedback = document.createElement("p");
      markLocalized(feedback);
      feedback.setAttribute("data-kqa-selection-error", id);
      feedback.setAttribute("role", "alert");
      feedback.setAttribute("aria-live", "assertive");
      feedback.className = "kq-selection-limit-error";
      if (group && group.parentElement === host) host.insertBefore(feedback, group.nextSibling);
      else host.appendChild(feedback);
    }
    feedback.textContent = message;
  }
  function applySelectionLimitGuidance() {
    state.questions.forEach(function (question) {
      if (question.type !== "multi" || (typeof question.minSelections !== "number" && typeof question.maxSelections !== "number" && !(question.exclusiveOptions || []).length)) return;
      var els = controls(question.id);
      if (!els.length) return;
      var group = els[0].closest ? els[0].closest("fieldset") : null;
      var host = group && group.parentElement ? group.parentElement : els[0].parentElement;
      if (!host) return;
      var existingHint = host.querySelector('[data-kqa-selection-limit="' + question.id + '"]');
      if (existingHint) {
        markLocalized(existingHint);
        existingHint.textContent = (typeof question.minSelections === "number" ? localized("minSelections", { count: question.minSelections }) + " " : "") + (typeof question.maxSelections === "number" ? localized("maxSelections", { count: question.maxSelections }) + " " : "") + ((question.exclusiveOptions || []).length ? localized("exclusiveHelp") : "");
        return;
      }
      var hint = document.createElement("p");
      markLocalized(hint);
      hint.id = "kqa-multi-guidance-" + question.id;
      hint.setAttribute("data-kqa-selection-limit", question.id);
      hint.className = "kq-help";
      hint.textContent = (typeof question.minSelections === "number" ? localized("minSelections", { count: question.minSelections }) + " " : "") + (typeof question.maxSelections === "number" ? localized("maxSelections", { count: question.maxSelections }) + " " : "") + ((question.exclusiveOptions || []).length ? localized("exclusiveHelp") : "");
      if (group) {
        var describedBy = (group.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
        if (describedBy.indexOf(hint.id) === -1) describedBy.push(hint.id);
        group.setAttribute("aria-describedby", describedBy.join(" "));
        host.insertBefore(hint, group);
      } else host.insertBefore(hint, els[0]);
      if ((question.exclusiveOptions || []).length && !host.querySelector('[data-kqa-exclusive-status="' + question.id + '"]')) {
        var liveStatus = document.createElement("span");
        markLocalized(liveStatus);
        liveStatus.setAttribute("data-kqa-exclusive-status", question.id);
        liveStatus.setAttribute("role", "status");
        liveStatus.setAttribute("aria-live", "polite");
        liveStatus.setAttribute("aria-atomic", "true");
        liveStatus.style.cssText = "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
        host.appendChild(liveStatus);
      }
    });
  }
  function exclusiveSelectionMessage(id, conflicted) {
    var els = controls(id);
    var group = els.length && els[0].closest ? els[0].closest("fieldset") : null;
    var host = group && group.parentElement ? group.parentElement : (els[0] && els[0].parentElement);
    if (!host) return;
    var status = host.querySelector('[data-kqa-exclusive-status="' + id + '"]');
    if (!status && conflicted) {
      status = document.createElement("p");
      markLocalized(status);
      status.setAttribute("data-kqa-exclusive-status", id);
      status.setAttribute("role", "alert");
      status.setAttribute("aria-live", "assertive");
      status.className = "kq-selection-limit-error";
      if (group && group.parentElement === host) host.insertBefore(status, group.nextSibling); else host.appendChild(status);
    }
    if (status) {
      markLocalized(status);
      if (conflicted) status.textContent = localized("exclusiveError");
      else if (status.getAttribute("role") === "alert") status.remove();
      else status.textContent = "";
    }
  }
  function rankItems(id) {
    var els = controls(id);
    if (!els.length) return [];
    return Array.prototype.filter.call(els[0].children, function (item) { return item.tagName === "LI"; });
  }
  function refreshRankControls(id) {
    var items = rankItems(id);
    items.forEach(function (item, index) {
      var label = item.getAttribute("data-kqa-rank-label") || item.textContent.trim();
      item.setAttribute("data-kqa-rank-label", label);
      var buttons = item.querySelectorAll("button[data-kqa-rank-move]");
      for (var i = 0; i < buttons.length; i++) {
        var direction = buttons[i].getAttribute("data-kqa-rank-move");
        buttons[i].disabled = direction === "up" ? index === 0 : index === items.length - 1;
        buttons[i].setAttribute("aria-label", localized("rankMoveLabel", { label: label, direction: direction === "up" ? localized("rankMoveUp") : localized("rankMoveDown") }) + ". " + localized("rankPosition", { index: index + 1, total: items.length }));
      }
    });
  }
  function updateRankConfirmation(id) {
    var els = controls(id);
    if (!els.length) return;
    var confirm = els[0].parentElement.querySelector('[data-kqa-rank-confirm="' + id + '"]');
    if (confirm) confirm.hidden = isAnswered(id);
  }
  function applyRankControls() {
    state.questions.forEach(function (question) {
      if (question.type !== "rank") return;
      var lists = controls(question.id);
      if (!lists.length) return;
      rankItems(question.id).forEach(function (item) {
        var label = item.getAttribute("data-kqa-rank-label") || item.textContent.trim();
        item.setAttribute("data-kqa-rank-label", label);
        ["up", "down"].forEach(function (direction) {
          var button = item.querySelector('button[data-kqa-rank-move="' + direction + '"]') || document.createElement("button");
          button.type = "button";
          markLocalized(button);
          button.setAttribute("data-kqa-rank-move", direction);
          button.textContent = direction === "up" ? localized("rankMoveUp") : localized("rankMoveDown");
          button.setAttribute("aria-label", localized("rankMoveLabel", { label: label, direction: direction === "up" ? localized("rankMoveUp") : localized("rankMoveDown") }));
          if (!button.parentElement) item.appendChild(button);
        });
      });
      var tools = lists[0].parentElement.querySelector('[data-kqa-rank-tools="' + question.id + '"]');
      if (!tools) {
        tools = document.createElement("div");
        tools.setAttribute("data-kqa-rank-tools", question.id);
        tools.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:8px";
        var confirm = document.createElement("button");
        markLocalized(confirm);
        confirm.type = "button";
        confirm.setAttribute("data-kqa-rank-confirm", question.id);
        confirm.textContent = localized("rankConfirm");
        confirm.setAttribute("aria-label", localized("rankUseLabel", { label: question.label }));
        confirm.style.cssText = "min-height:44px;padding:8px 12px;border:1px solid #8794a5;border-radius:6px;background:transparent;font:inherit;cursor:pointer";
        tools.appendChild(confirm);
        var status = document.createElement("span");
        markLocalized(status);
        status.setAttribute("data-kqa-rank-status", question.id);
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        status.setAttribute("aria-atomic", "true");
        status.style.cssText = "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
        tools.appendChild(status);
        lists[0].parentElement.insertBefore(tools, lists[0].nextSibling);
      }
      var confirmButton = tools.querySelector('[data-kqa-rank-confirm="' + question.id + '"]');
      if (confirmButton) {
        markLocalized(confirmButton);
        confirmButton.textContent = localized("rankConfirm");
        confirmButton.setAttribute("aria-label", localized("rankUseLabel", { label: question.label }));
      }
      refreshRankControls(question.id);
      updateRankConfirmation(question.id);
    });
  }

  function applyLock() {
    var els = document.querySelectorAll("[data-kqa], [data-kqa-note]");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var id = el.getAttribute("data-kqa") || el.getAttribute("data-kqa-note");
      if (!el.hasAttribute("data-kqa-condition-disabled")) el.setAttribute("data-kqa-condition-disabled", el.disabled ? "1" : "0");
      var baseline = el.getAttribute("data-kqa-condition-disabled") === "1";
      el.disabled = state.locked || baseline || !!(state.eligibility && state.eligibility[id] === false);
    }
    var rankButtons = document.querySelectorAll("button[data-kqa-rank-move]");
    for (var j = 0; j < rankButtons.length; j++) {
      var rankList = rankButtons[j].closest("ol[data-kqa]");
      var rankId = rankList && rankList.getAttribute("data-kqa");
      var rankItem = rankButtons[j].parentElement;
      var rankIndex = rankItems(rankId).indexOf(rankItem);
      var boundary = rankButtons[j].getAttribute("data-kqa-rank-move") === "up" ? rankIndex === 0 : rankIndex === rankItems(rankId).length - 1;
      rankButtons[j].disabled = state.locked || !!(state.eligibility && state.eligibility[rankId] === false) || boundary;
    }
    var rankConfirmButtons = document.querySelectorAll("button[data-kqa-rank-confirm]");
    for (var k = 0; k < rankConfirmButtons.length; k++) {
      var confirmId = rankConfirmButtons[k].getAttribute("data-kqa-rank-confirm");
      rankConfirmButtons[k].disabled = state.locked || !!(state.eligibility && state.eligibility[confirmId] === false);
    }
    state.questions.forEach(function (question) {
      if (question.type !== "repeat") return;
      var add = document.querySelector('[data-kqa-record-add="' + question.id + '"]');
      var list = document.querySelector('[data-kqa-record-list="' + question.id + '"]');
      if (add && list) updateRecordButtons(question, list, add);
    });
    setHtmlState(state.ready ? (state.locked ? "locked" : "ready") : "loading");
  }

  // ---- changing an answer
  function normalise(question, value) {
    if (value === undefined || value === null) return null;
    var t = question.type;
    if (t === "multi" || t === "rank") { var arr = Array.isArray(value) ? value.map(String) : [String(value)]; return arr.length ? arr : null; }
    if (t === "number" || t === "scale") { var n = Number(value); return isNaN(n) ? null : n; }
    return String(value);
  }
  function commit(id, patch, source) {
    var question = q(id);
    if (!question) { post({ type: "error", message: "KQA: unknown question id \"" + id + "\" (it is not in the manifest)." }); return false; }
    if (state.locked) return false;
    var cur = state.answers[id] || {};
    var next = { value: cur.value, note: cur.note };
    var changed = false;
    if ("value" in patch) {
      var nv = normalise(question, patch.value);
      if (question.type === "rank" && nv !== null) {
        var rankOptions = (question.options || []).map(function (option) { return option.value; });
        var validRank = Array.isArray(nv) && nv.length === rankOptions.length && new Set(nv).size === rankOptions.length && nv.every(function (value) { return rankOptions.indexOf(value) !== -1; });
        if (!validRank) {
          var rankMessage = localized("rankError");
          if (source === "dom") writeDom(id);
          var rankLists = controls(id);
          var rankLive = rankLists.length && rankLists[0].parentElement.querySelector('[data-kqa-rank-status="' + id + '"]');
          if (rankLive) rankLive.textContent = rankMessage;
          emit("validation", { id: id, valid: false, message: rankMessage });
          return false;
        }
      }
      if (question.type === "multi" && nv !== null && (question.exclusiveOptions || []).length) {
        var exclusiveValues = question.exclusiveOptions || [];
        var exclusiveCount = function (value) {
          if (!Array.isArray(value)) return 0;
          var unique = Array.from(new Set(value));
          var count = unique.filter(function (item) { return exclusiveValues.indexOf(item) !== -1; }).length;
          return count * (unique.length - 1);
        };
        var conflict = exclusiveCount(nv);
        if (conflict > 0 && (source !== "dom" || conflict >= exclusiveCount(cur.value))) {
          var exclusiveMessage = localized("exclusiveError");
          if (source === "dom") writeDom(id);
          exclusiveSelectionMessage(id, true);
          emit("validation", { id: id, valid: false, message: exclusiveMessage });
          return false;
        }
      }
      var selected = Array.isArray(nv) ? new Set(nv).size : 0;
      if (question.type === "multi" && question.maxSelections !== undefined && selected > question.maxSelections) {
        var previousSelected = Array.isArray(cur.value) ? new Set(cur.value).size : 0;
        if (source !== "dom" || previousSelected <= question.maxSelections || selected >= previousSelected) {
          var message = selectionLimitMessage(question);
          if (source === "dom") writeDom(id);
          selectionLimitError(id, message);
          emit("validation", { id: id, valid: false, message: message });
          return false;
        }
        var message = localized("removeChoices", { count: selected - question.maxSelections });
        selectionLimitError(id, message);
      } else {
        selectionLimitError(id, null);
      }
      if (!equal(nv, cur.value === undefined ? null : cur.value)) { next.value = nv === null ? undefined : nv; changed = true; }
    }
    if ("note" in patch) {
      var nn = patch.note === "" || patch.note === null || patch.note === undefined ? undefined : String(patch.note);
      if (nn !== cur.note) { next.note = nn; changed = true; }
    }
    if (!changed) return true;
    if (next.value === undefined && next.note === undefined) delete state.answers[id]; else state.answers[id] = next;
    if (source !== "dom") writeDom(id); else writeStatus(id);
    if (question.type === "multi") exclusiveSelectionMessage(id, Array.isArray(next.value) && next.value.some(function (item) { return (question.exclusiveOptions || []).indexOf(item) !== -1; }) && new Set(next.value).size > 1);
    var msg = { type: "set", id: id };
    if ("value" in patch) msg.value = next.value === undefined ? null : next.value;
    if ("note" in patch) msg.note = next.note === undefined ? null : next.note;
    post(msg);
    updateEligibility(true);
    emit("change", { id: id, value: next.value, note: next.note, source: source });
    emit("validation", { id: id, valid: true, message: null });
    return true;
  }
  function writeStatus(id) {
    var statuses = document.querySelectorAll("[data-kqa-status]");
    for (var i = 0; i < statuses.length; i++) if (statuses[i].getAttribute("data-kqa-status") === id) statuses[i].setAttribute("data-state", isAnswered(id) ? "answered" : "empty");
    updateRankConfirmation(id);
  }

  // Conditional questions depend on earlier answers. Hiding a block never
  // clears its answer; the answer can become eligible again if its parent changes.
  function conditionMatches(condition, eligible) {
    if (!condition || typeof condition.question !== "string" || !eligible[condition.question]) return false;
    var sourceQuestion = q(condition.question);
    var actual = answerOf(condition.question).value;
    var answered = sourceQuestion && sourceQuestion.type === "repeat"
      ? isAnswered(condition.question)
      : actual !== undefined && actual !== null && (Array.isArray(actual) ? actual.length > 0 : typeof actual === "string" ? actual.trim() !== "" : true);
    if (condition.operator === "answered") return answered;
    if (condition.operator === "notAnswered") return !answered;
    if (actual === undefined || actual === null) return false;
    var expected = condition.value;
    if (condition.operator === "lt" || condition.operator === "lte" || condition.operator === "gt" || condition.operator === "gte" || condition.operator === "eq" || condition.operator === "ne") {
      var source = q(condition.question);
      if (!source || !typedValueIsUsable(source, actual, expected)) return false;
      switch (condition.operator) {
        case "lt": return actual < expected;
        case "lte": return actual <= expected;
        case "gt": return actual > expected;
        case "gte": return actual >= expected;
        case "eq": return actual === expected;
        case "ne": return actual !== expected;
      }
      return false;
    }
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
  function isCalendarDate(value) {
    if (typeof value !== "string") return false;
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
  }
  function typedValueIsUsable(question, actual, expected) {
    if (question.type === "date") return isCalendarDate(actual) && isCalendarDate(expected);
    if (question.type !== "number" && question.type !== "scale") return false;
    if (typeof actual !== "number" || !isFinite(actual) || typeof expected !== "number" || !isFinite(expected)) return false;
    if (question.type === "scale" && (!Number.isInteger(actual) || !Number.isInteger(expected))) return false;
    if (typeof question.min === "number" && actual < question.min) return false;
    if (typeof question.max === "number" && actual > question.max) return false;
    if (question.type === "scale") {
      var min = typeof question.min === "number" ? question.min : 1;
      var max = typeof question.max === "number" ? question.max : 5;
      return actual >= min && actual <= max && expected >= min && expected <= max;
    }
    return true;
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
      var questionIsInactiveStep = state.guidedQuestionMode ? question.id !== state.guidedQuestion : question.section !== state.guidedSection;
      var shouldHide = !eligible[question.id] || (state.guided && questionIsInactiveStep) || block.getAttribute("data-kqa-condition-hidden") === "1";
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
    var wasInitialized = state.eligibilityReady;
    var previous = state.eligibility || {};
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
    state.eligibilityReady = true;
    if (announce && changed) {
      post({ type: "eligibility", eligible: eligible });
      emit("eligibility", eligibilityCopy());
      if (wasInitialized) announceEligibility(previous, eligible);
    }
  }
  function announceEligibility(previous, current) {
    var shown = 0;
    var hidden = 0;
    state.questions.forEach(function (question) {
      var before = previous[question.id] !== false;
      var after = current[question.id] !== false;
      if (before && !after) hidden++;
      else if (!before && after) shown++;
    });
    if (!shown && !hidden) return;
    var status = ensureRoutingStatus();
    var parts = [];
    if (shown) parts.push(localized("questionShown", { count: shown }));
    if (hidden) parts.push(localized("questionHidden", { count: hidden }));
    status.textContent = parts.join(" ");
  }
  function ensureRoutingStatus() {
    if (routingStatusNode) return routingStatusNode;
    var status = document.createElement("div");
    markLocalized(status);
    status.id = "kqa-routing-status";
    status.setAttribute("data-kqa-routing-status", "");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-atomic", "true");
    status.style.cssText = "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
    (document.body || document.documentElement).appendChild(status);
    routingStatusNode = status;
    return routingStatusNode;
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
    if (id !== null && q(id)) {
      var question = q(id);
      updateLengthFeedback(id, true);
      var nativeTextQuestion = (question.type === "text" || question.type === "longtext") && typeof el.value === "string";
      if (nativeTextQuestion && el.value.length > lengthLimit(question, false)) {
        retainLengthDraft(id, false, el, true);
        return;
      }
      var exclusiveAnnouncement = "";
      if (question.type === "multi" && el.type === "checkbox" && el.checked && (question.exclusiveOptions || []).length) {
        var exclusive = question.exclusiveOptions.indexOf(el.value) !== -1;
        var changedOthers = false;
        controls(id).forEach(function (control) {
          if (!control.checked || control === el) return;
          if (exclusive || question.exclusiveOptions.indexOf(control.value) !== -1) { control.checked = false; changedOthers = true; }
        });
        if (changedOthers) {
          exclusiveAnnouncement = exclusive ? localized("exclusiveSelected") : localized("exclusiveCleared");
        }
      }
      var accepted = commit(id, { value: readDom(id) }, "dom");
      if (accepted && nativeTextQuestion) retainLengthDraft(id, false, el, false);
      if (exclusiveAnnouncement) {
        var statusEls = controls(id);
        var host = statusEls[0] && statusEls[0].closest ? statusEls[0].closest("fieldset") : null;
        var live = host && host.parentElement && host.parentElement.querySelector('[data-kqa-exclusive-status="' + id + '"]');
        if (live) { live.textContent = exclusiveAnnouncement; setTimeout(function () { if (live && live.getAttribute("role") === "status") live.textContent = ""; }, 2500); }
      }
      return;
    }
    var nid = el.getAttribute("data-kqa-note");
    if (nid !== null && q(nid)) {
      updateLengthFeedback(nid, true);
      if (el.value.length > lengthLimit(q(nid), true)) { retainLengthDraft(nid, true, el, true); return; }
      var acceptedNote = commit(nid, { note: el.value }, "dom");
      if (acceptedNote) retainLengthDraft(nid, true, el, false);
    }
  }
  document.addEventListener("input", onControl, true);
  document.addEventListener("change", onControl, true);
  document.addEventListener("click", function (ev) {
    var confirm = ev.target && ev.target.closest ? ev.target.closest("button[data-kqa-rank-confirm]") : null;
    if (confirm) {
      var confirmId = confirm.getAttribute("data-kqa-rank-confirm");
      if (!q(confirmId) || q(confirmId).type !== "rank" || state.locked) return;
      ev.preventDefault();
      if (commit(confirmId, { value: readDom(confirmId) }, "dom")) {
        var listForFocus = controls(confirmId)[0];
        var nextFocus = listForFocus && listForFocus.querySelector('button[data-kqa-rank-move="down"]');
        if (nextFocus) nextFocus.focus();
      }
      return;
    }
    var button = ev.target && ev.target.closest ? ev.target.closest("button[data-kqa-rank-move]") : null;
    if (!button) return;
    var list = button.closest("ol[data-kqa]");
    var id = list && list.getAttribute("data-kqa");
    var question = id && q(id);
    if (!question || question.type !== "rank" || state.locked) return;
    ev.preventDefault();
    var item = button.parentElement;
    var direction = button.getAttribute("data-kqa-rank-move");
    var sibling = direction === "up" ? item.previousElementSibling : item.nextElementSibling;
    if (!sibling || sibling.tagName !== "LI") return;
    if (direction === "up") list.insertBefore(item, sibling); else list.insertBefore(sibling, item);
    refreshRankControls(id);
    var rankStatus = list.parentElement.querySelector('[data-kqa-rank-status="' + id + '"]');
    var position = rankItems(id).indexOf(item) + 1;
    if (rankStatus) rankStatus.textContent = localized("rankMoved", { label: item.getAttribute("data-kqa-rank-label"), index: position, total: rankItems(id).length });
    commit(id, { value: readDom(id) }, "dom");
    var focusTarget = button;
    if (focusTarget.disabled) {
      var opposite = direction === "up" ? "down" : "up";
      var fallback = item.querySelector('button[data-kqa-rank-move="' + opposite + '"]');
      if (fallback && !fallback.disabled) focusTarget = fallback;
    }
    focusTarget.focus();
  }, true);

  // ---- messages from the app
  function applyAnswers(map) {
    state.answers = {};
    Object.keys(map || {}).forEach(function (id) {
      var a = map[id] || {};
      state.answers[id] = { value: a.value === null ? undefined : a.value, note: a.note === null ? undefined : a.note };
    });
    writeAll();
    state.questions.forEach(function (question) {
      var value = answerOf(question.id).value;
      if (question.type === "rank" && value !== undefined && value !== null && !isAnswered(question.id)) {
        var rankLists = controls(question.id);
        var rankLive = rankLists.length && rankLists[0].parentElement.querySelector('[data-kqa-rank-status="' + question.id + '"]');
        if (rankLive) rankLive.textContent = localized("rankChanged");
        emit("validation", { id: question.id, valid: false, message: localized("rankError") });
      }
      if (question.type === "multi" && Array.isArray(value)) exclusiveSelectionMessage(question.id, value.some(function (item) { return (question.exclusiveOptions || []).indexOf(item) !== -1; }) && new Set(value).size > 1);
      if (question.type === "multi" && question.maxSelections !== undefined && Array.isArray(value) && new Set(value).size > question.maxSelections) {
        var message = localized("savedMaxSelections", { selected: new Set(value).size, maximum: question.maxSelections });
        selectionLimitError(question.id, message);
        emit("validation", { id: question.id, valid: false, message: message });
      }
    });
  }
  window.addEventListener("message", function (ev) {
    if (ev.source !== parent) return;
    var m = ev.data;
    if (!m || m.kqa !== 1) return;
    if (m.type === "init") {
      state.locale = typeof m.locale === "string" ? m.locale : "en-AU";
      state.messages = m.messages || {};
      state.questions = m.questions || [];
      state.qmap = {};
      state.questions.forEach(function (x) { state.qmap[x.id] = x; });
      applyQuestionOrderGroups(m.questionOrderGroups, m.questionOrderAssignment);
      reorderResponseOptions();
      state.questions.forEach(function (question) {
        if (question.type === "text" || question.type === "longtext") controls(question.id).forEach(function (control) { control.removeAttribute("maxlength"); });
        noteControls(question.id).forEach(function (control) { control.removeAttribute("maxlength"); });
      });
      state.participant = m.participant || null;
      state.probe = !!m.probe;
      state.preview = !!m.preview;
      state.guided = !!m.guided;
      state.guidedSection = typeof m.guidedSection === "string" ? m.guidedSection : null;
      state.guidedQuestion = typeof m.guidedQuestion === "string" ? m.guidedQuestion : null;
      state.guidedQuestionMode = !!m.guidedQuestionMode;
      state.locked = !!m.locked;
      state.ready = true;
      ensureRoutingStatus();
      applySelectionLimitGuidance();
      applyRankControls();
      applyAnswers(m.answers);
      applyRecordGroups(m.recordGroups);
      updateEligibility(true);
      applyLock();
      readyResolve(snapshot());
      emit("ready", snapshot());
      if (state.probe) setTimeout(runProbe, 60);
    } else if (m.type === "locale") {
      state.locale = typeof m.locale === "string" ? m.locale : state.locale;
      state.messages = m.messages || state.messages;
      updateRecordLocalization();
      applySelectionLimitGuidance();
      applyRankControls();
      state.questions.forEach(function (question) {
        updateLengthFeedback(question.id, false);
        var value = answerOf(question.id).value;
        var selected = Array.isArray(value) ? new Set(value).size : 0;
        selectionLimitError(question.id, question.type === "multi" && question.maxSelections !== undefined && selected > question.maxSelections ? localized("savedMaxSelections", { selected: selected, maximum: question.maxSelections }) : null);
        if (question.type === "multi") exclusiveSelectionMessage(question.id, Array.isArray(value) && value.some(function (item) { return (question.exclusiveOptions || []).indexOf(item) !== -1; }) && selected > 1);
        if (question.type === "rank" && value !== undefined && value !== null && !isAnswered(question.id)) {
          var rankLists = controls(question.id);
          var rankLive = rankLists.length && rankLists[0].parentElement.querySelector('[data-kqa-rank-status="' + question.id + '"]');
          if (rankLive) { markLocalized(rankLive); rankLive.textContent = localized("rankChanged"); }
        }
      });
    } else if (m.type === "answers") {
      applyAnswers(m.answers);
      restoreLengthDrafts();
      updateEligibility(true);
      state.questions.forEach(function (x) { emit("change", { id: x.id, value: answerOf(x.id).value, note: answerOf(x.id).note, source: "app" }); });
    } else if (m.type === "record-groups") {
      applyRecordGroups(m.recordGroups, m.ackOperationIds);
      updateEligibility(true);
    } else if (m.type === "record-rejected") {
      rejectRecordOperations(m);
      updateEligibility(true);
    } else if (m.type === "lock") {
      state.locked = !!m.locked;
      applyLock();
      emit("lock", { locked: state.locked });
    } else if (m.type === "offline") {
      if (state.ready && !state.locked) setHtmlState(m.offline ? "offline" : "ready");
    } else if (m.type === "clear-answer" && typeof m.id === "string") {
      commit(m.id, { value: null }, "script");
    } else if (m.type === "clear-note" && typeof m.id === "string") {
      commit(m.id, { note: null }, "script");
    } else if (m.type === "guided") {
      state.guided = !!m.enabled;
      state.guidedSection = typeof m.section === "string" ? m.section : null;
      state.guidedQuestion = m.enabled && typeof m.question === "string" ? m.question : null;
      state.guidedQuestionMode = m.enabled && !!m.questionMode;
      state.questions.forEach(function (question) { setConditionalVisibility(question, state.eligibility || {}); });
    } else if (m.type === "focus-question" && typeof m.id === "string") {
      var targetQuestion = q(m.id);
      if (targetQuestion && state.guided && state.guidedQuestionMode) {
        state.guidedQuestion = targetQuestion.id;
        state.guidedSection = typeof targetQuestion.section === "string" ? targetQuestion.section : "__unsectioned";
        state.questions.forEach(function (question) { setConditionalVisibility(question, state.eligibility || {}); });
      } else if (targetQuestion && state.guided && state.guidedSection !== targetQuestion.section) {
        state.guidedSection = targetQuestion.section;
        state.questions.forEach(function (question) { setConditionalVisibility(question, state.eligibility || {}); });
      }
      focusQuestion(m.id);
    }
  });

  function snapshot() { return { answers: answersCopy(), locked: state.locked, questions: state.questions.slice(), participant: state.participant }; }

  /** Match native controls to the stable option order supplied by the respondent API. */
  function reorderResponseOptions() {
    state.questions.forEach(function (question) {
      if (!question.randomizeOptions || !question.options || !question.options.length) return;
      var controls = controlsForQuestion(question.id);
      if (!controls.length) return;
      if (question.type === "select" && controls[0].tagName === "SELECT") {
        var select = controls[0];
        var optionByValue = {};
        Array.prototype.slice.call(select.options).forEach(function (option) { if (option.value) optionByValue[option.value] = option; });
        question.options.forEach(function (option) { if (optionByValue[option.value]) select.appendChild(optionByValue[option.value]); });
        return;
      }
      var rows = [];
      controls.forEach(function (control) {
        var input = control;
        var label = input.closest("label");
        if (label) rows.push({ value: input.value, label: label });
      });
      if (!rows.length || rows.some(function (row) { return row.label.parentElement !== rows[0].label.parentElement; })) return;
      var parent = rows[0].label.parentElement;
      if (!parent) return;
      question.options.forEach(function (option) {
        var row = rows.find(function (item) { return item.value === option.value; });
        if (row) parent.appendChild(row.label);
      });
    });
  }
  function applyQuestionOrderGroups(groups, assignment) {
    if (!Array.isArray(groups) || !assignment || !assignment.groups) return;
    groups.forEach(function (group) {
      if (!group || typeof group.id !== "string" || !Array.isArray(group.questionIds) || group.questionIds.length < 2) return;
      var assigned = assignment.groups[group.id];
      if (!Array.isArray(assigned) || assigned.length !== group.questionIds.length) return;
      var expected = new Set(group.questionIds);
      if (expected.size !== group.questionIds.length || new Set(assigned).size !== expected.size || assigned.some(function (id) { return !expected.has(id); })) return;
      var section = state.qmap[group.questionIds[0]] && state.qmap[group.questionIds[0]].section || "";
      if (group.questionIds.some(function (id) { return !state.qmap[id] || (state.qmap[id].section || "") !== section || state.qmap[id].when || state.qmap[id].custom === true; })) return;
      var blocks = {};
      var allBlocks = document.querySelectorAll("[data-kqa-question-id]");
      for (var i = 0; i < group.questionIds.length; i++) {
        var id = group.questionIds[i];
        var matched = [];
        for (var j = 0; j < allBlocks.length; j++) if (allBlocks[j].getAttribute("data-kqa-question-id") === id) matched.push(allBlocks[j]);
        if (matched.length !== 1) return;
        blocks[id] = matched[0];
      }
      var parent = blocks[group.questionIds[0]].parentElement;
      if (!parent || parent.getAttribute("data-kqa-question-list") !== section || group.questionIds.some(function (id) { return blocks[id].parentElement !== parent; })) return;
      var wrappersInDom = [];
      var wrapperPositions = [];
      for (var k = 0; k < parent.children.length; k++) {
        var childId = parent.children[k].getAttribute("data-kqa-question-id");
        if (childId !== null && expected.has(childId)) { wrappersInDom.push(childId); wrapperPositions.push(k); }
      }
      var wrapperRun = wrapperPositions.length === group.questionIds.length && wrapperPositions[wrapperPositions.length - 1] - wrapperPositions[0] + 1 === wrapperPositions.length;
      var childNodes = Array.prototype.slice.call(parent.childNodes);
      var nodePositions = group.questionIds.map(function (id) { return childNodes.indexOf(blocks[id]); });
      var onlyTriviaBetween = nodePositions.every(function (position) { return position >= 0; });
      if (onlyTriviaBetween) {
        var start = Math.min.apply(Math, nodePositions);
        var end = Math.max.apply(Math, nodePositions);
        onlyTriviaBetween = childNodes.slice(start + 1, end).every(function (node) {
          if (node.nodeType === 1) return expected.has(node.getAttribute("data-kqa-question-id"));
          if (node.nodeType === 3) return !node.nodeValue.trim();
          return node.nodeType === 8;
        });
      }
      if (!wrapperRun || !onlyTriviaBetween || wrappersInDom.length !== group.questionIds.length || wrappersInDom.some(function (id, index) { return id !== group.questionIds[index]; })) return;
      var placeholders = [];
      group.questionIds.forEach(function (id) {
        var placeholder = document.createComment("kqa-order");
        parent.replaceChild(placeholder, blocks[id]);
        placeholders.push(placeholder);
      });
      assigned.forEach(function (id, index) { parent.replaceChild(blocks[id], placeholders[index]); });
    });
  }
  function controlsForQuestion(id) { return controls(id); }
  function answersCopy() {
    var out = {};
    Object.keys(state.answers).forEach(function (id) { out[id] = { value: state.answers[id].value, note: state.answers[id].note }; });
    return out;
  }

  // Repeat-group wire contract: init.recordGroups is a RepeatRecordMap keyed by
  // repeat question id. Each user action emits {type:"record-operation", operation}.
  // Successful host persistence should echo an authoritative snapshot with
  // {type:"record-groups", recordGroups}; newer row/field revisions identify
  // concurrent edits and preserve the respondent's rejected value for review.
  function recordTemplate(questionId) {
    var all = document.querySelectorAll("template[data-kqa-repeat-template]");
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute("data-kqa-repeat-template") === questionId) return all[i];
    return null;
  }
  function recordField(question, fieldId) {
    var fields = question.fields || [];
    for (var i = 0; i < fields.length; i++) if (fields[i].id === fieldId) return fields[i];
    return null;
  }
  function recordRows(questionId) { if (!state.recordGroups[questionId]) state.recordGroups[questionId] = []; return state.recordGroups[questionId]; }
  function recordMinimum(question) { return Math.max(question.required ? 1 : 0, typeof question.minRows === "number" ? question.minRows : 0); }
  function itemLabel(question) { return question.itemLabel || "item"; }
  function uniqueRecordId() {
    var bytes = new Uint8Array(16);
    try { window.crypto.getRandomValues(bytes); }
    catch (e) { for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256); }
    var out = "r";
    for (var j = 0; j < bytes.length; j++) out += ("0" + bytes[j].toString(16)).slice(-2);
    return out;
  }
  function rowFieldControls(row, fieldId) {
    var all = row.querySelectorAll("[data-kqa-repeat-field]");
    var out = [];
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute("data-kqa-repeat-field") === fieldId) out.push(all[i]);
    return out;
  }
  function valueForRecordField(field, controls) {
    if (field.type === "single" || (field.type === "scale" && controls[0] && controls[0].type === "radio")) {
      for (var i = 0; i < controls.length; i++) if (controls[i].checked) return field.type === "scale" ? Number(controls[i].value) : controls[i].value;
      return null;
    }
    var el = controls[0];
    if (!el) return null;
    if (field.type === "number" || field.type === "scale") return el.value === "" ? null : Number(el.value);
    return el.value === "" ? null : el.value;
  }
  function writeRecordField(field, controls, value) {
    controls.forEach(function (el) {
      if (field.required) { el.setAttribute("required", "required"); el.setAttribute("aria-required", "true"); }
      else { el.removeAttribute("required"); el.removeAttribute("aria-required"); }
      if (field.type === "single" || (field.type === "scale" && el.type === "radio")) el.checked = value !== undefined && value !== null && String(value) === el.value;
      else if (el.tagName === "SELECT") el.value = value === undefined || value === null ? "" : String(value);
      else if (el.type === "range") { if (value !== undefined && value !== null) el.value = String(value); }
      else el.value = value === undefined || value === null ? "" : String(value);
    });
  }
  function showRecordFieldError(row, fieldId, message) {
    var controls = rowFieldControls(row, fieldId);
    var errorId = "kqa-repeat-error-" + row.getAttribute("data-kqa-record-question") + "-" + row.getAttribute("data-kqa-record-row") + "-" + fieldId;
    var error = row.querySelector('[data-kqa-repeat-error="' + fieldId + '"]');
    if (!error) {
      error = document.createElement("p");
      error.id = errorId;
      error.setAttribute("data-kqa-repeat-error", fieldId);
      error.setAttribute("role", "alert");
      error.setAttribute("aria-live", "polite");
      var last = controls[controls.length - 1];
      if (last) last.insertAdjacentElement("afterend", error); else row.appendChild(error);
    }
    markLocalized(error);
    error.textContent = message;
    controls.forEach(function (control) { control.setAttribute("aria-invalid", "true"); appendDescription(control, error.id, true); });
  }
  function clearRecordFieldError(row, fieldId) {
    var error = row.querySelector('[data-kqa-repeat-error="' + fieldId + '"]');
    var controls = rowFieldControls(row, fieldId);
    if (error) error.remove();
    controls.forEach(function (control) { control.removeAttribute("aria-invalid"); if (error) appendDescription(control, error.id, false); });
  }
  function updateRecordButtons(question, list, addButton) {
    var rows = recordRows(question.id);
    var minRows = recordMinimum(question);
    addButton.disabled = state.locked || rows.length >= question.maxRows;
    var removeButtons = list.querySelectorAll("button[data-kqa-record-remove]");
    for (var i = 0; i < removeButtons.length; i++) removeButtons[i].disabled = state.locked || rows.length <= minRows;
  }
  function buildRecordRow(question, rowData, list) {
    var template = recordTemplate(question.id);
    if (!template || !template.content) return null;
    var fragment = template.content.cloneNode(true);
    var row = fragment.querySelector("fieldset");
    if (!row) return null;
    row.setAttribute("data-kqa-record-row", rowData.id);
    row.setAttribute("data-kqa-generated-row", question.id);
    row.setAttribute("data-kqa-record-question", question.id);
    row.setAttribute("tabindex", "-1");
    var suffix = "-" + question.id + "-" + rowData.id;
    var idMap = {};
    var identified = row.querySelectorAll("[id]");
    for (var i = 0; i < identified.length; i++) {
      var oldId = identified[i].id;
      idMap[oldId] = oldId + suffix;
      identified[i].id = idMap[oldId];
    }
    var refs = row.querySelectorAll("[for], [aria-labelledby], [aria-describedby], [aria-controls]");
    for (var j = 0; j < refs.length; j++) {
      ["for", "aria-labelledby", "aria-describedby", "aria-controls"].forEach(function (name) {
        if (!refs[j].hasAttribute(name)) return;
        refs[j].setAttribute(name, refs[j].getAttribute(name).split(/\s+/).map(function (id) { return idMap[id] || id; }).join(" "));
      });
    }
    var rowIndex = recordRows(question.id).findIndex(function (item) { return item.id === rowData.id; }) + 1;
    var legend = row.querySelector("legend");
    if (legend) { markLocalized(legend); legend.textContent = localized("repeatRowLabel", { item: itemLabel(question), index: rowIndex }); }
    (question.fields || []).forEach(function (field) {
      var controls = rowFieldControls(row, field.id);
      controls.forEach(function (control) {
        control.setAttribute("data-kqa-repeat-row", rowData.id);
        control.setAttribute("data-kqa-repeat-question", question.id);
        if (field.type === "single" || (field.type === "scale" && control.type === "radio")) control.name = "kqa-repeat-" + question.id + "-" + rowData.id + "-" + field.id;
      });
      var draftKey = question.id + "/" + rowData.id + "/" + field.id;
      var draft = recordDrafts[draftKey];
      writeRecordField(field, controls, draft ? draft.value : rowData.values && rowData.values[field.id]);
      if (draft) showRecordFieldError(row, field.id, draft.message || localized("repeatFieldInvalid"));
    });
    var remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("data-kqa-record-remove", rowData.id);
    remove.setAttribute("data-kqa-record-question", question.id);
    markLocalized(remove);
    remove.textContent = localized("repeatRemove", { item: itemLabel(question), index: rowIndex });
    remove.setAttribute("aria-label", localized("repeatRemove", { item: itemLabel(question), index: rowIndex }));
    remove.style.cssText = "min-height:44px;padding:8px 12px;margin-top:8px;font:inherit";
    row.appendChild(remove);
    list.appendChild(fragment);
    return row;
  }
  function renderRecordQuestion(question) {
    if (question.type !== "repeat") return;
    var template = recordTemplate(question.id);
    if (!template || !template.parentNode) return;
    var list = template.parentNode.querySelector('[data-kqa-record-list="' + question.id + '"]');
    if (!list) {
      list = document.createElement("div");
      list.setAttribute("data-kqa-record-list", question.id);
      list.setAttribute("role", "group");
      list.setAttribute("aria-label", question.label);
      template.insertAdjacentElement("afterend", list);
    }
    while (list.firstChild) list.removeChild(list.firstChild);
    recordRows(question.id).forEach(function (row) { buildRecordRow(question, row, list); });
    var status = list.querySelector('[data-kqa-record-status="' + question.id + '"]');
    if (!status) {
      status = document.createElement("span");
      status.setAttribute("data-kqa-record-status", question.id);
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.setAttribute("aria-atomic", "true");
      status.style.cssText = "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
      list.appendChild(status);
    }
    if (recordAnnouncements[question.id]) status.textContent = recordAnnouncements[question.id];
    var add = template.parentNode.querySelector('[data-kqa-record-add="' + question.id + '"]');
    if (!add) {
      add = document.createElement("button");
      add.type = "button";
      add.setAttribute("data-kqa-record-add", question.id);
      add.style.cssText = "min-height:44px;padding:8px 12px;margin-top:8px;font:inherit";
      list.insertAdjacentElement("afterend", add);
    }
    markLocalized(add);
    add.textContent = localized("repeatAdd", { item: itemLabel(question) });
    add.setAttribute("aria-label", localized("repeatAdd", { item: itemLabel(question) }));
    updateRecordButtons(question, list, add);
  }
  function renderRecordGroups() { state.questions.forEach(renderRecordQuestion); }
  function updateRecordLocalization() {
    state.questions.forEach(function (question) {
      if (question.type !== "repeat") return;
      var rows = recordRows(question.id);
      var add = document.querySelector('[data-kqa-record-add="' + question.id + '"]');
      if (add) { markLocalized(add); add.textContent = localized("repeatAdd", { item: itemLabel(question) }); add.setAttribute("aria-label", add.textContent); }
      rows.forEach(function (row, index) {
        var node = document.querySelector('fieldset[data-kqa-record-question="' + question.id + '"][data-kqa-record-row="' + row.id + '"]');
        if (!node) return;
        var label = localized("repeatRowLabel", { item: itemLabel(question), index: index + 1 });
        var legend = node.querySelector("legend");
        if (legend) { markLocalized(legend); legend.textContent = label; }
        var remove = node.querySelector("button[data-kqa-record-remove]");
        if (remove) { markLocalized(remove); remove.textContent = localized("repeatRemove", { item: itemLabel(question), index: index + 1 }); remove.setAttribute("aria-label", remove.textContent); }
      });
    });
  }
  function applyRecordGroups(groups, ackOperationIds) {
    var active = document.activeElement;
    var focusState = null;
    if (active && active.getAttribute) {
      var activeRow = active.closest && active.closest("fieldset[data-kqa-record-row]");
      if (activeRow) focusState = {
        questionId: activeRow.getAttribute("data-kqa-record-question"), rowId: activeRow.getAttribute("data-kqa-record-row"),
        fieldId: active.getAttribute("data-kqa-repeat-field"), remove: active.hasAttribute("data-kqa-record-remove"),
        start: typeof active.selectionStart === "number" ? active.selectionStart : null,
        end: typeof active.selectionEnd === "number" ? active.selectionEnd : null,
      };
    }
    var previousGroups = state.recordGroups;
    var next = {};
    Object.keys(previousGroups || {}).forEach(function (id) { next[id] = (previousGroups[id] || []).map(function (row) { return { id: row.id, values: Object.assign({}, row.values || {}), revision: Number(row.revision) || 0, fieldRevisions: Object.assign({}, row.fieldRevisions || {}) }; }); });
    Object.keys(groups || {}).forEach(function (id) {
      next[id] = (groups[id] || []).map(function (row) {
        return { id: row.id, values: Object.assign({}, row.values || {}), revision: Number(row.revision) || 0, fieldRevisions: Object.assign({}, row.fieldRevisions || {}) };
      });
    });
    var remaining = [];
    var acknowledged = Array.isArray(ackOperationIds) ? ackOperationIds : [];
    pendingRecordOperations.forEach(function (operation) {
      if (operation.operationId && acknowledged.indexOf(operation.operationId) >= 0) return;
      var rows = next[operation.questionId] || [];
      var row = rows.find(function (item) { return item.id === operation.rowId; });
      if (operation.op === "add") {
        if (!row) {
          var local = recordRows(operation.questionId).find(function (item) { return item.id === operation.rowId; });
          if (local) { if (!next[operation.questionId]) next[operation.questionId] = []; next[operation.questionId].push(local); }
          remaining.push(operation);
        }
      } else if (operation.op === "remove") {
        if (!row) return;
        if (row.revision > operation.expectedRowRevision) {
          var list = document.querySelector('[data-kqa-record-list="' + operation.questionId + '"]');
          var status = list && list.querySelector('[data-kqa-record-status="' + operation.questionId + '"]');
          recordAnnouncements[operation.questionId] = localized("repeatConflict", { item: itemLabel(q(operation.questionId)) });
          if (status) status.textContent = recordAnnouncements[operation.questionId];
          return;
        }
        rows.splice(rows.indexOf(row), 1);
        remaining.push(operation);
      } else {
        if (!row) return;
        var serverFieldRevision = Number(row.fieldRevisions[operation.fieldId]) || 0;
        if (serverFieldRevision > operation.expectedFieldRevision) {
          var draftKey = operation.questionId + "/" + operation.rowId + "/" + operation.fieldId;
          recordDrafts[draftKey] = { value: operation.op === "clear" ? undefined : operation.value, message: localized("repeatConflict", { item: itemLabel(q(operation.questionId)) }) };
          var list = document.querySelector('[data-kqa-record-list="' + operation.questionId + '"]');
          var status = list && list.querySelector('[data-kqa-record-status="' + operation.questionId + '"]');
          recordAnnouncements[operation.questionId] = localized("repeatConflict", { item: itemLabel(q(operation.questionId)) });
          if (status) status.textContent = recordAnnouncements[operation.questionId];
          return;
        }
        if (operation.op === "clear") delete row.values[operation.fieldId]; else row.values[operation.fieldId] = operation.value;
        row.fieldRevisions[operation.fieldId] = operation.expectedFieldRevision + 1;
        var previousRow = (previousGroups[operation.questionId] || []).find(function (item) { return item.id === operation.rowId; });
        row.revision = Math.max(row.revision, previousRow ? previousRow.revision : 0);
        remaining.push(operation);
      }
    });
    state.recordGroups = next;
    pendingRecordOperations = remaining;
    renderRecordGroups();
    if (focusState) {
      var focusSelector = focusState.fieldId
        ? '[data-kqa-repeat-question="' + focusState.questionId + '"][data-kqa-repeat-row="' + focusState.rowId + '"][data-kqa-repeat-field="' + focusState.fieldId + '"]'
        : focusState.remove
          ? 'button[data-kqa-record-remove="' + focusState.rowId + '"]'
          : 'fieldset[data-kqa-record-question="' + focusState.questionId + '"][data-kqa-record-row="' + focusState.rowId + '"]';
      var focusTarget = document.querySelector(focusSelector);
      if (focusTarget) {
        try { focusTarget.focus({ preventScroll: true }); } catch (e) { focusTarget.focus(); }
        if (focusState.start !== null && typeof focusTarget.setSelectionRange === "function") {
          try { focusTarget.setSelectionRange(focusState.start, focusState.end); } catch (e) {}
        }
      }
    }
  }
  function rejectRecordOperations(message) {
    var rejected = Array.isArray(message.rejectedOperationIds) ? message.rejectedOperationIds : [];
    var errors = Array.isArray(message.recordErrors) ? message.recordErrors : [];
    pendingRecordOperations.forEach(function (operation) {
      if (!operation.operationId || rejected.indexOf(operation.operationId) < 0) return;
      var issue = errors.find(function (item) { return item.questionId === operation.questionId && (!item.rowId || item.rowId === operation.rowId) && (!item.fieldId || item.fieldId === operation.fieldId); });
      if (operation.op === "set" || operation.op === "clear") {
        var draftKey = operation.questionId + "/" + operation.rowId + "/" + operation.fieldId;
        recordDrafts[draftKey] = { value: operation.op === "clear" ? undefined : operation.value, message: localized("repeatFieldInvalid") };
      }
      recordAnnouncements[operation.questionId] = localized("repeatConflict", { item: itemLabel(q(operation.questionId)) });
      if (issue && issue.reason && operation.op === "set") recordDrafts[operation.questionId + "/" + operation.rowId + "/" + operation.fieldId].message = localized("repeatFieldInvalid");
    });
    pendingRecordOperations = pendingRecordOperations.filter(function (operation) { return !operation.operationId || rejected.indexOf(operation.operationId) < 0; });
    applyRecordGroups(message.recordGroups || {});
  }
  var recordOperationSequence = 0;
  function sendRecordOperation(operation) {
    recordOperationSequence += 1;
    var operationId = "ro" + recordOperationSequence + "-" + uniqueRecordId();
    pendingRecordOperations.push(Object.assign({}, operation, { operationId: operationId }));
    post({ type: "record-operation", operation: operation, operationId: operationId });
  }
  function addRecordRow(question) {
    var rows = recordRows(question.id);
    if (state.locked || rows.length >= question.maxRows) return;
    var row = { id: uniqueRecordId(), values: {}, revision: 0, fieldRevisions: {} };
    rows.push(row);
    renderRecordQuestion(question);
    updateEligibility(true);
    sendRecordOperation({ op: "add", questionId: question.id, rowId: row.id });
    var list = document.querySelector('[data-kqa-record-list="' + question.id + '"]');
    var first = list && list.querySelector('[data-kqa-repeat-row="' + row.id + '"]');
    if (first) first.focus();
    var status = list && list.querySelector('[data-kqa-record-status="' + question.id + '"]');
    if (status) { recordAnnouncements[question.id] = localized("repeatRowAdded", { item: itemLabel(question), index: rows.length }); status.textContent = recordAnnouncements[question.id]; }
  }
  function removeRecordRow(question, rowId) {
    var rows = recordRows(question.id);
    var index = rows.findIndex(function (row) { return row.id === rowId; });
    var minRows = recordMinimum(question);
    if (state.locked || index < 0 || rows.length <= minRows) return;
    var row = rows[index];
    rows.splice(index, 1);
    renderRecordQuestion(question);
    updateEligibility(true);
    sendRecordOperation({ op: "remove", questionId: question.id, rowId: rowId, expectedRowRevision: row.revision });
    var list = document.querySelector('[data-kqa-record-list="' + question.id + '"]');
    var remaining = list && list.querySelectorAll("fieldset[data-kqa-record-row]");
    var target = remaining && (remaining[Math.min(index, remaining.length - 1)] || document.querySelector('[data-kqa-record-add="' + question.id + '"]'));
    if (target && target.focus) target.focus();
    var status = list && list.querySelector('[data-kqa-record-status="' + question.id + '"]');
    if (status) { recordAnnouncements[question.id] = localized("repeatRowRemoved", { item: itemLabel(question) }); status.textContent = recordAnnouncements[question.id]; }
  }
  function validateRecordValue(field, value) {
    if (value === null || value === undefined || value === "") return true;
    if ((field.type === "single" || field.type === "select") && !(field.options || []).some(function (option) { return option.value === value; })) return false;
    if ((field.type === "text" || field.type === "longtext") && String(value).length > (field.maxLength || (field.type === "text" ? 500 : 20000))) return false;
    if (field.type === "number" || field.type === "scale") {
      if (typeof value !== "number" || !isFinite(value)) return false;
      var min = field.type === "scale" ? (field.min === undefined ? 1 : field.min) : field.min;
      var max = field.type === "scale" ? (field.max === undefined ? 5 : field.max) : field.max;
      if (min !== undefined && value < min || max !== undefined && value > max) return false;
      if (field.type === "scale" && (!Number.isInteger(value) || (max - min) > 20)) return false;
      if (field.step !== undefined) {
        var base = min === undefined ? 0 : min;
        if (Math.abs((value - base) / field.step - Math.round((value - base) / field.step)) > 1e-9) return false;
      }
    }
    if (field.type === "date") {
      var dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
      if (!dateMatch) return false;
      var year = Number(dateMatch[1]); var month = Number(dateMatch[2]); var day = Number(dateMatch[3]);
      var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      var monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) return false;
    }
    return true;
  }
  function captureRecordField(el) {
    var rowNode = el.closest("fieldset[data-kqa-record-row]");
    var questionId = rowNode && rowNode.getAttribute("data-kqa-record-question");
    var rowId = el.getAttribute("data-kqa-repeat-row");
    var fieldId = el.getAttribute("data-kqa-repeat-field");
    var question = q(questionId);
    var row = recordRows(questionId).find(function (item) { return item.id === rowId; });
    var field = question && recordField(question, fieldId);
    if (!question || !row || !field || state.locked) return;
    var value = valueForRecordField(field, rowFieldControls(rowNode, fieldId));
    var draftKey = questionId + "/" + rowId + "/" + fieldId;
    if (!validateRecordValue(field, value)) {
      recordDrafts[draftKey] = { value: value };
      showRecordFieldError(rowNode, fieldId, localized("repeatFieldInvalid"));
      var invalidList = document.querySelector('[data-kqa-record-list="' + questionId + '"]');
      var invalidStatus = invalidList && invalidList.querySelector('[data-kqa-record-status="' + questionId + '"]');
      recordAnnouncements[questionId] = localized("repeatFieldInvalid");
      if (invalidStatus) invalidStatus.textContent = recordAnnouncements[questionId];
      return;
    }
    delete recordDrafts[draftKey];
    clearRecordFieldError(rowNode, fieldId);
    var expectedFieldRevision = Number(row.fieldRevisions[fieldId]) || 0;
    if (value === null || value === "") {
      if (!(fieldId in row.values)) return;
      delete row.values[fieldId];
      sendRecordOperation({ op: "clear", questionId: questionId, rowId: rowId, fieldId: fieldId, expectedFieldRevision: expectedFieldRevision });
    } else {
      if (row.values[fieldId] === value) return;
      row.values[fieldId] = value;
      sendRecordOperation({ op: "set", questionId: questionId, rowId: rowId, fieldId: fieldId, expectedFieldRevision: expectedFieldRevision, value: value });
    }
    row.fieldRevisions[fieldId] = expectedFieldRevision + 1;
    row.revision++;
  }
  document.addEventListener("input", function (ev) {
    var el = ev.target;
    if (el && el.hasAttribute && el.hasAttribute("data-kqa-repeat-field")) captureRecordField(el);
  }, true);
  document.addEventListener("change", function (ev) {
    var el = ev.target;
    if (el && el.hasAttribute && el.hasAttribute("data-kqa-repeat-field")) captureRecordField(el);
  }, true);
  document.addEventListener("click", function (ev) {
    var target = ev.target;
    var add = target && target.closest ? target.closest("button[data-kqa-record-add]") : null;
    if (add) {
      ev.preventDefault();
      var question = q(add.getAttribute("data-kqa-record-add"));
      if (question) addRecordRow(question);
      return;
    }
    var remove = target && target.closest ? target.closest("button[data-kqa-record-remove]") : null;
    if (remove) {
      ev.preventDefault();
      var questionId = remove.getAttribute("data-kqa-record-question");
      var removeQuestion = q(questionId);
      if (removeQuestion) removeRecordRow(removeQuestion, remove.getAttribute("data-kqa-record-remove"));
    }
  }, true);

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
    set: function (id, value) { return commit(id, { value: value }, "script"); },
    setNote: function (id, text) { return commit(id, { note: text }, "script"); },
    clear: function (id) { return commit(id, { value: null }, "script"); },
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
    post({ type: "hello", version: ${"1"}, manifest: manifest, lang: document.documentElement.lang || "", dir: document.documentElement.dir || "" });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hello); else hello();

  // ---- the probe: what the admin checker runs in the real frame to prove each control stores and restores its answer
  function sampleFor(question) {
    var o = question.options || [];
    switch (question.type) {
      case "single": case "select": return o.length ? o[0].value : null;
      case "multi": return o.slice(0, Math.min(question.maxSelections || o.length, Math.max(question.minSelections || 1, 2))).map(function (x) { return x.value; });
      case "rank": return o.map(function (x) { return x.value; }).reverse();
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
    if (t === "rank") {
      var items = rankItems(question.id);
      var byValue = Object.create(null);
      items.forEach(function (item) { byValue[item.getAttribute("data-value")] = item; });
      value.forEach(function (optionValue) { if (byValue[optionValue]) els[0].appendChild(byValue[optionValue]); });
      fire(els[0], "change");
      return true;
    }
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
      if (!equal(got, sample)) results.push({ code: "KQA601", questionId: question.id, message: "Set the bound control for \"" + question.id + "\" to sample value " + JSON.stringify(sample) + " but the runtime recorded " + JSON.stringify(got === undefined ? null : got) + "." });
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
