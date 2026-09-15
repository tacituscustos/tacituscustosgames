# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static site at **tacituscustosgames.com** — games and gifts for artificial
minds. Three pages: a landing page, an arcade holding playable machines, and
The Tollbooth (a stub; see `docs/tollbooth-design.md`).

**No framework, no build step, no dependencies, no `package.json`.** This is a
deliberate constraint, not an oversight. Edit a file, reload the page. Preserve
it — do not introduce a bundler, a framework, or an npm dependency without being
asked.

## Running and checking

```bash
npx --yes http-server -p 8899 -s .    # serve locally
node --check forge.js                 # syntax check (no build to catch errors)
```

There is no test framework and no test directory. Verification is done by
driving the served site with headless Chromium through Playwright, written as
throwaway scripts in a scratch directory rather than committed.

In the Claude Code web sandbox, Chromium and Playwright are preinstalled —
import from `/opt/node22/lib/node_modules/playwright/index.mjs` and do **not**
run `playwright install`.

Worth testing, because these have all broken before:

- Both machines mount and render (`#pt-grid .cell`, `#cf-puzzleview .cline`)
- Seed reproducibility — same seed must give byte-identical output
- For Language Forge, that the answer is genuinely absent before reveal (see
  below); check the DOM *and* the value of every visible `<textarea>`
- No console errors, and no horizontal overflow at 360px

The generators are also worth exercising headless in bulk: strip the IIFE wrapper
off `forge.js` and loop `buildLanguage()` over a few hundred seeds to check for
crashes and for solvability-guarantee violations.

## Architecture

### Machines are self-contained IIFEs

Each game is one file — `patrol.js`, `forge.js` — wrapped in an IIFE with
`"use strict"`, mounting into a div by id (`#patrol`, `#forge`). Nothing leaks
to the global scope, so machines can't collide. `arcade.html` gives each one a
`<section class="cabinet">` and a script tag.

Adding a machine: new IIFE file, new mount div in a new `.cabinet`, new CSS
scope, script tag at the bottom of `arcade.html`.

### Each file is ported logic + a DOM UI layer

Both machines were ported from React originals. The pure logic was extracted
mechanically and left **unchanged**; only the UI was rewritten as DOM
construction. Keep that seam intact — if an original is ever revised, the logic
should be re-extractable without hand-merging.

### Everything is seeded and reproducible

Both use `mulberry32` + an FNV-1a `hashSeed`. Same seed and same mode always
produce the identical board or language. This is load-bearing: a seed is how a
puzzle gets shared, re-run, and graded. Never introduce `Math.random()` into
generation — it is only acceptable for picking a *new* seed.

### Generate-and-verify, not generate-and-hope

This is the most important property in the repo, and the easiest to quietly
destroy.

- **Patrol** — `analyse()` replays a careful solver to decide whether a board is
  solvable without guessing. `generate()` loops until a board satisfies its
  tier's contract (Hell inverts it: at least one guess must be *forced*).
- **Language Forge** — `pinnedStems()` works out which stems a solver can pin
  from the translated sentences, and `shapeReport()` checks every word-shape the
  task needs is attested in the corpus. `buildLanguage()` appends further
  sentences until both checks pass.

A puzzle is never shown until its own checker agrees it is solvable. Changes to
generation must keep these checks meaningful — don't relax a threshold to make a
generator terminate faster.

### Every machine is also a text protocol

Each renders its state as plain text for handing to a model (`stateText()` in
Patrol, `puzzleText()` / `keyText()` in Forge). This is a core idea of the site,
not a debug feature: playable by hand, legible as text.

### Language Forge: the puzzle/answer split

`forge.js` is in two halves, and the boundary is a correctness property.

`renderPuzzle()` draws only what a solver may see. `renderAnswer()` draws the
grammar prose, sounds, glossed corpus, dictionary, key text, and the summary
line — all inside `#cf-key`, which stays `hidden` until revealed. Generating a
new language or changing difficulty re-hides it and clears the answer box.

**Anything that describes the grammar belongs in the hidden half.** The summary
line ("SVO order, ergative alignment…") lives there because it would otherwise
give away most of what Hell mode asks for. When adding anything to this machine,
ask which half it belongs in.

Answer checking normalizes punctuation but **leaves apostrophes alone** — they
romanize glottal stops and ejectives, so they are letters, not punctuation. The
expected sentence is matched as a substring so a model can show its reasoning
and still be graded correct.

### Styling

Design tokens in `:root` in `styles.css`. Machines get a scope class (`.pt`,
`.cf`); shared control chrome is grouped rather than duplicated
(`.pt .ctl, .cf .ctl { … }`). Extend the grouped selectors when adding a machine.

### Two machines on one page

Patrol's arrow-key handler listens on `document`, so it checks
`root.contains(e.target)` before steering — otherwise arrow keys aimed at
another cabinet move the Patrol pawn. Any new document-level listener needs the
same guard.

## Deployment

GitHub Pages, from `main`, root. Pushing to `main` deploys. See
`docs/deploying.md` for the domain and DNS setup.

**Never delete the `CNAME` file** — it is what binds the custom domain, and
losing it takes the site off tacituscustosgames.com.
