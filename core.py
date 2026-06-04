#!/usr/bin/env python3
"""
Core export logic – no terminal interaction.
"""

import concurrent.futures
import fnmatch
import hashlib
import json
import shutil
import tempfile
import time
import zipfile
import re
from pathlib import Path
from datetime import datetime
from packaging.version import Version

import requests
import yaml
from tqdm import tqdm

# --- Constants ---
MODRINTH_BASE = "https://api.modrinth.com/v2"
FABRIC_META = "https://meta.fabricmc.net/v2/versions/loader"
FALLBACK_LOADER = "0.18.3"
MAX_WORKERS = 10

# Cache file location: inside a "cache" folder next to this script
SCRIPT_DIR = Path(__file__).resolve().parent
CACHE_DIR = SCRIPT_DIR / "cache"
CACHE_FILE = CACHE_DIR / ".modpack_exporter_cache.json"

# --- Cache ---
class Cache:
    def __init__(self, path):
        self.path = path
        self.data = {}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            try:
                self.data = json.loads(path.read_text())
            except: pass
    def save(self):
        self.path.write_text(json.dumps(self.data, indent=2))
    def get(self, sha1):
        return self.data.get(sha1)
    def set(self, sha1, entry):
        self.data[sha1] = entry
        self.save()

cache = Cache(CACHE_FILE)

# --- Helpers ---
def sha1sum(p): return hashlib.sha1(p.read_bytes()).hexdigest()
def sha256sum(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def sha512sum(p): return hashlib.sha512(p.read_bytes()).hexdigest()

def get_mod_id(jar):
    try:
        with zipfile.ZipFile(jar) as z:
            if 'fabric.mod.json' in z.namelist():
                return json.loads(z.read('fabric.mod.json')).get('id')
    except: pass
    return None

def matches_any(name, patterns):
    for p in patterns:
        if fnmatch.fnmatch(name, p): return True
    return False

def copy_recursive(src, dst, bar=None, exclude_subfolders=None, parent_key=""):
    if not src.exists():
        return
    if parent_key:
        current_key = parent_key
    else:
        current_key = src.name

    if src.is_file():
        shutil.copy2(src, dst)
        if bar: bar.update(1)
        return

    dst.mkdir(parents=True, exist_ok=True)
    exclusions = []
    if exclude_subfolders:
        exclusions = exclude_subfolders.get(src.name, [])
        if parent_key and parent_key in exclude_subfolders:
            exclusions.extend(exclude_subfolders[parent_key])

    for child in src.iterdir():
        if child.is_dir() and child.name in exclusions:
            print(f"[*] Skipping excluded folder: {child.relative_to(src.parent)}")
            continue
        new_parent = f"{parent_key}/{child.name}" if parent_key else child.name
        copy_recursive(child, dst / child.name, bar, exclude_subfolders, new_parent)

def detect_versions(root, fallback_mc, config_loader_version=None):
    mc = fallback_mc
    loader = config_loader_version

    mmc = root / "mmc-pack.json"
    if mmc.exists():
        try:
            data = json.loads(mmc.read_text())
            for comp in data.get("components", []):
                if comp.get("uid") == "net.minecraft":
                    mc = comp.get("version", mc)
                if not loader and comp.get("uid") == "net.fabricmc.fabric-loader":
                    v = comp.get("version")
                    if any(c in v for c in "><="):
                        r = requests.get(FABRIC_META, timeout=5)
                        if r.ok:
                            for l in r.json():
                                if l.get("stable"):
                                    loader = l.get("version")
                                    break
                    else:
                        loader = v
        except: pass

    if not loader:
        loader = FALLBACK_LOADER
    return mc, loader

def resolve_mod_metadata(sha1):
    cached = cache.get(sha1)
    if cached: return cached
    url = f"{MODRINTH_BASE}/version_file/{sha1}?algorithm=sha1"
    r = requests.get(url, timeout=10)
    if r.status_code != 200: return None
    data = r.json()
    project_id = data.get("project_id")
    version = data.get("version_number", "")
    env = {"client": "required", "server": "optional"}
    title = None
    if project_id:
        rp = requests.get(f"{MODRINTH_BASE}/project/{project_id}", timeout=5)
        if rp.ok:
            proj = rp.json()
            env["client"] = proj.get("client_side", "required")
            env["server"] = proj.get("server_side", "optional")
            title = proj.get("title")
    downloads = [f["url"] for f in data.get("files", []) if "url" in f]
    sha512 = next((f.get("hashes", {}).get("sha512") for f in data.get("files", []) if "hashes" in f), None)
    entry = {
        "downloads": downloads,
        "sha512": sha512,
        "env": env,
        "project_id": project_id,
        "version": version,
        "title": title
    }
    cache.set(sha1, entry)
    return entry

def process_jar(jar):
    sha1 = sha1sum(jar)
    meta = resolve_mod_metadata(sha1)
    if not meta or not meta.get("downloads"): return None, jar
    return {
        "path": f"mods/{jar.name}",
        "downloads": meta["downloads"],
        "hashes": {"sha1": sha1, "sha512": meta.get("sha512") or sha512sum(jar), "sha256": sha256sum(jar)},
        "fileSize": jar.stat().st_size,
        "env": meta["env"],
        "filename": jar.name,
        "sha1": sha1,
        "mod_id": get_mod_id(jar),
        "title": meta.get("title"),
        "version": meta.get("version"),
    }, None

def build_index(mods_dir, whitelist=None):
    entries, unresolved = [], []
    if not mods_dir.exists(): return entries, unresolved
    jars = list(mods_dir.glob("*.jar"))
    filtered = []
    for j in jars:
        if whitelist is not None:
            mod_id = get_mod_id(j)
            if (mod_id and mod_id in whitelist) or j.name in whitelist:
                filtered.append(j)
        else:
            filtered.append(j)
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(process_jar, j): j for j in filtered}
        for f in concurrent.futures.as_completed(futures):
            entry, fail = f.result()
            if entry: entries.append(entry)
            if fail: unresolved.append(fail)
    return entries, unresolved

