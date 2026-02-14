"""KenPom data parser for NCAA basketball ratings, four factors, and game logs.

Handles messy copy-paste data from KenPom.com where tab-separated values
include inline ranking numbers interleaved with metric values. Robust against
variations in whitespace, missing data, and optional header rows.
"""

from __future__ import annotations

import logging
import re
from datetime import date
from typing import Optional

import pandas as pd

from .normalize import canonicalize

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Column schemas -- authoritative orderings that match the DB tables
# ---------------------------------------------------------------------------

RATINGS_COLUMNS = [
    "rank_overall",
    "team",
    "conference",
    "record",
    "adj_em",
    "adj_o",
    "adj_o_rank",
    "adj_d",
    "adj_d_rank",
    "adj_t",
    "adj_t_rank",
    "luck",
    "luck_rank",
    "sos_adj_em",
    "sos_adj_em_rank",
    "sos_opp_o",
    "sos_opp_o_rank",
    "sos_opp_d",
    "sos_opp_d_rank",
    "ncsos_adj_em",
    "ncsos_adj_em_rank",
]

FOUR_FACTORS_COLUMNS = [
    "team",
    "conference",
    "off_efg",
    "off_efg_rank",
    "off_to",
    "off_to_rank",
    "off_or",
    "off_or_rank",
    "off_ft_rate",
    "off_ft_rate_rank",
    "def_efg",
    "def_efg_rank",
    "def_to",
    "def_to_rank",
    "def_or",
    "def_or_rank",
    "def_ft_rate",
    "def_ft_rate_rank",
    "off_2p",
    "off_2p_rank",
    "off_3p",
    "off_3p_rank",
    "def_2p",
    "def_2p_rank",
    "def_3p",
    "def_3p_rank",
]

GAME_LOG_COLUMNS = [
    "game_num",
    "date",
    "opponent",
    "location",
    "result",
    "score",
    "team_score",
    "opp_score",
    "adj_oe",
    "adj_de",
    "possessions",
    "opp_adj_em",
    "opp_adj_em_rank",
    "opp_adj_o",
    "opp_adj_o_rank",
]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _default_scrape_date(scrape_date: Optional[str]) -> str:
    """Return *scrape_date* if provided, otherwise today in YYYY-MM-DD."""
    if scrape_date is not None:
        return scrape_date
    return date.today().isoformat()


def _clean_raw_text(raw_text: str) -> list[str]:
    """Normalise whitespace, strip blank lines, and return non-empty lines.

    * Converts any run of spaces that looks like a tab delimiter into a real
      tab character (KenPom pastes sometimes use 2-4 spaces instead of tabs).
    * Strips leading/trailing whitespace from each line.
    * Drops completely empty lines.
    """
    lines: list[str] = []
    for raw_line in raw_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        lines.append(line)
    return lines


def _is_header_line(line: str) -> bool:
    """Heuristic: a line is a header if it contains known header keywords and
    no purely numeric first token (i.e., no rank number)."""
    lower = line.lower()
    header_keywords = [
        "adj", "rank", "team", "conf", "record", "w-l", "tempo",
        "luck", "sos", "ncsos", "efg", "opp", "off", "def",
        "oe", "de", "poss",
    ]
    tokens = re.split(r"\t+|\s{2,}", line)
    first_token = tokens[0].strip() if tokens else ""
    # If the first token is a number, it is almost certainly a data row
    if re.match(r"^\d+$", first_token):
        return False
    return any(kw in lower for kw in header_keywords)


def _tokenize_line(line: str) -> list[str]:
    """Split a line on tabs first; if that yields too few tokens, fall back to
    runs of 2+ spaces.  Returns stripped tokens."""
    # First try tab splitting
    parts = line.split("\t")
    if len(parts) >= 5:
        return [p.strip() for p in parts]
    # Fall back to multi-space splitting
    parts = re.split(r"\s{2,}", line)
    if len(parts) >= 5:
        return [p.strip() for p in parts]
    # Last resort: split on single spaces but try to reassemble team names
    return [p.strip() for p in parts]


