from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, patch

from openpyxl import Workbook

from prakash_agent.sheet import SheetLayout, parse_sheet
from prakash_agent.config import AgentConfig
from prakash_agent.openrouter import OpenRouterClient
from prakash_agent.sheet_intelligence import SheetInterpretationError, parse_sheet_with_agent


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

    def test_agent_layout_normalizes_an_unknown_format_and_preserves_zero(self) -> None:
        """The model maps a supplier layout; deterministic parsing owns the values."""
        with TemporaryDirectory() as directory:
            path = Path(directory) / "supplier-layout.xlsx"
            workbook = Workbook()
            sheet = workbook.active
            sheet.title = "November delivery"
            sheet.append(["Warehouse count supplied 3 November"])
            sheet.append([])
            sheet.append(["Maker house", "Style identity", "Customer ticket", "Physical pieces"])
            sheet.append(["ALBA", "AL4307X1", "₹10,500", 0])
            workbook.save(path)

            parsed = parse_sheet(
                path,
                layouts={
                    "November delivery": SheetLayout(
                        sheet="November delivery",
                        header_row=3,
                        data_start_row=4,
                        columns={"brand": 1, "modelNumber": 2, "price": 3, "quantity": 4},
                    )
                },
            )

        self.assertEqual(len(parsed.rows), 1)
        row = parsed.rows[0]
        self.assertEqual(row.brand, "ALBA")
        self.assertEqual(row.model_number, "AL4307X1")
        self.assertEqual(row.price, 10500)
        self.assertEqual(row.quantity, 0)

    def test_blank_price_does_not_block_a_stock_count(self) -> None:
        """A count-only update may leave an exported price cell blank."""
        with TemporaryDirectory() as directory:
            path = Path(directory) / "count-only.xlsx"
            workbook = Workbook()
            sheet = workbook.active
            sheet.append(["Brand", "Reference", "Price", "Units"])
            sheet.append(["ALBA", "AL4307X1", "", 0])
            workbook.save(path)

            parsed = parse_sheet(path)

        self.assertEqual(len(parsed.errors), 0)
        self.assertEqual(len(parsed.rows), 1)
        self.assertIsNone(parsed.rows[0].price)
        self.assertEqual(parsed.rows[0].quantity, 0)


class AgentWorkbookInterpretationTest(IsolatedAsyncioTestCase):
    async def test_agent_maps_unknown_columns_before_normalization(self) -> None:
        with TemporaryDirectory() as directory:
            path = Path(directory) / "unfamiliar.xlsx"
            workbook = Workbook()
            sheet = workbook.active
            sheet.title = "Incoming"
            sheet.append(["November counter delivery"])
            sheet.append(["House", "Identity", "Ticket", "Pieces now"])
            sheet.append(["ALBA", "AL4307X1", 10500, 0])
            workbook.save(path)

            reply = {
                "worksheets": [
                    {
                        "sheet": "Incoming",
                        "useSheet": True,
                        "headerRow": 2,
                        "dataStartRow": 3,
                        "brandColumn": 1,
                        "brandValue": None,
                        "modelNumberColumn": 2,
                        "modelNameColumn": None,
                        "priceColumn": 3,
                        "mrpColumn": None,
                        "costPriceColumn": None,
                        "quantityColumn": 4,
                        "genderColumn": None,
                        "collectionColumn": None,
                        "productUrlColumn": None,
                        "imageUrlsColumn": None,
                        "notesColumn": None,
                        "reason": "The third row starts the product table.",
                    }
                ]
            }
            with (
                patch.object(OpenRouterClient, "prepare", new=AsyncMock(return_value=[])),
                patch.object(OpenRouterClient, "chat_json", new=AsyncMock(return_value=(reply, 0.001))),
                patch.object(OpenRouterClient, "aclose", new=AsyncMock(return_value=None)),
            ):
                interpreted = await parse_sheet_with_agent(
                    path,
                    AgentConfig(model="test-model", cache=False, cache_dir=Path(directory) / "cache"),
                )

        self.assertTrue(interpreted.used_agent)
        self.assertEqual(interpreted.cost_usd, 0.001)
        self.assertEqual(len(interpreted.parsed.rows), 1)
        self.assertEqual(interpreted.parsed.rows[0].model_number, "AL4307X1")
        self.assertEqual(interpreted.parsed.rows[0].quantity, 0)

    async def test_agent_failure_stops_the_import_instead_of_guessing(self) -> None:
        with TemporaryDirectory() as directory:
            path = Path(directory) / "recognisable-but-unreviewed.xlsx"
            workbook = Workbook()
            sheet = workbook.active
            sheet.append(["Brand", "Reference", "Units"])
            sheet.append(["ALBA", "AL4307X1", 0])
            workbook.save(path)

            with (
                patch.object(OpenRouterClient, "prepare", new=AsyncMock(side_effect=RuntimeError("offline"))),
                patch.object(OpenRouterClient, "aclose", new=AsyncMock(return_value=None)),
            ):
                with self.assertRaisesRegex(SheetInterpretationError, "inventory was left unchanged"):
                    await parse_sheet_with_agent(
                        path,
                        AgentConfig(model="test-model", cache=False, cache_dir=Path(directory) / "cache"),
                    )