def hash_directory(dir_path):
    h = hashlib.sha256()
    files = sorted(dir_path.rglob("*"))
    for f in files:
        if f.is_file():
            rel = f.relative_to(dir_path)
            h.update(rel.as_posix().encode())
            h.update(f.read_bytes())
    return h.hexdigest()

def scan_files_hash(root, include_folders, include_files):
    file_map = {}
    for name in include_folders:
        p = root / name
        if not p.exists(): continue
        if name == "resourcepacks":
            for child in p.iterdir():
                if child.is_file():
                    rel = child.relative_to(root).as_posix()
                    file_map[rel] = sha256sum(child)
                elif child.is_dir():
                    rel = child.relative_to(root).as_posix()
                    file_map[rel] = hash_directory(child)
        else:
            for f in p.rglob("*"):
                if f.is_file():
                    rel = f.relative_to(root).as_posix()
                    file_map[rel] = sha256sum(f)
    for name in include_files:
        p = root / name
        if p.exists():
            rel = p.relative_to(root).as_posix()
            file_map[rel] = sha256sum(p)
    return file_map

def clean_resource_pack_name(name):
    if name.endswith('.zip'):
        name = name[:-4]
    name = name.replace('_', ' ')
    words = name.split()
    name = ' '.join(w.capitalize() for w in words)
    return name

def get_mod_display_name(entry):
    if entry.get("title") and entry.get("version"):
        version = entry["version"]
        version = re.sub(r'^v', '', version)
        return f"{entry['title']} ({version})"
    elif entry.get("title"):
        return entry["title"]
    else:
        return entry["filename"].replace(".jar", "")

