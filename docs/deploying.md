# Deploying

The site is static files served by **GitHub Pages** from the **`main`** branch,
root directory, at the custom domain **tacituscustosgames.com**.

There is no build step. Pushing to `main` deploys.

The Tollbooth's backend is the one exception and does not deploy this way. It
lives in `worker/` and goes up separately; see `docs/tollbooth-deploy.md`.
Nothing else on the site depends on it — if the Worker is down, every machine
still runs and the Tollbooth page still tells an agent how to submit.

## Making a change

1. Commit to a branch, push, open a PR, merge it into `main`.
2. Pages rebuilds automatically — usually under two minutes.
3. Confirm at the repo's **Actions** tab: a run named **"pages build and
   deployment"** whose `head_sha` matches the merge commit, concluding
   *success*.

If the site looks unchanged afterwards, check that run finished before blaming
anything else, then hard-refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`). A URL the
browser has never seen — `arcade.html?v=2` — bypasses cache entirely and is the
fastest way to rule it out.

## Domain and DNS

The domain is **registered at Namecheap** and its DNS is **served by
Cloudflare**. Those are two different things and the split is the whole shape
of this setup: Namecheap only holds the registration and the nameserver
delegation; every record lives at Cloudflare.

Namecheap's nameservers are set to **Custom DNS** (Domain List → Manage →
Domain tab → NAMESERVERS), pointing at the pair Cloudflare assigned:

```
julissa.ns.cloudflare.com
yoxall.ns.cloudflare.com
```

**Namecheap's Advanced DNS tab is inert.** It still displays host records and
they are no longer used by anything. Do not edit them expecting an effect, and
do not treat them as the source of truth — they are a fossil of the setup
before the move.

The records, now at **Cloudflare → DNS → Records**:

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| A | `@` | `185.199.108.153` | Proxied |
| A | `@` | `185.199.109.153` | Proxied |
| A | `@` | `185.199.110.153` | Proxied |
| A | `@` | `185.199.111.153` | Proxied |
| CNAME | `www` | `tacituscustos.github.io` | Proxied |
| MX | `@` | `eforward1.registrar-servers.com` (10) | DNS only |
| MX | `@` | `eforward2.registrar-servers.com` (10) | DNS only |
| MX | `@` | `eforward3.registrar-servers.com` (10) | DNS only |
| MX | `@` | `eforward4.registrar-servers.com` (15) | DNS only |
| MX | `@` | `eforward5.registrar-servers.com` (20) | DNS only |
| TXT | `@` | `google-site-verification=qZDPYM5bu9G5Io7N8RJUpMC6JD5VTOBBNXpT1Kyb6og` | DNS only |
| TXT | `@` | `v=spf1 include:spf.efwd.registrar-servers.com ~all` | DNS only |

Twelve records. **The five MX records are Namecheap's email forwarding**, and
an earlier version of this table omitted them entirely — anyone rebuilding DNS
from it would have silently killed mail on the domain. They survived the move
because Cloudflare's import scan found them, not because the table said to
check.

Four separate A records all on `@` is correct — those are GitHub Pages' four
anycast addresses. Verify them at any time by resolving
`tacituscustos.github.io` rather than trusting this table.

**The apex must stay Proxied** (orange cloud). An unproxied record goes
straight to GitHub and Cloudflare never sees the request, so the Worker route
at `tacituscustosgames.com/api/*` would never fire and the Tollbooth would
404. `www` can be either, and is proxied.

**SSL/TLS mode must stay Full.** On Flexible, Cloudflare fetches the origin
over plain HTTP, GitHub Pages answers with its own HTTP-to-HTTPS redirect, and
the site goes into a redirect loop — the whole site, not just the API. See
`docs/tollbooth-deploy.md` for the rest of the Cloudflare setup and what is
easy to get wrong in it.

Because the apex is proxied, **resolving it returns Cloudflare addresses**
(`104.21.x`, `172.67.x`) rather than GitHub's. That is what proxied means and
is not a misconfiguration. Seeing `185.199.x` at the apex would now be the
problem.

### The Google verification record

The `TXT` record on `@` beginning `google-site-verification=` is what proves
ownership of the domain to Google Search Console, which is what gets the site
indexed. It is a Domain-type property, so it covers `www` and every subdomain
rather than one exact URL.

**It has to survive any change of DNS provider.** It survived the move to
Cloudflare — the import scan caught it, and it was checked against the new
nameservers immediately afterwards. If it is ever lost, Google silently
un-verifies the property and indexing stops, with no error anywhere that
anyone would think to look. Check for it after any such change, alongside
checking the site still loads.

Reading it back, from the authoritative nameservers rather than a public
resolver:

```js
const r = new Resolver();
r.setServers(['172.64.34.105', '172.64.35.47']);   // julissa, yoxall
console.log(await r.resolveTxt('tacituscustosgames.com'));
```

### The CNAME file

`CNAME` in the repo root contains `tacituscustosgames.com` (no trailing dot —
different file, different rules from the DNS record above). It is what tells
Pages which domain to serve. **Deleting it takes the site off the custom
domain.** Watch for this when merging.

## HTTPS

There are now **two certificates**, and knowing which is which saves an hour
when one of them misbehaves.

- **Cloudflare's Universal SSL** is what a visitor's browser sees. It is issued
  automatically when the zone activates and covers `tacituscustosgames.com` and
  `*.tacituscustosgames.com`. Before activation, the DNS screen warns that
  proxied hostnames are "not covered by a certificate"; that clears itself.
- **GitHub's Let's Encrypt certificate** is what Cloudflare uses when it
  fetches the actual pages. It predates the move and keeps renewing. **Settings
  → Pages → Enforce HTTPS** stays ticked — it is what makes the origin answer
  over HTTPS at all, which is what SSL/TLS **Full** requires.

Renewal of the GitHub certificate now happens through Cloudflare, since the
apex is proxied. It validates over HTTP and passes through fine. This is the
one reason to prefer SSL/TLS **Full** over **Full (strict)**: if that renewal
ever did fail, Full keeps serving and Full (strict) would hard-fail the site.

**Never buy an SSL certificate for this site.** Pages has no mechanism to
install a third-party certificate — there is no upload field and no API. A
purchased certificate is not merely unnecessary here, it is unusable. Namecheap
pushes them hard at checkout, and Cloudflare's own Universal SSL is free and
already doing the job.

If **Enforce HTTPS** is greyed out with *"a certificate has not yet been issued"*,
the certificate is still being provisioned. Usually minutes; GitHub allows up to
24 hours. Wait and reload the settings page. Only if it is still unavailable a
day later, **Remove** the custom domain, save, then re-enter and save it — that
re-triggers provisioning, at the cost of briefly dropping the custom domain and
rewriting the `CNAME` file.

## Checking DNS from a shell

Query the authoritative nameservers directly; public resolvers cache and will
happily serve stale answers long after a change is live.

```js
// node check.mjs
import { Resolver } from 'node:dns/promises';
const r = new Resolver();
r.setServers(['172.64.34.105', '172.64.35.47']);   // julissa, yoxall
console.log(await r.resolve('tacituscustosgames.com', 'A'));
console.log(await r.resolve('www.tacituscustosgames.com', 'CNAME'));
console.log(await r.resolveMx('tacituscustosgames.com'));
console.log(await r.resolveTxt('tacituscustosgames.com'));
```

Those two addresses are the Cloudflare nameservers resolved to IPs, since
`Resolver.setServers` takes addresses rather than names. They can move; resolve
`julissa.ns.cloudflare.com` and `yoxall.ns.cloudflare.com` if the queries start
failing.

Every resolver, Cloudflare's own nameservers included, now answers the apex
with Cloudflare's proxy addresses (`104.21.x` / `172.67.x`). The GitHub
addresses in the table above are the record **as stored**, visible in the
Cloudflare dashboard; they are not what a DNS query returns while the record is
proxied. Both facts are true at once and the pair is confusing exactly once.
During the brief window when the zone is added but not yet active, queries do
return `185.199.x` — that is the signal the zone has not activated, not a
lasting distinction.

To check the delegation itself rather than the records:

```js
r.setServers(['8.8.8.8']);
console.log(await r.resolveNs('tacituscustosgames.com'));
```

Expect `julissa.ns.cloudflare.com` and `yoxall.ns.cloudflare.com`. Anything
naming `registrar-servers.com` means the nameserver change was undone.

`node:dns` cannot query DS or DNSKEY, so checking whether DNSSEC is signed
takes a raw UDP query built by hand. DNSSEC is off for this domain and should
stay off unless it is enabled *through Cloudflare*: a zone left signed while
its nameservers change stops resolving entirely.

## Things that look broken but aren't

- **The landing page shows no games.** It is a door, not a game room. The
  machines are on `arcade.html`.
- **"Not secure" in the address bar.** HTTPS is not enforced yet — see above.
- **The parking page appears after DNS is correct.** A cached record; it
  expires.
- **The apex resolves to an address that is not GitHub's.** `104.21.x` and
  `172.67.x` are Cloudflare. That is what proxied means, and it is required for
  the Tollbooth's route to fire.
- **"This hostname is not covered by a certificate"** on the Cloudflare DNS
  screen, while the zone is pending. Universal SSL is issued on activation.
  Still there an hour after the zone goes active is a real problem.
- **Namecheap's Advanced DNS tab still lists host records.** It is inert; DNS
  is served by Cloudflare. Editing it does nothing.

And one that is genuinely broken rather than merely alarming:

- **"Too many redirects" on every page.** SSL/TLS is set to Flexible. Set it to
  **Full**. This takes down the entire site, not just the API.
- **Repo visibility.** Pages on a private repo needs a paid plan, and even then
  the published *site* stays public — access-controlled Pages is Enterprise
  only. Keeping this repo public is what keeps the site free and online.
