import re
import sys

# Read Pi fullscreen's explicitly positioned rows. Called before any scrolling
# or style switch, so the latest write for each row is the current startup view.
raw = open(sys.argv[1], encoding="utf-8").read()
rows = {}
raw_rows = {}
for match in re.finditer(r"\x1b\[(\d+);1H([\s\S]*?)(?=\x1b\[\d+;1H|$)", raw):
    text = re.sub(r"\x1b\][\s\S]*?(?:\x07|\x1b\\)", "", match.group(2))
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text).strip()
    row = int(match.group(1))
    rows[row] = text
    raw_rows[row] = match.group(2)

def locate(pattern):
    matches = [row for row, text in rows.items() if re.search(pattern, text)]
    if len(matches) != 1:
        raise SystemExit(f"Expected one visible row for {pattern!r}, found {matches}")
    return matches[0]

write = locate(r"^write\s+sample.txt")
edit = locate(r"^edit\s+sample.txt")
bash = locate(r"^bash\s+printf.*3 lines")
assert edit == write + 1 and bash == edit + 1, "Separate serial calls without Think must stay compact"
parallel_rows = [locate(r"^read\s+" + re.escape(path)) for path in ["image.png", "missing.txt", "sample.txt"]]
parallel_title = locate(r"^parallel · 3 calls$")
assert parallel_rows == list(range(parallel_title + 1, parallel_title + 4)), "Parallel title must directly precede consecutive tool rows"
thinking = sorted(row for row, text in rows.items() if text == "Thinking...")
assert len(thinking) == 2, f"Expected two collapsed thinking rows, found {thinking}"
assert thinking[0] == write - 1 and thinking[1] == bash + 2 and parallel_title == thinking[1] + 1, "Thinking must have padding above and directly connect below"
assert not rows[thinking[1] - 1] and re.search(r"\x1b\[48;", raw_rows[thinking[1] - 1]), "Thinking needs one colored separator above"
for row in thinking:
    assert re.search(r"\x1b\[48;", raw_rows[row]), "Thinking must share the panel background"
for row in [thinking[0] - 1, parallel_rows[-1] + 1]:
    assert not rows[row], f"Expected empty panel padding at row {row}"
    assert re.search(r"\x1b\[48;", raw_rows[row]), f"Expected colored panel padding at row {row}"
assert not any("ENOENT" in text for text in rows.values()), "Collapsed failed Read must hide error text"
summary = locate(r"6 calls · 5 turns")
assert summary == locate(r"FINAL ANSWER") + 2, "Summary must follow the final answer with one blank row"
assert not rows[summary - 1], "Expected one blank separator before statistics"
assert not re.search(r"\x1b\[1m", raw_rows[summary]), "statistics must not be bold"
stats = locate(r"TPS \d+\.\d tok/s · tokens ↑0 ↓100.*\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}")
assert not any("Tools" in text for text in rows.values()), "Statistics must not have a Tools label"
assert stats == summary + 1, "Statistics must remain consecutive"
for row in [summary, stats]:
    assert not re.search(r"\x1b\[48[;:]", raw_rows[row]), "Statistics must not have a panel background"
for row in [write, edit, bash, *thinking, parallel_title, *parallel_rows, summary]:
    text = re.sub(r"\x1b\][\s\S]*?(?:\x07|\x1b\\)", "", raw_rows[row])
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
    assert text.startswith(" ") and not text.startswith("  "), f"Expected native one-column padding at row {row}"
print("PASS native-padded tools and thinking in one continuous panel, parallel heading, hidden error text, and unboxed statistics")
