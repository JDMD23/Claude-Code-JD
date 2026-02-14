"""Free Throw Rate dimension.

Evaluates free-throw-rate matchups: a team's ability to get to the foul line
(off_ft_rate) against the opponent's tendency to allow free throws
(def_ft_rate).  Foul-drawing teams facing foul-prone defences gain extra
possessions and free points; this also tilts totals upward.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..pipeline import MatchupContext, DimensionResult

DIMENSION_NAME = "ft_rate"

ELITE = 50
STRONG = 130
WEAK = 260


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
    if rank < WEAK:
        return "average"
    return "weak"


def _estimate_ft_pct(logs: pd.DataFrame):
    """Return FT% from game logs if an explicit column exists."""
    if logs.empty:
        return None
    if "ft_pct" in logs.columns:
        vals = logs["ft_pct"].dropna()
        return float(vals.mean()) if len(vals) > 0 else None
    return None


def _analyze_side(off_ff: pd.Series, def_ff: pd.Series,
                  off_logs: pd.DataFrame,
                  off_team: str, def_team: str):
    """Evaluate off_team's foul-drawing vs def_team's foul prevention."""
    off_ftr = _safe(off_ff, "off_ft_rate")
    off_ftr_rank = _safe(off_ff, "off_ft_rate_rank", 182)
    def_ftr = _safe(def_ff, "def_ft_rate")
    def_ftr_rank = _safe(def_ff, "def_ft_rate_rank", 182)

    off_t = _tier(off_ftr_rank)
    def_t = _tier(def_ftr_rank)

    findings: list[str] = []
    edge = 0.0

    gap = def_ftr_rank - off_ftr_rank  # positive = offense advantage

    if gap > 150:
        edge += 1.3
        findings.append(
            f"{off_team}'s {off_t} foul-drawing ({off_ftr:.1f}%, "
            f"#{off_ftr_rank:.0f}) exploits {def_team}'s {def_t} foul "
            f"prevention ({def_ftr:.1f}%, #{def_ftr_rank:.0f})."
        )
    elif gap > 80:
        edge += 0.6
        findings.append(
            f"{off_team} has a moderate FT-rate advantage over {def_team} "
            f"(gap {gap:.0f} ranks)."
        )
    elif gap < -150:
        edge -= 1.0
        findings.append(
            f"{off_team}'s foul-drawing ability (#{off_ftr_rank:.0f}) is "
            f"negated by {def_team}'s {def_t} foul discipline "
            f"(#{def_ftr_rank:.0f})."
        )
    else:
        findings.append(
            f"FT rate matchup roughly even: {off_team} #{off_ftr_rank:.0f} "
            f"vs {def_team} #{def_ftr_rank:.0f}."
        )

    # Bonus/penalty for FT shooting accuracy if available
    ft_pct = _estimate_ft_pct(off_logs)
    if ft_pct is not None and ft_pct > 75.0 and gap > 80:
        edge += 0.4
        findings.append(
            f"{off_team} also shoots {ft_pct:.1f}% from the line, "
            f"amplifying the FT edge."
        )
    elif ft_pct is not None and ft_pct < 65.0 and gap > 80:
        edge -= 0.3
        findings.append(
            f"However, {off_team} shoots only {ft_pct:.1f}% from the line, "
            f"partially negating the advantage."
        )

    data = {
        "off_ftr": off_ftr,
        "def_ftr": def_ftr,
        "gap": gap,
        "ft_pct": ft_pct,
    }
    return edge, findings, data


def analyze(ctx: MatchupContext) -> DimensionResult:
    if ctx.away_four_factors.empty or ctx.home_four_factors.empty:
        return DimensionResult(
            name=DIMENSION_NAME,
            spread_edge=0.0,
            total_edge=0.0,
            confidence=0.0,
            narrative="Free throw rate data unavailable.",
        )

    away_edge, away_finds, away_data = _analyze_side(
        ctx.away_four_factors, ctx.home_four_factors,
        ctx.away_game_logs,
        ctx.away_team, ctx.home_team,
    )
    home_edge, home_finds, home_data = _analyze_side(
        ctx.home_four_factors, ctx.away_four_factors,
        ctx.home_game_logs,
        ctx.home_team, ctx.away_team,
    )

    spread_edge = away_edge - home_edge  # pos = away value

    # FT-heavy games tend to run longer and score more
    total_edge = (away_edge + home_edge) * 0.35

    all_finds = away_finds + home_finds
    conf = min(0.65, 0.20 + abs(spread_edge) * 0.10 + len(all_finds) * 0.05)
    conf = round(max(0.10, conf), 2)

    return DimensionResult(
        name=DIMENSION_NAME,
        spread_edge=round(spread_edge, 2),
        total_edge=round(total_edge, 2),
        confidence=conf,
        narrative=" ".join(all_finds),
        raw_data={"away": away_data, "home": home_data},
    )
