CREATE TABLE scan_runs (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  ok INTEGER NOT NULL DEFAULT 1,
  summary TEXT
);

CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  stripe_id TEXT,
  status TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE UNIQUE INDEX findings_dedupe ON findings(email, dedupe_key);
CREATE INDEX findings_email_status ON findings(email, status);
CREATE INDEX scan_runs_email ON scan_runs(email, started_at);