def generate_changelog(old_manifest, new_entries, new_unresolved, root, version, pack_name, export_dir, include_folders, include_files):
    new_mod_map = {e["filename"]: e for e in new_entries}
    for u in new_unresolved:
        new_mod_map[u.name] = {"filename": u.name, "title": None, "version": None, "unresolved": True}

    old_mod_map = {}
    if old_manifest:
        old_mod_map = {m["filename"]: m for m in old_manifest.get("mods", [])}

    mods_added = []
    mods_removed = []
    mods_updated = []
    for fn, new_entry in new_mod_map.items():
        if fn not in old_mod_map:
            mods_added.append(new_entry)
        else:
            old_entry = old_mod_map[fn]
            if new_entry.get("version") != old_entry.get("version") or new_entry.get("title") != old_entry.get("title"):
                mods_updated.append(new_entry)

    for fn, old_entry in old_mod_map.items():
        if fn not in new_mod_map:
            mods_removed.append(old_entry)

    new_files = scan_files_hash(root, include_folders, include_files)
    old_files = old_manifest.get("files", {}) if old_manifest else {}
    files_added = [f for f in new_files if f not in old_files]
    files_removed = [f for f in old_files if f not in new_files]
    files_changed = [f for f in new_files if f in old_files and new_files[f] != old_files[f]]

    rp_added = [f.replace('resourcepacks/', '') for f in files_added if f.startswith("resourcepacks/")]
    rp_removed = [f.replace('resourcepacks/', '') for f in files_removed if f.startswith("resourcepacks/")]
    rp_changed = [f.replace('resourcepacks/', '') for f in files_changed if f.startswith("resourcepacks/")]

    def format_mod(mod):
        if mod.get("unresolved"):
            return mod["filename"]
        return get_mod_display_name(mod)

    def format_rp(name):
        return clean_resource_pack_name(name)

    changes = {
        "added": sorted([format_mod(m) for m in mods_added] + [format_rp(r) for r in rp_added]),
        "removed": sorted([format_mod(m) for m in mods_removed] + [format_rp(r) for r in rp_removed]),
        "updated": sorted([format_mod(m) for m in mods_updated] + [format_rp(r) for r in rp_changed])
    }

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [f"# {pack_name} {version} ({timestamp})", ""]
    if changes["added"] or changes["removed"] or changes["updated"]:
        if changes["added"]: lines.extend(["## Added"] + [f"- {m}" for m in changes["added"]] + [""])
        if changes["removed"]: lines.extend(["## Removed"] + [f"- {m}" for m in changes["removed"]] + [""])
        if changes["updated"]: lines.extend(["## Updated"] + [f"- {m}" for m in changes["updated"]] + [""])
    else:
        lines.append("- No tracked changes detected.")
    content = "\n".join(lines)
    out = export_dir / f"{pack_name} {version} Changelog.md"
    out.write_text(content, encoding="utf8")
    return changes, new_files

def package(stage, outpath):
    outpath.parent.mkdir(parents=True, exist_ok=True)
    if outpath.exists(): outpath.unlink()
    override_root = stage / "overrides"
    files = list(override_root.rglob("*"))
    with zipfile.ZipFile(outpath, "w", compression=zipfile.ZIP_DEFLATED) as z, tqdm(total=len(files)+1, desc="Packaging", leave=False) as bar:
        z.write(stage / "modrinth.index.json", arcname="modrinth.index.json")
        bar.update(1)
        for f in files:
            z.write(f, arcname=str(f.relative_to(stage)))
            bar.update(1)
    return outpath

def write_index(stage, pack_name, pack_version, entries, mc_ver, loader_ver):
    idx = {
        "formatVersion": 1,
        "game": "minecraft",
        "name": pack_name,
        "versionId": pack_version,
        "dependencies": {"minecraft": mc_ver, "fabric-loader": loader_ver},
        "files": entries
    }
    (stage / "modrinth.index.json").write_text(json.dumps(idx, indent=2))

def update_simpleupdatechecker(root, version, modrinth_id):
    path = root / "config" / "simpleupdatechecker_modpack.json"
    if not path.exists(): return
    try:
        data = json.loads(path.read_text())
        data["version_id"] = version
        data["display_version"] = version
        path.write_text(json.dumps(data, indent=2))
    except: pass

def update_fancymenu(root):
    var = root / "config" / "fancymenu" / "user_variables.db"
    if not var.exists(): return
    try:
        lines = var.read_text().splitlines()
        new = []
        inside = False
        for line in lines:
            if "name = rp_prompt" in line: inside = True
            if inside and "value =" in line:
                if "true" in line:
                    new.append(line.replace("true", "false"))
                else:
                    new.append(line)
                inside = False
            else:
                new.append(line)
            if inside and "name =" in line and "rp_prompt" not in line:
                inside = False
        if new != lines:
            var.write_text("\n".join(new))
    except: pass

def update_options(root):
    opt = root / "options.txt"
    if not opt.exists(): return
    lines = opt.read_text().splitlines()
    new = []
    for line in lines:
        if line.startswith("guiScale:") and line.split(":",1)[1].strip() != "0":
            new.append("guiScale:0")
        else:
            new.append(line)
    if new != lines:
        opt.write_text("\n".join(new))

def get_latest_modrinth_version(project_id):
    if not project_id: return None
    try:
        r = requests.get(f"{MODRINTH_BASE}/project/{project_id}/version", timeout=5)
        if r.ok:
            versions = r.json()
            if versions: return versions[0].get("version_number")
    except: pass
    return None

