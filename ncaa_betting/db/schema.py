"""DDL statements for the NCAA basketball betting analysis database.

Seven tables covering KenPom ratings, four-factors, game logs,
ATS/O-U records, Vegas lines, and pick history.
"""

KENPOM_RATINGS = """
CREATE TABLE IF NOT EXISTS kenpom_ratings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    scrape_date     TEXT    NOT NULL,
    season          INTEGER NOT NULL,
    team            TEXT    NOT NULL,
    conference      TEXT,
    record          TEXT,
    rank_overall    INTEGER,
    adj_em          REAL,
    adj_o           REAL,
    adj_o_rank      INTEGER,
    adj_d           REAL,
    adj_d_rank      INTEGER,
    adj_t           REAL,
    adj_t_rank      INTEGER,
    luck            REAL,
    luck_rank       INTEGER,
    sos_adj_em      REAL,
    sos_adj_em_rank INTEGER,
    sos_opp_o       REAL,
    sos_opp_o_rank  INTEGER,
    sos_opp_d       REAL,
    sos_opp_d_rank  INTEGER,
    ncsos_adj_em    REAL,
    ncsos_adj_em_rank INTEGER,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(scrape_date, season, team)
);
"""

KENPOM_FOUR_FACTORS = """
CREATE TABLE IF NOT EXISTS kenpom_four_factors (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    scrape_date     TEXT    NOT NULL,
    season          INTEGER NOT NULL,
    team            TEXT    NOT NULL,
    off_efg         REAL,
    off_efg_rank    INTEGER,
    off_to          REAL,
    off_to_rank     INTEGER,
    off_or          REAL,
    off_or_rank     INTEGER,
    off_ft_rate     REAL,
    off_ft_rate_rank INTEGER,
    def_efg         REAL,
    def_efg_rank    INTEGER,
    def_to          REAL,
    def_to_rank     INTEGER,
    def_or          REAL,
    def_or_rank     INTEGER,
    def_ft_rate     REAL,
    def_ft_rate_rank INTEGER,
    off_2p          REAL,
    off_2p_rank     INTEGER,
    off_3p          REAL,
    off_3p_rank     INTEGER,
    def_2p          REAL,
    def_2p_rank     INTEGER,
    def_3p          REAL,
    def_3p_rank     INTEGER,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(scrape_date, season, team)
);
"""

GAME_LOGS = """
CREATE TABLE IF NOT EXISTS game_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    scrape_date     TEXT    NOT NULL,
    season          INTEGER NOT NULL,
    team            TEXT    NOT NULL,
    game_date       TEXT    NOT NULL,
    opponent        TEXT    NOT NULL,
    location        TEXT    CHECK (location IN ('H', 'A', 'N')),
    result          TEXT    CHECK (result IN ('W', 'L')),
    team_score      INTEGER,
    opp_score       INTEGER,
    adj_oe          REAL,
    adj_de          REAL,
    possessions     REAL,
    efg             REAL,
    to_pct          REAL,
    or_pct          REAL,
    ftr             REAL,
    opp_efg         REAL,
    opp_to_pct      REAL,
    opp_or_pct      REAL,
    opp_ftr         REAL,
    opp_adj_oe_rank INTEGER,
    opp_adj_de_rank INTEGER,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(season, team, game_date, opponent)
);
"""

ATS_RECORDS = """
CREATE TABLE IF NOT EXISTS ats_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    scrape_date     TEXT    NOT NULL,
    season          INTEGER NOT NULL,
    team            TEXT    NOT NULL,
    game_date       TEXT    NOT NULL,
    location        TEXT,
    opponent        TEXT    NOT NULL,
    line            REAL,
    result          TEXT    CHECK (result IN ('W', 'L')),
    margin          REAL,
    ats_result      TEXT    CHECK (ats_result IN ('cover', 'push', 'miss')),
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(season, team, game_date, opponent)
);
"""

OU_RECORDS = """
CREATE TABLE IF NOT EXISTS ou_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    scrape_date     TEXT    NOT NULL,
    season          INTEGER NOT NULL,
    team            TEXT    NOT NULL,
    game_date       TEXT    NOT NULL,
    location        TEXT,
    opponent        TEXT    NOT NULL,
    total           REAL,
    combined_score  INTEGER,
    ou_result       TEXT    CHECK (ou_result IN ('over', 'under', 'push')),
    margin          REAL,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(season, team, game_date, opponent)
);
"""

VEGAS_LINES = """
CREATE TABLE IF NOT EXISTS vegas_lines (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    game_date       TEXT    NOT NULL,
    season          INTEGER NOT NULL,
    away_team       TEXT    NOT NULL,
    home_team       TEXT    NOT NULL,
    spread          REAL,
    total           REAL,
    away_ml         INTEGER,
    home_ml         INTEGER,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(game_date, away_team, home_team)
);
"""

PICK_HISTORY = """
CREATE TABLE IF NOT EXISTS pick_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_date   TEXT    NOT NULL,
    game_date       TEXT    NOT NULL,
    season          INTEGER NOT NULL,
    away_team       TEXT    NOT NULL,
    home_team       TEXT    NOT NULL,
    pick_type       TEXT    NOT NULL,
    pick_side       TEXT    NOT NULL,
    confidence      REAL,
    composite_score REAL,
    spread_at_pick  REAL,
    total_at_pick   REAL,
    result          TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(analysis_date, game_date, away_team, home_team, pick_type)
);
"""

# Indexes for common query patterns
INDEXES = """
CREATE INDEX IF NOT EXISTS idx_kenpom_ratings_team_season
    ON kenpom_ratings (team, season);
CREATE INDEX IF NOT EXISTS idx_kenpom_ratings_scrape_date
    ON kenpom_ratings (scrape_date);

CREATE INDEX IF NOT EXISTS idx_kenpom_ff_team_season
    ON kenpom_four_factors (team, season);
CREATE INDEX IF NOT EXISTS idx_kenpom_ff_scrape_date
    ON kenpom_four_factors (scrape_date);

CREATE INDEX IF NOT EXISTS idx_game_logs_team_season
    ON game_logs (team, season);
CREATE INDEX IF NOT EXISTS idx_game_logs_game_date
    ON game_logs (game_date);

CREATE INDEX IF NOT EXISTS idx_ats_team_season
    ON ats_records (team, season);
CREATE INDEX IF NOT EXISTS idx_ats_game_date
    ON ats_records (game_date);

CREATE INDEX IF NOT EXISTS idx_ou_team_season
    ON ou_records (team, season);
CREATE INDEX IF NOT EXISTS idx_ou_game_date
    ON ou_records (game_date);

CREATE INDEX IF NOT EXISTS idx_vegas_game_date
    ON vegas_lines (game_date);
CREATE INDEX IF NOT EXISTS idx_vegas_season
    ON vegas_lines (season);

CREATE INDEX IF NOT EXISTS idx_picks_analysis_date
    ON pick_history (analysis_date);
CREATE INDEX IF NOT EXISTS idx_picks_game_date
    ON pick_history (game_date);
CREATE INDEX IF NOT EXISTS idx_picks_season
    ON pick_history (season);
"""

ALL_TABLES = [
    KENPOM_RATINGS,
    KENPOM_FOUR_FACTORS,
    GAME_LOGS,
    ATS_RECORDS,
    OU_RECORDS,
    VEGAS_LINES,
    PICK_HISTORY,
]
