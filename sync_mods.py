#!/usr/bin/env python3
"""
sync_mods.py – Download mods from the latest manifest, verify SHA1 checksums,
and report (or remove) extra local mods.

Each progress/result line is a JSON object written to stdout.
The Electron app reads these lines to display progress.

Usage:
  python sync_mods.py --root <modpack_root> [--manifest <path>] [--auto-delete]
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

import requests


def sha1sum(p: Path) -> str:
    return hashlib.sha1(p.read_bytes()).hexdigest()


def emit(obj: dict):
    print(json.dumps(obj), flush=True)


def find_latest_manifest(root: Path) -> Path | None:
    manifest_dir = root / "manifests"
    if not manifest_dir.exists():
        return None
    # Prefer standard over lite
    candidates = sorted(manifest_dir.glob("modpack_manifest_*.json"))
    standard = [m for m in candidates if "lite" not in m.name]
    return (standard or candidates or [None])[-1]


def download_file(url: str, dest: Path, expected_sha1: str | None) -> bool:
    try:
        r = requests.get(url, timeout=60, stream=True)
        r.raise_for_status()
        dest.write_bytes(r.content)
        if expected_sha1 and sha1sum(dest) != expected_sha1:
            dest.unlink(missing_ok=True)
            return False
        return True
    except Exception as exc:
        emit({"type": "error", "message": f"Download failed for {dest.name}: {exc}"})
        return False


def sync(root: Path, mods_dir: Path, manifest_path: Path, auto_delete: bool):
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    mods = manifest.get("mods", [])

    downloaded, verified, failed, extra_found, deleted = [], [], [], [], []

    local_jars = {p.name for p in mods_dir.glob("*.jar")} if mods_dir.exists() else set()
    manifest_names = {m["filename"] for m in mods if not m.get("unresolved")}

    for mod in mods:
        filename = mod["filename"]
        sha1 = mod.get("sha1")
        url = mod.get("url")
        dest = mods_dir / filename

        emit({"type": "progress", "filename": filename})

        if dest.exists():
            if sha1 and sha1sum(dest) != sha1:
                emit({"type": "info", "message": f"Re-downloading {filename} (SHA1 mismatch)"})
                dest.unlink()
            else:
                verified.append(filename)
                continue

        if not url:
            emit({"type": "warn", "message": f"No URL for {filename}, skipping"})
            failed.append(filename)
            continue

        mods_dir.mkdir(parents=True, exist_ok=True)
        if download_file(url, dest, sha1):
            downloaded.append(filename)
        else:
            failed.append(filename)

    extra_found = list(local_jars - manifest_names)
    if auto_delete:
        for name in extra_found:
            p = mods_dir / name
            if p.exists():
                p.unlink()
                deleted.append(name)
                emit({"type": "info", "message": f"Deleted extra mod: {name}"})

    emit({
        "type": "result",
        "downloaded": downloaded,
        "verified": verified,
        "failed": failed,
        "extra": extra_found,
        "deleted": deleted,
    })


def main():
    parser = argparse.ArgumentParser(description="Sync mods from latest manifest")
    parser.add_argument("--root", default=".", help="Modpack root directory")
    parser.add_argument("--manifest", default=None, help="Override manifest path")
    parser.add_argument("--auto-delete", action="store_true", help="Delete extra local mods")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    mods_dir = root / "mods"

    manifest_path = Path(args.manifest) if args.manifest else find_latest_manifest(root)
    if not manifest_path or not manifest_path.exists():
        emit({"type": "error", "message": "No manifest found. Run an export first."})
        sys.exit(1)

    emit({"type": "info", "message": f"Using manifest: {manifest_path.name}"})
    sync(root, mods_dir, manifest_path, auto_delete=args.auto_delete)


if __name__ == "__main__":
    main()
