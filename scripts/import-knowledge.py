"""Import the four local DCMA documents without network or model calls.

Requires pypdf==6.10.0; DOCX extraction uses only the Python standard library.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from xml.etree import ElementTree
from zipfile import ZipFile

from pypdf import PdfReader


WORD_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
CODE_HEADING = re.compile(r"^([FANC]\d{5})[ \t]+(.+)$")
PDF_IDENTITY = {"manufacturer": "西门子", "model": "SINAMICS S120/S150", "version": "06/2020"}
DOCUMENTS = [
    ("90L-4三相异步电动机使用说明书.docx", "南京苏玛", "90L-4", "V1.0", "manual"),
    ("YFB801-2粉尘防爆三相异步电动机使用说明书.docx", "佳木斯", "YFB801-2", "V1.0", "manual"),
    ("0.75kW与1.5kW电机对拖试验故障模拟实施方案（YFB801-2+90L-4）.docx",
     "方案涉及多厂家", "YFB801-2 + 90L-4 / CU250 + PM240", "原文未标注版本", "case"),
]
SOURCE_ALIASES = {
    "0.75kW与1.5kW电机对拖试验故障模拟实施方案（YFB801-2+90L-4）.docx":
        "0.75kW与1.5kW电机对拖试验故障模拟实施方案（Y）.docx",
}


def entry(identifier, identity, kind, text, title, locator, codes=None):
    result = dict(id=identifier, **identity, kind=kind, text=text,
                  source=dict(title=title, locator=locator, revision=identity["version"]))
    if codes:
        result["codes"] = codes
    return result


def docx_entries(path, manufacturer, model, version, kind):
    with ZipFile(path) as archive:
        document = ElementTree.fromstring(archive.read("word/document.xml"))
    paragraphs = ["".join(t.text or "" for t in p.findall(".//w:t", WORD_NS)).strip()
                  for p in document.findall(".//w:p", WORD_NS)]
    identity = dict(manufacturer=manufacturer, model=model, version=version)
    sections = []
    lines = []
    heading = "文档开头"
    for paragraph in filter(None, paragraphs):
        if re.match(r"^(?:\d+(?:\.\d+)*\s|[一二三四五六七八九十]+、)", paragraph):
            if lines:
                sections.append((heading, "\n".join(lines)))
            heading, lines = paragraph, []
        lines.append(paragraph)
    if lines:
        sections.append((heading, "\n".join(lines)))
    prefix = hashlib.sha256(path.name.encode("utf-8")).hexdigest()[:12]
    return [entry(f"docx-{prefix}-{index + 1}", identity, kind, text, path.stem,
                  f"{path.name}；章节：{heading}") for index, (heading, text) in enumerate(sections)]


def pdf_entries(pages, filename):
    """Join continued definitions, retaining separate drive-object variants."""
    records = []
    current = []
    start_page = end_page = 0
    printed_start = printed_end = ""
    output = []

    def flush():
        if not current:
            return
        code, title = CODE_HEADING.fullmatch(current[0]).groups()
        text = "\n".join(current).strip()
        treatment = text.partition("处理：")[2].strip()
        # These are consecutive source-text fragments, not independently invented steps.
        steps = [treatment[i:i + 1000] for i in range(0, len(treatment), 1000)]
        alternatives = re.match(r"^\(([FANC,\s]+)\)", title)
        prefixes = {code[0]}
        if alternatives:
            prefixes.update(re.findall(r"[FANC]", alternatives[1]))
        codes = [dict(kind="fault" if prefix == "F" else "alarm", code=prefix + code[1:],
                      meaning=f"{code} {title}", steps=steps) for prefix in sorted(prefixes & {"F", "A"})]
        locator = (f"{filename}；PDF第{start_page}-{end_page}页；"
                   f"原书第{printed_start}-{printed_end}页；{code}")
        output.append(entry(f"s120-{code}-{len(output) + 1}", PDF_IDENTITY, "manual",
                            text, "SINAMICS S120/S150 故障和报警列表", locator, codes))
        records.append(code)
        current.clear()

    for number, page in enumerate(pages, 1):
        printed = re.search(r"(?:^(\d{4})\s+参数手册|参数手册[^\n]*?\s(\d{4})$)", page, re.M)
        printed_page = next((v for v in printed.groups() if v), "未识别") if printed else "未识别"
        if "4.2 故障和报警列表" not in page:
            flush()
            # Keep the appendix searchable without attaching it to the last fault's remedy.
            if page.strip():
                output.append(entry(f"s120-page-{number}", PDF_IDENTITY, "manual", page.strip(),
                                    "SINAMICS S120/S150 手册附录", f"{filename}；PDF第{number}页；原书第{printed_page}页"))
            continue
        lines = [line.strip() for line in page.splitlines() if line.strip()]
        for index, line in enumerate(lines):
            if line in ("4 故障和报警", "4.2 故障和报警列表", "SINAMICS S120/S150") or "参数手册 ," in line:
                continue
            if CODE_HEADING.fullmatch(line) and index + 1 < len(lines) and lines[index + 1].startswith("信息值："):
                flush()
                start_page, printed_start = number, printed_page
            if current or CODE_HEADING.fullmatch(line):
                current.append(line)
                end_page, printed_end = number, printed_page
    flush()
    if not records:
        raise ValueError("No fault/alarm definitions extracted from PDF")
    return output, len(records), len(set(records))


def validate(entries):
    if not entries or len(entries) > 2000 or len({e["id"] for e in entries}) != len(entries):
        raise ValueError("Invalid entry count or duplicate IDs")
    for item in entries:
        if not item["text"].strip() or len(item["text"]) > 20000:
            raise ValueError(f"Empty or oversized source section: {item['id']}")
        for code in item.get("codes", []):
            if len(code["meaning"]) > 2000 or len(code["steps"]) > 30 or any(not s.strip() for s in code["steps"]):
                raise ValueError(f"Code exceeds runtime limits: {item['id']}")
    payload = json.dumps(dict(entries=entries), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(payload) > 8 * 1024 * 1024:
        raise ValueError("Knowledge exceeds 8 MiB; no data was written")
    return payload


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=root.parent / "knowledge")
    parser.add_argument("--output", type=Path, default=root / "packages/web/.dcma-runtime/knowledge.json")
    args = parser.parse_args()
    entries = []
    sources = []
    for filename, manufacturer, model, version, kind in DOCUMENTS:
        path = args.source / filename
        if not path.exists() and filename in SOURCE_ALIASES:
            path = args.source / SOURCE_ALIASES[filename]
        imported = docx_entries(path, manufacturer, model, version, kind)
        entries.extend(imported)
        sources.append(dict(file=filename, entries=len(imported), sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    pdf = args.source / "S120_故障手册.pdf"
    pages = [page.extract_text() for page in PdfReader(pdf).pages]
    imported, definitions, unique_codes = pdf_entries(pages, pdf.name)
    entries.extend(imported)
    sources.append(dict(file=pdf.name, pages=len(pages), definitions=definitions, uniqueCodes=unique_codes,
                        entries=len(imported), sha256=hashlib.sha256(pdf.read_bytes()).hexdigest()))
    payload = validate(entries)
    args.output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary = tempfile.mkstemp(dir=args.output.parent, prefix=".knowledge-", suffix=".tmp")
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
        os.replace(temporary, args.output)
    finally:
        Path(temporary).unlink(missing_ok=True)
    print(json.dumps(dict(output=str(args.output), entries=len(entries), bytes=len(payload), sources=sources), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
