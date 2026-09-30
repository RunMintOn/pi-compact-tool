(() => {
  const report = JSON.parse(document.getElementById("report-data").textContent);
  const main = document.getElementById("main");
  const diffs = document.getElementById("diffs");
  const navigation = document.getElementById("file-list");
  const filesToggle = document.getElementById("files-toggle");
  const formatTime = value => new Date(value).toLocaleString();
  document.title = `Changes · ${new Date(report.start).toLocaleString()} · pi-compact-tool`;
  document.getElementById("outcome").textContent = { completed: "Completed", aborted: "Interrupted", error: "Failed" }[report.outcome];
  const unavailable = report.files.filter(file => file.status === "Unavailable").length;
  const changed = report.files.length - unavailable;
  document.getElementById("metadata").textContent = `${formatTime(report.start)} → ${formatTime(report.end)} · ${changed} changed file${changed === 1 ? "" : "s"} · +${report.added} −${report.deleted}${unavailable ? ` · ${unavailable} unavailable` : ""}`;
  document.getElementById("file-count").textContent = report.files.length;
  const promptContainer = document.getElementById("prompts");
  report.prompts.forEach(text => {
    const prompt = document.createElement("pre");
    prompt.className = "prompt";
    prompt.textContent = text;
    promptContainer.append(prompt);
  });
  if (!report.prompts.length) promptContainer.textContent = "User message was not captured.";
  document.querySelector("#user-messages summary").textContent = report.prompts.length > 1 ? `User messages (${report.prompts.length})` : "User message";

  function stats(file) {
    const row = document.createElement("span");
    row.className = "file-stats";
    const type = document.createElement("span");
    type.textContent = file.status;
    row.append(type);
    if (file.status !== "Unavailable") {
      for (const [className, value] of [["added", `+${file.added}`], ["deleted", `−${file.deleted}`]]) {
        const count = document.createElement("span");
        count.className = className;
        count.textContent = value;
        row.append(count);
      }
    }
    return row;
  }
  let activeIndex = 0;
  let layout = "auto";
  let outputFormat;
  let rendering = false;
  const links = report.files.map((file, index) => {
    const link = document.createElement("a");
    link.className = "file-link";
    link.href = `#file-${index}`;
    const path = document.createElement("span");
    path.className = "file-path";
    path.textContent = file.path;
    link.append(path, stats(file));
    link.addEventListener("click", () => {
      activate(index);
      closeFiles();
    });
    navigation.append(link);
    return link;
  });
  function activate(index) {
    activeIndex = index;
    links.forEach((link, i) => {
      if (i === index) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  }
  function closeFiles() {
    document.body.classList.remove("files-open");
    filesToggle.setAttribute("aria-expanded", "false");
  }
  filesToggle.addEventListener("click", () => {
    const open = document.body.classList.toggle("files-open");
    filesToggle.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeFiles(); });
  document.addEventListener("click", event => {
    if (!event.target.closest("#sidebar, #files-toggle")) closeFiles();
  });

  function restorePosition(previousTop) {
    if (previousTop !== undefined && previousTop < 80) {
      const target = document.getElementById(`file-${activeIndex}`);
      const preservedTop = Math.max(previousTop, 80 - target.offsetHeight);
      window.scrollBy(0, target.getBoundingClientRect().top - preservedTop);
    }
  }
  function render() {
    const nextFormat = layout === "auto" ? main.clientWidth >= 900 ? "side-by-side" : "line-by-line" : layout === "split" ? "side-by-side" : "line-by-line";
    if (outputFormat === nextFormat) return;
    rendering = true;
    const previous = document.getElementById(`file-${activeIndex}`);
    const previousTop = previous?.getBoundingClientRect().top;
    outputFormat = nextFormat;
    diffs.dataset.format = outputFormat;
    diffs.replaceChildren();
    report.files.forEach((file, index) => {
      const section = document.createElement("section");
      section.className = "file-section";
      section.id = `file-${index}`;
      const heading = document.createElement("div");
      heading.className = "file-heading";
      const title = document.createElement("h2");
      title.textContent = file.path;
      heading.append(title, stats(file));
      section.append(heading);
      if (file.diff?.blocks.length) {
        const content = document.createElement("div");
        content.innerHTML = Diff2Html.html([file.diff], {
          drawFileList: false, outputFormat, matching: "lines", colorScheme: "auto",
        });
        section.append(content);
        const panes = [...content.querySelectorAll(".d2h-file-side-diff")];
        panes.forEach(pane => pane.addEventListener("scroll", () => {
          panes.forEach(other => { if (other !== pane && other.scrollLeft !== pane.scrollLeft) other.scrollLeft = pane.scrollLeft; });
        }, { passive: true }));
      } else {
        const notice = document.createElement("div");
        notice.className = "notice";
        notice.textContent = file.notice || (file.status === "Added" ? "Empty file created." : file.status === "Deleted" ? "Empty file deleted." : "No text hunks to display.");
        section.append(notice);
      }
      diffs.append(section);
    });
    if (!report.files.length) diffs.textContent = "No net changes.";
    restorePosition(previousTop);
    activate(activeIndex);
    rendering = false;
  }
  document.querySelectorAll("[data-layout]").forEach(button => {
    button.addEventListener("click", () => {
      layout = button.dataset.layout;
      document.querySelectorAll("[data-layout]").forEach(other => other.setAttribute("aria-pressed", String(other === button)));
      render();
    });
  });
  document.getElementById("wrap-lines").addEventListener("change", event => {
    const previousTop = document.getElementById(`file-${activeIndex}`)?.getBoundingClientRect().top;
    diffs.classList.toggle("wrap-lines", event.target.checked);
    restorePosition(previousTop);
  });
  let scheduled = false;
  window.addEventListener("scroll", () => {
    if (scheduled || rendering) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const sections = [...diffs.querySelectorAll(".file-section")];
      const index = sections.findIndex(section => section.getBoundingClientRect().bottom > 90);
      if (index >= 0) activate(index);
    });
  }, { passive: true });
  new ResizeObserver(render).observe(main);
  render();
})();
