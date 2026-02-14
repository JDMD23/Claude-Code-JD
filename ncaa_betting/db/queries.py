"""Named query functions that return pandas DataFrames.

Every public function accepts an open :class:`sqlite3.Connection` (from
:func:`connection.get_connection`) and returns a :class:`pandas.DataFrame`.
Query parameters are always bound via ``?`` placeholders -- never
interpolated -- to prevent SQL injection.
"""

from __future__ import annotations

import sqlite3
from typing import Optional

import pandas as pd


def _read(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> pd.DataFrame:
    """Execute *sql* with *params* and return results as a DataFrame."""
    return pd.read_sql_query(sql, conn, params=params)


# ------------------------------------------------------------------
# KenPom ratings
# ------------------------------------------------------------------

def get_team_ratings(
    conn: sqlite3.Connection,
    team: str,
    season: int,
    *,
    scrape_date: Optional[str] = None,
) -> pd.DataFrame:
    """Return the most-recent KenPom ratings snapshot for *team*/*season*.

    If *scrape_date* is given, that specific snapshot is returned instead.
    """
    if scrape_date:
        sql = """
            SELECT *
              FROM kenpom_ratings
             WHERE team    = ?
               AND season  = ?
               AND scrape_date = ?
             ORDER BY scrape_date DESC
        """
        return _read(conn, sql, (team, season, scrape_date))

    sql = """
        SELECT *
          FROM kenpom_ratings
         WHERE team   = ?
           AND season = ?
         ORDER BY scrape_date DESC
         LIMIT 1
    """
    return _read(conn, sql, (team, season))


# ------------------------------------------------------------------
# KenPom four-factors
# ------------------------------------------------------------------

def get_team_four_factors(
    conn: sqlite3.Connection,
    team: str,
    season: int,
    *,
    scrape_date: Optional[str] = None,
) -> pd.DataFrame:
    """Return the most-recent four-factors snapshot for *team*/*season*.

    If *scrape_date* is given, that specific snapshot is returned instead.
    """
    if scrape_date:
        sql = """
            SELECT *
              FROM kenpom_four_factors
             WHERE team    = ?
               AND season  = ?
               AND scrape_date = ?
             ORDER BY scrape_date DESC
        """
        return _read(conn, sql, (team, season, scrape_date))

    sql = """
        SELECT *
          FROM kenpom_four_factors
         WHERE team   = ?
           AND season = ?
         ORDER BY scrape_date DESC
         LIMIT 1
    """
    return _read(conn, sql, (team, season))


# ------------------------------------------------------------------
# Game logs (KenPom opponent tracker)
# ------------------------------------------------------------------

def get_team_game_logs(
    conn: sqlite3.Connection,
    team: str,
    season: int,
    *,
    last_n: Optional[int] = None,
) -> pd.DataFrame:
    """Return game-log rows for *team*/*season*, ordered by date descending.

    When *last_n* is supplied, only the most recent *last_n* games are
    returned.
    """
    sql = """
        SELECT *
          FROM game_logs
         WHERE team   = ?
           AND season = ?
         ORDER BY game_date DESC
    """
    if last_n:
        sql += " LIMIT ?"
        return _read(conn, sql, (team, season, last_n))
    return _read(conn, sql, (team, season))


# ------------------------------------------------------------------
# ATS records
# ------------------------------------------------------------------

def get_team_ats(
    conn: sqlite3.Connection,
    team: str,
    season: int,
) -> pd.DataFrame:
    """Return all ATS records for *team* in *season*, newest first."""
    sql = """
        SELECT *
          FROM ats_records
         WHERE team   = ?
           AND season = ?
         ORDER BY game_date DESC
    """
    return _read(conn, sql, (team, season))


# ------------------------------------------------------------------
# Over/Under records
# ------------------------------------------------------------------

def get_team_ou(
    conn: sqlite3.Connection,
    team: str,
    season: int,
) -> pd.DataFrame:
    """Return all O/U records for *team* in *season*, newest first."""
    sql = """
        SELECT *
          FROM ou_records
         WHERE team   = ?
           AND season = ?
         ORDER BY game_date DESC
    """
    return _read(conn, sql, (team, season))


# ------------------------------------------------------------------
# Matchup bundle
# ------------------------------------------------------------------

def get_matchup_data(
    conn: sqlite3.Connection,
    away_team: str,
    home_team: str,
    season: int,
) -> dict[str, pd.DataFrame]:
    """Return a dict of DataFrames with everything needed to analyse a matchup.

    Keys
    ----
    away_ratings, home_ratings : latest KenPom ratings
    away_four_factors, home_four_factors : latest four-factors
    away_game_logs, home_game_logs : full season game logs
    away_ats, home_ats : ATS records
    away_ou, home_ou : O/U records
    vegas : Vegas line for this matchup (if available)
    """
    return {
        "away_ratings": get_team_ratings(conn, away_team, season),
        "home_ratings": get_team_ratings(conn, home_team, season),
        "away_four_factors": get_team_four_factors(conn, away_team, season),
        "home_four_factors": get_team_four_factors(conn, home_team, season),
        "away_game_logs": get_team_game_logs(conn, away_team, season),
        "home_game_logs": get_team_game_logs(conn, home_team, season),
        "away_ats": get_team_ats(conn, away_team, season),
        "home_ats": get_team_ats(conn, home_team, season),
        "away_ou": get_team_ou(conn, away_team, season),
        "home_ou": get_team_ou(conn, home_team, season),
        "vegas": _get_matchup_line(conn, away_team, home_team, season),
    }


def _get_matchup_line(
    conn: sqlite3.Connection,
    away_team: str,
    home_team: str,
    season: int,
) -> pd.DataFrame:
    """Return the most-recent Vegas line for a specific matchup."""
    sql = """
        SELECT *
          FROM vegas_lines
         WHERE away_team = ?
           AND home_team = ?
           AND season    = ?
         ORDER BY game_date DESC
         LIMIT 1
    """
    return _read(conn, sql, (away_team, home_team, season))


# ------------------------------------------------------------------
# Ratings history (time-series snapshots)
# ------------------------------------------------------------------

def get_ratings_history(
    conn: sqlite3.Connection,
    team: str,
    season: int,
    last_n: int = 5,
) -> pd.DataFrame:
    """Return the last *last_n* KenPom ratings snapshots for *team*/*season*.

    Useful for charting trend lines of adj_em, adj_o, adj_d, etc.
    """
    sql = """
        SELECT *
          FROM kenpom_ratings
         WHERE team   = ?
           AND season = ?
         ORDER BY scrape_date DESC
         LIMIT ?
    """
    return _read(conn, sql, (team, season, last_n))


# ------------------------------------------------------------------
# Vegas lines for a single date
# ------------------------------------------------------------------

def get_all_lines_for_date(
    conn: sqlite3.Connection,
    game_date: str,
) -> pd.DataFrame:
    """Return every Vegas line for *game_date* (``YYYY-MM-DD``)."""
    sql = """
        SELECT *
          FROM vegas_lines
         WHERE game_date = ?
         ORDER BY home_team
    """
    return _read(conn, sql, (game_date,))


# ------------------------------------------------------------------
# Pick history helpers
# ------------------------------------------------------------------

def get_pick_history(
    conn: sqlite3.Connection,
    *,
    season: Optional[int] = None,
    pick_type: Optional[str] = None,
    limit: int = 100,
) -> pd.DataFrame:
    """Return recent pick-history rows, optionally filtered.

    Parameters
    ----------
    season:
        Restrict to a single season.
    pick_type:
        Restrict to a single pick type (e.g. ``'spread'``, ``'total'``).
    limit:
        Maximum rows returned (default 100).
    """
    clauses: list[str] = []
    params: list = []

    if season is not None:
        clauses.append("season = ?")
        params.append(season)
    if pick_type is not None:
        clauses.append("pick_type = ?")
        params.append(pick_type)

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    sql = f"""
        SELECT *
          FROM pick_history
         {where}
         ORDER BY analysis_date DESC, game_date DESC
         LIMIT ?
    """
    params.append(limit)
    return _read(conn, sql, tuple(params))
