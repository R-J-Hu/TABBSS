window.TABBSS_JS_VER = "262"; // cache-debug marker for dev panel
window.TABBSS_VERSION = "1.6.1";  // from VERSION
window.TABBSS_BUILD = "262";    // must match index.html build badge

// ── Global error surface (Release builds have no console) ──
window.addEventListener("error", function (ev) {
  var msg = "[JS Error] " + (ev.message || ev.error || "unknown") + " @ " + (ev.filename || "?") + ":" + (ev.lineno || "?");
  var el = document.getElementById("editionWarning");
  if (el) { el.textContent = msg; el.style.display = ""; el.style.background = "#fee2e2"; el.style.color = "#991b1b"; el.style.padding = "8px 16px"; }
  console.error(msg);
});
window.addEventListener("unhandledrejection", function (ev) {
  var msg = "[Promise Error] " + (ev.reason ? (ev.reason.message || String(ev.reason)) : "?");
  var el = document.getElementById("editionWarning");
  if (el) { el.textContent = msg; el.style.display = ""; el.style.background = "#fee2e2"; el.style.color = "#991b1b"; el.style.padding = "8px 16px"; }
  console.error(msg);
});

const routeSelect = document.getElementById("routeSelect");
const modeSelect = document.getElementById("modeSelect");
const companyRouteSelect = document.getElementById("companyRouteSelect");
const companyRouteWrap = document.getElementById("companyRouteWrap");
const lineFileEditor = document.getElementById("lineFileEditor");
const openFileBtn = document.getElementById("openFileBtn");
const saveFileBtn = document.getElementById("saveFileBtn");
const newFileBtn = document.getElementById("newFileBtn");
const renameFileBtn = document.getElementById("renameFileBtn");
const deleteFileBtn = document.getElementById("deleteFileBtn");
const restoreFileBtn = document.getElementById("restoreFileBtn");
const fileSidebar = document.getElementById("fileSidebar");
const editorToggle = document.getElementById("editorToggle");
const editorCloseBtn = document.getElementById("editorCloseBtn");
const debugPanel = document.getElementById("debugPanel");
const debugView = document.getElementById("debugView");
const appRoot = document.getElementById("appRoot");

const directionSelect = document.getElementById("directionSelect");
const stationJumpSelect = document.getElementById("stationJumpSelect");
const stopNumberDisplay = document.getElementById("stopNumberDisplay");
const stopTotalDisplay = document.getElementById("stopTotalDisplay");
const phaseDisplay = document.getElementById("phaseDisplay");
const phaseLabel = document.getElementById("phaseLabel");
const lineExternalDisplay = document.getElementById("lineExternalDisplay");
const currentStationDisplay = document.getElementById("currentStationDisplay");
const currentStationEnDisplay = document.getElementById("currentStationEnDisplay");
const routeDestinationEnDisplay = document.getElementById("routeDestinationEnDisplay");
const nextActionHint = document.getElementById("nextActionHint");
const volumeControl = document.getElementById("volumeControl");
const volumeOutput = document.getElementById("volumeOutput");
const queueStateDisplay = document.getElementById("queueStateDisplay");
const routeMapScroll = document.getElementById("routeMapScroll");
const routeMap = document.getElementById("routeMap");
const queueView = document.getElementById("queueView");
const tipButtons = document.getElementById("tipButtons");

const preBtn = document.getElementById("preBtn");
const arriveBtn = document.getElementById("arriveBtn");
const stopPlayBtn = document.getElementById("stopPlayBtn");
const replayBtn = document.getElementById("replayBtn");
const flipDirBtn = document.getElementById("flipDirBtn");
const nextAnnounceBtn = document.getElementById("nextAnnounceBtn");

const state = {
  mode: "new",
  index: [],
  newIndex: null,
  currentCompany: "",
  currentLineFile: "",
  route: null,
  direction: "up",
  stopNumber: 1,
  awaitingArrival: false,
  playbackVolume: 0.62,
  audioBases: ["../兼容模式-海峡报站器文件库"],
  outputBase: "../output",
  userDataBase: "../报站线路文件库",
  devMode: /(?:\?|&)dev=1(?:&|$)/.test(location.search) || /localhost|127\.0\.0\.1/.test(location.hostname),
  localDirHandle: null,
  funct: { edition: "dev", show_legacy_editor: false, show_dev_track_module: false, show_update_log: true, show_build_number: true, check_updates: true },
};

async function loadFunctConfig() {
  try {
    const resp = await fetch("./funct.json?ts=" + Date.now());
    if (resp.ok) {
      const cfg = await resp.json();
      if (typeof cfg.show_legacy_editor === "boolean") state.funct.show_legacy_editor = cfg.show_legacy_editor;
      if (typeof cfg.show_dev_track_module === "boolean") state.funct.show_dev_track_module = cfg.show_dev_track_module;
      if (typeof cfg.show_update_log === "boolean") state.funct.show_update_log = cfg.show_update_log;
      if (typeof cfg.show_build_number === "boolean") state.funct.show_build_number = cfg.show_build_number;
      if (typeof cfg.check_updates === "boolean") state.funct.check_updates = cfg.check_updates;
      if (typeof cfg.show_dev_panel === "boolean") state.funct.show_dev_panel = cfg.show_dev_panel;
      if (typeof cfg.edition === "string") state.funct.edition = cfg.edition;
      console.log("[funct] config loaded:", state.funct);
    }
  } catch (e) { console.warn("[funct] load failed, using defaults:", e.message); }
  applyFunctConfig();
  applyEditionConfig();
  initDevPanel();
}

function applyFunctConfig() {
  var legacyToggle = document.getElementById("editorToggle");
  if (legacyToggle) legacyToggle.style.display = state.funct.show_legacy_editor ? "" : "none";
  var debugPanel = document.getElementById("debugPanel");
  if (debugPanel) debugPanel.style.display = state.funct.show_dev_track_module ? "" : "none";
  var buildTag = document.getElementById("buildTag");
  if (buildTag) buildTag.style.display = state.funct.show_update_log ? "" : "none";
  var buildBadge = document.getElementById("buildBadge");
  if (buildBadge) buildBadge.style.display = state.funct.show_build_number ? "" : "none";
  var devToggle = document.getElementById("devPanelToggle");
  if (devToggle) devToggle.style.display = state.funct.show_dev_panel ? "" : "none";
}

/* ── Edition Config ── */
function applyEditionConfig() {
  var ed = state.funct.edition || "dev";
  var warning = document.getElementById("editionWarning");

  // Warning text
  if (warning) {
    if (ed === "release") {
      warning.style.display = "none";
    } else if (ed === "audit") {
      warning.textContent = "【外审版】此版本不对外公开，含有预载线路文件，请勿外发，感谢配合";
      warning.style.display = "";
    } else {
      warning.textContent = "【开发版】此版本不对外公开，含有预载线路文件，请勿外发，感谢配合";
      warning.style.display = "";
    }
  }

  // Dev/Audit editions: force update check OFF
  if (ed === "dev" || ed === "audit") {
    state.funct.check_updates = false;
  }
}

/* ── Alt+F12: toggle dev panel on Release edition ── */
(function () {
  document.addEventListener("keydown", function (e) {
    if (e.altKey && e.key === "F12") {
      e.preventDefault();
      var devToggle = document.getElementById("devPanelToggle");
      if (devToggle) {
        var visible = devToggle.style.display !== "none";
        devToggle.style.display = visible ? "none" : "";
        try { localStorage.setItem("tabbss_devpanel_visible", visible ? "0" : "1"); } catch (_) {}
      }
    }
  });
  // Restore persisted Alt+F12 state (Release only)
  var ed = state.funct.edition;
  if (ed === "release") {
    try {
      var saved = localStorage.getItem("tabbss_devpanel_visible");
      if (saved === "1") {
        var devToggle = document.getElementById("devPanelToggle");
        if (devToggle) devToggle.style.display = "";
      }
    } catch (_) {}
  }
})();

/* ── Developer Panel ── */
function initDevPanel() {
  var toggleBtn = document.getElementById("devPanelToggle");
  var sidebar = document.getElementById("devPanelSidebar");
  var closeBtn = document.getElementById("devPanelClose");
  var saveBtn = document.getElementById("devPanelSave");
  var appRoot = document.getElementById("appRoot");
  if (!toggleBtn || !sidebar) return;

  var isOpen = false;
  function open() {
    isOpen = true;
    sidebar.style.transform = "translateX(0)";
    renderDevToggles();
  }
  function close() {
    isOpen = false;
    sidebar.style.transform = "translateX(100%)";
  }

  toggleBtn.addEventListener("click", function () {
    isOpen ? close() : open();
  });
  if (closeBtn) closeBtn.addEventListener("click", close);
  if (saveBtn) {
    saveBtn.addEventListener("click", function () {
      var body = document.getElementById("devPanelBody");
      if (!body) return;
      body.querySelectorAll("input[type=checkbox]").forEach(function (cb) {
        state.funct[cb.dataset.key] = !!cb.checked;
      });
      applyFunctConfig();
      fetch("/api/file/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relPath: "web/funct.json", content: JSON.stringify(state.funct, null, 2) + "\n" }),
      }).then(function (resp) { return resp.json(); })
        .then(function () { close(); })
        .catch(function (e) { console.error("[dev-panel] save failed:", e); });
    });
  }
}

function renderDevToggles() {
  var body = document.getElementById("devPanelBody");
  if (!body) return;
  var items = [
    { key: "show_legacy_editor", label: "旧版文本编辑器" },
    { key: "show_dev_track_module", label: "开发追踪模块" },
    { key: "show_update_log", label: "更新日志" },
    { key: "show_build_number", label: "Build 标号" },
    { key: "check_updates", label: "检查更新" },
  ];
  var html = "";
  items.forEach(function (item) {
    var checked = state.funct[item.key] ? " checked" : "";
    html += '<label style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;cursor:pointer"><input type="checkbox" data-key="' + item.key + '"' + checked + ' style="accent-color:#3b82f6;width:18px;height:18px;flex-shrink:0"> ' + item.label + '</label>';
  });
  html += '<div style="margin-top:14px;padding-top:14px;border-top:1px solid #e5e7eb">'
    + '<button type="button" id="devSimulateUpdateBtn" style="width:100%;padding:10px 0;border-radius:8px;border:1px solid #dfe7f2;background:#f5f8fc;color:#1769d8;font-size:14px;font-weight:600;cursor:pointer">模拟升级</button>'
    + '<p id="devSimulateStatus" style="margin:8px 0 0;font-size:12px;color:#69778d">获取 Gitee 最新 build，即使不比当前版本高也触发升级流程。</p>'
    + '<p style="margin:10px 0 0;font-size:11px;color:#9aa4b3">JS ' + (window.TABBSS_JS_VER || "?") + '</p>'
    + '</div>';
  body.innerHTML = html;
  var simBtn = document.getElementById("devSimulateUpdateBtn");
  if (simBtn) {
    simBtn.onclick = function () {
      var status = document.getElementById("devSimulateStatus");
      simBtn.textContent = "检查中...";
      simBtn.disabled = true;
      if (status) status.textContent = "正在获取 Gitee 最新 build...";
      checkForUpdates(true).then(function () {
        setTimeout(function () {
          simBtn.textContent = "模拟升级";
          simBtn.disabled = false;
          if (status) status.textContent = "检查完成，请在弹窗中查看结果。";
        }, 800);
      });
    };
  }
}

async function callLocalApi(path, payload) {
  const resp = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(txt || `接口请求失败: ${path}`);
  }
  return await resp.json();
}

let fileOpBusy = false;

function setFileOpButtonsDisabled(disabled) {
  [openFileBtn, saveFileBtn, newFileBtn, renameFileBtn, deleteFileBtn, restoreFileBtn]
    .filter(Boolean)
    .forEach((btn) => {
      btn.disabled = !!disabled;
    });
}

async function withFileOpLock(fn) {
  if (fileOpBusy) return;
  fileOpBusy = true;
  setFileOpButtonsDisabled(true);
  try {
    await fn();
  } catch (e) {
    alert(e.message || String(e));
  } finally {
    fileOpBusy = false;
    setFileOpButtonsDisabled(false);
  }
}

