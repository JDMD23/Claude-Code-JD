"""ATS Correlation dimension.

Identifies against-the-spread patterns from each team's ATS records.
Looks for situational edges: road dogs with elite defence, home favourites
covering poorly, and specific spread-bucket tendencies.  Also calculates
overall cover rates by location and role (favourite vs. underdog).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..pipeline import MatchupContext, DimensionResult

DIMENSION_NAME = "ats_correlation"

# Spread buckets for segmentation
BUCKETS = [
    ("pk_to_3", 0, 3.5),
    ("small_fav", 3.5, 7.5),
    ("mid_fav", 7.5, 12.5),
    ("big_fav", 12.5, 50),
]


def _cover_rate(ats: pd.DataFrame, mask: pd.Series) -> tuple[float, int]:
    """Return (cover_pct, n_games) for rows matching *mask*."""
    subset = ats.loc[mask]
    if subset.empty:
        return 0.0, 0
    if "ats_result" not in subset.columns:
        return 0.0, 0
    covers = subset["ats_result"].str.upper().isin(["W", "WIN", "COVER"])
    n = len(subset)
    return float(covers.sum() / n * 100) if n > 0 else 0.0, n


def _analyze_team_ats(ats: pd.DataFrame, team: str, role_in_game: str,
                      game_spread: float):
    """Analyse one team's ATS history and return (edge, findings, data)."""
    if ats.empty or "ats_result" not in ats.columns:
        return 0.0, [], {}

    findings: list[str] = []
    edge = 0.0
    data: dict = {}

    # --- Overall cover rate ---
    overall_pct, overall_n = _cover_rate(ats, pd.Series(True, index=ats.index))
    data["overall"] = {"pct": overall_pct, "n": overall_n}

    # --- By location ---
    if "location" in ats.columns:
        home_mask = ats["location"].str.upper().isin(["H", "HOME"])
        away_mask = ats["location"].str.upper().isin(["A", "AWAY"])
        home_pct, home_n = _cover_rate(ats, home_mask)
        away_pct, away_n = _cover_rate(ats, away_mask)
        data["home"] = {"pct": home_pct, "n": home_n}
        data["away"] = {"pct": away_pct, "n": away_n}

        # Highlight strong road cover rate for an away team
        if role_in_game == "away" and away_n >= 5 and away_pct >= 60:
            edge += 0.8
            findings.append(
                f"{team} covers {away_pct:.0f}% on the road ({away_n} games)."
            )
        elif role_in_game == "away" and away_n >= 5 and away_pct < 40:
            edge -= 0.6
            findings.append(
                f"{team} covers only {away_pct:.0f}% on the road ({away_n} games)."
            )
        if role_in_game == "home" and home_n >= 5 and home_pct >= 60:
            edge += 0.7
            findings.append(
                f"{team} covers {home_pct:.0f}% at home ({home_n} games)."
            )
        elif role_in_game == "home" and home_n >= 5 and home_pct < 40:
            edge -= 0.5
            findings.append(
                f"{team} covers only {home_pct:.0f}% at home ({home_n} games)."
            )

    # --- By role (favourite / underdog) ---
    if "line" in ats.columns:
        # Negative line = team is favoured
        fav_mask = ats["line"].astype(float) < 0
        dog_mask = ats["line"].astype(float) > 0
        fav_pct, fav_n = _cover_rate(ats, fav_mask)
        dog_pct, dog_n = _cover_rate(ats, dog_mask)
        data["as_fav"] = {"pct": fav_pct, "n": fav_n}
        data["as_dog"] = {"pct": dog_pct, "n": dog_n}

        # Team is underdog in this game and has strong dog ATS record
        is_dog = game_spread > 0 if role_in_game == "home" else game_spread < 0
        if is_dog and dog_n >= 4 and dog_pct >= 60:
            edge += 0.9
            findings.append(
                f"{team} covers {dog_pct:.0f}% as an underdog ({dog_n} games). "
                f"Live dog alert."
            )

        # Team is favourite and has poor covering record
        is_fav = not is_dog
        if is_fav and fav_n >= 4 and fav_pct < 40:
            edge -= 0.7
            findings.append(
                f"{team} covers only {fav_pct:.0f}% as a favourite ({fav_n} games). "
                f"Fade-the-chalk signal."
            )

    # --- By spread bucket closest to this game ---
    if "line" in ats.columns:
        abs_spread = abs(game_spread)
        for label, lo, hi in BUCKETS:
            bucket_mask = ats["line"].astype(float).abs().between(lo, hi)
            bkt_pct, bkt_n = _cover_rate(ats, bucket_mask)
            data[f"bucket_{label}"] = {"pct": bkt_pct, "n": bkt_n}
            if lo <= abs_spread < hi and bkt_n >= 3:
                if bkt_pct >= 65:
                    edge += 0.5
                    findings.append(
                        f"{team} covers {bkt_pct:.0f}% in the {label} bucket "
                        f"({bkt_n} games)."
                    )
                elif bkt_pct < 35:
                    edge -= 0.5
                    findings.append(
                        f"{team} covers only {bkt_pct:.0f}% in the {label} bucket "
                        f"({bkt_n} games)."
                    )

    if not findings:
        findings.append(
            f"{team} ATS record: {overall_pct:.0f}% overall ({overall_n} games). "
            f"No notable situational patterns."
        )

    return edge, findings, data


def analyze(ctx: MatchupContext) -> DimensionResult:
    if ctx.away_ats.empty and ctx.home_ats.empty:
        return DimensionResult(
            name=DIMENSION_NAME,
            spread_edge=0.0,
            total_edge=0.0,
            confidence=0.0,
            narrative="ATS data unavailable for both teams.",
        )

    spread = 0.0
    if not ctx.line.empty:
        try:
            spread = float(ctx.line["spread"])
        except (KeyError, TypeError, ValueError):
            pass

    away_edge, away_finds, away_data = _analyze_team_ats(
        ctx.away_ats, ctx.away_team, "away", spread,
    )
    home_edge, home_finds, home_data = _analyze_team_ats(
        ctx.home_ats, ctx.home_team, "home", spread,
    )

    # away_edge positive = away covers well; home_edge positive = home covers well
    spread_edge = away_edge - home_edge  # pos = away value

    all_finds = away_finds + home_finds
    n_games = (
        away_data.get("overall", {}).get("n", 0)
        + home_data.get("overall", {}).get("n", 0)
    )
    conf = min(0.75, 0.10 + n_games * 0.01 + len(all_finds) * 0.06)
    conf = round(max(0.10, conf), 2)

    return DimensionResult(
        name=DIMENSION_NAME,
        spread_edge=round(spread_edge, 2),
        total_edge=0.0,  # ATS dimension is spread-only
        confidence=conf,
        narrative=" ".join(all_finds),
        raw_data={"away": away_data, "home": home_data},
    )
