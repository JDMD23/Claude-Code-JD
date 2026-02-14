"""PickCard dataclass -- the core output artifact for matchup analysis.

A PickCard encapsulates every piece of information about a single game's
analysis: projected scores, spread/total picks, confidence tiers, value
edges, dimension breakdowns, and narrative summaries.  One PickCard is
produced per matchup and consumed by the terminal display, markdown
exporter, and pick-history persistence layer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class PickCard:
    """Complete analysis output for a single matchup.

    Attributes
    ----------
    away_team, home_team : str
        Canonical team names.
    game_date : str
        Game date in ``YYYY-MM-DD`` format.
    spread : float
        Vegas spread (negative means the home team is favored).
    total : float
        Vegas over/under total.
    projected_away_score, projected_home_score : float
        Model-projected final scores for each side.
    projected_total : float
        Sum of projected scores.
    true_spread : float
        Model's predicted spread (away_score - home_score; negative means
        the model also favors the home team).
    spread_pick : str
        Team name on the spread side, or ``""`` when no pick is made.
    spread_confidence : str
        Human-readable confidence tier from
        :class:`~ncaa_betting.analysis.scoring.ConfidenceTier`
        (``LOCK``, ``STRONG``, ``LEAN``, or ``SKIP``).
    spread_composite : float
        Composite score (0-10) for the spread pick.
    spread_value : float
        Points of value: ``true_spread - vegas_spread``.  Positive means
        the model sees value on the side it picked.
    total_pick : str
        ``"OVER"``, ``"UNDER"``, or ``""`` when no pick is made.
    total_confidence : str
        Confidence tier for the total pick.
    total_composite : float
        Composite score (0-10) for the total pick.
    total_value : float
        Points of value: ``projected_total - vegas_total``.  Positive
        indicates over value; negative indicates under value.
    dimension_results : list
        List of :class:`~ncaa_betting.analysis.pipeline.DimensionResult`
        objects showing the breakdown by analytical dimension.
    headline : str
        One-line narrative headline for the pick card.
    key_factors : list[str]
        Top reasons driving the pick (typically 3-5 bullet points).
    trap_warnings : list[str]
        Cautionary notes about potential traps or counter-arguments.
    """

    # Game identification
    away_team: str
    home_team: str
    game_date: str

    # Line info
    spread: float           # negative = home favored
    total: float

    # Projected scores
    projected_away_score: float
    projected_home_score: float
    projected_total: float
    true_spread: float      # model's predicted spread

    # Spread pick
    spread_pick: str        # team name or ""
    spread_confidence: str  # LOCK / STRONG / LEAN / SKIP
    spread_composite: float
    spread_value: float     # true_spread - vegas_spread = points of value

    # Total pick
    total_pick: str         # "OVER" / "UNDER" / ""
    total_confidence: str
    total_composite: float
    total_value: float      # projected_total - vegas_total

    # Dimension breakdowns
    dimension_results: list = field(default_factory=list)

    # Narratives
    headline: str = ""
    key_factors: list = field(default_factory=list)
    trap_warnings: list = field(default_factory=list)

    # ------------------------------------------------------------------
    # Derived helpers
    # ------------------------------------------------------------------

    @property
    def max_confidence(self) -> str:
        """Return the highest confidence tier between spread and total picks.

        Ordering: LOCK > STRONG > LEAN > SKIP.
        """
        _ORDER = {"LOCK": 4, "STRONG": 3, "LEAN": 2, "SKIP": 1, "": 0}
        spread_rank = _ORDER.get(self.spread_confidence, 0)
        total_rank = _ORDER.get(self.total_confidence, 0)
        if spread_rank >= total_rank:
            return self.spread_confidence
        return self.total_confidence

    @property
    def max_composite(self) -> float:
        """Return the higher composite score between spread and total."""
        return max(self.spread_composite, self.total_composite)

    @property
    def favored_team(self) -> str:
        """Return the name of the team favored by the Vegas spread."""
        if self.spread < 0:
            return self.home_team
        elif self.spread > 0:
            return self.away_team
        return ""

    @property
    def spread_display(self) -> str:
        """Return a human-friendly spread string like ``'Duke -3.5'``."""
        if self.spread == 0:
            return "PICK"
        if self.spread < 0:
            return f"{self.home_team} {self.spread}"
        return f"{self.away_team} -{self.spread}"

    def has_actionable_pick(self) -> bool:
        """Return *True* if at least one pick is not SKIP."""
        return (
            self.spread_confidence not in ("SKIP", "")
            or self.total_confidence not in ("SKIP", "")
        )

    def __str__(self) -> str:
        parts = [
            f"{self.away_team} @ {self.home_team}  ({self.game_date})",
            f"  Line: {self.spread_display} | O/U {self.total}",
        ]
        if self.spread_pick:
            parts.append(
                f"  Spread: {self.spread_pick} [{self.spread_confidence}] "
                f"(composite {self.spread_composite:.1f}, value {self.spread_value:+.1f})"
            )
        if self.total_pick:
            parts.append(
                f"  Total: {self.total_pick} [{self.total_confidence}] "
                f"(composite {self.total_composite:.1f}, value {self.total_value:+.1f})"
            )
        return "\n".join(parts)
