#!/usr/bin/env python3
"""
Thin CLI wrapper for core.build_export.
Prints a single JSON result line on stdout.

Usage:
  python export_runner.py <root> <config_path> <pack_name> <version>
                          <is_lite> <is_release> <export_dir>
"""

import json
import sys
import traceback
from pathlib import Path

# Ensure core.py is importable
sys.path.insert(0, str(Path(__file__).resolve().parent))

import yaml
from core import build_export


def main():
    if len(sys.argv) < 8:
        print(json.dumps({"success": False, "error": "Missing arguments"}))
        sys.exit(1)

    root       = Path(sys.argv[1])
    config_path = Path(sys.argv[2])
    pack_name  = sys.argv[3]
    version    = sys.argv[4]
    is_lite    = sys.argv[5].lower() == "true"
    is_release = sys.argv[6].lower() == "true"
    export_dir = Path(sys.argv[7])

    export_dir.mkdir(parents=True, exist_ok=True)

    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    # Strip github_repo so core.py doesn't try to push – Electron handles that.
    config_for_export = dict(config)
    config_for_export["github_repo"] = ""

    try:
        result, mc_ver, loader_ver, stats, changes = build_export(
            root, config_for_export, pack_name, version,
            is_lite, is_release, export_dir, embed_unresolved=True
        )

        # core.py writes config to an incorrect path (parent.parent) when is_release=True.
        # Write to the correct path here.
        if result and is_release:
            key = "lite_version" if is_lite else "version"
            config[key] = version
            with open(config_path, "w", encoding="utf-8") as f:
                yaml.dump(config, f, sort_keys=False)

        print(json.dumps({
            "success": result is not None,
            "output_path": str(result) if result else None,
            "mc_version": mc_ver,
            "loader_version": loader_ver,
            "stats": stats,
            "changes": changes,
        }))

    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc(),
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
