from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from prakash_agent.cache import Cache


class CacheTests(unittest.TestCase):
    def test_json_is_compressed_and_round_trips(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = Cache(root, max_bytes=10 * 1024 * 1024)
            value = {"products": [{"title": "ALBA Mechanical", "description": "watch " * 80}] * 500}

            cache.set_json("storefront", "watchfactory.in", value)

            files = list((root / "storefront").glob("*.json.gz"))
            self.assertEqual(len(files), 1)
            self.assertLess(files[0].stat().st_size, len(json.dumps(value).encode("utf-8")) // 10)
            self.assertEqual(cache.get_json("storefront", "watchfactory.in"), value)

    def test_reads_legacy_plain_json_entries(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache = Cache(Path(directory), max_bytes=10 * 1024 * 1024)
            legacy = cache._path("page", "https://example.test/watch", "json")
            legacy.parent.mkdir(parents=True)
            legacy.write_text('{"title":"Watch"}', encoding="utf-8")

            self.assertEqual(cache.get_json("page", "https://example.test/watch"), {"title": "Watch"})

    def test_evicts_oldest_files_above_the_limit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = Cache(root, max_bytes=900)

            cache.set_bytes("asset", "old", b"a" * 600)
            cache.set_bytes("asset", "new", b"b" * 600)

            size = sum(path.stat().st_size for path in root.rglob("*") if path.is_file())
            self.assertLessEqual(size, 900)
            self.assertIsNone(cache.get_bytes("asset", "old"))
            self.assertEqual(cache.get_bytes("asset", "new"), b"b" * 600)


if __name__ == "__main__":
    unittest.main()