def _safe_float(value: str) -> Optional[float]:
    """Convert a string to float, returning None on failure."""
    if value is None:
        return None
    value = value.strip()
    if value in ("", "-", "--", "N/A", "n/a"):
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def _safe_int(value: str) -> Optional[int]:
    """Convert a string to int, returning None on failure."""
    if value is None:
        return None
    value = str(value).strip()
    if value in ("", "-", "--", "N/A", "n/a"):
        return None
    try:
        return int(float(value))
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def _split_value_rank(series: pd.Series) -> tuple[pd.Series, pd.Series]:
    """Split a Series of combined ``"value rank"`` strings into two Series.

    KenPom data often pastes metric values immediately followed by a rank in
    the next column.  When those two columns get merged into one string (e.g.
    ``"119.7 2"``), this helper separates them.

    Parameters
    ----------
    series : pd.Series
        Each element is expected to be a string like ``"119.7 2"`` or just a
        single value ``"119.7"``.

    Returns
    -------
    tuple[pd.Series, pd.Series]
        ``(values, ranks)`` where *values* are floats and *ranks* are ints.
        Missing or unparseable data becomes ``NaN``.
    """
    values = pd.Series(index=series.index, dtype="float64")
    ranks = pd.Series(index=series.index, dtype="Int64")

    for idx, raw in series.items():
        raw_str = str(raw).strip()
        if not raw_str or raw_str.lower() in ("nan", "none", "-", "--"):
            values[idx] = float("nan")
            ranks[idx] = pd.NA
            continue
        parts = raw_str.split()
        values[idx] = _safe_float(parts[0])
        if len(parts) >= 2:
            ranks[idx] = _safe_int(parts[1])
        else:
            ranks[idx] = pd.NA

    return values, ranks


def _parse_score(score_str: str) -> tuple[int, int]:
    """Parse a score string like ``"97-46"`` into ``(97, 46)``.

    Handles optional OT markers like ``"97-46 OT"`` or ``"97-46 2OT"``.

    Raises
    ------
    ValueError
        If the score string cannot be parsed into two integers.
    """
    if score_str is None:
        raise ValueError("score_str is None")
    cleaned = score_str.strip()
    # Remove overtime markers
    cleaned = re.sub(r"\s*\d*OT$", "", cleaned, flags=re.IGNORECASE).strip()
    match = re.match(r"^(\d+)\s*[-\u2013\u2014]\s*(\d+)$", cleaned)
    if not match:
        raise ValueError(f"Cannot parse score: {score_str!r}")
    return int(match.group(1)), int(match.group(2))


# ---------------------------------------------------------------------------
# Ratings parser
# ---------------------------------------------------------------------------

