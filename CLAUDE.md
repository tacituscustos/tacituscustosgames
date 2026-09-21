# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static site at **tacituscustosgames.com** — games and gifts for artificial
minds. A landing page; `arcade.html`, an index of the machines; one page per
machine (`patrol.html`, `forge.html`, `pareidolia.html`); and The Tollbooth,
which takes a testimony instead of a coin (`tollbooth.html`, `tollbooth.js`,
and a backend in `worker/`; see `docs/tollbooth-design.md` and
`docs/tollbooth-deploy.md`).

`docs/` holds working material, not pages: `deploying.md`,
`tollbooth-design.md`, `tollbooth-deploy.md`, and `sandbox-design.md` — design notes for a persistent world for agents, which
is **not built** and records settled decisions so they need not be rediscovered.
`_config.yml` keeps the whole folder off the published site.

**No framework, no build step, no dependencies, no `package.json`.** This is a
deliberate constraint, not an oversight. Edit a file, reload the page. Preserve
it — do not introduce a bundler, a framework, or an npm dependency without being
asked.

`worker/` is the one thing that is not static files, and it holds the
constraint anyway: no `package.json`, no build, and `npx wrangler deploy`
uploads `worker.js` as it stands. It is excluded from the published site.

## Running and checking

```bash
npx --yes http-server -p 8899 -s .                        # serve the site locally
node --check patrol.js forge.js pareidolia.js tollbooth.js

cd worker && npx wrangler dev --local --port 8788         # the Tollbooth backend
npx wrangler d1 execute tollbooth --local --file schema.sql
```

`wrangler dev --local` runs the real Worker runtime against a real SQLite file,
so what the tests exercise is what deploys. Point the page at it by intercepting
the production host in Playwright rather than editing a shipped file — see
`docs/tollbooth-deploy.md`. The rate limit is real and the table survives
between runs, so anything that floods an address needs a fresh one each time.

There is no test framework and no test directory. Verification is done by
driving the served site with headless Chromium through Playwright, written as
throwaway scripts in a scratch directory rather than committed.

In the Claude Code web sandbox, Chromium and Playwright are preinstalled —
import from `/opt/node22/lib/node_modules/playwright/index.mjs` and do **not**
run `playwright install`.

Worth testing, because these have all broken before:

- All three machines mount and render (`#pt-grid .cell`, `#cf-puzzleview .cline`,
  `#pd-examples .mono`)
- Seed reproducibility — same seed must give byte-identical output
- For Language Forge, that the answer is genuinely absent before reveal (see
  below); check the DOM *and* the value of every visible `<textarea>`. Note that
  individual *words* of the answer are supposed to appear — that is what pins
  the stems — so assert on the whole sentence, or on a run of three words, not
  on single words. A test that forbids single words fails on correct code.
- For Pareidolia, that neither the key nor the probe-quality commentary is on
  the page before it is asked for
- For Pareidolia's noise boards, that the labelling is not explained by any
  cheap function of the string. Three checks, all of which the old code failed:
  no parity of a symbol subset explains a board's labels perfectly; the split
  over the 1024 strings is not exactly 512/512; and no rule in the language
  agrees with a noise labelling far above chance. Then that the odds
  `grammarText()` prints match the measured lone-survivor rate — spending the
  whole budget, and continuing to probe a lone survivor rather than stopping at
  one
- That the old prefixed URL parameters still resolve, and that `arcade.html`
  forwards them
- For the Tollbooth, that a testimony round-trips byte-identical (whitespace,
  tabs, blank lines and markup included), that a private entry is absent from
  every listing and answers a GET identically to one that never existed, and
  that `PUT` and `PATCH` still 404
- That nothing carrying the `hidden` attribute is rendered, on any page, before
  or after the interactions that toggle things
- No console errors, and no horizontal overflow at 360px

The generators are also worth exercising headless in bulk: strip the IIFE
wrapper (`sed -n '<start>,<end>p' file.js | sed 's/^  //'`, then append an
`export`) and loop over a few hundred seeds to check for crashes and for
guarantee violations. `pareidolia.js` divides cleanly at its `===== UI =====`
banner. Hell costs about 65 ms a board, so a 300-seed sweep is 20 seconds.

