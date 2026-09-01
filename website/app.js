const fallbackRelease = {
  version: "1.6.2",
  build: 267,
  published: "2026-08-31",
  size: "44.2 MiB",
  gitee: "https://gitee.com/rjhu/TABBSS/releases",
  github: "https://github.com/R-J-Hu/TABBSS/releases",
  releasePage: "https://gitee.com/rjhu/TABBSS/releases"
};

function applyRelease(release) {
  const versionLabel = `V${release.version} Build ${release.build}`;

  document.querySelectorAll('[data-download="gitee"]').forEach((link) => {
    link.href = release.gitee;
  });
  document.querySelectorAll('[data-download="github"]').forEach((link) => {
    link.href = release.github;
  });

  document.querySelectorAll(".download-summary").forEach((node) => {
    node.textContent = `${versionLabel} · ${release.size}`;
  });
  document.querySelector("#versionText").textContent = versionLabel;
  document.querySelector("#publishedText").textContent = release.published;
  document.querySelector("#sizeText").textContent = release.size;
  document.querySelector("#releasePageLink").href = release.releasePage;
}

fetch("./latest.json", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then(applyRelease)
  .catch(() => applyRelease(fallbackRelease));
