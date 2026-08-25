/* editor-core.js — V1.6 Visual Line Editor: Data Model, INI Parse/Serialize, API, Validation */
window.LineEditor = (function () {
  const LE = {};

  /* ── State ── */
  LE.state = {
    view: "L0",
    viewHistory: [],
    currentCompany: "",
    currentLineRelPath: "",
    currentLineName: "",
    isEditMode: false,
    isDirty: false,
    l2ActiveTab: "basic",
    validationErrors: [],
    editModel: null,
    originalEditModel: null,
    originalLineText: "",
    pausedPlaybackSnapshot: null,
  };

  LE.mainState = null;
  LE.mainCallbacks = {};

  /* ── API Wrappers ── */
  LE.api = {
    async _call(path, payload) {
      const resp = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
      });
      const data = await resp.json();
      if (!resp.ok || data.ok === false) throw new Error(data.error || "API error");
      return data;
    },

    readFile(relPath)   { console.log("[api] readFile: " + relPath); return this._call("/api/file/read", { relPath }); },
    writeFile(relPath, content) {
      console.log("[api] writeFile: " + relPath + " (" + (content ? content.length : 0) + " chars)");
      return this._call("/api/file/write", { relPath, content });
    },
    deleteFile(relPath) { console.log("[api] deleteFile: " + relPath); return this._call("/api/file/delete", { relPath }); },
    renameFile(from, to) { return this._call("/api/file/rename", { fromRelPath: from, toRelPath: to }); },
    copyFile(from, to)  { return this._call("/api/file/copy", { fromRelPath: from, toRelPath: to }); },
    listDir(relPath, includeMeta) { return this._call("/api/file/list", { relPath, includeMeta }); },
    listMedia(relPath)  { return this._call("/api/file/list_media", { relPath }); },
    mkdir(relPath)      { return this._call("/api/file/mkdir", { relPath }); },
    rmdir(relPath)      { return this._call("/api/file/rmdir", { relPath, force: true }); },
    reindex()           { return this._call("/api/file/reindex", {}); },
    updateIndex(company, lineName, lineFile, action) {
      return this._call("/api/file/update_index", { company, lineName, lineFile, action });
    },
    restoreLatest()     { return this._call("/api/file/restore_latest", {}); },
    openFolder(relPath) { return this._call("/api/open_folder", { relPath }); },
  };

  /* ── Token Parsing (shared with main.js logic) ── */
  function parseRuleTokens(rule) {
    if (!rule) return [];
    return rule.split(">").map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) {
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

  function serializeTokens(tokens) {
    if (!tokens || !tokens.length) return "";
    return tokens.map(function (t) {
      if (t === "【本站中文】") return "{本站}";
      if (t === "【本站英文】") return "{本站英文}";
      if (t === "【下站中文】") return "{下站}";
      if (t === "【下站英文】") return "{下站英文}";
      if (t === "【起始站中文】") return "{起始站}";
      if (t === "【起始站英文】") return "{起始站英文}";
      if (t === "【终点站中文】") return "{终点站}";
      if (t === "【终点站英文】") return "{终点站英文}";
      if (t === "【默认模版】") return "{默认模版}";
      if (t === "【普通站预报模板】") return "{普通站预报模板}";
      if (t === "【普通站到站模板】") return "{普通站到站模板}";
      if (/^[【{].+[】}]$/.test(t)) return t;
      return '"' + t + '"';
    }).join(">");
  }

  LE.parseRuleTokens = parseRuleTokens;
  LE.serializeTokens = serializeTokens;

  /** Is this token a default-template reference marker (not an audio file)? */
  LE.isTemplateMarker = function (tok) {
    return tok === "【默认模版】" || tok === "【默认模板】" ||
           tok === "{默认模版}" || tok === "{默认模板}";
  };

  /** Find a continuous subsequence in a token array */
  LE.findSubsequence = function (tokens, needle) {
    if (!needle || !needle.length || !tokens) return { found: false, start: -1, end: -1 };
    for (var i = 0; i <= tokens.length - needle.length; i++) {
      var match = true;
      for (var j = 0; j < needle.length; j++) {
        if (tokens[i + j] !== needle[j]) { match = false; break; }
      }
      if (match) return { found: true, start: i, end: i + needle.length };
    }
    return { found: false, start: -1, end: -1 };
  };

  /* ── Parse simple key=value from INI block ── */
  function parseKey(text, key) {
    var m = text.match(new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "=(.*)$", "m"));
    return m ? m[1].trim() : "";
  }

  /* ── Parse stop list block ── */
  function parseStopList(text, title) {
    var nextMap = {
      "上行中文站名": "上行英文站名",
      "上行英文站名": "下行中文站名",
      "下行中文站名": "下行英文站名",
      "下行英文站名": "#显示屏格式",
    };
    var next = nextMap[title] || "#显示屏格式";
    var reg = new RegExp(title + "：[\\s\\S]*?(?=\\n" + next + "|$)");
    var m = text.match(reg);
    if (!m) return [];
    var out = [];
    var re = /stop_(\d+)\s*:(.*)/g;
    var g;
    while ((g = re.exec(m[0]))) { out[Number(g[1]) - 1] = (g[2] || "").trim(); }
    return out.map(function (x) { return x || ""; });
  }

  /* ── Parse per-station rules ── */
  function parseStationRules(text, stops, dir) {
    var overrides = {};
    var audioMap = {};
    var audioMapEn = {};

    var dirMarker = dir === "up" ? "###上行站点" : "###下行站点";
    var nextMarker = dir === "up" ? "###下行站点" : "##手按提示语类";
    var idx0 = text.indexOf(dirMarker);
    if (idx0 < 0) return { overrides: overrides, audioMap: audioMap, audioMapEn: audioMapEn };

    var idx1 = text.indexOf(nextMarker, idx0 + 1);
    var block = idx1 > 0 ? text.substring(idx0, idx1) : text.substring(idx0);

    var secRe = /####Stop(\d+)：[\s\S]*?(?=\n####Stop|$)/g;
    var m;
    while ((m = secRe.exec(block))) {
      var stopIdx = Number(m[1]);
      var section = m[0];
      var stopName = stops[stopIdx - 1] || "";
      var zhAudio = parseKey(section, "本站中文语音文件").trim();
      var enAudio = parseKey(section, "本站英文语音文件").trim();
      var fcRule = parseKey(section, "预报规则").trim();
      var arrRule = parseKey(section, "到站规则").trim();

      if (zhAudio) audioMap[stopName] = zhAudio.replace(/^"|"$/g, "");
      if (enAudio) {
        var enKey = dir + ":" + stopIdx;
        audioMapEn[enKey] = enAudio.replace(/^"|"$/g, "");
      }
      overrides[stopIdx] = {
        depart: fcRule ? parseRuleTokens(fcRule) : [],
        arrive: arrRule ? parseRuleTokens(arrRule) : [],
        zhAudioRel: zhAudio,
        enAudioRel: enAudio,
      };
    }
    return { overrides: overrides, audioMap: audioMap, audioMapEn: audioMapEn };
  }

  /* ── Parse tips ── */
  function parseTips(text) {
    // Split by ###提示语N: headers (precise match to avoid 提示语1 matching 提示语10)
    var allBlocks = text.split(/\n(?=###提示语\d+:\s*$)/m);
    // Also try splitting from the beginning
    var tipMap = {};
    for (var b = 0; b < allBlocks.length; b++) {
      var block = allBlocks[b].trim();
      var m = block.match(/^###提示语(\d+):([\s\S]*)$/);
      if (m) {
        var num = parseInt(m[1]);
        var body = m[2];
        var name = parseKey(body, "显示名称"); // empty is valid, player falls back at runtime
        var val = parseKey(body, "语音文件").trim();
        tipMap[num] = { name: name, ruleTokens: val ? parseRuleTokens(val) : [] };
      }
    }
    var tips = [];
    for (var i = 1; i <= 10; i++) {
      tips.push(tipMap[i] || { name: "", ruleTokens: [] });
    }
    return tips;
  }

  /* ── Parse entire .ini text into editModel ── */
  LE.parseIni = function (text) {
    if (!text) text = "";
    // V1.6: Read explicit loop mode flag, default false
    var loopRaw = parseKey(text, "环线模式");
    var isLoop = loopRaw === "true";

    // V1.6: Read explicit upDownSame flag. Default: false if missing (spec §4.2 fallback)
    var udsRaw = parseKey(text, "上下行相同");
    var upDownSame = udsRaw === "true";

    var model = {
      lineName: parseKey(text, "线路名称") || "",
      version: parseKey(text, "版本") || "",
      author: parseKey(text, "作者") || "",
      createdAt: parseKey(text, "创建时间") || "",
      updatedAt: parseKey(text, "更新时间") || "",
      changelog: parseKey(text, "更新日志") || "",
      mode: isLoop ? "loop" : "bidirectional",
      upStationsCn: parseStopList(text, "上行中文站名"),
      upStationsEn: parseStopList(text, "上行英文站名"),
      downStationsCn: parseStopList(text, "下行中文站名"),
      downStationsEn: parseStopList(text, "下行英文站名"),
      templates: {
        upFirstDepart: parseRuleTokens(parseKey(text, "上行首站预报规则")),
        downFirstDepart: parseRuleTokens(parseKey(text, "下行首站预报规则")),
        upArrive: parseRuleTokens(parseKey(text, "默认上行到站播报规则")),
        upDepart: parseRuleTokens(parseKey(text, "默认上行预报规则")),
        downDepart: parseRuleTokens(parseKey(text, "默认下行预报规则")),
        downArrive: parseRuleTokens(parseKey(text, "默认下行到站播报规则")),
        upTerminalDepart: parseRuleTokens(parseKey(text, "上行终点站预报规则")),
        upTerminalArrive: parseRuleTokens(parseKey(text, "上行终点站报站规则")),
        downTerminalDepart: parseRuleTokens(parseKey(text, "下行终点站预报规则")),
        downTerminalArrive: parseRuleTokens(parseKey(text, "下行终点站报站规则")),
      },
      isUpDownSame: upDownSame,
      stationOverrides: { up: {}, down: {} },
      stationAudioMap: {},
      stationAudioMapEn: {},
      tipItems: parseTips(text),
    };

    // Pad EN lists to match CN length
    while (model.upStationsEn.length < model.upStationsCn.length) model.upStationsEn.push("");
    while (model.downStationsEn.length < model.downStationsCn.length) model.downStationsEn.push("");
    while (model.upStationsCn.length < model.upStationsEn.length) model.upStationsCn.push("");
    while (model.downStationsCn.length < model.downStationsEn.length) model.downStationsCn.push("");

    // Parse station rules
    var upRules = parseStationRules(text, model.upStationsCn, "up");
    var downRules = parseStationRules(text, model.downStationsCn, "down");
    model.stationOverrides.up = upRules.overrides;
    model.stationOverrides.down = downRules.overrides;
    model.stationAudioMap = upRules.audioMap;
    for (var k in downRules.audioMap) { model.stationAudioMap[k] = downRules.audioMap[k]; }
    model.stationAudioMapEn = {};
    for (var k2 in upRules.audioMapEn) { model.stationAudioMapEn[k2] = upRules.audioMapEn[k2]; }
    for (var k3 in downRules.audioMapEn) { model.stationAudioMapEn[k3] = downRules.audioMapEn[k3]; }

    // If no explicit flag, detect: up has rules + down all empty → upDownSame=true
    if (!udsRaw) {
      var t = model.templates;
      var hasUpRules = t.upDepart.length || t.upArrive.length || t.upFirstDepart.length ||
                       t.upTerminalDepart.length || t.upTerminalArrive.length;
      var allDownEmpty = !t.downDepart.length && !t.downArrive.length &&
                         !t.downFirstDepart.length && !t.downTerminalDepart.length &&
                         !t.downTerminalArrive.length;
      model.isUpDownSame = hasUpRules && allDownEmpty;
    }

    return model;
  };

  /* ── Serialize editModel to .ini text ── */
  LE.serializeIni = function (model) {
    var L = [];
    var a = function (s) { L.push(s); };

    // Line info
    a("#线路信息");
    a("");
    a("线路名称=" + (model.lineName || ""));
    a("版本=" + (model.version || ""));
    a("作者=" + (model.author || ""));
    a("创建时间=" + (model.createdAt || ""));
    a("更新时间=" + (model.updatedAt || ""));
    a("更新日志=" + (model.changelog || ""));
    a(""); a("");

    // Station info
    a("#车站信息");
    a("环线模式=" + (model.mode === "loop" ? "true" : "false"));
    a("");

    var upCn = model.upStationsCn || [];
    var upEn = model.upStationsEn || [];
    var downCn = model.downStationsCn || [];
    var downEn = model.downStationsEn || [];

    // If loop mode, down = reverse of up
    if (model.mode === "loop") {
      downCn = upCn.slice().reverse();
      downEn = upEn.slice().reverse();
    }

    while (upEn.length < upCn.length) upEn.push("");
    while (downEn.length < downCn.length) downEn.push("");

    function writeStopList(title, stops) {
      a(title + "：");
      a("");
      for (var i = 0; i < stops.length; i++) {
        a("stop_" + (i + 1) + ":" + stops[i]);
      }
      a(""); a("");
    }

    writeStopList("上行中文站名", upCn);
    writeStopList("上行英文站名", upEn);
    writeStopList("下行中文站名", downCn);
    writeStopList("下行英文站名", downEn);

    // Display format placeholder
    a("#显示屏格式");
    a("");
    a("（此段本版本暂时放空，后续补充）");
    a(""); a("");

    // Announcement rules
    a("#报站规则");
    a("##全局默认模版类");
    a("上下行相同=" + (model.isUpDownSame ? "true" : "false"));

    var t = model.templates;
    a("上行首站预报规则=" + serializeTokens(t.upFirstDepart));
    if (!model.isUpDownSame) {
      a("下行首站预报规则=" + serializeTokens(t.downFirstDepart));
    } else {
      a("下行首站预报规则=");
    }
    a("默认上行到站播报规则=" + serializeTokens(t.upArrive));
    a("默认上行预报规则=" + serializeTokens(t.upDepart));
    if (!model.isUpDownSame) {
      a("默认下行预报规则=" + serializeTokens(t.downDepart));
      a("默认下行到站播报规则=" + serializeTokens(t.downArrive));
    } else {
      a("默认下行预报规则=");
      a("默认下行到站播报规则=");
    }
    a("上行终点站预报规则=" + serializeTokens(t.upTerminalDepart));
    a("上行终点站报站规则=" + serializeTokens(t.upTerminalArrive));
    if (!model.isUpDownSame) {
      a("下行终点站预报规则=" + serializeTokens(t.downTerminalDepart));
      a("下行终点站报站规则=" + serializeTokens(t.downTerminalArrive));
    } else {
      a("下行终点站预报规则=");
      a("下行终点站报站规则=");
    }
    a(""); a("");

    // Per-station rules
    a("##各站规则类");

    function writeStationSection(dirLabel, stops, overrides, dir) {
      a("###" + dirLabel + "站点");
      for (var i = 0; i < stops.length; i++) {
        a("####Stop" + (i + 1) + "：");
        var ov = (overrides && overrides[i + 1]) ? overrides[i + 1] : {};
        a("预报规则=" + serializeTokens(ov.depart || []));
        a("到站规则=" + serializeTokens(ov.arrive || []));
        a("本站中文语音文件=" + (ov.zhAudioRel || ""));
        a("本站英文语音文件=" + (ov.enAudioRel || ""));
        a("");
      }
    }

    writeStationSection("上行", upCn, model.stationOverrides.up, "up");
    writeStationSection("下行", downCn, model.stationOverrides.down, "down");

    // Tips
    a("##手按提示语类");
    var tips = model.tipItems || [];
    console.log("[serializeIni] tips count=" + tips.length);
    for (var j = 0; j < 10; j++) {
      var tip = tips[j] || { name: "", ruleTokens: [] };
      console.log("[serializeIni] tip " + (j + 1) + ": name=" + JSON.stringify(tip.name) + ", tokens=" + (tip.ruleTokens ? tip.ruleTokens.length : 0));
      a("###提示语" + (j + 1) + ":");
      a("显示名称=" + (tip.name || ""));
      if (tip.ruleTokens && tip.ruleTokens.length) {
        a("语音文件=" + serializeTokens(tip.ruleTokens));
      } else {
        a("语音文件=");
      }
      a("");
    }

    return L.join("\n") + "\n";
  };

  /* ── Create empty editModel for a new line ── */
  LE.createEmptyModel = function (lineName, stationCount) {
    stationCount = stationCount || 2;
    var upCn = [];
    var upEn = [];
    for (var i = 0; i < stationCount; i++) { upCn.push(""); upEn.push(""); }
    var m = {
      lineName: lineName || "新线路",
      version: "V1.0",   // Build 237+: new lines default to V1.0
      author: "",
      createdAt: "",
      updatedAt: "",
      changelog: "",
      mode: "bidirectional",
      upStationsCn: upCn,
      upStationsEn: upEn,
      downStationsCn: upCn.slice(),
      downStationsEn: upEn.slice(),
      templates: {
        upFirstDepart: [], downFirstDepart: [],
        upArrive: [], upDepart: [],
        downDepart: [], downArrive: [],
        upTerminalDepart: [], upTerminalArrive: [],
        downTerminalDepart: [], downTerminalArrive: [],
      },
      isUpDownSame: true,
      stationOverrides: { up: {}, down: {} },
      stationAudioMap: {},
      stationAudioMapEn: {},
      tipItems: [],
    };
    console.log("[createEmptyModel] tipItems length=" + m.tipItems.length);
    return m;
  };

  /* ── Station Override Reindex ── */
  LE.reindexOverrides = function (model, dir, operation, arg1, arg2) {
    var ov = model.stationOverrides[dir] || {};
    var newOv = {};
    if (operation === "reorder") {
      var fromIdx = arg1; var toIdx = arg2; // 0-based
      var from1 = fromIdx + 1; var to1 = toIdx + 1;
      for (var k in ov) {
        var ki = parseInt(k);
        if (ki === from1) { newOv[to1] = ov[k]; }
        else if (from1 < to1) {
          if (ki > from1 && ki <= to1) newOv[ki - 1] = ov[k];
          else newOv[ki] = ov[k];
        } else {
          if (ki >= to1 && ki < from1) newOv[ki + 1] = ov[k];
          else newOv[ki] = ov[k];
        }
      }
    } else if (operation === "splice") {
      var spliceIdx = arg1; var delta = arg2; // 0-based, +1 insert, -1 delete
      var pivot = spliceIdx + 1; // 1-based
      for (var k in ov) {
        var ki = parseInt(k);
        if (delta < 0 && ki === pivot) continue; // deleting the overridden station itself
        if (delta > 0 ? ki >= pivot : ki > pivot) newOv[ki + delta] = ov[k];
        else newOv[ki] = ov[k];
      }
    } else if (operation === "rename") {
      return; // No reindex needed for rename on overrides
    } else if (operation === "clear") {
      newOv = {};
    }
    model.stationOverrides[dir] = newOv;

    // Also reindex stationAudioMapEn (keys are dir:stopIdx)
    var newAe = {};
    var oldAe = model.stationAudioMapEn || {};
    if (operation === "reorder") {
      var f1 = arg1 + 1; var t1 = arg2 + 1;
      for (var k2 in oldAe) {
        var parts = k2.split(":");
        if (parts[0] !== dir) { newAe[k2] = oldAe[k2]; continue; }
        var ki = parseInt(parts[1]);
        if (ki === f1) { newAe[dir + ":" + t1] = oldAe[k2]; }
        else if (f1 < t1) {
          if (ki > f1 && ki <= t1) newAe[dir + ":" + (ki - 1)] = oldAe[k2];
          else newAe[k2] = oldAe[k2];
        } else {
          if (ki >= t1 && ki < f1) newAe[dir + ":" + (ki + 1)] = oldAe[k2];
          else newAe[k2] = oldAe[k2];
        }
      }
    } else if (operation === "splice") {
      var sp = arg1 + 1; var d = arg2;
      for (var k2 in oldAe) {
        var parts = k2.split(":");
        if (parts[0] !== dir) { newAe[k2] = oldAe[k2]; continue; }
        var ki = parseInt(parts[1]);
        if (d < 0 && ki === sp) continue;
        if (d > 0 ? ki >= sp : ki > sp) newAe[dir + ":" + (ki + d)] = oldAe[k2];
        else newAe[k2] = oldAe[k2];
      }
    } else if (operation === "clear") {
      for (var k2 in oldAe) { if (k2.split(":")[0] !== dir) newAe[k2] = oldAe[k2]; }
    }
    if (operation !== "rename") model.stationAudioMapEn = newAe;
  };

  /* ── Navigation ── */
  LE.navigateTo = function (viewKey) {
    LE.state.viewHistory.push(LE.state.view);
    LE.state.view = viewKey;
  };

  LE.goBack = function () {
    if (LE.state.viewHistory.length > 0) {
      LE.state.view = LE.state.viewHistory.pop();
    }
  };

  LE.canGoBack = function () {
    return LE.state.viewHistory.length > 0;
  };

  /* ── Help tooltip (text + optional image) ── */
  LE._helpTipEl = null;
  LE._ensureHelpTip = function () {
    if (LE._helpTipEl) return LE._helpTipEl;
    var el = document.createElement("div");
    el.id = "edHelpTooltip";
    el.className = "ed-help-tooltip";
    document.body.appendChild(el);
    LE._helpTipEl = el;
    return el;
  };
  document.addEventListener("mouseover", function (e) {
    var icon = e.target && e.target.closest ? e.target.closest(".ed-help-icon") : null;
    var tip = LE._ensureHelpTip();
    if (!icon) { tip.style.display = "none"; return; }
    var text = icon.getAttribute("data-tip") || "";
    var imgSrc = icon.getAttribute("data-img");
    tip.innerHTML = "";
    if (imgSrc) {
      var im = document.createElement("img");
      im.src = imgSrc;
      im.className = "ed-help-tooltip-img";
      im.onerror = function () { im.remove(); };
      tip.appendChild(im);
    }
    tip.appendChild(document.createTextNode(text));
    tip.style.display = "block";
    var r = icon.getBoundingClientRect();
    tip.style.left = (r.left + window.scrollX) + "px";
    tip.style.top = (r.bottom + window.scrollY + 6) + "px";
  });
  document.addEventListener("mouseout", function (e) {
    if (e.target && e.target.closest && e.target.closest(".ed-help-icon")) {
      LE._ensureHelpTip().style.display = "none";
    }
  });

  /* ── Toast ── */
  LE.toast = function (msg, type) {
    type = type || "info";
    var container = document.getElementById("edToastContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "edToastContainer";
      container.className = "ed-toast-container";
      document.body.appendChild(container);
    }
    var el = document.createElement("div");
    el.className = "ed-toast " + type;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(function () { el.remove(); }, 3000);
  };

  /* ── Validation ── */
  LE.validateField = function (fieldPath, value, model) {
    // fieldPath like "lineName", "templates.upDepart", "stationOverrides.up.1.depart"
    if (fieldPath === "lineName") {
      if (!value || !value.trim()) return "线路名称为必填项";
      return null;
    }
    return null; // More validations in Phase 9
  };

  /* ── Collect all file references from a line model ── */
  LE.collectLineFileReferences = function (model) {
    var files = [];

    function addRef(file) {
      if (!file) return;
      file = file.replace(/^"|"$/g, "");
      if (!file || LE.isParamToken(file) || LE.isTemplateMarker(file)) return;
      if (/^\{[^}]+\}$/.test(file)) return;
      if (files.indexOf(file) < 0) files.push(file);
    }

    // Templates
    for (var k in model.templates) {
      (model.templates[k] || []).forEach(addRef);
    }

    // Station overrides
    ["up", "down"].forEach(function (dir) {
      var ov = model.stationOverrides[dir] || {};
      for (var si in ov) {
        var o = ov[si];
        (o.depart || []).forEach(addRef);
        (o.arrive || []).forEach(addRef);
        if (o.zhAudioRel) parseRuleTokens(o.zhAudioRel).forEach(addRef);
        if (o.enAudioRel) parseRuleTokens(o.enAudioRel).forEach(addRef);
      }
    });

    // Station audio maps
    for (var k2 in model.stationAudioMap) { addRef(model.stationAudioMap[k2]); }
    for (var k3 in model.stationAudioMapEn) { addRef(model.stationAudioMapEn[k3]); }

    // Tips
    (model.tipItems || []).forEach(function (tip) {
      (tip.ruleTokens || []).forEach(addRef);
    });

    // Implicit same-name files — check both ZH and EN, respect overrides
    ["up", "down"].forEach(function (dir) {
      var stations = dir === "up" ? (model.upStationsCn || []) : (model.downStationsCn || []);
      var tplKeys = dir === "up"
        ? ["upDepart", "upArrive", "upFirstDepart", "upTerminalDepart", "upTerminalArrive"]
        : ["downDepart", "downArrive", "downFirstDepart", "downTerminalDepart", "downTerminalArrive"];
      stations.forEach(function (name, idx) {
        if (!name || !name.trim()) return;
        var stopIdx = idx + 1; // 1-based
        var ov = (model.stationOverrides[dir] || {})[stopIdx] || {};

        // Check if 本站中文 is used in any effective rule for this station
        var usesZh = false;
        var hasZhOverride = !!(ov.zhAudioRel && ov.zhAudioRel.trim());
        if (!hasZhOverride) {
          if ((ov.depart || []).indexOf("【本站中文】") >= 0 || (ov.arrive || []).indexOf("【本站中文】") >= 0) usesZh = true;
          for (var ti = 0; ti < tplKeys.length; ti++) {
            if ((model.templates[tplKeys[ti]] || []).indexOf("【本站中文】") >= 0) usesZh = true;
          }
          // If used AND no explicit map entry → implicit same-name file
          if (usesZh && !model.stationAudioMap[name]) {
            files.push(name); // caller checks with extensions
          }
        }

        // Check 本站英文 similarly
        var usesEn = false;
        var hasEnOverride = !!(ov.enAudioRel && ov.enAudioRel.trim());
        if (!hasEnOverride) {
          if ((ov.depart || []).indexOf("【本站英文】") >= 0 || (ov.arrive || []).indexOf("【本站英文】") >= 0) usesEn = true;
          for (var ti = 0; ti < tplKeys.length; ti++) {
            if ((model.templates[tplKeys[ti]] || []).indexOf("【本站英文】") >= 0) usesEn = true;
          }
          var enName = (dir === "up" ? model.upStationsEn : model.downStationsEn)[idx] || "";
          if (usesEn && !(model.stationAudioMapEn || {})[dir + ":" + stopIdx] && enName) {
            files.push(enName);
          }
        }
      });
    });

    return files;
  };

  LE.validateAll = async function (model, companyRelPath) {
    var lineErrors = [];
    var audioWarnings = [];

    /* ── Line file checks ── */
    // 1. Line name required
    if (!model.lineName || !model.lineName.trim()) {
      lineErrors.push({ field: "lineName", module: "基础信息", message: "线路名称为必填项" });
    }
    // 2. Station count
    if (!model.upStationsCn.length || !model.downStationsCn.length) {
      lineErrors.push({ field: "stations", module: "车站信息", message: "上/下行至少需要1个站点" });
    }
    // Auto-pad shorter EN arrays to match CN length
    while (model.upStationsEn.length < model.upStationsCn.length) model.upStationsEn.push("");
    while (model.downStationsEn.length < model.downStationsCn.length) model.downStationsEn.push("");
    while (model.upStationsCn.length < model.upStationsEn.length) model.upStationsCn.push("");
    while (model.downStationsCn.length < model.downStationsEn.length) model.downStationsCn.push("");
    // 3. Empty station names
    var emptyUpNames = [];
    model.upStationsCn.forEach(function (n, i) { if (!n || !n.trim()) emptyUpNames.push(i + 1); });
    if (emptyUpNames.length) {
      lineErrors.push({ field: "upStations", module: "车站信息", message: "上行第 " + emptyUpNames.join(", ") + " 站中文名为空" });
    }
    var emptyDownNames = [];
    model.downStationsCn.forEach(function (n, i) { if (!n || !n.trim()) emptyDownNames.push(i + 1); });
    if (emptyDownNames.length) {
      lineErrors.push({ field: "downStations", module: "车站信息", message: "下行第 " + emptyDownNames.join(", ") + " 站中文名为空" });
    }
    // 4. Template token syntax
    var tKeys = ["upFirstDepart", "downFirstDepart", "upDepart", "upArrive", "downDepart", "downArrive", "upTerminalDepart", "upTerminalArrive", "downTerminalDepart", "downTerminalArrive"];
    var tLabels = {
      upFirstDepart: "首站上行预报规则", downFirstDepart: "首站下行预报规则",
      upDepart: "默认上行预报规则", upArrive: "默认上行到站播报规则",
      downDepart: "默认下行预报规则", downArrive: "默认下行到站播报规则",
      upTerminalDepart: "上行终点站预报规则", upTerminalArrive: "上行终点站报站规则",
      downTerminalDepart: "下行终点站预报规则", downTerminalArrive: "下行终点站报站规则",
    };
    tKeys.forEach(function (k) {
      var tokens = model.templates[k] || [];
      for (var i = 0; i < tokens.length; i++) {
        if (typeof tokens[i] === "string" && tokens[i].indexOf(">") >= 0) {
          lineErrors.push({ field: k, module: "全局报站规则", message: tLabels[k] + " 第" + (i + 1) + "个标记包含非法字符 >" });
        }
      }
    });

    /* ── Audio file checks ── */
    if (companyRelPath) {
      try {
        var mediaResp = await LE.api.listMedia(companyRelPath);
        var mediaNames = (mediaResp.items || []).map(function (f) { return f.name; });

        // Build lowercased media name set for case-insensitive matching
        var mediaNamesLower = {};
        mediaNames.forEach(function (n) { mediaNamesLower[n.toLowerCase()] = n; });

        var refMap = {}; // file → { locations: [...] }

        function addRef(file, location) {
          if (!file) return;
          file = file.replace(/^"|"$/g, ""); // Strip INI-format quotes
          if (!file || LE.isParamToken(file) || LE.isTemplateMarker(file)) return;
          if (!refMap[file]) refMap[file] = [];
          if (refMap[file].indexOf(location) < 0) refMap[file].push(location);
        }

        // Templates
        for (var k in model.templates) {
          var tokens = model.templates[k] || [];
          tokens.forEach(function (t) { addRef(t, tLabels[k] || k); });
        }

        // Station overrides (depart, arrive, zhAudioRel, enAudioRel)
        ["up", "down"].forEach(function (dir) {
          var dirLabel = dir === "up" ? "上行" : "下行";
          var overrides = model.stationOverrides[dir] || {};
          var stations = dir === "up" ? model.upStationsCn : model.downStationsCn;
          for (var si in overrides) {
            var idx = parseInt(si);
            var stName = stations[idx - 1] || ("第" + idx + "站");
            var locBase = dirLabel + stName;
            var ov = overrides[si];
            (ov.depart || []).forEach(function (t) { addRef(t, locBase + "预报规则"); });
            (ov.arrive || []).forEach(function (t) { addRef(t, locBase + "到站规则"); });
            // zhAudioRel/enAudioRel are strings (serialized tokens), not arrays
            if (ov.zhAudioRel) {
              var zhToks = parseRuleTokens(ov.zhAudioRel);
              zhToks.forEach(function (t) { addRef(t, locBase + "本站中文语音"); });
            }
            if (ov.enAudioRel) {
              var enToks = parseRuleTokens(ov.enAudioRel);
              enToks.forEach(function (t) { addRef(t, locBase + "本站英文语音"); });
            }
          }
        });

        // Station audio maps (keys are station names for zh, dir:stopIdx for en)
        for (var k in model.stationAudioMap) {
          addRef(model.stationAudioMap[k], k + "站中文语音映射");
        }
        for (var k2 in model.stationAudioMapEn) {
          var parts = k2.split(":");
          var dirLabel = (parts[0] === "up") ? "上行" : "下行";
          var sIdx = parseInt(parts[1]) || 0;
          addRef(model.stationAudioMapEn[k2], dirLabel + "第" + sIdx + "站英文语音映射");
        }

        // Tips
        (model.tipItems || []).forEach(function (tip, i) {
          (tip.ruleTokens || []).forEach(function (t) {
            addRef(t, "服务语" + (i + 1) + "（" + (tip.name || "未命名") + "）");
          });
        });

        // Implicit same-name file checks (本站中文/英文同名文件)
        ["up", "down"].forEach(function (dir) {
          var stations = dir === "up" ? (model.upStationsCn || []) : (model.downStationsCn || []);
          var tplKeys = dir === "up"
            ? ["upDepart", "upArrive", "upFirstDepart", "upTerminalDepart", "upTerminalArrive"]
            : ["downDepart", "downArrive", "downFirstDepart", "downTerminalDepart", "downTerminalArrive"];
          stations.forEach(function (name, idx) {
            if (!name || !name.trim()) return;
            var stopIdx = idx + 1;
            var ov = (model.stationOverrides[dir] || {})[stopIdx] || {};

            // Check ZH
            var hasZhOverride = !!(ov.zhAudioRel && ov.zhAudioRel.trim());
            if (!hasZhOverride && !model.stationAudioMap[name]) {
              var usesZh2 = false;
              if ((ov.depart || []).indexOf("【本站中文】") >= 0 || (ov.arrive || []).indexOf("【本站中文】") >= 0) usesZh2 = true;
              for (var ti = 0; ti < tplKeys.length && !usesZh2; ti++) {
                if ((model.templates[tplKeys[ti]] || []).indexOf("【本站中文】") >= 0) usesZh2 = true;
              }
              if (usesZh2) {
                // Check if a file matching the station name exists
                var zhFound = false;
                for (var mi = 0; mi < mediaNames.length; mi++) {
                  var mn = mediaNames[mi];
                  var base = mn.replace(/\.\w+$/, "");
                  if (base === name || base.toLowerCase() === name.toLowerCase()) { zhFound = true; break; }
                }
                if (!zhFound) {
                  audioWarnings.push({
                    file: name + " (同名文件)",
                    locations: [(dir === "up" ? "上行" : "下行") + name + "站本站中文语音（同名文件匹配）"],
                  });
                }
              }
            }

            // Check EN
            var hasEnOverride = !!(ov.enAudioRel && ov.enAudioRel.trim());
            var enName = (dir === "up" ? model.upStationsEn : model.downStationsEn)[idx] || "";
            if (!hasEnOverride && enName && !((model.stationAudioMapEn || {})[dir + ":" + stopIdx])) {
              var usesEn2 = false;
              if ((ov.depart || []).indexOf("【本站英文】") >= 0 || (ov.arrive || []).indexOf("【本站英文】") >= 0) usesEn2 = true;
              for (var ti = 0; ti < tplKeys.length && !usesEn2; ti++) {
                if ((model.templates[tplKeys[ti]] || []).indexOf("【本站英文】") >= 0) usesEn2 = true;
              }
              if (usesEn2) {
                var enFound = false;
                for (var mi = 0; mi < mediaNames.length; mi++) {
                  var mn2 = mediaNames[mi];
                  var base2 = mn2.replace(/\.\w+$/, "");
                  if (base2 === enName || base2.toLowerCase() === enName.toLowerCase()) { enFound = true; break; }
                }
                if (!enFound) {
                  audioWarnings.push({
                    file: enName + " (同名文件)",
                    locations: [(dir === "up" ? "上行" : "下行") + name + "站本站英文语音（同名文件匹配）"],
                  });
                }
              }
            }
          });
        });

        // Check each ref against media files (case-insensitive)
        for (var file in refMap) {
          if (!(file.toLowerCase() in mediaNamesLower)) {
            audioWarnings.push({
              file: file,
              locations: refMap[file],
            });
          }
        }
      } catch (e) {
        console.warn("[editor-core] Audio validation skipped:", e.message);
      }
    }

    return { lineErrors: lineErrors, audioWarnings: audioWarnings };
  };

  /* ── Cross-line apply ── */
  LE.applyToOtherLines = async function (targetLines, applyConfig) {
    var results = { success: [], failed: [] };
    var srcModel = LE.state.editModel;
    for (var i = 0; i < targetLines.length; i++) {
      var target = targetLines[i];
      try {
        var resp = await LE.api.readFile(target.file);
        var targetModel = LE.parseIni(resp.content);
        var strategy = applyConfig.strategy || "overwrite";
        var scope = applyConfig.scope;

        var scopes = scope === "all_templates" ? ["templates", "tips"] : [scope];

        scopes.forEach(function (sc) {
          if (sc === "templates") {
            if (strategy === "overwrite") {
              targetModel.templates = JSON.parse(JSON.stringify(srcModel.templates));
              targetModel.isUpDownSame = srcModel.isUpDownSame;
            } else if (strategy === "fill_empty") {
              // Fill only empty template fields
              var tKeys = Object.keys(srcModel.templates);
              tKeys.forEach(function (k) {
                if (!targetModel.templates[k] || !targetModel.templates[k].length) {
                  targetModel.templates[k] = JSON.parse(JSON.stringify(srcModel.templates[k] || []));
                }
              });
            }
          } else if (sc === "tips") {
            if (strategy === "overwrite") {
              targetModel.tipItems = JSON.parse(JSON.stringify(srcModel.tipItems));
            } else if (strategy === "fill_empty") {
              var srcTips = srcModel.tipItems || [];
              var tgtTips = targetModel.tipItems || [];
              while (tgtTips.length < 10) tgtTips.push({ name: "", ruleTokens: [] });
              for (var ti = 0; ti < 10; ti++) {
                var st = srcTips[ti];
                if (!st) continue;
                var tt = tgtTips[ti] || { name: "", ruleTokens: [] };
                if (!tt.name && st.name) tt.name = st.name;
                if ((!tt.ruleTokens || !tt.ruleTokens.length) && st.ruleTokens && st.ruleTokens.length) {
                  tt.ruleTokens = JSON.parse(JSON.stringify(st.ruleTokens));
                }
                tgtTips[ti] = tt;
              }
              targetModel.tipItems = tgtTips;
            }
          } else if (sc === "stationRule") {
            if (strategy === "overwrite") {
              var srcOverride = applyConfig.srcOverride;
              var srcStopName = applyConfig.srcStopName;
              ["up", "down"].forEach(function (dir) {
                var stops = targetModel[dir === "up" ? "upStationsCn" : "downStationsCn"];
                for (var s = 0; s < stops.length; s++) {
                  if (stops[s] === srcStopName) {
                    targetModel.stationOverrides[dir][s + 1] = JSON.parse(JSON.stringify(srcOverride));
                  }
                }
              });
            }
          }
        });

        var newText = LE.serializeIni(targetModel);
        await LE.api.writeFile(target.file, newText);
        results.success.push(target.name || target.file);
      } catch (e) {
        results.failed.push({ name: target.name || target.file, error: e.message });
      }
    }
    return results;
  };

  /* ── Station auto-recognition ── */
  LE.recognizeStations = function (text, lang) {
    if (!text || !text.trim()) return [];
    var cleaned = text.replace(/\r/g, "\n");
    if (lang === "zh") {
      // Chinese: split on spaces, punctuation, arrows, digits with context
      var parts = cleaned.split(/[\s,，、;；\n。\.—\-—→←➜＞>]+/);
      return parts.map(function (p) { return p.trim(); }).filter(function (p) {
        return p && !/^\d+$/.test(p);
      });
    } else {
      // English: split on 2+ spaces, semicolons, commas, newlines, dashes, arrows, emoji
      var parts2 = cleaned.split(/(?:\s{2,}|[;；\n—\-—→←➜＞>]|(?:\s*[,.]\s*))+/);
      return parts2.map(function (p) { return p.trim(); }).filter(function (p) {
        return p && !/^\d+$/.test(p);
      });
    }
  };

  /* ── Generate timestamp for save ── */
  LE.nowStr = function () {
    var d = new Date();
    var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate()) +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  };

  /* ── Audio file existence check ── */
  LE.checkFileExists = async function (fileName, company) {
    // Simple HEAD check via the static file server
    var encoded = encodeURIComponent(fileName);
    var paths = [
      "../报站线路文件库/" + company + "/" + encoded,
      "../报站线路文件库/" + encodeURIComponent(company) + "/" + encoded,
    ];
    for (var i = 0; i < paths.length; i++) {
      try {
        var resp = await fetch(paths[i], { method: "HEAD" });
        if (resp.ok) return true;
      } catch (e) { /* continue */ }
    }
    return false;
  };

  LE.checkFilesExist = async function (fileNames, company) {
    var results = {};
    var cache = {};
    for (var i = 0; i < fileNames.length; i++) {
      var fn = fileNames[i];
      if (cache[fn] !== undefined) { results[fn] = cache[fn]; continue; }
      var exists = await LE.checkFileExists(fn, company);
      cache[fn] = exists;
      results[fn] = exists;
    }
    return results;
  };

  return LE;
})();
