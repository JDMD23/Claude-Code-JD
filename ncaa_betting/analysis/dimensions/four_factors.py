"""Four Factors dimension.

Applies Dean Oliver's four-factor framework (eFG%, TO%, OR%, FTRate) with
standard weights to evaluate each team's offensive and defensive profile.
Identifies tier-level asymmetries that create betting edges.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..pipeline import MatchupContext, DimensionResult

DIMENSION_NAME = "four_factors"

# Dean Oliver weights
WEIGHTS = {"efg": 0.40, "to": 0.25, "or": 0.20, "ft_rate": 0.15}

# Tier boundaries (rank out of ~364 D1 teams)
TIER_BOUNDS = [
    (37, "Elite"),
    (110, "Strong"),
    (220, "Average"),
    (300, "Weak"),
]


def _tier(rank: float) -> str:
    for bound, label in TIER_BOUNDS:
        if rank < bound:
            return label
    return "Poor"


def _safe_rank(series: pd.Series, key: str, default: float = 182.0) -> float:
    try:
        val = float(series[key])
        return val if np.isfinite(val) else default
    except (KeyError, TypeError, ValueError):
        return default


def _factor_score(off_rank: float, def_rank: float) -> float:
    """Return a signed score: positive means the offense has the advantage."""
    return (def_rank - off_rank) / 364.0


def _analyze_side(off_ff: pd.Series, def_ff: pd.Series,
                  off_label: str, def_label: str):
    """Score one side of the matchup (Team-A offense vs Team-B defense)."""
    factors = {}
    asymmetries: list[str] = []

    for factor, weight in WEIGHTS.items():
        if factor == "efg":
            o_rank = _safe_rank(off_ff, "off_efg_rank")
            d_rank = _safe_rank(def_ff, "def_efg_rank")
        elif factor == "to":
            o_rank = _safe_rank(off_ff, "off_to_rank")
            d_rank = _safe_rank(def_ff, "def_to_rank")
        elif factor == "or":
            o_rank = _safe_rank(off_ff, "off_or_rank")
            d_rank = _safe_rank(def_ff, "def_or_rank")
        else:
            o_rank = _safe_rank(off_ff, "off_ft_rate_rank")
            d_rank = _safe_rank(def_ff, "def_ft_rate_rank")

        score = _factor_score(o_rank, d_rank) * weight
        o_tier = _tier(o_rank)
        d_tier = _tier(d_rank)
        factors[factor] = {
            "off_rank": o_rank,
            "def_rank": d_rank,
            "off_tier": o_tier,
            "def_tier": d_tier,
            "weighted_score": round(score, 4),
        }

        # Flag meaningful asymmetries (2+ tier gap)
        tier_order = ["Elite", "Strong", "Average", "Weak", "Poor"]
        o_idx = tier_order.index(o_tier)
        d_idx = tier_order.index(d_tier)
        gap = d_idx - o_idx  # positive = offense tier better
        if abs(gap) >= 2:
            direction = "advantage" if gap > 0 else "disadvantage"
            asymmetries.append(
                f"{off_label}'s {factor.upper()} offense ({o_tier} #{o_rank:.0f}) "
                f"vs {def_label}'s defense ({d_tier} #{d_rank:.0f}): {direction}"
            )

    composite = sum(f["weighted_score"] for f in factors.values())
    return composite, factors, asymmetries


def analyze(ctx: MatchupContext) -> DimensionResult:
    if ctx.away_four_factors.empty or ctx.home_four_factors.empty:
        return DimensionResult(
            name=DIMENSION_NAME,
            spread_edge=0.0,
            total_edge=0.0,
            confidence=0.0,
            narrative="Four factors data unavailable.",
        )

    # Away offense vs Home defense
    away_score, away_factors, away_asym = _analyze_side(
        ctx.away_four_factors, ctx.home_four_factors, ctx.away_team, ctx.home_team,
    )
    # Home offense vs Away defense
    home_score, home_factors, home_asym = _analyze_side(
        ctx.home_four_factors, ctx.away_four_factors, ctx.home_team, ctx.away_team,
    )

    net_score = away_score - home_score  # positive = away overall advantage
    spread_edge = net_score * 8.0  # scale to approximate point value

    # Total edge: if both offenses have factor advantages, lean over
    off_sum = away_score + home_score
    total_edge = off_sum * 5.0

    all_asym = away_asym + home_asym
    conf = min(0.85, 0.30 + 0.10 * len(all_asym) + abs(net_score) * 0.8)
    conf = round(max(0.10, conf), 2)

    parts = [
        f"Four-factor composite: {ctx.away_team} {away_score:+.3f}, "
        f"{ctx.home_team} {home_score:+.3f}.",
    ]
    if all_asym:
        parts.append("Key asymmetries: " + "; ".join(all_asym) + ".")
    else:
        parts.append("No significant tier-level asymmetries detected.")

    return DimensionResult(
        name=DIMENSION_NAME,
        spread_edge=round(spread_edge, 2),
        total_edge=round(total_edge, 2),
        confidence=conf,
        narrative=" ".join(parts),
        raw_data={
            "away_factors": away_factors,
            "home_factors": home_factors,
            "asymmetries": all_asym,
        },
    )
