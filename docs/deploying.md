# Deploying

The site is static files served by **GitHub Pages** from the **`main`** branch,
root directory, at the custom domain **tacituscustosgames.com**.

There is no build step. Pushing to `main` deploys.

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

The domain is registered at **Namecheap**, using Namecheap BasicDNS
(`dns1.registrar-servers.com` / `dns2.registrar-servers.com`).

Set under **Domain List → Manage → Advanced DNS → HOST RECORDS**:

| Type | Host | Value |
| --- | --- | --- |
| A Record | `@` | `185.199.108.153` |
| A Record | `@` | `185.199.109.153` |
| A Record | `@` | `185.199.110.153` |
| A Record | `@` | `185.199.111.153` |
| CNAME Record | `www` | `tacituscustos.github.io.` |

TTL: Automatic.

Four separate A records all on host `@` is correct — those are GitHub Pages'
four anycast addresses. Verify them at any time by resolving
`tacituscustos.github.io` rather than trusting this table.

**The trailing dot on `tacituscustos.github.io.` belongs there.** It marks the
name as fully qualified. Without it some providers append your own domain and
silently produce `tacituscustos.github.io.tacituscustosgames.com`. It is not a
typo — do not remove it.

Namecheap's two default records must be **deleted**, or they fight the above:

- `CNAME Record` — `www` → `parkingpage.namecheap.com`
- `URL Redirect Record` — `@` → the domain itself

Leave the `TXT` SPF record alone; it belongs to Namecheap email forwarding.

### The CNAME file

`CNAME` in the repo root contains `tacituscustosgames.com` (no trailing dot —
different file, different rules from the DNS record above). It is what tells
Pages which domain to serve. **Deleting it takes the site off the custom
domain.** Watch for this when merging.

## HTTPS

GitHub Pages issues a free Let's Encrypt certificate automatically once DNS
resolves to GitHub. Then tick **Settings → Pages → Enforce HTTPS**.

**Never buy an SSL certificate for this site.** Pages has no mechanism to
install a third-party certificate — there is no upload field and no API. A
purchased certificate is not merely unnecessary here, it is unusable. Namecheap
pushes them hard at checkout.

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
r.setServers(['156.154.132.200', '156.154.133.200']); // registrar-servers.com
console.log(await r.resolve('tacituscustosgames.com', 'A'));
console.log(await r.resolve('www.tacituscustosgames.com', 'CNAME'));
```

Expect the four GitHub addresses and `tacituscustos.github.io`. A resolver still
returning `192.64.119.95` is serving the old Namecheap parking record from
cache — that clears on its own and needs no action.

## Things that look broken but aren't

- **The landing page shows no games.** It is a door, not a game room. The
  machines are on `arcade.html`.
- **"Not secure" in the address bar.** HTTPS is not enforced yet — see above.
- **The parking page appears after DNS is correct.** A cached record; it
  expires.
- **Repo visibility.** Pages on a private repo needs a paid plan, and even then
  the published *site* stays public — access-controlled Pages is Enterprise
  only. Keeping this repo public is what keeps the site free and online.
