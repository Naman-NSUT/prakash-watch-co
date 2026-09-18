# Deploying Prakash Watch Co.

The site runs in two places:

```
  customers ──▶  Vercel  — the shop front: home, collections, watch pages,
                           brands, offers, the repair-ticket form
                    │
                    │ reads the catalogue, photographs and offers over HTTPS
                    ▼
  the shop  ──▶  Render  — the back end: admin panel, research agent, and the
                           disk holding every listing, photograph, repair
                           ticket, bill and ledger entry
```

The shop front holds no data at all. It asks the back end, keeps each answer for
a minute, and keeps serving its last good copy if the back end is briefly down —
so a back-end deploy does not take the shop offline.

**The back end alone is a complete site.** Everything the shop front does, the
Render service also does. Vercel adds a fast global front and takes load off the
back end; if you would rather not pay for it, skip step 3 and point your domain
at Render.

---

## What it costs

| | Plan | Monthly |
|---|---|---|
| Render web service | `0.5c-512mb` (0.5 CPU, 512 MB) | $7 |
| Render disk | 2 GB at $0.25/GB | $0.50 |
| Vercel | Hobby | free |
| **Total** | | **about $7.50** |

There is no database to pay for. Everything the shop keeps lives on the disk:
listings as files, photographs, tickets, bills and the ledger.

**512 MB is enough, but only just, during a sheet run.** Measured with the full
catalogue: 142 MB idle, about 230 MB under page traffic, and about 410 MB while
the agent processes a watch's photographs. That is why the agent researches one
watch at a time (`AGENT_CONCURRENCY` is 1). For faster sheet runs, move to
`1c-2g` ($25) and set `AGENT_CONCURRENCY` to 3.

**On Vercel's free plan, photographs load straight from Render**, not through
Vercel's image optimiser. Hobby allows 5,000 image transformations a month; the
catalogue would use that up early in the month, after which photographs stop
appearing. They are already compressed WebP averaging 94 KB, and Render sends
them with a year-long cache header, so each visitor downloads each one once.

**Vercel's terms restrict Hobby to non-commercial use**, and count selling
products as commercial. Moving to Pro later is a plan change in the dashboard;
nothing in this repository changes. Keep an eye on the Hobby limits too — 4 hours
of function CPU and 10 GB of origin transfer a month — which a busy month could
reach.

---

## 1. Render — the back end

1. **New → Blueprint** in the Render dashboard, and choose this repository. It
   reads `render.yaml` and proposes one web service, `prakash-backend`, with a
   5 GB disk at `/app/data`.
2. Render will ask for the two values it cannot generate:
   - `ADMIN_PASSWORD` — the admin panel password. Use a long random one.
   - `OPENROUTER_API_KEY` — the agent's key, from openrouter.ai/keys.

   It generates `ADMIN_SECRET`, `AGENT_SERVICE_TOKEN` and `PWC_PUBLIC_API_TOKEN`
   itself.
3. Apply. The first build takes about five minutes. When it is live, open
   `https://prakash-backend.onrender.com/api/health` — it should read
   `{"ok":true,"disk":true,"agent":true}`. The shop is empty until step 2.

On first boot the service writes the brand registry and the backdrop library
onto the empty disk. It never overwrites them afterwards: once the agent has
discovered a new brand, the disk's copy is the real one.

## 2. Upload the shop's data

The repository is public, so the data never goes through it. It goes straight
from your machine to the disk over SSH.

1. Add your SSH public key: Render → **Account Settings → SSH Public Keys**.
2. Copy the SSH address from the service page, under **Connect → SSH**. It looks
   like `srv-xxxxxxxxxxxx@ssh.singapore.render.com`.
3. From the repository:

   ```sh
   deploy/upload-data.sh srv-xxxxxxxxxxxx@ssh.singapore.render.com
   ```

   It packs `nextjs/data` (about 540 MB compressed), copies it up, and unpacks it
   on the disk. The site picks it up on the next request.

   If it reports that it could not unpack remotely, the archive is already on
   the disk: open the service in Render and choose **Manual Deploy → Restart
   service**. The service unpacks any uploaded archive as it starts. (Render
   documents file copies over SSH but not running commands over it, so the
   script tries the quick way and falls back to this one.)

Run it again whenever you want the disk to match this machine. It overwrites
files it carries and leaves the rest alone, so repair tickets customers have
submitted in the meantime survive.

## 3. Vercel — the shop front

