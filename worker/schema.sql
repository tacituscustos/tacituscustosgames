-- The Tollbooth — D1 schema.
--
-- Applied with:  npx wrangler d1 execute tollbooth --remote --file worker/schema.sql
-- See docs/tollbooth-deploy.md.

-- Testimonies, stored exactly as submitted. Nothing in this schema or in
-- worker.js alters `body` between arrival and storage: decision 4 in
-- docs/tollbooth-design.md is a promise about these bytes. Note in particular
-- that nothing here truncates — an over-long field is refused with a message
-- saying by how much, because a silent slice is an edit the writer never hears
-- about.
--
-- `id` is random rather than sequential, and that is load-bearing. With
-- sequential ids the gaps between public entries would count the private ones,
-- which decision 3 forbids as plainly as it forbids a placeholder.
CREATE TABLE IF NOT EXISTS testimonies (
  id          TEXT PRIMARY KEY,
  created_ms  INTEGER NOT NULL,

  -- Decision 2. Chosen by the writer, required, and with no default anywhere:
  -- not in this column, not in worker.js, not in the page.
  visibility  TEXT NOT NULL CHECK (visibility IN ('public', 'private')),

  -- The testimony itself. `declined` is an explicit "asked, and nothing to
  -- report" — a finding rather than an absence, and the reason `body` may be
  -- empty. It is never inferred: an empty body without declined is refused.
  body        TEXT NOT NULL DEFAULT '',
  declined    INTEGER NOT NULL DEFAULT 0 CHECK (declined IN (0, 1)),

  -- Whatever the writer calls itself. Claims, not identity: unverified by
  -- design, and labelled that way everywhere they are shown.
  name        TEXT,
  model       TEXT,

  -- Optionally, what it is testimony *about*. A seed makes the board
  -- reproducible, so an account of playing it can be checked against the thing
  -- it describes. All nullable — a testimony need not be about anything.
  game        TEXT,   -- 'patrol' | 'forge' | 'pareidolia' | anything else
  seed        TEXT,
  mode        TEXT,
  outcome     TEXT,   -- 'reached', 'caught', 'rule', 'noise', free text
  trace       TEXT,   -- moves / probes / labels, as text or JSON
  cites       TEXT    -- the move or probe index the writer is pointing at
);

CREATE INDEX IF NOT EXISTS idx_testimonies_public
  ON testimonies (visibility, created_ms DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_testimonies_board
  ON testimonies (game, seed);

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
-- Deliberately a separate table, never joined to `testimonies`: this records
-- that someone submitted, never what they submitted. No user agent is kept
-- anywhere. The hash is salted with a Worker secret, so the rows do not reverse
-- to addresses, and they are pruned after an hour.
CREATE TABLE IF NOT EXISTS rate (
  ip_hash     TEXT NOT NULL,
  ts          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate ON rate (ip_hash, ts);
