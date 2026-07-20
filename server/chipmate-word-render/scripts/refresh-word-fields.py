#!/usr/bin/python3
"""Refresh safe Word fields through LibreOffice UNO without executing macros or links."""

import argparse
import json
import socket
import subprocess
import sys
import time
from pathlib import Path

import uno


BLOCKED_FIELD_SERVICES = (
    "com.sun.star.text.TextField.DDE",
    "com.sun.star.text.TextField.Database",
    "com.sun.star.text.TextField.DatabaseName",
    "com.sun.star.text.TextField.DatabaseNextSet",
    "com.sun.star.text.TextField.DatabaseNumberOfSet",
    "com.sun.star.text.TextField.DatabaseSetNumber",
    "com.sun.star.text.TextField.Script",
)


def prop(name, value):
    item = uno.createUnoStruct("com.sun.star.beans.PropertyValue")
    item.Name = name
    item.Value = value
    return item


def url(value):
    return uno.systemPathToFileUrl(str(Path(value).resolve()))


def port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.bind(("127.0.0.1", 0))
        return server.getsockname()[1]


def connect(selected, timeout):
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
    endpoint = f"uno:socket,host=127.0.0.1,port={selected};urp;StarOffice.ComponentContext"
    deadline = time.monotonic() + timeout
    error = None
    while time.monotonic() < deadline:
        try:
            return resolver.resolve(endpoint)
        except Exception as current:  # UNO raises generated exception types.
            error = current
            time.sleep(0.1)
    raise RuntimeError(f"UNO connection timed out: {error}")


def count_fields(fields):
    count = 0
    enum = fields.createEnumeration()
    while enum.hasMoreElements():
        enum.nextElement()
        count += 1
    return count


def refresh_fields(doc):
    indexes = doc.getDocumentIndexes()
    for index in range(indexes.getCount()):
        indexes.getByIndex(index).update()

    fields = doc.getTextFields()
    updated = 0
    skipped = 0
    enum = fields.createEnumeration()
    while enum.hasMoreElements():
        field = enum.nextElement()
        blocked = any(field.supportsService(service) for service in BLOCKED_FIELD_SERVICES)
        if blocked:
            skipped += 1
            continue
        if hasattr(field, "update"):
            field.update()
            updated += 1

    if hasattr(doc, "calculateAll"):
        doc.calculateAll()
    for index in range(indexes.getCount()):
        indexes.getByIndex(index).update()
    return indexes.getCount(), count_fields(fields), updated, skipped


def run(args):
    selected = port()
    accept = f"socket,host=127.0.0.1,port={selected};urp;StarOffice.ServiceManager"
    cmd = [
        args.soffice,
        "--headless",
        "--invisible",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--nofirststartwizard",
        "--norestore",
        f"-env:UserInstallation={url(args.profile)}",
        f"--accept={accept}",
    ]
    office = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    doc = None
    try:
        context = connect(selected, args.timeout)
        manager = context.ServiceManager
        desktop = manager.createInstanceWithContext("com.sun.star.frame.Desktop", context)
        load = (
            prop("Hidden", True),
            prop("ReadOnly", False),
            prop("MacroExecutionMode", 0),
            prop("UpdateDocMode", 0),
        )
        doc = desktop.loadComponentFromURL(url(args.input), "_blank", 0, load)
        if doc is None:
            raise RuntimeError("LibreOffice returned no document component")
        indexes, fields, updated, skipped = refresh_fields(doc)
        output = Path(args.output).resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        if output.exists():
            output.unlink()
        store = (prop("FilterName", "Office Open XML Text"), prop("Overwrite", True))
        doc.storeAsURL(url(output), store)
        doc.close(True)
        doc = None
        print(
            json.dumps(
                {
                    "ok": True,
                    "documentIndexes": indexes,
                    "textFields": fields,
                    "updatedTextFields": updated,
                    "skippedExternalFields": skipped,
                }
            )
        )
    finally:
        if doc is not None:
            try:
                doc.close(True)
            except Exception as error:
                print(json.dumps({"cleanupWarning": str(error)}), file=sys.stderr)
        office.terminate()
        try:
            office.wait(timeout=5)
        except subprocess.TimeoutExpired:
            office.kill()
            office.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--soffice", default="soffice")
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args()
    try:
        run(args)
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
