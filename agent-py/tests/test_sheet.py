from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from openpyxl import Workbook

from prakash_agent.sheet import parse_sheet


class CatalogueExportRoundTripTest(TestCase):
    def test_exported_price_and_units_are_imported(self) -> None:
        """The shop's own export can be edited and uploaded without losing counts."""
        headers = [
            "Reference",
            "Brand",
            "Watch",
            "Collection",
            "For",
            "Price (incl. GST)",
            "MRP",
            "In stock",
            "Units",
            "On the website",
        ]
        values = ["A4B007X1", "ALBA", "Forest Green", "Chronograph", "Men", 11999, 15000, "yes", 7, "yes"]

        with TemporaryDirectory() as directory:
            path = Path(directory) / "catalogue-export.xlsx"
            workbook = Workbook()
            sheet = workbook.active
            sheet.append(headers)
            sheet.append(values)
            workbook.save(path)

            parsed = parse_sheet(path)

        row = parsed.rows[0]
        self.assertEqual(row.price, 11999)
        self.assertEqual(row.mrp, 15000)
        self.assertEqual(row.quantity, 7)
        self.assertEqual(parsed.header_map["Sheet · Units"], "quantity")
        self.assertIn("Sheet · In stock", parsed.unmapped_headers)
