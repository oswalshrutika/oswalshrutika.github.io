#!/usr/bin/env python3
"""Parse the interview-prep markdown into a single questions.json question bank.

Usage:
    python3 site/scripts/build_questions.py

Reads:  site/content/<module>/*.md   (synced copies of the source .md files)
        site/data/modules.json       (taxonomy: module labels + topic ranges)
Writes: site/data/questions.json     (question bank consumed by quiz.js)

Python 3 stdlib only, no third-party deps.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
CONTENT = SITE / "content"
DATA = SITE / "data"

Q_HEAD = re.compile(r"^###\s+Q(\d+)\.\s+(.+?)\s*$")
# story heads: `### Story N. <title>` or `## Story N — <title>` / `## Story N. <title>`
STORY_HEAD = re.compile(r"^##+\s+Story\s+(\d+)\s*[\.\-—:]\s*(.+?)\s*$")
# red_flags heads seen in the wild: `### 1. ...`, `## 1. ...`, `### Q1. ...`, `### R1. ...`, `### RF1. ...`
RED_HEAD = re.compile(r"^##+\s+(?:Q|R|RF)?(\d+)\.\s+(.+?)\s*$")
FIELD_INLINE = re.compile(r"^\*\*(Interviewer signal|Answer|Watch-outs|Problem|Expected columns?|Why it works|Explanation|When it's the right story|Category|Situation|Task|Action|Result|Reflection|Lessons|Wrong|Wrong statement|Why it's wrong|Why wrong|What to say instead|Correct)[:.]?\*\*\s*(.*)$", re.IGNORECASE)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def find_topic(module: dict, kind: str, qnum: int, source_file: str) -> tuple[str, str]:
    """Return (topic_slug, topic_label) for a question number in a given module/kind."""
    if kind == "flashcards":
        for t in module.get("topics", []):
            r = t.get("flashcard_range")
            if r and r[0] <= qnum <= r[1]:
                return t["slug"], t["label"]
    elif kind == "quick_hit":
        for t in module.get("topics", []):
            r = t.get("quick_hit_range")
            if r and r[0] <= qnum <= r[1]:
                return t["slug"], t["label"]
    # Comprehensive / focused / exercises / mock / red_flags — no per-Q ranges in taxonomy.
    return "general", "General"


def split_blocks(md: str, head_re: re.Pattern) -> list[tuple[int, str, list[str]]]:
    """Split markdown into blocks starting at head_re matches.

    Returns list of (qnum, first_line_title, body_lines) where body_lines are the
    lines strictly *after* the heading up to (but not including) the next heading
    or the horizontal rule `---` that separates entries.
    """
    lines = md.splitlines()
    heads: list[tuple[int, int, str]] = []  # (line_idx, qnum, title)
    for i, ln in enumerate(lines):
        m = head_re.match(ln)
        if m:
            heads.append((i, int(m.group(1)), m.group(2).strip()))
    blocks = []
    for k, (i, qnum, title) in enumerate(heads):
        end = heads[k + 1][0] if k + 1 < len(heads) else len(lines)
        body = lines[i + 1:end]
        # Trim trailing blank lines and standalone `---` separators.
        while body and body[-1].strip() in ("", "---"):
            body.pop()
        blocks.append((qnum, title, body))
    return blocks


def extract_fields(body_lines: list[str]) -> dict:
    """Extract labeled fields (**Answer:** etc.) from a Q block body.

    Fields can be single-line (`**Answer:** short`) or multi-line
    (`**Answer:**\n<paragraph...>`). Content between two field labels belongs
    to the earlier field; content before the first labeled field is the "lead".
    """
    fields: dict[str, list[str]] = {}
    current: str | None = None
    lead: list[str] = []
    for ln in body_lines:
        m = FIELD_INLINE.match(ln)
        if m:
            current = m.group(1).lower().replace("'s", "s").replace(" ", "_")
            # Normalise a couple of aliases.
            current = {
                "watch-outs": "watch_outs",
                "why_wrong": "why_its_wrong",
                "why_its_wrong": "why_its_wrong",
                "wrong_statement": "wrong",
                "expected_column": "expected_columns",
            }.get(current, current)
            rest = m.group(2).strip()
            fields.setdefault(current, [])
            if rest:
                fields[current].append(rest)
        else:
            if current is None:
                lead.append(ln)
            else:
                fields[current].append(ln)
    if lead and not fields:
        # No labeled fields at all — treat whole body as the answer.
        fields["answer"] = lead
    elif lead:
        fields["_lead"] = lead
    # Flatten to strings, trimming leading/trailing blank lines.
    out: dict[str, str] = {}
    for k, v in fields.items():
        while v and not v[0].strip():
            v.pop(0)
        while v and not v[-1].strip():
            v.pop()
        out[k] = "\n".join(v).strip()
    return out


def parse_qa_file(path: Path, module: dict, kind: str) -> list[dict]:
    """Parse quick_hit / focused / comprehensive files: `### Qn. <title>` format."""
    md = read(path)
    rel = str(path.relative_to(CONTENT)).replace("\\", "/")
    blocks = split_blocks(md, Q_HEAD)
    out = []
    for qnum, title, body in blocks:
        fields = extract_fields(body)
        answer = fields.get("answer") or fields.get("_lead") or ""
        topic_slug, topic_label = find_topic(module, kind, qnum, rel)
        out.append({
            "id": f"{module['slug']}-{kind}-q{qnum}",
            "module": module["slug"],
            "module_label": module["label"],
            "source_file": rel,
            "source_type": kind,
            "topic": topic_slug,
            "topic_label": topic_label,
            "qnum": qnum,
            "question": title.rstrip("."),
            "answer_md": answer,
            "interviewer_signal": fields.get("interviewer_signal", ""),
            "watch_outs": fields.get("watch_outs", ""),
            "type": "flashcard",
        })
    return out


def parse_story_file(path: Path, module: dict, kind: str) -> list[dict]:
    """Parse behavioral STAR story files: `### Story n. <label>` format."""
    md = read(path)
    rel = str(path.relative_to(CONTENT)).replace("\\", "/")
    blocks = split_blocks(md, STORY_HEAD)
    out = []
    for qnum, title, body in blocks:
        fields = extract_fields(body)
        parts = []
        for k in ("situation", "task", "action", "result", "reflection", "lessons"):
            if k in fields:
                parts.append(f"**{k.title()}.** {fields[k]}")
        answer = "\n\n".join(parts) if parts else (fields.get("answer") or fields.get("_lead") or "")
        trigger = fields.get("when_its_the_right_story") or fields.get("interviewer_signal", "")
        out.append({
            "id": f"{module['slug']}-{kind}-s{qnum}",
            "module": module["slug"],
            "module_label": module["label"],
            "source_file": rel,
            "source_type": kind,
            "topic": "general",
            "topic_label": fields.get("category", "STAR story"),
            "qnum": qnum,
            "question": f"STAR story: {title.rstrip('.')}" + (f" — trigger: {trigger}" if trigger else ""),
            "answer_md": answer,
            "interviewer_signal": trigger,
            "watch_outs": "",
            "type": "flashcard",
        })
    return out


def parse_exercises(path: Path, module: dict) -> list[dict]:
    """Parse 07_exercises.md: same `### Qn.` shape as quick_hit but marked coding."""
    md = read(path)
    rel = str(path.relative_to(CONTENT)).replace("\\", "/")
    blocks = split_blocks(md, Q_HEAD)
    out = []
    for qnum, title, body in blocks:
        fields = extract_fields(body)
        answer_parts = []
        if "problem" in fields:
            answer_parts.append(f"**Problem.** {fields['problem']}")
        if "expected_columns" in fields:
            answer_parts.append(f"**Expected columns.** {fields['expected_columns']}")
        if "answer" in fields:
            answer_parts.append(f"**Answer.**\n{fields['answer']}")
        if "why_it_works" in fields:
            answer_parts.append(f"**Why it works.** {fields['why_it_works']}")
        if "explanation" in fields:
            answer_parts.append(f"**Explanation.** {fields['explanation']}")
        out.append({
            "id": f"{module['slug']}-exercises-q{qnum}",
            "module": module["slug"],
            "module_label": module["label"],
            "source_file": rel,
            "source_type": "exercises",
            "topic": "general",
            "topic_label": "Hands-on drill",
            "qnum": qnum,
            "question": title.rstrip("."),
            "answer_md": "\n\n".join(answer_parts) if answer_parts else fields.get("_lead", ""),
            "interviewer_signal": fields.get("interviewer_signal", ""),
            "watch_outs": fields.get("watch_outs", ""),
            "type": "coding",
        })
    return out


def parse_flashcards(path: Path, module: dict) -> list[dict]:
    """Parse 08_flashcards.md: markdown 2-column tables grouped by section headings."""
    md = read(path)
    rel = str(path.relative_to(CONTENT)).replace("\\", "/")
    out = []
    section_slug = "flashcards_general"
    section_label = "Flashcards"
    section_map = {t["label"]: (t["slug"], t["label"]) for t in module.get("topics", [])}
    # Also index by flashcard_range so we can auto-tag rows by number.
    ranges = [(t.get("flashcard_range"), t["slug"], t["label"]) for t in module.get("topics", []) if t.get("flashcard_range")]

    for raw in md.splitlines():
        h = re.match(r"^##\s+(.+?)\s*(?:\((\d+)[–-](\d+)\))?\s*$", raw)
        if h:
            label = h.group(1).strip()
            # Try to match against taxonomy labels (fuzzy on the prefix).
            matched = None
            for t in module.get("topics", []):
                if label.lower().startswith(t["label"].split("—")[-1].strip().lower()) \
                   or t["label"].lower().endswith(label.lower()) \
                   or label.lower() in t["label"].lower():
                    matched = (t["slug"], t["label"])
                    break
            if matched:
                section_slug, section_label = matched
            else:
                section_slug, section_label = f"section_{re.sub(r'[^a-z0-9]+', '_', label.lower()).strip('_')}", label
            continue
        # Table row: | 1 | Q text | A text |
        row = re.match(r"^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$", raw)
        if row:
            qnum = int(row.group(1))
            q_text = row.group(2).strip()
            a_text = row.group(3).strip()
            # Prefer range-based topic if a taxonomy range covers this qnum.
            slug, label = section_slug, section_label
            for r, s, l in ranges:
                if r and r[0] <= qnum <= r[1]:
                    slug, label = s, l
                    break
            out.append({
                "id": f"{module['slug']}-flashcards-q{qnum}",
                "module": module["slug"],
                "module_label": module["label"],
                "source_file": rel,
                "source_type": "flashcards",
                "topic": slug,
                "topic_label": label,
                "qnum": qnum,
                "question": q_text,
                "answer_md": a_text,
                "interviewer_signal": "",
                "watch_outs": "",
                "type": "flashcard",
            })
    return out


def parse_red_flags(path: Path, module: dict) -> list[dict]:
    """Parse 05_red_flags.md into distractor pool entries.

    Structure varies across modules:
      * Some use `### 1. "Don't say: X"` with **Why it's wrong** / **What to say instead**.
      * Some use `## 1. <title>` with **Wrong statement** / **Why wrong** / **What to say instead**.
      * Some use `## 1. <title>` with **Wrong** / **Why it's wrong** / **Correct**.
    """
    md = read(path)
    rel = str(path.relative_to(CONTENT)).replace("\\", "/")
    blocks = split_blocks(md, RED_HEAD)
    out = []
    for qnum, title, body in blocks:
        fields = extract_fields(body)
        wrong = fields.get("wrong") or fields.get("wrong_statement") or title
        # Strip surrounding quotes.
        wrong = re.sub(r'^["“]|["”]$', '', wrong).strip()
        # Truncate to a distractor-friendly length.
        wrong_short = wrong[:200]
        out.append({
            "module": module["slug"],
            "module_label": module["label"],
            "source_file": rel,
            "num": qnum,
            "title": title,
            "wrong": wrong_short,
            "why": fields.get("why_its_wrong", ""),
            "correct": fields.get("what_to_say_instead") or fields.get("correct", ""),
        })
    return out


def main() -> int:
    modules_data = json.loads(read(DATA / "modules.json"))
    modules = modules_data["modules"]
    by_slug = {m["slug"]: m for m in modules}

    questions: list[dict] = []
    red_flags: list[dict] = []

    for module in modules:
        mdir = CONTENT / module["slug"]
        if not mdir.is_dir():
            print(f"  skip: {mdir} not found", file=sys.stderr)
            continue

        for fi in module["files"]:
            path = mdir / fi["name"]
            if not path.is_file():
                continue
            kind = fi.get("kind", "")
            name = fi["name"]

            if kind in ("quick_hit", "focused"):
                # Situational's focused file is stories, not Q&A.
                if module["slug"] == "07_situational" and kind == "focused":
                    parsed = parse_story_file(path, module, kind)
                else:
                    parsed = parse_qa_file(path, module, kind)
                questions.extend(parsed)
                print(f"  parsed {len(parsed):3d} Q from {module['slug']}/{name}")
            elif kind == "comprehensive":
                if module["slug"] == "07_situational":
                    parsed = parse_story_file(path, module, kind)
                else:
                    parsed = parse_qa_file(path, module, kind)
                questions.extend(parsed)
                print(f"  parsed {len(parsed):3d} Q from {module['slug']}/{name}")
            elif kind == "exercises":
                parsed = parse_exercises(path, module)
                questions.extend(parsed)
                print(f"  parsed {len(parsed):3d} Q from {module['slug']}/{name}")
            elif kind == "flashcards":
                parsed = parse_flashcards(path, module)
                questions.extend(parsed)
                print(f"  parsed {len(parsed):3d} Q from {module['slug']}/{name}")
            elif kind == "red_flags":
                parsed = parse_red_flags(path, module)
                red_flags.extend(parsed)
                print(f"  parsed {len(parsed):3d} R from {module['slug']}/{name}")
            # cheatsheet / diagrams / mock / checklist / index — not question sources.

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "question_count": len(questions),
        "red_flag_count": len(red_flags),
        "questions": questions,
        "red_flags": red_flags,
    }

    dest = DATA / "questions.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote {len(questions)} questions + {len(red_flags)} red-flag entries")
    print(f"  -> {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