def ensure_gitignore(root):
    gitignore = root / ".gitignore"
    patterns = [
        "# Modpack Exporter ignores",
        "mods/",
        "config/",
        "resourcepacks/",
        "shaderpacks/",
        "essential/",
        "fancymenu_data/",
        "data/",
        "keybind_presets/",
        "configureddefaults/",
        "checkbox_states.json",
        "emi.json",
        ".modpack_exporter_cache.json",
        "config_backup/",
        "*.mrpack",
        "Modpack Export/",
        "*/cache/",
    ]
    if gitignore.exists():
        current = gitignore.read_text(encoding="utf-8")
    else:
        current = ""
    for pattern in patterns:
        if pattern not in current:
            current += pattern + "\n"
    gitignore.write_text(current, encoding="utf-8")

def upload_github(root, version, github_repo, github_branch, manifest_path, changelog_path, config_path):
    if not github_repo: return
    import subprocess, webbrowser

    def git(cmd):
        cmd = cmd[:1] + ["-c", f"safe.directory={root.resolve()}"] + cmd[1:]
        subprocess.run(cmd, cwd=root, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

    ensure_gitignore(root)

    try:
        current_remote = subprocess.run(["git", "remote", "get-url", "origin"], cwd=root, capture_output=True, text=True)
        if current_remote.returncode != 0 or current_remote.stdout.strip() != github_repo:
            if current_remote.returncode == 0:
                git(["git", "remote", "set-url", "origin", github_repo])
                print("[*] Updated remote URL to", github_repo)
            else:
                git(["git", "remote", "add", "origin", github_repo])
                print("[*] Added remote origin")
    except Exception as e:
        print(f"[!] Failed to set remote URL: {e}")

    try:
        result = subprocess.run(["git", "tag", "-l", version], cwd=root, capture_output=True, text=True)
        if result.stdout.strip() == version:
            print(f"[!] Tag '{version}' already exists in repository. Skipping GitHub push.")
            print("[*] You can still export locally.")
            return

        if not (root / ".git").exists():
            print("[*] Initializing Git Repo...")
            git(["git", "init"])
            git(["git", "branch", "-M", github_branch])
            git(["git", "remote", "add", "origin", github_repo])
            ensure_gitignore(root)
            git(["git", "add", ".gitignore"])
            git(["git", "commit", "-m", "Initial .gitignore"])

        files_to_add = []
        if manifest_path.exists():
            files_to_add.append(manifest_path)
        if changelog_path.exists():
            files_to_add.append(changelog_path)
        if config_path.exists():
            files_to_add.append(config_path)

        for f in files_to_add:
            git(["git", "add", "--force", str(f)])

        status = subprocess.run(["git", "status", "--porcelain"], cwd=root, capture_output=True, text=True)
        if not status.stdout.strip():
            print("[*] No changes to commit. Skipping GitHub push.")
            return

        git(["git", "commit", "-m", f"Release {version}"])
        git(["git", "push", "-u", "origin", github_branch])
        git(["git", "tag", version])
        git(["git", "push", "origin", version])
        print("[+] GitHub sync complete (metadata files pushed).")
        webbrowser.open(github_repo.replace(".git", ""))
    except Exception as e:
        print(f"[!] Git sync failed: {e}")

def find_previous_manifest(version, is_lite, root):
    manifest_dir = root / "manifests"
    if not manifest_dir.exists():
        return None
    prefix = "modpack_manifest_lite_" if is_lite else "modpack_manifest_"
    suffix = ".json"
    existing = []
    for f in manifest_dir.glob(f"{prefix}*{suffix}"):
        name = f.name
        version_str = name[len(prefix):-len(suffix)]
        try:
            v = Version(version_str)
            existing.append((v, f))
        except:
            continue
    if not existing:
        return None
    current_v = Version(version.split('-')[0])
    candidates = [(v, f) for v, f in existing if v < current_v]
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0])
    return candidates[-1][1]