function normalizeIniFileName(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("文件名不能为空");
  if (/[\\/:*?"<>|]/.test(raw)) throw new Error("文件名包含非法字符：\\ / : * ? \" < > |");
  if (raw.includes("..")) throw new Error("文件名不能包含 ..");
  const name = /\.ini$/i.test(raw) ? raw : `${raw}.ini`;
  if (name === ".ini") throw new Error("文件名无效");
  return name;
}


if (!state.devMode && debugPanel) {
  debugPanel.style.display = "none";
}


/** 重播用：上一次主流程预报/到站（不含提示语） */
let lastMainPlayback = null;

let playbackToken = 0;
let currentAudioEl = null;

function interruptPlayback() {
  playbackToken += 1;
  if (currentAudioEl) {
    try {
      currentAudioEl.pause();
    } catch {
      /* ignore */
    }
    currentAudioEl = null;
  }
}

function basenameOf(rel) {
  if (!rel) return "";
  const parts = rel.split(/[/\\]/);
  return parts[parts.length - 1] || rel;
}

function stopPlaybackOnly() {
  interruptPlayback();
}

function clearPlaybackState() {
  stopPlaybackOnly();
  renderQueue([]);
  lastMainPlayback = null;
}

function flipDirection() {
  clearPlaybackState();
  state.direction = state.direction === "up" ? "down" : "up";
  directionSelect.value = state.direction;
  state.stopNumber = 1;
  state.awaitingArrival = false;
  refreshTripUi({ scrollMode: "center" });
}

function setDebug(payload) {
  if (!state.devMode || !debugPanel || !debugView) return;
  if (!state.funct.show_dev_track_module) return;
  debugPanel.style.display = "block";
  debugView.textContent = JSON.stringify(payload, null, 2);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderIniToEditor(text) {
  if (!lineFileEditor) return;
  const html = String(text || "")
    .split("\n")
    .map((line) => {
      const safe = escapeHtml(line);
      if (/^#{1,4}/.test(line.trim())) return `<span class="ini-head">${safe}</span>`;
      const m = line.match(/^(\s*[^=:#]+)(=)(.*)$/);
      if (m) {
        return `<span class="ini-key">${escapeHtml(m[1])}</span>${escapeHtml(m[2])}<span class="ini-param">${escapeHtml(m[3])}</span>`;
      }
      return safe;
    })
    .join("\n");
  lineFileEditor.innerHTML = html;
}

function editorRawText() {
  return lineFileEditor ? lineFileEditor.innerText.replace(/\u00A0/g, " ") : "";
}

function runAutoChecks() {
  const checks = [];
  checks.push({ name: "公司选择存在", pass: !!companyRouteSelect });
  checks.push({ name: "新模式公司项", pass: state.mode !== "new" || companyRouteSelect.options.length > 0 });
  checks.push({ name: "新模式线路项", pass: state.mode !== "new" || routeSelect.options.length > 0 });
  checks.push({ name: "编辑面板可用", pass: !!fileSidebar && !!editorToggle });
  const failed = checks.filter((c) => !c.pass);
  setDebug({ mode: state.mode, checks });
  if (failed.length) {
    console.warn("自动检查未通过:", failed.map((x) => x.name).join(", "));
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderIniToEditor(text) {
  if (!lineFileEditor) return;
  const html = String(text || "")
    .split("\n")
    .map((line) => {
      const safe = escapeHtml(line);
      if (/^#{1,4}/.test(line.trim())) return `<span class="ini-head">${safe}</span>`;
      const m = line.match(/^(\s*[^=:#]+)(=)(.*)$/);
      if (m) {
        return `<span class="ini-key">${escapeHtml(m[1])}</span>${escapeHtml(m[2])}<span class="ini-param">${escapeHtml(m[3])}</span>`;
      }
      return safe;
    })
    .join("\n");
  lineFileEditor.innerHTML = html;
}

function editorRawText() {
  return lineFileEditor ? lineFileEditor.innerText.replace(/\u00A0/g, " ") : "";
}

function runAutoChecks() {
  const checks = [];
  checks.push({ name: "公司选择存在", pass: !!companyRouteSelect });
  checks.push({ name: "新模式公司项", pass: state.mode !== "new" || companyRouteSelect.options.length > 0 });
  checks.push({ name: "新模式线路项", pass: state.mode !== "new" || routeSelect.options.length > 0 });
  checks.push({ name: "编辑面板可用", pass: !!fileSidebar && !!editorToggle });
  const failed = checks.filter((c) => !c.pass);
  setDebug({ mode: state.mode, checks });
  if (failed.length) {
    console.warn("自动检查未通过:", failed.map((x) => x.name).join(", "));
  }
}

function parseStopsBlock(text, title) {
  const nextByTitle = {
    "上行中文站名": "上行英文站名",
    "上行英文站名": "下行中文站名",
    "下行中文站名": "下行英文站名",
    "下行英文站名": "#显示屏格式",
  };
  const next = nextByTitle[title] || "#显示屏格式";
  const reg = new RegExp(`${title}：[\\s\\S]*?(?=\\n${next}|$)`);
  const m = text.match(reg);
  if (!m) return [];
  const body = m[0];
  const out = [];
  const lineRe = /stop_(\d+)\s*:(.*)/g;
  let g;
  while ((g = lineRe.exec(body))) {
    out[Number(g[1]) - 1] = (g[2] || "").trim();
  }
  return out.map((x) => x || "");
}

function parseSimpleKey(text, key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
}

function parseRuleTokens(rule) {
  if (!rule) return [];
  return rule
    .split(">")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      if (x === "{本站}" || x === "{本站中文}" || x === "【本站】" || x === "【本站中文】") return "【本站中文】";
      if (x === "{本站英文}" || x === "【本站英文】" || x === "【英文本站】") return "【本站英文】";
      if (x === "{下站}" || x === "{下站中文}" || x === "【下站】" || x === "【下站中文】") return "【下站中文】";
      if (x === "{下站英文}" || x === "【下站英文】" || x === "【英文下站】") return "【下站英文】";
      if (x === "{起点}" || x === "{起始站}" || x === "{起始站中文}") return "【起始站中文】";
      if (x === "{起始站英文}") return "【起始站英文】";
      if (x === "{终点}" || x === "{终点站}" || x === "{终点站中文}") return "【终点站中文】";
      if (x === "{终点站英文}") return "【终点站英文】";
      if (x === "{默认模版}" || x === "{默认模板}" || x === "【默认模版】" || x === "【默认模板】") return "【默认模版】";
      if (x === "{普通站预报模板}" || x === "【普通站预报模板】") return "【普通站预报模板】";
      if (x === "{普通站到站模板}" || x === "【普通站到站模板】") return "【普通站到站模板】";
      if (x.startsWith('"') && x.endsWith('"')) return x.slice(1, -1);
      return x;
    });
}

function expandDefaultTemplateInTokens(tokens, fallbackTokens) {
  if (!tokens || !fallbackTokens) return tokens || [];
  const result = [];
  for (const t of tokens) {
    if (t === "【默认模版】") {
      result.push(...fallbackTokens);
    } else {
      result.push(t);
    }
  }
  return result;
}

function parseTipItems(text) {
  const out = [];
  // Split by ###提示语N: headers precisely (提示语1 must not match 提示语10 prefix)
  const allBlocks = text.split(/\n(?=###提示语\d+:)/);
  const tipMap = {};
  for (const block of allBlocks) {
    const m = block.match(/^###提示语(\d+):([\s\S]*)$/);
    if (m) {
      const num = parseInt(m[1]);
      const body = m[2];
      const name = parseSimpleKey(body, "显示名称") || `提示语${num}`;
      const val = parseSimpleKey(body, "语音文件");
      tipMap[num] = { name, file: val ? parseRuleTokens(val).join("+") : "【无】" };
    }
  }
  for (let i = 1; i <= 10; i += 1) {
    out.push(tipMap[i] || { name: `服务语${i}`, file: "【无】" });
  }
  return out;
}

function buildRouteFromV15Text(text, fileMeta) {
  const lineName = parseSimpleKey(text, "线路名称") || fileMeta.lineName || "未命名线路";
  // V1.6: Read explicit flags
  const isLoop = parseSimpleKey(text, "环线模式") === "true";
  const upDownSame = parseSimpleKey(text, "上下行相同") === "true";

  const upCn = parseStopsBlock(text, "上行中文站名");
  const downCn = isLoop ? upCn.slice().reverse() : parseStopsBlock(text, "下行中文站名");
  const upEn = parseStopsBlock(text, "上行英文站名");
  const downEn = isLoop ? upEn.slice().reverse() : parseStopsBlock(text, "下行英文站名");

  while (upEn.length < upCn.length) upEn.push("");
  while (downEn.length < downCn.length) downEn.push("");
  while (upCn.length < upEn.length) upCn.push("");
  while (downCn.length < downEn.length) downCn.push("");

  if (!upCn.length) throw new Error("线路文件不完整：上行站点不能为空");

  const defaultDepart = parseRuleTokens(parseSimpleKey(text, "默认上行预报规则"));
  const defaultArrive = parseRuleTokens(parseSimpleKey(text, "默认上行到站播报规则"));
  const defaultDownDepart = upDownSame ? defaultDepart : parseRuleTokens(parseSimpleKey(text, "默认下行预报规则"));
  const defaultDownArrive = upDownSame ? defaultArrive : parseRuleTokens(parseSimpleKey(text, "默认下行到站播报规则"));
  const upFirstDepart = parseRuleTokens(parseSimpleKey(text, "上行首站预报规则"));
  const downFirstDepartRaw = parseSimpleKey(text, "下行首站预报规则");
  const downFirstDepart = upDownSame ? upFirstDepart : (downFirstDepartRaw ? parseRuleTokens(downFirstDepartRaw) : []);
  const upTerminalDepart = parseRuleTokens(parseSimpleKey(text, "上行终点站预报规则"));
  const upTerminalArrive = parseRuleTokens(parseSimpleKey(text, "上行终点站报站规则"));
  const downTerminalDepartRaw = parseSimpleKey(text, "下行终点站预报规则");
  const downTerminalArriveRaw = parseSimpleKey(text, "下行终点站报站规则");
  const downTerminalDepart = upDownSame ? upTerminalDepart : (downTerminalDepartRaw ? parseRuleTokens(downTerminalDepartRaw) : []);
  const downTerminalArrive = upDownSame ? upTerminalArrive : (downTerminalArriveRaw ? parseRuleTokens(downTerminalArriveRaw) : []);

  // Compute effective normal templates (with fallback) BEFORE expanding new params
  var effUpDepart = defaultDepart.length ? defaultDepart : ["【下站】"];
  var effUpArrive = defaultArrive.length ? defaultArrive : ["【本站】"];
  var effDownDepart = defaultDownDepart.length ? defaultDownDepart : (defaultDepart.length ? defaultDepart : ["【下站】"]);
  var effDownArrive = defaultDownArrive.length ? defaultDownArrive : (defaultArrive.length ? defaultArrive : ["【本站】"]);

  // V1.6: Expand {普通站预报模板} and {普通站到站模板} using EFFECTIVE normal templates
  function expandNormalTpl(tokens, normalTokens) {
    if (!tokens.length) return tokens;
    var r = [];
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i] === "【普通站预报模板】") {
        if (normalTokens.length) r.push.apply(r, normalTokens);
      } else if (tokens[i] === "【普通站到站模板】") {
        if (normalTokens.length) r.push.apply(r, normalTokens);
      } else { r.push(tokens[i]); }
    }
    return r;
  }
  var upFirstD = expandNormalTpl(upFirstDepart, effUpDepart);
  var upTermD = expandNormalTpl(upTerminalDepart, effUpDepart);
  var upTermA = expandNormalTpl(upTerminalArrive, effUpArrive);
  var downFirstD = expandNormalTpl(downFirstDepart, effDownDepart);
  var downTermD = expandNormalTpl(downTerminalDepart, effDownDepart);
  var downTermA = expandNormalTpl(downTerminalArrive, effDownArrive);

  const stationAudioMap = {};
  const stationAudioMapEn = {};
  const stationRuleOverrides = { up: {}, down: {} };
  const upBlock = text.match(/###上行站点([\s\S]*?)###下行站点/);
  const downBlock = isLoop ? null : text.match(/###下行站点([\s\S]*?)##手按提示语类/);
  const parseStationBlock = (blockText, stops, dir) => {
    if (!blockText) return;
    const secRe = /####Stop(\d+)：[\s\S]*?(?=\n####Stop|$)/g;
    let m;
    while ((m = secRe.exec(blockText[1] || blockText[0]))) {
      const idx = Number(m[1]) - 1;
      const stopName = stops[idx] || "";
      const section = m[0];
      const zhRule = (parseSimpleKey(section, "本站中文语音文件") || parseSimpleKey(section, "本站中文站名语音文件") || parseSimpleKey(section, "本站站名语音文件")).replace(/"/g, "").trim();
      const enRule = (parseSimpleKey(section, "本站英文语音文件") || parseSimpleKey(section, "本站英文站名语音文件")).replace(/"/g, "").trim();
      const departRule = parseSimpleKey(section, "预报规则").trim();
      const arriveRule = parseSimpleKey(section, "到站规则").trim();
      const englishName = (dir === "up" ? upEn[idx] : downEn[idx]) || "";

      if (stopName) {
        stationAudioMap[stopName] = zhRule || `{本站中文同名文件}`;
      }
      if (stopName) {
        const enKey = `${dir}:${idx + 1}`;
        stationAudioMapEn[enKey] = enRule || `{本站英文同名文件}`;
        if (englishName) {
          stationAudioMapEn[`${dir}:${idx + 1}:name`] = englishName;
        }
      }
      stationRuleOverrides[dir][idx + 1] = {
        depart: departRule ? parseRuleTokens(departRule) : [],
        arrive: arriveRule ? parseRuleTokens(arriveRule) : [],
        zhAudioRel: zhRule,
        enAudioRel: enRule,
      };
    }
  };
  parseStationBlock(upBlock, upCn, "up");
  if (!isLoop) parseStationBlock(downBlock, downCn, "down");

  const tipItems = parseTipItems(text);
  const tips = tipItems.map((x) => x.file || "【无】");
  const tipLabels = tipItems.map((x, i) => (x.name || "").trim() || `服务语${i + 1}`);

  const routeId = `${fileMeta.company}/${fileMeta.fileName}`;
  var dirs = {
    up: { label: isLoop ? "环向" : "上行", stations: upCn, stations_en: upEn, special_audio_map: {} },
    down: { label: "下行", stations: downCn, stations_en: downEn, special_audio_map: {} },
  };

  // V1.6: Build templates. down inherits from up if upDownSame
  var upTpl = {
    first_depart: upFirstD.length ? upFirstD : (defaultDepart.length ? defaultDepart : ["【下站】"]),
    depart: defaultDepart.length ? defaultDepart : ["【下站】"],
    arrive: defaultArrive.length ? defaultArrive : ["【本站】"],
    terminal_depart: upTermD.length ? upTermD : (defaultDepart.length ? defaultDepart : ["【下站】"]),
    terminal_arrive: upTermA.length ? upTermA : (defaultArrive.length ? defaultArrive : ["【本站】"]),
  };
  var downTpl = upDownSame ? upTpl : {
    first_depart: downFirstD.length ? downFirstD : (upFirstD.length ? upFirstD : (defaultDownDepart.length ? defaultDownDepart : (defaultDepart.length ? defaultDepart : ["【下站】"]))),
    depart: defaultDownDepart.length ? defaultDownDepart : (defaultDepart.length ? defaultDepart : ["【下站】"]),
    arrive: defaultDownArrive.length ? defaultDownArrive : (defaultArrive.length ? defaultArrive : ["【本站】"]),
    terminal_depart: downTermD.length ? downTermD : (upTermD.length ? upTermD : (defaultDownDepart.length ? defaultDownDepart : (defaultDepart.length ? defaultDepart : ["【下站】"]))),
    terminal_arrive: downTermA.length ? downTermA : (upTermA.length ? upTermA : (defaultDownArrive.length ? defaultDownArrive : (defaultArrive.length ? defaultArrive : ["【本站】"]))),
  };

  return {
    id: routeId,
    name: lineName,
    isLoop: isLoop,
    upDownSame: upDownSame,
    display: { front_raw: `[${lineName}]`, side_raw: "", rear_raw: `[${lineName}]` },
    directions: dirs,
    templates: { depart: upTpl.depart, arrive: upTpl.arrive, terminal_depart: upTpl.terminal_depart, terminal_arrive: upTpl.terminal_arrive },
    __templatesByDir: { up: upTpl, down: downTpl },
    tips,
    tip_labels: tipLabels,
    station_audio_map: stationAudioMap,
    station_audio_map_en: stationAudioMapEn,
    station_rule_overrides: stationRuleOverrides,
    first_departure_forecast: { shared: [], up: [], down: [] },
    __meta: fileMeta,
  };
}

async function loadNewIndex() {
  const resp = await fetch(`${state.userDataBase}/index.json?ts=${Date.now()}`);
  if (!resp.ok) throw new Error("无法加载 报站线路文件库/index.json");
  state.newIndex = await resp.json();
  return state.newIndex;
}

function syncCompanyOptions() {
  const companies = state.newIndex?.companies || [];
  companyRouteSelect.innerHTML = "";
  companies.forEach((c) => {
    const op = document.createElement("option");
    op.value = c.name;
    op.textContent = c.name;
    companyRouteSelect.appendChild(op);
  });
  if (!state.currentCompany && companies.length) state.currentCompany = companies[0].name;
  companyRouteSelect.value = state.currentCompany;
}

function syncRouteOptionsByCompany() {
  const company = (state.newIndex?.companies || []).find((x) => x.name === state.currentCompany);
  routeSelect.innerHTML = "";
  const lines = company?.lines || [];
  lines.forEach((line) => {
    const op = document.createElement("option");
    op.value = line.file;
    // 顶栏展示 index.json 中的注册名（文件登记名，即不含路径/后缀的文件名），
    // 避免展示 INI 内部短名（如 线路名称=4）。
    op.textContent = basenameOf(line.file).replace(/\.ini$/i, "");
    routeSelect.appendChild(op);
  });
  if (!state.currentLineFile && lines.length) state.currentLineFile = lines[0].file;
  routeSelect.value = state.currentLineFile;
}

async function loadLineTextByPath(relPath) {
  const resp = await fetch(`${state.userDataBase}/${relPath}?ts=${Date.now()}`);
  if (!resp.ok) throw new Error(`无法打开线路文件：${relPath}`);
  return await resp.text();
}

async function loadRouteFromNewMode(relPath) {
  clearPlaybackState();
  try {
    var txt = await loadLineTextByPath(relPath);
  } catch (e) {
    console.error("加载线路失败：", relPath, e.message);
    var extDisp = document.getElementById("lineExternalDisplay");
    if (extDisp) extDisp.textContent = "线路文件不存在：" + relPath;
    var termCnEl = document.getElementById("routeTermCnDisplay");
    if (termCnEl) termCnEl.textContent = "";
    renderRouteMap([]);
    renderTipButtons([]);
    state.route = null;
    state.currentLineFile = null;
    setDebug({ error: "文件不存在", lineFile: relPath });
    return;
  }
  renderIniToEditor(txt);
  const [company, fileName] = relPath.split("/");
  const fileMeta = {
    company,
    fileName,
    lineName: fileName.replace(/\.ini$/i, ""),
  };
  state.route = buildRouteFromV15Text(txt, fileMeta);
  state.audioBases = ["../报站线路文件库"];
  applyLoopModeUI();
  resetTrip();
  setDebug({ mode: state.mode, company, lineFile: relPath, routeName: state.route.name });
}

async function saveCurrentLineFile() {
  if (!state.currentLineFile) return;
  const txt = editorRawText();
  const [company, fileName] = state.currentLineFile.split("/");
  const route = buildRouteFromV15Text(txt, {
    company,
    fileName,
    lineName: fileName.replace(/\.ini$/i, ""),
  });
  state.route = route;
  resetTrip();

  try {
    await callLocalApi("/api/file/write", {
      relPath: state.currentLineFile,
      content: txt,
    });
    alert(`已直接保存到本地：${state.currentLineFile}`);
    setDebug({ mode: state.mode, savedLineFile: state.currentLineFile, method: "local-api" });
    return;
  } catch (e) {
    console.warn("本地接口保存失败，回退导出：", e);
  }

  const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  alert("当前环境未启用本地写入接口，已导出文件，请手工覆盖。\n目标：" + state.currentLineFile);
  setDebug({ mode: state.mode, savedLineFile: state.currentLineFile, method: "download" });
}

async function reloadNewModeIndexAndKeepSelection(preferredRelPath = "") {
  await callLocalApi("/api/file/reindex", {});
  await loadNewIndex();
  syncCompanyOptions();

  if (preferredRelPath) {
    const [company] = preferredRelPath.split("/");
    state.currentCompany = company || state.currentCompany;
    state.currentLineFile = preferredRelPath;
  }

  syncRouteOptionsByCompany();
  if (state.currentLineFile) routeSelect.value = state.currentLineFile;
}

async function createNewLineFile() {
  if (state.mode !== "new") return;
  const name = prompt("请输入新线路文件名（可不带 .ini）");
  if (!name) return;
  const fileName = normalizeIniFileName(name);
  const relPath = `${state.currentCompany}/${fileName}`;
  const content = editorRawText() || "#线路信息\n线路名称=新线路\n";
  await callLocalApi("/api/file/write", { relPath, content });
  await reloadNewModeIndexAndKeepSelection(relPath);
  await loadRouteFromNewMode(relPath);
  alert(`新增成功：${relPath}`);
}

async function renameCurrentLineFile() {
  if (state.mode !== "new" || !state.currentLineFile) return;
  const oldRelPath = state.currentLineFile;
  const [company, oldName] = oldRelPath.split("/");
  const next = prompt("请输入新文件名（可不带 .ini）", oldName);
  if (!next) return;
  const newName = normalizeIniFileName(next);
  if (newName === oldName) return;
  const newRelPath = `${company}/${newName}`;
  await callLocalApi("/api/file/rename", { fromRelPath: oldRelPath, toRelPath: newRelPath });
  await reloadNewModeIndexAndKeepSelection(newRelPath);
  await loadRouteFromNewMode(newRelPath);
  alert(`重命名成功：\n${oldRelPath} -> ${newRelPath}`);
}

async function deleteCurrentLineFile() {
  if (state.mode !== "new" || !state.currentLineFile) return;
  if (!confirm(`确认删除文件（将移动到回收站）？\n${state.currentLineFile}`)) return;
  const oldRelPath = state.currentLineFile;
  await callLocalApi("/api/file/delete", { relPath: oldRelPath });
  state.currentLineFile = "";
  await reloadNewModeIndexAndKeepSelection("");
  if (routeSelect.value) {
    state.currentLineFile = routeSelect.value;
    await loadRouteFromNewMode(state.currentLineFile);
  } else {
    clearPlaybackState();
    state.route = null;
    refreshTripUi({ scrollMode: "center" });
  }
  alert(`已删除（可恢复）：${oldRelPath}`);
}

async function restoreLatestDeletedFile() {
  if (state.mode !== "new") return;
  const ret = await callLocalApi("/api/file/restore_latest", {});
  if (!ret.ok || !ret.restoredRelPath) {
    alert("没有可恢复的已删除文件。");
    return;
  }
  await reloadNewModeIndexAndKeepSelection(ret.restoredRelPath);
  await loadRouteFromNewMode(ret.restoredRelPath);
  alert(`已恢复：${ret.restoredRelPath}`);
}

async function loadIndexCompat() {
  const tryUrls = [
    `${state.outputBase}/index.json`,
    "./output/index.json",
    "../output/index.json",
    "/output/index.json",
  ];

  let resp = null;
  let usedBase = state.outputBase;
  for (const url of tryUrls) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;
      const list = await r.json();
      if (Array.isArray(list)) {
        resp = list;
        usedBase = url.replace(/\/index\.json(?:\?.*)?$/, "");
        break;
      }
    } catch {
      /* try next */
    }
  }

  if (!resp) throw new Error("无法加载 output/index.json，请先运行转换脚本。");

  state.outputBase = usedBase;
  state.index = resp;

  routeSelect.innerHTML = "";
  for (const item of state.index) {
    const op = document.createElement("option");
    op.value = item.id;
    op.textContent = item.name;
    routeSelect.appendChild(op);
  }
  if (state.index.length > 0) {
    await loadRouteById(state.index[0].id);
  }
}

async function loadRouteById(routeId) {
  clearPlaybackState();
  const meta = state.index.find((x) => x.id === routeId);
  if (!meta) return;
  const resp = await fetch(`${state.outputBase}/${meta.path}`);
  if (!resp.ok) throw new Error("无法加载线路 json。");
  state.route = await resp.json();
  state.audioBases = ["../兼容模式-海峡报站器文件库"];
  lastMainPlayback = null;
  resetTrip();
  setDebug({ mode: state.mode, routeId: state.route.id, routeName: state.route.name });
}

function resetTrip() {
  state.stopNumber = 1;
  state.awaitingArrival = false;
  renderTipButtons();
  refreshTripUi({ scrollMode: "center" });
}

function stationsForDirection(dir) {
  if (!state.route) return [];
  return state.route.directions[dir].stations || [];
}

function getStations() {
  return stationsForDirection(state.direction);
}

function stationAtOneBased(n, dir) {
  const d = dir === undefined ? state.direction : dir;
  const stations = stationsForDirection(d);
  if (n < 1 || n > stations.length) return "";
  return stations[n - 1];
}

function stationEnAtOneBased(n, dir) {
  const d = dir === undefined ? state.direction : dir;
  const stations = state.route?.directions?.[d]?.stations_en || [];
  if (n < 1 || n > stations.length) return "";
  return stations[n - 1] || "";
}

function routeFolderName() {
  if (state.mode === "new") {
    return state.route?.__meta?.company || "";
  }
  return state.route?.id || "";
}

function normalizeAudioRelPath(rel) {
  return String(rel || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function audioUrlCandidatesForRelative(rel) {
  const normRel = normalizeAudioRelPath(rel);
  const parts = normRel.split("/").filter(Boolean).map((s) => encodeURIComponent(s));
  const route = encodeURIComponent(routeFolderName());
  const relPath = parts.join("/");

  const candidates = [
    ...state.audioBases.flatMap((base) => [
      `${base}/${route}/audio/${relPath}`,
      `${base}/${route}/${relPath}`,
      `${base}/${relPath}`,
    ]),
    ...state.audioBases.flatMap((base) => [
      `${base}/${route}/audio/${normRel}`,
      `${base}/${route}/${normRel}`,
      `${base}/${normRel}`,
    ]),
  ];

  return [...new Set(candidates)];
}

function audioUrlForRelative(rel) {
  return audioUrlCandidatesForRelative(rel)[0];
}

function resolveSameNameAudioToken(name, prefixes = [""]) {
  if (!name) return null;
  const exts = ["wav", "mp3", "m4a", "WAV", "MP3", "M4A"];
  const urls = [];
  for (const prefix of prefixes) {
    for (const ext of exts) {
      urls.push(...audioUrlCandidatesForRelative(`${prefix}${name}.${ext}`));
    }
  }
  const relLabel = prefixes.length === 1 && prefixes[0] === "" ? `${name}.*` : `${prefixes.join("|")}${name}.*`;
  return { rel: relLabel, urls, url: urls[0] || "" };
}

function resolveStationAudio(stationName, stopIndex) {
  // Per-station override takes priority (direction+index aware, avoids same-name conflicts)
  if (stopIndex != null) {
    const ov = state.route?.station_rule_overrides?.[state.direction]?.[stopIndex];
    if (ov?.zhAudioRel && ov.zhAudioRel.trim()) {
      const rel = ov.zhAudioRel.replace(/^"|"$/g, '').trim();
      if (rel && rel !== "{本站中文同名文件}") {
        const urls = audioUrlCandidatesForRelative(rel);
        return { rel, urls, url: urls[0] };
      }
    }
  }
  const map = state.route?.station_audio_map || {};
  const rel = map[stationName];
  if (!rel) return resolveSameNameAudioToken(stationName);
  if (rel === "{本站中文同名文件}") return resolveSameNameAudioToken(stationName);
  const urls = audioUrlCandidatesForRelative(rel);
  return { rel, urls, url: urls[0] };
}

function resolveDirectionEndpointAudio(dir, endpoint, lang) {
  const stationsZh = state.route?.directions?.[dir]?.stations || [];
  const stationsEn = state.route?.directions?.[dir]?.stations_en || [];
  const idx = endpoint === "start" ? 1 : stationsZh.length;
  if (idx < 1) return null;
  if (lang === "zh") {
    return resolveStationAudio(stationsZh[idx - 1] || "");
  }
  return resolveStationAudioEn(dir, idx, stationsEn[idx - 1] || "");
}

function resolveStationAudioEn(dir, stopIndex, fallbackName) {
  const map = state.route?.station_audio_map_en || {};
  const key = `${dir}:${stopIndex}`;
  const rel = map[key] || "{本站英文同名文件}";
  const zhName = (state.route?.directions?.[dir]?.stations || [])[stopIndex - 1] || "";
  if (rel === "{本站英文同名文件}") {
    // 英文站名语音文件匹配规则：英文语音 = 「英文站名」 或 「E+中文站名」。
    // 英文站名本身优先级最高；其次 E+/En+/E/En + 中文站名。
    // 修正：此前用英文站名拼 E 前缀（E+英文站名），应为中文站名（E+中文站名）。
    // 覆盖 本站英文 / 下站英文 / 起始站英文 / 终点站英文 四条匹配路径。
    const enName = map[`${dir}:${stopIndex}:name`] || fallbackName || "";
    const urls = [];
    const relParts = [];
    if (enName) {
      const r = resolveSameNameAudioToken(enName, [""]);
      urls.push(...r.urls);
      relParts.push(`${enName}.*`);
    }
    if (zhName) {
      const r = resolveSameNameAudioToken(zhName, ["E+", "En+", "E", "En"]);
      urls.push(...r.urls);
      relParts.push(`E+${zhName}.*`);
    }
    if (!urls.length) return null;
    return { rel: relParts.join(" | "), urls, url: urls[0] || "" };
  }
  const urls = audioUrlCandidatesForRelative(rel);
  return { rel, urls, url: urls[0] };
}

function expandFileTokens(part) {
  if (!part || part === "【无】") return [];
  const raw = String(part).trim();
  if (!raw.includes("+")) return [raw];

  const pieces = raw
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean);

  const looksLikeAudioFile = (s) => /\.(wav|mp3|m4a)$/i.test(s);
  if (pieces.length >= 2 && pieces.every(looksLikeAudioFile)) {
    return pieces;
  }
  return [raw];
}

function specialAudioForStation(stationName, dir) {
  if (!state.route || !stationName) return "";
  const d = dir === undefined ? state.direction : dir;
  const map = state.route.directions[d].special_audio_map || {};
  return map[stationName] || "";
}

/** displayTag: 'next' | 'here' | null */
function toAudioEntries(parts, ctx, dirOverride) {
  const d = dirOverride === undefined ? state.direction : dirOverride;
  const entries = [];
  for (const part of parts) {
    if (!part || part === "【无】") continue;
    if (part === "【本站】" || part === "【本站中文】") {
      const name = ctx.ben_zhan;
      const hit = resolveStationAudio(name, ctx.stop_index);
      if (hit)
        entries.push({
          type: "file",
          value: hit.rel,
          urls: hit.urls,
          url: hit.url,
          displayTag: "here",
          paramLabel: "本站中文",
          displayFile: basenameOf(hit.rel),
        });
      else entries.push({ type: "missing", label: `【本站】未匹配：${name}` });
      continue;
    }
    if (part === "【本站英文】" || part === "【英文本站】") {
      const idx = ctx.ben_zhan_index != null ? ctx.ben_zhan_index : (state.awaitingArrival ? state.stopNumber : Math.max(1, state.stopNumber - 1));
      const enName = (state.route?.directions?.[d]?.stations_en || [])[idx - 1] || "";
      const hit = resolveStationAudioEn(d, idx, enName);
      if (hit)
        entries.push({
          type: "file",
          value: hit.rel,
          urls: hit.urls,
          url: hit.url,
          displayTag: "here",
          paramLabel: "本站英文",
          displayFile: basenameOf(hit.rel),
        });
      else entries.push({ type: "missing", label: `【本站英文】未匹配：${enName || idx}` });
      continue;
    }
    if (part === "【下站】" || part === "【下站中文】") {
      const name = ctx.xia_zhan;
      const hit = resolveStationAudio(name, ctx.xia_stop_index);
      if (hit)
        entries.push({
          type: "file",
          value: hit.rel,
          urls: hit.urls,
          url: hit.url,
          displayTag: "next",
          paramLabel: "下站中文",
          displayFile: basenameOf(hit.rel),
        });
      else entries.push({ type: "missing", label: `【下一站中文】未匹配：${name}` });
      continue;
    }
    if (part === "【下站英文】" || part === "【英文下站】") {
      const idx = ctx.xia_zhan_index != null ? ctx.xia_zhan_index : (state.awaitingArrival ? state.stopNumber : Math.min((state.route?.directions?.[d]?.stations || []).length, state.stopNumber + 1));
      const enName = (state.route?.directions?.[d]?.stations_en || [])[idx - 1] || "";
      const hit = resolveStationAudioEn(d, idx, enName);
      if (hit)
        entries.push({
          type: "file",
          value: hit.rel,
          urls: hit.urls,
          url: hit.url,
          displayTag: "next",
          paramLabel: "下站英文",
          displayFile: basenameOf(hit.rel),
        });
      else entries.push({ type: "missing", label: `【下一站英文】未匹配：${enName || idx}` });
      continue;
    }
    if (part === "【起始站中文】") {
      const hit = resolveDirectionEndpointAudio(d, "start", "zh");
      if (hit) entries.push({ type: "file", value: hit.rel, urls: hit.urls, url: hit.url, displayTag: "here", paramLabel: "起始站中文", displayFile: basenameOf(hit.rel) });
      else entries.push({ type: "missing", label: "【起始站中文】未匹配" });
      continue;
    }
    if (part === "【起始站英文】") {
      const hit = resolveDirectionEndpointAudio(d, "start", "en");
      if (hit) entries.push({ type: "file", value: hit.rel, urls: hit.urls, url: hit.url, displayTag: "here", paramLabel: "起始站英文", displayFile: basenameOf(hit.rel) });
      else entries.push({ type: "missing", label: "【起始站英文】未匹配" });
      continue;
    }
    if (part === "【终点站中文】") {
      const hit = resolveDirectionEndpointAudio(d, "end", "zh");
      if (hit) entries.push({ type: "file", value: hit.rel, urls: hit.urls, url: hit.url, displayTag: "next", paramLabel: "终点站中文", displayFile: basenameOf(hit.rel) });
      else entries.push({ type: "missing", label: "【终点站中文】未匹配" });
      continue;
    }
    if (part === "【终点站英文】") {
      const hit = resolveDirectionEndpointAudio(d, "end", "en");
      if (hit) entries.push({ type: "file", value: hit.rel, urls: hit.urls, url: hit.url, displayTag: "next", paramLabel: "终点站英文", displayFile: basenameOf(hit.rel) });
      else entries.push({ type: "missing", label: "【终点站英文】未匹配" });
      continue;
    }
    if (part === "【特殊语句】") {
      const sp = specialAudioForStation(ctx.special_station, d);
      if (sp) {
        for (const chunk of expandFileTokens(sp)) {
          entries.push({
            type: "file",
            value: chunk,
            urls: audioUrlCandidatesForRelative(chunk),
            url: audioUrlCandidatesForRelative(chunk)[0],
            displayTag: null,
            displayFile: basenameOf(chunk),
          });
        }
      }
      continue;
    }
    // Skip unknown param tokens (e.g. unexpanded 【普通站预报模板】) instead of treating them as files
    if (/^【[^】]+】$/.test(part) || /^\{[^}]+\}$/.test(part)) {
      entries.push({ type: "missing", label: "未识别的参数：" + part });
      continue;
    }
    for (const chunk of expandFileTokens(part)) {
      entries.push({
        type: "file",
        value: chunk,
        urls: audioUrlCandidatesForRelative(chunk),
        url: audioUrlCandidatesForRelative(chunk)[0],
        displayTag: null,
        displayFile: basenameOf(chunk),
      });
    }
  }
  return entries;
}

function getFirstDepartureWelcomeParts(forDirection) {
  const fd = state.route?.first_departure_forecast;
  if (!fd) return [];
  const shared = Array.isArray(fd.shared) ? fd.shared : [];
  const dirKey = (forDirection === undefined ? state.direction : forDirection) === "up" ? "up" : "down";
  const dirL = Array.isArray(fd[dirKey]) ? fd[dirKey] : [];
  return [...shared, ...dirL];
}

function updateExternalDisplay() {
  if (!lineExternalDisplay) return;
  const stations = getStations();
  const term = stations.length ? stations[stations.length - 1] : "";
  const selectedRouteLabel = routeSelect?.options?.[routeSelect.selectedIndex]?.textContent || "";
  const badge = state.mode === "new"
    ? (state.route?.name || selectedRouteLabel.replace(/\.ini$/i, ""))
    : (selectedRouteLabel || state.route?.name || "");
  const termCnEl = document.getElementById("routeTermCnDisplay");
  if (term) {
    // badge stays in column 1; terminal CN + EN share column 2 so the EN
    // left edge always aligns with the CN terminal name.
    lineExternalDisplay.textContent = badge ? badge + " ➜" : "";
    if (termCnEl) termCnEl.textContent = term;
    if (routeDestinationEnDisplay) {
      routeDestinationEnDisplay.textContent = stations.length ? stationEnAtOneBased(stations.length) : "";
    }
  } else {
    lineExternalDisplay.textContent = badge || "—";
    if (termCnEl) termCnEl.textContent = "";
    if (routeDestinationEnDisplay) routeDestinationEnDisplay.textContent = "";
  }
}

function stationOverrideFor(dir, stopIndex, kind) {
  const o = state.route?.station_rule_overrides?.[dir]?.[stopIndex];
  const arr = o?.[kind];
  return Array.isArray(arr) && arr.length ? arr : null;
}

function attachQueueDebugMeta(queue, meta) {
  if (queue && meta) queue.__debugMeta = meta;
  return queue;
}

function forecastTemplateInfo(headingOneBased, stations, dirOverride) {
  const n = stations.length;
  const dir = dirOverride === undefined ? state.direction : dirOverride;
  const dirTpl = state.route?.__templatesByDir?.[dir] || null;
  const headingToTerminal = n > 0 && headingOneBased === n;
  if (headingOneBased === 2 && dirTpl?.first_depart?.length) {
    return { tokens: dirTpl.first_depart, source: "first_depart", fallbackChain: ["下行/上行首站预报规则（命中）"] };
  }
  if (headingToTerminal && (dirTpl?.terminal_depart?.length || state.route.templates.terminal_depart)) {
    return {
      tokens: dirTpl?.terminal_depart?.length ? dirTpl.terminal_depart : state.route.templates.terminal_depart,
      source: "terminal_depart",
      fallbackChain: [dirTpl?.terminal_depart?.length ? "本方向终点站预报规则（命中）" : "回退到全局终点站预报规则"],
    };
  }
  if (dirTpl?.depart?.length) return { tokens: dirTpl.depart, source: "depart", fallbackChain: ["本方向默认预报规则（命中）"] };
  return { tokens: state.route.templates.depart, source: "global_depart", fallbackChain: ["回退到全局默认预报规则"] };
}

function arrivalTemplateInfo(stopIndex, stations, dirOverride) {
  const dir = dirOverride === undefined ? state.direction : dirOverride;
  const dirTpl = state.route?.__templatesByDir?.[dir] || null;
  const here = stationAtOneBased(stopIndex, dir);
  const isTerminal = stations.length > 0 && here === stations[stations.length - 1];
  if (isTerminal) {
    return {
      tokens: dirTpl?.terminal_arrive?.length ? dirTpl.terminal_arrive : state.route.templates.terminal_arrive,
      source: "terminal_arrive",
      fallbackChain: [dirTpl?.terminal_arrive?.length ? "本方向终点站到站规则（命中）" : "回退到全局终点站到站规则"],
    };
  }
  if (dirTpl?.arrive?.length) return { tokens: dirTpl.arrive, source: "arrive", fallbackChain: ["本方向默认到站规则（命中）"] };
  return { tokens: state.route.templates.arrive, source: "global_arrive", fallbackChain: ["回退到全局默认到站规则"] };
}

function buildDebugPayload(meta, normalizedQueue) {
  const rawQueue = (normalizedQueue || []).map((item) => ({
    type: item.type,
    source: item.value || item.label || "",
    candidates: item.urls || (item.url ? [item.url] : []),
    matched: item.type === "file" ? (item.url || "") : "",
    final: item.displayFile || item.label || item.value || "",
  }));
  return {
    mode: state.mode,
    routeName: state.route?.name || "",
    playback: meta?.kind || "",
    direction: meta?.direction || state.direction,
    stopNumber: meta?.stopNumber || state.stopNumber,
    templateSource: meta?.templateSource || "",
    templateTokens: meta?.templateTokens || [],
    prefixTokens: meta?.prefixTokens || [],
    fallbackChain: meta?.fallbackChain || [],
    matchingResult: rawQueue,
  };
}

function forecastTemplateForHeadingIndex(headingOneBased, stations, dirOverride) {
  return forecastTemplateInfo(headingOneBased, stations, dirOverride).tokens;
}

function buildForecastQueueWithState(wasFirstStop) {
  const stations = getStations();
  const sn = state.stopNumber;
  const here = stationAtOneBased(sn);
  const isTerminal = stations.length > 0 && sn === stations.length;
  // V1.6: For terminal forecast, 本站 = destination (last station), not current
  const benZhan = isTerminal ? here : stationAtOneBased(sn - 1);
  const ctx = {
    ben_zhan: benZhan,
    xia_zhan: here,
    special_station: here,
    stop_index: sn,
    xia_stop_index: sn,
    ben_zhan_index: isTerminal ? sn : Math.max(1, sn - 1),
    xia_zhan_index: sn,
  };
  let prefix = [];
  if (wasFirstStop) {
    prefix = getFirstDepartureWelcomeParts(state.direction).flatMap((p) => expandFileTokens(p));
  }
  const defaultTplInfo = forecastTemplateInfo(sn, stations, state.direction);
  const overrideTokens = stationOverrideFor(state.direction, sn, "depart");
  const tplInfo = overrideTokens && overrideTokens.includes("【默认模版】")
    ? { tokens: expandDefaultTemplateInTokens(overrideTokens, defaultTplInfo.tokens), source: "station_override_with_default_template", fallbackChain: ["各站预报规则(含{默认模版}展开)"] }
    : overrideTokens
      ? { tokens: overrideTokens, source: "station_override_depart", fallbackChain: ["各站预报规则覆盖默认模板"] }
      : defaultTplInfo;
  const tpl = tplInfo.tokens;
  const body = toAudioEntries(tpl || state.route.templates.depart, ctx);
  const prefixEntries = prefix.map((chunk) => ({
    type: "file",
    value: chunk,
    url: audioUrlCandidatesForRelative(chunk)[0],
    urls: audioUrlCandidatesForRelative(chunk),
    displayTag: null,
    displayFile: basenameOf(chunk),
  }));
  return attachQueueDebugMeta([...prefixEntries, ...body], {
    kind: "forecast",
    direction: state.direction,
    stopNumber: sn,
    templateSource: tplInfo.source,
    templateTokens: tpl || [],
    prefixTokens: prefix,
    fallbackChain: tplInfo.fallbackChain,
  });
}

function buildForecastQueueReplay(snap) {
  const stations = stationsForDirection(snap.direction);
  const sn = snap.headingStopNumber;
  const here = stationAtOneBased(sn, snap.direction);
  const isTerminal2 = stations.length > 0 && sn === stations.length;
  const benZhan2 = isTerminal2 ? here : stationAtOneBased(sn - 1, snap.direction);
  const ctx = {
    ben_zhan: benZhan2,
    xia_zhan: here,
    special_station: here,
    stop_index: sn,
    xia_stop_index: sn,
    ben_zhan_index: isTerminal2 ? sn : Math.max(1, sn - 1),
    xia_zhan_index: sn,
  };
  let prefix = [];
  if (snap.wasFirstStop) {
    prefix = getFirstDepartureWelcomeParts(snap.direction).flatMap((p) => expandFileTokens(p));
  }
  const defaultTplInfo = forecastTemplateInfo(sn, stations, snap.direction);
  const overrideTokens = stationOverrideFor(snap.direction, sn, "depart");
  const tplInfo = overrideTokens && overrideTokens.includes("【默认模版】")
    ? { tokens: expandDefaultTemplateInTokens(overrideTokens, defaultTplInfo.tokens), source: "station_override_with_default_template", fallbackChain: ["各站预报规则(含{默认模版}展开)"] }
    : overrideTokens
      ? { tokens: overrideTokens, source: "station_override_depart", fallbackChain: ["各站预报规则覆盖默认模板"] }
      : defaultTplInfo;
  const tpl = tplInfo.tokens;
  const body = toAudioEntries(tpl || state.route.templates.depart, ctx, snap.direction);
  const prefixEntries = prefix.map((chunk) => ({
    type: "file",
    value: chunk,
    url: audioUrlCandidatesForRelative(chunk)[0],
    urls: audioUrlCandidatesForRelative(chunk),
    displayTag: null,
    displayFile: basenameOf(chunk),
  }));
  return attachQueueDebugMeta([...prefixEntries, ...body], {
    kind: "forecast-replay",
    direction: snap.direction,
    stopNumber: sn,
    templateSource: tplInfo.source,
    templateTokens: tpl || [],
    prefixTokens: prefix,
    fallbackChain: tplInfo.fallbackChain,
  });
}

function buildArrivalQueueForState() {
  const stations = getStations();
  const n = stations.length;
  if (n === 0) return [];
  const here = stationAtOneBased(state.stopNumber);
  const ctx = {
    ben_zhan: here,
    xia_zhan: stationAtOneBased(state.stopNumber + 1) || here,
    special_station: here,
    stop_index: state.stopNumber,
    xia_stop_index: state.stopNumber + 1,
    ben_zhan_index: state.stopNumber,
    xia_zhan_index: Math.min(state.stopNumber + 1, n),
  };
  const defaultTplInfo = arrivalTemplateInfo(state.stopNumber, stations, state.direction);
  const overrideTokens = stationOverrideFor(state.direction, state.stopNumber, "arrive");
  const tplInfo = overrideTokens && overrideTokens.includes("【默认模版】")
    ? { tokens: expandDefaultTemplateInTokens(overrideTokens, defaultTplInfo.tokens), source: "station_override_with_default_template", fallbackChain: ["各站到站规则(含{默认模版}展开)"] }
    : overrideTokens
      ? { tokens: overrideTokens, source: "station_override_arrive", fallbackChain: ["各站到站规则覆盖默认模板"] }
      : defaultTplInfo;
  const tpl = tplInfo.tokens;
  return attachQueueDebugMeta(toAudioEntries(tpl || state.route.templates.arrive, ctx), {
    kind: "arrival",
    direction: state.direction,
    stopNumber: state.stopNumber,
    templateSource: tplInfo.source,
    templateTokens: tpl || [],
    prefixTokens: [],
    fallbackChain: tplInfo.fallbackChain,
  });
}

function buildArrivalQueueReplay(snap) {
  const stations = stationsForDirection(snap.direction);
  const sn = snap.stopNumber;
  const here = stationAtOneBased(sn, snap.direction);
  const ctx = {
    ben_zhan: here,
    xia_zhan: stationAtOneBased(sn + 1, snap.direction) || here,
    special_station: here,
    stop_index: sn,
    xia_stop_index: sn + 1,
    ben_zhan_index: sn,
    xia_zhan_index: Math.min(sn + 1, stations.length),
  };
  const defaultTplInfo = arrivalTemplateInfo(sn, stations, snap.direction);
  const overrideTokens = stationOverrideFor(snap.direction, sn, "arrive");
  const tplInfo = overrideTokens && overrideTokens.includes("【默认模版】")
    ? { tokens: expandDefaultTemplateInTokens(overrideTokens, defaultTplInfo.tokens), source: "station_override_with_default_template", fallbackChain: ["各站到站规则(含{默认模版}展开)"] }
    : overrideTokens
      ? { tokens: overrideTokens, source: "station_override_arrive", fallbackChain: ["各站到站规则覆盖默认模板"] }
      : defaultTplInfo;
  const tpl = tplInfo.tokens;
  return attachQueueDebugMeta(toAudioEntries(tpl || state.route.templates.arrive, ctx, snap.direction), {
    kind: "arrival-replay",
    direction: snap.direction,
    stopNumber: sn,
    templateSource: tplInfo.source,
    templateTokens: tpl || [],
    prefixTokens: [],
    fallbackChain: tplInfo.fallbackChain,
  });
}

function playTipByIndex(oneBased) {
  const idx = oneBased - 1;
  const item = state.route?.tips?.[idx];
  if (!item || item === "【无】") return;
  const parts = expandFileTokens(item).map((chunk) => ({
    type: "file",
    value: chunk,
    url: audioUrlCandidatesForRelative(chunk)[0],
    urls: audioUrlCandidatesForRelative(chunk),
    displayTag: null,
    displayFile: basenameOf(chunk),
  }));
  playQueue(parts);
}

function renderTipButtons() {
  if (!tipButtons) return;
  tipButtons.innerHTML = "";
  const tips = state.route?.tips || [];
  const labels = state.route?.tip_labels || [];
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
  let rendered = 0;
  tips.forEach((val, idx) => {
    if (!val || val === "【无】") return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.tip = String(idx + 1);
    btn.className = "tip-button";
    const name = (labels[idx] || "").trim() || `服务语${idx + 1}`;
    btn.innerHTML = `<i>${keys[idx] || ""}</i><span>${name}</span>`;
    btn.addEventListener("click", () => playTipByIndex(idx + 1));
    tipButtons.appendChild(btn);
    rendered += 1;
  });
  if (!rendered) tipButtons.innerHTML = '<p class="tip-empty">未设置手按提示语。</p>';
}

function renderQueue(queue, activeIndex = -1, completedThrough = -1) {
  queueView.innerHTML = "";
  if (queueStateDisplay) {
    queueStateDisplay.textContent = activeIndex >= 0
      ? "正在播放"
      : queue.length && completedThrough >= queue.length - 1
        ? "播放完成"
        : "就绪";
  }
  if (queue.length === 0) {
    const placeholder = document.createElement("li");
    placeholder.className = "queue-item queue-placeholder upcoming";
    placeholder.innerHTML = '<i class="queue-icon">⌛</i><span class="queue-number">—</span><span class="queue-content">播放后的真实语音队列会显示在这里</span>';
    queueView.appendChild(placeholder);
    return;
  }
  queue.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = "queue-item";
    const isError = item.type === "missing" || item.type === "error";
    if (isError) li.classList.add("error");
    else if (index === activeIndex) li.classList.add("current");
    else if (index <= completedThrough) li.classList.add("played");
    else li.classList.add("upcoming");

    const icon = document.createElement("i");
    icon.className = "queue-icon";
    icon.textContent = isError ? "✕" : index === activeIndex ? "▶" : index <= completedThrough ? "✓" : "⌛";
    const number = document.createElement("span");
    number.className = "queue-number";
    number.textContent = String(index + 1);
    const content = document.createElement("span");
    content.className = "queue-content";
    if (item.type === "file") {
      // Parameter-matched audio (本站中文 / 下站英文 …) gets a label tag in front.
      if (item.paramLabel) {
        const tag = document.createElement("span");
        tag.className = "queue-tag " + (item.displayTag === "next" ? "queue-tag-next" : "queue-tag-here");
        tag.textContent = item.paramLabel;
        content.appendChild(tag);
      }
      content.appendChild(document.createTextNode(item.displayFile || item.label || basenameOf(item.value)));
    } else if (item.type === "missing") {
      content.appendChild(document.createTextNode(`${item.label || ""}（文件不存在）`));
    } else if (item.type === "error") {
      content.appendChild(document.createTextNode(`${item.label || item.displayFile || ""}（播放失败）`));
    } else {
      content.textContent = String(item.label || "");
    }
    li.append(icon, number, content);
    queueView.appendChild(li);
  });
}

async function markMissingFiles(queue) {
  const checked = [];
  for (const item of queue) {
    if (item.type !== "file") {
      checked.push(item);
      continue;
    }

    const candidates = Array.isArray(item.urls) && item.urls.length
      ? item.urls
      : [item.url || audioUrlCandidatesForRelative(item.value)[0]];

    let matchedUrl = "";
    for (const src of candidates) {
      try {
        const resp = await fetch(src, { method: "HEAD" });
        if (resp.ok) {
          matchedUrl = src;
          break;
        }
      } catch {
        /* try next */
      }
    }

    if (!matchedUrl) {
      checked.push({
        type: "missing",
        label: item.displayFile || basenameOf(item.value) || item.value,
      });
      continue;
    }

    // Resolve the real filename for pattern rules (e.g. `站名.*` / `E+|En+|E|En站名.*`)
    // so the queue shows the actual matched file instead of the rule text.
    let resolvedFile = item.displayFile;
    try {
      const lastSeg = String(matchedUrl).split("/").pop() || "";
      const decoded = decodeURIComponent(lastSeg);
      if (decoded) resolvedFile = decoded;
    } catch {
      /* keep displayFile */
    }
    checked.push({ ...item, url: matchedUrl, urls: candidates, displayFile: resolvedFile });
  }
  if (queue?.__debugMeta) checked.__debugMeta = queue.__debugMeta;
  return checked;
}

/**
 * @param {{ onFirstAudioStart?: () => void }} opts
 */
async function playQueue(queue, opts = {}) {
  interruptPlayback();
  const myToken = playbackToken;
  const normalizedQueue = await markMissingFiles(queue);
  if (myToken !== playbackToken) return;

  renderQueue(normalizedQueue);
  if (state.devMode && normalizedQueue.__debugMeta) {
    setDebug(buildDebugPayload(normalizedQueue.__debugMeta, normalizedQueue));
  }
  const hasPlayable = normalizedQueue.some((i) => i.type === "file");
  if (!hasPlayable && opts.onFirstAudioStart) {
    opts.onFirstAudioStart();
  }
  let firstAudio = true;

  for (let i = 0; i < normalizedQueue.length; i += 1) {
    const item = normalizedQueue[i];
    if (myToken !== playbackToken) return;
    if (item.type !== "file") continue;

    const src = item.url || audioUrlForRelative(item.value);
    try {
      renderQueue(normalizedQueue, i, i - 1);
      const audio = new Audio(src);
      audio.volume = state.playbackVolume;
      currentAudioEl = audio;
      await new Promise((resolve, reject) => {
        const done = () => {
          currentAudioEl = null;
          resolve();
        };
        audio.onended = done;
        audio.onerror = () => {
          currentAudioEl = null;
          reject(new Error("load fail"));
        };
        audio.onplaying = () => {
          if (firstAudio && opts.onFirstAudioStart) {
            opts.onFirstAudioStart();
            firstAudio = false;
          }
        };
        audio.play().catch(reject);
      });
      renderQueue(normalizedQueue, -1, i);
      } catch {
      normalizedQueue[i] = {
        type: "error",
        label: item.displayFile || basenameOf(item.value) || item.value,
      };
        renderQueue(normalizedQueue, -1, i - 1);
      console.warn("音频播放失败:", src);
    }
  }
  renderQueue(normalizedQueue, -1, normalizedQueue.length - 1);
}

function labelClassForIndex(i) {
  const base = dotClassForIndex(i);
  if (base === "st-heading") return "lbl-heading";
  if (base === "st-arrived") return "lbl-arrived";
  if (base === "st-passed") return "lbl-passed";
  return "lbl-pending";
}

function syncStationJumpOptions() {
  const stations = getStations();
  stationJumpSelect.innerHTML = "";
  stations.forEach((name, idx) => {
    const op = document.createElement("option");
    op.value = String(idx);
    op.textContent = `${idx + 1}. ${name}`;
    stationJumpSelect.appendChild(op);
  });
  stationJumpSelect.value = String(Math.min(state.stopNumber - 1, Math.max(stations.length - 1, 0)));
}

/**
 * @param {{ scrollMode?: 'follow' | 'center' }} options
 */
function refreshTripUi(options = {}) {
  const scrollMode = options.scrollMode || "follow";
  const stations = getStations();
  const n = stations.length;
  stopTotalDisplay.textContent = String(n);
  stopNumberDisplay.textContent = String(state.stopNumber);
  updateExternalDisplay();
  syncStationJumpOptions();

  if (n === 0) {
    if (phaseLabel) phaseLabel.textContent = "无站点数据";
    if (currentStationDisplay) currentStationDisplay.textContent = "—";
    if (currentStationEnDisplay) currentStationEnDisplay.textContent = "";
    preBtn.disabled = true;
    arriveBtn.disabled = true;
    if (nextAnnounceBtn) nextAnnounceBtn.disabled = true;
    routeMap.innerHTML = "";
    return;
  }

  preBtn.disabled = false;
  arriveBtn.disabled = state.stopNumber === 1 && !state.awaitingArrival;
  if (nextAnnounceBtn) nextAnnounceBtn.disabled = false;

  const name = stationAtOneBased(state.stopNumber);
  const english = stationEnAtOneBased(state.stopNumber);
  phaseDisplay.classList.toggle("heading", state.awaitingArrival);
  phaseDisplay.classList.toggle("arrival", !state.awaitingArrival);
  if (phaseLabel) phaseLabel.textContent = state.awaitingArrival ? "下一站 NEXT" : "到站 ARRIVING";
  if (currentStationDisplay) currentStationDisplay.textContent = name;
  if (currentStationEnDisplay) currentStationEnDisplay.textContent = english;
  if (nextActionHint) {
    // 到站态（awaitingArrival=false）时「播报下一条」预报的是下一站；
    // 显示下一站名而非当前站名，避免误导（如到 2 站后提示应为「3站预报」）。
    let hintName = name;
    if (!state.awaitingArrival) {
      const sts = getStations();
      const n2 = sts.length;
      if (state.stopNumber >= n2) {
        // 末站到站后预报会换向并播新方向第一站
        const otherDir = state.direction === "up" ? "down" : "up";
        hintName = (state.route?.directions?.[otherDir]?.stations || [])[1] || "";
      } else {
        hintName = stationAtOneBased(state.stopNumber + 1);
      }
    }
    nextActionHint.textContent = `${hintName}${state.awaitingArrival ? "到站" : "预报"}`;
  }

  renderRouteMap();
  requestAnimationFrame(() => {
    scrollRouteMapActive(scrollMode);
    // Re-enable smooth scrolling after repositioning
    if (routeMapScroll) routeMapScroll.style.scrollBehavior = _routeMapSavedBehavior || '';
  });
}

function dotClassForIndex(i) {
  const stations = getStations();
  const n = stations.length;
  if (i < 0 || i >= n) return "st-pending";

  if (state.awaitingArrival) {
    const h = state.stopNumber - 1;
    if (i < h) return "st-passed";
    if (i === h) return "st-heading";
    return "st-pending";
  }

  const a = state.stopNumber - 1;
  if (i < a) return "st-passed";
  if (i === a) return "st-arrived";
  return "st-pending";
}

function connectorClassForIndex(i) {
  if (state.awaitingArrival) {
    const h = state.stopNumber - 1;
    if (i < h - 1) return "conn-passed";
    if (i === h - 1) return "conn-heading";
    return "conn-pending";
  }

  const a = state.stopNumber - 1;
  if (i < a) return "conn-passed";
  return "conn-pending";
}

function twoCharGapPx() {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.whiteSpace = "pre";
  probe.textContent = "00";
  routeMap.appendChild(probe);
  const width = Math.max(14, probe.getBoundingClientRect().width);
  probe.remove();
  return width;
}

function adjustRouteMapLayout(cols, connectors) {
  const dotSize = 32;
  const stationWidth = 142;
  cols.forEach((col) => {
    col.style.width = `${stationWidth}px`;
    col.style.marginRight = "0";
  });
  connectors.forEach((line) => {
    line.style.width = `${stationWidth}px`;
  });
}

var _routeMapSavedBehavior = '';
function renderRouteMap() {
  const stations = getStations();
  const stationsEn = state.route?.directions?.[state.direction]?.stations_en || [];
  // Disable smooth scrolling during rebuild to prevent visual jump
  _routeMapSavedBehavior = routeMapScroll ? routeMapScroll.style.scrollBehavior : '';
  if (routeMapScroll) routeMapScroll.style.scrollBehavior = 'auto';
  const savedScroll = routeMapScroll ? routeMapScroll.scrollLeft : 0;
  routeMap.innerHTML = "";
  if (stations.length === 0) {
    // Restore smooth scroll before early return
    if (routeMapScroll) routeMapScroll.style.scrollBehavior = _routeMapSavedBehavior || '';
    return;
  }

  const row = document.createElement("div");
  row.className = "route-map-cols";

  const n = stations.length;
  const cols = [];
  const connectors = [];

  stations.forEach((name, i) => {
    const col = document.createElement("div");
    col.className = "route-col";

    const dotRow = document.createElement("div");
    dotRow.className = "route-dot-row";

    const dot = document.createElement("div");
    dot.className = `route-dot ${dotClassForIndex(i)}`;
    dot.dataset.stationIndex = String(i);
    dot.title = name;
    dot.textContent = String(i + 1);
    dot.tabIndex = 0;
    dot.setAttribute("role", "button");
    dot.setAttribute("aria-label", `跳转到第${i + 1}站 ${name}`);
    dotRow.appendChild(dot);

    if (i < n - 1) {
      const line = document.createElement("div");
      line.className = `route-connector ${connectorClassForIndex(i)}`;
      dotRow.appendChild(line);
      connectors.push(line);
    }

    col.appendChild(dotRow);

    const label = document.createElement("div");
    label.className = `route-label ${labelClassForIndex(i)}`;
    label.dataset.stationIndex = String(i);
    label.tabIndex = 0;
    label.setAttribute("role", "button");
    label.innerHTML = `<b></b><small></small>`;
    label.querySelector("b").textContent = name;
    label.querySelector("small").textContent = stationsEn[i] || "";
    const jumpViaExistingControl = () => {
      stationJumpSelect.value = String(i);
      stationJumpSelect.dispatchEvent(new Event("change", { bubbles: true }));
    };
    dot.addEventListener("click", jumpViaExistingControl);
    label.addEventListener("click", jumpViaExistingControl);
    [dot, label].forEach((node) => node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        jumpViaExistingControl();
      }
    }));
    col.appendChild(label);

    row.appendChild(col);
    cols.push(col);
  });

  routeMap.appendChild(row);
  adjustRouteMapLayout(cols, connectors);
  // Restore scroll after DOM is rebuilt (content width > 0, so scrollLeft can take effect)
  if (routeMapScroll) routeMapScroll.scrollLeft = savedScroll;
}

function getActiveStationIndex() {
  const stations = getStations();
  const n = stations.length;
  if (n === 0) return -1;
  return state.awaitingArrival ? state.stopNumber - 1 : state.stopNumber - 1;
}

function offsetLeftWithin(node, ancestor) {
  const ar = ancestor.getBoundingClientRect();
  const nr = node.getBoundingClientRect();
  return nr.left - ar.left;
}

function scrollRouteMapActive(mode) {
  if (!routeMapScroll || !routeMap) return;
  const idx = getActiveStationIndex();
  if (idx < 0) return;

  const dot = routeMap.querySelector(`.route-dot[data-station-index="${idx}"]`);
  if (!dot) return;

  const sc = routeMapScroll;
  const content = routeMap;
  const dotLeft = offsetLeftWithin(dot, content);
  const dotWidth = dot.offsetWidth;
  const dotCenter = dotLeft + dotWidth / 2;
  const maxScroll = Math.max(0, content.offsetWidth - sc.clientWidth);
  const targetCenter = dotCenter - sc.clientWidth / 2;
  sc.scrollTo({
    left: Math.max(0, Math.min(maxScroll, targetCenter)),
    behavior: mode === "center" ? "smooth" : "smooth",
  });
}

/** 预报一步：更新站序并播预报 */
function advanceForecastState() {
  const n = getStations().length;
  let wasFirstStop = false;

  var isLoop2 = state.route && state.route.isLoop;

  if (!state.awaitingArrival && n > 0 && state.stopNumber >= n) {
    if (!isLoop2) {
      state.direction = state.direction === "up" ? "down" : "up";
      directionSelect.value = state.direction;
    }
    state.stopNumber = 1;
    state.awaitingArrival = false;
  }

  if (!state.awaitingArrival) {
    wasFirstStop = state.stopNumber === 1;
    state.stopNumber += 1;
    state.awaitingArrival = true;
  } else if (state.stopNumber >= n && n > 0) {
    if (!isLoop2) {
      state.direction = state.direction === "up" ? "down" : "up";
      directionSelect.value = state.direction;
    }
    wasFirstStop = true;
    state.stopNumber = 2;
    state.awaitingArrival = true;
  } else {
    wasFirstStop = false;
    state.stopNumber += 1;
    state.awaitingArrival = true;
  }

  return wasFirstStop;
}

async function runForecast() {
  const n = getStations().length;
  if (n === 0) return;

  const prev = {
    stopNumber: state.stopNumber,
    awaitingArrival: state.awaitingArrival,
    direction: state.direction,
  };

  const wasFirstStop = advanceForecastState();
  const maxN = stationsForDirection(state.direction).length;

  if (state.stopNumber < 1 || state.stopNumber > maxN) {
    state.stopNumber = prev.stopNumber;
    state.awaitingArrival = prev.awaitingArrival;
    state.direction = prev.direction;
    directionSelect.value = state.direction;
    refreshTripUi();
    return;
  }

  refreshTripUi();

  const q = buildForecastQueueWithState(wasFirstStop);
  if (!q.length) {
    state.stopNumber = prev.stopNumber;
    state.awaitingArrival = prev.awaitingArrival;
    state.direction = prev.direction;
    directionSelect.value = state.direction;
    refreshTripUi();
    return;
  }

  lastMainPlayback = {
    kind: "forecast",
    direction: state.direction,
    headingStopNumber: state.stopNumber,
    wasFirstStop,
  };

  await playQueue(q);
}

async function runArrival() {
  const stations = getStations();
  const n = stations.length;
  if (n === 0) return;
  if (state.stopNumber === 1 && !state.awaitingArrival) return;

  const q = buildArrivalQueueForState();
  if (!q.length) return;

  state.awaitingArrival = false;
  refreshTripUi();

  lastMainPlayback = {
    kind: "arrival",
    direction: state.direction,
    stopNumber: state.stopNumber,
  };

  await playQueue(q);
}

function runReplay() {
  if (!state.route) return;
  // 重播必须与原预报共用同一条组队列逻辑；否则会绕过各站特殊规则。
  const snap = lastMainPlayback && lastMainPlayback.kind === "forecast"
    ? lastMainPlayback
    : { kind: "forecast", direction: state.direction, headingStopNumber: state.stopNumber, wasFirstStop: false };
  const stations = stationsForDirection(snap.direction);
  if (!stations.length || snap.headingStopNumber < 1 || snap.headingStopNumber > stations.length) return;

  const q = buildForecastQueueReplay(snap);
  if (!q.length) return;

  state.direction = snap.direction;
  state.stopNumber = snap.headingStopNumber;
  directionSelect.value = state.direction;
  state.awaitingArrival = true;
  refreshTripUi();

  lastMainPlayback = snap;

  playQueue(q);
}

function setEditorDockEnabled(enabled) {
  if (editorToggle) editorToggle.style.display = (enabled && state.funct.show_legacy_editor) ? "block" : "none";
  if (!enabled && fileSidebar) fileSidebar.classList.remove("open");
  if (!enabled && appRoot) appRoot.classList.remove("with-dock");
}

async function switchMode(mode) {
  clearPlaybackState();
  state.mode = mode;
  state.route = null;
  state.stopNumber = 1;
  state.awaitingArrival = false;

  const inNew = mode === "new";
  setEditorDockEnabled(inNew);
  if (companyRouteWrap) companyRouteWrap.style.display = inNew ? "grid" : "none";

  if (inNew) {
    await loadNewIndex();
    syncCompanyOptions();
    syncRouteOptionsByCompany();

    if (routeSelect.options.length) {
      routeSelect.value = state.currentLineFile || routeSelect.options[0].value;
      state.currentLineFile = routeSelect.value;
      await loadRouteFromNewMode(state.currentLineFile);
    } else {
      refreshTripUi({ scrollMode: "center" });
    }
  } else {
    await loadIndexCompat();
  }

  runAutoChecks();
}

document.getElementById("reloadBtn").addEventListener("click", async () => {
  try {
    await switchMode(state.mode);
  } catch (e) {
    alert(e.message);
  }
});

modeSelect.addEventListener("change", async (e) => {
  try {
    await switchMode(e.target.value);
  } catch (err) {
    alert(err.message);
  }
});

companyRouteSelect.addEventListener("change", async (e) => {
  state.currentCompany = e.target.value;
  state.currentLineFile = "";
  syncRouteOptionsByCompany();
  if (state.mode === "new" && routeSelect.value) {
    state.currentLineFile = routeSelect.value;
    await loadRouteFromNewMode(state.currentLineFile);
  }
});

openFileBtn.addEventListener("click", async () => {
  await withFileOpLock(async () => {
    if (!state.currentLineFile) return;
    renderIniToEditor(await loadLineTextByPath(state.currentLineFile));
  });
});

saveFileBtn.addEventListener("click", async () => {
  await withFileOpLock(async () => {
    await saveCurrentLineFile();
  });
});

if (newFileBtn) {
  newFileBtn.addEventListener("click", async () => {
    await withFileOpLock(async () => {
      await createNewLineFile();
    });
  });
}

if (renameFileBtn) {
  renameFileBtn.addEventListener("click", async () => {
    await withFileOpLock(async () => {
      await renameCurrentLineFile();
    });
  });
}

if (deleteFileBtn) {
  deleteFileBtn.addEventListener("click", async () => {
    await withFileOpLock(async () => {
      await deleteCurrentLineFile();
    });
  });
}

if (restoreFileBtn) {
  restoreFileBtn.addEventListener("click", async () => {
    await withFileOpLock(async () => {
      await restoreLatestDeletedFile();
    });
  });
}

if (editorToggle) {
  editorToggle.addEventListener("click", () => {
    fileSidebar.classList.toggle("open");
    appRoot.classList.toggle("with-dock", fileSidebar.classList.contains("open"));
  });
}

if (editorCloseBtn) {
  editorCloseBtn.addEventListener("click", () => {
    fileSidebar.classList.remove("open");
    appRoot.classList.remove("with-dock");
  });
}

if (lineFileEditor) {
  lineFileEditor.addEventListener("blur", () => {
    renderIniToEditor(editorRawText());
  });
}

routeSelect.addEventListener("change", async (e) => {
  if (state.mode === "new") {
    state.currentLineFile = e.target.value;
    await loadRouteFromNewMode(state.currentLineFile);
  } else {
    await loadRouteById(e.target.value);
  }
});

directionSelect.addEventListener("change", (e) => {
  clearPlaybackState();
  state.direction = e.target.value;
  state.stopNumber = 1;
  state.awaitingArrival = false;
  refreshTripUi({ scrollMode: "center" });
});

function applyLoopModeUI() {
  var isLoop = state.route && state.route.isLoop;
  if (isLoop) {
    directionSelect.innerHTML = '<option value="up">环向</option>';
    directionSelect.value = "up";
    state.direction = "up";
    if (flipDirBtn) flipDirBtn.disabled = true;
  } else {
    directionSelect.innerHTML = '<option value="up">上行</option><option value="down">下行</option>';
    directionSelect.value = state.direction;
    if (flipDirBtn) flipDirBtn.disabled = false;
  }
}

stationJumpSelect.addEventListener("change", (e) => {
  clearPlaybackState();
  const idx = Number(e.target.value);
  const stations = getStations();
  if (idx < 0 || idx >= stations.length) return;
  state.stopNumber = idx + 1;
  state.awaitingArrival = false;
  refreshTripUi({ scrollMode: "center" });
});

preBtn.addEventListener("click", () => runForecast());
arriveBtn.addEventListener("click", () => runArrival());
stopPlayBtn.addEventListener("click", () => clearPlaybackState());
replayBtn.addEventListener("click", () => runReplay());
flipDirBtn.addEventListener("click", () => flipDirection());
nextAnnounceBtn.addEventListener("click", () => {
  if (state.awaitingArrival) arriveBtn.click();
  else preBtn.click();
});
if (volumeControl) {
  volumeControl.addEventListener("input", (event) => {
    state.playbackVolume = Number(event.target.value) / 100;
    if (volumeOutput) volumeOutput.textContent = `${event.target.value}%`;
    if (currentAudioEl) currentAudioEl.volume = state.playbackVolume;
  });
}


function onGlobalKeydown(ev) {
  const target = ev.target;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
    return;
  }
  // Don't intercept keys when visual editor sidebar is focused
  const lineEditorDock = document.getElementById("lineEditorSidebar");
  if (lineEditorDock && lineEditorDock.classList.contains("open") && lineEditorDock.contains(document.activeElement)) {
    return;
  }

  const fk = ev.key;
  const tipKeyMap = {
    "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "0": 10,
  };
  if (tipKeyMap[fk]) {
    ev.preventDefault();
    playTipByIndex(tipKeyMap[fk]);
    return;
  }

  if (ev.code === "Space") {
    ev.preventDefault();
    nextAnnounceBtn.click();
    return;
  }

  const fMap = {
    F4: () => nextAnnounceBtn.click(),
    F7: () => flipDirBtn.click(),
    F8: () => stopPlayBtn.click(),
    F9: () => arriveBtn.click(),
    F10: () => preBtn.click(),
    F11: () => replayBtn.click(),
  };
  if (fMap[fk]) {
    ev.preventDefault();
    fMap[fk]();
  }
}

window.addEventListener("keydown", onGlobalKeydown);

// ── Bridge to Visual Line Editor (V1.6) ──
if (window.LineEditor) {
  window.LineEditor.mainState = state;
  window.LineEditor.mainCallbacks = {
    onLineSaved: async function (relPath) {
      // Reload if this is the current line, or if the current file was renamed
      if (relPath === state.currentLineFile) {
        await loadRouteFromNewMode(relPath);
      } else if (state.currentLineFile && relPath) {
        // Check if the old file still exists — if not, this was a rename
        var oldExists = false;
        try {
          var checkResp = await fetch(state.userDataBase + "/" + state.currentLineFile + "?ts=" + Date.now());
          oldExists = checkResp.ok;
        } catch (e) { /* ignore */ }
        if (!oldExists) {
          // Old file deleted (rename), switch to new path
          state.currentLineFile = relPath;
          await loadRouteFromNewMode(relPath);
          syncRouteOptionsByCompany();
        }
      }
    },
    refreshIndex: async function () {
      await loadNewIndex();
      syncCompanyOptions();
      syncRouteOptionsByCompany();
    },
    getCurrentLineFile: function () {
      return state.currentLineFile;
    },
    switchToLine: async function (relPath) {
      var parts = relPath.split("/");
      if (parts.length >= 2) {
        state.currentCompany = parts[0];
      }
      state.currentLineFile = relPath;
      await loadRouteFromNewMode(relPath);
      syncCompanyOptions();
      syncRouteOptionsByCompany();
    },
  };
  // Ensure old text editor toggle doesn't open visual editor, and vice versa
  var lineEditorToggle = document.getElementById("lineEditorToggle");
  var lineEditorDock = document.getElementById("lineEditorSidebar");
  if (lineEditorToggle && lineEditorDock) {
    // Visual editor toggle: close text editor if open
    lineEditorToggle.addEventListener("click", function () {
      if (fileSidebar && fileSidebar.classList.contains("open")) {
        fileSidebar.classList.remove("open");
        appRoot.classList.remove("with-dock");
      }
    });
  }
  if (editorToggle && lineEditorDock) {
    // Text editor toggle: close visual editor if open
    var origToggle = editorToggle.onclick;
    editorToggle.addEventListener("click", function () {
      if (lineEditorDock.classList.contains("open")) {
        lineEditorDock.classList.remove("open");
        appRoot.classList.remove("with-dock-v2");
      }
    });
  }
}

/* ── Logo Decryption ── */
async function loadLogoImage() {
  var KEY = "TABL_ARCHIVE_V1.6";
  async function loadOne(datFile, imgId, mimeType) {
    try {
      var resp = await fetch("./res/" + datFile + "?ts=" + Date.now());
      if (!resp.ok) { console.warn("[logo] " + datFile + " not found"); return; }
      var encBuf = await resp.arrayBuffer();
      var encBytes = new Uint8Array(encBuf);
      var keyBytes = [];
      for (var i = 0; i < KEY.length; i++) keyBytes.push(KEY.charCodeAt(i));
      var decBytes = new Uint8Array(encBytes.length);
      for (var i = 0; i < encBytes.length; i++) {
        decBytes[i] = encBytes[i] ^ keyBytes[i % keyBytes.length];
      }
      var decrypted = new TextDecoder().decode(decBytes);
      var img = document.getElementById(imgId);
      if (img) img.src = "data:" + mimeType + ";base64," + decrypted;
    } catch (e) {
      console.warn("[logo] Failed to load " + datFile + ":", e.message);
    }
  }
  await loadOne("logo_archive_white.dat", "logoImage", "image/png");
  await loadOne("logo_archive_white.dat", "aboutLogoImage", "image/png");
  await loadOne("bilibili_icon.dat", "bilibiliIcon", "image/png");
  await loadOne("gitee_icon.dat", "giteeIcon", "image/png");
  await loadOne("github_icon.dat", "githubIcon", "image/png");
}

var _pendingImportTimer = null;
async function checkPendingImport() {
  try {
    var resp = await fetch("/api/pending_import");
    if (!resp.ok) return;
    var preview = await resp.json();
    if (!preview.pending) return;
    _showPendingImportDialog(preview);
  } catch (e) {
    console.error("[pending_import]", e.message);
  }
  // Poll every 2s for new pending imports (triggered by second instance)
  if (!_pendingImportTimer) {
    _pendingImportTimer = setInterval(async function () {
      try {
        var r = await fetch("/api/pending_import");
        if (!r.ok) return;
        var d = await r.json();
        if (d.pending) _showPendingImportDialog(d);
      } catch (e) {
        console.error("[pending_import poll]", e);
      }
    }, 2000);
  }
}

function _showPendingImportDialog(preview) {
  console.log("[pending_import] showing dialog, LE=", !!window.LineEditor, "dlg=", !!(window.LineEditor && window.LineEditor._showImportPreviewDialog));
  // Open the visual editor sidebar + navigate to L0
  var dock = document.getElementById("lineEditorSidebar");
  var appRoot = document.getElementById("appRoot");
  if (dock) {
    dock.classList.add("open");
    if (appRoot) appRoot.classList.add("with-dock-v2");
    if (window.LineEditor && window.LineEditor.showPage) {
      window.LineEditor.showPage("L0");
    }
  } else {
    console.error("[pending_import] lineEditorSidebar not found");
  }

  // Use the EXISTING import preview dialog (same as manual import flow)
  var defaultCompany = preview.zipCompany || "";
  var origFileName = preview.origFileName || "";
  // Wait for sidebar to open + L0 to begin rendering, then show dialog
  function _tryShow() {
    if (window.LineEditor && window.LineEditor._showImportPreviewDialog) {
      window.LineEditor._showImportPreviewDialog(preview, defaultCompany, true, origFileName);
    } else {
      console.warn("[pending_import] _showImportPreviewDialog not available, retrying...");
      setTimeout(_tryShow, 200);
    }
  }
  setTimeout(_tryShow, 300);
}

function renderUpdateModal(info, force) {
  var overlay = document.getElementById("updateModalOverlay");
  var title = document.getElementById("updateModalTitle");
  var version = document.getElementById("updateModalVersion");
  var changelogEl = document.getElementById("updateModalChangelog");
  var btn = document.getElementById("updateBannerBtn");
  var close = document.getElementById("updateModalClose");
  var cancel = document.getElementById("updateModalCancel");
  if (!overlay || !version || !changelogEl) {
    console.error("[update] modal elements missing:", !!overlay, !!version, !!changelogEl);
    return;
  }

  var latest = (info.latest_version || "");
  if (info.latest_build) latest += " Build " + info.latest_build;
  var current = (info.local_version || "");
  if (info.local_build) current += " Build " + info.local_build;
  // Forced (simulated) upgrade: show the exact same "new version" modal as a real
  // update, skipping only the version comparison.
  var isNewer = force ? true : !!info.update_available;

  title.textContent = "发现新版本";
  if (info.error) {
    version.textContent = "检查失败: " + info.error;
  } else {
    version.textContent = "新版本 " + latest + "（当前 " + current + "）";
  }

  var html = "";
  if (info.changelog && info.changelog.length) {
    for (var i = 0; i < info.changelog.length; i++) {
      var e = info.changelog[i];
      html += '<div class="update-changelog-build">Build ' + escapeHtml(String(e.build)) + '</div>';
      if (e.items && e.items.length) {
        html += '<ul>';
        for (var j = 0; j < e.items.length; j++) {
          html += '<li>' + escapeHtml(e.items[j]) + '</li>';
        }
        html += '</ul>';
      }
    }
  } else {
    html = '<p style="color:#69778d">（该版本无可展示的更新日志）</p>';
  }
  changelogEl.innerHTML = html;
  overlay.style.display = "flex";

  if (!info.download_url) {
    if (btn) btn.style.display = "none";
  } else if (btn) {
    btn.style.display = "";
    btn.disabled = false;
    btn.textContent = "下载并升级";
  }

  function hide() {
    overlay.style.display = "none";
    btn.disabled = false;
    btn.textContent = "下载并升级";
  }

  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return "0";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  }

  function startProgressPolling() {
    var dl = document.getElementById("updateDl");
    var bar = document.getElementById("updateDlBar");
    var pctEl = document.getElementById("updateDlPct");
    var sizeEl = document.getElementById("updateDlSize");
    var speedEl = document.getElementById("updateDlSpeed");
    if (!dl || !bar) return;
    // Show the progress UI immediately so a slow connection still reads as
    // "in progress" (real upgrade must look exactly like simulated upgrade).
    dl.style.display = "block";
    bar.style.width = "0%";
    pctEl.textContent = "0%";
    sizeEl.textContent = "";
    speedEl.textContent = "连接中...";
    if (version) version.textContent = "正在连接下载源，请稍候...";
    var lastBytes = 0, lastTs = Date.now(), timer = null;

    function tick() {
      fetch("/api/update_progress").then(function (r) { return r.json(); }).then(function (s) {
        if (s.done) {
          if (timer) clearInterval(timer);
          bar.style.width = "100%";
          pctEl.textContent = "100%";
          sizeEl.textContent = fmtSize(s.downloaded) + " / " + fmtSize(s.total);
          speedEl.textContent = "";
          if (s.ok) {
            version.textContent = "下载完成，正在启动安装程序...";
            btn.textContent = "即将退出并启动升级向导";
          } else {
            version.textContent = "下载失败: " + (s.error || "未知错误");
            btn.textContent = "重试";
            btn.disabled = false;
          }
          return;
        }
        if (!s.active) {
          // Thread started but no download state yet — keep the connecting hint.
          version.textContent = "正在连接下载源，请稍候...";
          return;
        }
        var now = Date.now();
        if (s.downloaded === 0) {
          // Established connection but no bytes yet — CDN slow. Keep the UI alive.
          version.textContent = "正在连接下载源，请稍候...";
          speedEl.textContent = "连接中...";
          lastBytes = 0; lastTs = now;
          return;
        }
        var dt = (now - lastTs) / 1000;
        var speed = dt > 0 ? (s.downloaded - lastBytes) / dt : 0;
        lastBytes = s.downloaded; lastTs = now;
        var pct = s.total > 0 ? Math.round(s.downloaded * 100 / s.total) : 0;
        bar.style.width = pct + "%";
        pctEl.textContent = pct + "%";
        sizeEl.textContent = fmtSize(s.downloaded) + " / " + fmtSize(s.total);
        speedEl.textContent = (speed > 0) ? fmtSize(speed) + "/s" : "";
      }).catch(function () {});
    }
    tick();
    timer = setInterval(tick, 500);
  }

  btn.onclick = async function () {
    btn.disabled = true;
    btn.textContent = "下载中...";
    version.textContent = "正在下载安装程序...";
    try {
      var upResp = await fetch("/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: info.download_url || "", installer_name: info.installer_name || "" })
      });
      var upInfo = await upResp.json();
      if (upInfo.ok) {
        startProgressPolling();
      } else {
        version.textContent = "启动失败: " + (upInfo.error || "");
        btn.textContent = "重试";
        btn.disabled = false;
      }
    } catch (e) {
      version.textContent = "下载失败: " + e.message;
      btn.textContent = "重试";
      btn.disabled = false;
    }
  };

  if (close) close.onclick = hide;
  if (cancel) cancel.onclick = hide;
}

async function checkForUpdates(force) {
  if (!force && !state.funct.check_updates) return;
  try {
    var url = "/api/check_update";
    if (force) url += "?force=1";
    var resp = await fetch(url);
    if (!resp.ok) {
      console.error("[update] HTTP " + resp.status + " from " + url);
      if (force) renderUpdateModal({ update_available: false, error: "检查接口返回 HTTP " + resp.status }, force);
      return;
    }
    var info = await resp.json();
    if (!info.download_url) {
      // Normal startup check: stay silent (Gitee may be rate-limited / offline).
      // Forced (simulated) upgrade: the user asked for it, so surface the problem.
      if (force) {
        renderUpdateModal(Object.assign({}, info, {
          error: info.error || "未找到对应平台的安装包",
        }), force);
      }
      return;
    }
    renderUpdateModal(info, force);
  } catch (e) {
    console.error("[update] check failed:", e.message);
    if (force) renderUpdateModal({ update_available: false, error: "检查失败: " + e.message }, force);
  }
}

function showToast(msg, type) {
  type = type || "info";
  if (window.LineEditor && typeof window.LineEditor.toast === "function") {
    window.LineEditor.toast(msg, type);
    return;
  }
  var c = document.getElementById("edToastContainer");
  if (!c) {
    c = document.createElement("div");
    c.id = "edToastContainer";
    c.className = "ed-toast-container";
    document.body.appendChild(c);
  }
  var el = document.createElement("div");
  el.className = "ed-toast " + type;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(function () { el.remove(); }, 3000);
}

/* About-panel manual update check: modal on update, toast otherwise. */
function manualCheckForUpdates() {
  var btn = document.getElementById("aboutCheckUpdateBtn");
  if (btn) { btn.disabled = true; btn.textContent = "检查中..."; }
  fetch("/api/check_update?force=1")
    .then(function (resp) { return resp.json(); })
    .then(function (info) {
      if (info.error) {
        showToast("检查更新失败：" + info.error, "error");
        return;
      }
      if (info.update_available && info.download_url) {
        renderUpdateModal(info, true);
      } else {
        showToast("当前已是最新版本", "info");
      }
    })
    .catch(function (e) {
      showToast("检查更新失败：" + e.message, "error");
    })
    .finally(function () {
      if (btn) { btn.disabled = false; btn.textContent = "检查更新"; }
    });
}

function initAboutPanel() {
  var ver = document.getElementById("aboutVersionText");
  if (ver) {
    ver.textContent = "V" + (window.TABBSS_VERSION || "1.6") + " (Build " + (window.TABBSS_BUILD || "0") + ")";
  }
  var btn = document.getElementById("aboutCheckUpdateBtn");
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = "1";
    btn.addEventListener("click", manualCheckForUpdates);
  }
}

modeSelect.value = "new";
loadFunctConfig().then(async function () {
  loadLogoImage();
  await switchMode("new").catch((e) => alert(e.message));
  applyFunctConfig(); // re-apply after switchMode may have overridden
  initAboutPanel();   // about panel version text + manual update check
  checkForUpdates();   // check GitHub for updates
  checkPendingImport(); // file association double-click
});
