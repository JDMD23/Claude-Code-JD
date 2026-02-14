"""Command-line interface for the NCAA basketball betting analysis tool.

Provides four subcommands:

- ``load``    -- Parse and load data files into the SQLite database.
- ``analyze`` -- Run matchup analysis and display pick cards.
- ``backtest``-- Evaluate historical pick performance.
- ``result``  -- Record the outcome of a previously made pick.

Usage
-----
::

    python -m ncaa_betting load --kenpom ratings.txt --season 2025
    python -m ncaa_betting analyze --date 2025-03-01 --verbose
    python -m ncaa_betting backtest --season 2025
    python -m ncaa_betting result --date 2025-03-01 --away Duke --home UNC --type spread --result W
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Season helper
# ---------------------------------------------------------------------------

def _current_season() -> int:
    """Return the current NCAA season year.

    The NCAA basketball season straddles two calendar years.  If we are
    between August and December, the season year is ``current_year + 1``.
    Otherwise it is ``current_year``.
    """
    today = date.today()
    if today.month >= 8:
        return today.year + 1
    return today.year


# ---------------------------------------------------------------------------
# Subcommand handlers
# ---------------------------------------------------------------------------

def _handle_load(args: argparse.Namespace) -> None:
    """Parse data files and load them into the database."""
    from .db.connection import get_connection, initialize_db
    from .db.loader import upsert_dataframe

    season = args.season or _current_season()
    db_path = args.db

    # Ensure the database exists.
    initialize_db(db_path)

    with get_connection(db_path) as conn:
        loaded_any = False

        # ---- KenPom ratings ----
        if args.kenpom:
            from .parsers.kenpom import parse_kenpom_ratings

            path = Path(args.kenpom)
            if not path.is_file():
                print(f"Error: KenPom ratings file not found: {path}", file=sys.stderr)
                sys.exit(1)
            raw = path.read_text(encoding="utf-8")
            df = parse_kenpom_ratings(raw, season)
            rows = upsert_dataframe(conn, df, "kenpom_ratings")
            print(f"Loaded {rows} KenPom ratings rows for season {season}.")
            loaded_any = True

        # ---- KenPom four factors ----
        if args.four_factors:
            from .parsers.kenpom import parse_kenpom_four_factors

            path = Path(args.four_factors)
            if not path.is_file():
                print(f"Error: Four factors file not found: {path}", file=sys.stderr)
                sys.exit(1)
            raw = path.read_text(encoding="utf-8")
            df = parse_kenpom_four_factors(raw, season)
            rows = upsert_dataframe(conn, df, "kenpom_four_factors")
            print(f"Loaded {rows} KenPom four-factors rows for season {season}.")
            loaded_any = True

        # ---- KenPom game log ----
        if args.game_log:
            from .parsers.kenpom import parse_kenpom_game_log

            if not args.game_log_team:
                print(
                    "Error: --game-log-team is required when loading a game log.",
                    file=sys.stderr,
                )
                sys.exit(1)
            path = Path(args.game_log)
            if not path.is_file():
                print(f"Error: Game log file not found: {path}", file=sys.stderr)
                sys.exit(1)
            raw = path.read_text(encoding="utf-8")
            df = parse_kenpom_game_log(raw, args.game_log_team, season)
            rows = upsert_dataframe(conn, df, "game_logs")
            print(
                f"Loaded {rows} game log rows for "
                f"{args.game_log_team} (season {season})."
            )
            loaded_any = True

        # ---- ATS records ----
        if args.ats:
            if not args.ats_team:
                print(
                    "Error: --ats-team is required when loading ATS data.",
                    file=sys.stderr,
                )
                sys.exit(1)
            path = Path(args.ats)
            if not path.is_file():
                print(f"Error: ATS file not found: {path}", file=sys.stderr)
                sys.exit(1)
            raw = path.read_text(encoding="utf-8")
            # ATS parser -- import dynamically; if not yet implemented,
            # give the user a clear message.
            from .parsers.ats import parse_ats_data
            df = parse_ats_data(raw, args.ats_team, season)
            rows = upsert_dataframe(conn, df, "ats_records")
            print(
                f"Loaded {rows} ATS rows for "
                f"{args.ats_team} (season {season})."
            )
            loaded_any = True

        # ---- O/U records ----
        if args.ou:
            if not args.ou_team:
                print(
                    "Error: --ou-team is required when loading O/U data.",
                    file=sys.stderr,
                )
                sys.exit(1)
            path = Path(args.ou)
            if not path.is_file():
                print(f"Error: O/U file not found: {path}", file=sys.stderr)
                sys.exit(1)
            raw = path.read_text(encoding="utf-8")
            from .parsers.over_under import parse_ou_data
            df = parse_ou_data(raw, args.ou_team, season)
            rows = upsert_dataframe(conn, df, "ou_records")
            print(
                f"Loaded {rows} O/U rows for "
                f"{args.ou_team} (season {season})."
            )
            loaded_any = True

        # ---- Vegas lines ----
        if args.vegas:
            path = Path(args.vegas)
            if not path.is_file():
                print(f"Error: Vegas lines file not found: {path}", file=sys.stderr)
                sys.exit(1)
            raw = path.read_text(encoding="utf-8")
            from .parsers.vegas import parse_vegas_lines
            df = parse_vegas_lines(raw, season)
            rows = upsert_dataframe(conn, df, "vegas_lines")
            print(f"Loaded {rows} Vegas line rows for season {season}.")
            loaded_any = True

        if not loaded_any:
            print(
                "No data files specified. Use --kenpom, --four-factors, "
                "--game-log, --ats, --ou, or --vegas.",
                file=sys.stderr,
            )
            sys.exit(1)

    print("Done.")


def _handle_analyze(args: argparse.Namespace) -> None:
    """Run matchup analysis and display pick cards."""
    from .analysis.pipeline import AnalysisPipeline
    from .db.connection import get_connection, initialize_db
    from .output.pick_card import PickCard
    from .output.terminal import display_slate

    season = args.season or _current_season()
    game_date = args.date or date.today().isoformat()
    db_path = args.db

    initialize_db(db_path)

    with get_connection(db_path) as conn:
        pipeline = AnalysisPipeline(conn)

        if args.matchup:
            away_team, home_team = args.matchup
            ctx = pipeline.build_context(away_team, home_team, game_date, season)
            card = pipeline.analyze_matchup(ctx)
            cards = [card]
        else:
            cards = pipeline.analyze_slate(game_date, season)
            if not cards:
                print(
                    f"No games found for {game_date}. "
                    f"Load Vegas lines first with: ncaa_betting load --vegas FILE",
                    file=sys.stderr,
                )
                sys.exit(1)

        display_slate(cards, verbose=args.verbose)

        if args.export:
            from .output.markdown import export_slate

            export_path = Path(args.export)
            written = export_slate(cards, export_path)
            print(f"Exported picks to {written}")


def _analyze_matchup(
    conn,
    away_team: str,
    home_team: str,
    game_date: str,
    season: int,
    spread: float,
    total_line: float,
    matchup_data: dict,
) -> "PickCard":
    """Run the analysis pipeline on a single matchup and return a PickCard.

    This is a bridge function that invokes whatever dimension-analysis
    and scoring logic is available, falling back to a basic
    KenPom-projection stub when the full pipeline is not yet wired up.
    """
    from .analysis.scoring import assign_tier, compute_spread_composite, compute_total_composite
    from .output.pick_card import PickCard

    # Extract ratings for projection
    away_ratings = matchup_data.get("away_ratings")
    home_ratings = matchup_data.get("home_ratings")

    # Basic KenPom score projection
    projected_away_score = 0.0
    projected_home_score = 0.0
    dimension_results = []

    if (
        away_ratings is not None and not away_ratings.empty
        and home_ratings is not None and not home_ratings.empty
    ):
        ar = away_ratings.iloc[0]
        hr = home_ratings.iloc[0]

        # Simple KenPom projection:
        #   Score = AdjT * (AdjO * AdjD / D1_avg) / 100
        # Using ~100 possessions at D1 average tempo, simplified:
        avg_tempo = (float(ar.get("adj_t", 68) or 68) + float(hr.get("adj_t", 68) or 68)) / 2
        d1_avg_eff = 100.0  # approximate D1 average efficiency

        away_off = float(ar.get("adj_o", d1_avg_eff) or d1_avg_eff)
        away_def = float(ar.get("adj_d", d1_avg_eff) or d1_avg_eff)
        home_off = float(hr.get("adj_o", d1_avg_eff) or d1_avg_eff)
        home_def = float(hr.get("adj_d", d1_avg_eff) or d1_avg_eff)

        # Away team scores against home defense
        projected_away_score = avg_tempo * (away_off * home_def / d1_avg_eff) / 100
        # Home team scores against away defense, with ~3.5 pt HCA
        projected_home_score = avg_tempo * (home_off * away_def / d1_avg_eff) / 100 + 3.5

    projected_total = projected_away_score + projected_home_score
    true_spread = projected_away_score - projected_home_score

    # Value calculations
    spread_value = abs(true_spread - spread)
    total_value = projected_total - total_line

    # Try to run dimension analysis if available
    try:
        from .analysis.pipeline import DimensionResult, MatchupContext

        context = MatchupContext(
            away_team=away_team,
            home_team=home_team,
            game_date=game_date,
            season=season,
            away_ratings=away_ratings.iloc[0] if (away_ratings is not None and not away_ratings.empty) else None,
            home_ratings=home_ratings.iloc[0] if (home_ratings is not None and not home_ratings.empty) else None,
            away_four_factors=matchup_data.get("away_four_factors", None),
            home_four_factors=matchup_data.get("home_four_factors", None),
            away_game_logs=matchup_data.get("away_game_logs"),
            home_game_logs=matchup_data.get("home_game_logs"),
            away_ats=matchup_data.get("away_ats"),
            home_ats=matchup_data.get("home_ats"),
            away_ou=matchup_data.get("away_ou"),
            home_ou=matchup_data.get("home_ou"),
            line=matchup_data.get("vegas", None),
        )
        # If four factors are DataFrames, convert first row to Series
        if hasattr(context.away_four_factors, "iloc") and not context.away_four_factors.empty:
            context.away_four_factors = context.away_four_factors.iloc[0]
        if hasattr(context.home_four_factors, "iloc") and not context.home_four_factors.empty:
            context.home_four_factors = context.home_four_factors.iloc[0]
    except Exception:
        logger.debug("Full pipeline context not available; using basic projection.")

    # Compute composites from dimension results (if any)
    default_weights = {"kenpom": 1.0}
    spread_composite = compute_spread_composite(dimension_results, default_weights)
    total_composite = compute_total_composite(dimension_results, default_weights)

    # If we have no dimension results, derive composite from value magnitude
    if not dimension_results:
        spread_composite = min(abs(spread_value) * 1.5, 10.0)
        total_composite = min(abs(total_value) * 1.0, 10.0)

    spread_tier = str(assign_tier(spread_composite))
    total_tier = str(assign_tier(total_composite))

    # Determine pick sides
    if true_spread < spread:
        # Model says home team is better than Vegas says
        spread_pick_side = home_team
    elif true_spread > spread:
        spread_pick_side = away_team
    else:
        spread_pick_side = ""

    if projected_total > total_line:
        total_pick_side = "OVER"
    elif projected_total < total_line:
        total_pick_side = "UNDER"
    else:
        total_pick_side = ""

    # Skip logic: no pick if SKIP tier
    if spread_tier == "SKIP":
        spread_pick_side = ""
    if total_tier == "SKIP":
        total_pick_side = ""

    # Build key factors
    key_factors = []
    if away_ratings is not None and not away_ratings.empty and home_ratings is not None and not home_ratings.empty:
        ar = away_ratings.iloc[0]
        hr = home_ratings.iloc[0]
        away_rank = ar.get("rank_overall", "?")
        home_rank = hr.get("rank_overall", "?")
        key_factors.append(
            f"KenPom: {away_team} #{away_rank} vs {home_team} #{home_rank}"
        )
        away_em = ar.get("adj_em", 0)
        home_em = hr.get("adj_em", 0)
        if away_em and home_em:
            key_factors.append(
                f"Efficiency margin: {away_team} {float(away_em):+.1f} vs "
                f"{home_team} {float(home_em):+.1f}"
            )
    if abs(spread_value) >= 2.0:
        key_factors.append(f"Significant spread value: {spread_value:+.1f} points")
    if abs(total_value) >= 5.0:
        key_factors.append(f"Significant total value: {total_value:+.1f} points")

    # Trap warnings
    trap_warnings = []
    if away_ratings is not None and not away_ratings.empty:
        luck = away_ratings.iloc[0].get("luck", 0)
        if luck and abs(float(luck)) > 0.05:
            trap_warnings.append(
                f"{away_team} luck factor: {float(luck):+.3f} (regression risk)"
            )
    if home_ratings is not None and not home_ratings.empty:
        luck = home_ratings.iloc[0].get("luck", 0)
        if luck and abs(float(luck)) > 0.05:
            trap_warnings.append(
                f"{home_team} luck factor: {float(luck):+.3f} (regression risk)"
            )

    # Headline
    if spread_pick_side and spread_tier in ("LOCK", "STRONG"):
        headline = f"{spread_tier}: {spread_pick_side} covers {spread_value:+.1f} pts of value"
    elif total_pick_side and total_tier in ("LOCK", "STRONG"):
        headline = f"{total_tier}: {total_pick_side} {total_value:+.1f} pts of value"
    else:
        headline = f"{away_team} @ {home_team}: proceed with caution"

    return PickCard(
        away_team=away_team,
        home_team=home_team,
        game_date=game_date,
        spread=spread,
        total=total_line,
        projected_away_score=projected_away_score,
        projected_home_score=projected_home_score,
        projected_total=projected_total,
        true_spread=true_spread,
        spread_pick=spread_pick_side,
        spread_confidence=spread_tier,
        spread_composite=spread_composite,
        spread_value=spread_value,
        total_pick=total_pick_side,
        total_confidence=total_tier,
        total_composite=total_composite,
        total_value=total_value,
        dimension_results=dimension_results,
        headline=headline,
        key_factors=key_factors,
        trap_warnings=trap_warnings,
    )


def _save_pick_history(
    conn,
    cards: list,
    game_date: str,
    season: int,
) -> None:
    """Persist pick cards to the pick_history table for future backtesting."""
    from .db.loader import upsert_records

    records = []
    today = date.today().isoformat()

    for card in cards:
        # Save spread pick if actionable
        if card.spread_pick and card.spread_confidence != "SKIP":
            records.append({
                "analysis_date": today,
                "game_date": card.game_date,
                "season": season,
                "away_team": card.away_team,
                "home_team": card.home_team,
                "pick_type": "spread",
                "pick_side": card.spread_pick,
                "confidence": card.spread_composite,
                "composite_score": card.spread_composite,
                "spread_at_pick": card.spread,
                "total_at_pick": card.total,
                "result": None,
            })

        # Save total pick if actionable
        if card.total_pick and card.total_confidence != "SKIP":
            records.append({
                "analysis_date": today,
                "game_date": card.game_date,
                "season": season,
                "away_team": card.away_team,
                "home_team": card.home_team,
                "pick_type": "total",
                "pick_side": card.total_pick,
                "confidence": card.total_composite,
                "composite_score": card.total_composite,
                "spread_at_pick": card.spread,
                "total_at_pick": card.total,
                "result": None,
            })

    if records:
        count = upsert_records(conn, records, "pick_history")
        logger.info("Saved %d picks to history.", count)


def _handle_backtest(args: argparse.Namespace) -> None:
    """Evaluate historical pick performance."""
    from .analysis.backtest import run_backtest
    from .db.connection import get_connection, initialize_db
    from .output.terminal import display_backtest_summary

    db_path = args.db
    initialize_db(db_path)

    with get_connection(db_path) as conn:
        result = run_backtest(
            conn,
            season=args.season,
            start_date=args.start,
            end_date=args.end,
        )

    if result.total_picks == 0:
        print("No resolved picks found. Record results first with: ncaa_betting result ...")
        sys.exit(0)

    display_backtest_summary(result)


def _handle_result(args: argparse.Namespace) -> None:
    """Record the outcome of a game."""
    from .analysis.backtest import record_result
    from .db.connection import get_connection, initialize_db

    db_path = args.db
    initialize_db(db_path)

    with get_connection(db_path) as conn:
        record_result(
            conn,
            game_date=args.date,
            away_team=args.away,
            home_team=args.home,
            pick_type=args.type,
            result=args.result,
        )

    print(
        f"Recorded {args.result} for {args.away} @ {args.home} "
        f"on {args.date} ({args.type})."
    )


# ---------------------------------------------------------------------------
# Argument parser
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    """Construct the top-level argument parser with all subcommands."""
    parser = argparse.ArgumentParser(
        prog="ncaa_betting",
        description="NCAA basketball betting analysis tool.",
    )

    # Global flags
    parser.add_argument(
        "--db",
        type=str,
        default=None,
        help="Path to the SQLite database (default: ncaa_betting/data/ncaa_betting.db).",
    )
    parser.add_argument(
        "--season",
        type=int,
        default=None,
        help="Season year (e.g. 2025 for 2024-25 season). Default: auto-detect.",
    )
    parser.add_argument(
        "--log-level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        default="WARNING",
        help="Logging verbosity (default: WARNING).",
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # ---- load ----
    load_parser = subparsers.add_parser(
        "load",
        help="Parse and load data files into the database.",
    )
    load_parser.add_argument(
        "--kenpom",
        metavar="FILE",
        help="KenPom ratings paste file.",
    )
    load_parser.add_argument(
        "--four-factors",
        metavar="FILE",
        help="KenPom four factors paste file.",
    )
    load_parser.add_argument(
        "--game-log",
        metavar="FILE",
        help="KenPom game log paste file.",
    )
    load_parser.add_argument(
        "--game-log-team",
        metavar="TEAM",
        help="Team name for the game log (required with --game-log).",
    )
    load_parser.add_argument(
        "--ats",
        metavar="FILE",
        help="Against-the-spread data file.",
    )
    load_parser.add_argument(
        "--ats-team",
        metavar="TEAM",
        help="Team name for ATS data (required with --ats).",
    )
    load_parser.add_argument(
        "--ou",
        metavar="FILE",
        help="Over/under data file.",
    )
    load_parser.add_argument(
        "--ou-team",
        metavar="TEAM",
        help="Team name for O/U data (required with --ou).",
    )
    load_parser.add_argument(
        "--vegas",
        metavar="FILE",
        help="Vegas lines file.",
    )
    load_parser.set_defaults(func=_handle_load)

    # ---- analyze ----
    analyze_parser = subparsers.add_parser(
        "analyze",
        help="Run matchup analysis and display pick cards.",
    )
    analyze_parser.add_argument(
        "--date",
        metavar="DATE",
        help="Game date in YYYY-MM-DD format (default: today).",
    )
    analyze_parser.add_argument(
        "--matchup",
        nargs=2,
        metavar=("AWAY", "HOME"),
        help="Analyse a specific matchup (two team names).",
    )
    analyze_parser.add_argument(
        "--export",
        metavar="PATH",
        help="Export picks to a Markdown file.",
    )
    analyze_parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        default=False,
        help="Show detailed dimension breakdowns.",
    )
    analyze_parser.set_defaults(func=_handle_analyze)

    # ---- backtest ----
    backtest_parser = subparsers.add_parser(
        "backtest",
        help="Evaluate historical pick performance.",
    )
    backtest_parser.add_argument(
        "--start",
        metavar="DATE",
        help="Start date for backtest window (YYYY-MM-DD).",
    )
    backtest_parser.add_argument(
        "--end",
        metavar="DATE",
        help="End date for backtest window (YYYY-MM-DD).",
    )
    backtest_parser.set_defaults(func=_handle_backtest)

    # ---- result ----
    result_parser = subparsers.add_parser(
        "result",
        help="Record a game result for backtesting.",
    )
    result_parser.add_argument(
        "--date",
        required=True,
        metavar="DATE",
        help="Game date (YYYY-MM-DD).",
    )
    result_parser.add_argument(
        "--away",
        required=True,
        metavar="TEAM",
        help="Away team name.",
    )
    result_parser.add_argument(
        "--home",
        required=True,
        metavar="TEAM",
        help="Home team name.",
    )
    result_parser.add_argument(
        "--type",
        required=True,
        choices=["spread", "total"],
        help="Pick type to record result for.",
    )
    result_parser.add_argument(
        "--result",
        required=True,
        choices=["W", "L", "P"],
        help="Game result: W (win), L (loss), P (push).",
    )
    result_parser.set_defaults(func=_handle_result)

    return parser


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main(argv: Optional[list[str]] = None) -> None:
    """Parse command-line arguments and dispatch to the appropriate handler.

    Parameters
    ----------
    argv:
        Argument list to parse.  Defaults to ``sys.argv[1:]`` when
        *None*.
    """
    parser = _build_parser()
    args = parser.parse_args(argv)

    # Configure logging
    logging.basicConfig(
        level=getattr(logging, args.log_level, logging.WARNING),
        format="%(asctime)s  %(name)-30s  %(levelname)-8s  %(message)s",
        datefmt="%H:%M:%S",
    )

    # Set default db path if not specified
    if args.db is None:
        from .db.connection import DEFAULT_DB_PATH
        args.db = DEFAULT_DB_PATH

    if not hasattr(args, "func"):
        parser.print_help()
        sys.exit(1)

    args.func(args)
