/* editor-components.js — V1.6: Rule Editor + Audio Selector */
(function () {
  var LE = window.LineEditor;
  if (!LE) return;
  console.log("[editor-components] Initializing...");

  var PARAM_DEFS = [
    { key: "【本站中文文件】", label: "本站中文文件", color: "#22c55e" },
    { key: "【本站英文文件】", label: "本站英文文件", color: "#4ade80" },
    { key: "【本站中文】", label: "本站中文", color: "#22c55e" },
    { key: "【本站英文】", label: "本站英文", color: "#4ade80" },
    { key: "【下站中文】", label: "下站中文", color: "#f97316" },
    { key: "【下站英文】", label: "下站英文", color: "#eab308" },
    { key: "【起始站中文】", label: "起始站中文", color: "#a855f7" },
    { key: "【起始站英文】", label: "起始站英文", color: "#c084fc" },
    { key: "【终点站中文】", label: "终点站中文", color: "#06b6d4" },
    { key: "【终点站英文】", label: "终点站英文", color: "#67e8f9" },
    { key: "【普通站预报模板】", label: "普通站预报模板", color: "#f59e0b" },
    { key: "【普通站到站模板】", label: "普通站到站模板", color: "#d97706" },
  ];

  // NOTE: context is base; subContext merged on top. 默认模版 only in station_depart/station_arrive.
  var CONTEXT_DISABLED = {
    "global_template": [],
    "station_depart": ["【普通站预报模板】", "【普通站到站模板】"],
    "station_arrive": ["【普通站预报模板】", "【普通站到站模板】"],
    "station_zh_audio": ["【普通站预报模板】", "【普通站到站模板】"],
    "station_en_audio": ["【普通站预报模板】", "【普通站到站模板】"],
    "terminal_depart": ["【下站中文】", "【下站英文】", "【普通站到站模板】"],
    "terminal_arrive": ["【下站中文】", "【下站英文】", "【普通站预报模板】"],
    "first_depart": ["【普通站到站模板】"],
    "tip": ["【普通站预报模板】", "【普通站到站模板】"],
  };

  function paramDef(k) { return PARAM_DEFS.find(function (p) { return p.key === k; }); }

  /* ═══════════════════ RULE EDITOR ═══════════════════ */
  LE.createRuleEditor = function (config) {
    config = config || {};
    var tokens = (config.tokens || []).slice();
    var context = config.context || "station_depart";
    var subContext = config.subContext || context; // V1.6: subContext overrides param filtering
    var placeholder = config.placeholder || "";
    var companyRelPath = config.companyRelPath || "";
    var onChange = config.onChange || function () {};
    var defaultTokens = config.defaultTokens || null;
    var stationContext = config.stationContext || {};
    var overlayLabel = config.overlayLabel || null; // custom overlay text; null = "默认规则"

    // Merge disabled params: context (e.g. global_template) + subContext (e.g. first_depart)
    var baseDisabled = CONTEXT_DISABLED[context] || [];
    var subDisabled = CONTEXT_DISABLED[subContext] || [];
    var disabledParams = baseDisabled.concat(subDisabled.filter(function (p) { return baseDisabled.indexOf(p) < 0; }));
    var availableParams = PARAM_DEFS.filter(function (p) { return disabledParams.indexOf(p.key) < 0; });

    var container = document.createElement("div");
    container.className = "rule-editor";
    container.tabIndex = 0;

    var editingIdx = -1;
    var audioPopup = null;
    var overlayBroken = false;    // true after user clicks overlay to reveal/edit
    var overlayEl = null;         // reference to current overlay DOM element
    var _usingDefaultTokens = false; // true when render() is showing expanded default tokens

    function ensureDefaultTokens() {
      // Copy default tokens into actual tokens without breaking overlay
      if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === "【默认模版】")) {
        tokens = defaultTokens.slice();
      }
    }
    function breakOverlay() {
      if (!_usingDefaultTokens) return;
      ensureDefaultTokens();
      overlayBroken = true;
    }

    function fireChange() {
      var filtered = tokens.filter(function (t) { return t !== ""; });
      console.log("[rule-editor] fireChange, tokens=" + JSON.stringify(filtered));
      onChange(filtered);
    }

    function hidePopup() {
      if (audioPopup) {
        console.log("[rule-editor] hidePopup");
        audioPopup.remove(); audioPopup = null;
      }
    }

    /* ── Annotated label for default template display ── */
    function getAnnotatedLabel(tok) {
      var def = paramDef(tok);
      if (!def) return tok; // file token: show as-is
      var label = def.label;
      // Append station name annotation
      var ctx = stationContext;
      if (tok === "【本站中文文件】") {
        if (ctx.benZhanName) return "本站中文（" + ctx.benZhanName + ".*）";
        return "本站中文（默认匹配）";
      }
      if (tok === "【本站英文文件】") {
        var enName = ctx.benZhanEnName || "";
        if (enName) return "本站英文（" + enName + ".*）";
        return "本站英文（无）";
      }
      if (tok === "【本站中文】") {
        if (ctx.benZhanName) return label + "（" + ctx.benZhanName + "站）";
      }
      if (tok === "【本站英文】" || tok === "【英文本站】") {
        var en = ctx.benZhanEnName || ctx.benZhanName || "";
        if (en) return label + "（" + en + "站）";
      }
      if (tok === "【下站中文】") {
        if (ctx.xiaZhanName) return label + "（" + ctx.xiaZhanName + "站）";
      }
      if (tok === "【下站英文】" || tok === "【英文下站】") {
        var enXia = ctx.xiaZhanEnName || ctx.xiaZhanName || "";
        if (enXia) return label + "（" + enXia + "站）";
      }
      if (tok === "【起始站中文】") {
        if (ctx.startName) return label + "（" + ctx.startName + "站）";
      }
      if (tok === "【起始站英文】") {
        var enStart = ctx.startEnName || ctx.startName || "";
        if (enStart) return label + "（" + enStart + "站）";
      }
      if (tok === "【终点站中文】") {
        if (ctx.endName) return label + "（" + ctx.endName + "站）";
      }
      if (tok === "【终点站英文】") {
        var enEnd = ctx.endEnName || ctx.endName || "";
        if (enEnd) return label + "（" + enEnd + "站）";
      }
      return label;
    }

    /* ── render ── */
    function render() {
      var displayTokens = tokens.slice();
      _usingDefaultTokens = false;
      var defaultMaskStart = -1;
      var defaultMaskEnd = -1;

      if (defaultTokens && defaultTokens.length && !overlayBroken) {
        if (tokens.length === 0) {
          // Case 1: completely empty — show full default
          displayTokens = defaultTokens.slice();
          defaultMaskStart = 0;
          defaultMaskEnd = displayTokens.length;
        } else if (tokens.length === 1 && tokens[0] === "【默认模版】") {
          // Case 2: only 【默认模版】 — expand it
          displayTokens = defaultTokens.slice();
          defaultMaskStart = 0;
          defaultMaskEnd = displayTokens.length;
        } else {
          var dtIdx = tokens.indexOf("【默认模版】");
          if (dtIdx >= 0) {
            // Case 3: contains 【默认模版】 — expand in place
            var expanded = [];
            for (var ti = 0; ti < tokens.length; ti++) {
              if (tokens[ti] === "【默认模版】") {
                defaultMaskStart = expanded.length;
                expanded = expanded.concat(defaultTokens);
                defaultMaskEnd = expanded.length;
              } else {
                expanded.push(tokens[ti]);
              }
            }
            displayTokens = expanded;
          }
        }
        if (defaultMaskStart >= 0 && defaultMaskEnd > defaultMaskStart) {
          _usingDefaultTokens = true;
        }
      }

      container.innerHTML = "";

      // If showing default sequence, wrap everything in a container for badge positioning.
      // The wrapper holds: leading gap + all default tags + inter gaps + end inserter.
      // This ensures no separate flex children that could cause line wrapping in the outer container.
      var defaultWrapper = null;
      if (_usingDefaultTokens && defaultMaskStart >= 0) {
        defaultWrapper = document.createElement("span");
        defaultWrapper.className = "ed-default-wrapper";
        defaultWrapper.style.position = "relative";
        defaultWrapper.style.display = "inline-flex";
        defaultWrapper.style.flexWrap = "wrap";
        defaultWrapper.style.gap = "3px";
        defaultWrapper.style.alignItems = "center";
        container.appendChild(defaultWrapper);
        // Badge via CSS ::before — always at top, full width, never covered by tags
        defaultWrapper.setAttribute("data-badge-text", overlayLabel || "默认规则");
      }

      // If no default wrapper, leading gap goes directly in container
      if (!defaultWrapper && displayTokens.length > 0) {
        var leadGap = document.createElement("span");
        leadGap.className = "re-gap";
        leadGap.addEventListener("click", function (e) {
          e.stopPropagation();
          if (editingIdx >= 0) commitEdit(editingIdx, null);
          tokens.splice(0, 0, "");
          editingIdx = 0;
          render();
          requestAnimationFrame(function () {
            showPopup(container.querySelector('.re-tag[data-idx="0"] input'), "");
          });
        });
        container.appendChild(leadGap);
      }

      // Leading gap inside wrapper (if using wrapper, prepend before first tag)
      if (defaultWrapper && displayTokens.length > 0) {
        var wLeadGap = document.createElement("span");
        wLeadGap.className = "re-gap";
        wLeadGap.addEventListener("click", function (e) {
          e.stopPropagation();
          if (editingIdx >= 0) commitEdit(editingIdx, null);
          // Insert at defaultMaskStart (before the default sequence), not position 0
          var insertPos = defaultMaskStart > 0 ? defaultMaskStart : 0;
          if (_usingDefaultTokens) { ensureDefaultTokens(); }
          tokens.splice(insertPos, 0, "");
          editingIdx = insertPos;
          render();
          requestAnimationFrame(function () {
            showPopup(container.querySelector('.re-tag[data-idx="' + insertPos + '"] input'), "");
          });
        });
        defaultWrapper.appendChild(wLeadGap);
      }

      displayTokens.forEach(function (tok, i) {
        var isP = LE.isParamToken(tok);
        var def = isP ? paramDef(tok) : null;
        var isDefaultMasked = _usingDefaultTokens && i >= defaultMaskStart && i < defaultMaskEnd;
        var label = isP ? (def ? (isDefaultMasked ? getAnnotatedLabel(tok) : def.label) : tok) : tok;
        var inEdit = (editingIdx === i) && !isDefaultMasked;

        // ALL tags go into wrapper when showing default, to keep single flex layout
        var parentEl = (defaultWrapper) ? defaultWrapper : container;

        var tag = document.createElement("span");
        tag.className = "re-tag" + (isP ? " re-tag-param" : " re-tag-file") + (inEdit ? " editing" : "") + (isDefaultMasked ? " re-tag-default-masked" : "");
        tag.dataset.idx = i;
        if (isP && def) tag.style.setProperty("--re-color", def.color);

        if (inEdit) {
          var inp = document.createElement("input");
          inp.type = "text";
          inp.className = "re-tag-input";
          inp.value = tok;
          inp.style.minWidth = "90px";
          tag.appendChild(inp);
          requestAnimationFrame(function () {
            inp.focus();
            inp.select();
            showPopup(inp, inp.value);
          });
          inp.addEventListener("input", function () {
            showPopup(inp, inp.value);
            var m = measureWidth(inp.value, "13px sans-serif");
            inp.style.width = Math.max(90, m + 20) + "px";
          });
          inp.addEventListener("keydown", function (e) {
            if (e.key === "Enter") { e.preventDefault(); commitEdit(i, inp.value.trim()); }
            else if (e.key === "Escape") { e.preventDefault(); commitEdit(i, null, true); }
          });
          inp.addEventListener("blur", function () {
            setTimeout(function () { if (editingIdx === i) commitEdit(i, inp.value.trim()); }, 120);
          });
        } else {
          var txt = document.createElement("span");
          txt.className = "re-tag-text";
          txt.textContent = label;
          tag.appendChild(txt);

          if (!isDefaultMasked) {
            var del = document.createElement("span");
            del.className = "re-tag-del";
            del.textContent = "×";
            del.addEventListener("mousedown", function (e) {
              e.preventDefault(); e.stopPropagation();
              tokens.splice(i, 1);
              editingIdx = -1; hidePopup(); render(); fireChange();
            });
            tag.appendChild(del);
          }

          tag.addEventListener("click", function (e) {
            if (e.target.classList.contains("re-tag-del")) return;
            if (isDefaultMasked) { breakOverlay(); }
            console.log("[rule-editor] tag click idx=" + i + ", editingIdx=" + editingIdx);
            if (editingIdx >= 0 && editingIdx !== i) commitEdit(editingIdx, null);
            if (editingIdx === i) return;
            editingIdx = i;
            render();
          });
        }

        parentEl.appendChild(tag);

        // Gap between tags
        if (i < displayTokens.length - 1) {
          var nextIsMasked = _usingDefaultTokens && (i + 1) >= defaultMaskStart && (i + 1) < defaultMaskEnd;
          var gapIsMasked = isDefaultMasked && nextIsMasked;
          var gap = document.createElement("span");
          gap.className = "re-gap" + (gapIsMasked ? " re-gap-default-masked" : "");
          (function (pos) {
            gap.addEventListener("click", function (e) {
              e.stopPropagation();
              if (gapIsMasked) { breakOverlay(); }
              console.log("[rule-editor] gap click pos=" + pos + ", editingIdx=" + editingIdx);
              if (editingIdx >= 0) commitEdit(editingIdx, null);
              tokens.splice(pos, 0, "");
              editingIdx = pos;
              render();
              requestAnimationFrame(function () {
                showPopup(container.querySelector('.re-tag[data-idx="' + pos + '"] input'), "");
              });
            });
          })(i + 1);
          parentEl.appendChild(gap);
        }
      });

      // End inserter — append to last tag's parent so it stays inline
      var endIns = document.createElement("span");
      endIns.className = "re-end-inserter";
      endIns.textContent = "＋";
      endIns.addEventListener("click", function (e) {
        e.stopPropagation();
        console.log("[rule-editor] end+ click, editingIdx=" + editingIdx + ", tokensLen=" + tokens.length);
        if (editingIdx >= 0) commitEdit(editingIdx, null);
        if (_usingDefaultTokens) { ensureDefaultTokens(); }
        var pos = tokens.length;
        tokens.push("");
        editingIdx = pos;
        render();
        requestAnimationFrame(function () {
          var t = container.querySelector('.re-tag[data-idx="' + pos + '"]');
          if (t) { var inp = t.querySelector("input"); if (inp) showPopup(inp, ""); }
        });
      });
      // Appends after ALL tags — always into the wrapper if showing default
      (defaultWrapper || container).appendChild(endIns);

      // Placeholder when empty and not showing default
      if (!displayTokens.length) {
        var ph = document.createElement("span");
        ph.className = "re-placeholder";
        ph.textContent = placeholder || "点击＋添加...";
        container.appendChild(ph);
      }

      // Click container background commits edit
      container.addEventListener("click", function (e) {
        if (e.target === container && editingIdx >= 0) commitEdit(editingIdx, null);
      });

    }

    /* ── commit edit ── */
    function commitEdit(i, val, revert) {
      console.log("[rule-editor] commitEdit i=" + i + ", val=" + JSON.stringify(val) + ", revert=" + revert + ", editingIdx=" + editingIdx);
      if (i < 0 || i >= tokens.length) { editingIdx = -1; hidePopup(); render(); return; }
      if (revert) { editingIdx = -1; hidePopup(); render(); return; }
      if (val === null || val === undefined) {
        if (tokens[i] === "") { tokens.splice(i, 1); }
        editingIdx = -1; hidePopup(); render(); return;
      }

      if (!val) {
        tokens.splice(i, 1);
      } else {
        if (val.indexOf(">") >= 0) { val = ""; LE.toast("不能包含 > 字符", "warn"); }
        if (val.indexOf('"') >= 0) { val = ""; LE.toast('不能包含 " 字符', "warn"); }
        if (val) {
          var matched = availableParams.find(function (p) {
            return val === p.key || val === p.label || val === "{" + p.label + "}" || val === p.key.replace(/【】/g, "");
          });
          tokens[i] = matched ? matched.key : val;
        } else {
          tokens.splice(i, 1);
        }
      }
      editingIdx = -1;
      hidePopup();
      render();
      fireChange();
    }

    /* ── Audio popup ── */
    function showPopup(anchorEl, query) {
      console.log("[rule-editor] showPopup called, query=" + JSON.stringify(query) + ", companyRelPath=" + JSON.stringify(companyRelPath));
      hidePopup();
      audioPopup = mkPopup(anchorEl, query || "");
      document.body.appendChild(audioPopup);
      console.log("[rule-editor] popup appended to body, class=" + audioPopup.className + ", pos=" + audioPopup.style.left + "," + audioPopup.style.top + ", w=" + audioPopup.style.width);
    }

    function mkPopup(anchor, query) {
      var popup = document.createElement("div");
      popup.className = "audio-selector-popup";
      var ar = anchor.getBoundingClientRect();
      var cr = container.getBoundingClientRect();
      popup.style.position = "fixed";
      popup.style.left = cr.left + "px";
      popup.style.width = Math.max(280, cr.width) + "px";
      // Position: below anchor normally, above if not enough space. Equal gap.
      var gap = 6;
      var estHeight = 320;
      var safeMargin = 16;
      var spaceBelow = window.innerHeight - ar.bottom - safeMargin;
      if (spaceBelow >= estHeight) {
        // Enough space below — top-align popup below the tag
        popup.style.top = (ar.bottom + gap) + "px";
        popup.style.bottom = "auto";
      } else {
        // Not enough space — bottom-align popup above the tag
        popup.style.bottom = (window.innerHeight - ar.top + gap) + "px";
        popup.style.top = "auto";
      }

      var tb = document.createElement("div"); tb.className = "as-toolbar";
      tb.innerHTML = '<button>打开文件夹</button><button>刷新</button><button>上传</button>';
      popup.appendChild(tb);

      var fl = document.createElement("div"); fl.className = "as-file-list";
      popup.appendChild(fl);

      var pe = document.createElement("div"); pe.className = "as-params";
      availableParams.forEach(function (p) {
        var t = document.createElement("span"); t.className = "as-param-tag";
        t.textContent = p.label; t.title = p.desc || "";
        t.style.background = p.color + "22"; t.style.borderColor = p.color; t.style.color = p.color;
        t.addEventListener("mousedown", function (ev) { ev.preventDefault(); ev.stopPropagation();
          if (editingIdx >= 0) { tokens[editingIdx] = p.key; editingIdx = -1; hidePopup(); render(); fireChange(); }
          else { tokens.push(p.key); hidePopup(); render(); fireChange(); }
        });
        pe.appendChild(t);
      });
      popup.appendChild(pe);

      var ht = document.createElement("div"); ht.className = "as-hint";
      ht.textContent = "手动输入，按回车键保存";
      popup.appendChild(ht);

      function load() {
        console.log("[audio-popup] load start, companyRelPath=" + JSON.stringify(companyRelPath) + ", query=" + JSON.stringify(query));
        fl.innerHTML = '<div class="ed-empty">搜索中...</div>';
        if (!companyRelPath) { fl.innerHTML = '<div class="ed-empty">未关联公司目录</div>'; console.log("[audio-popup] no companyRelPath"); return; }
        var p = LE.api.listMedia(companyRelPath).catch(function (err) {
          console.log("[audio-popup] listMedia failed, falling back to listDir:", err.message);
          return LE.api.listDir(companyRelPath, true).then(function (r) {
            var exts = [".wav", ".mp3", ".m4a", ".WAV", ".MP3", ".M4A"];
            var items = (r.items || []).filter(function (x) { return !x.isDir && exts.some(function (e) { return x.name.endsWith(e); }); });
            var seen = {}; var dedup = [];
            items.forEach(function (x) { var s = x.name.replace(/\.\w+$/, "").toLowerCase(); if (!seen[s]) { seen[s] = true; dedup.push(x); } });
            return { items: dedup };
          });
        });
        p.then(function (r) {
          console.log("[audio-popup] files loaded, count=" + ((r.items||[]).length));
          var items = r.items || [];
          if (query) { var ql = query.toLowerCase(); items = items.filter(function (f) { return f.name.toLowerCase().indexOf(ql) >= 0; }); }
          if (!items.length) { fl.innerHTML = '<div class="ed-empty">' + (query ? '无匹配文件' : '目录无音频文件') + '</div>'; console.log("[audio-popup] no items after filter"); return; }
          var show = query ? items.slice(0, 20) : items.slice(0, 5);
          fl.innerHTML = show.map(function (f) {
            var sz = f.size ? (f.size < 1024 ? f.size + "B" : f.size < 1048576 ? (f.size / 1024).toFixed(1) + "KB" : (f.size / 1048576).toFixed(1) + "MB") : "";
            return '<div class="as-file-item" data-file="' + LE.escHtml(f.name) + '"><span>' + LE.escHtml(f.name) + '</span><span class="as-file-meta">' + sz + '</span></div>';
          }).join("");
          fl.querySelectorAll(".as-file-item").forEach(function (it) {
            it.addEventListener("mousedown", function (ev) { ev.preventDefault(); ev.stopPropagation();
              var fn = it.dataset.file;
              if (editingIdx >= 0) { tokens[editingIdx] = fn; editingIdx = -1; hidePopup(); render(); fireChange(); }
              else { tokens.push(fn); hidePopup(); render(); fireChange(); }
            });
          });
        }).catch(function (err) {
          console.error("[audio-popup] load failed:", err.message || err);
          fl.innerHTML = '<div class="ed-empty">加载失败</div>';
        });
      }
      load();

      tb.children[1].addEventListener("mousedown", function (ev) { ev.preventDefault(); ev.stopPropagation(); load(); });
      tb.children[0].addEventListener("mousedown", function (ev) { ev.preventDefault(); ev.stopPropagation(); if (LE.showMediaBrowser) LE.showMediaBrowser(companyRelPath); });
      tb.children[2].addEventListener("mousedown", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var fi = document.createElement("input"); fi.type = "file"; fi.accept = ".wav,.mp3,.m4a"; fi.multiple = true;
        fi.onchange = function () { var files = fi.files; console.log("[audio-upload] Selected " + files.length + " file(s), relPath=" + companyRelPath); var done = 0; function up(j) { if (j >= files.length) { console.log("[audio-upload] Done: " + done + "/" + files.length + " uploaded"); if (done) { LE.toast("已上传 " + done + " 个文件", "success"); load(); } return; } var fd = new FormData(); fd.append("file", files[j]); fd.append("relPath", companyRelPath); console.log("[audio-upload] Uploading " + files[j].name + " (" + files[j].size + " bytes)..."); fetch("/api/file/upload", { method: "POST", body: fd }).then(function (r) { console.log("[audio-upload] Response status: " + r.status); return r.json(); }).then(function (rsp) { console.log("[audio-upload] Response body:", JSON.stringify(rsp)); if (rsp.ok) done++; up(j + 1); }).catch(function (err) { console.error("[audio-upload] Upload error:", err); up(j + 1); }); } up(0); };
        fi.click();
      });

      setTimeout(function () {
        var h = function (ev) { if (!popup.contains(ev.target) && ev.target !== anchor && ev.target !== container) { popup.remove(); audioPopup = null; document.removeEventListener("mousedown", h); } };
        document.addEventListener("mousedown", h);
      }, 50);

      return popup;
    }

    container.getTokens = function () { return tokens.filter(function (t) { return t !== ""; }); };
    container.setTokens = function (tks) {
      tokens = (tks || []).slice();
      editingIdx = -1; hidePopup();
      // Reset overlay state when tokens are set externally
      if (defaultTokens && defaultTokens.length) {
        var hasOnlyDefault = (tokens.length === 1 && tokens[0] === "【默认模版】");
        if (tokens.length === 0 || hasOnlyDefault) {
          overlayBroken = false;
        }
      }
      render();
    };
    container.setCompanyRelPath = function (p) { companyRelPath = p; };

    // ── Blur → fold-back check ──
    container.addEventListener("focusout", function () {
      setTimeout(function () {
        if (!container.contains(document.activeElement)) {
          if (overlayBroken && defaultTokens && defaultTokens.length) {
            // Check if current tokens contain the complete default sequence
            var seq = LE.findSubsequence(tokens, defaultTokens);
            if (seq.found) {
              // Fold: replace the default subsequence
              var before = tokens.slice(0, seq.start);
              var after = tokens.slice(seq.end);
              // For audio file fields (overlayLabel === "默认"), fold to empty (no 【默认模版】 concept)
              if (overlayLabel === "默认") {
                tokens = before.concat(after);
              } else {
                tokens = before.concat(["【默认模版】"]).concat(after);
              }
              overlayBroken = false;
              editingIdx = -1;
              render();
              fireChange();
            }
          }
        }
      }, 150);
    });

    render();
    return container;
  };

  LE.isParamToken = function (tok) { return !!paramDef(tok); };
  LE.paramLabel = function (tok) { var d = paramDef(tok); return d ? d.label : tok; };
  function measureWidth(txt, font) { var c = document.createElement("canvas"); var ctx = c.getContext("2d"); ctx.font = font || "13px sans-serif"; return ctx.measureText(txt).width; }

  console.log("[editor-components] Ready.");
})();
