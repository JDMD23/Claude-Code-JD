"""DataFrame-to-SQLite loader with INSERT OR REPLACE upsert semantics.

The main entry point is :func:`upsert_dataframe`, which maps a
:class:`pandas.DataFrame` into the target table using ``INSERT OR REPLACE``.
Rows whose UNIQUE-constraint columns match an existing row will overwrite
that row; all others are inserted as new records.
"""

from __future__ import annotations

import logging
import sqlite3
from typing import Sequence

import pandas as pd

logger = logging.getLogger(__name__)

# Columns managed by the database itself -- never supplied by callers.
_AUTO_COLUMNS = frozenset({"id", "created_at"})


def _build_upsert_sql(table: str, columns: Sequence[str]) -> str:
    """Return an ``INSERT OR REPLACE`` statement for *table*."""
    col_list = ", ".join(columns)
    placeholders = ", ".join(["?"] * len(columns))
    return f"INSERT OR REPLACE INTO {table} ({col_list}) VALUES ({placeholders})"


def upsert_dataframe(
    conn: sqlite3.Connection,
    df: pd.DataFrame,
    table: str,
    *,
    columns: Sequence[str] | None = None,
    chunk_size: int = 500,
) -> int:
    """Write *df* into *table* using ``INSERT OR REPLACE``.

    Parameters
    ----------
    conn:
        An open :class:`sqlite3.Connection` (typically from
        :func:`connection.get_connection`).
    df:
        Source data.  Column names must match the target table columns
        (excluding auto-managed columns like ``id`` and ``created_at``).
    table:
        Target table name (must already exist).
    columns:
        Explicit column list to use.  When *None*, the DataFrame's own
        column names are used after dropping any auto-managed columns.
    chunk_size:
        Number of rows per ``executemany`` batch.  Larger values reduce
        round-trips at the cost of memory.

    Returns
    -------
    int
        Total number of rows written (inserted or replaced).
    """
    if df.empty:
        logger.debug("Empty DataFrame -- nothing to upsert into %s", table)
        return 0

    if columns is None:
        columns = [c for c in df.columns if c not in _AUTO_COLUMNS]

    # Ensure the DataFrame only contains the columns we plan to insert.
    missing = set(columns) - set(df.columns)
    if missing:
        raise ValueError(
            f"DataFrame is missing columns required for {table}: {sorted(missing)}"
        )

    sql = _build_upsert_sql(table, columns)
    data = df[columns].values.tolist()

    total = 0
    for start in range(0, len(data), chunk_size):
        chunk = data[start : start + chunk_size]
        conn.executemany(sql, chunk)
        total += len(chunk)

    logger.info("Upserted %d rows into %s", total, table)
    return total


def upsert_records(
    conn: sqlite3.Connection,
    records: list[dict],
    table: str,
    *,
    columns: Sequence[str] | None = None,
) -> int:
    """Convenience wrapper: upsert a list of dicts via a temporary DataFrame.

    Parameters
    ----------
    conn:
        An open :class:`sqlite3.Connection`.
    records:
        Each dict maps column names to values.
    table:
        Target table name.
    columns:
        Optional explicit column list (same semantics as
        :func:`upsert_dataframe`).

    Returns
    -------
    int
        Total number of rows written.
    """
    if not records:
        return 0
    df = pd.DataFrame(records)
    return upsert_dataframe(conn, df, table, columns=columns)
