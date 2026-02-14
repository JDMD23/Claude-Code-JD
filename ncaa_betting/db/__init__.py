"""SQLite database layer for historical data storage."""

from .connection import DEFAULT_DB_PATH, get_connection, initialize_db
from .loader import upsert_dataframe, upsert_records
from .queries import (
    get_all_lines_for_date,
    get_matchup_data,
    get_pick_history,
    get_ratings_history,
    get_team_ats,
    get_team_four_factors,
    get_team_game_logs,
    get_team_ou,
    get_team_ratings,
)

__all__ = [
    "DEFAULT_DB_PATH",
    "get_connection",
    "initialize_db",
    "upsert_dataframe",
    "upsert_records",
    "get_all_lines_for_date",
    "get_matchup_data",
    "get_pick_history",
    "get_ratings_history",
    "get_team_ats",
    "get_team_four_factors",
    "get_team_game_logs",
    "get_team_ou",
    "get_team_ratings",
]
