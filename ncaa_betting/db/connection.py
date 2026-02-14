"""SQLite connection manager for the NCAA betting database.

Provides a context-managed connection with WAL mode and foreign-key
enforcement, plus a one-call ``initialize_db`` helper that creates every
table and index defined in ``schema.py``.
"""

from __future__ import annotations

import logging
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

from .schema import ALL_TABLES, INDEXES

logger = logging.getLogger(__name__)

DEFAULT_DB_PATH: Path = Path(__file__).parent.parent / "data" / "ncaa_betting.db"


def _configure_connection(conn: sqlite3.Connection) -> None:
    """Apply runtime pragmas to *conn*."""
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA busy_timeout = 5000;")


@contextmanager
def get_connection(
    db_path: Path | str | None = None,
) -> Generator[sqlite3.Connection, None, None]:
    """Yield a configured :class:`sqlite3.Connection`.

    The connection uses WAL journal mode, enables foreign-key constraints,
    and sets a 5-second busy timeout suitable for concurrent readers/writers.

    On normal exit the transaction is committed; on exception it is rolled
    back.  The connection is always closed when the context exits.

    Parameters
    ----------
    db_path:
        Filesystem path for the SQLite file.  Falls back to
        ``DEFAULT_DB_PATH`` when *None*.
    """
    path = Path(db_path) if db_path is not None else DEFAULT_DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    try:
        _configure_connection(conn)
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def initialize_db(db_path: Path | str | None = None) -> None:
    """Create all tables and indexes if they do not already exist.

    Safe to call repeatedly -- every DDL statement uses
    ``CREATE … IF NOT EXISTS``.

    Parameters
    ----------
    db_path:
        Filesystem path for the SQLite file.  Falls back to
        ``DEFAULT_DB_PATH`` when *None*.
    """
    with get_connection(db_path) as conn:
        for ddl in ALL_TABLES:
            conn.execute(ddl)

        # INDEXES is a single string with multiple statements.
        for statement in INDEXES.strip().split(";"):
            statement = statement.strip()
            if statement:
                conn.execute(statement)

        logger.info("Database initialized at %s", db_path or DEFAULT_DB_PATH)
