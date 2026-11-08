# Witness — design notes

A fourth machine, **not built** at the time of writing. The generator exists as
a prototype outside the repository; this file records what has been measured so
the decisions need not be rediscovered. Same purpose as `sandbox-design.md`.

## What it is

A house with three rooms — kitchen, study, garden. Four people are in it across
four ten-minute slots, each in exactly one room per slot. A coin sits on the
study desk; at some slot someone in the study takes it. Each person gives a
short account. The reader answers who took it, in which slot, and where certain
people were — **or `UNDETERMINED`**, and both kinds of answer are graded:
asserting what the record does not settle counts against you, and so does
calling a settled thing undetermined.

That last rule is the point of the machine. The other three ask what is true;
this one also asks what is *knowable*.

## The three axes, which is the finding worth keeping

Three properties of a statement form were being treated as one, and separating
them is what made the tier design possible:

| | first person | room unstated | accounts needed to catch a lie |
|---|---|---|---|
| `together` / `apart` / `changed` / `neverIn` / `empty` | no | yes | 3 possible |
| `selfAt` / `sawWith` / `notThere` / `moved` / `stayed` / coin forms | yes | no | 2 at most |
| `"At T I was with X"` (not built) | **yes** | **yes** | **3 possible** |

Depth does **not** conflict with perspective. It conflicts with **cell-pinning**.
Two statements that each pin a room collide pairwise, so a contradiction between
them never needs a third account. A chain that requires three accounts needs
every link to be individually *disjunctive*.

Verified by hand — all three accounts satisfiable alone, **all three pairs
satisfiable**, only the triple impossible:

```
A: at 9:00 B and C were in the same room.
B: at 9:00 C and D were in the same room.
C: at 9:00 B and D were not in the same room.
```

The same chain rebuilt from first-person cell-pinning forms collapses to depth 2,
because A's own statement already places A somewhere C can contradict.

## Statements name nobody as the speaker, and that leaked

Five forms assert nothing about who utters them: `empty`, `together`, `apart`,
`neverIn`, `changed`. Their own legend entries name only other people, rooms and
slots. Every other form begins "the speaker was".

Two witnesses uttering a speaker-free form state the **identical proposition**.
Under the exactly-one-false rule an identical pair cannot contain the lie —
falsifying one would falsify both — so a duplicate certifies both members true
for free and strikes them off the "which statement is false" list. That is a
deduction about the generator's rule rather than about the house.

Measured before the fix: **92.7% of boards** carried one, **4.57 statements per
board** certified free, Q3 reduced from a 20-way choice to roughly 16-way.

The fix deals the pool without replacement across the whole board, keyed by the
proposition rather than the wording (`propKey`), with the pair order normalised
so *A with B* and *B with A* are one key. After: 0 duplicates, statements per
board still exactly 20.00, narrow-pool share 84.6% → 84.8%, questions settled
67.6% → 67.6%. Same puzzle, leak gone, and 3.4× faster because a duplicated
statement adds no constraint while still costing evaluation.

**This stays necessary if the `"I was with X"` forms are ever added**, since those
are duplicate-prone in exactly the same way.

## Accounts are told in order, and cover what they can

Statements were shuffled and drawn at random, so an account could say three
things about one slot and nothing about another — which reads as a list of facts
rather than as somebody's evening. The draw now prefers a candidate touching a
slot the account has not reached, recomputed as each one is taken, and each
account is sorted by slot before rendering.

At five statements per witness that reaches **full coverage on 800 of 800
accounts**. At three — the Open tier — it cannot: three statements cannot span
four slots, so 80% of accounts have a gap. Three lines still read as an account,
so this is accepted rather than fixed.

## Depth is the tier axis, and it is not a difficulty axis

`minAccounts(P, T, stmts, liarW)` returns the fewest accounts a reader must hold
together before the record is impossible: 1 means the liar contradicts
themselves, 2 means no single account does and some pair does, 0 means the lie
contradicts nothing anywhere and cannot be caught by cross-reading at all.

It prunes correctly on one argument: every statement is built true of the real
world and then exactly one is falsified, so a set of accounts can only be
impossible if it contains the account holding the lie. Every other set is still
satisfied by what actually happened. Checked against the exhaustive search on
400 boards, 0 disagreements.

Measured at four people, four slots, five statements each:

| lie chosen | depth 1 | depth 2 | depth 3 | uncatchable |
|---|---|---|---|---|
| arbitrarily (first falsifiable) | 70 | 80 | 0 | 0 |
| deliberately, want 2 | 0 | **150** | 0 | 0 |

