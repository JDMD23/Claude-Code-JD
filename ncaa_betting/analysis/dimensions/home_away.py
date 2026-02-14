"""Home / Away dimension.

Measures each team's efficiency split by venue from their game logs and
adjusts the projected edge for the actual game location.  The canonical
NCAA home-court advantage is approximately 3.5 points, but individual
teams deviate substantially from that average.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..pipeline import MatchupContext, DimensionResult

DIMENSION_NAME = "home_away"
DEFAULT_HCA = 3.5  # points


def _split_efficiency(logs: pd.DataFrame):
    """Return (home_stats, away_stats) dicts with mean adj_oe / adj_de."""
    if logs.empty or "location" not in logs.columns:
        return None, None

    home = logs[logs["location"].str.upper().isin(["H", "HOME"])]
    away = logs[logs["location"].str.upper().isin(["A", "AWAY"])]

    def _stats(df: pd.DataFrame):
        if df.empty:
            return None
        result: dict = {"games": len(df), "adj_oe": float(df["adj_oe"].mean())}
        if "adj_de" in df.columns:
            result["adj_de"] = float(df["adj_de"].mean())
        if {"team_score", "opp_score"}.issubset(df.columns):
            result["avg_margin"] = float(
                (df["team_score"] - df["opp_score"]).mean()
            )
        return result

    return _stats(home), _stats(away)


def analyze(ctx: MatchupContext) -> DimensionResult:
    away_home, away_away = _split_efficiency(ctx.away_game_logs)
    home_home, home_away = _split_efficiency(ctx.home_game_logs)

    if all(v is None for v in [away_home, away_away, home_home, home_away]):
        return DimensionResult(
            name=DIMENSION_NAME,
            spread_edge=0.0,
            total_edge=0.0,
            confidence=0.0,
            narrative="Location split data unavailable.",
        )

    parts: list[str] = []
    spread_adj = 0.0

    # ---- Away team (will be playing AWAY) ----
    if away_away is not None and away_home is not None:
        oe_drop = away_away["adj_oe"] - away_home["adj_oe"]
        parts.append(
            f"{ctx.away_team} away OE {away_away['adj_oe']:.1f} vs home OE "
            f"{away_home['adj_oe']:.1f} (diff {oe_drop:+.1f})."
        )
        if oe_drop < -2.0:
            spread_adj -= abs(oe_drop) * 0.15
            parts.append(f"{ctx.away_team} struggles on the road.")
        elif oe_drop > 2.0:
            spread_adj += oe_drop * 0.15
            parts.append(f"{ctx.away_team} is a road warrior.")
    elif away_away is not None:
        parts.append(
            f"{ctx.away_team} road OE {away_away['adj_oe']:.1f} (no home split)."
        )

    # ---- Home team (will be playing HOME) ----
    if home_home is not None and home_away is not None:
        oe_boost = home_home["adj_oe"] - home_away["adj_oe"]
        parts.append(
            f"{ctx.home_team} home OE {home_home['adj_oe']:.1f} vs away OE "
            f"{home_away['adj_oe']:.1f} (diff {oe_boost:+.1f})."
        )
        if oe_boost > 2.0:
            spread_adj -= oe_boost * 0.15
            parts.append(f"{ctx.home_team} has a strong home-court boost.")
        elif oe_boost < -2.0:
            spread_adj += abs(oe_boost) * 0.15
            parts.append(f"{ctx.home_team} is oddly worse at home.")
    elif home_home is not None:
        parts.append(
            f"{ctx.home_team} home OE {home_home['adj_oe']:.1f} (no road split)."
        )

    # Compare team-specific HCA to the canonical 3.5
    if home_home is not None and home_away is not None:
        implied_hca = (
            home_home["adj_oe"] - home_away.get("adj_oe", home_home["adj_oe"])
        ) * 0.5
        hca_diff = implied_hca - DEFAULT_HCA
        if abs(hca_diff) > 1.0:
            direction = "above" if hca_diff > 0 else "below"
            parts.append(
                f"Implied HCA for {ctx.home_team} is {direction} the "
                f"{DEFAULT_HCA}-pt standard by ~{abs(hca_diff):.1f} pts."
            )
            spread_adj -= hca_diff * 0.20  # negative = home value

    # Total edge: higher-scoring venue play nudges total
    total_edge = 0.0
    if away_away is not None and home_home is not None:
        combined_oe = away_away["adj_oe"] + home_home["adj_oe"]
        neutral = 200.0  # 100 + 100 baseline
        total_edge = (combined_oe - neutral) * 0.06

    n_games = sum(
        (s or {}).get("games", 0)
        for s in [away_home, away_away, home_home, home_away]
    )
    conf = min(0.70, 0.15 + n_games * 0.012)
    conf = round(max(0.10, conf), 2)

    return DimensionResult(
        name=DIMENSION_NAME,
        spread_edge=round(spread_adj, 2),
        total_edge=round(total_edge, 2),
        confidence=conf,
        narrative=" ".join(parts),
        raw_data={
            "away_home": away_home,
            "away_away": away_away,
            "home_home": home_home,
            "home_away": home_away,
        },
    )
