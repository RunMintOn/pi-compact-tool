(() => {
  const report = JSON.parse(document.getElementById("report-data").textContent);
  const main = document.getElementById("main");
  const diffs = document.getElementById("diffs");
  const navigation = document.getElementById("file-list");
  const filesToggle = document.getElementById("files-toggle");
  const splitButton = document.querySelector('[data-layout="split"]');
  const pad = value => String(value).padStart(2, "0");
  const formatTime = value => {
    const date = new Date(value);
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  document.title = `Changes · ${new Date(report.start).toLocaleString()} · pi-compact-tool`;
  const outcome = document.getElementById("outcome");
  outcome.textContent = { completed: "completed", aborted: "interrupted", error: "failed" }[report.outcome] ?? report.outcome;
  outcome.dataset.outcome = report.outcome;
  const unavailable = report.files.filter(file => file.status === "Unavailable").length;
  const changed = report.files.length - unavailable;
  document.getElementById("metadata").textContent =
    `${changed} file${changed === 1 ? "" : "s"} · +${report.added} −${report.deleted}` +
    `${unavailable ? ` · ${unavailable} unavailable` : ""} · ${formatTime(report.start)} → ${formatTime(report.end)}`;
  document.getElementById("file-count").textContent = report.files.length;
  const promptContainer = document.getElementById("prompts");
  report.prompts.forEach(text => {
    const prompt = document.createElement("pre");
    prompt.className = "prompt-text";
    prompt.textContent = text;
    promptContainer.append(prompt);
  });
  if (!report.prompts.length) promptContainer.textContent = "User message was not captured.";
  document.querySelector("#user-messages summary").textContent =
    report.prompts.length > 1 ? `User messages (${report.prompts.length})` : "User message";

  let activeIndex = 0;
  const links = [];
  const isMarkdown = file => /\.(md|markdown|mdx)$/i.test(file.path);
  const statusRank = { Modified: 0, Added: 1, Deleted: 2, Unavailable: 3 };
  // One ordering feeds both the index and the document, so the sidebar always
  // matches what scrolling walks through. Markdown leads because that is what
  // most reports are read for; everything else follows behind a divider.
  const order = report.files
    .map((file, index) => ({ file, index }))
    .sort((a, b) =>
      Number(isMarkdown(b.file)) - Number(isMarkdown(a.file)) ||
      statusRank[a.file.status] - statusRank[b.file.status] ||
      a.file.path.localeCompare(b.file.path))
    .map(({ index }) => index);
  const statusLetter = { Added: "A", Deleted: "D", Unavailable: "?" };

  function stats(file) {
    const row = document.createElement("span");
    row.className = "file-stats";
    if (file.status === "Unavailable") {
      row.textContent = "unavailable";
      return row;
    }
    // Modified is the default, so only the exceptions carry a marker.
    const letter = statusLetter[file.status];
    if (letter) {
      const mark = document.createElement("span");
      mark.className = "mark";
      mark.dataset.status = file.status.toLowerCase();
      mark.textContent = letter;
      row.append(mark);
    }
    for (const [className, value] of [["added", `+${file.added}`], ["deleted", `−${file.deleted}`]]) {
      const count = document.createElement("span");
      count.className = className;
      count.textContent = value;
      row.append(count);
    }
    return row;
  }

  function fileLink(file, index) {
    const link = document.createElement("a");
    link.className = "file-link";
    link.href = `#file-${index}`;
    const path = document.createElement("span");
    path.className = "file-path";
    // Long absolute paths are common; the filename is what you scan for, so it
    // leads and the directory sits underneath in a dimmer style.
    const cut = file.path.lastIndexOf("/");
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = cut < 0 ? file.path : file.path.slice(cut + 1);
    path.append(name);
    if (cut >= 0) {
      const directory = document.createElement("span");
      directory.className = "file-dir";
      // Only the tail of a deep path is useful for telling files apart.
      const segments = file.path.slice(0, cut).split("/").filter(Boolean);
      directory.textContent = (segments.length > 2 ? "…/" : "") + segments.slice(-2).join("/");
      path.append(directory);
    }
    link.append(path, stats(file));
    link.title = file.path;
    link.addEventListener("click", () => {
      activateFromClick(index);
      closeFiles();
    });
    links[index] = link;
    return link;
  }

  // A report with only one kind gets no divider: one list split into one list is
  // just noise.
  const kinds = [
    { label: "Markdown", test: isMarkdown },
    { label: "Other", test: file => !isMarkdown(file) },
  ]
    .map(kind => ({ ...kind, members: order.filter(index => kind.test(report.files[index])) }))
    .filter(kind => kind.members.length);
  for (const kind of kinds) {
    if (kinds.length > 1) {
      const heading = document.createElement("div");
      heading.className = "kind";
      heading.append(kind.label);
      const count = document.createElement("span");
      count.textContent = `· ${kind.members.length}`;
      heading.append(count);
      navigation.append(heading);
    }
    for (const index of kind.members) navigation.append(fileLink(report.files[index], index));
  }
  let suppress = 0;
  function activate(index) {
    activeIndex = index;
    links.forEach((link, i) => {
      if (!link) return;
      if (i === index) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  }
  // A link click jumps to an anchor, and that jump fires scroll events. Ignore
  // scroll-driven activation briefly so the clicked file stays selected.
  function activateFromClick(index) {
    suppress = performance.now() + 250;
    activate(index);
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

  const escape = text => text.replace(/[&<>]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]);
  // diff2html's parser keeps the leading +/-/space marker inside the content.
  const lineText = line => {
    const text = line.content ?? "";
    return /^[-+ ]/.test(text) ? text.slice(1) : text;
  };
  // Only the source markers are tinted; they stay visible because the markers
  // themselves are frequently what changed.
  function markdown(escaped) {
    if (/^\s*(```|~~~)/.test(escaped)) return `<span class="m-fence">${escaped}</span>`;
    if (/^\s*#{1,6}\s/.test(escaped)) return `<span class="m-heading">${escaped}</span>`;
    if (/^\s*\|/.test(escaped)) return `<span class="m-table">${escaped}</span>`;
    if (/^\s*>\s/.test(escaped)) return `<span class="m-quote">${escaped}</span>`;
    return escaped
      .replace(/`([^`]+)`/g, '<span class="m-code">`$1`</span>')
      .replace(/\*\*([^*]+)\*\*/g, '<span class="m-strong">**$1**</span>');
  }
  // Pair each run of deletions with the insertions that replaced it. One pair
  // feeds both layouts: unified prints the two sides on separate rows, split
  // prints them side by side, and only the changed words get marked.
  function pairs(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].type !== "delete") {
        const line = lines[i];
        const side = { number: line.type === "insert" ? line.newNumber : line.oldNumber, html: markdown(escape(lineText(line))) };
        out.push(line.type === "insert" ? { type: "insert", old: null, next: side } : { type: "context", old: side, next: side });
        continue;
      }
      const deleted = [];
      const inserted = [];
      while (i < lines.length && lines[i].type === "delete") deleted.push(lines[i++]);
      while (i < lines.length && lines[i].type === "insert") inserted.push(lines[i++]);
      i--;
      for (let k = 0; k < Math.max(deleted.length, inserted.length); k++) {
        const before = deleted[k];
        const after = inserted[k];
        if (before && after) {
          const parts = Diff.diffWords(lineText(before), lineText(after));
          out.push({
            type: "change",
            old: { number: before.oldNumber, html: parts.filter(part => !part.added)
              .map(part => part.removed ? `<i class="hl-d">${escape(part.value)}</i>` : markdown(escape(part.value))).join("") },
            next: { number: after.newNumber, html: parts.filter(part => !part.removed)
              .map(part => part.added ? `<i class="hl-i">${escape(part.value)}</i>` : markdown(escape(part.value))).join("") },
          });
        } else if (before) {
          out.push({ type: "delete", old: { number: before.oldNumber, html: markdown(escape(lineText(before))) }, next: null });
        } else {
          out.push({ type: "insert", old: null, next: { number: after.newNumber, html: markdown(escape(lineText(after))) } });
        }
      }
    }
    return out;
  }

  const sign = { insert: "+", delete: "−", context: " " };
  function unifiedRows(pair) {
    if (pair.type === "context") return [["context", " ", pair.old.number, pair.old.number, pair.old.html]];
    if (pair.type === "change") {
      return [
        ["delete", sign.delete, pair.old.number, "", pair.old.html],
        ["insert", sign.insert, "", pair.next.number, pair.next.html],
      ];
    }
    const side = pair.old ?? pair.next;
    return [[pair.type, sign[pair.type], pair.old ? side.number : "", pair.next ? side.number : "", side.html]];
  }
  function unifiedHTML(pair) {
    return unifiedRows(pair).map(([type, mark, oldNumber, newNumber, html]) =>
      `<tr class="${type}"><td class="ln">${oldNumber}</td><td class="ln">${newNumber}</td>` +
      `<td class="sign">${mark}</td><td class="content">${html}</td></tr>`).join("");
  }
  function splitHTML(pair) {
    const side = (cell, type) => cell
      ? `<td class="ln">${cell.number}</td><td class="content ${type}">${cell.html}</td>`
      : '<td class="ln filler"></td><td class="content filler"></td>';
    const left = pair.old ? (pair.type === "insert" ? "filler" : pair.type === "context" ? "context" : "delete") : "filler";
    const right = pair.next ? (pair.type === "delete" ? "filler" : pair.type === "context" ? "context" : "insert") : "filler";
    return `<tr class="${pair.type}">${side(pair.old, left)}<td class="gutter"></td>${side(pair.next, right)}</tr>`;
  }
  const foldHTML = (hidden, id) =>
    `<tr class="fold"><td colspan="5"><div><span>${hidden} unchanged line${hidden === 1 ? "" : "s"}</span>` +
    `<span class="rule"></span><button type="button" data-fold="${id}">show</button></div></td></tr>`;
  // Hidden context rows stay in the DOM so expanding is a class toggle rather
  // than a second render pass.
  const foldedHTML = (row, id) => row.replace(/^<tr class="(\w+)"/, `<tr class="$1 folded" data-fold="${id}" hidden`);

  let layout = "unified";
  let hunkId = 0;
  function hunkHTML(block) {
    const id = hunkId++;
    const all = pairs(block.lines);
    const render = layout === "split" ? splitHTML : unifiedHTML;
    let body = "";
    let index = 0;
    while (index < all.length) {
      if (all[index].type !== "context") {
        body += render(all[index++]);
        continue;
      }
      let end = index;
      while (end < all.length && all[end].type === "context") end++;
      const run = all.slice(index, end);
      // Keep two lines against each edge so a hunk still shows where it sits.
      if (run.length > 6 && index > 0 && end < all.length) {
        body += render(run[0]) + render(run[1]) + foldHTML(run.length - 4, id);
        body += run.slice(2, -2).map(row => foldedHTML(render(row), id)).join("");
        body += render(run[run.length - 2]) + render(run[run.length - 1]);
      } else {
        body += run.map(render).join("");
      }
      index = end;
    }
    const range = block.header.replace(/^@@\s*/, "").replace(/\s*@@.*$/, "");
    const changes = block.lines.filter(line => line.type !== "context").length;
    return `<div class="hunk" id="hunk-${id}" data-changes="${changes}">` +
      `<span class="k">hunk</span><span class="h">${escape(range)}</span>` +
      `<span class="count">${changes} change${changes === 1 ? "" : "s"}</span></div>` +
      `<div class="scroll"><table class="diff"><tbody>${body}</tbody></table></div>`;
  }

  function restorePosition(previousTop) {
    if (previousTop === undefined || previousTop >= 80) return;
    const target = document.getElementById(`file-${activeIndex}`);
    if (!target) return;
    const preservedTop = Math.max(previousTop, 80 - target.offsetHeight);
    window.scrollBy(0, target.getBoundingClientRect().top - preservedTop);
  }
  function render() {
    const previousTop = document.getElementById(`file-${activeIndex}`)?.getBoundingClientRect().top;
    diffs.dataset.layout = layout;
    hunkId = 0;
    diffs.replaceChildren();
    let currentKind;
    for (const index of order) {
      const file = report.files[index];
      const kind = isMarkdown(file) ? "Markdown" : "Other";
      // Mirror the sidebar split in the document so the jump from prose to code
      // is announced instead of just happening.
      if (kinds.length > 1 && kind !== currentKind) {
        const divider = document.createElement("div");
        divider.className = "kind-divider";
        divider.append(kind);
        const count = document.createElement("span");
        count.textContent = `${kinds.find(entry => entry.label === kind).members.length} files`;
        divider.append(count);
        diffs.append(divider);
        currentKind = kind;
      }
      const section = document.createElement("section");
      section.className = "file-section";
      section.id = `file-${index}`;
      const heading = document.createElement("div");
      heading.className = "file-head";
      const title = document.createElement("span");
      title.className = "file-path";
      title.textContent = file.path;
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = file.status;
      heading.append(title, tag, stats(file));
      section.append(heading);
      if (file.diff?.blocks.length) {
        section.insertAdjacentHTML("beforeend", file.diff.blocks.map(hunkHTML).join(""));
      } else {
        const notice = document.createElement("div");
        notice.className = "notice";
        notice.textContent = file.notice
          || (file.status === "Added" ? "Empty file created." : file.status === "Deleted" ? "Empty file deleted." : "No text hunks to display.");
        section.append(notice);
      }
      diffs.append(section);
    }
    if (!report.files.length) diffs.textContent = report.incomplete ? "No file changes could be confirmed." : "No net changes.";
    // The nav is the authoritative list of where changes live.
    hunks = [...diffs.querySelectorAll(".hunk")];
    markPosition();
    restorePosition(previousTop);
    activate(activeIndex);
  }

  document.querySelectorAll("[data-layout]").forEach(button => {
    button.addEventListener("click", () => {
      layout = button.dataset.layout;
      document.querySelectorAll("[data-layout]").forEach(other => other.setAttribute("aria-pressed", String(other === button)));
      render();
    });
  });
  // "Next change" walks hunks, not files: a single file can hold five separate
  // edits hundreds of lines apart, which is the common shape in long documents.
  let hunks = [];
  let hunkAt = -1;
  const position = document.getElementById("position");
  function currentHunk() {
    // The hunk in effect is the last one whose heading passed the top bar.
    let found = -1;
    for (let i = 0; i < hunks.length; i++) if (hunks[i].getBoundingClientRect().top <= 110) found = i;
    return found;
  }
  function highlight(index) {
    hunkAt = index;
    hunks.forEach((hunk, i) => {
      if (i === index) hunk.dataset.current = "true";
      else delete hunk.dataset.current;
    });
    position.textContent = hunks.length ? `${Math.max(0, index) + 1} / ${hunks.length}` : "";
  }
  function markPosition() { highlight(currentHunk()); }
  function goToHunk(index) {
    if (!hunks.length) return;
    const next = Math.max(0, Math.min(hunks.length - 1, index));
    const target = hunks[next];
    // Land just under the sticky bar so the hunk header stays visible. The jump is
    // instant on purpose: this runs on every j/k press, where an animation reads
    // as lag, and a smooth scroll would keep firing scroll events that fight the
    // position readout.
    window.scrollTo(0, window.scrollY + target.getBoundingClientRect().top - 52);
    highlight(next);
  }
  document.getElementById("prev-change").addEventListener("click", () => goToHunk((hunkAt < 0 ? 0 : hunkAt) - 1));
  document.getElementById("next-change").addEventListener("click", () => goToHunk(hunkAt + 1));

  document.getElementById("wrap-lines").addEventListener("change", event => {
    const previousTop = document.getElementById(`file-${activeIndex}`)?.getBoundingClientRect().top;
    diffs.classList.toggle("nowrap", !event.target.checked);
    restorePosition(previousTop);
  });
  diffs.addEventListener("click", event => {
    const button = event.target.closest("tr.fold button");
    if (!button) return;
    const id = button.dataset.fold;
    const rows = diffs.querySelectorAll(`tr.folded[data-fold="${id}"]`);
    const open = button.textContent === "show";
    rows.forEach(row => { row.hidden = !open; });
    button.textContent = open ? "hide" : "show";
  });
  document.addEventListener("keydown", event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
    if (typing || event.target.isContentEditable) return;
    if (event.key === "j" || event.key === "n") { event.preventDefault(); goToHunk(hunkAt + 1); }
    else if (event.key === "k" || event.key === "p") { event.preventDefault(); goToHunk((hunkAt < 0 ? 0 : hunkAt) - 1); }
  });
  let scheduled = false;
  window.addEventListener("scroll", () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (performance.now() < suppress) return;
      markPosition();
      const sections = [...diffs.querySelectorAll(".file-section")];
      if (!sections.length) return;
      // The reading line is the last file whose heading passed the top bar. A
      // short final file never reaches it, so the page bottom selects it instead.
      let index = 0;
      for (let i = 0; i < sections.length; i++) if (sections[i].getBoundingClientRect().top <= 100) index = i;
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4) {
        const last = sections.length - 1;
        if (sections[last].getBoundingClientRect().top > 100) index = last;
      }
      activate(index);
    });
  }, { passive: true });
  // Two code columns stop being readable below this width, so the split option
  // is disabled instead of silently producing cramped columns.
  const fit = () => { splitButton.disabled = main.clientWidth < 720; };
  new ResizeObserver(fit).observe(main);
  fit();
  render();
})();