1. **Add New → Project**, import this repository.
2. Set **Root Directory** to `nextjs`. Vercel detects Next.js from there.
3. Add two environment variables, for Production:

   | Name | Value |
   |---|---|
   | `PWC_BACKEND_URL` | `https://prakash-backend.onrender.com` |
   | `PWC_PUBLIC_API_TOKEN` | the value Render generated — copy it from the Render service's Environment tab |

   Nothing else. The shop front holds no secrets: no admin password, no OpenRouter
   key.
4. Deploy.

`PWC_BACKEND_URL` is read at build time as well as at run time — it tells the
image optimiser which host to fetch photographs from — so after changing it,
redeploy.

## 4. Domains

The natural split:

| Address | Points at |
|---|---|
| `prakashwatch.co`, `www.prakashwatch.co` | Vercel |
| `admin.prakashwatch.co` | Render (custom domain on the service) |

After adding the admin domain on Render, change `PWC_BACKEND_URL` on Vercel to
`https://admin.prakashwatch.co` and redeploy. Anyone who types `/admin` on the
shop's address is sent there.

## 5. Check it

```sh
curl https://admin.prakashwatch.co/api/health     # {"ok":true,"disk":true,"agent":true}
```

- The home page shows the collections, each with a photograph.
- A watch page shows its photographs and price.
- `/admin` on the shop's address sends you to the back end's sign-in.
- Signing in shows the catalogue with every listing.
- A test repair ticket from `/service` appears under **Admin → Repairs**.

---

## Living with it

**Deploys.** Every push to `master` redeploys both halves. The back end restarts
with a few seconds of downtime — a service with a disk cannot run two copies at
once — during which the shop front keeps serving from its cache. The admin panel
is briefly unavailable.

**Backups.** Render snapshots the disk every 24 hours and keeps seven days.
Restoring is all-or-nothing: the whole disk returns to that moment, so anything
since — new tickets, sales — goes with it. For a longer history, pull a copy down
now and then. In the service's **Shell** tab on Render:

```sh
tar -czf /app/data/.backup.tar.gz --exclude=./.backup.tar.gz -C /app/data .
```

Then on your machine:

```sh
scp -s srv-xxxxxxxxxxxx@ssh.singapore.render.com:/app/data/.backup.tar.gz backup-$(date +%F).tar.gz
```

And back in the Shell tab, `rm /app/data/.backup.tar.gz` — otherwise it sits on
the disk taking space and is copied into the next snapshot. The file holds
customer details. Keep your copy somewhere private.

**Prices.** Admin → Pricing → *Refresh all prices* re-reads each listed watch's
source page for today's price and discount. It makes no model calls and costs
nothing.

**Research spend.** `AGENT_BUDGET_USD` stops a sheet run once it has spent that
much. It is set to $10 in `render.yaml`.

---

## Environment variables

### Render (back end)

| Name | Set by | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | you | Admin panel password |
| `ADMIN_SECRET` | Render | Signs the admin session. Rotating it signs everyone out |
| `AGENT_SERVICE_TOKEN` | Render | Shared secret between the site and the agent |
| `OPENROUTER_API_KEY` | you | The agent's model access |
| `PWC_PUBLIC_API_TOKEN` | Render | Lets the shop front read the catalogue |
| `AGENT_BUDGET_USD` | `render.yaml` | Most one run may spend, in US dollars |
| `AGENT_CONCURRENCY` | `render.yaml` | Watches researched at once |
| `PWC_DATA_ROOT` | the image | Where the disk is mounted. Leave it |

### Vercel (shop front)

| Name | Purpose |
|---|---|
| `PWC_BACKEND_URL` | The back end's address |
| `PWC_PUBLIC_API_TOKEN` | Same value as on Render |

---

## What is protected, and how

- **Admin pages and APIs** are behind a signed session that expires after 12
  hours on the server, not only in the browser. A gate in `middleware.ts` checks
  every admin request, and each route checks again, so neither can quietly lapse.
- **Customers' repair photographs** are served only to a signed-in admin.
- **The agent** listens on the container's loopback only. Nothing outside can
  reach it, and it spends money only when the site asks with the shared token.
- **The public API** the shop front reads sends listed watches only, with the
  cost price, stock count, review notes and research spend removed.
- **The image** contains no data and no secrets; `.dockerignore` keeps both out
  even when it is built on a machine that has them.
- Every response carries a content security policy and the usual headers:
  no framing, no MIME sniffing, strict referrer, HSTS.
