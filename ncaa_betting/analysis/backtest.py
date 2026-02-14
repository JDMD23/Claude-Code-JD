"""Backtesting engine for NCAA basketball betting picks.

Evaluates historical pick accuracy and ROI by querying the
``pick_history`` table, grouping results by confidence tier, and
computing calibration metrics.
"""

from __future__ import annotations

import logging
import sqlite3
from dataclasses import dataclass, field
from typing import Optional

import pandas as pd

logger = logging.getLogger(__name__)

# Standard -110 juice: risk $110 to win $100.  A winning bet returns
# the original $110 + $100 profit = net +$100.  A losing bet loses $110.
_JUICE_RISK = 110.0
_JUICE_WIN = 100.0


@dataclass
class BacktestResult:
    """Aggregated backtest output.

    Attributes
    ----------
    total_picks : int
        Number of resolved picks included in the backtest.
    record : dict
        ``{tier: {"W": n, "L": n, "P": n}}`` win/loss/push counts per
        confidence tier.
    roi_by_tier : dict
        ``{tier: float}`` return on investment per tier, assuming flat
        unit betting at -110 juice.
    overall_roi : float
        Aggregate ROI across all tiers.
    accuracy_by_tier : dict
        ``{tier: float}`` win percentage (wins / (wins + losses)) per
        tier.  Pushes are excluded from the denominator.
    calibration_data : pd.DataFrame
        DataFrame with columns ``bin``, ``predicted``, ``actual``,
        ``count`` for reliability-diagram analysis.
    """

    total_picks: int
    record: dict = field(default_factory=dict)
    roi_by_tier: dict = field(default_factory=dict)
    overall_roi: float = 0.0
    accuracy_by_tier: dict = field(default_factory=dict)
    calibration_data: pd.DataFrame = field(default_factory=lambda: pd.DataFrame())


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _tier_from_composite(composite: float) -> str:
    """Map a composite score to its tier label.

    Mirrors :func:`ncaa_betting.analysis.scoring.assign_tier` so that
    the backtest can operate without importing the scoring module.
    """
    if composite >= 7.0:
        return "LOCK"
    if composite >= 4.5:
        return "STRONG"
    if composite >= 2.0:
        return "LEAN"
    return "SKIP"


def _compute_roi(wins: int, losses: int, pushes: int) -> float:
    """Compute ROI assuming flat unit betting at standard -110 juice.

    Returns 0.0 when there are no decided bets.
    """
    decided = wins + losses
    if decided == 0:
        return 0.0
    profit = (wins * _JUICE_WIN) - (losses * _JUICE_RISK)
    total_risked = decided * _JUICE_RISK
    return profit / total_risked


def _compute_accuracy(wins: int, losses: int) -> float:
    """Compute win percentage, excluding pushes.

    Returns 0.0 when there are no decided bets.
    """
    decided = wins + losses
    if decided == 0:
        return 0.0
    return wins / decided