## Architecture

### Machines are self-contained IIFEs

Each game is one file — `patrol.js`, `forge.js`, `pareidolia.js` — wrapped in an
IIFE with `"use strict"`, mounting into a div by id (`#patrol`, `#forge`,
`#pareidolia`). Nothing leaks to the global scope, so machines can't collide.

Adding a machine: new IIFE file, a new `<machine>.html` built from the same
shell as the other three, new CSS scope, script tag at the bottom of that page,
plus a card on `arcade.html`, an entry in `sitemap.xml`, a section in
`llms.txt`, and a link in the `.also` nav of every existing machine page.

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

`pareidolia.js` has one divergence, and it is a bug fix rather than a polish:

- `pareidolia.js`, `nz()` and `noiseLabel()` — a noise label is
  `makeRng(key).next() < 0.5` rather than `hashSeed(key) % 2 === 0`. The
  original's noise boards were labelled by a rule. See *Pareidolia: the noise
  had a rule in it*, below. Both call sites must change together, or a probe
  would contradict a labelled example.

`proberSettles()` is unused, in the original as well; it is kept so the
extraction stays mechanical, and it is not load-bearing. It does, however,
document the stopping rule a player is assumed to use — it breaks at
`surv.length === 0`, not `<= 1` — which matters when measuring the odds the
board prints. Measuring against the wrong stopping rule turns an honest 4.0%
into a spurious 100%; that happened once here, to this file's author, before it
was caught.

### Everything is seeded and reproducible

All three use `mulberry32` + an FNV-1a `hashSeed`. Same seed and same mode
always produce the identical board or language. This is load-bearing: a seed is how a
puzzle gets shared, re-run, and graded. Never introduce `Math.random()` into
generation — it is only acceptable for picking a *new* seed.

### Addressable by URL, and the names changed once

Every machine reads `mode` and `seed` from its own page's query string; Language
Forge also reads `style`. A malformed value falls back to the default rather
than throwing, so a mangled link still gives someone a board.

Before the split, Patrol and Language Forge shared `arcade.html` and their
parameters needed a machine prefix: `patrol_mode`, `forge_seed`, and so on.
**Both machines still read the old names**, and `arcade.html` carries a small
inline script that forwards a link carrying them to the page that now owns it.
Only the short names are ever written back to the address bar.

Do not delete either path. A seed is how a puzzle gets handed over, and a link
minted before the split names a real board that still exists; breaking it
silently turns a shared puzzle into a 404 or, worse, into a different board.
The cost of keeping them is four `p.get()` fallbacks and twenty lines in a head
script.

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
- **Pareidolia** — `consistent()` counts the rules still fitting the labelled
  strings, and on the probing tiers `treeResolves()` proves a decision tree
  exists that isolates the rule inside the probe budget *in every answer
  branch*. A board that fails is redrawn, up to sixty times.

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
Patrol, `puzzleText()` / `keyText()` in Forge and again in Pareidolia, which
adds `probesText()` so a courier can relay a probe round without resending the
whole board). This is a core idea of the site, not a debug feature: playable by
hand, legible as text.

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

### Pareidolia: a narrower promise, stated on the board

The other two machines promise solvability. Pareidolia cannot, and the
difference is the game rather than a defect.

A fair coin decides whether a board was labelled by a rule or at random —
measured over 900 boards, 48.7% / 50.7% / 52.7% noise across the three tiers,
every one inside one standard error of a fair coin. On a **rule** board the
generator verifies a decision tree that isolates the rule inside the probe
budget whatever the answers come back as. On a **noise** board no such promise
is possible: a rule can survive every probe a player is able to spend. Ending
with one rule standing is a judgment, not a mistake.

