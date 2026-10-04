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
