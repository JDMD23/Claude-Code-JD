"""Variance / volatility dimension.

Calculates the standard deviation of adj_oe and adj_de from game logs to
assess predictability.  High-variance teams are harder to cap accurately;
this dimension also identifies ceiling (best adj_oe) and floor (worst adj_oe)
games and classifies overall volatility.  Higher variance reduces model
confidence across all dimensions.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..pipeline import MatchupContext, DimensionResult

DIMENSION_NAME = "variance"

# Volatility thresholds (std-dev of adj_oe)
HIGH_VOL = 10.0
MED_VOL = 6.0


def _vol_label(std: float) -> str:
    if std >= HIGH_VOL:
        return "High"
    if std >= MED_VOL:
        return "Medium"
    return "Low"


def _analyze_team(logs: pd.DataFrame, team: str):
    """Return volatility stats for one team, or None if data is missing."""
    if logs.empty or "adj_oe" not in logs.columns:
        return None

    oe = logs["adj_oe"].dropna()
    if len(oe) < 5:
        return None

    oe_std = float(oe.std())
    oe_mean = float(oe.mean())
    ceiling = float(oe.max())
    floor = float(oe.min())
    vol = _vol_label(oe_std)

    de_std = None
    if "adj_de" in logs.columns:
        de_vals = logs["adj_de"].dropna()
        if len(de_vals) >= 5:
            de_std = float(de_vals.std())

    # Margin consistency
    margin_std = None
    if {"team_score", "opp_score"}.issubset(logs.columns):
        margins = logs["team_score"] - logs["opp_score"]
        if len(margins) >= 5:
            margin_std = float(margins.std())

    return {
        "oe_std": round(oe_std, 2),
        "oe_mean": round(oe_mean, 2),
        "ceiling": round(ceiling, 2),
        "floor": round(floor, 2),
        "range": round(ceiling - floor, 2),
        "de_std": round(de_std, 2) if de_std is not None else None,
        "margin_std": round(margin_std, 2) if margin_std is not None else None,
        "volatility": vol,
        "games": len(oe),
    }


def analyze(ctx: MatchupContext) -> DimensionResult:
    away_v = _analyze_team(ctx.away_game_logs, ctx.away_team)
    home_v = _analyze_team(ctx.home_game_logs, ctx.home_team)

    if away_v is None and home_v is None:
        return DimensionResult(
            name=DIMENSION_NAME,
            spread_edge=0.0,
            total_edge=0.0,
            confidence=0.0,
            narrative="Insufficient game-log data for variance analysis.",
        )

    parts: list[str] = []
    spread_edge = 0.0
    total_edge = 0.0
    confidence_penalty = 0.0

    for label, stats, sign in [
        (ctx.away_team, away_v, 1.0),
        (ctx.home_team, home_v, -1.0),
    ]:
        if stats is None:
            parts.append(f"{label}: variance data unavailable.")
            continue

        vol = stats["volatility"]
        parts.append(
            f"{label} {vol} volatility (OE std {stats['oe_std']:.1f}, "
            f"ceiling {stats['ceiling']:.1f}, floor {stats['floor']:.1f}, "
            f"range {stats['range']:.1f})."
        )

        # High-variance teams are boom-or-bust: less reliable to back
        if vol == "High":
            confidence_penalty += 0.15
            # Slight lean toward the under: high-variance teams can also
            # have blowout losses that suppress scoring.
            total_edge -= 0.3 * sign
        elif vol == "Low":
            # Consistent team: lean toward their mean; slightly more
            # trustworthy to back.
            pass

        # If one team is far more volatile than the other, the stable team
        # is more likely to produce its expected output.
        if away_v and home_v:
            vol_diff = (away_v["oe_std"] - home_v["oe_std"])
            if abs(vol_diff) > 3.0:
                stable = ctx.home_team if vol_diff > 0 else ctx.away_team
                parts.append(
                    f"{stable} is notably more consistent "
                    f"(std diff {abs(vol_diff):.1f})."
                )
                # Lean toward the stable team covering
                spread_edge += -np.sign(vol_diff) * abs(vol_diff) * 0.08

    # Combined volatility affects total predictability
    if away_v and home_v:
        combined_std = (away_v["oe_std"] + home_v["oe_std"]) / 2.0
        if combined_std > HIGH_VOL:
            parts.append(
                "Both teams are highly volatile; total market is a coinflip."
            )
            total_edge = 0.0
            confidence_penalty += 0.10

    # Confidence inversely related to volatility
    base_conf = 0.50 - confidence_penalty
    conf = round(max(0.10, min(0.70, base_conf)), 2)

    return DimensionResult(
        name=DIMENSION_NAME,
        spread_edge=round(spread_edge, 2),
        total_edge=round(total_edge, 2),
        confidence=conf,
        narrative=" ".join(parts),
        raw_data={"away": away_v, "home": home_v},
    )
