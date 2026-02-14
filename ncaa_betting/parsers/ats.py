"""Parser for Against-the-Spread (ATS) game-by-game data.

Reads tab-separated text exported from ATS tracking sites and returns a
tidy :class:`pandas.DataFrame` whose columns match the ``ats_records``
database schema.

Expected input format (one row per game, tab-separated)::

    Nov 04	H	Morgan St.	-28.5	W	51	Cover
    Nov 08	A	Alabama	-3.5	W	12	Cover
    Nov 12	N	Indiana	-4	L	-3	Miss

Columns:
    date, location (H/A/N), opponent, line, result (W/L),
    margin (+/- integer or float), ats_result (Cover/Miss/Push)
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime
from typing import Optional

import pandas as pd

from .normalize import canonicalize

logger = logging.getLogger(__name__)

# Months that belong to the *first* calendar year of the season.
# College basketball season 2025 spans Nov 2024 - Apr 2025.
# Nov and Dec belong to (season - 1); Jan onward belongs to (season).
_EARLY_MONTHS = {"nov", "dec"}

# Column order matching the ats_records DB schema (minus auto-generated cols).
_COLUMNS = [
    "scrape_date",
    "season",
    "team",
    "game_date",
    "location",
    "opponent",
    "line",
    "result",
    "margin",
    "ats_result",
]

# Valid location codes.
_VALID_LOCATIONS = {"H", "A", "N"}

# Valid game result codes.
_VALID_RESULTS = {"W", "L"}

# Map from raw ATS result text to lowercase DB value.
_ATS_MAP = {
    "cover": "cover",
    "miss": "miss",
    "push": "push",
}


def _resolve_game_year(month_str: str, season: int) -> int:
    """Return the calendar year for a game given its month abbreviation.

    For college basketball, ``season`` refers to the year the season *ends*
    (e.g. the 2024-25 season is ``season=2025``).

    * Nov, Dec -> ``season - 1``
    * Jan-Apr  -> ``season``

    Parameters
    ----------
    month_str : str
        Three-letter month abbreviation (e.g. ``"Nov"``, ``"Jan"``).
    season : int
        The nominal season year.

    Returns
    -------
    int
        Calendar year the game was played.
    """
    if month_str.lower() in _EARLY_MONTHS:
        return season - 1
    return season


def _parse_margin(raw: str) -> Optional[float]:
    """Convert a margin string like ``'51'``, ``'-3'``, or ``'+7.5'`` to float.

    Returns ``None`` when the value cannot be parsed.
    """
    raw = raw.strip()
    if not raw or raw == "-":
        return None
    try:
        return float(raw)
    except ValueError:
        logger.warning("Could not parse margin value: %r", raw)
        return None


def _parse_line(raw: str) -> Optional[float]:
    """Convert a spread/line string to float.

    Handles formats like ``'-3.5'``, ``'+7'``, ``'PK'`` (pick 'em = 0).
    Returns ``None`` when the value cannot be parsed.
    """
    raw = raw.strip().upper()
    if not raw or raw == "-":
        return None
    if raw in ("PK", "PICK", "PICK'EM", "PICKEM"):
        return 0.0
    try:
        return float(raw)
    except ValueError:
        logger.warning("Could not parse line value: %r", raw)
        return None


def parse_ats_data(
    raw_text: str,
    team: str,
    season: int,
    scrape_date: Optional[str] = None,
) -> pd.DataFrame:
    """Parse ATS game-by-game text into a DataFrame.

    Parameters
    ----------
    raw_text : str
        The raw tab-separated text, one line per game.
    team : str
        Name of the team whose ATS data this is.  Will be canonicalized.
    season : int
        The season year (ending year, e.g. 2025 for the 2024-25 season).
    scrape_date : str, optional
        ISO-format date string (``YYYY-MM-DD``).  Defaults to today.

    Returns
    -------
    pd.DataFrame
        DataFrame with columns matching the ``ats_records`` schema.
        Malformed rows are silently skipped (with a warning logged).
    """
    if scrape_date is None:
        scrape_date = date.today().isoformat()

    canonical_team = canonicalize(team)
    rows: list[dict] = []

    for line_num, raw_line in enumerate(raw_text.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue

        # Split on tabs.  Fall back to 2+ spaces if no tabs found.
        parts = line.split("\t")
        if len(parts) < 7:
            parts = re.split(r"\s{2,}", line)

        if len(parts) < 7:
            logger.warning(
                "ATS row %d: expected 7 columns, got %d — skipping: %r",
                line_num,
                len(parts),
                line,
            )
            continue

        date_str = parts[0].strip()
        location = parts[1].strip().upper()
        opponent_raw = parts[2].strip()
        line_raw = parts[3].strip()
        result = parts[4].strip().upper()
        margin_raw = parts[5].strip()
        ats_raw = parts[6].strip().lower()

        # --- Validate location ---
        if location not in _VALID_LOCATIONS:
            logger.warning(
                "ATS row %d: invalid location %r — skipping: %r",
                line_num,
                location,
                line,
            )
            continue

        # --- Validate result ---
        if result not in _VALID_RESULTS:
            logger.warning(
                "ATS row %d: invalid result %r — skipping: %r",
                line_num,
                result,
                line,
            )
            continue

        # --- Validate ATS result ---
        ats_result = _ATS_MAP.get(ats_raw)
        if ats_result is None:
            logger.warning(
                "ATS row %d: invalid ats_result %r — skipping: %r",
                line_num,
                ats_raw,
                line,
            )
            continue

        # --- Parse date ---
        try:
            parsed = datetime.strptime(date_str, "%b %d")
            year = _resolve_game_year(parsed.strftime("%b"), season)
            game_date = date(year, parsed.month, parsed.day).isoformat()
        except ValueError:
            logger.warning(
                "ATS row %d: could not parse date %r — skipping: %r",
                line_num,
                date_str,
                line,
            )
            continue

        # --- Parse numeric fields ---
        spread = _parse_line(line_raw)
        margin = _parse_margin(margin_raw)

        rows.append(
            {
                "scrape_date": scrape_date,
                "season": season,
                "team": canonical_team,
                "game_date": game_date,
                "location": location,
                "opponent": canonicalize(opponent_raw),
                "line": spread,
                "result": result,
                "margin": margin,
                "ats_result": ats_result,
            }
        )

    df = pd.DataFrame(rows, columns=_COLUMNS)

    if df.empty:
        logger.info("ATS parser produced 0 rows for %s (season %d)", team, season)
    else:
        logger.info(
            "ATS parser produced %d rows for %s (season %d)",
            len(df),
            canonical_team,
            season,
        )

    return df
