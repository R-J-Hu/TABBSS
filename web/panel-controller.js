(function () {
  var appRoot = document.getElementById("appRoot");
  var ids = {
    editor: "lineEditorToggle",
    settings: "aboutNavBtn",
    developer: "devPanelToggle"
  };
  function el(id) { return document.getElementById(id); }
  function activePanel() {
    var visualEditor = el("lineEditorSidebar");
    var textEditor = el("fileSidebar");
    var about = el("aboutPanel");
    var dev = el("devPanelSidebar");
    if ((visualEditor && visualEditor.classList.contains("open")) || (textEditor && textEditor.classList.contains("open"))) return "editor";
    if (about && !about.hidden) return "settings";
    if (dev && dev.classList.contains("panel-open")) return "developer";
    return "player";
  }
  function setActive(key) {
    document.querySelectorAll(".rail-nav-item").forEach(function (item) { item.classList.toggle("active", item.id === ids[key]); });
  }
  function closeAll() {
    ["fileSidebar", "lineEditorSidebar"].forEach(function (id) { var node = el(id); if (node) node.classList.remove("open"); });
    var about = el("aboutPanel"); if (about) about.hidden = true;
    var dev = el("devPanelSidebar"); if (dev) { dev.classList.remove("panel-open"); dev.style.transform = "translateX(calc(100% + var(--player-rail-width)))"; }
    if (appRoot) appRoot.classList.remove("with-dock", "with-dock-v2");
    if (window.LineEditor && typeof window.LineEditor._updateSwitchBtn === "function") window.LineEditor._updateSwitchBtn();
  }
  function openPanel(key) {
    // Clicking the active panel's nav button closes it (back to the player).
    if (activePanel() === key) {
      closeAll();
      setActive(activePanel());
      return;
    }
    closeAll();
    if (key === "editor") {
      var editor = el("lineEditorSidebar");
      if (editor) editor.classList.add("open");
      if (appRoot) appRoot.classList.add("with-dock-v2");
      if (window.LineEditor) {
        if (typeof window.LineEditor.showPage === "function") window.LineEditor.showPage(window.LineEditor.state.view || "L0");
        if (typeof window.LineEditor._updateSwitchBtn === "function") window.LineEditor._updateSwitchBtn();
      }
    } else if (key === "settings") {
      var about = el("aboutPanel"); if (about) about.hidden = false;
    } else if (key === "developer") {
      var dev = el("devPanelSidebar");
      if (dev) { dev.classList.add("panel-open"); dev.style.transform = "translateX(0)"; }
      if (typeof renderDevToggles === "function") renderDevToggles();
    }
    setActive(key);
  }
  function interceptOpen(event, key) {
    event.preventDefault(); event.stopImmediatePropagation(); openPanel(key);
  }
  document.documentElement.addEventListener("click", function (event) {
    var button = event.target && event.target.closest ? event.target.closest(".rail-nav-item") : null;
    if (!button) return;
    var key = Object.keys(ids).find(function (name) { return ids[name] === button.id; });
    if (key) interceptOpen(event, key);
  }, true);
  Object.keys(ids).forEach(function (key) {
    var button = el(ids[key]);
    if (button) button.addEventListener("click", function (event) { interceptOpen(event, key); }, true);
  });
  ["lineEditorCloseBtn", "aboutCloseBtn", "devPanelClose"].forEach(function (id) {
    var button = el(id);
    if (button) button.addEventListener("click", function (event) {
      event.preventDefault(); event.stopImmediatePropagation(); closeAll(); setActive(activePanel());
    }, true);
  });
  var textClose = el("editorCloseBtn");
  if (textClose) textClose.addEventListener("click", function () { window.setTimeout(function () { setActive(activePanel()); }, 0); });
  window.PlayerSidePanels = { open: openPanel, closeAll: closeAll, active: activePanel };
  setActive(activePanel());
}());
