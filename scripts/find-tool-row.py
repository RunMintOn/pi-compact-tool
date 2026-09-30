import re
import sys

# Pi fullscreen writes each changed row with an explicit cursor position.
raw = open(sys.argv[1], encoding="utf-8").read()
latest = None
for match in re.finditer(r"\x1b\[(\d+);1H([\s\S]*?)(?=\x1b\[\d+;1H|$)", raw):
    row = match.group(2)
    row = re.sub(r"\x1b\][\s\S]*?(?:\x07|\x1b\\)", "", row)
    row = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", row)
    if "Bash(" in row or re.search(r"\bbash\s+printf", row):
        latest = int(match.group(1))
if latest is None:
    raise SystemExit("No visible Bash row found")
print(latest)
