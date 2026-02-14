"""Trap Detection dimension.

Flags trap-game conditions that historically lead to upsets or non-covers.
Signals include: large favourite spreads, road favourites, teams on extended
win streaks (letdown potential), poor ATS records when heavily favoured,
and high KenPom luck ratings that suggest regression is due.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..pipeline import MatchupContext, DimensionResult

DIMENSION_NAME = "trap_detect"

# Thresholds
BIG_SPREAD = 10.0
WIN_STREAK_ALERT = 5
LUCK_THRESHOLD = 0.050
POOR_FAV_ATS = 40.0  # cover % below which we flag


def _safe_float(series: pd.Series, key: str, default: float = 0.0) -> float:
    if series.empty:
        return default
    try:
        val = float(series[key])
        return val if np.isfinite(val) else default
    except (KeyError, TypeError, ValueError):
        return default


def _win_streak(logs: pd.DataFrame) -> int:
    """Count consecutive wins from the most recent game backwards."""
    if logs.empty or "result" not in logs.columns:
        return 0
    recent = logs.sort_values("game_date", ascending=False)
    streak = 0
    for _, row in recent.iterrows():
        if str(row["result"]).upper() in ("W", "WIN"):
            streak += 1
        else:
            break
    return streak


def _fav_ats_rate(ats: pd.DataFrame) -> tuple[float, int]:
    """Return (cover_pct, n_games) when the team was favoured."""
    if ats.empty or "line" not in ats.columns or "ats_result" not in ats.columns:
        return 50.0, 0
    fav_mask = ats["line"].astype(float) < 0
    fav = ats.loc[fav_mask]
    if fav.empty:
        return 50.0, 0
    covers = fav["ats_result"].str.upper().isin(["W", "WIN", "COVER"])
    n = len(fav)
    return float(covers.sum() / n * 100) if n > 0 else 50.0, n


def _loss_streak(logs: pd.DataFrame) -> int:
    """Count consecutive losses from the most recent game backwards."""
    if logs.empty or "result" not in logs.columns:
        return 0
    recent = logs.sort_values("game_date", ascending=False)
    streak = 0
    for _, row in recent.iterrows():
        if str(row["result"]).upper() in ("L", "LOSS"):
            streak += 1
        else:
            break
    return streak


def analyze(ctx: MatchupContext) -> DimensionResult:
    spread = _safe_float(ctx.line, "spread", 0.0)
    abs_spread = abs(spread)

    # Determine favourite / underdog
    # Negative spread => home favoured
    if spread < 0:
        fav_team, fav_side = ctx.home_team, "home"
        dog_team, dog_side = ctx.away_team, "away"
        fav_ratings = ctx.home_ratings
        dog_ratings = ctx.away_ratings
        fav_logs = ctx.home_game_logs
        dog_logs = ctx.away_game_logs
        fav_ats = ctx.home_ats
        dog_ats = ctx.away_ats
    elif spread > 0:
        fav_team, fav_side = ctx.away_team, "away"
        dog_team, dog_side = ctx.home_team, "home"
        fav_ratings = ctx.away_ratings
        dog_ratings = ctx.home_ratings
        fav_logs = ctx.away_game_logs
        dog_logs = ctx.home_game_logs
        fav_ats = ctx.away_ats
        dog_ats = ctx.home_ats
    else:
        # Pick 'em -- no trap signals
        return DimensionResult(
            name=DIMENSION_NAME,
            spread_edge=0.0,
            total_edge=0.0,
            confidence=0.15,
            narrative="Pick 'em game -- no trap-game signals to evaluate.",
        )

    signals: list[str] = []
    trap_score = 0.0  # 0..1 scale

    # --- Signal 1: Large favourite ---
    if abs_spread >= BIG_SPREAD:
        trap_score += 0.15
        signals.append(
            f"Large spread ({spread:+.1f}). Big favourites fail to cover ~55% "
            f"historically."
        )

    # --- Signal 2: Road favourite ---
    if fav_side == "away":
        trap_score += 0.12
        signals.append(
            f"{fav_team} is a road favourite, a historically under-performing spot."
        )

    # --- Signal 3: Win streak (letdown) ---
    fav_streak = _win_streak(fav_logs)
    if fav_streak >= WIN_STREAK_ALERT:
        trap_score += 0.15
        signals.append(
            f"{fav_team} is on a {fav_streak}-game win streak. "
            f"Letdown risk elevated."
        )

    # --- Signal 4: Poor ATS record as favourite ---
    fav_cover_pct, fav_cover_n = _fav_ats_rate(fav_ats)
    if fav_cover_n >= 5 and fav_cover_pct < POOR_FAV_ATS:
        trap_score += 0.18
        signals.append(
            f"{fav_team} covers only {fav_cover_pct:.0f}% as a favourite "
            f"({fav_cover_n} games). Fade signal."
        )

    # --- Signal 5: High luck rating (regression candidate) ---
    fav_luck = _safe_float(fav_ratings, "luck", 0.0)
    if fav_luck > LUCK_THRESHOLD:
        trap_score += 0.15
        signals.append(
            f"{fav_team} has a luck rating of {fav_luck:.3f} -- regression "
            f"candidate."
        )

    # --- Signal 6: Dog on a loss streak (bounce-back) ---
    dog_loss_streak = _loss_streak(dog_logs)
    if dog_loss_streak >= 3:
        trap_score += 0.08
        signals.append(
            f"{dog_team} has lost {dog_loss_streak} straight. Possible "
            f"bounce-back / market over-reaction."
        )

    # --- Signal 7: Underdog has elite defence ---
    dog_d_rank = _safe_float(dog_ratings, "adj_d_rank", 182)
    if dog_d_rank <= 50 and abs_spread >= 5:
        trap_score += 0.12
        signals.append(
            f"{dog_team} has an elite defence (#{dog_d_rank:.0f}) and is "
            f"getting {abs_spread:.1f} points. Live dog."
        )

    trap_score = min(1.0, trap_score)

    # Convert trap score to a spread edge: high trap score benefits the dog
    # (positive = away value if dog is away)
    if dog_side == "away":
        spread_edge = trap_score * 2.5
    else:
        spread_edge = -trap_score * 2.5

    # Trap games tend to be lower-scoring (favourite can't run away)
    total_edge = -trap_score * 1.0 if trap_score > 0.3 else 0.0

    if not signals:
        signals.append("No significant trap-game signals detected.")

    conf = round(min(0.80, 0.15 + trap_score * 0.7), 2)

    return DimensionResult(
        name=DIMENSION_NAME,
        spread_edge=round(spread_edge, 2),
        total_edge=round(total_edge, 2),
        confidence=conf,
        narrative=" ".join(signals),
        raw_data={
            "trap_score": round(trap_score, 3),
            "fav_team": fav_team,
            "dog_team": dog_team,
            "fav_side": fav_side,
            "spread": spread,
            "fav_win_streak": fav_streak,
            "fav_ats_as_fav": fav_cover_pct,
            "fav_luck": fav_luck,
            "dog_d_rank": dog_d_rank,
        },
    )
