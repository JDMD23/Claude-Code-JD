"""Parser for Vegas lines / odds for upcoming games.

Reads multi-line text containing matchup lines and returns a tidy
:class:`pandas.DataFrame` whose columns match the ``vegas_lines``
database schema.

Expected input format (tab or multi-space delimited)::

    Houston @ Kansas  -3.5  138.5
    Duke vs North Carolina  PK  147
    Auburn @ Tennessee  -2  141.5

Each line contains:
    away_team @ home_team    spread    total    [away_ml    home_ml]

Notes:
    * ``@`` indicates away/home.
    * ``vs`` indicates a neutral-site game (first team is still treated
      as the "away" team for column purposes).
    * ``PK`` (pick 'em) is converted to a spread of ``0.0``.
    * Moneyline columns at the end are optional.
    * The spread is always from the **home team's** perspective (negative
      means home is favored) to match standard convention.
"""

from __future__ import annotations

import logging
import re
from datetime import date
from typing import Optional

import pandas as pd

from .normalize import canonicalize

logger = logging.getLogger(__name__)

# Column order matching the vegas_lines DB schema (minus auto-generated cols).
_COLUMNS = [
    "game_date",
    "season",
    "away_team",
    "home_team",
    "spread",
    "total",
    "away_ml",
    "home_ml",
]

# Regex that splits a matchup line into teams + numbers.
# Captures: <away_team> <@|vs> <home_team> <spread> <total> [<away_ml> <home_ml>]
# The separator between fields can be tab(s) or 2+ spaces.
_SEP = r"[\t]|  +"

# Regex for the matchup separator between two team names.
_MATCHUP_RE = re.compile(r"\s+(@|vs\.?|v\.?)\s+", re.IGNORECASE)


def _parse_spread(raw: str) -> Optional[float]:
    """Convert a spread string to float.

    Handles ``'-3.5'``, ``'+7'``, ``'PK'`` / ``'PICK'`` (= 0.0), ``'EVEN'``.
    Returns ``None`` when the value cannot be parsed.
    """
    raw = raw.strip().upper()
    if not raw or raw == "-":
        return None
    if raw in ("PK", "PICK", "PICK'EM", "PICKEM", "EVEN"):
        return 0.0
    try:
        return float(raw)
    except ValueError:
        logger.warning("Could not parse spread value: %r", raw)
        return None


def _parse_total(raw: str) -> Optional[float]:
    """Convert a total string to float.

    Returns ``None`` when the value cannot be parsed.
    """
    raw = raw.strip()
    if not raw or raw == "-":
        return None
    try:
        return float(raw)
    except ValueError:
        logger.warning("Could not parse total value: %r", raw)
        return None


def _parse_moneyline(raw: str) -> Optional[int]:
    """Convert a moneyline string to int.

    Accepts ``'+150'``, ``'-220'``, etc.
    Returns ``None`` when the value cannot be parsed.
    """
    raw = raw.strip()
    if not raw or raw == "-":
        return None
    try:
        return int(float(raw))
    except ValueError:
        logger.warning("Could not parse moneyline value: %r", raw)
        return None


def _split_line_fields(line: str) -> Optional[tuple[str, str, str, list[str]]]:
    """Split a single raw line into (matchup_str, separator, remaining_fields).

    Returns ``(away_team, home_team, separator, numeric_parts)`` or ``None``
    if the line cannot be parsed.
    """
    # First find the matchup separator (@ or vs)
    m = _MATCHUP_RE.search(line)
    if m is None:
        return None

    separator = m.group(1).rstrip(".").lower()  # "@ " -> "@", "vs." -> "vs"
    away_raw = line[: m.start()].strip()
    rest = line[m.end() :].strip()

    # The rest is: "home_team <sep> spread <sep> total [<sep> away_ml <sep> home_ml]"
    # We need to separate the home team name (which may contain spaces) from
    # the numeric fields.  Strategy: split from the right on tab/multi-space
    # boundaries and peel off numeric tokens.

    # Split rest into tokens by tab or 2+ spaces.
    tokens = re.split(_SEP, rest)
    tokens = [t.strip() for t in tokens if t.strip()]

    if len(tokens) < 3:
        # At minimum we need: home_team, spread, total
        return None

    # Walk backwards to find numeric tokens.
    # Numeric tokens match: optional sign, digits, optional decimal.
    numeric_pattern = re.compile(
        r"^[+-]?\d+\.?\d*$|^PK$|^PICK$|^PICK'EM$|^PICKEM$|^EVEN$",
        re.IGNORECASE,
    )

    # Find the boundary between team name tokens and numeric tokens.
    first_numeric_idx = None
    for i, tok in enumerate(tokens):
        if numeric_pattern.match(tok):
            first_numeric_idx = i
            break

    if first_numeric_idx is None or first_numeric_idx < 1:
        # No numeric tokens found, or no team name tokens before them.
        return None

    home_raw = " ".join(tokens[:first_numeric_idx])
    numeric_parts = tokens[first_numeric_idx:]

    if len(numeric_parts) < 2:
        # Need at least spread + total.
        return None

    return away_raw, home_raw, separator, numeric_parts


def parse_vegas_lines(
    raw_text: str,
    season: int,
    game_date: Optional[str] = None,
) -> pd.DataFrame:
    """Parse Vegas lines text into a DataFrame.

    Parameters
    ----------
    raw_text : str
        Raw text with one matchup per line.
    season : int
        The season year (ending year, e.g. 2025 for the 2024-25 season).
    game_date : str, optional
        ISO-format date string (``YYYY-MM-DD``) for the games.
        Defaults to today.

    Returns
    -------
    pd.DataFrame
        DataFrame with columns matching the ``vegas_lines`` schema.
        Malformed rows are silently skipped (with a warning logged).
    """
    if game_date is None:
        game_date = date.today().isoformat()

    rows: list[dict] = []

    for line_num, raw_line in enumerate(raw_text.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue

        parsed = _split_line_fields(line)
        if parsed is None:
            logger.warning(
                "Vegas row %d: could not parse matchup — skipping: %r",
                line_num,
                line,
            )
            continue

        away_raw, home_raw, separator, numeric_parts = parsed

        # Parse spread and total (required).
        spread = _parse_spread(numeric_parts[0])
        total = _parse_total(numeric_parts[1])

        # Parse optional moneylines.
        away_ml: Optional[int] = None
        home_ml: Optional[int] = None
        if len(numeric_parts) >= 4:
            away_ml = _parse_moneyline(numeric_parts[2])
            home_ml = _parse_moneyline(numeric_parts[3])
        elif len(numeric_parts) == 3:
            # Ambiguous — could be a moneyline fragment.  Log and skip ML.
            logger.debug(
                "Vegas row %d: 3 numeric fields found; ignoring possible "
                "partial moneyline: %r",
                line_num,
                numeric_parts[2],
            )

        rows.append(
            {
                "game_date": game_date,
                "season": season,
                "away_team": canonicalize(away_raw),
                "home_team": canonicalize(home_raw),
                "spread": spread,
                "total": total,
                "away_ml": away_ml,
                "home_ml": home_ml,
            }
        )

    df = pd.DataFrame(rows, columns=_COLUMNS)

    if df.empty:
        logger.info("Vegas parser produced 0 rows")
    else:
        logger.info("Vegas parser produced %d rows", len(df))

    return df
