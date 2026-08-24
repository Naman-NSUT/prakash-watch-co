"""The LangGraph pipeline.

Two graphs:

* **watch graph** — one watch, start to finish. It is cyclic on purpose: the
  search node runs, a router asks whether anything found actually mentions the
  reference, and if not it loops back for another, differently-phrased query
  before giving up and reading whatever it has.

      search ──▶ (settled?) ──no──▶ search
                     │yes
                     ▼
       scrape ─▶ extract ─▶ copy ─▶ images ─▶ assemble

* **run graph** — parse the sheet, fan every row out to the watch graph with
  ``Send`` (bounded by ``max_concurrency``), then fan back in to write the index
  and the report.

Rows are independent, so a failure is contained to its own row: one unreachable
site must never cost the shop the other two hundred listings.
"""

from __future__ import annotations

import operator
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from .artifact import artifact_path, build_product, rebuild_index, write_artifact
from .brands import blocks_bots, is_brand_site
from .cache import Cache
from .config import AgentConfig, load_config
from .enrich import extract_facts, fallback_copy, write_copy
from .events import EventBus
from .http_client import HttpClient
from .images import process_images
from .models import (
    Copy,
    FactsResult,
    ProductImage,
    RowResult,
    RunCounts,
    RunReport,
    ScrapedPage,
    SheetRow,
    Source,
)
from .openrouter import OpenRouterClient
from .report import write_report
from .registry import BrandRegistry, ensure as ensure_brand
from .research import CONFIDENT_SCORE, build_queries, mentions_reference, rank_candidates, scrape_page
from .sheet import parse_sheet
from .util import make_sku, now_iso

MAX_SEARCH_ROUNDS = 3


class WatchState(TypedDict, total=False):
    """State for one watch."""

    row: dict[str, Any]
    attempt: int
    #: Set once the image-recovery pass has run, so it only ever runs once.
    image_attempt: int
    queries: list[str]
    hits: list[dict[str, str]]
    sources: list[dict[str, Any]]
    pages: list[dict[str, Any]]
    facts: dict[str, Any]
    copy: dict[str, Any]
    image_alt: str
    images: list[dict[str, Any]]
    backdrop_id: str | None
    cost_usd: float
    notes: list[str]
    product: dict[str, Any] | None
    error: str | None


class RunState(TypedDict, total=False):
    """State for a whole sheet."""

    file: str
    limit: int | None
    only: list[str]
    rows: list[dict[str, Any]]
    results: Annotated[list[dict[str, Any]], operator.add]


class Deps:
    """Everything the nodes need that is not graph state."""

    def __init__(self, config: AgentConfig, bus: EventBus, run_id: str) -> None:
        self.config = config
        self.bus = bus
        self.run_id = run_id
        self.cache = Cache(Path(config.cache_dir), config.cache)
        self.http = HttpClient(config, self.cache)
        self.llm = OpenRouterClient(config, self.cache)
        self.source_file = ""
        self.budget_stopped = False
        #: The brand memory base — official sites, learned once and reused.
        self.registry = BrandRegistry(Path(config.brands_path))

    async def aclose(self) -> None:
        self.registry.save()
        await self.http.aclose()
        await self.llm.aclose()


def _expected_attributes(facts: FactsResult) -> dict[str, str | None]:
    """What the sources say the watch looks like, for checking photographs against."""
    by_field = {f.field: f.value for f in facts.facts}
    blob = " ".join(list(by_field.values()) + facts.functions).lower()

    if "ana-digi" in blob or "ana digi" in blob or ("analog" in blob and "digital" in blob):
        display = "ana-digi"
    elif "digital" in blob:
        display = "digital"
    elif "analog" in blob or "analogue" in blob:
        display = "analogue"
    else:
        display = None

    return {
        "dial_colour": by_field.get("dial_colour"),
        "strap_material": by_field.get("strap_material"),
        "display": display,
    }


def _stage_emitter(deps: Deps, row: SheetRow, sku: str):
    def emit(stage: str, detail: str) -> None:
        deps.bus.emit(
            {"type": "row:stage", "rowNumber": row.row_number, "sku": sku, "stage": stage, "detail": detail}
        )

    return emit


