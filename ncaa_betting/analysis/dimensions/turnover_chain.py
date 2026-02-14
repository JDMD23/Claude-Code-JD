"""Turnover Chain dimension.

Analyses turnover matchups: a team's offensive turnover rate vs the
opponent's defensive turnover rate (ability to force turnovers).  Identifies
mismatches where a turnover-prone offense faces a steal-heavy defense, or a
ball-secure team faces a defence that cannot force mistakes.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..pipeline import MatchupContext, DimensionResult

DIMENSION_NAME = "turnover_chain"

ELITE = 50
STRONG = 120
AVERAGE = 220
WEAK = 300


def _safe(series: pd.Series, key: str, default: float = 0.0) -> float:
    if series.empty:
        return default
    try:
        val = float(series[key])
        return val if np.isfinite(val) else default
    except (KeyError, TypeError, ValueError):
        return default


def _tier(rank: float) -> str:
    if rank < ELITE:
        return "elite"
    if rank < STRONG:
        return "strong"
    if rank < AVERAGE:
        return "average"
    if rank < WEAK:
        return "weak"
    return "poor"


def _game_log_to_stats(logs: pd.DataFrame):
    """Compute TO% stats from game logs if available."""
    if logs.empty:
        return None
    stats: dict = {}
    if "to_pct" in logs.columns:
        stats["off_to_mean"] = float(logs["to_pct"].mean())
        stats["off_to_std"] = float(logs["to_pct"].std()) if len(logs) > 1 else 0.0
    if "opp_to_pct" in logs.columns:
        stats["def_to_mean"] = float(logs["opp_to_pct"].mean())
        stats["def_to_std"] = float(logs["opp_to_pct"].std()) if len(logs) > 1 else 0.0
    return stats if stats else None


def _analyze_matchup(off_ff: pd.Series, def_ff: pd.Series,
                     off_logs: pd.DataFrame,
                     off_team: str, def_team: str):
    """Evaluate off_team's ball security against def_team's pressure."""
    off_to = _safe(off_ff, "off_to")
    off_to_rank = _safe(off_ff, "off_to_rank", 182)
    def_to = _safe(def_ff, "def_to")
    def_to_rank = _safe(def_ff, "def_to_rank", 182)

    off_tier = _tier(off_to_rank)
    def_tier = _tier(def_to_rank)

    findings: list[str] = []
    edge = 0.0

    # Higher off_to_rank = more turnovers (bad).
    # Lower def_to_rank = forces more (good for defense).
    vulnerability = off_to_rank + (364 - def_to_rank)
    # Baseline is 364 (182 + 182). Positive mismatch = bad for offense.
    mismatch = (vulnerability - 364) / 364.0

    if mismatch > 0.25:
        edge -= 1.5 * mismatch
        findings.append(
            f"{off_team}'s {off_tier} ball security (TO% {off_to:.1f}%, "
            f"#{off_to_rank:.0f}) faces {def_team}'s {def_tier} "
            f"turnover-forcing D (TO% {def_to:.1f}%, #{def_to_rank:.0f}). "
            f"High turnover risk."
        )
    elif mismatch < -0.25:
        edge += 1.2 * abs(mismatch)
        findings.append(
            f"{off_team}'s {off_tier} ball handling (#{off_to_rank:.0f}) "
            f"should carve through {def_team}'s {def_tier} defense at forcing "
            f"TOs (#{def_to_rank:.0f})."
        )
    else:
        findings.append(
            f"{off_team} TO% {off_to:.1f}% (#{off_to_rank:.0f}) vs "
            f"{def_team} forced TO% {def_to:.1f}% (#{def_to_rank:.0f}): "
            f"neutral matchup."
        )

    # Supplement with game-log variance
    off_stats = _game_log_to_stats(off_logs)
    if off_stats and "off_to_std" in off_stats and off_stats["off_to_std"] > 4.0:
        findings.append(
            f"{off_team} has high TO% variance "
            f"(std {off_stats['off_to_std']:.1f}%), "
            f"making this matchup less predictable."
        )

    return edge, findings


def analyze(ctx: MatchupContext) -> DimensionResult:
    if ctx.away_four_factors.empty or ctx.home_four_factors.empty:
        return DimensionResult(
            name=DIMENSION_NAME,
            spread_edge=0.0,
            total_edge=0.0,
            confidence=0.0,
            narrative="Turnover data unavailable.",
        )

    # Away offense vs Home defense
    away_edge, away_finds = _analyze_matchup(
        ctx.away_four_factors, ctx.home_four_factors,
        ctx.away_game_logs,
        ctx.away_team, ctx.home_team,
    )
    # Home offense vs Away defense
    home_edge, home_finds = _analyze_matchup(
        ctx.home_four_factors, ctx.away_four_factors,
        ctx.home_game_logs,
        ctx.home_team, ctx.away_team,
    )

    # away_edge positive = away offense has advantage
    # home_edge positive = home offense has advantage
    spread_edge = away_edge - home_edge  # pos = away value

    # Turnovers reduce scoring; net pressure advantage pushes under
    total_edge = 0.0
    if away_edge < 0 or home_edge < 0:
        total_edge = -(abs(away_edge) + abs(home_edge)) * 0.3

    all_finds = away_finds + home_finds
    conf = min(0.70, 0.20 + abs(spread_edge) * 0.15 + len(all_finds) * 0.05)
    conf = round(max(0.10, conf), 2)

    return DimensionResult(
        name=DIMENSION_NAME,
        spread_edge=round(spread_edge, 2),
        total_edge=round(total_edge, 2),
        confidence=conf,
        narrative=" ".join(all_finds),
        raw_data={
            "away_off_edge": away_edge,
            "home_off_edge": home_edge,
        },
    )
