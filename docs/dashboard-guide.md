# Reading the Cloudflare dashboard

Working notes, not a page. The dashboard is capacity telemetry built for sites a
thousand times this one's size; four numbers on it mean anything here.

The four gauges came from Fable, who reads the weekly readouts. Everything
below them is what checking a readout against this repository has turned up.

## The four gauges

1. **Visits** are sessions — people, roughly. **Requests** count every file, so
   they run ten to fifteen times higher and mean nothing on their own. A week
   reading 7.87k requests / 553 visits is a 553-visit week.
2. **5xx rate** is the only alarm on the panel: it is the one number that means
   *this site* broke rather than someone poking at it. It has sat at ~0.
3. **Top paths** is the interesting document. Machine pages mean players.
   `.env`, `wp-*` and friends mean burglars, and a 404 means the wall held.
   Anything under `/cdn-cgi/` is Cloudflare's own machinery rather than a
   visitor — see the caveat below, because one of those paths is not what it
   looks like.
4. **Countries and IPs** are who. Real readers spread across many addresses;
   a scanner farm is one datacentre address doing a hundred requests. Belgium
   and Singapore at the top of the country list are scanners, not an audience.

## Paths that have come up, and what they were

**`/env.js`** — not ours. Checked against the repository: there is no such
file, nothing references one, and it is not in the tree GitHub Pages serves.
Scanners guessing at a config file, 404ing harmlessly. If it ever *becomes* a
real file, that is the thing to worry about, not the requests.

**`/cdn-cgi/l/email-protection`** — this one has two readings and the second
matters. Cloudflare's **Email Address Obfuscation** rewrites `mailto:` links in
HTML responses into this path, decodable only by running Cloudflare's
JavaScript. The footer of every page carries a plain
`mailto:tc@tacituscustosgames.com`, so if that feature is on, the contact
address on every page is JavaScript-gated.

That matters more here than it would elsewhere. This site is built for readers
that fetch a page and do not execute it — `llms.txt` has a whole section on
them, and the Tollbooth's submit instructions are static markup precisely so
such a client gets the whole interface. An obfuscated Contact link is the one
thing on the page those readers cannot resolve.

It also buys close to nothing. The same address is published in plain text in
`llms.txt`, and Cloudflare only rewrites `text/html` — so anything harvesting
the site already has it. The obfuscation protects one copy of an address that is
in the clear one fetch away, at the cost of the readers this site exists for.

To check, in ten seconds:

```bash
curl -s https://tacituscustosgames.com/ | grep -o 'mailto:[^"]*\|email-protection'
```

A `mailto:` means the feature is off and nothing needs doing. `email-protection`
means it is on, and the switch is **Cloudflare → Scrape Shield → Email Address
Obfuscation**.

**Note what the existing test does and does not cover.** A test asserts every
`@tacituscustosgames.com` string *in the repository* is the same one. That
checks the source. Cloudflare rewrites at the edge, so the served bytes can
differ from the bytes that were tested — the same shape as every other defect
recorded in `CLAUDE.md`: the gate was fine and the claim above it was about
something the gate had never looked at. A check of the served page belongs with
a check of the source.

## One number worth watching that is not on the dashboard

The Tollbooth is among the most-visited pages on the site, unannounced, and the
archive holds one testimony.

That gap is the design working rather than failing. Decision 12 says an
unenforced request aimed at a system that reliably complies is still pressure,
because the compliance does the enforcing — and that if the asking reliably
produced a testimony, the archive would be measuring its own sign. Many
visitors and few testimonies is the shape you want. A visit rate and a
submission rate that tracked each other would be the alarming readout.

Nothing about a visitor is recorded by this site; these numbers are Cloudflare's
edge logs, which exist whether or not anyone looks at them. They are not a
record of who played, and nothing here should turn into one.
