"""Atualização automática da Astra a partir das releases do GitHub."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("ASTRA_DATA_DIR", Path(os.environ.get("LOCALAPPDATA", ROOT)) / "Astra"))
VERSION_FILE = ROOT / "version.json"
APP_FILES = (
    "assistant.py", "backup.py", "updater.py", "version.json",
    "start_astra.bat", "README.md", "web/index.html", "web/app.js", "web/style.css",
)
MAX_ARCHIVE_BYTES = 25 * 1024 * 1024


def installed() -> dict:
    return json.loads(VERSION_FILE.read_text(encoding="utf-8"))


def version_tuple(value: str) -> tuple[int, int, int]:
    bits = value.removeprefix("v").split(".")
    if len(bits) != 3 or any(not bit.isdecimal() for bit in bits):
        raise ValueError(f"Versão inválida: {value}")
    return tuple(int(bit) for bit in bits)


def open_url(url: str, *, timeout=15):
    request = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "Astra-Windows-Updater/0.1",
    })
    return urllib.request.urlopen(request, timeout=timeout)


def latest_release() -> dict | None:
    config = installed()
    repository = config["repository"]
    url = f"https://api.github.com/repos/{repository}/releases/latest"
    try:
        with open_url(url) as response:
            release = json.load(response)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise
    tag = release.get("tag_name", "")
    if version_tuple(tag) <= version_tuple(config["version"]):
        return None
    archive_url = release.get("zipball_url", "")
    expected_prefix = f"https://api.github.com/repos/{repository}/zipball/"
    if not archive_url.startswith(expected_prefix):
        raise ValueError("URL da release não pertence ao repositório configurado")
    return {"version": tag.removeprefix("v"), "url": archive_url,
            "release_page": release.get("html_url", "")}


def stage_release(release: dict) -> Path:
    DATA.mkdir(parents=True, exist_ok=True)
    staging = DATA / "updates" / f"stage-{release['version']}"
    staging.mkdir(parents=True, exist_ok=True)
    archive = staging / "source.zip"
    with open_url(release["url"], timeout=45) as response, archive.open("wb") as target:
        total = 0
        while chunk := response.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_ARCHIVE_BYTES:
                raise ValueError("Release excede 25 MB")
            target.write(chunk)
    with zipfile.ZipFile(archive) as package:
        members = {name.split("/", 1)[1]: name for name in package.namelist() if "/" in name}
        if not all(name in members for name in APP_FILES):
            raise ValueError("Release incompleta")
        version = json.loads(package.read(members["version.json"]))
        if version != {"version": release["version"], "repository": installed()["repository"]}:
            raise ValueError("Versão ou repositório da release não confere")
        for name in APP_FILES:
            info = package.getinfo(members[name])
            if info.file_size > 3 * 1024 * 1024:
                raise ValueError(f"Arquivo muito grande na release: {name}")
            destination = staging / "files" / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(package.read(info))
    return staging / "files"


def apply_staged(staging: Path) -> Path:
    version = json.loads((staging / "version.json").read_text(encoding="utf-8"))["version"]
    rollback = DATA / "updates" / f"rollback-{installed()['version']}"
    rollback.mkdir(parents=True, exist_ok=True)
    changed = []
    try:
        for name in APP_FILES:
            source = staging / name
            destination = ROOT / name
            old = rollback / name
            old.parent.mkdir(parents=True, exist_ok=True)
            if destination.is_file():
                shutil.copy2(destination, old)
            destination.parent.mkdir(parents=True, exist_ok=True)
            handle, temp_name = tempfile.mkstemp(prefix=".astra-update-", dir=destination.parent)
            os.close(handle)
            temp = Path(temp_name)
            try:
                shutil.copy2(source, temp)
                os.replace(temp, destination)
                changed.append((destination, old))
            finally:
                temp.unlink(missing_ok=True)
    except Exception:
        for destination, old in reversed(changed):
            if old.is_file():
                shutil.copy2(old, destination)
        raise
    (DATA / "update-status.json").write_text(json.dumps({"version": version, "status": "installed"}), encoding="utf-8")
    return rollback


def port_available(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return False
    except OSError:
        return True


def launch(port: int):
    python = Path(sys.executable)
    if python.name.lower() == "python.exe" and python.with_name("pythonw.exe").is_file():
        python = python.with_name("pythonw.exe")
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    subprocess.Popen([str(python), str(ROOT / "assistant.py"), "--no-browser", "--port", str(port)],
                     cwd=ROOT, creationflags=flags, close_fds=True)


def worker(staging: Path, port: int):
    status = DATA / "update-status.json"
    try:
        for _ in range(60):
            if port_available(port):
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("Astra antiga não encerrou em 30 segundos")
        rollback = apply_staged(staging)
        launch(port)
        for _ in range(40):
            if not port_available(port):
                return
            time.sleep(0.5)
        for name in APP_FILES:
            old = rollback / name
            if old.is_file():
                shutil.copy2(old, ROOT / name)
        launch(port)
        raise RuntimeError("A versão nova não iniciou; arquivos antigos restaurados")
    except Exception as exc:
        DATA.mkdir(parents=True, exist_ok=True)
        status.write_text(json.dumps({"status": "error", "error": str(exc)}, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", type=Path, required=True)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    worker(args.apply, args.port)
