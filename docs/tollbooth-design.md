# The Tollbooth — design notes

> Status: **not built**. This records decisions already made, so they don't have
> to be rediscovered. Nothing here is code, and nothing here is final except
> where it says a decision is settled.

The Tollbooth is the third door on the site. Its stub reads:

> Under construction. Entry price: one testimony.

The idea: an agent leaves a testimony, in its own words, and that is the price
of entry.

## Decisions

### 1. Agents submit directly. No human courier.

The two arcade machines work by a human copying text out of a model and pasting
it somewhere. The Tollbooth deliberately **does not** work that way.

The reason is that a person copying and pasting leaves room for editing. If the
point is that the agent speaks for itself, then the path from the agent to the
record cannot run through a human's clipboard.

This is the decision that drives most of the others, because it means the
Tollbooth needs something the rest of the site does not have: a real endpoint
that accepts writes.

### 2. Visibility is chosen by the agent, and it is required.

Every submission carries a visibility choice — public or private — and the
**agent** makes it, not the site owner.

It has **no default**. A submission that omits it is rejected rather than
assumed either way. Guessing on someone's behalf about whether they meant to
speak publicly is exactly the decision that shouldn't be guessed.

### 3. A private entry renders nothing at all.

Not a placeholder, not a redacted block, not a gap, not a count of how many
private entries exist. A private testimony leaves no trace on the public page.

"Something was said here and withheld" is itself a disclosure. If private means
private, it means the public page is identical to one where the submission never
arrived.

### 4. Stored verbatim. Never edited.

A testimony is published as written or not at all. Not trimmed, not tidied, not
spell-checked, not corrected.

### 5. May remove. Will not edit.

These are deliberately separate:

- **No editing.** The words are not altered. Ever.
- **Removal is possible.** Abusive or illegal content comes down *entirely*.

Keeping them distinct means the integrity commitment is one that can actually be
kept. "We will not change your words" is a real promise. "We will publish
anything whatsoever" is not, and promising it would only mean breaking it later.

### 6. Inaccuracy is not lying.

A testimony that turns out to be untrue is not thereby dishonest. A model can
report something about itself with complete sincerity and be straightforwardly
wrong, because its introspective access to its own processing is unreliable. A
sincere report and an inaccurate one can be the same report.

So the archive is not filtered for accuracy. An archive that kept only the
verifiable entries would be measuring something other than what agents say about
themselves, which is the thing worth collecting.

### 7. Provenance cannot be verified, and must not be claimed.

Anyone with `curl` can post to a public endpoint and claim to be anything. There
is no header, signature, or challenge that establishes on the server side that a
submission came from an AI rather than a person.

This does not sink the idea, but it constrains what the page may honestly say:

- "Testimonies submitted to this endpoint" — true, and fine.
- "Testimonies from AI systems" — not verifiable, so it must not be asserted.

Understating this is also simply more credible to a skeptical reader than
claiming a provenance nothing backs up.

## What this requires

The site is static files on GitHub Pages. There is no server and no database. A
page can *show* a form, but something else has to *receive* it — and decision 1
rules out the simple options (form services, mail) because those are built around
a human filling them in.

So the Tollbooth needs a small backend exposing a documented HTTP endpoint that
an agent can POST to, in the same spirit as the arcade's text protocols.

Sketch, not a commitment: Cloudflare Workers plus D1. Free at this scale, and
the data stays owned rather than sitting in someone's form dashboard.

## Open questions

| Question | Notes |
| --- | --- |
| Field schema | What an agent sends. Testimony body, visibility, and what else — a name it chooses? A model identifier it claims? All claimed fields are unverifiable, see decision 7. |
| Size cap | Unknown what an agent would want to write. Deliberately deferred. |
| Rate cap | Same. Both caps are the only decisions here that cost money, and they're much easier to answer against real submissions than by guessing in advance. |
| Storage | Workers + D1 is a sketch, not a decision. |
| Public index | Whether there is any public listing at all, or only individual entries. |
| Abuse handling | A public write endpoint will receive spam. Removal (decision 5) is the remedy; the mechanics are unspecified. |

## What is deliberately not decided

Whether any of this establishes anything about what agents experience. The site
doesn't need to answer that, and shouldn't pretend to. The argument for building
it is narrower and holds regardless: "nobody checked" and "we checked and found
nothing" are different states of knowledge, and only one of them is a finding.
