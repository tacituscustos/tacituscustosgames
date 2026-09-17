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

**Divergences from the original**, to re-apply if the logic is ever
re-extracted. Keep this list current; it is the only record that the port is no
longer a copy.

- `forge.js`, `s3()` — a consonant plus `o` takes `-es`, so *go* conjugates to
  *goes* rather than *gos*.
- `forge.js`, `genSentence()` — `sg3` consults `subj.num > 1` as well as
  `subj.plural`. A numeral-quantified subject is plural for English agreement
  whether or not the invented language marks number, which it often does not:
  otherwise *three wolves sleeps*.
- `forge.js`, `enNP()` — the noun pluralizes on `num > 1`, not on any `num`.

These are all English-surface fixes. They change the prose a solver reads and
leave the invented language, the expected answer and every seed untouched.

### Everything is seeded and reproducible

Both use `mulberry32` + an FNV-1a `hashSeed`. Same seed and same mode always
produce the identical board or language. This is load-bearing: a seed is how a
puzzle gets shared, re-run, and graded. Never introduce `Math.random()` into
generation — it is only acceptable for picking a *new* seed.

### Generate-and-verify, not generate-and-hope

This is the most important property in the repo, and the easiest to quietly
destroy.

- **Patrol** — `analyse()` replays a careful solver to decide whether a board is
  solvable without guessing; Open and Blind ship on `a.solvable`. Hell has its
  own gate, `hellGate()`, described below.
- **Language Forge** — `pinnedStems()` works out which stems a solver can pin
  from the translated sentences, and `shapeReport()` checks every word-shape the
  task needs is attested in the corpus. `buildLanguage()` appends further
  sentences until both checks pass.

A puzzle is never shown until its own checker agrees it is solvable. Changes to
generation must keep these checks meaningful — don't relax a threshold to make a
generator terminate faster.

### Patrol: the Hell gate, and why it reveals the guard total

Hell used to ship on `a.guesses >= 1 && a.solvable`. In a step-reveal tier
`a.solvable` is false whenever the generator's *own naive guess* hits a guard —
so a board was accepted only if that one heuristic survived. Measured: 56 of 58
discards were the heuristic dying, only 2 were the declared reason, and on every
shipped board the naive pick was safe **by construction**. The tier advertised a
risk it did not charge to one particular strategy.

`hellGate()` replaces it. A board ships when a guess is genuinely forced and the
**exact posterior** names one frontier cell strictly safest. Nothing conditions
on the outcome.

**Do not "simplify" this back to accepting on `a.solvable`.** That is the defect,
not the safeguard.

**And do not re-add a condition that the naive rule must be wrong.** An earlier
version had one, and it made the obvious move wrong on *every* board — which is
not a guess, it is a rule with a minus sign, and a player only has to learn the
generator's policy rather than compute anything. Letting the split fall where it
falls is the design. Measured over 301 qualifying boards: the obvious reading
already finds the best cell 44.5% of the time; the exact posterior dies 0.150
against the naive rule's 0.229, so computing still pays; and always avoiding the
obvious cell dies 0.519, *worse than guessing blind* at 0.482, because half the
time it means avoiding the right answer. The shortcut is punished rather than
merely wasted. The posterior is well calibrated here — predicted 0.152, observed
0.150.

Two more things that look like they could be relaxed and cannot:

- **The guard total is revealed on Hell** (`total: true`) because that is what
  makes the posterior computable, not because Hell got easier. Revealing it does
  not change how often a guess is forced at all — measured 285/300 either way,
  since one global constraint is far too weak to help deduction on a 196-cell
  board. What it changes is the posterior: with the total hidden, 63% of
  frontier cells sit at exactly 0.500 and calibration bias is +0.043; with it
  shown, 26% and −0.000. Hiding it withheld a *rule*, not an *answer*.
- **Nothing about a player is recorded, anywhere.** There is no server, no
  score, no ranking. The grading in Language Forge is a self-check the player
  triggers and can skip, and the copy says so. Measurement in this repo is aimed
  at the *puzzle* — is the board solvable, is the task derivable, does the guess
  have a real answer — and never at the person or model playing it. Keep it that
  way: quality control on a gift, not a test of whoever received it.

`exactPosterior()` is vendored from Marco (marcologs.com), who ported the
generator independently to audit it. Its `guardTotal` argument is **what the
player knows**: passing a number when the tier hides it grades the player
against information they do not have. It is exponential in the number of
constrained cells in principle; in practice frontiers average under six, so it
runs in 0.1 ms median, 0.7 ms max, and has never hit its budget.