def build_watch_graph(deps: Deps):
    """Compiles the per-watch graph."""

    async def search(state: WatchState) -> WatchState:
        row = SheetRow.model_validate(state["row"])
        sku = make_sku(row.brand, row.model_number)
        stage = _stage_emitter(deps, row, sku)

        attempt = state.get("attempt", 0)
        hits = list(state.get("hits", []))
        queries = list(state.get("queries", []))
        cost = state.get("cost_usd", 0.0)

        # A product URL in the sheet is better than any search result.
        if attempt == 0 and row.product_url:
            hits.append({"url": row.product_url, "title": f"{row.brand} {row.model_number}", "content": ""})
            stage("research", "using the product URL from the sheet")

        planned = build_queries(row)
        # Final round drops the brand and searches the bare reference, which helps
        # when every page title is padded with the brand name.
        query = planned[attempt] if attempt < len(planned) else f"{row.model_number} watch"

        result = await deps.llm.search(query, 8 if attempt >= len(planned) else 6)
        queries.append(query)
        hits.extend(result["citations"])
        cost += result["costUsd"]

        label = "retried on the bare reference" if attempt >= len(planned) else "result(s)"
        suffix = " (cached)" if result["cached"] else ""
        stage("search", f"{len(result['citations'])} {label}{suffix}")

        return {"attempt": attempt + 1, "hits": hits, "queries": queries, "cost_usd": cost}

    def route_after_search(state: WatchState) -> str:
        """Loop back for another query while nothing found mentions the reference."""
        row = SheetRow.model_validate(state["row"])
        candidates = rank_candidates(state.get("hits", []), row, deps.config.india_only)
        settled = any(c.score >= CONFIDENT_SCORE for c in candidates)
        if settled or state.get("attempt", 0) >= MAX_SEARCH_ROUNDS:
            return "scrape"
        return "search"

    async def scrape(state: WatchState) -> WatchState:
        row = SheetRow.model_validate(state["row"])
        sku = make_sku(row.brand, row.model_number)
        stage = _stage_emitter(deps, row, sku)

        sources: list[Source] = []
        pages: list[ScrapedPage] = []

        for candidate in rank_candidates(state.get("hits", []), row, deps.config.india_only):
            if len(pages) >= deps.config.max_sources:
                break
            # Casio India, Titan, Fastrack and Sonata answer automated readers with
            # 403. Their pages rank well, so skip them rather than spend a request
            # and a timeout rediscovering it on every row.
            if blocks_bots(row.brand) and is_brand_site(candidate.url, row.brand):
                continue
            fetched = await deps.http.get_html(candidate.url)
            if not fetched:
                continue

            page = scrape_page(fetched["html"], fetched["finalUrl"])
            # A page with no usable content is not worth an evidence slot.
            if not page.text and not page.spec_pairs:
                continue

            host = page.url.split("/")[2] if "//" in page.url else "unknown"
            sources.append(
                Source(
                    index=len(sources),
                    url=page.url,
                    title=page.title or candidate.title,
                    publisher=host.removeprefix("www."),
                    kind=candidate.kind,
                    fetched_at=now_iso(),
                )
            )
            pages.append(page)

        confirmed = sum(
            1
            for page in pages
            if mentions_reference(f"{page.url} {page.title} {page.text}", row.model_number)
        )
        stage("read", f"{len(pages)} page(s), {confirmed} confirming the reference")

        return {
            "sources": [s.model_dump() for s in sources],
            "pages": [p.model_dump() for p in pages],
        }

    async def extract(state: WatchState) -> WatchState:
        row = SheetRow.model_validate(state["row"])
        sku = make_sku(row.brand, row.model_number)
        stage = _stage_emitter(deps, row, sku)

        sources = [Source.model_validate(s) for s in state.get("sources", [])]
        pages = [ScrapedPage.model_validate(p) for p in state.get("pages", [])]

        facts = await extract_facts(row, sources, pages, deps.llm)

        if sources:
            stage(
                "extract",
                f"{len(facts.facts)} attributed fact(s), reference match {facts.match_confidence * 100:.0f}%",
            )
        if sources and not facts.matches_reference:
            deps.bus.emit(
                {
                    "type": "row:warn",
                    "rowNumber": row.row_number,
                    "sku": sku,
                    "message": facts.mismatch_reason or "Sources may describe a different reference.",
                }
            )

        return {"facts": facts.model_dump(), "cost_usd": state.get("cost_usd", 0.0) + facts.cost_usd}

    async def compose_copy(state: WatchState) -> WatchState:
        row = SheetRow.model_validate(state["row"])
        facts = FactsResult.model_validate(state["facts"])

        if facts.facts:
            copy, image_alt, cost = await write_copy(row, facts, deps.llm)
        else:
            copy, image_alt, cost = fallback_copy(row, row.model_name or facts.model_name), "", 0.0

        return {
            "copy": copy.model_dump(),
            "image_alt": image_alt,
            "cost_usd": state.get("cost_usd", 0.0) + cost,
        }

    async def images(state: WatchState) -> WatchState:
        row = SheetRow.model_validate(state["row"])
        sku = make_sku(row.brand, row.model_number)
        stage = _stage_emitter(deps, row, sku)

        facts = FactsResult.model_validate(state["facts"])
        pages = [ScrapedPage.model_validate(p) for p in state.get("pages", [])]
        record = await ensure_brand(row.brand, deps.registry, deps.llm, deps.http, stage)
        official_hosts = record.hosts() if record else []

        result = await process_images(
            row,
            sku,
            pages,
            row.model_name or facts.model_name,
            _expected_attributes(facts),
            state.get("image_alt", ""),
            deps.config,
            deps.http,
            deps.llm,
            stage,
            official_hosts=official_hosts,
        )

        notes = [f"Rejected image {r['url']}: {r['reason']}" for r in result["rejected"][:5]]
        return {
            "images": [image.model_dump() for image in result["images"]],
            "cost_usd": state.get("cost_usd", 0.0) + result["cost_usd"],
            "notes": notes,
            "backdrop_id": result.get("backdrop_id"),
        }

    async def recover_images(state: WatchState) -> WatchState:
        """Second pass, for photography only.

        The pages chosen for the evidence bundle are ranked on how trustworthy
        their *specifications* are, which systematically under-serves photography:
        a brand page may be unscrapeable (titan.co.in answers bots with 403) while
        a marketplace listing nobody would quote specs from carries five clean
        product shots. So when a watch ends up with no image at all, search once
        more with a buying-intent query and read pages purely for their pictures.
        """
        row = SheetRow.model_validate(state["row"])
        sku = make_sku(row.brand, row.model_number)
        stage = _stage_emitter(deps, row, sku)

        cost = state.get("cost_usd", 0.0)
        already_read = {p["url"] for p in state.get("pages", [])}

        facts = FactsResult.model_validate(state["facts"])
        dial = next((f.value for f in facts.facts if f.field == "dial_colour"), None)

        # Families like G-Shock ship the same case in a dozen colourways, and the
        # grader (rightly) refuses a neon-yellow photo for a blue reference. Naming
        # the colour we already confirmed steers the search at the right variant.
        colour = f" {dial}" if dial and len(dial) < 20 else ""
        record = deps.registry.get(row.brand)
        hosts = record.hosts() if record else []
        # Aim the recovery search at the brand's own site when it will serve us.
        site = f" site:{hosts[0]}" if hosts and record and not record.blocks_bots else ""
        query = f"{row.brand} {row.model_number}{colour} watch{site or ' buy price images'}"
        result = await deps.llm.search(query, 8)
        cost += result["costUsd"]

        hits = list(state.get("hits", [])) + result["citations"]
        extra_pages: list[ScrapedPage] = []

        # Photographs are not a market claim: the same reference looks identical
        # wherever it is listed, so the recovery pass reads marketplaces and
        # foreign shops too. Only specifications are held to Indian sources.
        for candidate in rank_candidates(hits, row, india_only=False):
            if len(extra_pages) >= 3:
                break
            if candidate.url in already_read:
                continue
            fetched = await deps.http.get_html(candidate.url)
            if not fetched:
                continue
            page = scrape_page(fetched["html"], fetched["finalUrl"])
            if page.image_urls:
                extra_pages.append(page)

        stage("images", f"recovery pass — {len(extra_pages)} more page(s) read for photographs")

        if not extra_pages:
            return {"image_attempt": 1, "cost_usd": cost, "queries": [*state.get("queries", []), query]}

        recovered = await process_images(
            row,
            sku,
            extra_pages,
            row.model_name or facts.model_name,
            _expected_attributes(facts),
            state.get("image_alt", ""),
            deps.config,
            deps.http,
            deps.llm,
            stage,
            official_hosts=hosts,
        )

        notes = list(state.get("notes", [])) + [
            f"Rejected image {r['url']}: {r['reason']}" for r in recovered["rejected"][:3]
        ]

        return {
            "image_attempt": 1,
            "images": [image.model_dump() for image in recovered["images"]],
            "cost_usd": cost + recovered["cost_usd"],
            "notes": notes,
            "backdrop_id": recovered.get("backdrop_id"),
            "queries": [*state.get("queries", []), query],
        }

    def route_after_images(state: WatchState) -> str:
        """One recovery pass when nothing usable was found."""
        if not state.get("images") and not state.get("image_attempt"):
            return "recover_images"
        return "assemble"

    async def assemble(state: WatchState) -> WatchState:
        row = SheetRow.model_validate(state["row"])
        product = build_product(
            row=row,
            sources=[Source.model_validate(s) for s in state.get("sources", [])],
            pages=[ScrapedPage.model_validate(p) for p in state.get("pages", [])],
            facts=FactsResult.model_validate(state["facts"]),
            copy=Copy.model_validate(state["copy"]),
            images=[ProductImage.model_validate(m) for m in state.get("images", [])],
            queries=state.get("queries", []),
            run_id=deps.run_id,
            source_file=deps.source_file,
            model=deps.llm.model,
            cost_usd=state.get("cost_usd", 0.0),
            backdrop_id=state.get("backdrop_id"),
            extra_notes=state.get("notes", []),
        )
        write_artifact(product, deps.config)
        return {"product": product.dump()}

    graph = StateGraph(WatchState)
    graph.add_node("search", search)
    graph.add_node("scrape", scrape)
    graph.add_node("extract", extract)
    graph.add_node("copy", compose_copy)
    graph.add_node("images", images)
    graph.add_node("recover_images", recover_images)
    graph.add_node("assemble", assemble)

    graph.add_edge(START, "search")
    graph.add_conditional_edges("search", route_after_search, {"search": "search", "scrape": "scrape"})
    graph.add_edge("scrape", "extract")
    graph.add_edge("extract", "copy")
    graph.add_edge("copy", "images")
    graph.add_conditional_edges(
        "images", route_after_images, {"recover_images": "recover_images", "assemble": "assemble"}
    )
    graph.add_edge("recover_images", "assemble")
    graph.add_edge("assemble", END)

    return graph.compile()