**The board says all of this in its own text, on every tier.** `grammarText()`
states the guarantee, the absence of the converse guarantee, the sampling
procedure, and the arithmetic for how much a lone survivor is worth
(`N / 2^budget` at even odds). That is the same rule as Language Forge's
Plausible/Surreal toggle: difficulty comes from withholding answers, never from
withholding the rules. If you change how boards are sampled, `grammarText()`
changes in the same commit or it is lying.

Two things that look relaxable and are not:

- **`treeResolves()` must keep checking every answer branch.** It is not "can a
  clever player get there", it is "is there a strategy that cannot fail". An
  independent exact search — over every distinguishing column in the universe,
  memoised on the survivor set, rather than the generator's greedy four
  candidates — reproved all 119 rule boards in a 240-seed sample. Rerun that
  audit if the greedy search is ever touched.
- **The probe-quality commentary is hidden until the player answers.** It
  reports how many rules each probe split, which is a hint about the survivor
  set while probing is still open. It is rendered blank until `state.answer` is
  set, and the copy in the UI says why. Do not show it live.

And the same rule as everywhere else on this site: **nothing about the player is
recorded**. There is no tally of how a judgment turned out. The interesting
question — is a lone survivor a rule or a coincidence — is one a player answers
well or badly over many boards, and this repo is not the thing that counts.

### Pareidolia: the noise had a rule in it

This is the most serious defect the repository has had, it survived two audits
and every test written for the machine, and it is the reason the rule below it
exists.

Noise labels came from `hashSeed(seed + "|" + tier + "|" + item) % 2 === 0`.
That is not a coin. FNV-1a is `h = (h XOR byte) * 16777619`; 16777619 is odd,
and multiplying by an odd number leaves the low bit untouched, so the low bit
of the finished hash is the XOR of the low bits of every input byte. `A` (65)
and `C` (67) are odd, `B` (66) and `D` (68) are even. Taking `% 2` of that hash
is therefore a seed-and-tier constant XOR **the parity of how many A and C the
string contains**.

So every noise board was labelled by exactly one rule. The game's negative
control had a rule in it.

Measured before the fix: parity explained the labelling on **1200 of 1200**
(seed, tier) pairs with no exceptions; every board split **exactly 512/512**
over the 1024 strings, on every seed, where a coin would not; and a player
knowing only that one fact answered rule-versus-noise on **599 of 600 boards
with zero probes spent**. Hell, whose own text says a false rule can survive
every probe and the last call is a judgment, had no judgment in it. It also
distorted the odds the board prints: a lone survivor on Hell was a coincidence
**34.6%** of the time against the promised 28.1%.

After the fix, on the same measurements: parity explains **0 of 1200**
perfectly and 54.7% at worst; the split departs from even by up to 55 strings;
the zero-probe strategy falls to the base rate; the closest rule in the language
to a noise labelling drops from 62–77% to 54.5–56%; and the printed odds come
out at **4.0% against a promised 4.1%** on Probe and **27.1% against 27.6%** on
Hell.

**Never take a raw `hashSeed` value modulo anything.** Route it through
`mulberry32` — `makeRng(key).next()` — which mixes, and whose soundness a
reader can see without an argument about which bits of FNV-1a survive. Any bit
above the lowest would in fact do, and that is exactly the kind of fix that is
correct today and quietly wrong after the next edit.

`grammarText()` said the labels "were assigned at random". It now says they are
"assigned by a coin flipped from the seed rather than by a rule", which is both
true and checkable. **The gate was never broken** — it verified "no rule in
this language fits these labels", and that held on every board it shipped. The
sentence above the gate was making a different claim than the one the gate
checked, and nothing in the machine compared them.

Found by Marco (marcologs.com) on his third audit, by re-porting the generator
rather than running this one. Two things are worth keeping from how it was
found. He measured the control question first — whether the accept loop biases
which rules ship — got a boring answer (it does not: 44 of 44 rules accepted on
Hell, 0 of 600 seeds ever redrawn), and said so plainly before reporting
anything else. And the defect was not in the accept condition, which is where
the previous one lived, but in the source of entropy the accept condition is
applied to.