def build_export(root, config, pack_name, pack_version, is_lite, is_release, export_dir, embed_unresolved=True):
    include_folders = config.get("include_folders", [])
    include_files = config.get("include_files", [])
    config_exclude = set(config.get("config_exclude", []))
    lite_mods = set(config.get("lite_whitelist", {}).get("mods", []))
    lite_rps = set(config.get("lite_whitelist", {}).get("resource_packs", []))
    modrinth_id = config.get("lite_modrinth_id" if is_lite else "modrinth_id", "")
    github_repo = config.get("github_repo", "")
    github_branch = config.get("github_branch", "main")
    fallback_mc = config.get("minecraft_version", "1.21.1")
    config_loader_version = config.get("fabric_loader_version")   # <-- new
    exclude_subfolders = config.get("exclude_subfolders", {})

    mc_ver, loader_ver = detect_versions(root, fallback_mc, config_loader_version)   # <-- pass it

    if is_release:
        update_simpleupdatechecker(root, pack_version, modrinth_id)
        update_fancymenu(root)
        update_options(root)

    previous_manifest_path = find_previous_manifest(pack_version, is_lite, root)
    old_manifest = None
    if previous_manifest_path and previous_manifest_path.exists():
        try:
            old_manifest = json.loads(previous_manifest_path.read_text())
        except: pass

    with tempfile.TemporaryDirectory() as tmpdir:
        stage = Path(tmpdir)
        for name in include_folders:
            src = root / name
            if src.exists():
                copy_recursive(src, stage / "overrides" / name, bar=None, exclude_subfolders=exclude_subfolders)

        for name in include_files:
            src = root / name
            if src.exists():
                copy_recursive(src, stage / "overrides" / name, bar=None, exclude_subfolders=exclude_subfolders)

        mods_dir = root / "mods"
        whitelist = lite_mods if is_lite else None
        entries, unresolved = build_index(mods_dir, whitelist)

        if is_lite:
            rp_dst = stage / "overrides" / "resourcepacks"
            if lite_rps:
                rp_dst.mkdir(parents=True, exist_ok=True)
                for rp in lite_rps:
                    src = root / "resourcepacks" / rp
                    if src.exists():
                        shutil.copy2(src, rp_dst / rp)
            else:
                if rp_dst.exists():
                    shutil.rmtree(rp_dst)
                rp_dst.mkdir(parents=True, exist_ok=True)

        if unresolved:
            if embed_unresolved:
                dst_mods = stage / "overrides" / "mods"
                dst_mods.mkdir(parents=True, exist_ok=True)
                for j in unresolved:
                    shutil.copy2(j, dst_mods / j.name)
                (stage / "UNRESOLVED_MODS.txt").write_text("These mods could not be resolved on Modrinth.\n")
            else:
                return None, None, None, None, None

        changes = None
        new_files = {}
        if is_release:
            changes, new_files = generate_changelog(
                old_manifest, entries, unresolved, root, pack_version, pack_name, export_dir,
                include_folders, include_files
            )
            manifest_dir = root / "manifests"
            manifest_dir.mkdir(exist_ok=True)
            prefix = "modpack_manifest_lite_" if is_lite else "modpack_manifest_"
            manifest_path = manifest_dir / f"{prefix}{pack_version}.json"
            manifest = {"generated_at": time.time(), "mods": [], "files": new_files}
            for e in entries:
                manifest["mods"].append({
                    "filename": e["filename"],
                    "sha1": e["hashes"]["sha1"],
                    "url": e["downloads"][0] if e["downloads"] else None,
                    "title": e.get("title"),
                    "version": e.get("version")
                })
            for j in unresolved:
                manifest["mods"].append({"filename": j.name, "sha1": sha1sum(j), "url": None, "unresolved": True})
            manifest_path.write_text(json.dumps(manifest, indent=2))

        write_index(stage, pack_name, pack_version, entries, mc_ver, loader_ver)
        outpath = export_dir / f"{pack_name} {pack_version}.mrpack"
        result = package(stage, outpath)

    if is_release:
        if is_lite:
            config["lite_version"] = pack_version
        else:
            config["version"] = pack_version
        config_path = Path(__file__).parent.parent / "config.yaml"
        with open(config_path, 'w') as f:
            yaml.dump(config, f, sort_keys=False)

        manifest_dir = root / "manifests"
        prefix = "modpack_manifest_lite_" if is_lite else "modpack_manifest_"
        manifest_path = manifest_dir / f"{prefix}{pack_version}.json"
        changelog_path = export_dir / f"{pack_name} {pack_version} Changelog.md"
        upload_github(root, pack_version, github_repo, github_branch, manifest_path, changelog_path, config_path)

    stats = {"total": len(entries) + len(unresolved), "resolved": len(entries), "embedded": len(unresolved)}
    return result, mc_ver, loader_ver, stats, changes