def build_run_graph(deps: Deps):
    """Compiles the sheet-level graph that fans rows out to the watch graph."""
    watch_graph = build_watch_graph(deps)

    async def process_row(payload: dict[str, Any]) -> dict[str, Any]:
        row = SheetRow.model_validate(payload["row"])
        sku = make_sku(row.brand, row.model_number)
        started = time.monotonic()

        def done(status: str, images: int, cost: float, product: dict | None, error: str | None) -> dict:
            elapsed = int((time.monotonic() - started) * 1000)
            deps.bus.emit(
                {
                    "type": "row:done",
                    "rowNumber": row.row_number,
                    "sku": sku,
                    "status": status,
                    "images": images,
                    "costUsd": cost,
                    "elapsedMs": elapsed,
                }
            )
            return {
                "results": [
                    RowResult(
                        row_number=row.row_number,
                        sku=sku,
                        status=status,  # type: ignore[arg-type]
                        product=product,  # type: ignore[arg-type]
                        error=error,
                        cost_usd=cost,
                        elapsed_ms=elapsed,
                    ).dump()
                ]
            }

        # Budget guard, checked before any spend on this row.
        limit = deps.config.budget_usd
        if limit > 0 and deps.llm.spent_usd >= limit:
            if not deps.budget_stopped:
                deps.budget_stopped = True
                deps.bus.emit({"type": "budget:exceeded", "spentUsd": deps.llm.spent_usd, "limitUsd": limit})
            return done("skipped", 0, 0.0, None, "budget reached")

        # Re-running a sheet after fixing three rows should not re-pay for the rest.
        if not deps.config.force and artifact_path(deps.config, sku).exists():
            deps.bus.emit(
                {"type": "row:start", "rowNumber": row.row_number, "sku": sku, "label": f"{row.brand} {row.model_number}"}
            )
            return done("skipped", 0, 0.0, None, None)

        label = " ".join(filter(None, [row.brand, row.model_name or "", row.model_number]))
        deps.bus.emit({"type": "row:start", "rowNumber": row.row_number, "sku": sku, "label": label})

        if deps.config.dry_run:
            product = build_product(
                row=row,
                sources=[],
                pages=[],
                facts=FactsResult(model_name=row.model_name),
                copy=fallback_copy(row, row.model_name),
                images=[],
                queries=[],
                run_id=deps.run_id,
                source_file=deps.source_file,
                model="dry-run",
                cost_usd=0.0,
                extra_flags=["llm-unavailable"],
                extra_notes=["Dry run — no research was performed."],
            )
            write_artifact(product, deps.config)
            return done(product.status, 0, 0.0, product.dump(), None)

        try:
            final = await watch_graph.ainvoke(
                {"row": payload["row"], "attempt": 0, "hits": [], "queries": [], "cost_usd": 0.0}
            )
        except Exception as error:  # noqa: BLE001 - one row must not stop the sheet
            message = str(error) or error.__class__.__name__
            deps.bus.emit({"type": "row:fail", "rowNumber": row.row_number, "sku": sku, "message": message})
            return done("failed", 0, 0.0, None, message)

        product = final.get("product")
        status = (product or {}).get("status", "failed")
        return done(status, len((product or {}).get("images", [])), final.get("cost_usd", 0.0), product, None)

    def fan_out(state: RunState):
        rows = state.get("rows", [])
        if not rows:
            return "finalise"
        return [Send("process_row", {"row": row}) for row in rows]

    async def finalise(_state: RunState) -> dict[str, Any]:
        # Must not echo state back: `results` carries an operator.add reducer, so
        # returning it would append the list to itself and double every row.
        return {}

    graph = StateGraph(RunState)
    graph.add_node("process_row", process_row)
    graph.add_node("finalise", finalise)

    graph.add_conditional_edges(START, fan_out, ["process_row", "finalise"])
    graph.add_edge("process_row", "finalise")
    graph.add_edge("finalise", END)

    return graph.compile()