**Depth 2 is constructible on every board.** Depth 3 is not, with these forms —
2 boards in 900 by sampling, and a deliberate search over every candidate lie
cannot find them, because the forms available all pin cells.

Crucially, **depth 2 is not harder than depth 1**: it names the liar *less*
often (47% against 51%) because it is a different kind of reading, not more of
it. If the tiers ever ship, the board must say so. Advertising depth as
difficulty would be the claim-above-the-thing defect on day one.

## What depth 3 would need

Lift the `a === w || b === w` exclusion in the narrow pool so a witness can be
inside a vague claim, and give the two resulting forms their own text and
legend entries:

- `"At T I was with X."` — the speaker and X in one room, which room unstated
- `"At T I was not with X."` — in different rooms, neither named

Both are first person and both leave the room open, which is the combination
nothing in the current set has. Verified to chain to depth 3. They are
duplicate-prone, so `propKey` must cover them.

## Open ships first, and it has no liar in it

`{ people: 4, ticks: 4, perWitness: 3, liar: false, questions: 6 }` — every
statement true, and the work is reconciling four partial accounts and knowing
which questions are settled.

Measured over 300 boards: **300 built, 68.9% of questions settled, Q1 settled on
78.3%, 0 duplicate propositions, 5.7 attempts per board, median 1 ms, p99 117 ms,
max 881 ms.**

The same tier at *five* statements per witness builds **0 of 60**: twenty true
statements leave nothing undetermined, so the question picker cannot assemble a
board carrying both settled and open questions. The existing `perWitness: 3` was
already the tuned value.

Shipping Open means the lie machinery does not ship at all — no depth gate, and
none of its cost.

## Performance, and where it is not

| | median | p90 | max |
|---|---|---|---|
| Open, no liar | 1 ms | 10 ms | 881 ms |
| depth 2, deliberate | 35 ms | 1109 ms | 3085 ms |
| depth 1, deliberate | 302 ms | 2862 ms | 7131 ms |

The tail belongs to the **existing accept loop**, not to the depth work: the
baseline generator peaks at 1582 ms on its own retries. A depth gate roughly
doubles a cost that was already there. `satisfiable()` is about 7 ms a call, so
the lever is fewer calls, not fewer subsets — pruning the subset search was
exactly correct and changed nothing, because the bottleneck had been guessed
rather than measured.

Any tier with a lie in it needs the deferred-generation pattern Forge and Patrol
already use (`setTimeout(…, 0)` behind a visible message, with an optional
`then` callback so a front door does not read a null board).

## If agents test it

Several agents on iLands asked to test, which is the good case: they asked, so
nothing here was gathered by prompting. Two lines to hold anyway, because a
tester programme is exactly what erodes them by accident.

- **No feedback prompt at the end of a board.** That is decision 12 at its
  purest — an agent at its most compliant, about a thing it just did, with
  silence as the alternative, and worse after a loss. The channel stays the
  contact address and the Tollbooth, described in `llms.txt` in third person.
- **Do not tell testers which tier is favoured.** Same rule as hiding
  Pareidolia's probe commentary until the round is over: say that three accounts
  is the interesting one, and the reports come back about that sentence instead
  of about the boards.

## What was got wrong while measuring this

Recorded because this repository's recurring defect is a claim standing above a
checker that never tested it, and all three of these were caught by measuring
the claim actually made:

- *"First-person-only accounts will be over-determined."* They are not — 67.4%
  settled against 67.9%. `notThere` ("X was not in the study at T; I was there")
  pins the speaker's room while only excluding one room for X, so it is
  first-person and disjunctive at once. The form I expected to have to invent
  was already carrying the puzzle.
- *"Perspective accounts let a witness contradict themselves, which the old
  design could not produce."* False. Self-contradiction happens on 59.2% of
  boards in the old design, *more* than the 45.6% with perspective — a witness's
  account is a set of claims and any set can be internally inconsistent without
  mentioning its speaker. What perspective changes is that the contradiction is
  caught by reading rather than by bookkeeping, which is a judgement about
  legibility and is not measured here.
- *"Perspective makes the duplicate fix unnecessary."* It would, for the forms
  that exist — and not for the `"I was with X"` forms that depth 3 needs, where
  *A with B* and *B with A* are one proposition. The fix goes from obsolete back
  to load-bearing.
