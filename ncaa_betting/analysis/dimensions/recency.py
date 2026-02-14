"""Recency / momentum dimension.

Compares each team's last-5-game efficiency against their full-season
averages to detect improving, declining, or stable trajectories.  Also
examines the ratings_history snapshots for multi-week trends when available.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..pipeline import MatchupContext, DimensionResult

DIMENSION_NAME = "recency"
WINDOW = 5
THRESHOLD_PCT = 3.0  # percent change to flag trend


def _pct_change(recent: float, season: float) -> float:
    if season == 0:
        return 0.0
    return ((recent - season) / abs(season)) * 100.0


def _classify(pct: float) -> str:
    if pct > THRESHOLD_PCT:
        return "improving"
    elif pct < -THRESHOLD_PCT:
        return "declining"
    return "stable"


def _game_log_trend(logs: pd.DataFrame):
    """Compare last-WINDOW games to full season for adj_oe and adj_de."""
    if logs.empty or "adj_oe" not in logs.columns:
        return None

    sorted_logs = logs.sort_values("game_date", ascending=False)
    recent = sorted_logs.head(WINDOW)
    if len(recent) < 3:
        return None

    season_oe = float(sorted_logs["adj_oe"].mean())
    recent_oe = float(recent["adj_oe"].mean())
    oe_pct = _pct_change(recent_oe, season_oe)

    season_de = None
    recent_de = None
    de_pct = 0.0
    if "adj_de" in sorted_logs.columns:
        season_de = float(sorted_logs["adj_de"].mean())
        recent_de = float(recent["adj_de"].mean())
        de_pct = _pct_change(recent_de, season_de)

    return {
        "season_oe": season_oe,
        "recent_oe": recent_oe,
        "oe_pct": oe_pct,
        "oe_trend": _classify(oe_pct),
        "season_de": season_de,
        "recent_de": recent_de,
        "de_pct": de_pct,
        "de_trend": _classify(-de_pct),  # lower DE is better, invert
        "recent_games": len(recent),
    }


def _history_trend(hist: pd.DataFrame):
    """Detect multi-snapshot trend from ratings_history (adj_em over time)."""
    if hist.empty or "adj_em" not in hist.columns:
        return None
    if len(hist) < 3:
        return None

    date_col = "game_date" if "game_date" in hist.columns else hist.columns[0]
    sorted_h = hist.sort_values(date_col)
    vals = sorted_h["adj_em"].dropna().values
    if len(vals) < 3:
        return None

    first_half = vals[: len(vals) // 2].mean()
    second_half = vals[len(vals) // 2 :].mean()
    diff = second_half - first_half

    if diff > 1.5:
        return "upward trajectory"
    elif diff < -1.5:
        return "downward trajectory"
    return "flat trajectory"


def analyze(ctx: MatchupContext) -> DimensionResult:
    away_t = _game_log_trend(ctx.away_game_logs)
    home_t = _game_log_trend(ctx.home_game_logs)

    if away_t is None and home_t is None:
        return DimensionResult(
            name=DIMENSION_NAME,
            spread_edge=0.0,
            total_edge=0.0,
            confidence=0.0,
            narrative="Insufficient game-log data for recency analysis.",
        )

    spread_edge = 0.0
    total_edge = 0.0
    parts: list[str] = []

    for label, trend, sign in [
        (ctx.away_team, away_t, 1.0),
        (ctx.home_team, home_t, -1.0),
    ]:
        if trend is None:
            parts.append(f"{label}: no recent trend data.")
            continue

        oe_dir = trend["oe_trend"]
        de_dir = trend["de_trend"]

        parts.append(
            f"{label} offense {oe_dir} (last {WINDOW}: {trend['recent_oe']:.1f}, "
            f"season: {trend['season_oe']:.1f}, {trend['oe_pct']:+.1f}%). "
            f"Defense {de_dir}."
        )

        # Edge: improving offense helps the team
        oe_boost = (trend["recent_oe"] - trend["season_oe"]) * 0.04
        de_boost = 0.0
        if trend["season_de"] is not None and trend["recent_de"] is not None:
            # Lower DE is better, so negative diff = improvement
            de_boost = (trend["season_de"] - trend["recent_de"]) * 0.04

        spread_edge += sign * (oe_boost + de_boost)
        total_edge += oe_boost * 0.5  # improving offense pushes total up

    # Incorporate ratings history if available
    away_hist = _history_trend(ctx.away_ratings_history)
    home_hist = _history_trend(ctx.home_ratings_history)
    for label, hist_trend, sign in [
        (ctx.away_team, away_hist, 1.0),
        (ctx.home_team, home_hist, -1.0),
    ]:
        if hist_trend:
            parts.append(f"{label} season-long {hist_trend}.")
            if "upward" in hist_trend:
                spread_edge += sign * 0.5
            elif "downward" in hist_trend:
                spread_edge -= sign * 0.5

    # Confidence: higher when trends are pronounced
    pcts: list[float] = []
    if away_t:
        pcts.append(abs(away_t["oe_pct"]))
    if home_t:
        pcts.append(abs(home_t["oe_pct"]))
    avg_pct = float(np.mean(pcts)) if pcts else 0.0
    conf = min(0.75, 0.20 + avg_pct * 0.04)
    conf = round(max(0.10, conf), 2)

    return DimensionResult(
        name=DIMENSION_NAME,
        spread_edge=round(spread_edge, 2),
        total_edge=round(total_edge, 2),
        confidence=conf,
        narrative=" ".join(parts),
        raw_data={
            "away_trend": away_t,
            "home_trend": home_t,
            "away_history": away_hist,
            "home_history": home_hist,
        },
    )
