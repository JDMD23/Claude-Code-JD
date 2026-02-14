"""Central analysis pipeline for NCAA basketball matchup evaluation.

Orchestrates data retrieval, runs all twelve analytical dimensions, and
produces a :class:`PickCard` for every game on a given slate.  This module
is the primary entry-point for batch and single-game analysis.
"""

from __future__ import annotations

import importlib
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

import pandas as pd
import sqlite3

from ..db import queries
from ..output.pick_card import PickCard
from .scoring import (
    ConfidenceTier,
    assign_tier,
    compute_kelly_fraction,
    compute_spread_composite,
    compute_total_composite,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class MatchupContext:
    """All data required to evaluate a single game.

    Built once by :meth:`AnalysisPipeline.build_context` and passed
    immutably to every dimension function.  Fields that could not be
    populated from the database are set to empty DataFrames / Series so
    that downstream code never needs ``None`` checks.
    """

    # Identifiers -------------------------------------------------------
    away_team: str
    home_team: str
    game_date: str
    season: int

    # KenPom ratings (latest snapshot before game_date) -----------------
    away_ratings: pd.Series = field(default_factory=lambda: pd.Series(dtype="float64"))
    home_ratings: pd.Series = field(default_factory=lambda: pd.Series(dtype="float64"))

    # KenPom four-factors (latest snapshot) -----------------------------
    away_four_factors: pd.Series = field(
        default_factory=lambda: pd.Series(dtype="float64"),
    )
    home_four_factors: pd.Series = field(
        default_factory=lambda: pd.Series(dtype="float64"),
    )

    # Game-by-game logs -------------------------------------------------
    away_game_logs: pd.DataFrame = field(default_factory=pd.DataFrame)
    home_game_logs: pd.DataFrame = field(default_factory=pd.DataFrame)

    # ATS records -------------------------------------------------------
    away_ats: pd.DataFrame = field(default_factory=pd.DataFrame)
    home_ats: pd.DataFrame = field(default_factory=pd.DataFrame)

    # O/U records -------------------------------------------------------
    away_ou: pd.DataFrame = field(default_factory=pd.DataFrame)
    home_ou: pd.DataFrame = field(default_factory=pd.DataFrame)

    # Vegas line (spread, total, moneylines) ----------------------------
    line: pd.Series = field(default_factory=lambda: pd.Series(dtype="float64"))

    # Rating history (for trend / recency dimensions) -------------------
    away_ratings_history: pd.DataFrame = field(default_factory=pd.DataFrame)
    home_ratings_history: pd.DataFrame = field(default_factory=pd.DataFrame)


@dataclass
class DimensionResult:
    """Output of a single analytical dimension.

    Attributes
    ----------
    name:
        Snake-case identifier matching the key in
        ``AnalysisPipeline.DIMENSION_WEIGHTS`` (e.g. ``"pace_adjusted"``).
    spread_edge:
        Directional edge for the spread market.  Positive values signal
        value on the **away** side; negative values signal value on the
        **home** side.  Magnitude indicates strength.
    total_edge:
        Directional edge for the total (O/U) market.  Positive values
        signal **over** value; negative values signal **under** value.
    confidence:
        Self-assessed confidence of the dimension's signal, normalised
        to [0.0, 1.0].  Low confidence down-weights the edge in the
        composite scoring step.
    narrative:
        One or two human-readable sentences explaining what the dimension
        found.  Included verbatim on the :class:`PickCard`.
    raw_data:
        Optional dictionary of intermediate calculations for debugging
        or advanced reporting.
    """

    name: str
    spread_edge: float
    total_edge: float
    confidence: float
    narrative: str
    raw_data: Optional[dict] = None


# ---------------------------------------------------------------------------
# Dimension registry
# ---------------------------------------------------------------------------

# Lazy-import map: dimension name -> (module_path, function_name).
# Each function has the signature  (ctx: MatchupContext) -> DimensionResult.
_DIMENSION_REGISTRY: dict[str, tuple[str, str]] = {
    "pace_adjusted":    (".dimensions.pace_adjusted",    "analyze"),
    "four_factors":     (".dimensions.four_factors",     "analyze"),
    "opponent_quality": (".dimensions.opponent_quality", "analyze"),
    "home_away":        (".dimensions.home_away",        "analyze"),
    "recency":          (".dimensions.recency",          "analyze"),
    "shooting_zones":   (".dimensions.shooting_zones",   "analyze"),
    "turnover_chain":   (".dimensions.turnover_chain",   "analyze"),
    "ft_rate":          (".dimensions.ft_rate",          "analyze"),
    "ats_correlation":  (".dimensions.ats_correlation",  "analyze"),
    "variance":         (".dimensions.variance",         "analyze"),
    "rank_asymmetry":   (".dimensions.rank_asymmetry",   "analyze"),
    "trap_detect":      (".dimensions.trap_detect",      "analyze"),
}


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

class AnalysisPipeline:
    """Central orchestrator for matchup analysis.

    Typical usage::

        with get_connection() as conn:
            pipeline = AnalysisPipeline(conn)
            cards = pipeline.analyze_slate("2025-02-14", season=2025)
            for card in cards:
                print(card)

    Parameters
    ----------
    conn:
        An open :class:`sqlite3.Connection` with ``row_factory`` set to
        :class:`sqlite3.Row` (as provided by
        :func:`db.connection.get_connection`).
    """

    DIMENSION_WEIGHTS: dict[str, float] = {
        "pace_adjusted":    0.14,
        "four_factors":     0.14,
        "opponent_quality": 0.10,
        "home_away":        0.08,
        "recency":          0.09,
        "shooting_zones":   0.07,
        "turnover_chain":   0.07,
        "ft_rate":          0.05,
        "ats_correlation":  0.08,
        "variance":         0.06,
        "rank_asymmetry":   0.06,
        "trap_detect":      0.06,
    }

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn
        # Cache for lazily-imported dimension analysis functions.
        self._dim_funcs: dict[str, object] = {}

    # ------------------------------------------------------------------
    # Context builder
    # ------------------------------------------------------------------

    def build_context(
        self,
        away_team: str,
        home_team: str,
        game_date: str,
        season: int,
    ) -> MatchupContext:
        """Assemble a :class:`MatchupContext` by querying the database.

        Every query is wrapped in a ``try / except`` so that missing data
        for one table never prevents the rest of the context from being
        built.  Missing fields fall back to empty DataFrames or Series.

        Parameters
        ----------
        away_team:
            Canonical team name for the away side.
        home_team:
            Canonical team name for the home side.
        game_date:
            ISO-formatted date string (``YYYY-MM-DD``).
        season:
            Four-digit season year (e.g. ``2025``).

        Returns
        -------
        MatchupContext
        """
        ctx = MatchupContext(
            away_team=away_team,
            home_team=home_team,
            game_date=game_date,
            season=season,
        )

        # --- KenPom ratings (latest snapshot) ----------------------------
        ctx.away_ratings = self._safe_query_series(
            queries.get_team_ratings, away_team, season,
        )
        ctx.home_ratings = self._safe_query_series(
            queries.get_team_ratings, home_team, season,
        )

        # --- KenPom four-factors (latest snapshot) ---------------------
        ctx.away_four_factors = self._safe_query_series(
            queries.get_team_four_factors, away_team, season,
        )
        ctx.home_four_factors = self._safe_query_series(
            queries.get_team_four_factors, home_team, season,
        )

        # --- Game logs -------------------------------------------------
        ctx.away_game_logs = self._safe_query_df(
            queries.get_team_game_logs, away_team, season,
        )
        ctx.home_game_logs = self._safe_query_df(
            queries.get_team_game_logs, home_team, season,
        )

        # --- ATS records -----------------------------------------------
        ctx.away_ats = self._safe_query_df(
            queries.get_team_ats, away_team, season,
        )
        ctx.home_ats = self._safe_query_df(
            queries.get_team_ats, home_team, season,
        )

        # --- O/U records -----------------------------------------------
        ctx.away_ou = self._safe_query_df(
            queries.get_team_ou, away_team, season,
        )
        ctx.home_ou = self._safe_query_df(
            queries.get_team_ou, home_team, season,
        )

        # --- Vegas line ------------------------------------------------
        ctx.line = self._safe_query_series(
            queries._get_matchup_line,
            away_team, home_team, season,
        )

        # --- Ratings history (for trend dimensions) --------------------
        ctx.away_ratings_history = self._safe_query_df(
            queries.get_ratings_history, away_team, season,
        )
        ctx.home_ratings_history = self._safe_query_df(
            queries.get_ratings_history, home_team, season,
        )

        return ctx

    # ------------------------------------------------------------------
    # Single-game analysis
    # ------------------------------------------------------------------

    def analyze_matchup(self, ctx: MatchupContext) -> PickCard:
        """Run all twelve dimensions and produce a :class:`PickCard`.

        Steps:
        1. Execute each dimension via :meth:`_run_dimension`.
        2. Compute spread and total composite scores.
        3. Determine pick direction from aggregate signed edges.
        4. Assign confidence tiers and compute Kelly fraction.
        5. Assemble and return a :class:`PickCard`.

        Parameters
        ----------
        ctx:
            Fully populated :class:`MatchupContext`.

        Returns
        -------
        PickCard
        """
        results: list[DimensionResult] = []
        for dim_name in self.DIMENSION_WEIGHTS:
            dim_result = self._run_dimension(dim_name, ctx)
            results.append(dim_result)

        # Composite scores (0 -- 10 scale).
        spread_composite = compute_spread_composite(
            results, self.DIMENSION_WEIGHTS,
        )
        total_composite = compute_total_composite(
            results, self.DIMENSION_WEIGHTS,
        )

        # Determine direction from the aggregate signed edge so the
        # PickCard knows *which* side to recommend.
        spread_direction = self._aggregate_direction(results, "spread_edge")
        total_direction = self._aggregate_direction(results, "total_edge")

        spread_tier = assign_tier(spread_composite)
        total_tier = assign_tier(total_composite)

        # Pick the stronger market for the headline pick.
        if spread_composite >= total_composite:
            primary_tier = spread_tier
        else:
            primary_tier = total_tier

        # Determine pick sides.
        spread_pick_side = (
            ctx.away_team if spread_direction >= 0 else ctx.home_team
        )
        total_pick_side = "OVER" if total_direction >= 0 else "UNDER"

        # Extract line values safely.
        vegas_spread = (
            ctx.line.get("spread", 0.0) if not ctx.line.empty else 0.0
        )
        vegas_total = (
            ctx.line.get("total", 140.0) if not ctx.line.empty else 140.0
        )

        # Project scores from pace_adjusted dimension if available.
        pace_result = next(
            (r for r in results if r.name == "pace_adjusted"), None,
        )
        if pace_result and pace_result.raw_data:
            proj_away = pace_result.raw_data.get("away_pts", 70.0)
            proj_home = pace_result.raw_data.get("home_pts", 70.0)
        else:
            # Fallback: use ratings to estimate
            away_o = ctx.away_ratings.get("adj_o", 105.0) if not ctx.away_ratings.empty else 105.0
            home_d = ctx.home_ratings.get("adj_d", 105.0) if not ctx.home_ratings.empty else 105.0
            home_o = ctx.home_ratings.get("adj_o", 105.0) if not ctx.home_ratings.empty else 105.0
            away_d = ctx.away_ratings.get("adj_d", 105.0) if not ctx.away_ratings.empty else 105.0
            avg_tempo = 67.5
            proj_away = float(away_o + home_d) / 2.0 * avg_tempo / 100.0
            proj_home = float(home_o + away_d) / 2.0 * avg_tempo / 100.0

        projected_total = proj_away + proj_home
        true_spread = proj_away - proj_home

        # Collect key factors from the top 3 highest-confidence dimensions.
        sorted_results = sorted(results, key=lambda r: abs(r.spread_edge) * r.confidence, reverse=True)
        key_factors = [r.narrative for r in sorted_results[:3] if r.narrative]

        # Trap warnings from trap_detect dimension.
        trap_result = next(
            (r for r in results if r.name == "trap_detect"), None,
        )
        trap_warnings = []
        if trap_result and trap_result.raw_data and trap_result.raw_data.get("trap_score", 0) > 0.3:
            trap_warnings.append(trap_result.narrative)

        # Build headline.
        headline = (
            f"{spread_pick_side} {spread_tier.value} "
            f"({'covers' if spread_pick_side else 'N/A'}) | "
            f"{total_pick_side} {total_tier.value}"
        )

        card = PickCard(
            away_team=ctx.away_team,
            home_team=ctx.home_team,
            game_date=ctx.game_date,
            spread=float(vegas_spread) if vegas_spread is not None else 0.0,
            total=float(vegas_total) if vegas_total is not None else 140.0,
            projected_away_score=round(proj_away, 1),
            projected_home_score=round(proj_home, 1),
            projected_total=round(projected_total, 1),
            true_spread=round(true_spread, 1),
            spread_pick=spread_pick_side,
            spread_confidence=spread_tier.value,
            spread_composite=spread_composite,
            spread_value=round(true_spread - float(vegas_spread or 0), 1),
            total_pick=total_pick_side,
            total_confidence=total_tier.value,
            total_composite=total_composite,
            total_value=round(projected_total - float(vegas_total or 140), 1),
            dimension_results=results,
            headline=headline,
            key_factors=key_factors,
            trap_warnings=trap_warnings,
        )
        return card

    # ------------------------------------------------------------------
    # Full-slate analysis
    # ------------------------------------------------------------------

    def analyze_slate(
        self,
        game_date: str,
        season: int,
    ) -> list[PickCard]:
        """Analyze every game on a given date.

        Games are retrieved from the ``vegas_lines`` table via
        :func:`queries.get_games_for_date`.  The returned list is sorted
        by primary composite score (best picks first).

        Parameters
        ----------
        game_date:
            ISO-formatted date string (``YYYY-MM-DD``).
        season:
            Four-digit season year.

        Returns
        -------
        list[PickCard]
            Sorted descending by the maximum of spread / total composite.
        """
        games = self._safe_query_df(
            queries.get_all_lines_for_date, game_date,
        )

        if games.empty:
            logger.warning(
                "No games found for %s (season %d).", game_date, season,
            )
            return []

        cards: list[PickCard] = []
        for _, row in games.iterrows():
            away = row.get("away_team", "")
            home = row.get("home_team", "")
            if not away or not home:
                logger.warning(
                    "Skipping row with missing team names: %s", dict(row),
                )
                continue

            try:
                ctx = self.build_context(away, home, game_date, season)
                card = self.analyze_matchup(ctx)
                cards.append(card)
            except Exception:
                logger.exception(
                    "Failed to analyze %s @ %s on %s.",
                    away, home, game_date,
                )

        # Sort: highest composite first.
        cards.sort(
            key=lambda c: max(c.spread_composite, c.total_composite),
            reverse=True,
        )

        # Persist non-SKIP picks to pick_history.
        self._save_picks(cards, season)

        return cards

    # ------------------------------------------------------------------
    # Dimension dispatcher
    # ------------------------------------------------------------------

    def _run_dimension(
        self,
        dim_name: str,
        ctx: MatchupContext,
    ) -> DimensionResult:
        """Execute a single analytical dimension.

        The dimension module is lazily imported on first use and cached
        for the lifetime of the pipeline instance.  If the dimension
        raises, a neutral :class:`DimensionResult` (zero edge, zero
        confidence) is returned so that one broken dimension never
        crashes the entire pipeline.

        Parameters
        ----------
        dim_name:
            Key in :attr:`DIMENSION_WEIGHTS` (e.g. ``"pace_adjusted"``).
        ctx:
            Matchup context.

        Returns
        -------
        DimensionResult
        """
        try:
            func = self._get_dimension_func(dim_name)
            result: DimensionResult = func(ctx)

            # Validate / clamp confidence to [0, 1].
            result.confidence = max(0.0, min(1.0, result.confidence))
            return result

        except Exception:
            logger.exception(
                "Dimension '%s' failed for %s @ %s; returning neutral result.",
                dim_name,
                ctx.away_team,
                ctx.home_team,
            )
            return DimensionResult(
                name=dim_name,
                spread_edge=0.0,
                total_edge=0.0,
                confidence=0.0,
                narrative=f"[{dim_name}] dimension unavailable.",
            )

    def _get_dimension_func(self, dim_name: str) -> object:
        """Lazily import and cache the ``analyze`` callable for *dim_name*.

        Raises :class:`KeyError` if *dim_name* is not in the registry.
        """
        if dim_name in self._dim_funcs:
            return self._dim_funcs[dim_name]

        if dim_name not in _DIMENSION_REGISTRY:
            raise KeyError(f"Unknown dimension: {dim_name!r}")

        module_path, func_name = _DIMENSION_REGISTRY[dim_name]
        module = importlib.import_module(module_path, package=__package__)
        func = getattr(module, func_name)
        self._dim_funcs[dim_name] = func
        return func

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _save_picks(self, cards: list[PickCard], season: int = 2025) -> None:
        """Write pick cards to the ``pick_history`` table.

        Uses ``INSERT OR REPLACE`` so that re-running analysis for the
        same date overwrites stale picks rather than duplicating rows.
        Only non-SKIP picks are persisted.

        Parameters
        ----------
        cards:
            Pick cards to persist.
        """
        analysis_date = datetime.utcnow().strftime("%Y-%m-%d")

        insert_sql = """
            INSERT OR REPLACE INTO pick_history (
                analysis_date, game_date, season,
                away_team, home_team,
                pick_type, pick_side,
                confidence, composite_score,
                spread_at_pick, total_at_pick
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        rows_written = 0

        for card in cards:
            # Spread pick row.
            if card.spread_confidence != ConfidenceTier.SKIP.value:
                try:
                    self._conn.execute(insert_sql, (
                        analysis_date,
                        card.game_date,
                        season,
                        card.away_team,
                        card.home_team,
                        "spread",
                        card.spread_pick,
                        card.spread_confidence,
                        card.spread_composite,
                        card.spread,
                        card.total,
                    ))
                    rows_written += 1
                except Exception:
                    logger.exception(
                        "Failed to save spread pick for %s @ %s.",
                        card.away_team,
                        card.home_team,
                    )

            # Total pick row.
            if card.total_confidence != ConfidenceTier.SKIP.value:
                try:
                    self._conn.execute(insert_sql, (
                        analysis_date,
                        card.game_date,
                        season,
                        card.away_team,
                        card.home_team,
                        "total",
                        card.total_pick,
                        card.total_confidence,
                        card.total_composite,
                        card.spread,
                        card.total,
                    ))
                    rows_written += 1
                except Exception:
                    logger.exception(
                        "Failed to save total pick for %s @ %s.",
                        card.away_team,
                        card.home_team,
                    )

        if rows_written:
            try:
                self._conn.commit()
                logger.info(
                    "Saved %d pick(s) to pick_history for %s.",
                    rows_written,
                    analysis_date,
                )
            except Exception:
                logger.exception("Failed to commit pick_history inserts.")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _aggregate_direction(
        results: list[DimensionResult],
        edge_attr: str,
    ) -> float:
        """Return the confidence-weighted sum of an edge across all results.

        Used to determine *which* side the model favours (away vs. home,
        or over vs. under) independently of the composite magnitude.

        Parameters
        ----------
        results:
            Dimension results.
        edge_attr:
            ``"spread_edge"`` or ``"total_edge"``.

        Returns
        -------
        float
            Positive -> away / over; negative -> home / under.
        """
        return sum(
            getattr(r, edge_attr, 0.0) * r.confidence
            for r in results
        )

    def _safe_query_series(self, query_func, *args) -> pd.Series:
        """Call *query_func* and coerce the result to :class:`pd.Series`.

        If the query returns ``None``, raises, or yields an empty
        result, an empty Series is returned so callers never see ``None``.
        """
        try:
            result = query_func(self._conn, *args)
            if result is None:
                return pd.Series(dtype="float64")
            if isinstance(result, pd.Series):
                return result
            if isinstance(result, pd.DataFrame):
                if result.empty:
                    return pd.Series(dtype="float64")
                return result.iloc[0]
            # sqlite3.Row or dict-like
            return pd.Series(dict(result))
        except Exception:
            logger.debug(
                "Query %s returned no data for args %s.",
                getattr(query_func, "__name__", query_func),
                args,
            )
            return pd.Series(dtype="float64")

    def _safe_query_df(self, query_func, *args) -> pd.DataFrame:
        """Call *query_func* and coerce the result to :class:`pd.DataFrame`.

        If the query returns ``None``, raises, or yields an empty
        result, an empty DataFrame is returned.
        """
        try:
            result = query_func(self._conn, *args)
            if result is None:
                return pd.DataFrame()
            if isinstance(result, pd.DataFrame):
                return result
            if isinstance(result, list):
                if not result:
                    return pd.DataFrame()
                # Handles lists of sqlite3.Row objects.
                return pd.DataFrame([dict(r) for r in result])
            return pd.DataFrame()
        except Exception:
            logger.debug(
                "Query %s returned no data for args %s.",
                getattr(query_func, "__name__", query_func),
                args,
            )
            return pd.DataFrame()