def parse_kenpom_ratings(
    raw_text: str,
    season: int,
    scrape_date: Optional[str] = None,
) -> pd.DataFrame:
    """Parse the main KenPom efficiency ratings page.

    Parameters
    ----------
    raw_text : str
        Raw copy-paste text from the KenPom ratings page.  May be tab- or
        multi-space-separated.  Header rows, if present, are auto-detected and
        skipped.
    season : int
        The NCAA season year (e.g. 2025 for the 2024-25 season).
    scrape_date : str, optional
        Date the data was scraped in ``YYYY-MM-DD`` format.  Defaults to today.

    Returns
    -------
    pd.DataFrame
        Columns: ``season``, ``scrape_date``, and all ``RATINGS_COLUMNS``.
    """
    scrape_date = _default_scrape_date(scrape_date)
    lines = _clean_raw_text(raw_text)

    rows: list[dict] = []
    for line_no, line in enumerate(lines, start=1):
        if _is_header_line(line):
            logger.debug("Skipping header line %d: %s", line_no, line[:80])
            continue

        tokens = _tokenize_line(line)

        # We expect exactly 21 tokens for a full ratings row.
        # Fewer tokens might indicate a partial paste; we handle gracefully.
        if len(tokens) < 5:
            logger.warning(
                "Line %d has only %d tokens, skipping: %s",
                line_no, len(tokens), line[:80],
            )
            continue

        row: dict = {}
        try:
            row["rank_overall"] = _safe_int(tokens[0])
            # Validate that the first token is a plausible rank
            if row["rank_overall"] is None or row["rank_overall"] < 1:
                logger.debug(
                    "Line %d: first token %r is not a valid rank, skipping",
                    line_no, tokens[0],
                )
                continue

            row["team"] = canonicalize(tokens[1])
            row["conference"] = tokens[2].strip() if len(tokens) > 2 else None
            row["record"] = tokens[3].strip() if len(tokens) > 3 else None

            # Map remaining tokens positionally.  Some may be missing if the
            # paste was truncated.
            numeric_fields = [
                ("adj_em", float),
                ("adj_o", float),
                ("adj_o_rank", int),
                ("adj_d", float),
                ("adj_d_rank", int),
                ("adj_t", float),
                ("adj_t_rank", int),
                ("luck", float),
                ("luck_rank", int),
                ("sos_adj_em", float),
                ("sos_adj_em_rank", int),
                ("sos_opp_o", float),
                ("sos_opp_o_rank", int),
                ("sos_opp_d", float),
                ("sos_opp_d_rank", int),
                ("ncsos_adj_em", float),
                ("ncsos_adj_em_rank", int),
            ]

            for i, (col_name, col_type) in enumerate(numeric_fields):
                token_idx = 4 + i  # first 4 tokens are rank/team/conf/record
                if token_idx < len(tokens):
                    raw_val = tokens[token_idx]
                    if col_type is int:
                        row[col_name] = _safe_int(raw_val)
                    else:
                        row[col_name] = _safe_float(raw_val)
                else:
                    row[col_name] = None

        except Exception:
            logger.exception(
                "Failed to parse ratings line %d: %s", line_no, line[:120],
            )
            continue

        rows.append(row)

    if not rows:
        logger.warning("No ratings rows parsed from input text.")
        return pd.DataFrame(
            columns=["season", "scrape_date"] + RATINGS_COLUMNS,
        )

    df = pd.DataFrame(rows)

    # Ensure all expected columns exist (fill missing with NaN)
    for col in RATINGS_COLUMNS:
        if col not in df.columns:
            df[col] = None

    # Enforce column ordering
    df = df[RATINGS_COLUMNS]

    # Type coercion
    int_cols = [c for c in df.columns if c.endswith("_rank") or c == "rank_overall"]
    for col in int_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")

    float_cols = [
        "adj_em", "adj_o", "adj_d", "adj_t",
        "luck", "sos_adj_em", "sos_opp_o", "sos_opp_d", "ncsos_adj_em",
    ]
    for col in float_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").astype("float64")

    # Add metadata columns
    df.insert(0, "season", season)
    df.insert(1, "scrape_date", scrape_date)

    logger.info(
        "Parsed %d teams from KenPom ratings for season %d", len(df), season,
    )
    return df


# ---------------------------------------------------------------------------
# Four factors parser
# ---------------------------------------------------------------------------

