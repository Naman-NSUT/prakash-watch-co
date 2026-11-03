from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from prakash_agent.catalog_migrations import repair_placeholder_brands
from prakash_agent.config import AgentConfig
from prakash_agent.util import read_json, write_json


def product(brand: str, model: str, sku: str, *, image: str | None = None) -> dict:
    return {
        "sku": sku,
        "slug": sku,
        "status": "ready",
        "brand": brand,
        "modelNumber": model,
        "title": f"{brand} {model}",
        "price": {"currency": "INR", "selling": 10000, "mrp": None, "discountPct": None},
        "inStock": False,
        "quantity": 0,
        "copy": {"tagline": "", "short": "", "long": "", "bullets": [], "seoTitle": "", "seoDescription": ""},
        "images": [] if not image else [{"url": image, "width": 1200, "height": 1200, "alt": f"{brand} watch"}],
        "specs": [],
        "sources": [],
        "attributes": {},
        "facets": {},
        "confidence": {"overall": 0, "identity": 0, "specs": 0, "images": 0},
        "review": {"flags": [], "notes": []},
        "meta": {"runId": "test", "sheetRow": 2, "sourceFile": "test.xlsx", "model": "test", "createdAt": "2026-11-03T00:00:00Z", "updatedAt": "2026-11-03T00:00:00Z", "costUsd": 0, "queries": []},
    }


class CatalogueMigrationTests(unittest.TestCase):
    def test_repairs_placeholder_identity_and_moves_its_media(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            catalog = root / "catalog"
            media = root / "media"
            catalog.mkdir()
            media.mkdir()
            write_json(catalog / "alba-known.json", product("ALBA", "KNOWN", "alba-known"))
            old_sku = "sheet1-alba-ah7fe5x1"
            old_media = media / old_sku
            old_media.mkdir()
            (old_media / "01-watch.webp").write_bytes(b"image")
            malformed = product(
                "Sheet1",
                "ALBA AH7FE5X1",
                old_sku,
                image=f"/media/{old_sku}/01-watch.webp",
            )
            malformed["modelName"] = "Sheet1 AH7EF7X1 Deep Blue Dial With Leather Strap"
            write_json(catalog / f"{old_sku}.json", malformed)
            config = AgentConfig(
                data_dir=catalog,
                image_dir=media,
                cache_dir=root / "cache",
                report_dir=root / "runs",
            )

            report = repair_placeholder_brands(config)

            repaired = read_json(catalog / "alba-ah7fe5x1.json")
            self.assertEqual(report["repaired"], 1)
            self.assertFalse((catalog / f"{old_sku}.json").exists())
            self.assertEqual(repaired["brand"], "ALBA")
            self.assertEqual(repaired["modelNumber"], "AH7FE5X1")
            self.assertEqual(repaired["modelName"], "Deep Blue Dial With Leather Strap")
            self.assertEqual(repaired["images"][0]["url"], "/media/alba-ah7fe5x1/01-watch.webp")
            self.assertTrue((media / "alba-ah7fe5x1" / "01-watch.webp").exists())


if __name__ == "__main__":
    unittest.main()
