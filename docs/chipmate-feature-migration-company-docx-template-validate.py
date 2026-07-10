#!/usr/bin/env python3
"""Validate a real company .docx template for ChipMate feature migration evidence.

This is a source-workstation evidence helper.  It does not generate Word files,
does not fill placeholders, does not enforce a document contract, and does not
decide installed chat/runtime acceptance.  It only inspects OOXML structure and,
optionally, compares a generated .docx against the template style ids.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path
from typing import Any


TEXT_PARTS = {
    "[Content_Types].xml",
    "word/document.xml",
    "word/styles.xml",
    "word/numbering.xml",
    "word/theme/theme1.xml",
}


def read_zip_text(docx: Path, name: str) -> str:
    with zipfile.ZipFile(docx) as archive:
        try:
            return archive.read(name).decode("utf-8", errors="replace")
        except KeyError:
            return ""


def zip_names(docx: Path) -> list[str]:
    try:
        with zipfile.ZipFile(docx) as archive:
            return archive.namelist()
    except zipfile.BadZipFile as exc:
        raise SystemExit(f"not a valid .docx zip container: {docx}: {exc}")


def style_ids(styles_xml: str) -> set[str]:
    return set(re.findall(r'w:styleId="([^"]+)"', styles_xml))


def has_macos_metadata(names: list[str]) -> bool:
    return any(
        name.startswith("._")
        or "/._" in name
        or name.startswith("__MACOSX")
        or "/__MACOSX" in name
        or name.endswith(".DS_Store")
        for name in names
    )


def inspect_docx(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise SystemExit(f"docx not found: {path}")
    if path.suffix.lower() != ".docx":
        raise SystemExit(f"expected .docx path: {path}")

    names = zip_names(path)
    document_xml = read_zip_text(path, "word/document.xml")
    styles_xml = read_zip_text(path, "word/styles.xml")
    content_types = read_zip_text(path, "[Content_Types].xml")
    return {
        "path": str(path),
        "size": path.stat().st_size,
        "hasContentTypes": "[Content_Types].xml" in names and bool(content_types),
        "hasDocumentXml": "word/document.xml" in names and bool(document_xml),
        "hasStylesXml": "word/styles.xml" in names and bool(styles_xml),
        "hasNumberingXml": "word/numbering.xml" in names,
        "hasThemeXml": "word/theme/theme1.xml" in names,
        "mediaCount": sum(1 for name in names if name.startswith("word/media/") and not name.endswith("/")),
        "headerCount": sum(1 for name in names if re.fullmatch(r"word/header\d+\.xml", name)),
        "footerCount": sum(1 for name in names if re.fullmatch(r"word/footer\d+\.xml", name)),
        "styleCount": len(style_ids(styles_xml)),
        "styleIds": sorted(style_ids(styles_xml)),
        "contentControlCount": len(re.findall(r"<w:sdt\b", document_xml)),
        "mergeFieldCount": len(re.findall(r"MERGEFIELD", document_xml, re.I)),
        "bracePlaceholderCount": len(re.findall(r"\{\{[^{}]{1,120}\}\}", document_xml)),
        "hasMacosMetadata": has_macos_metadata(names),
        "partCount": len(names),
    }


def status_for_template(info: dict[str, Any]) -> tuple[str, list[str], list[str]]:
    failures: list[str] = []
    warnings: list[str] = []
    if not info["hasContentTypes"]:
        failures.append("missing [Content_Types].xml")
    if not info["hasDocumentXml"]:
        failures.append("missing word/document.xml")
    if not info["hasStylesXml"]:
        failures.append("missing word/styles.xml")
    if info["styleCount"] == 0:
        failures.append("no style ids found in word/styles.xml")
    if info["hasMacosMetadata"]:
        failures.append("macOS metadata found inside docx")
    if not info["hasNumberingXml"]:
        warnings.append("word/numbering.xml not present; list style inheritance may be limited")
    if not info["hasThemeXml"]:
        warnings.append("word/theme/theme1.xml not present; theme inheritance may be limited")
    if info["contentControlCount"] or info["mergeFieldCount"] or info["bracePlaceholderCount"]:
        warnings.append("template contains placeholders/content controls; helper does not fill or validate placeholder contracts")
    return ("FAIL" if failures else "PASS_WITH_LIMITS"), failures, warnings


def compare_generated(template: dict[str, Any], generated: dict[str, Any]) -> dict[str, Any]:
    template_styles = set(template["styleIds"])
    generated_styles = set(generated["styleIds"])
    overlap = sorted(template_styles & generated_styles)
    return {
        "generatedPath": generated["path"],
        "generatedHasStylesXml": generated["hasStylesXml"],
        "generatedStyleCount": generated["styleCount"],
        "styleOverlapCount": len(overlap),
        "styleOverlapSample": overlap[:20],
        "status": "PASS_WITH_LIMITS" if generated["hasStylesXml"] and overlap else "PARTIAL",
    }


def write_summary(output: Path, report: dict[str, Any]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    template = report["template"]
    lines = [
        "# Company DOCX Template Validation",
        "",
        f"- Status: `{report['status']}`",
        f"- Template: `{template['path']}`",
        f"- Template size: `{template['size']}`",
        f"- Style count: `{template['styleCount']}`",
        f"- Numbering XML: `{template['hasNumberingXml']}`",
        f"- Theme XML: `{template['hasThemeXml']}`",
        f"- Media count: `{template['mediaCount']}`",
        f"- Content controls: `{template['contentControlCount']}`",
        f"- Merge fields: `{template['mergeFieldCount']}`",
        f"- Brace placeholders: `{template['bracePlaceholderCount']}`",
        "",
        "## Failures",
        "",
    ]
    failures = report["failures"]
    lines.extend([f"- {item}" for item in failures] if failures else ["- None"])
    lines.extend(["", "## Warnings", ""])
    warnings = report["warnings"]
    lines.extend([f"- {item}" for item in warnings] if warnings else ["- None"])
    if report.get("generatedComparison"):
        comparison = report["generatedComparison"]
        lines.extend(
            [
                "",
                "## Generated DOCX comparison",
                "",
                f"- Generated: `{comparison['generatedPath']}`",
                f"- Status: `{comparison['status']}`",
                f"- Generated has styles XML: `{comparison['generatedHasStylesXml']}`",
                f"- Style overlap count: `{comparison['styleOverlapCount']}`",
                f"- Style overlap sample: `{', '.join(comparison['styleOverlapSample'])}`",
            ]
        )
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "This helper validates a real .docx template or style source as OOXML input evidence only. It does not generate Word output, does not fill placeholders, does not require missing artifacts, does not run recipe repair, and does not decide installed chat/runtime S8 acceptance.",
            "",
        ]
    )
    output.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--template-docx", type=Path, required=True)
    parser.add_argument("--generated-docx", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional summary markdown output path. Kept for compatibility with older handoff text.",
    )
    args = parser.parse_args()

    if args.output_dir is not None and args.output is not None:
        raise SystemExit("use either --output-dir or --output, not both")
    if args.output_dir is None and args.output is None:
        raise SystemExit("one of --output-dir or --output is required")

    output_dir = args.output_dir if args.output_dir is not None else args.output.parent
    summary_path = output_dir / "summary.md" if args.output is None else args.output
    output_dir.mkdir(parents=True, exist_ok=True)

    template_info = inspect_docx(args.template_docx.resolve())
    status, failures, warnings = status_for_template(template_info)
    report: dict[str, Any] = {
        "status": status,
        "template": template_info,
        "failures": failures,
        "warnings": warnings,
    }
    if args.generated_docx is not None:
        generated_info = inspect_docx(args.generated_docx.resolve())
        report["generated"] = generated_info
        report["generatedComparison"] = compare_generated(template_info, generated_info)

    (output_dir / "company-docx-template-validation.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    write_summary(summary_path, report)
    print(f"Status: {status}")
    print(f"Summary: {summary_path}")
    return 0 if status != "FAIL" else 1


if __name__ == "__main__":
    raise SystemExit(main())