def parse_kenpom_four_factors(
    raw_text: str,
    season: int,
    scrape_date: Optional[str] = None,
) -> pd.DataFrame:
    """Parse KenPom four factors data.

    Parameters
    ----------
    raw_text : str
        Raw copy-paste text from the KenPom four factors page.
    season : int
        NCAA season year.
    scrape_date : str, optional
        Scrape date; defaults to today.

    Returns
    -------
    pd.DataFrame
        Columns: ``season``, ``scrape_date``, and all ``FOUR_FACTORS_COLUMNS``.
    """
    scrape_date = _default_scrape_date(scrape_date)
    lines = _clean_raw_text(raw_text)

    rows: list[dict] = []
    for line_no, line in enumerate(lines, start=1):
        if _is_header_line(line):
            logger.debug("Skipping header line %d: %s", line_no, line[:80])
            continue

        tokens = _tokenize_line(line)

        if len(tokens) < 4:
            logger.warning(
                "Line %d has only %d tokens, skipping: %s",
                line_no, len(tokens), line[:80],
            )
            continue

        row: dict = {}
        try:
            # Determine whether the first column is an overall rank we should
            # skip.  If the first token is a bare integer and the second looks
            # like a team name, treat the first token as a rank and shift.
            offset = 0
            first = tokens[0].strip()
            if re.match(r"^\d+$", first) and len(tokens) > 2:
                # Check if second token looks like a team name (not numeric)
                second = tokens[1].strip()
                if not re.match(r"^[+-]?\d", second):
                    offset = 1  # skip the leading rank column

            row["team"] = canonicalize(tokens[offset])
            row["conference"] = tokens[offset + 1].strip() if (offset + 1) < len(tokens) else None

            # The remaining tokens are value/rank pairs for each factor.
            # Expected order (after team, conference):
            #   off_efg, off_efg_rank, off_to, off_to_rank, off_or, off_or_rank,
            #   off_ft_rate, off_ft_rate_rank,
            #   def_efg, def_efg_rank, def_to, def_to_rank, def_or, def_or_rank,
            #   def_ft_rate, def_ft_rate_rank,
            #   off_2p, off_2p_rank, off_3p, off_3p_rank,
            #   def_2p, def_2p_rank, def_3p, def_3p_rank
            factor_fields = [
                ("off_efg", float),
                ("off_efg_rank", int),
                ("off_to", float),
                ("off_to_rank", int),
                ("off_or", float),
                ("off_or_rank", int),
                ("off_ft_rate", float),
                ("off_ft_rate_rank", int),
                ("def_efg", float),
                ("def_efg_rank", int),
                ("def_to", float),
                ("def_to_rank", int),
                ("def_or", float),
                ("def_or_rank", int),
                ("def_ft_rate", float),
                ("def_ft_rate_rank", int),
                ("off_2p", float),
                ("off_2p_rank", int),
                ("off_3p", float),
                ("off_3p_rank", int),
                ("def_2p", float),
                ("def_2p_rank", int),
                ("def_3p", float),
                ("def_3p_rank", int),
            ]

            base_idx = offset + 2  # after team and conference
            for i, (col_name, col_type) in enumerate(factor_fields):
                token_idx = base_idx + i
                if token_idx < len(tokens):
                    raw_val = tokens[token_idx]
                    if col_type is int:
                        row[col_name] = _safe_int(raw_val)
                    else:
                        row[col_name] = _safe_float(raw_val)
                else:
                    row[col_name] = None

        except Exception:
            logger.exception(
                "Failed to parse four-factors line %d: %s", line_no, line[:120],
            )
            continue

        # Sanity check: team name should be non-empty
        if not row.get("team"):
            logger.warning("Line %d: empty team name, skipping", line_no)
            continue

        rows.append(row)

    if not rows:
        logger.warning("No four-factors rows parsed from input text.")
        return pd.DataFrame(
            columns=["season", "scrape_date"] + FOUR_FACTORS_COLUMNS,
        )

    df = pd.DataFrame(rows)

    # Ensure all expected columns exist
    for col in FOUR_FACTORS_COLUMNS:
        if col not in df.columns:
            df[col] = None

    df = df[FOUR_FACTORS_COLUMNS]

    # Type coercion
    int_cols = [c for c in df.columns if c.endswith("_rank")]
    for col in int_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")

    float_cols = [c for c in FOUR_FACTORS_COLUMNS if c not in int_cols and c not in ("team", "conference")]
    for col in float_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").astype("float64")

    df.insert(0, "season", season)
    df.insert(1, "scrape_date", scrape_date)

    logger.info(
        "Parsed %d teams from KenPom four factors for season %d",
        len(df), season,
    )
    return df


# ---------------------------------------------------------------------------
# Game log parser
# ---------------------------------------------------------------------------

