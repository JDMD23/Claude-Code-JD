"""Rich terminal display for NCAA betting pick cards and backtest summaries.

Uses ``colorama`` for cross-platform ANSI colour output and ``tabulate``
for neatly aligned tables.  All output goes to stdout via :func:`print`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from colorama import Fore, Style, init as colorama_init
from tabulate import tabulate

if TYPE_CHECKING:
    from .pick_card import PickCard

# Initialise colorama once at import time (autoreset so every print
# statement starts from a clean style).
colorama_init(autoreset=True)

# ---------------------------------------------------------------------------
# Colour mapping for confidence tiers
# ---------------------------------------------------------------------------

_TIER_COLOURS: dict[str, str] = {
    "LOCK":   Fore.LIGHTGREEN_EX,
    "STRONG": Fore.GREEN,
    "LEAN":   Fore.YELLOW,
    "SKIP":   Fore.RED,
}

_TIER_SORT_ORDER: dict[str, int] = {
    "LOCK": 4,
    "STRONG": 3,
    "LEAN": 2,
    "SKIP": 1,
    "": 0,
}


def _coloured_tier(tier: str) -> str:
    """Return *tier* wrapped in the appropriate ANSI colour escape."""
    colour = _TIER_COLOURS.get(tier, "")
    return f"{colour}{tier}{Style.RESET_ALL}"


def _sort_key(card: "PickCard") -> int:
    """Return a sort key so the highest-confidence cards appear first."""
    spread_rank = _TIER_SORT_ORDER.get(card.spread_confidence, 0)
    total_rank = _TIER_SORT_ORDER.get(card.total_confidence, 0)
    return max(spread_rank, total_rank)


# ---------------------------------------------------------------------------
# Internal card renderer
# ---------------------------------------------------------------------------

def _print_card(card: "PickCard", verbose: bool = False) -> None:
    """Print a single pick card to stdout."""

    # Game header
    print(
        f"{Style.BRIGHT}{Fore.CYAN}"
        f"{card.away_team} @ {card.home_team}"
        f"{Style.RESET_ALL}"
        f"     {card.game_date}"
    )

    # Vegas line
    if card.spread < 0:
        spread_str = f"{card.home_team} {card.spread}"
    elif card.spread > 0:
        spread_str = f"{card.away_team} -{card.spread}"
    else:
        spread_str = "PICK"
    print(f"  Line: {spread_str} | O/U {card.total}")

    # Projected scores
    print(
        f"  Projected: {card.away_team} {card.projected_away_score:.0f} - "
        f"{card.home_team} {card.projected_home_score:.0f} "
        f"(Total: {card.projected_total:.1f})"
    )

    # True line
    if card.true_spread < 0:
        true_spread_str = f"{card.home_team} {card.true_spread:.1f}"
    elif card.true_spread > 0:
        true_spread_str = f"{card.away_team} -{card.true_spread:.1f}"
    else:
        true_spread_str = "PICK"
    print(
        f"  True Line: {true_spread_str} | "
        f"True Total: {card.projected_total:.1f}"
    )

    # Value
    print(
        f"  Spread Value: {card.spread_value:+.1f} pts | "
        f"Total Value: {card.total_value:+.1f} pts"
    )

    # Spread pick
    if card.spread_pick:
        tier_str = _coloured_tier(card.spread_confidence)
        print(
            f"  {Style.BRIGHT}SPREAD:{Style.RESET_ALL} "
            f"{card.spread_pick} [{tier_str}] "
            f"(composite {card.spread_composite:.1f})"
        )
    else:
        print(f"  {Style.BRIGHT}SPREAD:{Style.RESET_ALL} No pick")

    # Total pick
    if card.total_pick:
        tier_str = _coloured_tier(card.total_confidence)
        print(
            f"  {Style.BRIGHT}TOTAL:{Style.RESET_ALL}  "
            f"{card.total_pick} [{tier_str}] "
            f"(composite {card.total_composite:.1f})"
        )
    else:
        print(f"  {Style.BRIGHT}TOTAL:{Style.RESET_ALL}  No pick")

    # Key factors (top 3)
    if card.key_factors:
        print(f"  {Style.BRIGHT}Key Factors:{Style.RESET_ALL}")
        for factor in card.key_factors[:3]:
            print(f"    - {factor}")

    # Trap warnings
    if card.trap_warnings:
        print(f"  {Fore.LIGHTYELLOW_EX}{Style.BRIGHT}Trap Warnings:{Style.RESET_ALL}")
        for warning in card.trap_warnings:
            print(f"    {Fore.LIGHTYELLOW_EX}! {warning}{Style.RESET_ALL}")

    # Verbose: dimension breakdowns
    if verbose and card.dimension_results:
        print(f"  {Style.BRIGHT}Dimension Breakdowns:{Style.RESET_ALL}")
        dim_rows = []
        for dim in card.dimension_results:
            dim_rows.append([
                dim.name,
                f"{dim.spread_edge:+.2f}",
                f"{dim.total_edge:+.2f}",
                f"{dim.confidence:.2f}",
                dim.narrative[:60] + ("..." if len(dim.narrative) > 60 else ""),
            ])
        dim_table = tabulate(
            dim_rows,
            headers=["Dimension", "Spread Edge", "Total Edge", "Conf", "Narrative"],
            tablefmt="simple",
            stralign="left",
            numalign="right",
        )
        for line in dim_table.splitlines():
            print(f"    {line}")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def display_slate(cards: list["PickCard"], verbose: bool = False) -> None:
    """Print a full slate of pick cards to the terminal.

    Cards are sorted by their maximum confidence tier (LOCK first, SKIP
    last).  Within the same tier, cards with a higher composite score
    appear first.

    Parameters
    ----------
    cards:
        Pick cards to display.
    verbose:
        When *True*, include full dimension-level breakdowns and
        narratives for every card.
    """
    if not cards:
        print(f"{Fore.YELLOW}No games on the slate.{Style.RESET_ALL}")
        return

    # Determine the date from the first card for the header.
    game_date = cards[0].game_date

    # Sort: highest confidence first, then by composite score descending.
    sorted_cards = sorted(
        cards,
        key=lambda c: (_sort_key(c), c.max_composite),
        reverse=True,
    )

    # Header
    separator = "=" * 70
    print()
    print(f"{Style.BRIGHT}{Fore.WHITE}{separator}{Style.RESET_ALL}")
    print(
        f"{Style.BRIGHT}{Fore.WHITE}"
        f"  NCAA BASKETBALL PICKS  --  {game_date}"
        f"{Style.RESET_ALL}"
    )
    print(f"{Style.BRIGHT}{Fore.WHITE}{separator}{Style.RESET_ALL}")
    print()

    # Summary counts
    actionable = sum(1 for c in sorted_cards if c.has_actionable_pick())
    locks = sum(1 for c in sorted_cards if c.max_confidence == "LOCK")
    strongs = sum(1 for c in sorted_cards if c.max_confidence == "STRONG")
    leans = sum(1 for c in sorted_cards if c.max_confidence == "LEAN")

    summary_parts = [f"{len(sorted_cards)} games"]
    if actionable:
        summary_parts.append(f"{actionable} actionable")
    if locks:
        summary_parts.append(f"{_coloured_tier('LOCK')}: {locks}")
    if strongs:
        summary_parts.append(f"{_coloured_tier('STRONG')}: {strongs}")
    if leans:
        summary_parts.append(f"{_coloured_tier('LEAN')}: {leans}")
    print("  " + " | ".join(summary_parts))
    print()

    # Individual cards
    for i, card in enumerate(sorted_cards):
        _print_card(card, verbose=verbose)
        if i < len(sorted_cards) - 1:
            print(f"  {'-' * 60}")
        print()

    print(f"{Style.BRIGHT}{Fore.WHITE}{separator}{Style.RESET_ALL}")
    print()


def display_backtest_summary(result) -> None:
    """Print a backtest summary to the terminal.

    Parameters
    ----------
    result:
        A :class:`~ncaa_betting.analysis.backtest.BacktestResult` instance.
    """
    separator = "=" * 70

    print()
    print(f"{Style.BRIGHT}{Fore.WHITE}{separator}{Style.RESET_ALL}")
    print(
        f"{Style.BRIGHT}{Fore.WHITE}"
        f"  BACKTEST RESULTS  --  {result.total_picks} total picks"
        f"{Style.RESET_ALL}"
    )
    print(f"{Style.BRIGHT}{Fore.WHITE}{separator}{Style.RESET_ALL}")
    print()

    # Record by tier
    record_rows = []
    tier_order = ["LOCK", "STRONG", "LEAN", "SKIP"]
    for tier in tier_order:
        rec = result.record.get(tier, {})
        wins = rec.get("W", 0)
        losses = rec.get("L", 0)
        pushes = rec.get("P", 0)
        total = wins + losses + pushes
        if total == 0:
            continue
        accuracy = result.accuracy_by_tier.get(tier, 0.0)
        roi = result.roi_by_tier.get(tier, 0.0)
        colour = _TIER_COLOURS.get(tier, "")
        record_rows.append([
            f"{colour}{tier}{Style.RESET_ALL}",
            f"{wins}-{losses}-{pushes}",
            f"{accuracy:.1%}",
            f"{roi:+.1%}",
        ])

    if record_rows:
        print(f"  {Style.BRIGHT}Performance by Tier:{Style.RESET_ALL}")
        table = tabulate(
            record_rows,
            headers=["Tier", "Record (W-L-P)", "Accuracy", "ROI"],
            tablefmt="simple",
            stralign="left",
            numalign="right",
        )
        for line in table.splitlines():
            print(f"    {line}")
        print()

    # Overall
    overall_colour = Fore.GREEN if result.overall_roi >= 0 else Fore.RED
    print(
        f"  {Style.BRIGHT}Overall ROI:{Style.RESET_ALL} "
        f"{overall_colour}{result.overall_roi:+.1%}{Style.RESET_ALL}"
    )
    print()

    # Calibration data
    if result.calibration_data is not None and not result.calibration_data.empty:
        print(f"  {Style.BRIGHT}Calibration:{Style.RESET_ALL}")
        cal_rows = []
        for _, row in result.calibration_data.iterrows():
            cal_rows.append([
                row.get("bin", ""),
                f"{row.get('predicted', 0):.1%}",
                f"{row.get('actual', 0):.1%}",
                int(row.get("count", 0)),
            ])
        cal_table = tabulate(
            cal_rows,
            headers=["Bin", "Predicted", "Actual", "Count"],
            tablefmt="simple",
            stralign="left",
            numalign="right",
        )
        for line in cal_table.splitlines():
            print(f"    {line}")
        print()

    print(f"{Style.BRIGHT}{Fore.WHITE}{separator}{Style.RESET_ALL}")
    print()
