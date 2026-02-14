"""Rank Asymmetry dimension.

Compares offensive vs defensive ranking mismatches between the two teams.
If Team A is ranked #5 in AdjO but Team B is only #100 in AdjD, that is a
significant asymmetry favouring Team A's offence.  This dimension examines
both sides of the ball for both teams to surface the dominant matchup axis.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..pipeline import MatchupContext, DimensionResult

DIMENSION_NAME = "rank_asymmetry"

# Thresholds for flagging significant asymmetries
LARGE_GAP = 80   # ranks
HUGE_GAP = 150


def _safe_rank(series: pd.Series, key: str, default: float = 182.0) -> float:
    if series.empty:
        return default
    try:
        val = float(series[key])
        return val if np.isfinite(val) else default
    except (KeyError, TypeError, ValueError):
        return default


def _rank_tier(rank: float) -> str:
    if rank <= 25:
        return "elite"
    if rank <= 75:
        return "strong"
    if rank <= 180:
        return "average"
    if rank <= 280:
        return "below-average"
    return "poor"


def analyze(ctx: MatchupContext) -> DimensionResult:
    if ctx.away_ratings.empty or ctx.home_ratings.empty:
        return DimensionResult(
            name=DIMENSION_NAME,
            spread_edge=0.0,
            total_edge=0.0,
            confidence=0.0,
            narrative="Ratings data unavailable for rank-asymmetry analysis.",
        )

    away_o_rank = _safe_rank(ctx.away_ratings, "adj_o_rank")
    away_d_rank = _safe_rank(ctx.away_ratings, "adj_d_rank")
    home_o_rank = _safe_rank(ctx.home_ratings, "adj_o_rank")
    home_d_rank = _safe_rank(ctx.home_ratings, "adj_d_rank")

    findings: list[str] = []
    spread_edge = 0.0
    total_edge = 0.0

    # --- Away offence vs Home defence ---
    gap_a_off = home_d_rank - away_o_rank  # positive = away offence advantage
    if abs(gap_a_off) >= LARGE_GAP:
        direction = "exploits" if gap_a_off > 0 else "is stifled by"
        findings.append(
            f"{ctx.away_team}'s {_rank_tier(away_o_rank)} offence "
            f"(#{away_o_rank:.0f}) {direction} {ctx.home_team}'s "
            f"{_rank_tier(home_d_rank)} defence (#{home_d_rank:.0f}) "
            f"[gap {gap_a_off:+.0f}]."
        )
        # Scale to point-value estimate
        spread_edge += gap_a_off / 364.0 * 3.0  # positive = away value

    # --- Home offence vs Away defence ---
    gap_h_off = away_d_rank - home_o_rank  # positive = home offence advantage
    if abs(gap_h_off) >= LARGE_GAP:
        direction = "exploits" if gap_h_off > 0 else "is stifled by"
        findings.append(
            f"{ctx.home_team}'s {_rank_tier(home_o_rank)} offence "
            f"(#{home_o_rank:.0f}) {direction} {ctx.away_team}'s "
            f"{_rank_tier(away_d_rank)} defence (#{away_d_rank:.0f}) "
            f"[gap {gap_h_off:+.0f}]."
        )
        spread_edge -= gap_h_off / 364.0 * 3.0  # negative = home value

    # --- Total implications ---
    # If both offences outrank the opposing defence, lean over
    if gap_a_off > LARGE_GAP and gap_h_off > LARGE_GAP:
        total_edge = (gap_a_off + gap_h_off) / 364.0 * 2.0
        findings.append(
            "Both offences significantly outrank opposing defences -- "
            "over lean."
        )
    elif gap_a_off < -LARGE_GAP and gap_h_off < -LARGE_GAP:
        total_edge = (gap_a_off + gap_h_off) / 364.0 * 2.0
        findings.append(
            "Both defences significantly outrank opposing offences -- "
            "under lean."
        )

    # --- Intra-team imbalance (offence-heavy vs defence-heavy) ---
    for team, o_rank, d_rank in [
        (ctx.away_team, away_o_rank, away_d_rank),
        (ctx.home_team, home_o_rank, home_d_rank),
    ]:
        imbalance = d_rank - o_rank  # positive = offence much better
        if abs(imbalance) > HUGE_GAP:
            style = "offence-heavy" if imbalance > 0 else "defence-heavy"
            findings.append(
                f"{team} is {style} (O #{o_rank:.0f}, D #{d_rank:.0f}, "
                f"gap {imbalance:+.0f})."
            )

    if not findings:
        findings.append(
            f"No major rank asymmetries: {ctx.away_team} O#{away_o_rank:.0f} / "
            f"D#{away_d_rank:.0f}, {ctx.home_team} O#{home_o_rank:.0f} / "
            f"D#{home_d_rank:.0f}."
        )

    # Confidence scales with the size of gaps found
    max_gap = max(abs(gap_a_off), abs(gap_h_off))
    if max_gap >= HUGE_GAP:
        conf = 0.75
    elif max_gap >= LARGE_GAP:
        conf = 0.55
    else:
        conf = 0.25

    return DimensionResult(
        name=DIMENSION_NAME,
        spread_edge=round(spread_edge, 2),
        total_edge=round(total_edge, 2),
        confidence=round(conf, 2),
        narrative=" ".join(findings),
        raw_data={
            "away_o_rank": away_o_rank,
            "away_d_rank": away_d_rank,
            "home_o_rank": home_o_rank,
            "home_d_rank": home_d_rank,
            "gap_away_off_vs_home_def": gap_a_off,
            "gap_home_off_vs_away_def": gap_h_off,
        },
    )