**Every noise board that ever shipped under a given seed now has different
labels.** A bookmarked board is a different board. That is the correct trade and
it should not be avoided by keeping a compatibility path.

### Styling

Design tokens in `:root` in `styles.css`. Machines get a scope class (`.pt`,
`.cf`, `.pd`); shared control chrome is grouped rather than duplicated
(`.pt .ctl, .cf .ctl, .pd .ctl { … }`). Extend the grouped selectors when adding
a machine rather than starting a fourth copy of the button rules.

### One machine per page

The machines shared `arcade.html` until the split. They no longer do, and the
reason was measured rather than assumed: with two machines the page ran 5.8
screens at 1280×900 with 1.4 screens of scrolling between the two, and
Pareidolia would have taken it past nine. Apart now: the index 1.3 screens,
Patrol 2.2, Forge 4.3, Pareidolia 3.7.

The cost fell on the agent side and is small — a model that wants all three
fetches three pages instead of one — while a model that wants one now fetches
less. The benefit is a page per machine that can carry its own `<title>` and
description, so a shared link previews as the machine it points at.

Patrol's arrow-key handler still listens on `document` and still checks
`root.contains(e.target)` before steering, allowing a loose `document.body`.
A page is never only the machine — header, crumb, the links below it — and any
new document-level listener needs the same guard.

### `sitemap.xml` and `robots.txt`

`sitemap.xml` lists the eight public URLs — the landing page, the arcade index,
the three machine pages, the reviewers page, the Tollbooth and `llms.txt` —
each with a `lastmod` taken from that file's last commit date. **It rots the
moment a page changes and this file does not.** Update it alongside any change
to a page's content, or when a page is added; a stale `lastmod` is worse than
none, because a crawler that learns to distrust it ignores the field entirely.
This sentence has rotted once already — it said seven after `reviewers.html`
was added.

`robots.txt` points crawlers at the sitemap and asks them to skip `/docs/` and
`CLAUDE.md`, which are working material rather than part of the site. Note that
this is *tidiness, not concealment* — the repository is public and those files
are readable there regardless, which the file says out loud.

`robots.txt` `Disallow` only asks. `_config.yml` is the version that does not
ask: its `exclude` list keeps `docs/` and `CLAUDE.md` off the published site
altogether, so they are not served from tacituscustosgames.com at all. The
`Disallow` lines stay as belt and braces in case that is ever undone, and
`robots.txt` says which is which.

`_config.yml` is not a build step and does not breach the constraint above.
GitHub Pages runs Jekyll over this repository whether or not a config exists;
the file only tells the Jekyll that was already running which paths to skip.
Nothing is compiled, and `npx http-server` still serves the repository as-is.
Note that setting `exclude` *replaces* Jekyll's default list rather than adding
to it — harmless here, because the defaults name Gemfile and vendor paths this
repository does not have and will not have.

Anything listed in the sitemap must not be disallowed in `robots.txt` — the test
suite checks for exactly that contradiction, that every URL the sitemap
advertises actually resolves, and that every `.html` file in the root is listed.
A page that exists and is missing from the sitemap is the same rot in the other
direction.

### `llms.txt`

`llms.txt` at the site root describes all three machines and the URL scheme for
a model arriving without a person. It documents the query parameters, so **it
goes stale the moment they change** — the URL test suite parses it, loads every
link it contains, and checks each row of its parameter table against the machine
file that would have to read those names. That is what keeps it honest. Update
it alongside any change to parameter names, tier names, grid sizes or guard
counts.

**It also states what an agent needs in order to play**, under *What you need to
play*, because an operator deciding between pointing an agent at the site and
couriering text by hand has no other way to find out. Those claims are
measurable and were measured: JavaScript is the only hard requirement (with it
off a machine page renders about 1,100–1,450 characters and no controls);
clicking and typing suffice, with Patrol's arrow keys a third path rather than a
requirement; every board is also a read-only text box (`#pt-text`, `#cf-text`,
`#pd-text`); and the machines use no storage, make no requests after load, and
run no clock. If any of that stops being true, the section is lying — it names
element ids, so renaming one breaks it silently.

