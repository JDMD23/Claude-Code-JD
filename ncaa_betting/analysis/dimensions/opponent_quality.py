"""Opponent Quality dimension.

Segments each team's game-log performance by the quality of the opponent
they faced (based on opponent defensive efficiency rank).  Identifies teams
that play up or down to the level of competition, which matters most in
matchups with a large talent gap.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..pipeline import MatchupContext, DimensionResult

DIMENSION_NAME = "opponent_quality"

# Opponent tiers by adj_de_rank (lower rank = better defense)
TIERS = [
    ("Elite", 0, 50),
    ("Strong", 50, 150),
    ("Average", 150, 250),
    ("Weak", 250, 500),
]


def _bucket_games(logs: pd.DataFrame) -> dict:
    """Split game logs into opponent-quality tiers and compute mean adj_oe."""
    if logs.empty or "opp_adj_de_rank" not in logs.columns:
        return {}

    results = {}
    for label, lo, hi in TIERS:
        mask = (logs["opp_adj_de_rank"] >= lo) & (logs["opp_adj_de_rank"] < hi)
        subset = logs.loc[mask]
        if len(subset) >= 1:
            entry: dict = {
                "games": len(subset),
                "avg_adj_oe": float(subset["adj_oe"].mean()),
            }
            if "adj_de" in subset.columns:
                entry["avg_adj_de"] = float(subset["adj_de"].mean())
            if {"team_score", "opp_score"}.issubset(subset.columns):
                entry["avg_margin"] = float(
                    (subset["team_score"] - subset["opp_score"]).mean()
                )
            results[label] = entry
    return results


def _quality_trend(buckets: dict):
    """Detect whether a team performs better or worse against quality foes.

    Returns (trend_label, top_oe, bottom_oe, diff).
    """
    elite_oe = buckets.get("Elite", {}).get("avg_adj_oe")
    strong_oe = buckets.get("Strong", {}).get("avg_adj_oe")
    weak_oe = buckets.get("Weak", {}).get("avg_adj_oe")
    avg_oe = buckets.get("Average", {}).get("avg_adj_oe")

    top_oe = elite_oe if elite_oe is not None else strong_oe
    bottom_oe = weak_oe if weak_oe is not None else avg_oe

    if top_oe is None or bottom_oe is None:
        return "unknown", None, None, 0.0

    diff = top_oe - bottom_oe
    if diff > 3.0:
        label = "rises to competition"
    elif diff < -3.0:
        label = "plays down to competition"
    else:
        label = "consistent across tiers"
    return label, top_oe, bottom_oe, diff


def _tier_for_rank(rank: float) -> str:
    for label, lo, hi in TIERS:
        if lo <= rank < hi:
            return label
    return "Weak"


def analyze(ctx: MatchupContext) -> DimensionResult:
    away_buckets = _bucket_games(ctx.away_game_logs)
    home_buckets = _bucket_games(ctx.home_game_logs)

    if not away_buckets and not home_buckets:
        return DimensionResult(
            name=DIMENSION_NAME,
            spread_edge=0.0,
            total_edge=0.0,
            confidence=0.0,
            narrative="Game log data insufficient for opponent-quality analysis.",
        )

    away_trend, away_top, away_bot, away_diff = _quality_trend(away_buckets)
    home_trend, home_top, home_bot, home_diff = _quality_trend(home_buckets)

    # Determine opponent tier each team is facing in THIS game
    away_def_rank = (
        float(ctx.home_ratings.get("adj_d_rank", 182))
        if not ctx.home_ratings.empty else 182.0
    )
    home_def_rank = (
        float(ctx.away_ratings.get("adj_d_rank", 182))
        if not ctx.away_ratings.empty else 182.0
    )

    away_facing = _tier_for_rank(away_def_rank)
    home_facing = _tier_for_rank(home_def_rank)

    # Estimate edge: if a team rises against quality and is facing quality, bonus
    spread_edge = 0.0
    if away_buckets.get(away_facing):
        away_context_oe = away_buckets[away_facing]["avg_adj_oe"]
        season_oe = float(np.mean([b["avg_adj_oe"] for b in away_buckets.values()]))
        spread_edge += (away_context_oe - season_oe) * 0.08
    if home_buckets.get(home_facing):
        home_context_oe = home_buckets[home_facing]["avg_adj_oe"]
        season_oe = float(np.mean([b["avg_adj_oe"] for b in home_buckets.values()]))
        spread_edge -= (home_context_oe - season_oe) * 0.08

    total_edge = 0.0
    if away_buckets.get(away_facing) and home_buckets.get(home_facing):
        a_oe = away_buckets[away_facing]["avg_adj_oe"]
        h_oe = home_buckets[home_facing]["avg_adj_oe"]
        total_avg_oe = float(np.mean(
            [b["avg_adj_oe"] for b in away_buckets.values()]
            + [b["avg_adj_oe"] for b in home_buckets.values()]
        ))
        total_edge = ((a_oe + h_oe) / 2.0 - total_avg_oe) * 0.10

    n_games = sum(b.get("games", 0) for b in away_buckets.values()) + sum(
        b.get("games", 0) for b in home_buckets.values()
    )
    conf = min(0.75, 0.15 + n_games * 0.015)
    conf = round(max(0.10, conf), 2)

    parts: list[str] = []
    if away_top is not None and away_bot is not None:
        parts.append(
            f"{ctx.away_team} {away_trend} (top-tier OE {away_top:.1f}, "
            f"low-tier OE {away_bot:.1f}, diff {away_diff:+.1f})."
        )
    else:
        parts.append(f"{ctx.away_team}: insufficient tier data.")
    if home_top is not None and home_bot is not None:
        parts.append(
            f"{ctx.home_team} {home_trend} (top-tier OE {home_top:.1f}, "
            f"low-tier OE {home_bot:.1f}, diff {home_diff:+.1f})."
        )
    else:
        parts.append(f"{ctx.home_team}: insufficient tier data.")
    parts.append(
        f"In this matchup {ctx.away_team} faces {away_facing}-tier defense, "
        f"{ctx.home_team} faces {home_facing}-tier defense."
    )

    return DimensionResult(
        name=DIMENSION_NAME,
        spread_edge=round(spread_edge, 2),
        total_edge=round(total_edge, 2),
        confidence=conf,
        narrative=" ".join(parts),
        raw_data={
            "away_buckets": away_buckets,
            "home_buckets": home_buckets,
            "away_trend": away_trend,
            "home_trend": home_trend,
        },
    )
