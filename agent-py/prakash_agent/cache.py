"""Disk cache for anything expensive: page fetches, model replies, image bytes.

Re-running a sheet after fixing three rows should not re-pay for the other two
hundred, so every network boundary goes through here.
"""

from __future__ import annotations

import gzip
import json
import os
import time
from pathlib import Path
from typing import Any

from .util import sha256


class Cache:
    def __init__(self, root: Path, enabled: bool = True, max_bytes: int | None = None) -> None:
        self.root = root
        self.enabled = enabled
        self.hits = 0
        self.misses = 0
        if max_bytes is None:
            try:
                max_bytes = int(float(os.getenv("AGENT_CACHE_MAX_MB", "512")) * 1024 * 1024)
            except ValueError:
                max_bytes = 512 * 1024 * 1024
        self.max_bytes = max(0, max_bytes)
        self._known_bytes: int | None = None
        self._writes_since_scan = 0

    def _path(self, namespace: str, key: str, ext: str) -> Path:
        return self.root / namespace / f"{sha256(key)}.{ext}"

    def _scan(self) -> tuple[int, list[tuple[float, int, Path]]]:
        total = 0
        files: list[tuple[float, int, Path]] = []
        try:
            paths = self.root.rglob("*")
            for path in paths:
                try:
                    stat = path.stat()
                except OSError:
                    continue
                if not path.is_file() or path.is_symlink():
                    continue
                total += stat.st_size
                files.append((stat.st_mtime, stat.st_size, path))
        except OSError:
            pass
        return total, files

    def _after_write(self, previous_bytes: int, new_bytes: int) -> None:
        """Keep reproducible cache files from filling the shop's data disk.

        A full scan happens on the first write and every 32 writes after that.
        Between scans this process tracks its own size changes, so a large cached
        storefront catalogue still triggers eviction immediately.
        """
        if not self.max_bytes:
            return

        self._writes_since_scan += 1
        if self._known_bytes is None or self._writes_since_scan >= 32:
            total, files = self._scan()
            self._writes_since_scan = 0
        else:
            self._known_bytes = max(0, self._known_bytes - previous_bytes + new_bytes)
            total = self._known_bytes
            files = []

        if total <= self.max_bytes:
            self._known_bytes = total
            return

        if not files:
            total, files = self._scan()
            self._writes_since_scan = 0

        # Drop the oldest reproducible responses until there is breathing room.
        # The 80% target avoids rescanning and deleting on every following write.
        target = int(self.max_bytes * 0.8)
        for _modified, size, path in sorted(files):
            try:
                path.unlink()
                total -= size
            except OSError:
                continue
            if total <= target:
                break
        self._known_bytes = max(0, total)

    def get_json(self, namespace: str, key: str, max_age_s: float | None = None) -> Any | None:
        if not self.enabled:
            return None
        path = self._path(namespace, key, "json.gz")
        legacy = self._path(namespace, key, "json")
        try:
            chosen = path if path.exists() else legacy
            if max_age_s is not None and time.time() - chosen.stat().st_mtime > max_age_s:
                self.misses += 1
                return None
            if chosen == path:
                with gzip.open(path, "rt", encoding="utf-8") as handle:
                    value = json.load(handle)
            else:
                value = json.loads(legacy.read_text(encoding="utf-8"))
        except (OSError, EOFError, gzip.BadGzipFile, UnicodeDecodeError, json.JSONDecodeError):
            self.misses += 1
            return None
        self.hits += 1
        return value

    def set_json(self, namespace: str, key: str, value: Any) -> None:
        if not self.enabled:
            return
        path = self._path(namespace, key, "json.gz")
        legacy = self._path(namespace, key, "json")
        path.parent.mkdir(parents=True, exist_ok=True)
        previous = 0
        for existing in (path, legacy):
            try:
                previous += existing.stat().st_size
            except OSError:
                pass
        # Stream directly into gzip. A distributor catalogue can expand beyond
        # 100 MB as JSON; building an equally large encoded copy in memory would
        # push the 512 MB service needlessly close to its memory limit.
        with gzip.open(path, "wt", encoding="utf-8", compresslevel=6) as handle:
            json.dump(value, handle, separators=(",", ":"), ensure_ascii=False)
        legacy.unlink(missing_ok=True)
        self._after_write(previous, path.stat().st_size)

    def get_bytes(self, namespace: str, key: str) -> bytes | None:
        if not self.enabled:
            return None
        try:
            data = self._path(namespace, key, "bin").read_bytes()
        except OSError:
            self.misses += 1
            return None
        self.hits += 1
        return data

    def set_bytes(self, namespace: str, key: str, value: bytes) -> None:
        if not self.enabled:
            return
        path = self._path(namespace, key, "bin")
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            previous = path.stat().st_size
        except OSError:
            previous = 0
        path.write_bytes(value)
        self._after_write(previous, len(value))
