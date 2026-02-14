"""Markdown export for NCAA betting pick cards.

Generates a structured Markdown document from a list of
:class:`~ncaa_betting.output.pick_card.PickCard` objects, suitable for
sharing via GitHub, Discord, or any platform that renders Markdown.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .pick_card import PickCard

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tier display helpers
# ---------------------------------------------------------------------------

_TIER_EMOJI: dict[str, str] = {
    "LOCK":   "**LOCK**",
    "STRONG": "**STRONG**",
    "LEAN":   "LEAN",
    "SKIP":   "~~SKIP~~",
}

_TIER_SORT_ORDER: dict[str, int] = {
    "LOCK": 4,
    "STRONG": 3,
    "LEAN": 2,
    "SKIP": 1,
    "": 0,
}


def _tier_label(tier: str) -> str:
    """Return a Markdown-formatted label for the confidence tier."""
    return _TIER_EMOJI.get(tier, tier)


def _sort_key(card: "PickCard") -> tuple[int, float]:
    """Sort key: highest confidence first, then highest composite."""
    spread_rank = _TIER_SORT_ORDER.get(card.spread_confidence, 0)
    total_rank = _TIER_SORT_ORDER.get(card.total_confidence, 0)
    return (max(spread_rank, total_rank), card.max_composite)


# ---------------------------------------------------------------------------
# Single card renderer
# ---------------------------------------------------------------------------

def _card_to_markdown(card: "PickCard") -> str:
    """Convert a single :class:`PickCard` to a Markdown section.

    Parameters
    ----------
    card:
        The pick card to render.

    Returns
    -------
    str
        A Markdown-formatted string for this game.
    """
    lines: list[str] = []

    # Section header
    lines.append(f"### {card.away_team} @ {card.home_team}")
    lines.append("")

    # Headline
    if card.headline:
        lines.append(f"> {card.headline}")
        lines.append("")

    # Line and projection table
    if card.spread < 0:
        spread_str = f"{card.home_team} {card.spread}"
    elif card.spread > 0:
        spread_str = f"{card.away_team} -{card.spread}"
    else:
        spread_str = "PICK"

    lines.append("| | |")
    lines.append("|---|---|")
    lines.append(f"| **Line** | {spread_str} \\| O/U {card.total} |")
    lines.append(
        f"| **Projected** | {card.away_team} {card.projected_away_score:.0f} - "
        f"{card.home_team} {card.projected_home_score:.0f} "
        f"(Total: {card.projected_total:.1f}) |"
    )

    if card.true_spread < 0:
        true_spread_str = f"{card.home_team} {card.true_spread:.1f}"
    elif card.true_spread > 0:
        true_spread_str = f"{card.away_team} -{card.true_spread:.1f}"
    else:
        true_spread_str = "PICK"

    lines.append(
        f"| **True Line** | {true_spread_str} \\| True Total: {card.projected_total:.1f} |"
    )
    lines.append(
        f"| **Value** | Spread: {card.spread_value:+.1f} pts \\| "
        f"Total: {card.total_value:+.1f} pts |"
    )
    lines.append("")

    # Picks
    lines.append("**Picks:**")
    lines.append("")

    if card.spread_pick:
        lines.append(
            f"- **Spread:** {card.spread_pick} "
            f"[{_tier_label(card.spread_confidence)}] "
            f"(composite {card.spread_composite:.1f})"
        )
    else:
        lines.append("- **Spread:** No pick")

    if card.total_pick:
        lines.append(
            f"- **Total:** {card.total_pick} "
            f"[{_tier_label(card.total_confidence)}] "
            f"(composite {card.total_composite:.1f})"
        )
    else:
        lines.append("- **Total:** No pick")

    lines.append("")

    # Key factors
    if card.key_factors:
        lines.append("**Key Factors:**")
        lines.append("")
        for factor in card.key_factors:
            lines.append(f"- {factor}")
        lines.append("")

    # Trap warnings
    if card.trap_warnings:
        lines.append("**Trap Warnings:**")
        lines.append("")
        for warning in card.trap_warnings:
            lines.append(f"- :warning: {warning}")
        lines.append("")

    # Dimension results
    if card.dimension_results:
        lines.append("<details>")
        lines.append("<summary>Dimension Breakdowns</summary>")
        lines.append("")
        lines.append("| Dimension | Spread Edge | Total Edge | Confidence | Narrative |")
        lines.append("|-----------|------------|-----------|------------|-----------|")
        for dim in card.dimension_results:
            narrative_short = dim.narrative[:80] + ("..." if len(dim.narrative) > 80 else "")
            lines.append(
                f"| {dim.name} | {dim.spread_edge:+.2f} | {dim.total_edge:+.2f} "
                f"| {dim.confidence:.2f} | {narrative_short} |"
            )
        lines.append("")
        lines.append("</details>")
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def export_slate(cards: list["PickCard"], output_path: Path) -> Path:
    """Write a full slate of pick cards to a Markdown file.

    The output includes a summary table at the top followed by a
    detailed section for each game, sorted by confidence tier.

    Parameters
    ----------
    cards:
        Pick cards to export.
    output_path:
        Destination file path.  Parent directories will be created if
        they do not exist.

    Returns
    -------
    Path
        The path that was written to (same as *output_path*).
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    lines: list[str] = []

    if not cards:
        lines.append("# NCAA Basketball Picks")
        lines.append("")
        lines.append("No games on the slate.")
        output_path.write_text("\n".join(lines), encoding="utf-8")
        logger.info("Wrote empty slate to %s", output_path)
        return output_path

    game_date = cards[0].game_date

    # Sort by confidence
    sorted_cards = sorted(cards, key=_sort_key, reverse=True)

    # Document header
    lines.append(f"# NCAA Basketball Picks -- {game_date}")
    lines.append("")

    # Summary table
    lines.append("## Summary")
    lines.append("")
    lines.append("| Game | Spread Pick | Spread Tier | Total Pick | Total Tier | Top Value |")
    lines.append("|------|------------|------------|-----------|-----------|-----------|")

    for card in sorted_cards:
        game_label = f"{card.away_team} @ {card.home_team}"
        spread_pick = card.spread_pick if card.spread_pick else "-"
        spread_tier = _tier_label(card.spread_confidence) if card.spread_pick else "-"
        total_pick = card.total_pick if card.total_pick else "-"
        total_tier = _tier_label(card.total_confidence) if card.total_pick else "-"

        # Best value
        best_value = max(abs(card.spread_value), abs(card.total_value))
        lines.append(
            f"| {game_label} | {spread_pick} | {spread_tier} "
            f"| {total_pick} | {total_tier} | {best_value:.1f} pts |"
        )

    lines.append("")

    # Stats summary
    total_games = len(sorted_cards)
    actionable = sum(1 for c in sorted_cards if c.has_actionable_pick())
    locks = sum(1 for c in sorted_cards if c.max_confidence == "LOCK")
    strongs = sum(1 for c in sorted_cards if c.max_confidence == "STRONG")
    leans = sum(1 for c in sorted_cards if c.max_confidence == "LEAN")

    lines.append(
        f"**{total_games} games** | **{actionable} actionable** | "
        f"LOCK: {locks} | STRONG: {strongs} | LEAN: {leans}"
    )
    lines.append("")

    # Detailed cards
    lines.append("---")
    lines.append("")
    lines.append("## Detailed Analysis")
    lines.append("")

    for card in sorted_cards:
        lines.append(_card_to_markdown(card))
        lines.append("---")
        lines.append("")

    # Footer
    lines.append(f"*Generated for {game_date}*")
    lines.append("")

    content = "\n".join(lines)
    output_path.write_text(content, encoding="utf-8")
    logger.info("Wrote %d pick cards to %s", len(sorted_cards), output_path)
    return output_path
