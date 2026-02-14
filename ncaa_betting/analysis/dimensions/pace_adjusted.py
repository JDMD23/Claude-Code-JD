"""Pace-adjusted projection dimension.

Projects possessions from tempo ratings and estimates points for each team
using blended offensive/defensive efficiency.  Compares the projected margin
and total against the posted spread and over/under line.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..pipeline import MatchupContext, DimensionResult

DIMENSION_NAME = "pace_adjusted"
D1_AVG_TEMPO = 67.5


def _safe_float(series: pd.Series, key: str, default: float = 0.0) -> float:
    """Extract a float from a Series, returning *default* on any failure."""
    if series.empty:
        return default
    try:
        val = float(series[key])
        return val if np.isfinite(val) else default
    except (KeyError, TypeError, ValueError):
        return default


def _recent_efficiency(game_logs: pd.DataFrame, n: int = 5):
    """Return mean adj_oe and adj_de from the last *n* games, or None."""
    if game_logs.empty or "adj_oe" not in game_logs.columns:
        return None, None
    recent = game_logs.sort_values("game_date", ascending=False).head(n)
    if recent.empty:
        return None, None
    oe = float(recent["adj_oe"].mean())
    de = float(recent["adj_de"].mean()) if "adj_de" in recent.columns else None
    return oe, de


def analyze(ctx: MatchupContext) -> DimensionResult:
    """Project pace-adjusted score and compare to the line."""
    if ctx.away_ratings.empty or ctx.home_ratings.empty:
        return DimensionResult(
            name=DIMENSION_NAME,
            spread_edge=0.0,
            total_edge=0.0,
            confidence=0.0,
            narrative="Insufficient ratings data for pace-adjusted projection.",
        )

    # --- tempo / possessions ---
    away_tempo = _safe_float(ctx.away_ratings, "adj_t", D1_AVG_TEMPO)
    home_tempo = _safe_float(ctx.home_ratings, "adj_t", D1_AVG_TEMPO)
    expected_poss = (away_tempo * home_tempo) / D1_AVG_TEMPO

    # --- blended efficiency ---
    away_adj_o = _safe_float(ctx.away_ratings, "adj_o", 100.0)
    away_adj_d = _safe_float(ctx.away_ratings, "adj_d", 100.0)
    home_adj_o = _safe_float(ctx.home_ratings, "adj_o", 100.0)
    home_adj_d = _safe_float(ctx.home_ratings, "adj_d", 100.0)

    # If recent game logs exist, blend season rating (60 %) with recent (40 %)
    # so we capture momentum shifts.
    away_rec_oe, away_rec_de = _recent_efficiency(ctx.away_game_logs)
    home_rec_oe, home_rec_de = _recent_efficiency(ctx.home_game_logs)

    if away_rec_oe is not None:
        away_adj_o = 0.60 * away_adj_o + 0.40 * away_rec_oe
    if away_rec_de is not None:
        away_adj_d = 0.60 * away_adj_d + 0.40 * away_rec_de
    if home_rec_oe is not None:
        home_adj_o = 0.60 * home_adj_o + 0.40 * home_rec_oe
    if home_rec_de is not None:
        home_adj_d = 0.60 * home_adj_d + 0.40 * home_rec_de

    # Matchup efficiency: average of Team-A offense with Team-B defense
    away_off_eff = (away_adj_o + home_adj_d) / 2.0
    home_off_eff = (home_adj_o + away_adj_d) / 2.0

    # Convert per-100 efficiency to projected points
    away_pts = away_off_eff * (expected_poss / 100.0)
    home_pts = home_off_eff * (expected_poss / 100.0)

    proj_margin = home_pts - away_pts  # positive = home leads
    proj_total = away_pts + home_pts

    # --- compare to line ---
    spread = _safe_float(ctx.line, "spread", 0.0)
    total_line = _safe_float(ctx.line, "total", 0.0)

    # spread_edge: positive = away value.
    # spread is negative when home is favored.
    # spread=-5, proj_margin=8 => -5+8=+3 (away value, home won't cover)
    spread_edge = spread + proj_margin

    total_edge = proj_total - total_line if total_line > 0 else 0.0

    # --- confidence ---
    margin_diff = abs(spread_edge)
    if margin_diff > 6:
        conf = 0.80
    elif margin_diff > 3:
        conf = 0.60
    elif margin_diff > 1.5:
        conf = 0.40
    else:
        conf = 0.20

    # --- narrative ---
    parts = [
        f"Projected possessions: {expected_poss:.1f} "
        f"(away tempo {away_tempo:.1f}, home tempo {home_tempo:.1f}).",
        f"Projected score: {ctx.away_team} {away_pts:.1f} - "
        f"{ctx.home_team} {home_pts:.1f} "
        f"(margin {proj_margin:+.1f} home, total {proj_total:.1f}).",
    ]
    if total_line > 0:
        direction = "OVER" if total_edge > 0 else "UNDER"
        parts.append(
            f"Total line {total_line:.1f} => model says {direction} "
            f"by {abs(total_edge):.1f}."
        )
    if spread != 0:
        side = ctx.away_team if spread_edge > 0 else ctx.home_team
        parts.append(
            f"Spread {spread:+.1f} => model favors {side} "
            f"by {abs(spread_edge):.1f} pts."
        )

    return DimensionResult(
        name=DIMENSION_NAME,
        spread_edge=round(spread_edge, 2),
        total_edge=round(total_edge, 2),
        confidence=round(conf, 2),
        narrative=" ".join(parts),
        raw_data={
            "expected_poss": round(expected_poss, 2),
            "away_pts": round(away_pts, 2),
            "home_pts": round(home_pts, 2),
            "proj_margin": round(proj_margin, 2),
            "proj_total": round(proj_total, 2),
        },
    )