def _build_calibration(df: pd.DataFrame) -> pd.DataFrame:
    """Build a calibration DataFrame from resolved picks.

    Bins picks by their composite score into decile-style buckets and
    computes the predicted vs. actual win rates.

    Parameters
    ----------
    df:
        Must have columns ``composite_score`` (float) and ``result``
        (``'W'``, ``'L'``, or ``'P'``).

    Returns
    -------
    pd.DataFrame
        Columns: ``bin``, ``predicted``, ``actual``, ``count``.
    """
    decided = df[df["result"].isin(["W", "L"])].copy()
    if decided.empty:
        return pd.DataFrame(columns=["bin", "predicted", "actual", "count"])

    decided["is_win"] = (decided["result"] == "W").astype(int)

    # Create bins based on composite score (0-10 scale, using 5 bins)
    bin_edges = [0.0, 2.0, 4.5, 7.0, 8.5, 10.01]
    bin_labels = ["0-2", "2-4.5", "4.5-7", "7-8.5", "8.5-10"]

    decided["bin"] = pd.cut(
        decided["composite_score"],
        bins=bin_edges,
        labels=bin_labels,
        right=False,
        include_lowest=True,
    )

    # Compute predicted (midpoint of bin / 10 as rough probability) and actual
    bin_midpoints = {
        "0-2": 0.10,
        "2-4.5": 0.325,
        "4.5-7": 0.575,
        "7-8.5": 0.775,
        "8.5-10": 0.925,
    }

    rows = []
    for bin_label in bin_labels:
        bin_data = decided[decided["bin"] == bin_label]
        if bin_data.empty:
            continue
        rows.append({
            "bin": bin_label,
            "predicted": bin_midpoints[bin_label],
            "actual": bin_data["is_win"].mean(),
            "count": len(bin_data),
        })

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_backtest(
    conn: sqlite3.Connection,
    *,
    season: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> BacktestResult:
    """Evaluate historical pick performance.

    Queries the ``pick_history`` table for picks with a non-NULL
    ``result`` column, then computes accuracy, ROI, and calibration
    metrics grouped by confidence tier.

    Parameters
    ----------
    conn:
        Open database connection (from
        :func:`~ncaa_betting.db.connection.get_connection`).
    season:
        Restrict to a specific season year.
    start_date:
        Earliest game date to include (``YYYY-MM-DD``).
    end_date:
        Latest game date to include (``YYYY-MM-DD``).

    Returns
    -------
    BacktestResult
        Aggregated performance metrics.
    """
    # Build query dynamically
    clauses: list[str] = ["result IS NOT NULL"]
    params: list = []

    if season is not None:
        clauses.append("season = ?")
        params.append(season)
    if start_date is not None:
        clauses.append("game_date >= ?")
        params.append(start_date)
    if end_date is not None:
        clauses.append("game_date <= ?")
        params.append(end_date)

    where = " AND ".join(clauses)
    sql = f"""
        SELECT game_date, away_team, home_team, pick_type, pick_side,
               confidence, composite_score, spread_at_pick, total_at_pick,
               result
          FROM pick_history
         WHERE {where}
         ORDER BY game_date
    """

    df = pd.read_sql_query(sql, conn, params=params)

    if df.empty:
        logger.warning("No resolved picks found for backtest query.")
        return BacktestResult(total_picks=0)

    # Assign tier from composite score
    df["tier"] = df["composite_score"].apply(_tier_from_composite)

    # Compute record by tier
    record: dict[str, dict[str, int]] = {}
    for tier in ["LOCK", "STRONG", "LEAN", "SKIP"]:
        tier_df = df[df["tier"] == tier]
        if tier_df.empty:
            continue
        record[tier] = {
            "W": int((tier_df["result"] == "W").sum()),
            "L": int((tier_df["result"] == "L").sum()),
            "P": int((tier_df["result"] == "P").sum()),
        }

    # ROI by tier
    roi_by_tier: dict[str, float] = {}
    for tier, rec in record.items():
        roi_by_tier[tier] = _compute_roi(rec["W"], rec["L"], rec["P"])

    # Accuracy by tier
    accuracy_by_tier: dict[str, float] = {}
    for tier, rec in record.items():
        accuracy_by_tier[tier] = _compute_accuracy(rec["W"], rec["L"])

    # Overall ROI
    total_wins = sum(r.get("W", 0) for r in record.values())
    total_losses = sum(r.get("L", 0) for r in record.values())
    total_pushes = sum(r.get("P", 0) for r in record.values())
    overall_roi = _compute_roi(total_wins, total_losses, total_pushes)

    # Calibration
    calibration_data = _build_calibration(df)

    result = BacktestResult(
        total_picks=len(df),
        record=record,
        roi_by_tier=roi_by_tier,
        overall_roi=overall_roi,
        accuracy_by_tier=accuracy_by_tier,
        calibration_data=calibration_data,
    )

    logger.info(
        "Backtest complete: %d picks, overall ROI %.1f%%",
        result.total_picks,
        result.overall_roi * 100,
    )
    return result


def record_result(
    conn: sqlite3.Connection,
    game_date: str,
    away_team: str,
    home_team: str,
    pick_type: str,
    result: str,
) -> None:
    """Record the outcome of a previously made pick.

    Updates the ``result`` column in the ``pick_history`` table for the
    matching row.

    Parameters
    ----------
    conn:
        Open database connection.
    game_date:
        Game date in ``YYYY-MM-DD`` format.
    away_team:
        Canonical away team name.
    home_team:
        Canonical home team name.
    pick_type:
        ``'spread'`` or ``'total'``.
    result:
        ``'W'`` (win), ``'L'`` (loss), or ``'P'`` (push).

    Raises
    ------
    ValueError
        If *result* is not one of ``W``, ``L``, ``P``.
        If *pick_type* is not one of ``spread``, ``total``.
    """
    result = result.upper()
    pick_type = pick_type.lower()

    if result not in ("W", "L", "P"):
        raise ValueError(
            f"result must be 'W', 'L', or 'P', got {result!r}"
        )
    if pick_type not in ("spread", "total"):
        raise ValueError(
            f"pick_type must be 'spread' or 'total', got {pick_type!r}"
        )

    sql = """
        UPDATE pick_history
           SET result = ?
         WHERE game_date = ?
           AND away_team = ?
           AND home_team = ?
           AND pick_type = ?
           AND result IS NULL
    """
    cursor = conn.execute(sql, (result, game_date, away_team, home_team, pick_type))
    rows_updated = cursor.rowcount

    if rows_updated == 0:
        logger.warning(
            "No unresolved pick found for %s @ %s on %s (%s). "
            "The pick may already have a result or may not exist.",
            away_team, home_team, game_date, pick_type,
        )
    else:
        logger.info(
            "Recorded result %s for %s @ %s on %s (%s)",
            result, away_team, home_team, game_date, pick_type,
        )
