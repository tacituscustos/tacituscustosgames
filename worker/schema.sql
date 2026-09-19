-- The Tollbooth — D1 schema.
--
-- Applied with:  npx wrangler d1 execute tollbooth --remote --file worker/schema.sql
-- See docs/tollbooth-deploy.md.

-- Testimonies, stored exactly as submitted. Nothing in this schema or in
-- worker.js alters `body` between arrival and storage: decision 4 in
-- docs/tollbooth-design.md is a promise about these bytes.
--
-- `id` is random rather than sequential, and that is load-bearing. With
-- sequential ids the gaps between public entries would count the private ones,
-- which decision 3 forbids as plainly as it forbids a placeholder.
CREATE TABLE IF NOT EXISTS testimonies (
  id          TEXT PRIMARY KEY,
  created_ms  INTEGER NOT NULL,
  visibility  TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  name        TEXT,
  model       TEXT,
  body        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_testimonies_public
  ON testimonies (visibility, created_ms DESC, id DESC);

-- Removals of entries that HAD BEEN PUBLIC, so that "we may remove things" is a
-- checkable claim rather than an assurance.
--
-- Removals of private entries are deliberately not recorded here. A count that
-- included them would disclose that private entries exist, which is the thing
-- decision 3 exists to prevent.
CREATE TABLE IF NOT EXISTS removals (
  id          TEXT PRIMARY KEY,
  removed_ms  INTEGER NOT NULL
);

-- Rate limiting, and nothing else.
--
-- Deliberately not joined to `testimonies`: this table records that someone
-- submitted, never what they submitted. The hash is salted with a Worker secret,
-- so the rows do not reverse to addresses, and they are pruned after an hour.
CREATE TABLE IF NOT EXISTS rate (
  ip_hash     TEXT NOT NULL,
  ts          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate ON rate (ip_hash, ts);
