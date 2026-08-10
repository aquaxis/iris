#!/usr/bin/env python3
"""Compare every EBNF block in `spec/` against `tools/iris.ebnf`.

`spec/16_grammar.md` reproduces the whole grammar, and the other chapters each
open with the part they describe. All of them are meant to say the same thing as
`tools/iris.ebnf`; when they drift, a reader learns a language the tools do not
implement.

Run from the repository root:

    python3 tools/conformance/grammar_check.py

Exits non-zero if any chapter disagrees, so it can gate a change.
"""

import pathlib
import re
import sys

AUTHORITY = pathlib.Path("tools/iris.ebnf")
SPEC = pathlib.Path("spec")


def strip_comments(text: str) -> str:
    """Remove `(* ... *)` comments, which may span lines.

    Skipping only the lines that start with `(*` left the continuation lines
    behind, and they were read as part of the preceding rule. Two comparisons
    reported a difference that was not there.
    """
    return re.sub(r"\(\*.*?\*\)", "", text, flags=re.S)


def rules(text: str) -> dict[str, str]:
    """Map each rule name to its body, with whitespace flattened."""
    text = strip_comments(text)
    out: dict[str, str] = {}
    name: str | None = None
    buf: list[str] = []

    for line in text.split("\n"):
        if re.match(r"^[a-z_][a-z_0-9]*\s*=", line):
            if name:
                out[name] = " ".join(buf)
            name, _, rest = line.partition("=")
            name, buf = name.strip(), [rest]
        elif name is not None:
            if line.strip():
                buf.append(line)
    if name:
        out[name] = " ".join(buf)

    return {k: re.sub(r"\s+", " ", v).strip().rstrip(";").strip() for k, v in out.items()}


def blocks(path: pathlib.Path) -> str:
    return "\n".join(re.findall(r"```ebnf\n(.*?)```", path.read_text(), re.S))


def main() -> int:
    authority = rules(AUTHORITY.read_text())

    duplicates = [
        name
        for name in {m.group(1) for m in re.finditer(r"^([a-z_][a-z_0-9]*)\s*=", strip_comments(AUTHORITY.read_text()), re.M)}
        if strip_comments(AUTHORITY.read_text()).count(f"\n{name} =") > 1
    ]

    failures = 0
    if duplicates:
        # One name standing for two constructs is a contradiction inside the
        # authority itself, before any chapter is consulted.
        print(f"  FAIL  {AUTHORITY}: defined twice: {', '.join(sorted(duplicates))}")
        failures += len(duplicates)

    for path in sorted(SPEC.glob("*.md")):
        text = blocks(path)
        if not text:
            continue
        chapter = rules(text)
        differs = [k for k in chapter if k in authority and chapter[k] != authority[k]]
        missing = [k for k in chapter if k not in authority]

        for name in differs:
            print(f"  FAIL  {path.name}: {name} differs")
            print(f"          chapter: {chapter[name]}")
            print(f"          grammar: {authority[name]}")
        for name in missing:
            print(f"  FAIL  {path.name}: {name} is not in {AUTHORITY}")
        failures += len(differs) + len(missing)

    print(f"\n{len(authority)} rules in {AUTHORITY}; {failures} disagreement(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
