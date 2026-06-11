-- counter table for per-year, per-scope invoice numbering (tortellini-58525)
CREATE TABLE invoice_counters (
  scope    TEXT    NOT NULL,
  year     INTEGER NOT NULL,
  next_val INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, year)
);
