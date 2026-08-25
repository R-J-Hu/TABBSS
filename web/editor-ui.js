/* editor-ui.js — V1.6 Visual Line Editor: UI Rendering & Navigation */
(function () {
  var LE = window.LineEditor;
  if (!LE) { console.error("editor-ui.js requires editor-core.js"); return; }

  console.log("[editor-ui] Initializing V1.6 Visual Editor...");

  /* ── DOM Refs (deferred until DOM ready) ── */
  var $ = function (id) { return document.getElementById(id); };
  var dock, toggleBtn, closeBtn, breadcrumbEl, pageContainer;

  function modalCloseButton() {
    return '<button type="button" class="ed-modal-close" aria-label="关闭"><svg class="ui-icon"><use href="#icon-close"></use></svg></button>';
  }

  function cacheDomRefs() {
    dock = $("lineEditorSidebar");
    toggleBtn = $("lineEditorToggle");
    closeBtn = $("lineEditorCloseBtn");
    breadcrumbEl = $("edBreadcrumb");
    pageContainer = $("edPageContainer");
    if (!dock) console.error("[editor-ui] #lineEditorSidebar not found!");
    if (!pageContainer) console.error("[editor-ui] #edPageContainer not found!");
  }

  /* ── Custom modal helpers (replaces browser prompt/confirm) ── */
  function showConfirmModal(title, message, onResult, danger) {
    var overlay = document.createElement("div");
    overlay.className = "ed-modal-overlay";
    overlay.innerHTML = '<div class="ed-modal" style="width:400px">' +
      '<div class="ed-modal-header"><h3>' + LE.escHtml(title) + '</h3>' + modalCloseButton() + '</div>' +
      '<div class="ed-modal-body"><p style="margin:0;color:#20355c">' + LE.escHtml(message) + '</p></div>' +
      '<div class="ed-modal-footer">' +
      '<button class="ed-btn ed-btn-ghost" id="emCancelBtn">取消</button>' +
      '<button class="ed-btn ' + (danger ? 'ed-btn-danger' : 'ed-btn-primary') + '" id="emConfirmBtn">确认</button></div></div>';
    $("lineEditorSidebar").appendChild(overlay);
    function cancel() { overlay.remove(); onResult(false); }
    overlay.querySelector("#emConfirmBtn").onclick = function () { overlay.remove(); onResult(true); };
    overlay.querySelector("#emCancelBtn").onclick = cancel;
    overlay.querySelector(".ed-modal-close").onclick = cancel;
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) cancel(); });
  }

  function showPromptModal(title, placeholder, defaultValue, onResult, checkboxLabel) {
    var overlay = document.createElement("div");
    overlay.className = "ed-modal-overlay";
    var cbHtml = checkboxLabel ? '<label class="ed-checkbox" style="margin-top:10px"><input type="checkbox" id="emPromptCheck"> ' + LE.escHtml(checkboxLabel) + '</label>' : '';
    overlay.innerHTML = '<div class="ed-modal" style="width:420px">' +
      '<div class="ed-modal-header"><h3>' + LE.escHtml(title) + '</h3>' + modalCloseButton() + '</div>' +
      '<div class="ed-modal-body">' +
      '<input id="emPromptInput" style="width:100%;padding:8px 10px;background:#ffffff;border:1px solid #d8e3f1;border-radius:6px;color:#17345f;font-size:13px;box-sizing:border-box" placeholder="' + LE.escHtml(placeholder || '') + '" value="' + LE.escHtml(defaultValue || '') + '">' +
      cbHtml +
      '</div>' +
      '<div class="ed-modal-footer">' +
      '<button class="ed-btn ed-btn-ghost" id="emCancelBtn">取消</button>' +
      '<button class="ed-btn ed-btn-primary" id="emConfirmBtn">确认</button></div></div>';
    $("lineEditorSidebar").appendChild(overlay);
    var inp = overlay.querySelector("#emPromptInput");
    inp.focus();
    inp.select();
    function confirm() {
      var val = inp.value.trim();
      var checked = overlay.querySelector("#emPromptCheck") ? overlay.querySelector("#emPromptCheck").checked : false;
      overlay.remove();
      onResult(val || null, checked);
    }
    overlay.querySelector("#emConfirmBtn").onclick = confirm;
    function cancel() { overlay.remove(); onResult(null, false); }
    overlay.querySelector("#emCancelBtn").onclick = cancel;
    overlay.querySelector(".ed-modal-close").onclick = cancel;
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) cancel(); });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); confirm(); } });
  }

  /* ── Init Sidebar Toggle ── */
  LE.initSidebar = function () {
    cacheDomRefs();
    if (!dock || !toggleBtn) {
      console.error("[editor-ui] Cannot init — dock or toggle missing");
      return;
    }
    console.log("[editor-ui] Sidebar init OK, binding toggle...");
    // "Switch to editing line" button — show/hide based on editor state
    LE._updateSwitchBtn = function () {
      var btn = document.getElementById("switchToEditorLineBtn");
      if (!btn) return;
      var dockOpen = dock && dock.classList.contains("open");
      var atL2 = LE.state.view && LE.state.view.startsWith("L2:");
      var hasLine = !!LE.state.currentLineRelPath;
      btn.style.display = (dockOpen && atL2 && hasLine) ? "" : "none";
    };

    toggleBtn.addEventListener("click", function () {
      var isOpen = dock.classList.toggle("open");
      var appRoot = $("appRoot");
      if (appRoot) appRoot.classList.toggle("with-dock-v2", isOpen);
      console.log("[editor-ui] Sidebar toggled, open=" + isOpen);
      if (isOpen) {
        LE.showPage(LE.state.view || "L0");
      }
      LE._updateSwitchBtn();
    });
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        dock.classList.remove("open");
        var appRoot = $("appRoot");
        if (appRoot) appRoot.classList.remove("with-dock-v2");
        LE._updateSwitchBtn();
      });
    }
    // Load L0 on init
    LE.state.view = "L0";

    // Bind "switch to editing line" button
    var switchBtn = document.getElementById("switchToEditorLineBtn");
    if (switchBtn) {
      switchBtn.addEventListener("click", function () {
        var relPath = LE.state.currentLineRelPath;
        if (!relPath) return;
        if (LE.mainCallbacks && LE.mainCallbacks.switchToLine) {
          LE.mainCallbacks.switchToLine(relPath);
        }
      });
    }
  };

  /* ── Navigation ── */
  LE.showPage = function (viewKey) {
    console.log("[editor-ui] showPage: " + viewKey);
    LE.state.view = viewKey;
    LE.renderBreadcrumb(viewKey);

    if (!pageContainer) { console.error("[editor-ui] pageContainer missing!"); return; }
    var pages = pageContainer.querySelectorAll(".ed-page");
    pages.forEach(function (p) { p.classList.remove("active"); });

    // Show target page BEFORE async render (so user sees loading state)
    var target = null;
    if (viewKey === "L0") {
      target = $("edL0Page");
      LE.state.currentLineRelPath = ""; // clear stale line when going to company list
      if (target) target.classList.add("active");
      LE.renderL0();
      return;
    } else if (viewKey.startsWith("L1:")) {
      target = $("edL1Page");
      LE.state.currentCompany = viewKey.substring(3);
      LE.state.currentLineRelPath = ""; // clear stale line when switching company
      LE.renderBreadcrumb(viewKey); // re-render now that currentCompany is set
      if (target) target.classList.add("active");
      LE.renderL1();
      return;
    } else if (viewKey.startsWith("L2:")) {
      target = $("edL2Page");
      var parts = viewKey.substring(3).split(":");
      LE.state.currentCompany = decodeURIComponent(parts[0]);
      LE.state.currentLineRelPath = decodeURIComponent(parts[1]);
      LE.state.currentLineName = decodeURIComponent(parts[2] || "");
      // isEditMode is set by caller (loadAndEditLine etc.), don't overwrite from URL
      LE.state.l2ActiveTab = parts[3] || "basic";
      if (target) target.classList.add("active");
      LE.renderL2();
      return;
    } else if (viewKey === "L2-text") {
      target = $("edL2TextPage");
      if (target) target.classList.add("active");
      LE.renderL2Text();
      return;
    }

    if (target) target.classList.add("active");
  };

  LE.renderBreadcrumb = function (viewKey) {
    var html = "";
    if (viewKey !== "L0") {
      html += '<span class="ed-bc-item" data-nav="back"><svg class="ui-icon"><use href="#icon-back"></use></svg>返回</span>';
      html += '<span class="ed-bc-sep">|</span>';
    }
    if (viewKey === "L0") {
      html += '<span class="ed-bc-current">公司列表（仅支持编辑档案库架构）</span>';
    } else if (viewKey.startsWith("L1:")) {
      html += '<span class="ed-bc-current">' + LE.escHtml(LE.state.currentCompany) + ' — 线路列表</span>';
    } else if (viewKey.startsWith("L2:") || viewKey === "L2-text") {
      html += '<span class="ed-bc-current">' + LE.escHtml(LE.state.currentLineName || "编辑线路") + '</span>';
      html += '<span class="ed-bc-sep">|</span>';
      html += '<span class="ed-bc-item" style="font-size:11px">' + LE.escHtml(LE.state.currentCompany) + '</span>';
    }
    breadcrumbEl.innerHTML = html;
    // Bind back navigation
    breadcrumbEl.querySelectorAll('[data-nav="back"]').forEach(function (el) {
      el.addEventListener("click", function () {
        if (viewKey.startsWith("L2:")) {
          LE.showPage("L1:" + LE.state.currentCompany);
        } else if (viewKey.startsWith("L1:")) {
          LE.showPage("L0");
        } else if (viewKey === "L2-text") {
          LE.showPage(LE.state._textReturnView || "L0");
        }
      });
    });
  };

  LE.escHtml = function (s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };

  /* ── Current Line Shortcut ── */
  function renderCurrentLineLink(containerId) {
    var el = $(containerId);
    if (!el) return;
    var ms = LE.mainState;
    if (ms && ms.currentLineFile && ms.mode === "new") {
      var parts = ms.currentLineFile.split("/");
      var company = parts[0] || "";
      var fileName = parts[1] || "";
      // Display the registered name — the registered filename in index.json
      // (basename without extension). index.json `name` is set at creation and
      // can be stale/short (e.g. INI 线路名称=4); the registered filename is
      // the stable identity shown in the topbar select and the editor
      // current-line header.
      var displayName = fileName.replace(/\.ini$/i, "");
      if (!displayName && ms.route && ms.route.name) displayName = ms.route.name;
      el.innerHTML = '编辑当前线路：<a id="edEditCurrentLine">' + LE.escHtml(displayName) + '</a>';
      el.querySelector("#edEditCurrentLine").addEventListener("click", function () {
        LE.state.currentCompany = company;
        LE.state.currentLineRelPath = ms.currentLineFile;
        LE.state.currentLineName = displayName;
        LE.state.isEditMode = true;
        LE.loadAndEditLine(ms.currentLineFile);
      });
      el.style.display = "block";
    } else {
      el.style.display = "none";
    }
  }

  /* ── L0: Company List ── */
  LE.renderL0 = async function () {
    renderCurrentLineLink("edL0CurrentLine");
    var listEl = $("edCompanyList");
    listEl.innerHTML = '<div class="ed-empty">加载中...</div>';

    try {
      var companies = [];
      if (LE.mainState && LE.mainState.newIndex && LE.mainState.newIndex.companies && LE.mainState.newIndex.companies.length) {
        companies = LE.mainState.newIndex.companies;
        // Fetch actual directory mtime for each company
        try {
          var dirResp = await LE.api.listDir("", true);
          var dirMtimeMap = {};
          (dirResp.items || []).forEach(function (item) {
            if (item.isDir && item.mtime) dirMtimeMap[item.name] = item.mtime;
          });
          companies.forEach(function (c) {
            if (dirMtimeMap[c.name]) c.mtime = dirMtimeMap[c.name];
          });
        } catch (e) { /* keep going without mtime */ }
      } else {
        var resp = await LE.api.listDir("", true);
        var dirs = (resp.items || []).filter(function (i) { return i.isDir && !i.name.startsWith("."); });
        for (var i = 0; i < dirs.length; i++) {
          var d = dirs[i];
          var subResp = await LE.api.listDir(d.name, true);
          var iniCount = (subResp.items || []).filter(function (i) { return i.name.endsWith(".ini"); }).length;
          companies.push({
            name: d.name,
            lineCount: iniCount,
            mtime: d.mtime || 0,
          });
        }
      }

      if (!companies.length) {
        listEl.innerHTML = '<div class="ed-empty">暂无公司，请点击"添加公司"</div>';
        // NO return — fall through so button handlers are bound below
      } else {

      var html = "";
      for (var i = 0; i < companies.length; i++) {
        var c = companies[i];
        var lineCount = c.lines ? c.lines.length : (c.lineCount || 0);
        var mtimeStr = c.mtime ? new Date(c.mtime * 1000).toLocaleDateString("zh-CN") : "";
        html += '<div class="ed-card has-drag" data-company="' + LE.escHtml(c.name) + '" data-idx="' + i + '" draggable="true">';
        html += '<span class="ed-drag-handle ed-card-drag-handle">≡</span>';
        html += '<div class="ed-card-row">';
        html += '<div class="ed-card-body" style="flex:1">';
        html += '<div class="ed-card-header"><span class="ed-card-title">' + LE.escHtml(c.name) + '</span></div>';
        html += '<div class="ed-card-subtitle">线路数：' + lineCount + ' | 最后修改：' + (mtimeStr || "—") + '</div>';
        html += '</div>';
        html += '<div class="ed-card-actions-col">';
        html += '<button class="ed-btn ed-btn-ghost ed-rename-company" style="font-size:11px;padding:3px 8px"><svg class="ui-icon"><use href="#icon-rename"></use></svg>重命名</button>';
        html += '<button class="ed-btn ed-btn-ghost ed-btn-danger ed-delete-company" style="font-size:11px;padding:3px 8px"><svg class="ui-icon"><use href="#icon-trash"></use></svg>删除</button>';
        html += '<button class="ed-btn ed-btn-ghost ed-export-company" style="font-size:11px;padding:3px 8px"><svg class="ui-icon"><use href="#icon-download"></use></svg>导出</button>';
        html += '</div></div></div>';
      }
      listEl.innerHTML = html;

      // Click on card navigates to L1 (whole card, not just body area)
      listEl.querySelectorAll(".ed-card").forEach(function (card) {
        // Track mousedown position to distinguish click from drag
        var cardDownX = 0, cardDownY = 0;
        card.addEventListener("mousedown", function (e) {
          cardDownX = e.clientX; cardDownY = e.clientY;
        });
        card.addEventListener("click", function (e) {
          // Ignore if target is a button/link (handled by their own stopPropagation)
          if (e.target.closest("button, a, input, select, textarea")) return;
          LE.showPage("L1:" + card.dataset.company);
        });
      });

      // Per-company rename
      listEl.querySelectorAll(".ed-rename-company").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var card = btn.closest(".ed-card");
          var oldName = card.dataset.company;
          showPromptModal("重命名公司", "请输入新名称", oldName, function (newName) {
            if (!newName || newName === oldName) return;
            LE.renameCompany(oldName, newName);
          });
        });
      });

      // Per-company delete
      listEl.querySelectorAll(".ed-delete-company").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var card = btn.closest(".ed-card");
          var name = card.dataset.company;
          showConfirmModal("删除公司", "确认删除公司 \"" + name + "\"？将递归删除目录及内部所有内容！", function (ok) {
            if (!ok) return;
            LE.deleteCompany(name);
          }, true);
        });
      });

      listEl.querySelectorAll(".ed-export-company").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var card = btn.closest(".ed-card");
          var companyName = card.dataset.company;
          // Collect all line files in this company
          var comp = (LE.mainState && LE.mainState.newIndex && LE.mainState.newIndex.companies || []).find(function (c) { return c.name === companyName; });
          var relPaths = (comp && comp.lines) ? comp.lines.map(function (l) { return l.file; }) : [];
          if (!relPaths.length) { LE.toast("该公司没有线路可导出", "warn"); return; }
          LE.toast("正在导出 " + relPaths.length + " 条线路...", "info");
          fetch("/api/file/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "company", relPaths: relPaths, company: companyName }),
          }).then(function (resp) {
            if (!resp.ok) throw new Error("导出失败");
            return resp.blob();
          }).then(function (blob) {
            var url = URL.createObjectURL(blob);
            var a = document.createElement("a");
            a.href = url;
            a.download = companyName + ".tabl";
            a.click();
            URL.revokeObjectURL(url);
            LE.toast("导出成功", "success");
          }).catch(function (e) {
            LE.toast("导出失败：" + e.message, "error");
          });
        });
      });

      // ── L0 drag-and-drop reordering ──
      // Use persistent company objects from newIndex for drag reordering,
      // then sync the render array back.
      var persistentCompanies = (LE.mainState && LE.mainState.newIndex && LE.mainState.newIndex.companies) ? LE.mainState.newIndex.companies : companies;
      var nameToPersistent = {};
      persistentCompanies.forEach(function (c) { nameToPersistent[c.name] = c; });

      setupCardDrag(listEl, companies, function () {
        if (LE.mainState && LE.mainState.newIndex) {
          // Rebuild persistent array in the new order, preserving lines arrays
          var reordered = [];
          companies.forEach(function (c) {
            var pc = nameToPersistent[c.name];
            if (pc) reordered.push(pc);
            else reordered.push(c);
          });
          LE.mainState.newIndex.companies = reordered;
          LE.api.writeFile("index.json", JSON.stringify(LE.mainState.newIndex, null, 4)).catch(function(){});
          LE.renderL0();
        }
      });

      } // else (companies.length > 0)

    } catch (e) {
      listEl.innerHTML = '<div class="ed-empty">加载失败：' + LE.escHtml(e.message) + '</div>';
    }

    // Search
    var searchEl = $("edL0Search");
    if (searchEl) {
      searchEl.value = "";
      searchEl.oninput = function () {
        var q = searchEl.value.toLowerCase();
        listEl.querySelectorAll(".ed-card").forEach(function (c) {
          c.style.display = c.textContent.toLowerCase().indexOf(q) >= 0 ? "" : "none";
        });
      };
    }

    // Import button on L0
    var l0ImportBtn = $("edL0ImportBtn");
    if (l0ImportBtn) l0ImportBtn.onclick = function () { LE.importZip(null, true); };

    // Import-from-other-announcer dropdown on L0
    var importOtherDropdown = $("edL0ImportOtherDropdown");
    var importOtherMenu = $("edL0ImportOtherMenu");
    if (importOtherDropdown && importOtherMenu) {
      var importOtherBtn = $("edL0ImportOtherBtn");
      if (importOtherBtn) importOtherBtn.onclick = function (e) {
        e.stopPropagation();
        importOtherDropdown.classList.toggle("open");
      };
      importOtherMenu.querySelectorAll("button").forEach(function (btn) {
        btn.onclick = function (e) {
          e.stopPropagation();
          importOtherDropdown.classList.remove("open");
          if (btn.dataset.action === "haixia") LE.showHaixiaCompatInfo();
          else if (btn.dataset.action === "lanshi") LE.showLanShiComingSoon();
        };
      });
      document.addEventListener("click", function () { importOtherDropdown.classList.remove("open"); });
    }

    // Add company — creates dir + registers in index.json
    var addCompanyBtn = $("edAddCompanyBtn");
    if (addCompanyBtn) addCompanyBtn.onclick = function () {
      showPromptModal("新建公司", "请输入新公司名称", "", function (name) {
      if (!name) return;
      var companyName = name;
      LE.api.mkdir(companyName).then(function () {
        // Register in index.json
        if (LE.mainState && LE.mainState.newIndex) {
          var idx = LE.mainState.newIndex;
          if (!idx.companies.find(function (c) { return c.name === companyName; })) {
            idx.companies.push({ name: companyName, lines: [] });
            idx.companies.sort(function (a, b) { return a.name.localeCompare(b.name); });
          }
          // Persist to disk
          LE.api.writeFile("index.json", JSON.stringify(idx, null, 4)).then(function () {
            if (LE.mainCallbacks.refreshIndex) LE.mainCallbacks.refreshIndex();
            LE.renderL0();
            LE.toast("公司已创建：" + companyName, "success");
          }).catch(function () {
            LE.toast("公司目录已创建，但index.json写入失败，请手动刷新索引", "warn");
          });
        }
      }).catch(function (e) { LE.toast("创建失败：" + e.message, "error"); });
      }); // showPromptModal
    }; // onclick
  };

  LE.renameCompany = function (oldName, newName) {
    var oldPath = oldName;
    var newPath = newName;
    LE.api.renameFile(oldPath, newPath).then(function () {
      if (LE.mainState && LE.mainState.newIndex) {
        var idx = LE.mainState.newIndex;
        var c = idx.companies.find(function (c) { return c.name === oldName; });
        if (c) c.name = newName;
        // 保留原有位置：不重新按字母排序，重命名后公司停留在原索引处
        // Update line file paths
        (c ? c.lines : []).forEach(function (l) {
          l.file = l.file.replace(oldPath + "/", newPath + "/");
        });
        LE.api.writeFile("index.json", JSON.stringify(idx, null, 4)).catch(function () {});
        if (LE.mainCallbacks.refreshIndex) LE.mainCallbacks.refreshIndex();
      }
      LE.renderL0();
      LE.toast("已重命名：" + oldName + " ➜ " + newName, "success");
    }).catch(function (e) { LE.toast("重命名失败：" + e.message, "error"); });
  };

  LE.deleteCompany = function (name) {
    LE.api.rmdir(name).then(function () {
      if (LE.mainState && LE.mainState.newIndex) {
        var idx = LE.mainState.newIndex;
        idx.companies = idx.companies.filter(function (c) { return c.name !== name; });
        LE.api.writeFile("index.json", JSON.stringify(idx, null, 4)).catch(function () {});
        if (LE.mainCallbacks.refreshIndex) LE.mainCallbacks.refreshIndex();
      }
      LE.renderL0();
      LE.toast("已删除公司：" + name, "success");
    }).catch(function (e) { LE.toast("删除失败：" + e.message, "error"); });
  };

  /* ── Haixia Compat Info Modal ── */
  LE.showHaixiaCompatInfo = function () {
    var KEY = "TABL_ARCHIVE_V1.6";
    function decryptDat(datFile) {
      return fetch("./res/" + datFile + "?ts=" + Date.now())
        .then(function (r) { if (!r.ok) throw new Error("not found"); return r.arrayBuffer(); })
        .then(function (encBuf) {
          var encBytes = new Uint8Array(encBuf);
          var keyBytes = [];
          for (var i = 0; i < KEY.length; i++) keyBytes.push(KEY.charCodeAt(i));
          var decBytes = new Uint8Array(encBytes.length);
          for (var i = 0; i < encBytes.length; i++) {
            decBytes[i] = encBytes[i] ^ keyBytes[i % keyBytes.length];
          }
          var decrypted = new TextDecoder().decode(decBytes);
          return "data:image/png;base64," + decrypted;
        });
    }

    var overlay = document.createElement("div");
    overlay.className = "ed-modal-overlay";
    // Modal format aligned with the update-check dialog (update-modal family).
    overlay.innerHTML = '<div class="haixia-modal">' +
      '<div class="update-modal-head">' +
        '<div><span class="eyebrow">HAIXIA</span><h2>如何导入海峡报站器线路？</h2></div>' +
        '<button type="button" class="update-modal-close" aria-label="关闭"><svg class="ui-icon"><use href="#icon-close"></use></svg></button>' +
      '</div>' +
      '<div class="update-modal-body ed-haixia-modal-body">' +
        '<p style="margin:0 0 12px">' +
          '请打开「<img id="haixiaLogoImg" class="ed-haixia-inline-img" src="" alt="">' +
          '<span class="ed-haixia-bold-cyan">海峡报站模拟器</span>」程序目录下的"报站音"文件夹，' +
          '复制里面的线路文件夹，粘贴到「<img id="tablLogoImg" class="ed-haixia-inline-img" src="" alt="">' +
          '<span class="ed-haixia-bold-orange">档案库报站模拟器</span>」的海峡兼容文件夹。' +
        '</p>' +
        '<img id="haixiaGuideImg" class="ed-haixia-guide-img" src="" alt="操作图示">' +
        '<p class="ed-haixia-followup">复制完成后，将模式切换到海峡兼容模式即可看到海峡报站器程序。注意：海峡报站器程序暂只支持播放，不支持编辑。后续会支持将海峡报站器程序导入到档案库模式，敬请期待。</p>' +
        '<img class="ed-haixia-guide-img" src="./res/切换海峡模式.png" alt="切换到海峡兼容模式示意">' +
      '</div>' +
      '<div class="update-modal-footer">' +
        '<button type="button" class="update-modal-btn update-modal-btn-ghost" id="hxCancelBtn">关闭</button>' +
        '<button type="button" class="update-modal-btn update-modal-btn-primary" id="hxOpenBtn">' +
          '<img id="hxBtnIcon" class="ed-haixia-btn-icon" src="" alt="">我知道了，打开档案库海峡兼容文件夹' +
        '</button>' +
      '</div></div>';

    $("lineEditorSidebar").appendChild(overlay);

    // Load decrypted images
    decryptDat("haixia_logo.dat").then(function (uri) {
      var img = overlay.querySelector("#haixiaLogoImg");
      if (img) img.src = uri;
    }).catch(function () {});
    decryptDat("tabl_logo_black.dat").then(function (uri) {
      var img = overlay.querySelector("#tablLogoImg");
      if (img) img.src = uri;
      var btnIcon = overlay.querySelector("#hxBtnIcon");
      if (btnIcon) btnIcon.src = uri;
    }).catch(function () {});
    decryptDat("haixia_guide.dat").then(function (uri) {
      var img = overlay.querySelector("#haixiaGuideImg");
      if (img) img.src = uri;
    }).catch(function () {});

    overlay.querySelector(".update-modal-close").onclick = function () { overlay.remove(); };
    overlay.querySelector("#hxCancelBtn").onclick = function () { overlay.remove(); };
    overlay.querySelector("#hxOpenBtn").onclick = function () {
      LE.api.openFolder("兼容模式-海峡报站器文件库").then(function () {
        LE.toast("已打开海峡兼容文件夹", "success");
      }).catch(function (e) {
        LE.toast("无法打开文件夹：" + e.message, "error");
      });
    };
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) overlay.remove(); });
  };

  /* ── Lanshi Import Coming Soon Modal ── */
  LE.showLanShiComingSoon = function () {
    var overlay = document.createElement("div");
    overlay.className = "ed-modal-overlay";
    overlay.innerHTML = '<div class="haixia-modal lanshi-modal" style="width:420px">' +
      '<div class="update-modal-head">' +
        '<div><span class="eyebrow">LANSHI</span><h2>导入蓝斯报站器线路</h2></div>' +
        '<button type="button" class="update-modal-close" aria-label="关闭"><svg class="ui-icon"><use href="#icon-close"></use></svg></button>' +
      '</div>' +
      '<div class="update-modal-body" style="text-align:center;color:#3c4c66;font-size:15px;padding:30px 22px">即将完工，敬请期待</div>' +
      '<div class="update-modal-footer">' +
        '<button type="button" class="update-modal-btn update-modal-btn-primary" id="lanshiOkBtn">知道了</button>' +
      '</div></div>';
    $("lineEditorSidebar").appendChild(overlay);
    var close = function () { overlay.remove(); };
    var x = overlay.querySelector(".update-modal-close");
    if (x) x.onclick = close;
    var ok = overlay.querySelector("#lanshiOkBtn");
    if (ok) ok.onclick = close;
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) close(); });
  };

  /* ── L1: Line List ── */
  LE.renderL1 = async function () {
    renderCurrentLineLink("edL1CurrentLine");
    var listEl = $("edLineList");
    var company = LE.state.currentCompany;
    listEl.innerHTML = '<div class="ed-empty">加载中...</div>';

    // Bind toolbar buttons immediately (before async data load)
    var searchEl = $("edL1Search");
    searchEl.value = "";
    searchEl.oninput = function () {
      var q = searchEl.value.toLowerCase();
      listEl.querySelectorAll(".ed-card").forEach(function (c) {
        c.style.display = c.textContent.toLowerCase().indexOf(q) >= 0 ? "" : "none";
      });
    };
    var dropdown = $("edAddLineDropdown");
    var menu = $("edAddLineMenu");
    $("edAddLineBtn").onclick = function (e) {
      e.stopPropagation();
      dropdown.classList.toggle("open");
    };
    menu.querySelectorAll("button").forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        dropdown.classList.remove("open");
        var action = btn.dataset.action;
        if (action === "blank") LE.createNewLine();
        else if (action === "template") LE.createLineFromTemplate();
        else if (action === "copy") LE.copyExistingLine();
      };
    });
    document.addEventListener("click", function () { dropdown.classList.remove("open"); });
    $("edMediaFolderBtn").onclick = function () {
      LE.showMediaBrowser(company);
    };
    // Import button
    var importBtn = document.getElementById("edImportBtn");
    if (importBtn) importBtn.onclick = function () { LE.importZip(); };

    try {
      var lines = [];
      if (LE.mainState && LE.mainState.newIndex && LE.mainState.newIndex.companies) {
        var comp = LE.mainState.newIndex.companies.find(function (c) { return c.name === company; });
        if (comp) lines = comp.lines || [];
        // Fallback: if index has no lines for this company, try directory listing
        if (!lines.length) {
          console.log("[editor-ui] L1: no lines in index for '" + company + "', trying dir listing...");
          try {
            var resp = await LE.api.listDir(company, true);
            var items = (resp.items || []).filter(function (i) { return i.name.endsWith(".ini"); });
            lines = items.map(function (i) { return { name: i.name.replace(/\.ini$/i, ""), file: company + "/" + i.name }; });
          } catch (e2) {
            console.log("[editor-ui] L1: dir listing also failed:", e2.message);
          }
        }
      } else {
        var resp2 = await LE.api.listDir(company, true);
        var items2 = (resp2.items || []).filter(function (i) { return i.name.endsWith(".ini"); });
        lines = items2.map(function (i) { return { name: i.name.replace(/\.ini$/i, ""), file: company + "/" + i.name }; });
      }

      if (!lines.length) {
        listEl.innerHTML = '<div class="ed-empty">暂无线路，请点击"添加线路"</div>';
        return;
      }

      var html = "";
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        var name = l.file.replace(/\.ini$/i, "").split("/").pop();
        // Quick scan for status
        var status = "ok";
        var statusTitle = "线路完整";
        // For any line with 0 stations parsed, mark as warn
        if (l._incomplete) { status = "warn"; statusTitle = l._error || "线路不完整"; }
        html += '<div class="ed-card has-drag" data-file="' + LE.escHtml(l.file) + '" data-name="' + LE.escHtml(name) + '" data-idx="' + i + '" draggable="true">';
        html += '<span class="ed-drag-handle ed-card-drag-handle">≡</span>';
        html += '<div class="ed-card-header">';
        html += '<span class="ed-card-status ' + status + '" title="' + statusTitle + '"></span>';
        html += '<span class="ed-card-title">' + LE.escHtml(name) + '</span>';
        html += '</div>';
        html += '<div class="ed-card-actions">';
        html += '<a class="ed-card-edit"><svg class="ui-icon"><use href="#icon-edit"></use></svg>编辑</a>';
        html += '<a class="ed-card-rename"><svg class="ui-icon"><use href="#icon-rename"></use></svg>重命名</a>';
        html += '<a class="ed-card-del"><svg class="ui-icon"><use href="#icon-trash"></use></svg>删除</a>';
        html += '<span style="color:#d8e3f1;margin:0 2px">|</span>';
        html += '<a class="ed-card-move"><svg class="ui-icon"><use href="#icon-move"></use></svg>移动到…</a>';
        html += '<a class="ed-card-copy"><svg class="ui-icon"><use href="#icon-copy"></use></svg>复制到…</a>';
        html += '<a class="ed-card-export"><svg class="ui-icon"><use href="#icon-download"></use></svg>导出</a>';
        html += '</div>';
        html += '</div>';
      }
      listEl.innerHTML = html;

      // Click card → edit
      listEl.querySelectorAll(".ed-card").forEach(function (card) {
        card.addEventListener("click", function (e) {
          if (e.target.classList.contains("ed-card-del") || e.target.classList.contains("ed-card-edit") || e.target.classList.contains("ed-card-rename") || e.target.classList.contains("ed-card-copy") || e.target.classList.contains("ed-card-move") || e.target.classList.contains("ed-card-export")) return;
          LE.loadAndEditLine(card.dataset.file, card.dataset.name);
        });
      });

      // Edit button
      listEl.querySelectorAll(".ed-card-edit").forEach(function (a) {
        a.addEventListener("click", function (e) {
          e.stopPropagation();
          var card = a.closest(".ed-card");
          LE.loadAndEditLine(card.dataset.file, card.dataset.name);
        });
      });

      // Delete button
      listEl.querySelectorAll(".ed-card-del").forEach(function (a) {
        a.addEventListener("click", function (e) {
          e.stopPropagation();
          var card = a.closest(".ed-card");
          var f = card.dataset.file;
          var n = card.dataset.name;
          showConfirmModal("删除线路", "确认删除线路：" + n + "？", function (ok) {
            if (!ok) return;
            LE.api.deleteFile(f).then(async function () {
              await LE.api.updateIndex(company, n, f, "remove");
              if (LE.mainCallbacks.refreshIndex) await LE.mainCallbacks.refreshIndex();
              LE.renderL1();
              LE.toast("已删除：" + n, "success");
            }).catch(function (err) { LE.toast("删除失败：" + err.message, "error"); });
          }, true);
        });
      });

      // Rename button
      listEl.querySelectorAll(".ed-card-rename").forEach(function (a) {
        a.addEventListener("click", function (e) {
          e.stopPropagation();
          var card = a.closest(".ed-card");
          LE.showRenameLineDialog(card.dataset.file, card.dataset.name, company);
        });
      });

      // Copy button
      listEl.querySelectorAll(".ed-card-copy").forEach(function (a) {
        a.addEventListener("click", function (e) {
          e.stopPropagation();
          var card = a.closest(".ed-card");
          LE.showCopyLineDialog(card.dataset.file, card.dataset.name, company);
        });
      });

      // Export button
      listEl.querySelectorAll(".ed-card-export").forEach(function (a) {
        a.addEventListener("click", function (e) {
          e.stopPropagation();
          var card = a.closest(".ed-card");
          LE.exportLine(card.dataset.file, card.dataset.name);
        });
      });

      // Move button
      listEl.querySelectorAll(".ed-card-move").forEach(function (a) {
        a.addEventListener("click", function (e) {
          e.stopPropagation();
          var card = a.closest(".ed-card");
          LE.showMoveLineDialog(card.dataset.file, card.dataset.name, company);
        });
      });

      // ── L1 drag-and-drop reordering ──
      setupCardDrag(listEl, lines, function () {
        if (LE.mainState && LE.mainState.newIndex) {
          var idx2 = LE.mainState.newIndex;
          var comp = idx2.companies.find(function (c) { return c.name === company; });
          if (comp) {
            comp.lines = lines.map(function (l) {
              return { name: l.name || l.file.replace(/\.ini$/i, "").split("/").pop(), file: l.file };
            });
            LE.api.writeFile("index.json", JSON.stringify(idx2, null, 4)).catch(function(){});
            LE.renderL1();
          }
        }
      });

    } catch (e) {
      listEl.innerHTML = '<div class="ed-empty">加载失败：' + LE.escHtml(e.message) + '</div>';
    }

  };

  /* ── Load and edit a line ── */
  LE.loadAndEditLine = async function (relPath, lineName) {
    try {
      var resp = await LE.api.readFile(relPath);
      LE.state.originalLineText = resp.content;
      LE.state.editModel = LE.parseIni(resp.content);
      LE.state.originalEditModel = JSON.parse(JSON.stringify(LE.state.editModel));
      LE.state.currentLineRelPath = relPath;
      // Breadcrumb shows filename (without .ini), not internal line name or display name
      var fileName = relPath.split("/").pop().replace(/\.ini$/i, "");
      LE.state.currentLineName = fileName || LE.state.editModel.lineName || lineName || relPath;
      LE.state.isEditMode = true;
      LE.state.isDirty = false;
      LE.state.validationErrors = null;
      LE.showPage("L2:" + encodeURIComponent(LE.state.currentCompany) + ":" +
        encodeURIComponent(relPath) + ":" + encodeURIComponent(LE.state.currentLineName) + ":basic");
    } catch (e) {
      LE.toast("加载线路失败：" + e.message, "error");
    }
  };

  /* ── Create new line ── */
  LE.createNewLine = function () {
    showPromptModal("新建线路", "请输入新线路名称", "", function (name) {
      if (!name) return;
      var fileName = name;
      if (!/\.ini$/i.test(fileName)) fileName += ".ini";
      var relPath = LE.state.currentCompany + "/" + fileName;
      var model = LE.createEmptyModel(name);
      var content = LE.serializeIni(model);
      LE.api.writeFile(relPath, content).then(async function () {
        await LE.api.updateIndex(LE.state.currentCompany, name, relPath, "add");
        if (LE.mainCallbacks.refreshIndex) await LE.mainCallbacks.refreshIndex();
        LE.renderL1();
        LE.toast("已创建：" + name, "success");
      }).catch(function (e) { LE.toast("创建失败：" + e.message, "error"); });
    });
  };

  /* ── Shared line selector modal ── */
  function showLineSelector(title, onSelect) {
    var overlay = document.createElement("div");
    overlay.className = "ed-modal-overlay";
    var currentCompany = LE.state.currentCompany;
    var companies = [];
    if (LE.mainState && LE.mainState.newIndex && LE.mainState.newIndex.companies) {
      companies = LE.mainState.newIndex.companies;
    }

    if (!companies.length && currentCompany) {
      companies = [{ name: currentCompany, lines: [] }];
    }
    var companyOpts = companies.map(function (c) {
      var sel = c.name === currentCompany ? " selected" : "";
      return '<option value="' + LE.escHtml(c.name) + '"' + sel + '>' + LE.escHtml(c.name) + '</option>';
    }).join("");

    overlay.innerHTML = '<div class="ed-modal" style="width:500px;max-height:80vh">' +
      '<div class="ed-modal-header"><h3>' + LE.escHtml(title) + '</h3>' + modalCloseButton() + '</div>' +
      '<div class="ed-modal-body">' +
      '<div style="margin-bottom:8px"><strong>公司：</strong>' +
      '<select id="lsCompanySelect" style="width:100%;padding:8px;background:#ffffff;border:1px solid #d8e3f1;border-radius:6px;color:#20355c;font-size:13px;color-scheme:light">' + companyOpts + '</select></div>' +
      '<div style="margin-bottom:8px"><strong>选择线路：</strong></div>' +
      '<div id="lsLineGrid" style="max-height:300px;overflow-y:auto"><div class="ed-empty">加载中...</div></div>' +
      '</div>' +
      '<div class="ed-modal-footer">' +
      '<button class="ed-btn ed-btn-ghost" id="lsCancelBtn">取消</button>' +
      '<button class="ed-btn ed-btn-primary" id="lsConfirmBtn" disabled>请选择线路</button></div></div>';

    $("lineEditorSidebar").appendChild(overlay);

    var selectedFile = null;
    var selectedName = null;

    function loadLines(companyName) {
      var grid = overlay.querySelector("#lsLineGrid");
      grid.innerHTML = '<div class="ed-empty">加载中...</div>';
      var comp = companies.find(function (c) { return c.name === companyName; });
      var lines = [];
      // Try index first, then directory listing
      if (comp && comp.lines && comp.lines.length) {
        lines = comp.lines;
        renderLineGrid(lines);
      } else {
        LE.api.listDir(companyName, true).then(function (resp) {
          var items = (resp.items || []).filter(function (i) { return i.name.endsWith(".ini"); });
          lines = items.map(function (i) {
            return { name: i.name.replace(/\.ini$/i, ""), file: companyName + "/" + i.name };
          });
          renderLineGrid(lines);
        }).catch(function (err) {
          grid.innerHTML = '<div class="ed-empty">加载失败：' + LE.escHtml(err.message) + '</div>';
        });
      }
    }

    function renderLineGrid(lines) {
      var grid = overlay.querySelector("#lsLineGrid");
      if (!lines.length) {
        grid.innerHTML = '<div class="ed-empty">该公司暂无线路</div>';
        return;
      }
      var html = "";
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        var name = l.name || l.file.replace(/\.ini$/i, "").split("/").pop();
        html += '<div class="ed-card ed-ls-card" data-file="' + LE.escHtml(l.file) + '" data-name="' + LE.escHtml(name) + '">' +
          '<span class="ed-card-title">' + LE.escHtml(name) + '</span></div>';
      }
      grid.innerHTML = html;

      grid.querySelectorAll(".ed-ls-card").forEach(function (card) {
        card.addEventListener("click", function () {
          grid.querySelectorAll(".ed-ls-card").forEach(function (c) { c.classList.remove("selected"); });
          card.classList.add("selected");
          selectedFile = card.dataset.file;
          selectedName = card.dataset.name;
          overlay.querySelector("#lsConfirmBtn").disabled = false;
          overlay.querySelector("#lsConfirmBtn").textContent = "确认 — " + selectedName;
        });
      });
    }

    loadLines(currentCompany);

    overlay.querySelector("#lsCompanySelect").addEventListener("change", function () {
      selectedFile = null; selectedName = null;
      overlay.querySelector("#lsConfirmBtn").disabled = true;
      overlay.querySelector("#lsConfirmBtn").textContent = "请选择线路";
      loadLines(overlay.querySelector("#lsCompanySelect").value);
    });

    overlay.querySelector(".ed-modal-close").onclick = function () { overlay.remove(); };
    overlay.querySelector("#lsCancelBtn").onclick = function () { overlay.remove(); };
    overlay.querySelector("#lsConfirmBtn").addEventListener("click", function () {
      if (!selectedFile) return;
      overlay.remove();
      onSelect(selectedFile, selectedName);
    });
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) overlay.remove(); });
  }

  /* ── Create new line from template ── */
  // Check if a token is a file (not a param)
  function isFileToken(tok) {
    if (!tok) return false;
    if (LE.isParamToken(tok) || LE.isTemplateMarker(tok)) return false;
    // Also catch {param} patterns that aren't in PARAM_DEFS
    if (/^\{[^}]+\}$/.test(tok)) return false;
    return true;
  }

  // Collect all file tokens from templates + tips (for cross-company copy)
  function collectTemplateTipFiles(model) {
    var files = [];
    function add(tok) { if (isFileToken(tok) && files.indexOf(tok) < 0) files.push(tok); }
    var tKeys = Object.keys(model.templates);
    tKeys.forEach(function (k) { (model.templates[k] || []).forEach(add); });
    (model.tipItems || []).forEach(function (tip) { (tip.ruleTokens || []).forEach(add); });
    return files;
  }

  // Collect all file tokens from entire line (for cross-company full copy)
  function collectAllFiles(model) {
    var files = collectTemplateTipFiles(model);
    function add(tok) { if (isFileToken(tok) && files.indexOf(tok) < 0) files.push(tok); }
    ["up", "down"].forEach(function (dir) {
      var ov = model.stationOverrides[dir] || {};
      for (var k in ov) {
        (ov[k].depart || []).forEach(add);
        (ov[k].arrive || []).forEach(add);
        (ov[k].zhAudio || []).forEach(add);
        (ov[k].enAudio || []).forEach(add);
      }
    });
    for (var k in model.stationAudioMap) add(model.stationAudioMap[k]);
    for (var k2 in model.stationAudioMapEn) add(model.stationAudioMapEn[k2]);
    return files;
  }

  async function copyAudioFilesIfNeeded(files, srcCompany, dstCompany) {
    if (!files.length) return;
    var done = 0;
    for (var i = 0; i < files.length; i++) {
      try {
        await LE.api.copyFile(srcCompany + "/" + files[i], dstCompany + "/" + files[i]);
        done++;
      } catch (e) { /* skip missing files */ }
    }
    if (done) LE.toast("已复制 " + done + " 个音频文件", "success");
  }

  LE.createLineFromTemplate = function () {
    showLineSelector("以现有线路为模版创建", function (sourceFile, sourceName) {
      LE.api.readFile(sourceFile).then(function (resp) {
        var srcModel = LE.parseIni(resp.content);
        var srcCompany = sourceFile.split("/")[0];
        var dstCompany = LE.state.currentCompany;
        var isCross = srcCompany !== dstCompany;
        var cbLabel = isCross ? "复制全局模板、服务语所用的音频文件到本公司（覆盖现有同名文件）" : "";
        showPromptModal("新建线路（模版）", "请输入新线路名称", sourceName + "（模版）", async function (newName, copyAudio) {
          if (!newName) return;
          var model = LE.createEmptyModel(newName);
          model.templates = JSON.parse(JSON.stringify(srcModel.templates));
          model.isUpDownSame = srcModel.isUpDownSame;
          model.tipItems = JSON.parse(JSON.stringify(srcModel.tipItems));
          var fileName = newName;
          if (!/\.ini$/i.test(fileName)) fileName += ".ini";
          var relPath = dstCompany + "/" + fileName;
          var content = LE.serializeIni(model);
          try {
            await LE.api.writeFile(relPath, content);
            if (isCross && copyAudio) await copyAudioFilesIfNeeded(collectTemplateTipFiles(srcModel), srcCompany, dstCompany);
            await LE.api.updateIndex(dstCompany, newName, relPath, "add");
            if (LE.mainCallbacks.refreshIndex) await LE.mainCallbacks.refreshIndex();
            LE.renderL1();
            LE.toast("已从模版创建：" + newName, "success");
          } catch (e) { LE.toast("创建失败：" + e.message, "error"); }
        }, cbLabel);
      }).catch(function (e) { LE.toast("读取模版失败：" + e.message, "error"); });
    });
  };

  /* ── Copy existing line ── */
  LE.copyExistingLine = function () {
    showLineSelector("复制现有线路", function (sourceFile, sourceName) {
      LE.api.readFile(sourceFile).then(function (resp) {
        var srcModel = LE.parseIni(resp.content);
        var srcCompany = sourceFile.split("/")[0];
        var dstCompany = LE.state.currentCompany;
        var isCross = srcCompany !== dstCompany;
        var newName = srcModel.lineName ? srcModel.lineName + "（拷贝）" : sourceName + "（拷贝）";
        var cbLabel = isCross ? "复制该线路所用到的音频文件到本公司（覆盖现有同名文件）" : "";
        showPromptModal("复制现有线路", "请输入新线路名称", newName, async function (newName2, copyAudio) {
          if (!newName2) return;
          var model = JSON.parse(JSON.stringify(srcModel));
          model.lineName = newName2;
          model.createdAt = "";
          model.updatedAt = "";
          model.changelog = "";
          var fileName = newName2;
          if (!/\.ini$/i.test(fileName)) fileName += ".ini";
          var relPath = dstCompany + "/" + fileName;
          var content = LE.serializeIni(model);
          try {
            await LE.api.writeFile(relPath, content);
            if (isCross && copyAudio) await copyAudioFilesIfNeeded(collectAllFiles(srcModel), srcCompany, dstCompany);
            await LE.api.updateIndex(dstCompany, newName2, relPath, "add");
            if (LE.mainCallbacks.refreshIndex) await LE.mainCallbacks.refreshIndex();
            LE.renderL1();
            LE.toast("已复制线路：" + newName2, "success");
          } catch (e) { LE.toast("复制失败：" + e.message, "error"); }
        }, cbLabel);
      }).catch(function (e) { LE.toast("读取线路失败：" + e.message, "error"); });
    });
  };

  /* ── L2 Framework ── */
  LE.renderL2 = function () {
    console.log("[editor-ui] renderL2, isEdit=" + LE.state.isEditMode + ", tab=" + LE.state.l2ActiveTab);
    var navEl = $("edL2Nav");
    var contentEl = $("edL2Content");
    var tabs = [
      { key: "basic", label: "基础信息" },
      { key: "media", label: "管理音频文件" },
      { key: "stations", label: "车站信息" },
      { key: "templates", label: "全局报站规则" },
      { key: "strules", label: "各站特殊规则" },
      { key: "tips", label: "手按提示语" },
    ];

    var active = LE.state.l2ActiveTab || "basic";
    var isEdit = true;

    // Count errors per tab (line errors only, not audio warnings)
    var verr = LE.state.validationErrors;
    var errs = (verr && verr.lineErrors) || [];
    var errByTab = {};
    errs.forEach(function (e) {
      var tab = "basic";
      var f = e.field || "";
      if (f.indexOf("Station") >= 0 || f.indexOf("station") >= 0 || f.indexOf("up") >= 0 || f.indexOf("down") >= 0) tab = "stations";
      else if (f.indexOf("Depart") >= 0 || f.indexOf("Arrive") >= 0 || f.indexOf("Terminal") >= 0 || f.indexOf("First") >= 0 || f.indexOf("template") >= 0) tab = "templates";
      else if (f.indexOf("tip") >= 0 || f === "tips") tab = "tips";
      errByTab[tab] = (errByTab[tab] || 0) + 1;
    });

    navEl.innerHTML = tabs.map(function (t) {
      var cls = "ed-l2-tab" + (t.key === active ? " active" : "");
      var badge = errByTab[t.key] ? '<span class="ed-tab-badge">' + errByTab[t.key] + '</span>' : "";
      return '<span class="' + cls + '" data-tab="' + t.key + '"><i class="ed-l2-tab-order">' + (tabs.indexOf(t) + 1) + '</i>' + t.label + badge + '</span>';
    }).join("");

    navEl.querySelectorAll(".ed-l2-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        var targetTab = tab.dataset.tab;
        LE.state.l2ActiveTab = targetTab;
        // Clear line errors for the tab being entered (media tab has no fields, skip)
        if (targetTab !== "media" && LE.state.validationErrors && LE.state.validationErrors.lineErrors) {
          LE.state.validationErrors.lineErrors = LE.state.validationErrors.lineErrors.filter(function (e) {
            var f = e.field || "";
            var ftab = "basic";
            if (f.indexOf("Station") >= 0 || f.indexOf("station") >= 0 || f.indexOf("up") >= 0 || f.indexOf("down") >= 0) ftab = "stations";
            else if (f.indexOf("Depart") >= 0 || f.indexOf("Arrive") >= 0 || f.indexOf("Terminal") >= 0 || f.indexOf("First") >= 0 || f.indexOf("template") >= 0) ftab = "templates";
            else if (f.indexOf("tip") >= 0 || f === "tips") ftab = "tips";
            return ftab !== targetTab;
          });
        }
        LE.renderL2();
      });
    });

    // Render active sub-page (all in edit mode)
    if (active === "basic") LE.renderL2Basic(contentEl);
    else if (active === "media") LE.renderL2Media(contentEl);
    else if (active === "stations") LE.renderL2Stations(contentEl);
    else if (active === "templates") LE.renderL2Templates(contentEl);
    else if (active === "strules") LE.renderL2StationRules(contentEl);
    else if (active === "tips") LE.renderL2Tips(contentEl);

    // Footer buttons
    $("edRestoreLink").onclick = function () {
      showConfirmModal("恢复内容", "是否放弃当前编辑内容？", function (ok) {
        if (!ok) return;
        LE.state.editModel = JSON.parse(JSON.stringify(LE.state.originalEditModel));
        LE.state.isDirty = false;
        LE.renderL2();
        LE.toast("已恢复", "info");
      });
    };
    $("edCancelBtn").onclick = function () {
      if (!LE.state.isDirty) {
        LE.state.editModel = JSON.parse(JSON.stringify(LE.state.originalEditModel));
        LE.state.isDirty = false;
        LE.state.isEditMode = false;
        LE.showPage("L1:" + LE.state.currentCompany);
        return;
      }
      showConfirmModal("取消编辑", "是否放弃当前编辑并返回上一级？", function (ok) {
        if (!ok) return;
        LE.state.editModel = JSON.parse(JSON.stringify(LE.state.originalEditModel));
        LE.state.isDirty = false;
        LE.state.isEditMode = false;
        LE.showPage("L1:" + LE.state.currentCompany);
      });
    };
    $("edValidateBtn").onclick = async function () {
      var companyRelPath = (LE.state.currentLineRelPath || "").split("/")[0];
      var result = await LE.validateAll(LE.state.editModel, companyRelPath);
      LE.state.validationErrors = result;
      LE.renderL2();
      showValidationModal(result, "validate");
    };
    $("edSaveBtn").onclick = function () {
      LE.saveCurrentLine();
    };

    // Text editor link
    var l2Footer = contentEl.parentNode.querySelector(".ed-l2-footer");
    if (l2Footer && !l2Footer.querySelector(".ed-text-link")) {
      var link = document.createElement("a");
      link.href = "#";
      link.className = "ed-link ed-text-link";
      link.textContent = "直接编辑线路文件（高级）➜";
      link.style.cssText = "font-size:11px;margin-right:auto;";
      link.addEventListener("click", function (e) {
        e.preventDefault();
        LE.openTextEditor();
      });
      l2Footer.insertBefore(link, l2Footer.firstChild);
    }
  };

  /* ── INI Syntax Highlighting ── */
  function highlightIni(text) {
    var lines = text.split("\n");
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var escaped = LE.escHtml(line);
      // Section headers
      if (/^####/.test(line)) {
        escaped = '<span class="ini-h ini-h4">' + escaped + '</span>';
      } else if (/^###/.test(line)) {
        escaped = '<span class="ini-h ini-h3">' + escaped + '</span>';
      } else if (/^##/.test(line)) {
        escaped = '<span class="ini-h ini-h2">' + escaped + '</span>';
      } else if (/^#/.test(line)) {
        escaped = '<span class="ini-h ini-h1">' + escaped + '</span>';
      } else if (/=/.test(line)) {
        // Key=value lines
        var eqIdx = line.indexOf("=");
        var key = LE.escHtml(line.substring(0, eqIdx));
        var val = line.substring(eqIdx + 1);
        // Highlight params and quoted files in value.
        // Use a SINGLE pass so the file span never swallows a param span's
        // markup (`"文件">{参数}` adjacent would otherwise corrupt the HTML,
        // and re-reading innerText leaks the class name as literal `ini-param`).
        var valEsc = LE.escHtml(val).replace(/"[^"]*"|\{[^}]*\}/g, function (m) {
          if (m.charAt(0) === '"') return '<span class="ini-file">' + m + '</span>';
          return '<span class="ini-param">' + m + '</span>';
        });
        escaped = '<span class="ini-key">' + key + '</span>=<span class="ini-val">' + valEsc + '</span>';
      } else if (/^stop_\d+:/.test(line)) {
        escaped = '<span class="ini-stop">' + escaped + '</span>';
      }
      out.push(escaped);
    }
    return out.join("\n");
  }

  LE.openTextEditor = function () {
    var text = LE.serializeIni(LE.state.editModel);
    $("edTextEditor").innerHTML = highlightIni(text);
    // Save return view BEFORE showPage overwrites it
    LE.state._textReturnView = "L2:" + encodeURIComponent(LE.state.currentCompany) + ":" +
      encodeURIComponent(LE.state.currentLineRelPath) + ":" +
      encodeURIComponent(LE.state.currentLineName || "") + ":" + (LE.state.l2ActiveTab || "basic");
    LE.showPage("L2-text");
    // Wire up save/restore
    $("edTextSaveBtn").onclick = function () {
      var raw = $("edTextEditor").innerText;
      try {
        LE.state.editModel = LE.parseIni(raw);
        LE.state.originalEditModel = JSON.parse(JSON.stringify(LE.state.editModel));
        LE.saveCurrentLine();
      } catch (e) {
        LE.toast("解析错误：" + e.message, "error");
      }
    };
    $("edTextRestoreLink").onclick = function () {
      showConfirmModal("恢复状态", "是否恢复当前状态？", function (ok) {
        if (!ok) return;
        $("edTextEditor").innerHTML = highlightIni(LE.serializeIni(LE.state.editModel));
      });
    };
  };

  /* ── Validation Result Modal ── */
  function showValidationModal(result, mode) {
    // mode: "validate" | "save" | "saved_with_warnings"
    var hasLineErrors = result.lineErrors && result.lineErrors.length > 0;
    var hasAudioWarnings = result.audioWarnings && result.audioWarnings.length > 0;
    var noIssues = !hasLineErrors && !hasAudioWarnings;
    var lineErrCount = (result.lineErrors || []).length;
    var audioWarnCount = (result.audioWarnings || []).length;

    // Save mode with no issues → quick success popup
    if (noIssues && mode === "save") {
      var popup = document.createElement("div");
      popup.className = "ed-modal-overlay";
      popup.innerHTML = '<div class="ed-modal" style="width:320px;text-align:center">' +
        '<div class="ed-modal-body" style="padding:32px 16px">' +
        '<div style="font-size:40px;color:#22c55e;margin-bottom:12px">✓</div>' +
        '<div style="font-size:16px;font-weight:600;color:#17345f">保存成功</div>' +
        '<div style="font-size:12px;color:#69778d;margin-top:4px">音频文件未发现缺失</div>' +
        '</div></div>';
      $("lineEditorSidebar").appendChild(popup);
      setTimeout(function () { popup.remove(); }, 2000);
      return;
    }

    // Determine title
    var titleIcon, titleText;
    if (hasLineErrors) {
      titleIcon = '<span style="font-size:18px;color:#ef4444">✗</span>';
      titleText = (mode === "save") ? "线路文件存在错误，请修复后再保存" : "线路文件存在错误，请修复";
    } else if (mode === "saved_with_warnings") {
      titleIcon = '<span style="font-size:18px;color:#22c55e">✓</span>';
      titleText = "线路文件保存成功，但音频文件存在缺失";
    } else if (noIssues && mode === "validate") {
      titleIcon = '<span style="font-size:18px;color:#22c55e">✓</span>';
      titleText = "校验通过，未发现问题";
    } else {
      titleIcon = '<span style="font-size:18px;color:#eab308">⚠</span>';
      titleText = "音频文件缺失，请注意";
    }

    var overlay = document.createElement("div");
    overlay.className = "ed-modal-overlay";
    var bodyHTML = "";

    // After early return, both groups always visible
    function buildGroup(icon, iconColor, title, count, rows, emptyMsg) {
      var h = '<div class="ed-val-group">' +
        '<div class="ed-val-group-header">' +
        '<span class="ed-val-group-icon" style="color:' + iconColor + '">' + icon + '</span>' +
        '<span>' + title + '（' + count + '）</span>' +
        '<span class="ed-val-group-toggle">▼</span></div>' +
        '<div class="ed-val-group-body">';
      if (count > 0) {
        h += rows;
      } else {
        h += '<div class="ed-val-empty">' + emptyMsg + '</div>';
      }
      h += '</div></div>';
      return h;
    }

    // Line errors table
    var errRows = "";
    if (hasLineErrors) {
      errRows = '<table class="ed-val-table"><thead><tr>' +
        '<th style="width:24px"></th><th style="width:80px">模块</th><th>错误内容</th></tr></thead><tbody>';
      result.lineErrors.forEach(function (e) {
        errRows += '<tr><td><span style="color:#ef4444">✗</span></td>' +
          '<td>' + LE.escHtml(e.module || "") + '</td>' +
          '<td>' + LE.escHtml(e.message) + '</td></tr>';
      });
      errRows += '</tbody></table>';
    }
    bodyHTML += buildGroup("✗", "#ef4444", "线路文件错误", lineErrCount, errRows, "未发现错误");

    // Audio warnings table
    var warnRows = "";
    if (hasAudioWarnings) {
      warnRows = '<table class="ed-val-table"><thead><tr>' +
        '<th style="width:24px"></th><th style="width:140px">文件名</th><th>引用位置</th></tr></thead><tbody>';
      result.audioWarnings.forEach(function (w) {
        var locs = (w.locations || []).join("、");
        warnRows += '<tr><td><span style="color:#eab308">⚠</span></td>' +
          '<td>' + LE.escHtml(w.file) + '</td>' +
          '<td>引用于：' + LE.escHtml(locs) + '</td></tr>';
      });
      warnRows += '</tbody></table>';
    }
    bodyHTML += buildGroup("⚠", "#eab308", "音频文件缺失", audioWarnCount, warnRows, "未发现缺失文件");

    overlay.innerHTML = '<div class="ed-modal" style="width:580px;max-height:75vh">' +
      '<div class="ed-modal-header"><h3>' + titleIcon + ' ' + LE.escHtml(titleText) + '</h3>' + modalCloseButton() + '</div>' +
      '<div class="ed-modal-body" style="max-height:55vh;overflow-y:auto">' + bodyHTML + '</div>' +
      '<div class="ed-modal-footer"><button class="ed-btn ed-btn-primary" id="edValCloseBtn">确认</button></div></div>';

    $("lineEditorSidebar").appendChild(overlay);

    overlay.querySelector(".ed-modal-close").onclick = function () { overlay.remove(); };
    overlay.querySelector("#edValCloseBtn").onclick = function () { overlay.remove(); };
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) overlay.remove(); });

    // Toggle collapse
    overlay.querySelectorAll(".ed-val-group-header").forEach(function (header) {
      header.addEventListener("click", function () {
        var body = header.nextElementSibling;
        var toggle = header.querySelector(".ed-val-group-toggle");
        if (body && toggle) {
          var open = body.style.display !== "none";
          body.style.display = open ? "none" : "";
          toggle.textContent = open ? "▶" : "▼";
        }
      });
    });
  }

  /* ── Save current line ── */
  LE.saveCurrentLine = async function () {
    var model = LE.state.editModel;
    var now = LE.nowStr();
    if (!model.createdAt) model.createdAt = now;
    model.updatedAt = now;

    // Flush DOM inputs into model before validating
    for (var t = 0; t < 10; t++) {
      var tipInput = document.getElementById("edTipName_" + t);
      if (tipInput && model.tipItems && model.tipItems[t]) {
        model.tipItems[t].name = tipInput.value;
      }
    }
    var lineNameInput = document.getElementById("edFldLineName");
    if (lineNameInput) model.lineName = lineNameInput.value;
    // Flush station inputs too (safety net)
    document.querySelectorAll(".ed-station-row input[data-field]").forEach(function (inp) {
      var field = inp.dataset.field;
      var idx = parseInt(inp.dataset.idx);
      if (field === "upStationsCn") model.upStationsCn[idx] = inp.value;
      else if (field === "upStationsEn") model.upStationsEn[idx] = inp.value;
      else if (field === "downStationsCn") model.downStationsCn[idx] = inp.value;
      else if (field === "downStationsEn") model.downStationsEn[idx] = inp.value;
    });

    var companyRelPath = (LE.state.currentLineRelPath || "").split("/")[0];
    var result = await LE.validateAll(model, companyRelPath);
    LE.state.validationErrors = result;

    // Line errors block save
    if (result.lineErrors && result.lineErrors.length > 0) {
      LE.renderL2();
      showValidationModal(result, "save");
      return;
    }

    try {
      var text = LE.serializeIni(model);
      var savePath = LE.state.currentLineRelPath;
      console.log("[saveCurrentLine] saving to: " + savePath + " (" + text.length + " chars)");
      await LE.api.writeFile(savePath, text);

      LE.renderL2();

      LE.state.originalLineText = text;
      LE.state.originalEditModel = JSON.parse(JSON.stringify(model));
      LE.state.isDirty = false;
      LE.state.isEditMode = false;

      // Refresh index (especially important after rename)
      if (LE.mainCallbacks && LE.mainCallbacks.refreshIndex) {
        await LE.mainCallbacks.refreshIndex();
      }
      if (LE.mainCallbacks && LE.mainCallbacks.onLineSaved) {
        LE.mainCallbacks.onLineSaved(LE.state.currentLineRelPath);
      }

      if (result.audioWarnings && result.audioWarnings.length > 0) {
        showValidationModal(result, "saved_with_warnings");
      } else {
        showValidationModal(result, "save");
      }
    } catch (e) {
      LE.toast("保存失败：" + (e.message || "未知错误"), "error");
    }
  };

  /* ── L2: Basic Info Sub-Page ── */
  LE.renderL2Basic = function (container) {
    var m = LE.state.editModel;
    if (!m) { container.innerHTML = '<div class="ed-empty">未加载线路</div>'; return; }

    var fileName = (LE.state.currentLineRelPath || "").split("/").pop().replace(/\.ini$/i, "");
    var helpIcon = function (tipText, imgPath) {
      return ' <span class="ed-help-icon" data-tip="' + tipText + '"' + (imgPath ? ' data-img="' + imgPath + '"' : '') + '>?</span>';
    };

    var html = "";
    // File name (read-only, rename via L1)
    html += '<div class="ed-form-group"><label class="ed-form-label">线路文件名' + helpIcon('在线路列表、编辑器中显示的线路文件名。不能在此页面修改，要修改必须返回上一级「线路列表」修改线路文件名。', 'res/线路文件名.png') + '</label>';
    html += '<input class="ed-form-input readonly" value="' + LE.escHtml(fileName) + '" readonly></div>';

    // Display name (second position) — 线路简称
    html += '<div class="ed-form-group"><label class="ed-form-label">线路简称<span class="ed-required">*</span>' + helpIcon('在线路图上方显示的线路简写。比如，线路文件名有时可能带有备注（如19路（2007版）），在简写的时候就可以去掉这些（比如简写为19），这样线路图上显示的方向就更简单（如19➜第一码头）。', 'res/线路图显示名.png') + '</label>';
    html += '<input class="ed-form-input" id="edFldLineName" value="' + LE.escHtml(m.lineName) + '" placeholder="请输入线路名称（如：厦门1路）"></div>';

    html += '<div class="ed-form-group"><label class="ed-form-label">版本</label>';
    html += '<input class="ed-form-input" id="edFldVersion" value="' + LE.escHtml(m.version) + '" placeholder="如：1.0"></div>';

    html += '<div class="ed-form-group"><label class="ed-form-label">作者</label>';
    html += '<input class="ed-form-input" id="edFldAuthor" value="' + LE.escHtml(m.author) + '" placeholder="如：张三"></div>';

    html += '<div class="ed-form-group"><label class="ed-form-label">创建时间</label>';
    html += '<input class="ed-form-input readonly" value="' + LE.escHtml(m.createdAt) + '" readonly></div>';

    html += '<div class="ed-form-group"><label class="ed-form-label">更新时间</label>';
    html += '<input class="ed-form-input readonly" value="' + LE.escHtml(m.updatedAt) + '" readonly></div>';

    html += '<div class="ed-form-group"><label class="ed-form-label">更新日志</label>';
    html += '<textarea class="ed-form-textarea" id="edFldChangelog" placeholder="记录历代更新内容...">' + LE.escHtml(m.changelog) + '</textarea></div>';

    container.innerHTML = html;

    $("edFldLineName").addEventListener("input", function () { m.lineName = this.value; LE.state.isDirty = true; LE.state.validationErrors = null; });
    $("edFldVersion").addEventListener("input", function () { m.version = this.value; LE.state.isDirty = true; });
    $("edFldAuthor").addEventListener("input", function () { m.author = this.value; LE.state.isDirty = true; });
    $("edFldChangelog").addEventListener("input", function () { m.changelog = this.value; LE.state.isDirty = true; });
  };

  /* ── L2: Station Info Sub-Page ── */
  LE.renderL2Stations = function (container) {
    var m = LE.state.editModel;
    if (!m) { container.innerHTML = '<div class="ed-empty">未加载线路</div>'; return; }

    var html = "";

    // Mode selector — toggle switch
    var isLoop = m.mode === "loop";
    html += '<div class="ed-switch-group" style="margin-bottom:14px">';
    html += '<div class="ed-switch" id="edModeSwitch">';
    html += '<span class="ed-switch-option' + (!isLoop ? " active" : "") + '" data-mode="bidirectional">双向运行</span>';
    html += '<span class="ed-switch-option' + (isLoop ? " active" : "") + '" data-mode="loop">单向环线运行</span>';
    html += '</div>';
    html += '</div>';

    // Auto-recognition (default expanded)
    html += '<div class="ed-collapse-header open" id="edAutoRecHeader"><span class="ed-arrow">▶</span> 自动识别站点</div>';
    html += '<div class="ed-collapse-body open" id="edAutoRecBody">';
    html += '<textarea class="ed-form-textarea" id="edAutoRecText" placeholder="在此粘贴站点文本..." style="min-height:60px"></textarea>';
    html += '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">';
    html += '<button class="ed-btn" data-rec="upCn">识别到上行中文</button>';
    html += '<button class="ed-btn" data-rec="upEn">识别到上行英文</button>';
    html += '<button class="ed-btn" data-rec="downCn">识别到下行中文</button>';
    html += '<button class="ed-btn" data-rec="downEn">识别到下行英文</button>';
    html += '</div></div>';

    // Station columns (loop mode has no direction label)
    var loopMode = m.mode === "loop";
    var gridStyle = loopMode ? "grid-template-columns:1fr" : "grid-template-columns:1fr 1fr";
    html += '<div class="ed-station-columns" style="' + gridStyle + ';margin-top:14px" id="edStationGrid">';

    html += buildStationColumn(loopMode ? "环线站点" : "上行站点", m.upStationsCn, m.upStationsEn, "upStationsCn", "upStationsEn", loopMode ? "loop" : "up", loopMode ? null : { from: "up", to: "down", label: "反向复制到下行" });
    if (!loopMode) {
      html += buildStationColumn("下行站点", m.downStationsCn, m.downStationsEn, "downStationsCn", "downStationsEn", "down", { from: "down", to: "up", label: "反向复制到上行" });
    }
    html += '</div>';

    container.innerHTML = html;

    // ── Station field input handlers ──
    container.querySelectorAll(".ed-station-row input[data-field]").forEach(function (inp) {
      inp.addEventListener("focus", function () {
        inp.setAttribute("data-old-name", inp.value);
      });
      inp.addEventListener("blur", function () {
        var oldName = (inp.getAttribute("data-old-name") || "").trim();
        var newName = inp.value.trim();
        if (oldName && newName && oldName !== newName) {
          var f = inp.dataset.field;
          // Migrate stationAudioMap (keyed by station name)
          if (f === "upStationsCn" || f === "downStationsCn") {
            if (m.stationAudioMap && m.stationAudioMap[oldName]) {
              m.stationAudioMap[newName] = m.stationAudioMap[oldName];
              delete m.stationAudioMap[oldName];
            }
          }
        }
      });
      inp.addEventListener("input", function () {
        var field = inp.dataset.field;
        var idx = parseInt(inp.dataset.idx);
        if (field === "upStationsCn") m.upStationsCn[idx] = inp.value;
        else if (field === "upStationsEn") m.upStationsEn[idx] = inp.value;
        else if (field === "downStationsCn") m.downStationsCn[idx] = inp.value;
        else if (field === "downStationsEn") m.downStationsEn[idx] = inp.value;
        LE.state.isDirty = true;
      });
    });

    // ── Add station button handlers ──
    container.querySelectorAll(".ed-add-station").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var key = a.dataset.key;
        var arr = key === "upStationsCn" ? m.upStationsCn :
                  key === "upStationsEn" ? m.upStationsEn :
                  key === "downStationsCn" ? m.downStationsCn : m.downStationsEn;
        var enArr = key === "upStationsCn" ? m.upStationsEn :
                     key === "upStationsEn" ? null :
                     key === "downStationsCn" ? m.downStationsEn : null;
        if (arr.length >= 200) { LE.toast("最多200站", "warn"); return; }
        arr.push("");
        if (enArr) enArr.push("");
        LE.state.isDirty = true;
        LE.renderL2Stations(container);
      });
    });

    // ── Delete station button handlers ──
    container.querySelectorAll(".ed-st-del").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var idx = parseInt(btn.dataset.idx);
        var key = btn.dataset.key;
        var cnArr = key === "upStationsCn" ? m.upStationsCn : m.downStationsCn;
        var enArr = key === "upStationsCn" ? m.upStationsEn : m.downStationsEn;
        if (cnArr.length <= 1) { LE.toast("至少保留1站", "warn"); return; }
        var dir = key === "upStationsCn" ? "up" : "down";
        var ov = (m.stationOverrides && m.stationOverrides[dir] && m.stationOverrides[dir][idx + 1]) || {};
        // Only consider it "has override" if there are actual rules defined
        var hasOverride = !!(
          (ov.depart && ov.depart.length) ||
          (ov.arrive && ov.arrive.length) ||
          (ov.zhAudioRel && ov.zhAudioRel.trim()) ||
          (ov.enAudioRel && ov.enAudioRel.trim())
        );
        function doDelete() {
          cnArr.splice(idx, 1);
          enArr.splice(idx, 1);
          LE.reindexOverrides(m, dir, "splice", idx, -1);
          LE.state.isDirty = true;
          LE.renderL2Stations(container);
        }
        if (hasOverride) {
          showConfirmModal("删除站点", "该站有特殊规则定义，删除站点将同时删除规则。确认删除？", function (ok) { if (ok) doDelete(); }, true);
        } else {
          doDelete();
        }
      });
    });

    // ── Station gap (insert) handlers ──
    container.querySelectorAll(".ed-st-gap, .ed-st-end-add").forEach(function (gap) {
      gap.addEventListener("click", function (e) {
        e.stopPropagation();
        var insertAt = parseInt(gap.dataset.insert);
        var key = gap.dataset.key;
        var cnArr = key === "upStationsCn" ? m.upStationsCn : m.downStationsCn;
        var enArr = key === "upStationsCn" ? m.upStationsEn : m.downStationsEn;
        if (cnArr.length >= 200) { LE.toast("最多200站", "warn"); return; }
        cnArr.splice(insertAt, 0, "");
        enArr.splice(insertAt, 0, "");
        var dir = key === "upStationsCn" ? "up" : "down";
        LE.reindexOverrides(m, dir, "splice", insertAt, 1);
        LE.state.isDirty = true;
        LE.renderL2Stations(container);
        // Focus the new station's CN input
        setTimeout(function () {
          var newInp = container.querySelector('.ed-station-row[data-idx="' + insertAt + '"][data-col="' + key + '"] input[data-field="' + key + '"]');
          if (newInp) newInp.focus();
        }, 50);
      });
    });

    // ── Station drag-and-drop reordering ──
    setupStationDrag(container, m, "upStationsCn", "upStationsEn");
    if (!loopMode) setupStationDrag(container, m, "downStationsCn", "downStationsEn");

    // Bind mode switch
    var modeSwitch = container.querySelector("#edModeSwitch");
    if (modeSwitch) {
      modeSwitch.querySelectorAll(".ed-switch-option").forEach(function (opt) {
        opt.addEventListener("click", function () {
          var newMode = opt.dataset.mode;
          if (m.mode === newMode) return;
          m.mode = newMode;
          if (newMode === "loop") m.isUpDownSame = true;
          LE.state.isDirty = true;
          LE.renderL2Stations(container);
        });
      });
    }

    // Bind auto-recognition collapse
    var header = container.querySelector("#edAutoRecHeader");
    var body = container.querySelector("#edAutoRecBody");
    if (header && body) {
      header.addEventListener("click", function () {
        header.classList.toggle("open");
        body.classList.toggle("open");
      });
    }

    // Bind recognition buttons
    container.querySelectorAll("[data-rec]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = btn.dataset.rec;
        var text = container.querySelector("#edAutoRecText").value;
        var lang = (target === "upEn" || target === "downEn") ? "en" : "zh";
        var results = LE.recognizeStations(text, lang);
        LE.showRecognitionModal(target, results, function (confirmed) {
          if (target === "upCn") {
            m.upStationsCn = confirmed;
            // Clear old overrides and audioMapEn for this direction (station list replaced entirely)
            LE.reindexOverrides(m, "up", "clear");
            // Trim EN to CN length first, then pad (in case EN was longer than new CN)
            m.upStationsEn.length = Math.min(m.upStationsEn.length, confirmed.length);
            while (m.upStationsEn.length < confirmed.length) m.upStationsEn.push("");
          } else if (target === "downCn") {
            m.downStationsCn = confirmed;
            LE.reindexOverrides(m, "down", "clear");
            m.downStationsEn.length = Math.min(m.downStationsEn.length, confirmed.length);
            while (m.downStationsEn.length < confirmed.length) m.downStationsEn.push("");
          } else if (target === "upEn") {
            m.upStationsEn = confirmed;
            m.upStationsEn.length = Math.min(m.upStationsEn.length, m.upStationsCn.length);
            while (m.upStationsEn.length < m.upStationsCn.length) m.upStationsEn.push("");
          } else if (target === "downEn") {
            m.downStationsEn = confirmed;
            m.downStationsEn.length = Math.min(m.downStationsEn.length, m.downStationsCn.length);
            while (m.downStationsEn.length < m.downStationsCn.length) m.downStationsEn.push("");
          }
          LE.state.isDirty = true;
          LE.renderL2Stations(container);
        });
      });
    });

    // Bind reverse buttons
    container.querySelectorAll(".ed-reverse-btn").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var from = a.dataset.from;
        var to = a.dataset.to;
        if (from === "down" && to === "up") {
          showConfirmModal("反向生成", "将下行数据（含各站规则）逆序复制至上行？当前上行将被覆盖", function (ok) {
            if (!ok) return;
            var n = m.downStationsCn.length;
            m.upStationsCn = m.downStationsCn.slice().reverse();
            m.upStationsEn = m.downStationsEn.slice().reverse();
            // Copy + reverse overrides from down to up
            var srcOv = m.stationOverrides["down"] || {};
            var newOv = {};
            for (var k in srcOv) { newOv[n - parseInt(k) + 1] = JSON.parse(JSON.stringify(srcOv[k])); }
            m.stationOverrides["up"] = newOv;
            // Copy + reverse audioMapEn from down to up
            var srcAe = m.stationAudioMapEn || {};
            var newAe = {};
            for (var k2 in srcAe) { var parts = k2.split(":"); if (parts[0] === "down") newAe["up:" + (n - parseInt(parts[1]) + 1)] = srcAe[k2]; else newAe[k2] = srcAe[k2]; }
            for (var k3 in m.stationAudioMapEn || {}) { if (k3.split(":")[0] === "up") delete m.stationAudioMapEn[k3]; }
            for (var k4 in newAe) { m.stationAudioMapEn[k4] = newAe[k4]; }
            LE.state.isDirty = true;
            LE.renderL2Stations(container);
          });
        } else {
          showConfirmModal("反向生成", "将上行数据（含各站规则）逆序复制至下行？当前下行将被覆盖", function (ok) {
            if (!ok) return;
            var n = m.upStationsCn.length;
            m.downStationsCn = m.upStationsCn.slice().reverse();
            m.downStationsEn = m.upStationsEn.slice().reverse();
            var srcOv = m.stationOverrides["up"] || {};
            var newOv = {};
            for (var k in srcOv) { newOv[n - parseInt(k) + 1] = JSON.parse(JSON.stringify(srcOv[k])); }
            m.stationOverrides["down"] = newOv;
            var srcAe = m.stationAudioMapEn || {};
            var newAe = {};
            for (var k2 in srcAe) { var parts = k2.split(":"); if (parts[0] === "up") newAe["down:" + (n - parseInt(parts[1]) + 1)] = srcAe[k2]; else newAe[k2] = srcAe[k2]; }
            for (var k3 in m.stationAudioMapEn || {}) { if (k3.split(":")[0] === "down") delete m.stationAudioMapEn[k3]; }
            for (var k4 in newAe) { m.stationAudioMapEn[k4] = newAe[k4]; }
            LE.state.isDirty = true;
            LE.renderL2Stations(container);
          });
        }
      });
    });
  };

  function setupStationDrag(container, model, cnKey, enKey) {
    var rows = container.querySelectorAll('.ed-station-row[data-col="' + cnKey + '"]');
    console.log("[station-drag] setup cnKey=" + cnKey + " rows=" + rows.length);
    var dragSrcIdx = -1;
    var dragClone = null;
    var gapEl = null;

    // Prevent drag from input/textarea children (allow text selection)
    rows.forEach(function (row) {
      row.querySelectorAll("input, textarea").forEach(function (el) {
        el.draggable = false;
        el.addEventListener("mousedown", function () { row.draggable = false; });
        el.addEventListener("mouseup", function () { setTimeout(function () { row.draggable = true; }, 0); });
        el.addEventListener("focus", function () { row.draggable = false; });
        el.addEventListener("blur", function () { row.draggable = true; });
      });
      row.addEventListener("dragstart", function (e) {
        dragSrcIdx = parseInt(row.dataset.idx);
        console.log("[station-drag] dragstart cnKey=" + cnKey + " srcIdx=" + dragSrcIdx);
        row.classList.add("ed-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", JSON.stringify({ srcIdx: dragSrcIdx, cnKey: cnKey }));
      });

      row.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        var rect = row.getBoundingClientRect();
        var midY = rect.top + rect.height / 2;
        if (gapEl && gapEl.parentNode) gapEl.remove();
        gapEl = document.createElement("div");
        gapEl.className = "ed-drag-gap";
        if (e.clientY < midY) {
          row.parentNode.insertBefore(gapEl, row);
        } else {
          row.parentNode.insertBefore(gapEl, row.nextSibling);
        }
      });

      row.addEventListener("drop", function (e) {
        e.preventDefault();
        e.stopPropagation(); // Prevent column drop handler from double-firing
        if (gapEl && gapEl.parentNode) { gapEl.remove(); gapEl = null; }
        var raw = e.dataTransfer.getData("text/plain");
        var parsed;
        try { parsed = JSON.parse(raw); } catch (ex) { parsed = { srcIdx: parseInt(raw) }; }
        var srcIdx = parsed.srcIdx;
        var srcCnKey = parsed.cnKey || cnKey;
        var targetIdx = parseInt(row.dataset.idx);
        console.log("[station-drag] drop srcIdx=" + srcIdx + " srcCnKey=" + srcCnKey + " targetIdx=" + targetIdx + " myCnKey=" + cnKey);

        if (isNaN(srcIdx) || srcIdx === targetIdx) return;
        var rect = row.getBoundingClientRect();
        var insertAt = e.clientY < (rect.top + rect.height / 2) ? targetIdx : targetIdx + 1;
        if (insertAt > srcIdx) insertAt--;
        console.log("[station-drag] insertAt=" + insertAt + " cnArrLen=" + model[cnKey].length);

        var cnArr = cnKey === "upStationsCn" ? model.upStationsCn : model.downStationsCn;
        var enArr = cnKey === "upStationsCn" ? model.upStationsEn : model.downStationsEn;
        var cnItem = cnArr.splice(srcIdx, 1)[0];
        var enItem = enArr.splice(srcIdx, 1)[0];
        cnArr.splice(insertAt, 0, cnItem);
        enArr.splice(insertAt, 0, enItem);
        var dir = cnKey === "upStationsCn" ? "up" : "down";
        LE.reindexOverrides(model, dir, "reorder", srcIdx, insertAt);
        console.log("[station-drag] reordered, new cnArr: " + JSON.stringify(cnArr.map(function(s){return s||'(空)';})));
        LE.state.isDirty = true;
        LE.renderL2Stations(container);
      });

      row.addEventListener("dragend", function () {
        console.log("[station-drag] dragend cnKey=" + cnKey);
        row.classList.remove("ed-dragging");
        if (dragClone) { dragClone.remove(); dragClone = null; }
        if (gapEl && gapEl.parentNode) { gapEl.remove(); gapEl = null; }
        dragSrcIdx = -1;
      });
    });

    // Allow drop on the column itself (for gaps between rows) — only the matching column
    var cols = container.querySelectorAll(".ed-station-col");
    cols.forEach(function (col) {
      if (!col.querySelector('.ed-station-row[data-col="' + cnKey + '"]')) return;
      col.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      });
      col.addEventListener("drop", function (e) {
        e.preventDefault();
        if (gapEl && gapEl.parentNode) { gapEl.remove(); gapEl = null; }
        var raw = e.dataTransfer.getData("text/plain");
        var parsed;
        try { parsed = JSON.parse(raw); } catch (ex) { parsed = { srcIdx: parseInt(raw) }; }
        var srcIdx = parsed.srcIdx;
        console.log("[station-drag] column drop srcIdx=" + srcIdx + " cnKey=" + cnKey + " clientY=" + e.clientY);
        if (isNaN(srcIdx)) return;
        var cnArr = cnKey === "upStationsCn" ? model.upStationsCn : model.downStationsCn;
        var enArr = cnKey === "upStationsCn" ? model.upStationsEn : model.downStationsEn;
        // Find insert position by comparing mouse Y to each row
        var insertAt = cnArr.length; // default: end
        var rows2 = col.querySelectorAll('.ed-station-row[data-col="' + cnKey + '"]');
        rows2.forEach(function (r, i) {
          var rrect = r.getBoundingClientRect();
          if (e.clientY < rrect.top + rrect.height / 2 && insertAt === cnArr.length) {
            insertAt = i;
          }
        });
        if (insertAt > srcIdx) insertAt--;
        console.log("[station-drag] column drop insertAt=" + insertAt);
        if (insertAt === srcIdx) return;
        var cnItem = cnArr.splice(srcIdx, 1)[0];
        var enItem = enArr.splice(srcIdx, 1)[0];
        cnArr.splice(insertAt, 0, cnItem);
        enArr.splice(insertAt, 0, enItem);
        var dir2 = cnKey === "upStationsCn" ? "up" : "down";
        LE.reindexOverrides(model, dir2, "reorder", srcIdx, insertAt);
        console.log("[station-drag] reordered from column, new cnArr: " + JSON.stringify(cnArr.map(function(s){return s||'(空)';})));
        LE.state.isDirty = true;
        LE.renderL2Stations(container);
      });
    });
  }

  /* ── Shared card drag-and-drop (L0 companies, L1 lines) ── */
  var _cardDragCtx = null; // { container, items, onReorder, gapEl, dragIdx }
  function getDragCtx() { return _cardDragCtx; }

  // Global dragover/drop — attached once, reads from current _cardDragCtx
  if (!document._cardDragGlobalSetup) {
    document._cardDragGlobalSetup = true;
    document.addEventListener("dragover", function (e) {
      var ctx = _cardDragCtx;
      if (!ctx || ctx.dragIdx < 0) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    document.addEventListener("drop", function (e) {
      var ctx = _cardDragCtx;
      if (!ctx || ctx.dragIdx < 0) return;
      e.preventDefault();
      var srcIdx = ctx.dragIdx;
      console.log("[card-drag] global drop srcIdx=" + srcIdx + " clientY=" + e.clientY);
      if (isNaN(srcIdx) || srcIdx < 0) return;
      if (ctx.gapEl && ctx.gapEl.parentNode) ctx.gapEl.remove();
      var cards = ctx.container.querySelectorAll(".ed-card.has-drag");
      var insertAt = ctx.items.length;
      cards.forEach(function (c, i) {
        var r = c.getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2 && insertAt === ctx.items.length) insertAt = i;
      });
      if (insertAt > srcIdx) insertAt--;
      console.log("[card-drag] global drop insertAt=" + insertAt + " itemsLen=" + ctx.items.length);
      if (insertAt < 0 || insertAt === srcIdx || insertAt >= ctx.items.length) return;
      var item = ctx.items.splice(srcIdx, 1)[0];
      ctx.items.splice(insertAt, 0, item);
      ctx.gapEl = null;
      ctx.dragIdx = -1;
      ctx.onReorder();
    });
  }

  function setupCardDrag(container, items, onReorder) {
    var gapEl = null;
    var dragIdx = -1;

    // Update global context
    _cardDragCtx = { container: container, items: items, onReorder: onReorder, gapEl: null, dragIdx: -1 };

    function doDrop(clientY) {
      var srcIdx = dragIdx;
      console.log("[card-drag] doDrop srcIdx=" + srcIdx + " clientY=" + clientY);
      if (isNaN(srcIdx) || srcIdx < 0) return;
      if (gapEl && gapEl.parentNode) gapEl.remove();
      var cards = container.querySelectorAll(".ed-card.has-drag");
      var insertAt = items.length;
      cards.forEach(function (c, i) {
        var r = c.getBoundingClientRect();
        if (clientY < r.top + r.height / 2 && insertAt === items.length) insertAt = i;
      });
      if (insertAt > srcIdx) insertAt--;
      console.log("[card-drag] doDrop insertAt=" + insertAt + " itemsLen=" + items.length);
      if (insertAt < 0 || insertAt === srcIdx || insertAt >= items.length) return;
      var item = items.splice(srcIdx, 1)[0];
      items.splice(insertAt, 0, item);
      gapEl = null;
      dragIdx = -1;
      _cardDragCtx.dragIdx = -1;
      _cardDragCtx.gapEl = null;
      onReorder();
    }

    container.querySelectorAll(".ed-card.has-drag[draggable]").forEach(function (card) {
      // Prevent drag from interactive child elements
      card.querySelectorAll("a, button, input, select, textarea").forEach(function (el) {
        el.draggable = false;
        el.addEventListener("dragstart", function (e) { e.preventDefault(); e.stopPropagation(); });
      });

      card.addEventListener("dragstart", function (e) {
        dragIdx = parseInt(card.dataset.idx);
        _cardDragCtx.dragIdx = dragIdx;
        _cardDragCtx.gapEl = null;
        console.log("[card-drag] dragstart idx=" + dragIdx);
        card.classList.add("ed-card-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(dragIdx));
        e.dataTransfer.setDragImage(card, card.offsetWidth / 2, card.offsetHeight / 2);
      });

      card.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        var rect = card.getBoundingClientRect();
        if (gapEl && gapEl.parentNode) gapEl.remove();
        gapEl = document.createElement("div");
        gapEl.className = "ed-drag-gap";
        gapEl.style.height = "36px";
        _cardDragCtx.gapEl = gapEl;
        if (e.clientY < rect.top + rect.height / 2) {
          card.parentNode.insertBefore(gapEl, card);
        } else {
          card.parentNode.insertBefore(gapEl, card.nextSibling);
        }
      });

      card.addEventListener("drop", function (e) {
        e.preventDefault(); e.stopPropagation();
        doDrop(e.clientY);
      });

      card.addEventListener("dragend", function () {
        console.log("[card-drag] dragend idx=" + dragIdx);
        var dc = document.querySelector(".ed-card-dragging");
        if (dc) dc.classList.remove("ed-card-dragging");
        if (gapEl && gapEl.parentNode) { gapEl.remove(); gapEl = null; }
        dragIdx = -1;
        _cardDragCtx.dragIdx = -1;
        _cardDragCtx.gapEl = null;
      });
    });
  }

  function buildStationColumn(label, stopsCn, stopsEn, cnKey, enKey, theme, reverse) {
    var heading = label ? '<div class="ed-station-col-title ed-theme-' + theme + '"><h4>' + label + '</h4>' + (reverse ? '<button type="button" class="ed-btn ed-btn-ghost ed-reverse-btn" data-from="' + reverse.from + '" data-to="' + reverse.to + '">' + reverse.label + '</button>' : '') + '</div>' : '';
    var html = '<div class="ed-station-col">' + heading;

    // Detect same-name stations (Chinese) for warning
    var cnSeen = {};
    var cnWarn = {};
    for (var j = 0; j < stopsCn.length; j++) {
      var n = (stopsCn[j] || "").trim();
      if (n && cnSeen[n] !== undefined) {
        cnWarn[j] = cnSeen[n] + 1;
      } else if (n) {
        cnSeen[n] = j;
      }
    }
    var enSeen = {};
    var enWarn = {};
    for (var j = 0; j < stopsEn.length; j++) {
      var n2 = (stopsEn[j] || "").trim();
      if (n2 && enSeen[n2] !== undefined) {
        enWarn[j] = enSeen[n2] + 1;
      } else if (n2) {
        enSeen[n2] = j;
      }
    }

    // Leading gap before first station
    if (stopsCn.length > 0) {
      html += '<div class="ed-st-gap" data-insert="0" data-key="' + cnKey + '"></div>';
    }

    for (var i = 0; i < stopsCn.length; i++) {
      html += '<div class="ed-station-row" data-idx="' + i + '" data-col="' + cnKey + '" draggable="true">';
      html += '<div class="ed-st-seq">';
      html += '<div class="ed-st-dot">' + (i + 1) + '</div>';
      if (i < stopsCn.length - 1) html += '<div class="ed-st-line"></div>';
      html += '</div>';
      html += '<div class="ed-st-fields">';
      // Chinese name with optional warn
      var cnWarnHtml = cnWarn[i] !== undefined ? ' <span class="ed-st-warn" title="与同方向第' + cnWarn[i] + '站中文名相同">⚠</span>' : '';
      html += '<div style="display:flex;align-items:center;gap:4px">';
      html += '<input class="ed-form-input" value="' + LE.escHtml(stopsCn[i]) + '" placeholder="请输入站点中文名称" data-field="' + cnKey + '" data-idx="' + i + '" style="flex:1;margin-bottom:3px">';
      html += cnWarnHtml;
      html += '</div>';
      // English name with optional warn
      var enWarnHtml = enWarn[i] !== undefined ? ' <span class="ed-st-warn" title="与同方向第' + enWarn[i] + '站英文名相同">⚠</span>' : '';
      html += '<div style="display:flex;align-items:center;gap:4px">';
      html += '<input class="ed-form-input" value="' + LE.escHtml(stopsEn[i] || "") + '" placeholder="请输入站点英文名称（选填）" data-field="' + enKey + '" data-idx="' + i + '" style="flex:1">';
      html += enWarnHtml;
      html += '</div>';
      html += '</div>';
      html += '<span class="ed-st-drag" data-idx="' + i + '" data-key="' + cnKey + '">≡</span>';
      html += '<span class="ed-st-del" data-idx="' + i + '" data-key="' + cnKey + '">×</span>';
      html += '</div>';
      // Gap between this card and the next
      if (i < stopsCn.length - 1) {
        html += '<div class="ed-st-gap" data-insert="' + (i + 1) + '" data-key="' + cnKey + '"></div>';
      }
    }

    // End dashed box for adding at the end
    html += '<div class="ed-st-end-add" data-insert="' + stopsCn.length + '" data-key="' + cnKey + '">+ 添加站点</div>';
    html += '</div>';
    return html;
  }

  /* ── Auto-recognition modal ── */
  LE.showRecognitionModal = function (target, results, callback) {
    var labels = { upCn: "上行中文", upEn: "上行英文", downCn: "下行中文", downEn: "下行英文" };
    var title = labels[target] || target;

    var overlay = document.createElement("div");
    overlay.className = "ed-modal-overlay";
    overlay.innerHTML = '<div class="ed-modal" style="width:480px">' +
      '<div class="ed-modal-header"><h3>' + title + '识别结果</h3>' + modalCloseButton() + '</div>' +
      '<div class="ed-modal-body"><p style="color:#69778d;font-size:12px;margin-bottom:4px">以下是识别站名结果，每行一个站。您可以二次编辑，或者确认导入。</p>' +
      '<a href="#" id="edRecAppendZhan" style="color:#1468df;font-size:12px">在所有站后面加个"站"字</a>' +
      '<textarea id="edRecModalText" class="ed-form-textarea" style="min-height:200px;font-family:monospace;margin-top:6px">' +
      LE.escHtml(results.join("\n")) + '</textarea></div>' +
      '<div class="ed-modal-footer">' +
      '<button class="ed-btn ed-btn-ghost" id="edRecCancel">取消</button>' +
      '<button class="ed-btn ed-btn-primary" id="edRecConfirm">确认导入</button></div></div>';

    $("lineEditorSidebar").appendChild(overlay);

    overlay.querySelector(".ed-modal-close").onclick = function () { overlay.remove(); };
    overlay.querySelector("#edRecCancel").onclick = function () { overlay.remove(); };
    var appendLink = overlay.querySelector("#edRecAppendZhan");
    if (appendLink) {
      appendLink.addEventListener("click", function (e) {
        e.preventDefault();
        var ta = overlay.querySelector("#edRecModalText");
        if (ta) {
          var lines = ta.value.split("\n");
          ta.value = lines.map(function (l) {
            var t = l.trim();
            return t && !t.endsWith("站") ? t + "站" : t;
          }).join("\n");
        }
      });
    }
    overlay.querySelector("#edRecConfirm").onclick = function () {
      var text = overlay.querySelector("#edRecModalText").value;
      var lines = text.split("\n").map(function (l) { return l.trim(); }).filter(function (l) { return l; });
      overlay.remove();
      callback(lines);
    };
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) overlay.remove(); });
  };

  /* ── L2: Global Templates Sub-Page ── */
  LE.renderL2Templates = function (container) {
    var m = LE.state.editModel;
    if (!m) { container.innerHTML = '<div class="ed-empty">未加载线路</div>'; return; }
    var t = m.templates;
    var company = (LE.state.currentLineRelPath || "").split("/")[0] || LE.state.currentCompany;

    var html = "";

    // Same-direction mode uses the existing up-rule storage; the switch only changes presentation.
    var isLoop2 = m.mode === "loop";
    if (!isLoop2) {
      html += '<label class="ed-toggle"><input type="checkbox" id="edUpDownSame" ' +
        (m.isUpDownSame ? "checked" : "") + '><span class="ed-toggle-track"></span><span>上下行相同</span></label>';
    }

    var sameRules = isLoop2 || m.isUpDownSame;
    var direction = LE.state._templateDirection === "down" ? "down" : "up";
    if (!sameRules) {
      html += '<div class="ed-template-direction-group"><div class="ed-template-tabs"><button type="button" class="ed-template-tab ed-theme-up' + (direction === "up" ? " active" : "") + '" data-template-dir="up">上行</button><button type="button" class="ed-template-tab ed-theme-down' + (direction === "down" ? " active" : "") + '" data-template-dir="down">下行</button></div><div class="ed-template-direction-body">';
    }
    var prefix = sameRules ? "up" : direction;
    var theme = sameRules ? "blue" : direction;
    var groups = [
      { title: "首站规则", fields: [
        { key: prefix + "FirstDepart", label: "首站预报规则", subContext: "first_depart" },
      ]},
      { title: "普通站规则", fields: [
        { key: prefix + "Depart", label: "默认预报规则", subContext: "station_depart" },
        { key: prefix + "Arrive", label: "默认到站播报规则", subContext: "station_arrive" },
      ]},
      { title: "终点站规则", fields: [
        { key: prefix + "TerminalDepart", label: "终点站预报规则", subContext: "terminal_depart" },
        { key: prefix + "TerminalArrive", label: "终点站报站规则", subContext: "terminal_arrive" },
      ]},
    ];

    groups.forEach(function (group, gi) {
      html += '<div style="margin-bottom:24px">';
      html += '<h4 class="ed-section-title ed-theme-' + theme + '">' + group.title + '</h4>';
      group.fields.forEach(function (field) {
        html += '<div class="ed-form-group">';
        html += '<label class="ed-form-label">' + field.label + '</label>';
        html += '<div id="edTpl_' + field.key + '" class="ed-rule-editor-slot"></div>';
        {
          html += '<div style="margin-top:4px;font-size:11px">';
          html += '<a href="#" class="ed-link ed-clear-rule" data-key="' + field.key + '">清空</a>';
          html += '<a href="#" class="ed-link" style="margin-left:12px" data-apply="' + field.key + '">应用到其他线路</a>';
          html += '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
    });
    if (!sameRules) html += '</div></div>';

    {
      html += '<div style="padding-top:8px;border-top:1px solid #e5edf6">';
      html += '<button class="ed-btn ed-btn-ghost" id="edApplyAllTemplates">应用本页所有全局规则到其他线路</button>';
      html += '</div>';
    }

    container.innerHTML = html;

    // Render Rule Editors
    groups.forEach(function (group) {
      group.fields.forEach(function (field) {
        var slot = container.querySelector("#edTpl_" + field.key);
        if (!slot) return;
        console.log("[editor-ui] Creating rule-editor for templates." + field.key + ", company=" + company);
        var editor = LE.createRuleEditor({
          tokens: t[field.key] || [],
          context: "global_template",
          subContext: field.subContext,
          companyRelPath: company,
          placeholder: getTemplatePlaceholder(field.key),
          onChange: function (tokens) {
            t[field.key] = tokens;
            LE.state.isDirty = true;
          },
        });
        /* always editable */
        slot.appendChild(editor);
      });
    });

    // Up/Down same
    var cb = container.querySelector("#edUpDownSame");
    if (cb) {
      cb.addEventListener("change", function () {
        m.isUpDownSame = cb.checked;
        LE.state.isDirty = true;
        LE.renderL2();
      });
    }
    container.querySelectorAll("[data-template-dir]").forEach(function (tab) {
      tab.addEventListener("click", function () {
        LE.state._templateDirection = tab.dataset.templateDir;
        LE.renderL2();
      });
    });

    // Clear buttons
    container.querySelectorAll(".ed-clear-rule").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var key = a.dataset.key;
        t[key] = [];
        LE.state.isDirty = true;
        LE.renderL2();
      });
    });

    // Apply to other lines
    container.querySelectorAll("[data-apply]").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        LE.showApplyDialog("templates", a.dataset.key);
      });
    });

    var applyAllBtn = container.querySelector("#edApplyAllTemplates");
    if (applyAllBtn) {
      applyAllBtn.addEventListener("click", function () {
        LE.showApplyDialog("all_templates");
      });
    }
  };

  function getTemplatePlaceholder(key) {
    if (key.indexOf("down") === 0 || key === "downFirstDepart" || key === "downDepart" ||
        key === "downArrive" || key === "downTerminalDepart" || key === "downTerminalArrive") {
      return "留空表示引用对应上行规则";
    }
    return "留空表示无默认音频";
  }

  /* ── Station Default Template Resolution ── */
  function getStationDefaultTemplate(model, dir, stopIdx, field) {
    var tpl = model.templates;
    if (!tpl) return [];
    var prefix = dir === "up" ? "up" : "down";
    var stops = dir === "up" ? model.upStationsCn : model.downStationsCn;
    var n = stops.length;
    if (field === "depart") {
      if (stopIdx === 2 && tpl[prefix + "FirstDepart"] && tpl[prefix + "FirstDepart"].length) return tpl[prefix + "FirstDepart"];
      if (stopIdx === n && tpl[prefix + "TerminalDepart"] && tpl[prefix + "TerminalDepart"].length) return tpl[prefix + "TerminalDepart"];
      return tpl[prefix + "Depart"] || [];
    }
    if (field === "arrive") {
      if (stopIdx === n && tpl[prefix + "TerminalArrive"] && tpl[prefix + "TerminalArrive"].length) return tpl[prefix + "TerminalArrive"];
      return tpl[prefix + "Arrive"] || [];
    }
    if (field === "zhAudioRel") {
      return ["【本站中文文件】"];
    }
    if (field === "enAudioRel") {
      return ["【本站英文文件】"];
    }
    return [];
  }

  function getStationContext(model, dir, stopIdx, field) {
    var stopsCn = dir === "up" ? model.upStationsCn : model.downStationsCn;
    var stopsEn = dir === "up" ? model.upStationsEn : model.downStationsEn;
    var idx0 = stopIdx - 1;
    // For forecast rules: 本站=departure station (prev), 下站=heading destination (current)
    // For arrival rules: 本站=current station, 下站=next station
    var isDepart = (field === "depart");
    var benIdx = isDepart ? Math.max(0, idx0 - 1) : idx0;
    var xiaIdx = isDepart ? idx0 : (stopIdx < stopsCn.length ? idx0 + 1 : idx0);
    return {
      benZhanName: stopsCn[benIdx] || "",
      xiaZhanName: stopsCn[xiaIdx] || "",
      startName: stopsCn[0] || "",
      endName: stopsCn[stopsCn.length - 1] || "",
      startEnName: (stopsEn && stopsEn[0]) ? stopsEn[0] : "",
      endEnName: (stopsEn && stopsEn[stopsEn.length - 1]) ? stopsEn[stopsEn.length - 1] : "",
      benZhanEnName: (stopsEn && stopsEn[benIdx]) ? stopsEn[benIdx] : "",
      xiaZhanEnName: (stopsEn && xiaIdx < stopsEn.length && stopsEn[xiaIdx]) ? stopsEn[xiaIdx] : "",
    };
  }

  /* ── L2: Per-Station Rules Sub-Page ── */
  LE.renderL2StationRules = function (container) {
    var m = LE.state.editModel;
    if (!m) { container.innerHTML = '<div class="ed-empty">未加载线路</div>'; return; }
    var company = (LE.state.currentLineRelPath || "").split("/")[0] || LE.state.currentCompany;

    var html = "";
    html += '<div style="margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap">';
    html += '<button class="ed-btn ed-btn-ghost" id="edExpandAll">一键展开所有</button>';
    html += '<button class="ed-btn ed-btn-ghost" id="edCollapseAll">一键收起所有</button>';
    html += '</div>';

    function buildDirSection(dirLabel, stops, overrides, dir) {
      var h = '<div style="margin-bottom:12px"><h4 style="font-size:13px;color:#20355c;margin:0 0 8px">' + dirLabel + '站点</h4>';
      stops.forEach(function (stn, idx) {
        var i = idx + 1;
        var ov = (overrides && overrides[i]) ? overrides[i] : {};
        var hasOverride = (ov.depart && ov.depart.length) || (ov.arrive && ov.arrive.length) ||
                          ov.zhAudioRel || ov.enAudioRel;
        var indicatorCls = hasOverride ? "on" : "off";

        h += '<div class="ed-strule-card" id="edStrule_' + dir + '_' + i + '" data-dir="' + dir + '" data-idx="' + i + '">';
        h += '<div class="ed-strule-header">';
        h += '<span class="ed-strule-seq">' + i + '</span>';
        h += '<span class="ed-strule-indicator ' + indicatorCls + '"></span>';
        h += '<span class="ed-strule-name">' + LE.escHtml(stn || "(空)") + '</span>';
        h += '<span class="ed-strule-arrow">▶</span>';
        h += '</div>';
        h += '<div class="ed-strule-body">';

        // 4 rules
        var ruleFields = [
          { key: "depart", label: "预报规则", subContext: "station_depart", placeholder: "留空表示引用{默认模版}" },
          { key: "arrive", label: "到站规则", subContext: "station_arrive", placeholder: "留空表示引用{默认模版}" },
          { key: "zhAudioRel", label: "本站中文语音文件", subContext: "station_zh_audio", placeholder: "留空表示使用同名文件自动匹配" },
          { key: "enAudioRel", label: "本站英文语音文件", subContext: "station_en_audio", placeholder: "留空表示使用同名文件自动匹配" },
        ];

        ruleFields.forEach(function (rf) {
          h += '<div class="ed-form-group">';
          h += '<label class="ed-form-label">' + rf.label + '</label>';
          h += '<div id="edStRule_' + dir + '_' + i + '_' + rf.key + '" class="ed-rule-editor-slot"></div>';
          h += '</div>';
        });

        h += '<div class="ed-strule-actions">';
        h += '<a href="#" class="ed-copy-to-opposite" data-dir="' + dir + '" data-idx="' + i + '">复制到对向同名站点</a>';
        h += '<a href="#" class="ed-apply-station" data-dir="' + dir + '" data-idx="' + i + '">应用到其他线路</a>';
        h += '<a href="#" class="ed-strule-clear ed-clear-station" data-dir="' + dir + '" data-idx="' + i + '">清空</a>';
        h += '</div>';

        h += '</div></div>';
      });
      h += '</div>';
      return h;
    }

    html += buildDirSection("上行", m.upStationsCn, m.stationOverrides.up, "up");
    html += buildDirSection("下行", m.downStationsCn, m.stationOverrides.down, "down");

    container.innerHTML = html;

    // Render Rule Editors
    ["up", "down"].forEach(function (dir) {
      var stops = dir === "up" ? m.upStationsCn : m.downStationsCn;
      var overrides = m.stationOverrides[dir] || {};
      stops.forEach(function (stn, idx) {
        var i = idx + 1;
        var ov = overrides[i] || {};
        ["depart", "arrive", "zhAudioRel", "enAudioRel"].forEach(function (key) {
          var slotId = "edStRule_" + dir + "_" + i + "_" + key;
          var slot = container.querySelector("#" + slotId);
          if (!slot) return;
          var subContext = key === "depart" ? "station_depart" : key === "arrive" ? "station_arrive" :
            key === "zhAudioRel" ? "station_zh_audio" : "station_en_audio";
          var tokens = ov[key] || [];
          if (key === "zhAudioRel" || key === "enAudioRel") {
            tokens = typeof tokens === "string" ? LE.parseRuleTokens(tokens) : (Array.isArray(tokens) ? tokens : []);
          }
          var stationCtx = getStationContext(m, dir, i, key);
          var defaultTpl = getStationDefaultTemplate(m, dir, i, key);
          var ovLabel = (key === "zhAudioRel" || key === "enAudioRel") ? "默认" : null;
          var editor = LE.createRuleEditor({
            tokens: tokens,
            context: "global_template",
            subContext: subContext,
            companyRelPath: company,
            placeholder: key === "depart" || key === "arrive" ? "留空表示引用{默认模版}" : "留空表示使用同名文件自动匹配",
            defaultTokens: defaultTpl.length ? defaultTpl : null,
            stationContext: stationCtx,
            overlayLabel: ovLabel,
            onChange: function (newTokens) {
              if (key === "zhAudioRel" || key === "enAudioRel") {
                ov[key] = LE.serializeTokens(newTokens);
              } else {
                ov[key] = newTokens;
              }
              if (!overrides[i]) overrides[i] = ov;
              LE.state.isDirty = true;
              // Update station rule indicator (green/red dot)
              var indicator = container.querySelector("#edStrule_" + dir + "_" + i + " .ed-strule-indicator");
              if (indicator) {
                var has = (ov.depart && ov.depart.length) || (ov.arrive && ov.arrive.length) ||
                          (ov.zhAudioRel && ov.zhAudioRel.trim()) || (ov.enAudioRel && ov.enAudioRel.trim());
                indicator.className = "ed-strule-indicator " + (has ? "on" : "off");
              }
            },
          });
          /* always editable */
          slot.appendChild(editor);
        });
      });
    });

    // Card expand/collapse
    container.querySelectorAll(".ed-strule-header").forEach(function (hdr) {
      hdr.addEventListener("click", function () {
        var card = hdr.closest(".ed-strule-card");
        card.classList.toggle("open");
      });
    });

    // Expand/collapse all
    container.querySelector("#edExpandAll").addEventListener("click", function () {
      container.querySelectorAll(".ed-strule-card").forEach(function (c) { c.classList.add("open"); });
    });
    container.querySelector("#edCollapseAll").addEventListener("click", function () {
      container.querySelectorAll(".ed-strule-card").forEach(function (c) { c.classList.remove("open"); });
    });

    // Copy to opposite
    container.querySelectorAll(".ed-copy-to-opposite").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var dir = a.dataset.dir;
        var idx = parseInt(a.dataset.idx);
        var oppDir = dir === "up" ? "down" : "up";
        var srcStops = dir === "up" ? m.upStationsCn : m.downStationsCn;
        var oppStops = oppDir === "up" ? m.upStationsCn : m.downStationsCn;
        var srcName = srcStops[idx - 1];
        var oppIdx = oppStops.indexOf(srcName);
        if (oppIdx < 0) { LE.toast("对向无同名车站", "info"); return; }
        var srcOverride = (m.stationOverrides[dir] || {})[idx] || {};
        if (!m.stationOverrides[oppDir]) m.stationOverrides[oppDir] = {};
        m.stationOverrides[oppDir][oppIdx + 1] = JSON.parse(JSON.stringify(srcOverride));
        LE.state.isDirty = true;
        LE.renderL2();
        LE.toast("已复制到对向站点", "success");
      });
    });

    // Clear station
    container.querySelectorAll(".ed-clear-station").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var dir = a.dataset.dir;
        var idx = parseInt(a.dataset.idx);
        if (!m.stationOverrides[dir]) return;
        delete m.stationOverrides[dir][idx];
        LE.state.isDirty = true;
        LE.renderL2();
      });
    });
  };

  /* ── L2: Hand-Press Tips Sub-Page ── */
  LE.renderL2Tips = function (container) {
    var m = LE.state.editModel;
    if (!m) { container.innerHTML = '<div class="ed-empty">未加载线路</div>'; return; }
    var company = (LE.state.currentLineRelPath || "").split("/")[0] || LE.state.currentCompany;
    var tips = m.tipItems || [];
    console.log("[editor-ui] renderL2Tips: tipItems.length=" + tips.length + ", names=" + JSON.stringify(tips.map(function(t){return t.name;})));
    while (tips.length < 10) tips.push({ name: "", ruleTokens: [] });

    var html = "";
    {
      html += '<button class="ed-btn ed-btn-ghost" id="edApplyAllTips" style="margin-bottom:8px">应用到其他线路</button>';
    }

    for (var i = 0; i < 10; i++) {
      var tip = tips[i] || { name: "", ruleTokens: [] };
      html += '<div class="ed-form-group" style="padding:8px;background:#f7f9fc;border-radius:8px;border:1px solid #e5edf6">';
      html += '<label class="ed-form-label">提示语 ' + (i + 1) + '</label>';
      html += '<input class="ed-form-input" id="edTipName_' + i + '" value="' + LE.escHtml(tip.name) +
        '" placeholder="如让座、转弯等，不填写则默认显示服务语X" style="margin-bottom:6px" ' + ' maxlength="20">';
      html += '<div id="edTipRule_' + i + '" class="ed-rule-editor-slot"></div>';
      {
        html += '<a href="#" class="ed-link ed-clear-tip" data-idx="' + i + '" style="font-size:11px;margin-top:4px;display:inline-block">清空本条</a>';
      }
      html += '</div>';
    }

    container.innerHTML = html;

    // Render Rule Editors
    for (var j = 0; j < 10; j++) {
      var slot = container.querySelector("#edTipRule_" + j);
      if (!slot) continue;
      var tipTokens = tips[j].ruleTokens || [];
      (function (idx) {
        var editor = LE.createRuleEditor({
          tokens: Array.isArray(tipTokens) ? tipTokens : [],
          context: "tip",
          companyRelPath: company,
          placeholder: "点击选择音频文件...",
          onChange: function (tokens) {
            tips[idx].ruleTokens = tokens;
            LE.state.isDirty = true;
          },
        });
        /* always editable */
        slot.appendChild(editor);
      })(j);
    }

    // Name inputs
    for (var k = 0; k < 10; k++) {
      var nameEl = container.querySelector("#edTipName_" + k);
      if (nameEl) {
        // Capture `el` per iteration: `var nameEl` is function-scoped, so a
        // closure over it would read the LAST input's value for every tip.
        (function (idx, el) {
          el.addEventListener("input", function () {
            console.log("[editor-ui] tip " + (idx + 1) + " name changed to: " + JSON.stringify(el.value));
            tips[idx].name = el.value;
            LE.state.isDirty = true;
          });
        })(k, nameEl);
      }
    }

    // Clear buttons
    container.querySelectorAll(".ed-clear-tip").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var idx = parseInt(a.dataset.idx);
        tips[idx] = { name: "", ruleTokens: [] };
        LE.state.isDirty = true;
        LE.renderL2();
      });
    });

    // Apply all tips
    var applyBtn = container.querySelector("#edApplyAllTips");
    if (applyBtn) {
      applyBtn.addEventListener("click", function () {
        LE.showApplyDialog("tips");
      });
    }
  };

  /* ── Cross-line Apply Dialog ── */
  LE.showApplyDialog = function (scope, fieldKey) {
    var currentCompany = (LE.state.currentLineRelPath || "").split("/")[0] || LE.state.currentCompany;
    if (!LE.mainState || !LE.mainState.newIndex) { LE.toast("请先加载线路索引", "warn"); return; }

    var allCompanies = LE.mainState.newIndex.companies || [];
    var companyOpts = allCompanies.map(function (c) {
      var sel = c.name === currentCompany ? " selected" : "";
      return '<option value="' + LE.escHtml(c.name) + '"' + sel + '>' + LE.escHtml(c.name) + '</option>';
    }).join("");

    var overlay = document.createElement("div");
    overlay.className = "ed-modal-overlay";
    overlay.innerHTML = '<div class="ed-modal" style="width:500px">' +
      '<div class="ed-modal-header"><h3>应用到其他线路</h3>' + modalCloseButton() + '</div>' +
      '<div class="ed-modal-body">' +
      '<div style="margin-bottom:10px"><strong>目标公司：</strong> <select id="edApplyCompany" style="padding:6px 8px;background:#ffffff;border:1px solid #d8e3f1;border-radius:4px;color:#20355c">' + companyOpts + '</select></div>' +
      '<div style="margin-bottom:6px;font-size:11px">' +
      '<a href="#" id="edApplySelAll" style="color:#1468df">全选</a> &nbsp;' +
      '<a href="#" id="edApplySelNone" style="color:#1468df">全不选</a> &nbsp;' +
      '<a href="#" id="edApplyInvert" style="color:#1468df">反选</a></div>' +
      '<div id="edApplyLineList" style="max-height:220px;overflow-y:auto;margin-bottom:10px"><div class="ed-empty">加载中...</div></div>' +
      '<div style="margin-top:10px"><strong>应用策略：</strong></div>' +
      '<div style="display:flex;gap:16px;margin-top:4px">' +
      '<label class="ed-radio"><input type="radio" name="edApplyStrategy" value="fill_empty" checked> 仅填充空值</label>' +
      '<label class="ed-radio"><input type="radio" name="edApplyStrategy" value="overwrite"> 覆盖所有值</label>' +
      '</div></div>' +
      '<div class="ed-modal-footer">' +
      '<button class="ed-btn ed-btn-ghost" id="edApplyCancel">取消</button>' +
      '<button class="ed-btn ed-btn-primary" id="edApplyConfirm">确认</button></div></div>';

    $("lineEditorSidebar").appendChild(overlay);

    function loadLines(companyName) {
      var comp = allCompanies.find(function (c) { return c.name === companyName; });
      var lines = (comp && comp.lines) ? comp.lines.slice() : [];
      lines = lines.filter(function (l) { return l.file !== LE.state.currentLineRelPath; });
      var listEl = overlay.querySelector("#edApplyLineList");
      if (!lines.length) { listEl.innerHTML = '<div class="ed-empty">该公司无其他线路</div>'; return; }
      var html = '<table class="ed-apply-table"><tbody>';
      lines.forEach(function (l) {
        var name = l.name || (l.file || "").split("/").pop().replace(/\.ini$/i, "");
        html += '<tr><td style="width:28px"><input type="checkbox" class="ed-apply-check" data-file="' + LE.escHtml(l.file) + '"></td>' +
          '<td>' + LE.escHtml(name) + '</td></tr>';
      });
      html += '</tbody></table>';
      listEl.innerHTML = html;
    }
    loadLines(currentCompany);

    overlay.querySelector("#edApplyCompany").addEventListener("change", function () {
      loadLines(this.value);
    });
    overlay.querySelector(".ed-modal-close").onclick = function () { overlay.remove(); };
    overlay.querySelector("#edApplyCancel").onclick = function () { overlay.remove(); };
    overlay.querySelector("#edApplySelAll").addEventListener("click", function (e) {
      e.preventDefault();
      overlay.querySelectorAll(".ed-apply-check").forEach(function (c) { c.checked = true; });
    });
    overlay.querySelector("#edApplySelNone").addEventListener("click", function (e) {
      e.preventDefault();
      overlay.querySelectorAll(".ed-apply-check").forEach(function (c) { c.checked = false; });
    });
    overlay.querySelector("#edApplyInvert").addEventListener("click", function (e) {
      e.preventDefault();
      overlay.querySelectorAll(".ed-apply-check").forEach(function (c) { c.checked = !c.checked; });
    });
    overlay.querySelector("#edApplyConfirm").addEventListener("click", async function () {
      var checked = [];
      overlay.querySelectorAll(".ed-apply-check:checked").forEach(function (c) {
        checked.push({ file: c.dataset.file });
      });
      if (!checked.length) { LE.toast("请选择目标线路", "warn"); return; }
      var strategy = overlay.querySelector("input[name='edApplyStrategy']:checked").value;
      var applyConfig = { strategy: strategy, scope: scope, fieldKey: fieldKey };
      overlay.querySelector("#edApplyConfirm").disabled = true;
      overlay.querySelector("#edApplyConfirm").textContent = "应用中...";
      try {
        var results = await LE.applyToOtherLines(checked, applyConfig);
        overlay.remove();
        LE.toast("成功应用至 " + results.success.length + " 条线路" +
          (results.failed.length ? "，" + results.failed.length + " 条失败" : ""), "success");
      } catch (e) {
        overlay.remove();
        LE.toast("应用失败：" + e.message, "error");
      }
    });
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) overlay.remove(); });
  };

  /* ── Copy / Move Line Dialogs ── */
  function showCopyMoveDialog(mode, sourceFile, sourceName, currentCompany) {
    var title = mode === "copy" ? "复制线路到…" : "移动线路到…";
    var defaultNewName = mode === "copy" ? sourceName + "-副本" : sourceName;
    var allCompanies = (LE.mainState && LE.mainState.newIndex && LE.mainState.newIndex.companies) || [];
    if (!allCompanies.length && currentCompany) allCompanies = [{ name: currentCompany, lines: [] }];
    var companyOpts = allCompanies.map(function (c) {
      var sel = c.name === currentCompany ? " selected" : "";
      return '<option value="' + LE.escHtml(c.name) + '"' + sel + '>' + LE.escHtml(c.name) + '</option>';
    }).join("");

    var overlay = document.createElement("div");
    overlay.className = "ed-modal-overlay";
    overlay.innerHTML = '<div class="ed-modal" style="width:540px">' +
      '<div class="ed-modal-header"><h3>' + title + '</h3>' + modalCloseButton() + '</div>' +
      '<div class="ed-modal-body">' +
      (mode === "move" ? '<div style="background:#e5edf6;border:1px solid #d8e3f1;border-radius:6px;padding:10px 12px;margin-bottom:12px;color:#69778d;font-size:12px">如果您要调整线路排序，请移动完成后到线路列表拖拽排序。</div>' : '') +
      '<div style="margin-bottom:8px"><strong>目标公司：</strong> <select id="cmCompany" style="padding:6px 8px;background:#ffffff;border:1px solid #d8e3f1;border-radius:4px;color:#20355c">' + companyOpts + '</select></div>' +
      '<div style="margin-bottom:4px;font-size:12px;color:#69778d">此公司下的线路：</div>' +
      '<div id="cmLineList" style="max-height:160px;overflow-y:auto;margin-bottom:10px"><div class="ed-empty">加载中...</div></div>' +
      '<div style="margin-bottom:8px"><strong>新名称：</strong> <input id="cmNewName" style="width:100%;padding:8px 10px;background:#ffffff;border:1px solid #d8e3f1;border-radius:4px;color:#17345f;font-size:13px;box-sizing:border-box" value="' + LE.escHtml(defaultNewName) + '"></div>' +
      '</div>' +
      '<div class="ed-modal-footer">' +
      '<button class="ed-btn ed-btn-ghost" id="cmCancel">取消</button>' +
      '<button class="ed-btn ed-btn-primary" id="cmConfirm">确认</button></div></div>';

    $("lineEditorSidebar").appendChild(overlay);

    function loadLines() {
      var targetCompany = overlay.querySelector("#cmCompany").value;
      var comp = allCompanies.find(function (c) { return c.name === targetCompany; });
      var lines = (comp && comp.lines) ? comp.lines.slice() : [];
      if (!lines.length) {
        // Fallback: try directory listing to get file names only
        LE.api.listDir(targetCompany, true).then(function (resp) {
          var items = (resp.items || []).filter(function (i) { return i.name.endsWith(".ini"); });
          lines = items.map(function (i) { return { name: i.name.replace(/\.ini$/i, ""), file: targetCompany + "/" + i.name }; });
          renderLines(lines);
        }).catch(function () {
          overlay.querySelector("#cmLineList").innerHTML = '<div class="ed-empty">加载失败</div>';
        });
      } else {
        renderLines(lines);
      }
    }

    function renderLines(lines) {
      var listEl = overlay.querySelector("#cmLineList");
      if (!lines.length) { listEl.innerHTML = '<div class="ed-empty">该公司暂无线路</div>'; return; }
      // Read file mtime from items if available (from listDir), otherwise show —
      var html = '<table class="ed-apply-table"><thead><tr><th>名称</th></tr></thead><tbody>';
      lines.forEach(function (l) {
        var name = l.name || (l.file || "").split("/").pop().replace(/\.ini$/i, "");
        html += '<tr><td>' + LE.escHtml(name) + '</td></tr>';
      });
      html += '</tbody></table>';
      listEl.innerHTML = html;
    }

    loadLines();

    overlay.querySelector("#cmCompany").addEventListener("change", loadLines);
    overlay.querySelector(".ed-modal-close").onclick = function () { overlay.remove(); };
    overlay.querySelector("#cmCancel").onclick = function () { overlay.remove(); };
    overlay.querySelector("#cmConfirm").addEventListener("click", async function () {
      var targetCompany = overlay.querySelector("#cmCompany").value;
      var newName = overlay.querySelector("#cmNewName").value.trim();
      if (!newName) { LE.toast("请输入新名称", "warn"); return; }
      var newFileName = newName;
      if (!/\.ini$/i.test(newFileName)) newFileName += ".ini";
      var newRelPath = targetCompany + "/" + newFileName;

      // Validate: no-op move
      if (mode === "move" && newRelPath === sourceFile) {
        LE.toast("未选择新位置", "error"); return;
      }
      // Validate: same file path for copy
      if (mode === "copy" && newRelPath === sourceFile) {
        LE.toast("复制目标和源位置相同", "error"); return;
      }

      overlay.querySelector("#cmConfirm").disabled = true;
      overlay.querySelector("#cmConfirm").textContent = "处理中...";

      try {
        var resp = await LE.api.readFile(sourceFile);
        var srcModel = LE.parseIni(resp.content);
        srcModel.lineName = newName;

        if (mode === "move") {
          await LE.api.deleteFile(sourceFile);
        }
        var content = LE.serializeIni(srcModel);
        await LE.api.writeFile(newRelPath, content);
        // Update index in-memory + persist (add at end, remove old if move)
        if (LE.mainState && LE.mainState.newIndex) {
          var idx3 = LE.mainState.newIndex;
          // Remove from source if move
          if (mode === "move") {
            var srcComp = idx3.companies.find(function (c) { return c.name === (sourceFile.split("/")[0]); });
            if (srcComp) srcComp.lines = (srcComp.lines || []).filter(function (l) { return l.file !== sourceFile; });
          }
          // Add to target company at end
          var tgtComp = idx3.companies.find(function (c) { return c.name === targetCompany; });
          if (!tgtComp) { tgtComp = { name: targetCompany, lines: [] }; idx3.companies.push(tgtComp); }
          tgtComp.lines = (tgtComp.lines || []).filter(function (l) { return l.file !== newRelPath; });
          tgtComp.lines.push({ name: newName, file: newRelPath });
          await LE.api.writeFile("index.json", JSON.stringify(idx3, null, 4));
        }
        if (LE.mainCallbacks && LE.mainCallbacks.refreshIndex) await LE.mainCallbacks.refreshIndex();
        overlay.remove();
        LE.renderL1();
        LE.toast((mode === "copy" ? "已复制" : "已移动") + "至：" + targetCompany + "/" + newFileName, "success");
      } catch (e) {
        overlay.remove();
        LE.toast("操作失败：" + (e.message || "未知错误"), "error");
      }
    });
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) overlay.remove(); });
  }

  LE.showCopyLineDialog = function (sourceFile, sourceName, currentCompany) {
    showCopyMoveDialog("copy", sourceFile, sourceName, currentCompany);
  };

  LE.showMoveLineDialog = function (sourceFile, sourceName, currentCompany) {
    showCopyMoveDialog("move", sourceFile, sourceName, currentCompany);
  };

  LE.showRenameLineDialog = function (sourceFile, sourceName, currentCompany) {
    showPromptModal("重命名线路文件", "请输入新的线路文件名称（不含 .ini）", sourceName, function (newName) {
      if (!newName || newName === sourceName) return;
      var newFileName = newName;
      if (!/\.ini$/i.test(newFileName)) newFileName += ".ini";
      var newRelPath = currentCompany + "/" + newFileName;
      if (newRelPath.replace(/\\/g, "/").toLowerCase() === sourceFile.replace(/\\/g, "/").toLowerCase()) {
        LE.toast("新名称与原名称相同", "warn"); return;
      }

      // Safe rename: write new, verify, update index, update UI, then delete old
      LE.api.readFile(sourceFile).then(async function (resp) {
        await LE.api.writeFile(newRelPath, resp.content);
        // Verify
        try { await LE.api.readFile(newRelPath); } catch (ve) {
          LE.toast("新文件写入失败，操作取消", "error"); return;
        }
        // Update index — preserve position
        if (LE.mainState && LE.mainState.newIndex) {
          var idx4 = LE.mainState.newIndex;
          var comp = idx4.companies.find(function (c) { return c.name === currentCompany; });
          if (comp && comp.lines) {
            var oldIdx = -1;
            for (var li = 0; li < comp.lines.length; li++) {
              if (comp.lines[li].file === sourceFile) { oldIdx = li; break; }
            }
            comp.lines = comp.lines.filter(function (l) { return l.file !== sourceFile; });
            var entry = { name: newName, file: newRelPath };
            if (oldIdx >= 0 && oldIdx < comp.lines.length) {
              comp.lines.splice(oldIdx, 0, entry);
            } else {
              comp.lines.push(entry);
            }
            await LE.api.writeFile("index.json", JSON.stringify(idx4, null, 4));
          }
        }
        // Update editor state if current file is the renamed one
        if (LE.state.currentLineRelPath === sourceFile) {
          LE.state.currentLineRelPath = newRelPath;
          LE.state.currentLineName = LE.state.editModel ? LE.state.editModel.lineName : newName;
        }
        // Refresh
        if (LE.mainCallbacks && LE.mainCallbacks.refreshIndex) await LE.mainCallbacks.refreshIndex();
        LE.renderL1();
        // Delete old
        await LE.api.deleteFile(sourceFile);
        LE.toast("已重命名：" + sourceName + " ➜ " + newName, "success");
      }).catch(function (e) {
        LE.toast("重命名失败：" + (e.message || "未知错误"), "error");
      });
    });
  };

  /* ── Export / Import ── */
  LE.exportLine = function (relPath, lineName) {
    var company = relPath.split("/")[0];
    LE.toast("正在导出...", "info");
    fetch("/api/file/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "line", relPaths: [relPath], company: company }),
    }).then(function (resp) {
      if (!resp.ok) throw new Error("导出失败");
      return resp.blob();
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = (lineName || "line") + ".tabl";
      a.click();
      URL.revokeObjectURL(url);
      LE.toast("导出成功", "success");
    }).catch(function (e) {
      LE.toast("导出失败：" + e.message, "error");
    });
  };

  LE.importZip = function (presetCompany, forceNewCompany) {
    var company = forceNewCompany ? "" : (presetCompany || LE.state.currentCompany || "");
    var fi = document.createElement("input");
    fi.type = "file";
    fi.accept = ".tabl";
    fi.onchange = function () {
      if (!fi.files.length) return;
      var origFileName = fi.files[0].name;
      var previewCompany = company || "";
      var fd = new FormData();
      fd.append("file", fi.files[0]);
      fd.append("company", previewCompany);
      LE.toast("正在分析...", "info");
      fetch("/api/file/import", { method: "POST", body: fd })
        .then(function (r) { return r.json(); })
        .then(function (rsp) {
          if (!rsp.ok) { LE.toast("导入失败：" + (rsp.error || "未知"), "error"); return; }
          showImportPreviewDialog(rsp, company, !presetCompany && !company, origFileName);
        }).catch(function (e) {
          LE.toast("导入失败：" + e.message, "error");
        });
    };
    fi.click();
  };

  function showImportPreviewDialog(preview, defaultCompany, allowPickCompany, origFileName) {
    var sessionId = preview.sessionId;
    var lines = preview.lines || [];
    var conflicts = preview.conflicts || [];
    var mediaCount = preview.mediaCount || 0;
    var hasConflicts = conflicts.length > 0;
    var isCompanyImport = preview.iniCount > 1;

    var linesHtml = "";
    lines.forEach(function (l) {
      var marker = l.exists ? ' <span style="color:#eab308">(冲突)</span>' : ' <span style="color:#1468df">(新)</span>';
      linesHtml += '<tr><td>' + LE.escHtml(l.name) + marker + '</td></tr>';
    });

    var companyOptsHtml = "";
    if (allowPickCompany || isCompanyImport) {
      var companies = (LE.mainState && LE.mainState.newIndex && LE.mainState.newIndex.companies || []).map(function (c) { return c.name; });
      companyOptsHtml = '<div style="margin-bottom:8px"><strong>导入到公司：</strong> <select id="edImpTargetCompany" style="padding:6px 8px;background:#ffffff;border:1px solid #d8e3f1;border-radius:4px;color:#20355c">' +
        '<option value="__new__">+ 新建公司（从导入包创建）</option>';
      companies.forEach(function (c) {
        var sel = c === defaultCompany ? " selected" : "";
        companyOptsHtml += '<option value="' + LE.escHtml(c) + '"' + sel + '>' + LE.escHtml(c) + '</option>';
      });
      companyOptsHtml += '</select></div>';
    }

    var msg = '将导入 <strong>' + lines.length + '</strong> 个线路、<strong>' + mediaCount + '</strong> 个音频文件。';
    if (hasConflicts) msg += '<br><span style="color:#eab308">⚠ ' + conflicts.length + ' 个线路与本地冲突。</span>';

    var overlay = document.createElement("div");
    overlay.className = "ed-modal-overlay";
    overlay.innerHTML = '<div class="ed-modal" style="width:520px">' +
      '<div class="ed-modal-header"><h3>导入预览</h3>' + modalCloseButton() + '</div>' +
      '<div class="ed-modal-body">' +
      companyOptsHtml +
      '<p style="margin:0 0 8px;color:#20355c">' + msg + '</p>' +
      '<div style="max-height:180px;overflow-y:auto;margin-bottom:8px"><table class="ed-apply-table"><thead><tr><th>线路名称</th></tr></thead><tbody>' + linesHtml + '</tbody></table></div>' +
      (hasConflicts ? '<div style="margin-top:8px"><strong>冲突处理：</strong></div><div style="display:flex;gap:16px;margin-top:4px">' +
        '<label class="ed-radio"><input type="radio" name="edImpConflict" value="skip" checked> 跳过</label>' +
        '<label class="ed-radio"><input type="radio" name="edImpConflict" value="overwrite"> 覆盖</label></div>' : '') +
      '</div>' +
      '<div class="ed-modal-footer">' +
      '<button class="ed-btn ed-btn-ghost" id="edImpCancel">取消</button>' +
      '<button class="ed-btn ed-btn-primary" id="edImpConfirm">确认导入</button></div></div>';

    $("lineEditorSidebar").appendChild(overlay);

    overlay.querySelector(".ed-modal-close").onclick = function () { overlay.remove(); };
    overlay.querySelector("#edImpCancel").onclick = function () { overlay.remove(); };
    function doConfirm(targetCompany) {
      var conflictMode = hasConflicts ? overlay.querySelector("input[name='edImpConflict']:checked").value : "skip";
      overlay.querySelector("#edImpConfirm").disabled = true;
      overlay.querySelector("#edImpConfirm").textContent = "导入中...";

      fetch("/api/file/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId, company: targetCompany, conflictMode: conflictMode }),
      }).then(function (r) { return r.json(); })
        .then(async function (rsp) {
          overlay.remove();
          if (rsp.ok) {
            LE.toast("已导入 " + (rsp.imported || []).length + " 个线路", "success");
            if (LE.mainCallbacks && LE.mainCallbacks.refreshIndex) await LE.mainCallbacks.refreshIndex();
            if (LE.state.view && LE.state.view.startsWith("L1:")) LE.renderL1(); else LE.renderL0();
          } else {
            LE.toast("导入失败：" + (rsp.error || "未知错误"), "error");
          }
        }).catch(function (e) {
          overlay.remove();
          LE.toast("导入失败：" + e.message, "error");
        });
    }

    overlay.querySelector("#edImpConfirm").onclick = function () {
      var targetCompany = defaultCompany;
      var targetSelect = overlay.querySelector("#edImpTargetCompany");
      if (targetSelect) targetCompany = targetSelect.value;
      if (targetCompany === "__new__") {
        var defaultName = origFileName ? origFileName.replace(/\.(zip|tabl)$/i, "") : "";
        showPromptModal("新建公司", "请输入新公司名称", defaultName, function (newName) {
          if (!newName) return;
          doConfirm(newName);
        });
      } else if (!targetCompany) {
        LE.toast("请先选择目标公司", "warn");
      } else {
        doConfirm(targetCompany);
      }
    };
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) overlay.remove(); });
  }
  // Expose for external callers (file association double-click)
  LE._showImportPreviewDialog = showImportPreviewDialog;

  /* ── Media Browser Panel ── */
  function buildMediaPanelHTML() {
    return '<div style="margin-bottom:8px;display:flex;gap:8px">' +
      '<input id="edMediaSearch" class="ed-form-input" placeholder="搜索文件名..." style="flex:1">' +
      '<button class="ed-btn ed-btn-ghost" id="edMediaRefresh"><svg class="ui-icon"><use href="#icon-refresh"></use></svg>刷新</button>' +
      '<button class="ed-btn ed-btn-ghost" id="edMediaOpenFolder"><svg class="ui-icon"><use href="#icon-folder"></use></svg>在系统中打开</button></div>' +
      '<div id="edMediaDropZone" class="ed-media-drop-zone">' +
        '<span class="ed-media-drop-icon">+</span>' +
        '<span>拖放音频文件到此处上传，或点击选择文件</span>' +
      '</div>' +
      '<div id="edMediaFloatBar" class="ed-media-float-bar">' +
        '<button id="edMediaSelAll">全选</button>' +
        '<button id="edMediaDeselAll">取消全选</button>' +
        '<button id="edMediaInvSel">反向选择</button>' +
        '<span class="ed-media-float-sep"></span>' +
        '<button id="edMediaBatchCopy">批量复制</button>' +
        '<button id="edMediaBatchMove">批量移动</button>' +
        '<button id="edMediaBatchDownload">批量下载</button>' +
        '<button id="edMediaBatchDel" class="ed-media-float-danger">批量删除</button>' +
      '</div>' +
      '<div id="edMediaTableContainer"><div class="ed-empty">加载中...</div></div>';
  }

  function bindMediaBrowser(root, company) {
    if (!LE.state._mediaSort) LE.state._mediaSort = { key: "name", dir: "asc" };
    var sortState = LE.state._mediaSort;

    var sortKeys = ["name", "size", "type", "mtime"];
    var sortLabels = { name: "名称", size: "大小", type: "类型", mtime: "修改时间" };

    function makeSortArrow(key) {
      if (sortState.key !== key) return ' <span class="ed-sort-arrow">↕</span>';
      return sortState.dir === "asc" ? ' <span class="ed-sort-arrow ed-sort-active">▲</span>' : ' <span class="ed-sort-arrow ed-sort-active">▼</span>';
    }

    function updateFloatBar() {
      var checked = root.querySelectorAll(".ed-media-check:checked");
      var floatBar = root.querySelector("#edMediaFloatBar");
      if (checked.length > 0) {
        floatBar.classList.add("visible");
      } else {
        floatBar.classList.remove("visible");
      }
      // Update thead sticky offset based on float bar visibility
      var thead = root.querySelector(".ed-media-table thead");
      if (thead) {
        if (floatBar.classList.contains("visible")) {
          thead.classList.add("sticky-offset");
        } else {
          thead.classList.remove("sticky-offset");
        }
      }
      var all = root.querySelectorAll(".ed-media-check");
      var selAll = root.querySelector("#edMediaSelectAll");
      if (selAll) {
        selAll.checked = all.length > 0 && checked.length === all.length;
        selAll.indeterminate = checked.length > 0 && checked.length < all.length;
      }
    }

    function getCheckedFiles() {
      var files = [];
      root.querySelectorAll(".ed-media-check:checked").forEach(function (cb) {
        files.push(cb.dataset.file);
      });
      return files;
    }

    function downloadMedia(files) {
      if (!files.length) { LE.toast("请先选择文件", "warn"); return; }
      fetch("/api/file/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relPaths: files.map(function (file) { return company + "/" + file; }) }),
      }).then(function (resp) {
        if (!resp.ok) throw new Error("下载失败");
        return resp.blob();
      }).then(function (blob) {
        var a = document.createElement("a");
        var url = URL.createObjectURL(blob);
        a.href = url;
        a.download = files.length === 1 ? files[0] : "音频文件.zip";
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 0);
      }).catch(function (e) { LE.toast("下载失败：" + e.message, "error"); });
    }

    function batchUploadFiles(files, onDone) {
      var total = files.length;
      var done = 0;
      var dropZone = root.querySelector("#edMediaDropZone");
      function upOne(i) {
        if (i >= total) {
          dropZone.innerHTML = '<span class="ed-media-drop-icon">+</span><span>拖放音频文件到此处上传，或点击选择文件</span>';
          if (done) LE.toast("上传完成 " + done + " 个文件", "success");
          if (onDone) onDone();
          return;
        }
        var fd = new FormData();
        fd.append("file", files[i]);
        fd.append("relPath", company);
        dropZone.innerHTML = '<span>上传中... ' + done + '/' + total + '</span>';
        fetch("/api/file/upload", { method: "POST", body: fd })
          .then(function (r) { return r.json(); })
          .then(function (rsp) { if (rsp.ok) done++; upOne(i + 1); })
          .catch(function () { upOne(i + 1); });
      }
      upOne(0);
    }

    function loadMedia() {
      LE.api.listDir(company, true).then(function (resp) {
        var items = (resp.items || []).filter(function (item) { return !item.isDir && !/\.ini$/i.test(item.name || ""); });
        var q = (root.querySelector("#edMediaSearch").value || "").toLowerCase();
        if (q) items = items.filter(function (i) { return i.name.toLowerCase().indexOf(q) >= 0; });

        // Sort
        items.sort(function (a, b) {
          var va, vb;
          if (sortState.key === "name") { va = a.name; vb = b.name; }
          else if (sortState.key === "size") { va = a.size || 0; vb = b.size || 0; }
          else if (sortState.key === "type") { va = (a.name || "").split(".").pop().toLowerCase(); vb = (b.name || "").split(".").pop().toLowerCase(); }
          else if (sortState.key === "mtime") { va = a.mtime || 0; vb = b.mtime || 0; }
          if (typeof va === "string") return sortState.dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
          return sortState.dir === "asc" ? va - vb : vb - va;
        });

        var html = '<table class="ed-media-table"><thead><tr>';
        html += '<th style="width:32px"><input type="checkbox" id="edMediaSelectAll" title="全选/取消全选"></th>';
        sortKeys.forEach(function (k) {
          html += '<th class="ed-media-th-sort" data-sort="' + k + '">' + sortLabels[k] + makeSortArrow(k) + '</th>';
        });
        html += '<th>操作</th></tr></thead><tbody>';
        items.forEach(function (item) {
          var sizeStr = item.size ? (item.size < 1024 ? item.size + "B" :
            item.size < 1048576 ? (item.size / 1024).toFixed(1) + "KB" : (item.size / 1048576).toFixed(1) + "MB") : "";
          var mtimeStr = item.mtime ? new Date(item.mtime * 1000).toLocaleString("zh-CN") : "";
          var ext = (item.name || "").split(".").pop().toLowerCase();
          html += '<tr data-row-file="' + LE.escHtml(item.name) + '">' +
            '<td><input type="checkbox" class="ed-media-check" data-file="' + LE.escHtml(item.name) + '"></td>' +
            '<td>' + LE.escHtml(item.name) + '</td>' +
            '<td style="font-size:11px;color:#69778d">' + sizeStr + '</td>' +
            '<td style="font-size:11px;color:#69778d">' + ext.toUpperCase() + '</td>' +
            '<td style="font-size:11px;color:#69778d">' + mtimeStr + '</td>' +
            '<td class="ed-media-actions">' +
              '<button type="button" class="ed-media-copy" title="复制到" aria-label="复制到" data-file="' + LE.escHtml(item.name) + '"><svg class="ui-icon"><use href="#icon-copy"></use></svg></button>' +
              '<button type="button" class="ed-media-move" title="移动到" aria-label="移动到" data-file="' + LE.escHtml(item.name) + '"><svg class="ui-icon"><use href="#icon-move"></use></svg></button>' +
              '<button type="button" class="ed-media-download" title="导出" aria-label="导出" data-file="' + LE.escHtml(item.name) + '"><svg class="ui-icon"><use href="#icon-download"></use></svg></button>' +
              '<button type="button" class="ed-media-del" title="删除" aria-label="删除" data-file="' + LE.escHtml(item.name) + '"><svg class="ui-icon"><use href="#icon-trash"></use></svg></button>' +
            '</td></tr>';
        });
        html += '</tbody></table>';
        root.querySelector("#edMediaTableContainer").innerHTML = html;

        // Initialize sticky thead offset
        updateFloatBar();

        // Select-all checkbox
        var selAllCb = root.querySelector("#edMediaSelectAll");
        if (selAllCb) {
          selAllCb.addEventListener("change", function () {
            root.querySelectorAll(".ed-media-check").forEach(function (cb) { cb.checked = selAllCb.checked; });
            updateFloatBar();
          });
        }

        // Per-row checkboxes
        root.querySelectorAll(".ed-media-check").forEach(function (cb) {
          cb.addEventListener("change", updateFloatBar);
        });

        // Sort header clicks
        root.querySelectorAll(".ed-media-th-sort").forEach(function (th) {
          th.addEventListener("click", function () {
            var k = th.dataset.sort;
            if (sortState.key === k) sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
            else { sortState.key = k; sortState.dir = "asc"; }
            loadMedia();
          });
        });

        // Delete buttons
        root.querySelectorAll(".ed-media-del").forEach(function (del) {
          del.addEventListener("click", function () {
            showConfirmModal("删除文件", "确认删除：" + del.dataset.file + "？", function (ok) {
              if (!ok) return;
              LE.api.deleteFile(company + "/" + del.dataset.file).then(function () {
                LE.toast("已删除", "success");
                loadMedia();
              }).catch(function (e) { LE.toast("删除失败：" + e.message, "error"); });
            }, true);
          });
        });

        // Copy buttons
        root.querySelectorAll(".ed-media-copy").forEach(function (btn) {
          btn.addEventListener("click", function () {
            showMediaCopyMoveDialog("copy", company + "/" + btn.dataset.file, btn.dataset.file, company, function () { loadMedia(); });
          });
        });

        // Move buttons
        root.querySelectorAll(".ed-media-move").forEach(function (btn) {
          btn.addEventListener("click", function () {
            showMediaCopyMoveDialog("move", company + "/" + btn.dataset.file, btn.dataset.file, company, function () { loadMedia(); });
          });
        });
        root.querySelectorAll(".ed-media-download").forEach(function (btn) {
          btn.addEventListener("click", function () { downloadMedia([btn.dataset.file]); });
        });

        updateFloatBar();
      }).catch(function () {
        root.querySelector("#edMediaTableContainer").innerHTML = '<div class="ed-empty">加载失败</div>';
      });
    }

    loadMedia();

    // Search
    root.querySelector("#edMediaSearch").addEventListener("input", loadMedia);
    root.querySelector("#edMediaRefresh").addEventListener("click", loadMedia);

    // Open in system
    root.querySelector("#edMediaOpenFolder").addEventListener("click", function () {
      LE.api.openFolder(company).then(function () {
        LE.toast("已在系统中打开", "success");
      }).catch(function (e) {
        LE.toast("无法打开文件夹：" + e.message, "error");
      });
    });

    // Upload button removed — drop zone now handles click-to-upload
    // Drop zone click: open file picker (same as old upload button)
    var dropZone = root.querySelector("#edMediaDropZone");
    dropZone.addEventListener("click", function (e) {
      // Don't trigger if user was dragging (they'd use the drop event instead)
      var fi = document.createElement("input");
      fi.type = "file";
      fi.accept = ".wav,.mp3,.m4a";
      fi.multiple = true;
      fi.onchange = function () {
        if (!fi.files.length) return;
        batchUploadFiles(Array.from(fi.files), function () { loadMedia(); });
      };
      fi.click();
    });

    // Drag-drop zone
    ['dragenter', 'dragover'].forEach(function (evt) {
      dropZone.addEventListener(evt, function (e) {
        e.preventDefault(); e.stopPropagation();
        dropZone.classList.add("ed-media-drop-active");
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      dropZone.addEventListener(evt, function (e) {
        e.preventDefault(); e.stopPropagation();
        dropZone.classList.remove("ed-media-drop-active");
      });
    });
    dropZone.addEventListener("drop", function (e) {
      var files = e.dataTransfer.files;
      if (!files.length) return;
      batchUploadFiles(Array.from(files), function () { loadMedia(); });
    });

    // Float toolbar buttons
    root.querySelector("#edMediaSelAll").addEventListener("click", function () {
      root.querySelectorAll(".ed-media-check").forEach(function (cb) { cb.checked = true; });
      updateFloatBar();
    });
    root.querySelector("#edMediaDeselAll").addEventListener("click", function () {
      root.querySelectorAll(".ed-media-check").forEach(function (cb) { cb.checked = false; });
      updateFloatBar();
    });
    root.querySelector("#edMediaInvSel").addEventListener("click", function () {
      root.querySelectorAll(".ed-media-check").forEach(function (cb) { cb.checked = !cb.checked; });
      updateFloatBar();
    });
    root.querySelector("#edMediaBatchCopy").addEventListener("click", function () {
      var files = getCheckedFiles();
      if (!files.length) { LE.toast("请先选择文件", "warn"); return; }
      showMediaCopyMoveDialog("copy", files.map(function (f) { return company + "/" + f; }), files[0], company, function () { loadMedia(); }, true);
    });
    root.querySelector("#edMediaBatchMove").addEventListener("click", function () {
      var files = getCheckedFiles();
      if (!files.length) { LE.toast("请先选择文件", "warn"); return; }
      showMediaCopyMoveDialog("move", files.map(function (f) { return company + "/" + f; }), files[0], company, function () { loadMedia(); }, true);
    });
    root.querySelector("#edMediaBatchDownload").addEventListener("click", function () { downloadMedia(getCheckedFiles()); });
    root.querySelector("#edMediaBatchDel").addEventListener("click", function () {
      var files = getCheckedFiles();
      if (!files.length) { LE.toast("请先选择文件", "warn"); return; }
      showConfirmModal("批量删除", "确认删除 " + files.length + " 个文件？", function (ok) {
        if (!ok) return;
        var done = 0;
        function delOne(i) {
          if (i >= files.length) { LE.toast("已删除 " + done + " 个文件", "success"); loadMedia(); return; }
          LE.api.deleteFile(company + "/" + files[i]).then(function () { done++; delOne(i + 1); }).catch(function () { delOne(i + 1); });
        }
        delOne(0);
      }, true);
    });
  }

  /* ── L2: Audio Folder (Media Browser) Sub-Page ── */
  LE.renderL2Media = function (container) {
    var company = (LE.state.currentLineRelPath || "").split("/")[0] || LE.state.currentCompany;
    var html = "";
    html += '<div class="ed-media-banner"><strong>请注意：</strong>全公司共享同一个音频文件夹。<br>因此你在这里添加/更改的文件，在同公司的其他线路内也会一起生效。</div>';
    html += '<h4 class="ed-media-panel-title">音频文件夹 — ' + LE.escHtml(company) + '</h4>';
    html += buildMediaPanelHTML();
    container.innerHTML = html;
    bindMediaBrowser(container, company);
  };

  /* ── Media Browser Dialog ── */
  LE.showMediaBrowser = function (company) {
    var overlay = document.createElement("div");
    overlay.className = "ed-modal-overlay";
    overlay.innerHTML = '<div class="ed-modal" style="width:700px;max-height:88vh">' +
      '<div class="ed-modal-header"><h3>音频文件夹 — ' + LE.escHtml(company) + '</h3>' + modalCloseButton() + '</div>' +
      '<div class="ed-modal-body" id="edMediaBody">' + buildMediaPanelHTML() + '</div></div>';
    $("lineEditorSidebar").appendChild(overlay);
    overlay.querySelector(".ed-modal-close").onclick = function () { overlay.remove(); };
    bindMediaBrowser(overlay, company);
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) overlay.remove(); });
  };

  /* ── Media Copy/Move Target Picker ── */
  function showMediaCopyMoveDialog(mode, sourcePaths, sampleFile, sourceCompany, onDone, isBatch) {
    // sourcePaths: string (single) or array (batch)
    var paths = Array.isArray(sourcePaths) ? sourcePaths : [sourcePaths];
    var allCompanies = (LE.mainState && LE.mainState.newIndex && LE.mainState.newIndex.companies) || [];

    var overlay = document.createElement("div");
    overlay.className = "ed-modal-overlay";
    var title = (mode === "copy" ? "复制" : "移动") + (isBatch ? " " + paths.length + " 个文件到..." : " 文件到...");
    var companyOpts = allCompanies.map(function (c) {
      var sel = c.name === sourceCompany ? "" : (c.name === (LE.state.currentCompany || "") ? " selected" : "");
      return '<option value="' + LE.escHtml(c.name) + '"' + sel + '>' + LE.escHtml(c.name) + ' (' + (c.lines ? c.lines.length : 0) + ' 条线路)</option>';
    }).join("");

    overlay.innerHTML = '<div class="ed-modal" style="width:450px">' +
      '<div class="ed-modal-header"><h3>' + title + '</h3>' + modalCloseButton() + '</div>' +
      '<div class="ed-modal-body">' +
      '<p style="margin:0 0 8px;color:#69778d;font-size:12px">' + LE.escHtml(paths[0].split("/").pop()) + (paths.length > 1 ? ' 等' + paths.length + '个文件' : '') + '</p>' +
      '<div style="margin-bottom:8px"><strong>目标公司：</strong></div>' +
      '<select id="edCmTargetCompany" style="width:100%;padding:8px;background:#ffffff;border:1px solid #d8e3f1;border-radius:6px;color:#20355c;font-size:13px">' + companyOpts + '</select>' +
      '</div>' +
      '<div class="ed-modal-footer">' +
      '<button class="ed-btn ed-btn-ghost" id="edCmCancel">取消</button>' +
      '<button class="ed-btn ed-btn-primary" id="edCmConfirm">确认' + (mode === "copy" ? "复制" : "移动") + '</button></div></div>';

    $("lineEditorSidebar").appendChild(overlay);

    overlay.querySelector(".ed-modal-close").onclick = function () { overlay.remove(); };
    overlay.querySelector("#edCmCancel").onclick = function () { overlay.remove(); };
    overlay.querySelector("#edCmConfirm").addEventListener("click", function () {
      var targetCompany = overlay.querySelector("#edCmTargetCompany").value;
      if (!targetCompany) { LE.toast("请选择目标公司", "warn"); return; }
      overlay.querySelector("#edCmConfirm").disabled = true;
      overlay.querySelector("#edCmConfirm").textContent = "处理中...";

      var done = 0;
      function processOne(i) {
        if (i >= paths.length) {
          overlay.remove();
          var verb = mode === "copy" ? "已复制" : "已移动";
          LE.toast(verb + " " + done + " 个文件到 " + targetCompany, "success");
          if (onDone) onDone();
          return;
        }
        var srcRel = paths[i];
        var fname = srcRel.split("/").pop();
        var dstRel = targetCompany + "/" + fname;
        LE.api.copyFile(srcRel, dstRel).then(function () {
          if (mode === "move") {
            return LE.api.deleteFile(srcRel).then(function () { done++; processOne(i + 1); });
          } else {
            done++; processOne(i + 1);
          }
        }).catch(function (e) {
          console.error("[media-copy-move] Error:", e.message);
          LE.toast("操作 " + fname + " 失败：" + e.message, "error");
          processOne(i + 1);
        });
      }
      processOne(0);
    });
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) overlay.remove(); });
  }

  /* ── L2 Text Page ── */
  LE.renderL2Text = function () {
    // Already handled in openTextEditor
  };

  /* ── Init on load ── */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { LE.initSidebar(); });
  } else {
    LE.initSidebar();
  }

})();
