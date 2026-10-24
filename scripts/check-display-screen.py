import re
import sys

raw = open(sys.argv[1], encoding="utf-8").read()
rows = {}
for match in re.finditer(r"\x1b\[(\d+);1H([\s\S]*?)(?=\x1b\[\d+;1H|$)", raw):
    text = re.sub(r"\x1b\][\s\S]*?(?:\x07|\x1b\\)", "", match.group(2))
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
    rows[int(match.group(1))] = text.rstrip()

stage = sys.argv[2]
# Notifications/editor may quote commands; inspect only the replay transcript.
final = next(row for row, text in rows.items() if "DISPLAY FINAL ANSWER" in text)
screen = "\n".join(text for row, text in sorted(rows.items()) if row <= final)
stats = [text for text in rows.values() if "tokens ↑" in text]
assert len(stats) == 2, rows
tool_stats = next(text for text in stats if "cache 72.7%" in text)
assert "26.0 tok/s" in tool_stats and "TPS" not in tool_stats, tool_stats
assert re.search(r"\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s*$", tool_stats), tool_stats
assert not re.search(r"\d{4}-\d{2}-\d{2}", tool_stats), tool_stats
pure = next(row for row, text in rows.items() if "DISPLAY PURE ANSWER" in text)
pure_stats = next(text for row, text in sorted(rows.items()) if row > pure and text.strip())
assert "tokens ↑" in pure_stats and "cache 0%" in pure_stats, pure_stats
assert sum("turns" in text for text in rows.values()) == 1, rows
assert "codemode" in screen, screen
assert ("Thinking..." in screen) == (stage != "hidden"), screen
assert ("SCRIPT BODY" in screen) == (stage == "expanded"), screen
assert ("SCRIPT OUTPUT" in screen) == (stage == "expanded"), screen
for marker in ["NESTED FILE", "NESTED COMMAND", "NESTED ERROR"]:
    assert (marker in screen) == (stage != "compact"), screen
if stage == "hidden":
    code = next(row for row, text in rows.items() if re.match(r"\s*codemode\s", text))
    nested = next(row for row, text in rows.items() if "NESTED FILE" in text)
    assert nested == code + 1, screen
print(f"PASS fullscreen {stage}")
