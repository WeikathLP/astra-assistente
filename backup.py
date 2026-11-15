"""Cópias consistentes da memória SQLite da Astra."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
import tempfile
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path


def default_cloud_dir() -> Path:
    root = Path(os.environ.get("OneDrive", Path.home() / "OneDrive"))
    return root / "Astra" / "Backups"


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def valid_database(path: Path) -> bool:
    if not path.is_file():
        return False
    try:
        with closing(sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)) as db:
            return db.execute("PRAGMA quick_check").fetchone()[0] == "ok"
    except (sqlite3.Error, OSError):
        return False


def atomic_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".astra-", dir=destination.parent)
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        with source.open("rb") as src, tmp.open("wb") as dst:
            for chunk in iter(lambda: src.read(1024 * 1024), b""):
                dst.write(chunk)
            dst.flush()
            os.fsync(dst.fileno())
        os.replace(tmp, destination)
    finally:
        tmp.unlink(missing_ok=True)


def snapshot(db_path: Path, local_dir: Path, cloud_dir: Path | None) -> dict:
    if not db_path.is_file():
        raise FileNotFoundError(f"Memória não encontrada: {db_path}")
    local_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    name = f"astra-{stamp}.sqlite3"
    target = local_dir / name
    source = sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)
    try:
        with closing(sqlite3.connect(target)) as output:
            source.backup(output)
    finally:
        source.close()
    if not valid_database(target):
        target.unlink(missing_ok=True)
        raise RuntimeError("O backup do SQLite não passou na verificação de integridade")
    checksum = digest(target)
    metadata = {"file": name, "sha256": checksum, "created_utc": stamp}
    sidecar = target.with_suffix(".json")
    sidecar.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    cloud_result = None
    cloud_error = None
    if cloud_dir is not None:
        try:
            cloud_target = cloud_dir / name
            atomic_copy(target, cloud_target)
            atomic_copy(sidecar, cloud_target.with_suffix(".json"))
            if digest(cloud_target) != checksum:
                raise RuntimeError("A cópia do OneDrive não corresponde ao backup local")
            cloud_result = str(cloud_target)
        except (OSError, RuntimeError) as exc:
            cloud_error = str(exc)
    prune(local_dir, 30)
    if cloud_result:
        prune(cloud_dir, 90)
    return {"local": str(target), "cloud": cloud_result,
            "cloud_error": cloud_error, "sha256": checksum, "bytes": target.stat().st_size}


def prune(directory: Path, keep: int) -> None:
    backups = sorted(directory.glob("astra-*.sqlite3"), reverse=True)
    for old in backups[keep:]:
        old.unlink(missing_ok=True)
        old.with_suffix(".json").unlink(missing_ok=True)


def restore(backup_file: Path, db_path: Path) -> dict:
    backup_file = backup_file.resolve()
    if not valid_database(backup_file):
        raise ValueError("Backup inválido ou corrompido")
    sidecar = backup_file.with_suffix(".json")
    if sidecar.is_file():
        expected = json.loads(sidecar.read_text(encoding="utf-8")).get("sha256")
        if expected != digest(backup_file):
            raise ValueError("O SHA-256 do backup não corresponde ao manifesto")
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.is_file():
        safety = db_path.with_name("astra-before-restore.sqlite3")
        atomic_copy(db_path, safety)
    else:
        safety = None
    atomic_copy(backup_file, db_path)
    if not valid_database(db_path):
        if safety:
            atomic_copy(safety, db_path)
        raise RuntimeError("Falha na verificação após restaurar")
    return {"restored": str(db_path), "from": str(backup_file),
            "previous": str(safety) if safety else None}


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "restore":
        raise SystemExit("Uso: python backup.py restore CAMINHO_DO_BACKUP.sqlite3")
    data = Path(os.environ.get("ASTRA_DATA_DIR", Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Astra"))
    print(json.dumps(restore(Path(sys.argv[2]), data / "astra.db"), ensure_ascii=False, indent=2))
