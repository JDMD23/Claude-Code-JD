"""Shooting Zones dimension.

Evaluates 2-point and 3-point shooting matchups from the four-factors data.
A team that leans heavily on the three-point shot facing an elite perimeter
defense is a red flag; similarly, an interior-dominant offense against a
weak 2P defense is a green flag.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..pipeline import MatchupContext, DimensionResult

DIMENSION_NAME = "shooting_zones"

ELITE_RANK = 50
STRONG_RANK = 120
WEAK_RANK = 260


def _safe(series: pd.Series, key: str, default: float = 0.0) -> float:
    if series.empty:
        return default
    try:
        val = float(series[key])
        return val if np.isfinite(val) else default
    except (KeyError, TypeError, ValueError):
        return default


def _rank_label(rank: float) -> str:
    if rank < ELITE_RANK:
        return "elite"
    if rank < STRONG_RANK:
        return "strong"
    if rank < WEAK_RANK:
        return "average"
    return "weak"


def _analyze_side(off_ff: pd.Series, def_ff: pd.Series,
                  off_team: str, def_team: str):
    """Analyze one side: off_team's shooting vs def_team's perimeter/interior D."""
    off_2p = _safe(off_ff, "off_2p")
    off_3p = _safe(off_ff, "off_3p")
    def_2p = _safe(def_ff, "def_2p")
    def_3p = _safe(def_ff, "def_3p")

    off_2p_rank = _safe(off_ff, "off_2p_rank", 182)
    off_3p_rank = _safe(off_ff, "off_3p_rank", 182)
    def_2p_rank = _safe(def_ff, "def_2p_rank", 182)
    def_3p_rank = _safe(def_ff, "def_3p_rank", 182)

    findings: list[str] = []
    edge = 0.0

    # Determine shooting profile: relies on 3 if 3P rank better than 2P rank
    relies_on_3 = off_3p_rank < off_2p_rank
    three_label = _rank_label(off_3p_rank)
    two_label = _rank_label(off_2p_rank)
    d3_label = _rank_label(def_3p_rank)
    d2_label = _rank_label(def_2p_rank)

    # 3P matchup
    three_gap = def_3p_rank - off_3p_rank  # positive = offense advantage
    if three_gap > 150:
        edge += 1.5
        findings.append(
            f"{off_team}'s {three_label} 3P shooting (#{off_3p_rank:.0f}, "
            f"{off_3p:.1f}%) exploits {def_team}'s {d3_label} 3P defense "
            f"(#{def_3p_rank:.0f}, {def_3p:.1f}%)."
        )
    elif three_gap < -150:
        edge -= 1.2
        findings.append(
            f"{off_team}'s 3P attack (#{off_3p_rank:.0f}) is neutralized by "
            f"{def_team}'s {d3_label} perimeter D (#{def_3p_rank:.0f})."
        )
        if relies_on_3:
            edge -= 0.8
            findings.append(
                f"Critical: {off_team} relies on the three and faces "
                f"an elite perimeter defense."
            )

    # 2P matchup
    two_gap = def_2p_rank - off_2p_rank
    if two_gap > 150:
        edge += 1.2
        findings.append(
            f"{off_team}'s {two_label} interior scoring (#{off_2p_rank:.0f}, "
            f"{off_2p:.1f}%) exploits {def_team}'s {d2_label} 2P defense "
            f"(#{def_2p_rank:.0f}, {def_2p:.1f}%)."
        )
    elif two_gap < -150:
        edge -= 1.0
        findings.append(
            f"{off_team}'s interior game (#{off_2p_rank:.0f}) faces stiff "
            f"{def_team} 2P defense (#{def_2p_rank:.0f})."
        )

    data = {
        "off_2p": off_2p, "off_3p": off_3p,
        "def_2p": def_2p, "def_3p": def_3p,
        "off_2p_rank": off_2p_rank, "off_3p_rank": off_3p_rank,
        "def_2p_rank": def_2p_rank, "def_3p_rank": def_3p_rank,
        "three_gap": three_gap, "two_gap": two_gap,
    }
    return edge, findings, data


def analyze(ctx: MatchupContext) -> DimensionResult:
    if ctx.away_four_factors.empty or ctx.home_four_factors.empty:
        return DimensionResult(
            name=DIMENSION_NAME,
            spread_edge=0.0,
            total_edge=0.0,
            confidence=0.0,
            narrative="Shooting zone data unavailable.",
        )

    away_edge, away_finds, away_data = _analyze_side(
        ctx.away_four_factors, ctx.home_four_factors, ctx.away_team, ctx.home_team,
    )
    home_edge, home_finds, home_data = _analyze_side(
        ctx.home_four_factors, ctx.away_four_factors, ctx.home_team, ctx.away_team,
    )

    net_edge = away_edge - home_edge  # positive = away value
    total_edge = (away_edge + home_edge) * 0.4  # both positive => high scoring

    all_finds = away_finds + home_finds
    conf = min(0.80, 0.20 + len(all_finds) * 0.12 + abs(net_edge) * 0.06)
    conf = round(max(0.10, conf), 2)

    narrative = (
        " ".join(all_finds)
        if all_finds
        else "No significant shooting zone mismatches detected."
    )

    return DimensionResult(
        name=DIMENSION_NAME,
        spread_edge=round(net_edge, 2),
        total_edge=round(total_edge, 2),
        confidence=conf,
        narrative=narrative,
        raw_data={"away": away_data, "home": home_data},
    )