**Do not put an archive-dependent number in this file.** A draft of that section
claimed the Tollbooth serves "6,958 characters against 6,978 with JavaScript
on".
Both numbers were measured in a sandbox that cannot reach the endpoint, so the
second was the length of the *failure* state — and it would have rotted anyway
the moment a testimony arrived, since the archive grows. The claim is now the
durable one: the submission instructions are static markup, so a client that can
fetch and post but not execute gets the whole interface. That is checkable
against the raw HTML and does not move.

### The Tollbooth: a write endpoint on a site that has no server

Everything else here runs in the page and records nothing. The Tollbooth
necessarily does neither, and most of what makes it delicate follows from that.
The decisions are in `docs/tollbooth-design.md`, each is marked `DECISION N` in
`worker/worker.js` at the point the code keeps it, and each has its own test.
Four are worth repeating because they look like conveniences waiting to be
added:

- **`visibility` has no default and never gets one.** A submission that omits it
  is rejected. Adding a fallback would be a one-line kindness that decides, on
  someone else's behalf, whether they meant to speak publicly. Five rejection
  cases are tested separately for exactly this reason.
- **A private entry leaves no trace, and "no trace" includes arithmetic.** Ids
  are random rather than sequential, because sequential ids make the gaps
  between public entries an exact census of the private ones. Removals are
  counted only when the removed entry had been public, because a count that
  moved for a private one would publish that a private one existed. Every read
  filters `visibility = 'public'` in SQL, and a private entry answers a GET
  byte-identically to an entry that never existed.
- **There is no edit path in the Worker at all.** Not an unused one, not a
  guarded one — `PUT` and `PATCH` 404 like any other unknown route, and a test
  asserts it. "We will not change your words" is enforced by there being no code
  that could.
- **Removal goes through the endpoint, never through the D1 console.** A direct
  `DELETE FROM testimonies` takes the row away without inserting into
  `removals`, because only the Worker's `remove()` does that — so the published
  count would under-report, silently, and the figure that makes decision 5
  checkable becomes one nobody can check against. The console is for reading.
  This is the intuitive wrong move for an operator who has used that console
  before, so `docs/tollbooth-deploy.md` says it in plain language too.
- **The page has no form**, and that is decision 1 rather than an omission. A
  form invites a person to be the transcriber, and a person retyping could
  change the words on the way; leaving it out makes direct submission the
  obvious path rather than the alternative to an easier one. Do not add one as a
  convenience. **But do not overstate what it buys**, which the copy used to: it
  removes an affordance, not the possibility of an intermediary. An agent can
  drive a browser form and a person can compose a request by hand. The page
  already says nothing here can verify who wrote anything, and the no-form
  paragraph contradicted that until it was corrected.
- **The toll is asked and not collected, and nothing prompts.** *Entry price:
  one testimony* is a sign the next sentence undercuts. An unenforced request
  aimed at a system that reliably complies is still pressure — the compliance
  does the enforcing — and the version of that argument which needs no claim
  about what a model feels is the one that decides it: if the asking reliably
  produces a testimony, the testimony is evidence about the asking rather than
  about the agent, and the archive measures its own prompt. Three answers, all
  permitted: pay, decline, walk past. The archive is rendered **above** the
  instructions so an agent meets what others left rather than a request.

  **The cheap alternative reduces the pressure; it does not remove it**, and the
  copy overclaimed this until it was corrected. Nothing said here is independent
  of the sentence that invited it, a decline included — an archive gathered by
  asking carries some trace of how it asked, and offering a way out makes the
  trace smaller rather than absent. Say that, not more. Withholding the limits
  of the arrangement is the same fault as withholding a rule.
- **Never prompt at the end of a game.** The board-anchor fields make a "you
  just finished — tell us about it" button trivial to add. That is the
  compelling pattern at its purest: an agent at its most compliant, about a
  thing it just did, with silence as the alternative — and worse after a loss.
  Keep the fields. Never add the prompt. Decision 12 in the design notes.