async def run_ingestion(
    file: str | Path,
    *,
    config: AgentConfig | None = None,
    on_event=None,
    limit: int | None = None,
    only: list[str] | None = None,
) -> RunReport:
    """Runs a full ingestion and returns the report."""
    cfg = config or load_config()
    bus = EventBus()
    if on_event:
        bus.on(on_event)

    run_id = f"run-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    started_at = now_iso()

    parsed = parse_sheet(file)
    bus.emit(
        {
            "type": "sheet:parsed",
            "rows": len(parsed.rows),
            "rejected": len(parsed.errors),
            "headerMap": parsed.header_map,
            "unmapped": parsed.unmapped_headers,
            "sheets": parsed.sheets,
            "skippedSheets": parsed.skipped_sheets,
        }
    )

    rows = parsed.rows
    if only:
        needles = [n.lower() for n in only]
        rows = [
            row
            for row in rows
            if any(
                n in row.brand.lower()
                or n in row.model_number.lower()
                or n in make_sku(row.brand, row.model_number)
                for n in needles
            )
        ]
    if limit is not None:
        rows = rows[:limit]

    bus.emit(
        {"type": "run:start", "runId": run_id, "file": parsed.file_name, "rows": len(rows), "dryRun": cfg.dry_run}
    )

    deps = Deps(cfg, bus, run_id)
    deps.source_file = parsed.file_name

    try:
        if not cfg.dry_run:
            notes = await deps.llm.prepare()
            bus.emit(
                {
                    "type": "run:models",
                    "model": deps.llm.model,
                    "visionModel": deps.llm.vision_model,
                    "searchModel": deps.llm.search_model,
                }
            )
            for note in notes:
                bus.emit({"type": "row:warn", "rowNumber": 0, "sku": "-", "message": note})

        run_graph = build_run_graph(deps)
        final = await run_graph.ainvoke(
            {"rows": [row.model_dump() for row in rows], "results": []},
            config={"max_concurrency": max(1, cfg.concurrency), "recursion_limit": 100},
        )
        results = [RowResult.model_validate(r) for r in final.get("results", [])]
    finally:
        await deps.aclose()

    rebuild_index(cfg)

    counts = RunCounts(
        rows_read=len(parsed.rows),
        rows_rejected=len(parsed.errors),
        ready=sum(1 for r in results if r.status == "ready"),
        needs_review=sum(1 for r in results if r.status == "needs_review"),
        failed=sum(1 for r in results if r.status == "failed"),
        skipped=sum(1 for r in results if r.status == "skipped"),
        images_saved=sum(len(r.product.images) if r.product else 0 for r in results),
    )

    report = RunReport(
        run_id=run_id,
        started_at=started_at,
        finished_at=now_iso(),
        source_file=parsed.file_name,
        model="dry-run" if cfg.dry_run else deps.llm.model,
        dry_run=cfg.dry_run,
        counts=counts,
        cost_usd=round(sum(r.cost_usd for r in results), 6),
        results=results,
        sheet_errors=parsed.errors,
    )
    write_report(report, cfg)

    bus.emit(
        {
            "type": "run:done",
            "runId": run_id,
            "ready": counts.ready,
            "needsReview": counts.needs_review,
            "failed": counts.failed,
            "skipped": counts.skipped,
            "costUsd": report.cost_usd,
        }
    )
    return report