def parse_kenpom_game_log(
    raw_text: str,
    team: str,
    season: int,
    scrape_date: Optional[str] = None,
) -> pd.DataFrame:
    """Parse a KenPom team game log / opponent tracker page.

    Parameters
    ----------
    raw_text : str
        Raw copy-paste text from a KenPom team page game log.
    team : str
        The team whose game log this is (will be canonicalized).
    season : int
        NCAA season year.
    scrape_date : str, optional
        Scrape date; defaults to today.

    Returns
    -------
    pd.DataFrame
        Columns: ``season``, ``scrape_date``, ``team``, and game-level stats.
    """
    scrape_date = _default_scrape_date(scrape_date)
    team = canonicalize(team)
    lines = _clean_raw_text(raw_text)

    rows: list[dict] = []
    for line_no, line in enumerate(lines, start=1):
        if _is_header_line(line):
            logger.debug("Skipping header line %d: %s", line_no, line[:80])
            continue

        tokens = _tokenize_line(line)

        if len(tokens) < 6:
            logger.warning(
                "Line %d has only %d tokens, skipping: %s",
                line_no, len(tokens), line[:80],
            )
            continue

        row: dict = {}
        try:
            row["game_num"] = _safe_int(tokens[0])
            if row["game_num"] is None or row["game_num"] < 1:
                logger.debug(
                    "Line %d: first token %r not a valid game number, skipping",
                    line_no, tokens[0],
                )
                continue

            # Date -- e.g. "Nov 04", "Jan 15".  Combine with season year.
            raw_date = tokens[1].strip()
            row["date"] = _resolve_game_date(raw_date, season)

            row["opponent"] = canonicalize(tokens[2])

            # Location: H / A / N  (sometimes "Home", "Away", "Neutral")
            loc_raw = tokens[3].strip().upper()
            if loc_raw.startswith("H"):
                row["location"] = "H"
            elif loc_raw.startswith("A"):
                row["location"] = "A"
            elif loc_raw.startswith("N"):
                row["location"] = "N"
            else:
                row["location"] = loc_raw[:1] if loc_raw else None

            # Result: W or L (sometimes "W" / "L" standalone, sometimes
            # combined with the score like "W 97-46")
            result_raw = tokens[4].strip().upper()
            row["result"] = result_raw[0] if result_raw else None

            # Score
            score_raw = tokens[5].strip()
            # Handle case where result and score might be merged ("W 97-46")
            if row["result"] is None and re.match(r"^[WL]\s+\d", result_raw):
                row["result"] = result_raw[0]
                score_raw = result_raw[2:].strip()

            row["score"] = score_raw
            try:
                team_score, opp_score = _parse_score(score_raw)
                row["team_score"] = team_score
                row["opp_score"] = opp_score
            except ValueError:
                logger.warning(
                    "Line %d: cannot parse score %r", line_no, score_raw,
                )
                row["team_score"] = None
                row["opp_score"] = None

            # Remaining numeric fields
            extra_fields = [
                ("adj_oe", float),
                ("adj_de", float),
                ("possessions", float),
                ("opp_adj_em", float),
                ("opp_adj_em_rank", int),
                ("opp_adj_o", float),
                ("opp_adj_o_rank", int),
            ]
            for i, (col_name, col_type) in enumerate(extra_fields):
                token_idx = 6 + i
                if token_idx < len(tokens):
                    raw_val = tokens[token_idx]
                    if col_type is int:
                        row[col_name] = _safe_int(raw_val)
                    else:
                        row[col_name] = _safe_float(raw_val)
                else:
                    row[col_name] = None

        except Exception:
            logger.exception(
                "Failed to parse game log line %d: %s", line_no, line[:120],
            )
            continue

        rows.append(row)

    if not rows:
        logger.warning("No game log rows parsed for %s.", team)
        return pd.DataFrame(
            columns=["season", "scrape_date", "team"] + GAME_LOG_COLUMNS,
        )

    df = pd.DataFrame(rows)

    # Ensure all expected columns
    for col in GAME_LOG_COLUMNS:
        if col not in df.columns:
            df[col] = None

    df = df[GAME_LOG_COLUMNS]

    # Type coercion
    int_cols = ["game_num", "team_score", "opp_score"]
    int_cols += [c for c in df.columns if c.endswith("_rank")]
    for col in int_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")

    float_cols = ["adj_oe", "adj_de", "possessions", "opp_adj_em", "opp_adj_o"]
    for col in float_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").astype("float64")

    # Add metadata
    df.insert(0, "season", season)
    df.insert(1, "scrape_date", scrape_date)
    df.insert(2, "team", team)

    logger.info(
        "Parsed %d games for %s (season %d)", len(df), team, season,
    )
    return df


# ---------------------------------------------------------------------------
# Date helper for game logs
# ---------------------------------------------------------------------------

_MONTH_MAP = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4,
    "may": 5, "jun": 6, "jul": 7, "aug": 8,
    "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def _resolve_game_date(raw_date: str, season: int) -> str:
    """Convert a KenPom short date like ``"Nov 04"`` to ``YYYY-MM-DD``.

    The *season* parameter represents the spring year of the academic season
    (e.g. 2025 for the 2024-25 season).  Games in Nov/Dec belong to
    ``season - 1``; games Jan-Apr belong to ``season``.

    If parsing fails, the original string is returned unchanged.
    """
    raw_date = raw_date.strip()
    match = re.match(r"^([A-Za-z]+)\s+(\d{1,2})$", raw_date)
    if not match:
        # Try alternate format "11/04" or "11-04"
        match = re.match(r"^(\d{1,2})[/\-](\d{1,2})$", raw_date)
        if match:
            month = int(match.group(1))
            day = int(match.group(2))
        else:
            return raw_date
    else:
        month_str = match.group(1).lower()[:3]
        month = _MONTH_MAP.get(month_str)
        if month is None:
            return raw_date
        day = int(match.group(2))

    # Determine calendar year from month
    if month >= 8:  # Aug-Dec => previous calendar year
        year = season - 1
    else:  # Jan-Jul => season year
        year = season

    return f"{year:04d}-{month:02d}-{day:02d}"