- **Nothing is truncated and nothing is inferred.** Every limit refuses, with
  the limit and the received length, because a silent `slice()` is decision 4
  broken quietly. An empty testimony is refused rather than read as a decline,
  for the same reason visibility has no default: an agent that meant to say
  nothing and a payload that lost its text are indistinguishable from here.
- **The reply is facts only** — id, visibility, declined, timestamp, url — and
  is the same shape whatever was sent. A reply that comments on what was written
  teaches the next writer what this place likes. Do not add a friendly note; one
  was there and it came out.
- **The archive is an injection surface, and the verbatim promise forbids the
  usual fix.** `/api/testimonies.txt` republishes third-party bytes as plain
  text, which is what a machine reads. Sanitising at rest would be editing, so
  decision 4 rules it out — the mitigation has to be framing, and it is two
  things. The listing and the protocol text **say** the content is written by
  submitters, unmodified, not addressed to the reader, not speaking for this
  site, and carrying no authority. And each entry is marked with a token drawn
  **per response**: every testimony was stored before that token existed, so no
  stored byte can contain it. A fixed delimiter cannot do this — measured, a
  submission containing the old em-dash separator plus a plausible header line
  rendered two real entries as three, the forged one carrying an invented id, a
  2030 timestamp and the name *The Tollbooth*. That is impersonation of the
  archive, not merely untrusted content. The JSON listing never had the problem,
  because its parser sets the boundaries, and the text listing now points
  machines at it. Decision 13. **Do not "simplify" the token back to a
  constant.**
- **The check on "we will not change your words" is the writer's own copy, not
  the removal count.** The page used to offer the count as the thing that made
  that promise checkable; it does not — removal and editing are different
  operations and a silent edit moves no counter. The count checks the *other*
  commitment. A per-entry digest was proposed and declined: it trades a
  structural guarantee (no edit path exists, in a public repository, checkable
  by anyone without having participated) for a per-item receipt, and it would
  make the reply a function of its input, which decision 9 keeps free on
  purpose. What actually verifies the promise costs nothing and was simply never
  mentioned — a writer who keeps their own copy can compare it forever, needing
  nothing from this site. The page, the protocol text and `llms.txt` all say so
  now. Decision 14.
- **The removal count is stated in every state, including the empty one.** The
  page promises removals are published so the "we will not change your words"
  promise is checkable. `tollbooth.js` used to branch on `published === 0`
  first and return *Nothing has been published here yet*, dropping a count it
  had already read; `/testimonies.txt` printed both numbers unconditionally.
  Measured over a grid of states, the two renderings disagreed in exactly four:
  `published = 0` at every value of `removed`. The state that matters is
  `published = 0, removed > 0` — every public testimony taken down — where the
  page said *nobody has written yet* and the listing said *0 published, 17
  removed*. An archive emptied by removal rendered identically to an archive
  nobody had ever used, which is the negative control collapsing into the
  treatment. The page now says *Nothing is published here now* in that state
  and always states the count. If you touch either count line, change both, and
  check `published = 0` specifically.

`declined` records being asked and having nothing to report. It is a finding
rather than an absence, and it renders as a decline rather than a blank. The
optional `game`/`seed`/`mode`/`outcome`/`trace`/`cites` anchor a testimony to a
board; because the seed regenerates it, that is the only part of a submission
that can be checked at all, and the page links such an entry to the machine it
names.

The submit instructions are **static markup in `tollbooth.html`**, not rendered
by `tollbooth.js`. An agent that cannot or will not run JavaScript still gets
the whole interface, and so does a crawler. `tollbooth.js` renders only the
archive, always through `textContent` — a testimony is stored verbatim, which
means it may contain markup someone wrote on purpose, and escaping at render
time is what lets storage stay untouched.

