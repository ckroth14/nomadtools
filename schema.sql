-- nomadtools-lists D1 schema
-- Run with: wrangler d1 execute nomadtools-lists --file=schema.sql
-- (add --remote to run against the production database instead of local)

CREATE TABLE IF NOT EXISTS signups (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL,
  list            TEXT NOT NULL,          -- 'waitlist' | 'membership'
  source          TEXT,                   -- which page/button sent it
  referral_reason TEXT,                   -- "what brought you here" dropdown, nullable
  ip_country      TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(email, list)                     -- one email per list; re-submits are no-ops
);
