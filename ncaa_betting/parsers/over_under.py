"""Parser for Over/Under (O/U) game-by-game data.

Reads tab-separated text exported from O/U tracking sites and returns a
tidy :class:`pandas.DataFrame` whose columns match the ``ou_records``
database schema.

Expected input format (one row per game, tab-separated)::

    Nov 04	H	Morgan St.	143	143	Push	0
    Nov 08	A	Alabama	145.5	162	Over	16.5
    Nov 12	N	Indiana	137	124	Under	-13

Columns:
    date, location (H/A/N), opponent, total (line), combined_score,
    ou_result (Over/Under/Push), margin
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
_EARLY_MONTHS = {"nov", "dec"}

# Column order matching the ou_records DB schema (minus auto-generated cols).
_COLUMNS = [
    "scrape_date",
    "season",
    "team",
    "game_date",
    "location",
    "opponent",
    "total",
    "combined_score",
    "ou_result",
    "margin",
]

# Valid location codes.
_VALID_LOCATIONS = {"H", "A", "N"}

# Map from raw O/U result text to lowercase DB value.
_OU_MAP = {
    "over": "over",
    "under": "under",
    "push": "push",
}


def _resolve_game_year(month_str: str, season: int) -> int:
    """Return the calendar year for a game given its month abbreviation.

    For college basketball, ``season`` refers to the year the season *ends*
    (e.g. the 2024-25 season is ``season=2025``).

    * Nov, Dec -> ``season - 1``
    * Jan-Apr  -> ``season``
    """
    if month_str.lower() in _EARLY_MONTHS:
        return season - 1
    return season


def _parse_float(raw: str, field_name: str, line_num: int) -> Optional[float]:
    """Attempt to parse a string as a float.

    Returns ``None`` and logs a warning when the value cannot be converted.
    """
    raw = raw.strip()
    if not raw or raw == "-":
        return None
    try:
        return float(raw)
    except ValueError:
        logger.warning(
            "O/U row %d: could not parse %s value: %r",
            line_num,
            field_name,
            raw,
        )
        return None


def _parse_int(raw: str, field_name: str, line_num: int) -> Optional[int]:
    """Attempt to parse a string as an integer.

    Also accepts float strings that represent whole numbers (e.g. ``'143.0'``).
    Returns ``None`` and logs a warning when the value cannot be converted.
    """
    raw = raw.strip()
    if not raw or raw == "-":
        return None
    try:
        value = float(raw)
        return int(value)
    except ValueError:
        logger.warning(
            "O/U row %d: could not parse %s value: %r",
            line_num,
            field_name,
            raw,
        )
        return None


def parse_ou_data(
    raw_text: str,
    team: str,
    season: int,
    scrape_date: Optional[str] = None,
) -> pd.DataFrame:
    """Parse Over/Under game-by-game text into a DataFrame.

    Parameters
    ----------
    raw_text : str
        The raw tab-separated text, one line per game.
    team : str
        Name of the team whose O/U data this is.  Will be canonicalized.
    season : int
        The season year (ending year, e.g. 2025 for the 2024-25 season).
    scrape_date : str, optional
        ISO-format date string (``YYYY-MM-DD``).  Defaults to today.

    Returns
    -------
    pd.DataFrame
        DataFrame with columns matching the ``ou_records`` schema.
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
                "O/U row %d: expected 7 columns, got %d — skipping: %r",
                line_num,
                len(parts),
                line,
            )
            continue

        date_str = parts[0].strip()
        location = parts[1].strip().upper()
        opponent_raw = parts[2].strip()
        total_raw = parts[3].strip()
        combined_raw = parts[4].strip()
        ou_raw = parts[5].strip().lower()
        margin_raw = parts[6].strip()

        # --- Validate location ---
        if location not in _VALID_LOCATIONS:
            logger.warning(
                "O/U row %d: invalid location %r — skipping: %r",
                line_num,
                location,
                line,
            )
            continue

        # --- Validate O/U result ---
        ou_result = _OU_MAP.get(ou_raw)
        if ou_result is None:
            logger.warning(
                "O/U row %d: invalid ou_result %r — skipping: %r",
                line_num,
                ou_raw,
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
                "O/U row %d: could not parse date %r — skipping: %r",
                line_num,
                date_str,
                line,
            )
            continue

        # --- Parse numeric fields ---
        total = _parse_float(total_raw, "total", line_num)
        combined_score = _parse_int(combined_raw, "combined_score", line_num)
        margin = _parse_float(margin_raw, "margin", line_num)

        rows.append(
            {
                "scrape_date": scrape_date,
                "season": season,
                "team": canonical_team,
                "game_date": game_date,
                "location": location,
                "opponent": canonicalize(opponent_raw),
                "total": total,
                "combined_score": combined_score,
                "ou_result": ou_result,
                "margin": margin,
            }
        )

    df = pd.DataFrame(rows, columns=_COLUMNS)

    if df.empty:
        logger.info("O/U parser produced 0 rows for %s (season %d)", team, season)
    else:
        logger.info(
            "O/U parser produced %d rows for %s (season %d)",
            len(df),
            canonical_team,
            season,
        )

    return df