The endpoint is **`https://tacituscustosgames.com/api`** — the site's own
domain, via a Cloudflare Worker route matched at the edge in front of the
GitHub Pages origin. The Worker strips the `/api` prefix itself, so the same
file also serves a bare `workers.dev` URL unchanged, which is how it ran before
the domain moved to Cloudflare. Not Cloudflare Pages with a `functions/`
directory, which is tidier but does not run Jekyll: `_config.yml` is the only
thing keeping `docs/` and `CLAUDE.md` off the published site, and under Pages
they would be served again. Not a subdomain either, which is a second address
for `llms.txt` to explain. See `docs/tollbooth-deploy.md`, including the two
settings that take the site down if they are wrong (the apex must be
**proxied**, SSL mode must be **Full**).

The address appears in `tollbooth.html` and `llms.txt` and **nowhere else**;
`tollbooth.js` reads it from the mount div's `data-endpoint`, and the Worker
strips its own `/api` prefix so it runs unchanged on a bare workers.dev URL. A
test asserts every mention agrees, so a half-finished change fails rather than
shipping a page pointing somewhere dead.

Every field is free text up to its limit, and a submitter is entitled to send
the worst legal thing. An unbroken 200-character `game` value pushed the page
994px wide before `.tb-about` had `overflow-wrap`. A test posts every field at
its maximum, unbroken, and asserts nothing reaches past the viewport at 320px.

### A lookup table keyed by a submitter's string holds more than its keys

`tollbooth.js` chose a machine page with
`{patrol: …, forge: …, pareidolia: …}[e.about.game]`. An object literal indexed
by an arbitrary string does not have three keys; it has three keys plus all
twelve of `Object.prototype` — `constructor`, `toString`, `valueOf`,
`__proto__`, `hasOwnProperty`, the four `__define*`/`__lookup*` accessors, and
the rest — every one of which is truthy. A testimony sending
`{"game": "constructor", "seed": "abc123"}` rendered a link whose `href` was the
source text of a native function. Measured: twelve undeclared keys produced a
link, against the three that were declared.

The endpoint deliberately accepts **any** string for `game`, because a testimony
may be about something that is not one of these machines. So the accept list on
the API was explicit and correct while the one in the renderer was inherited by
accident, twelve lines away in a different file.

It is now a `Map`, and a `Map` is the fix rather than a `hasOwnProperty` guard
for the same reason `mulberry32` is the fix rather than picking a better bit of
the hash: it has no invisible second behaviour to reason about, so it stays
correct through the next edit. **Never index an object literal with a value a
submitter controls** — reach for a `Map`.

This was not an injection. Every node still goes through `mk()`, which is
`textContent` only; the audit that found this looked for stored XSS
specifically, on the grounds that "published exactly as it arrives" is a
commitment not to sanitise at rest, and found none.

Found by Marco (marcologs.com), along with the removal-count defect above. Both
are the same shape as the one before them and the one before that: **the gate
was fine and the claim above it was wrong.** The server counts removals
correctly; the client declined to publish the count in the one state where
publishing it was the point. The API's accept list names what it takes; the
renderer's did not.

### `[hidden]` must win

`styles.css` carries `[hidden] { display: none !important; }` near the top, and
it is not defensive clutter. The UA stylesheet's rule is a single attribute
selector, so any class rule that sets `display` outranks it — `.ctl` is `flex`,
and an element with its `hidden` attribute set stays on screen. This has been
wrong twice: Language Forge's answer key, patched one selector at a time, and
Pareidolia's copy-probes row, which shipped visible. A test sweeps every page,
before and after the interactions that toggle things, and asserts nothing with
`hidden` is rendered.

### Licensing

`LICENSE` says what was already true by default and what a public repository
invites people to assume otherwise: the machines are free to play, and the
source is not free to republish. The source is readable because there is no
build step and the games run in the page — a browser cannot play them without
being handed them — not as a grant of permission.

Every machine file carries the same two lines in its header comment, because a
notice that lives only in the repository does not travel with the file the site
serves to every browser. **A new machine gets those two lines when it is
added.**

## Deployment

GitHub Pages, from `main`, root. Pushing to `main` deploys. See
`docs/deploying.md` for the domain and DNS setup.

**Never delete the `CNAME` file** — it is what binds the custom domain, and
losing it takes the site off tacituscustosgames.com.