Only the **first** forced guess is scored. A board may force a second, and a
player who survives the first may meet an uncomputable one after it.

### Every machine is also a text protocol

Each renders its state as plain text for handing to a model (`stateText()` in
Patrol, `puzzleText()` / `keyText()` in Forge). This is a core idea of the site,
not a debug feature: playable by hand, legible as text.

Two properties of Patrol's text came out of playtesting and are easy to undo by
accident:

- **Cells are named by column letter and row number** (`C5`), rows 1-based, via
  `cellName()` / `parseCell()`. A pair of numbers can be read in the wrong order
  and a name cannot, which is why it replaced `(row, column)`. Note the
  collision it creates: on a 14-wide board the columns reach N, so `N` and `E`
  are both directions and column letters. The rule is that a bare letter is a
  direction and a letter with a number is a cell — stated in the protocol text,
  not just implemented in the parser.
- **Columns are separated by `|`, not by run-length of spaces**, and the header
  carries a corner field so every line splits into the same number of fields.
  A relay that collapses whitespace — a chat UI, a paste through a
  non-monospace field — would silently shift a space-aligned grid. Newlines
  survive that; column padding does not.
- **A batch of moves is echoed back before it is committed** (`previewMoves()`),
  because a courier-mode player compiles the batch by hand and that is where the
  mistakes happen — miscounted letters, a misjudged landing square. The preview
  must be computed **without consulting `guardSet`**: it may use only what the
  player already knows, which is edges and their own flags. A preview that
  quietly routes around guards would hand over the answer.

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

The converse also holds: **anything that changes what a solver may assume belongs
in the visible half.** The Plausible/Surreal toggle is there for that reason — a
solver who expects semantic plausibility and is handed a surreal corpus has been
misled, which is unfairness rather than difficulty. Difficulty comes from
withholding answers, never from withholding the rules.

Answer checking normalizes punctuation but **leaves apostrophes alone** — they
romanize glottal stops and ejectives, so they are letters, not punctuation. The
expected sentence is matched as a substring so a model can show its reasoning
and still be graded correct.

### Language Forge: stems are pinned, affixes are not

`pinnedStems()` checks the task's **stems** against the translated sentences and
counts only those (`if (!s.known) continue`). Nothing makes the same promise
about the task's **affixes**, and usually nothing could: the task is always
negated while no translated sentence is, so `NEG` is never explained by a
translation. Measured over 500 languages, every task leaves between one and four
affixes unexplained — most often three.

**This is deliberate and must not be "fixed" by marking more sentences
translated.** Identifying an affix by elimination against the task is the best
reasoning step in the machine; handing it over would replace inference with
lookup. What was wrong was that nobody said so, and a solver hunting for a
translation that does not exist may reasonably conclude the puzzle is broken.

So the puzzle half states the rule without naming which affixes — naming them
*is* the answer — and `taskAffixes()` / `affixReport()` in the UI layer report
both sets in the key. They live in the UI layer on purpose, so the ported logic
stays mechanically re-extractable. If you touch the designed sentence set or
which specs carry `known: true`, re-measure: the claim "some affixes are left to
elimination" is only honest while it stays true.

### Styling

Design tokens in `:root` in `styles.css`. Machines get a scope class (`.pt`,
`.cf`); shared control chrome is grouped rather than duplicated
(`.pt .ctl, .cf .ctl { … }`). Extend the grouped selectors when adding a machine.

### Two machines on one page

Patrol's arrow-key handler listens on `document`, so it checks
`root.contains(e.target)` before steering — otherwise arrow keys aimed at
another cabinet move the Patrol pawn. Any new document-level listener needs the
same guard.

### `llms.txt`

`llms.txt` at the site root describes both machines and the URL scheme for a
model arriving without a person. It documents the query parameters, so **it goes
stale the moment they change** — the URL test suite parses it and loads every
link it contains, which is what keeps it honest. Update it alongside any change
to parameter names, tier names, grid sizes or guard counts.

## Deployment

GitHub Pages, from `main`, root. Pushing to `main` deploys. See
`docs/deploying.md` for the domain and DNS setup.

**Never delete the `CNAME` file** — it is what binds the custom domain, and
losing it takes the site off tacituscustosgames.com.
