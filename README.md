# SiteOps — Operations Platform (starter)

Multi-tenant operations platform for road-works contractors. Projects, equipment, plant dockets, site notes, and the burn dashboard are live. The **expense claims** workflow — lodgment, the two-key approval flow, rejected-claim correction, and the LegacyPlant CSV import — is now implemented on top of Priya's create/read starter. See `DECISIONS.md` for the design reasoning and `AI-USAGE.md` for how AI was used.

## Layout

- `api/` — NestJS 11 + Prisma 6 + PostgreSQL
  - `src/common/` — platform kernel: response envelope, pagination, permissions guard/decorator, exception filter, number sequences
  - `src/audit/` — audit-trail service
  - `src/outbox/` — transactional outbox (dev relay logs deliveries)
  - `src/projects/`, `src/equipment/`, `src/dockets/`, `src/notes/`, `src/reports/` — platform modules
  - `src/claims/` — expense claims module (in progress)
  - `src/users/` — org members (used by the dev user-switcher)
- `web/` — Next.js App Router + TypeScript + TanStack React Query
  - `app/dashboard`, `app/projects`, `app/equipment`, `app/dockets`, `app/claims` — feature screens
  - `lib/api/` — API client · `lib/query/` — cache keys · `lib/use-acting-user.ts` — acting user + permissions
  - `components/` — shell, nav, user switcher, notes panel

## Getting started

```bash
# database
cd api
docker compose up -d
cp .env.example .env

# api
npm install
npx prisma migrate dev
npx prisma db seed          # prints seeded user/org ids
npm run start:dev           # http://localhost:3100

# web
cd ../web
npm install
cp .env.example .env.local  # fill in an org id + default user id from the seed output
npm run dev                 # http://localhost:3000
```

## Fake auth

There is no real auth. Requests identify themselves with two headers:

- `x-user-id` — a seeded user id (the web app's top-right switcher sets this)
- `x-org-id` — the acting organization

Seeded org `roadco`: Alice, Bob (supervisors), Carol (site lead — approves claims, confirms dockets, manages projects/equipment), Dan (approver). Org `pavecorp`: Eve (site lead).

## Expense claims

**Lifecycle:** `DRAFT → SUBMITTED → APPROVED | REJECTED`, with `PARTIALLY_APPROVED` under the two-key rule.
Only the submitter lodges their own draft; approvals need the `claims.approve` permission; nobody acts on a
claim they submitted (no self-dealing). A rejected claim can be **corrected and reopened** by its submitter —
same reference, next revision — rather than re-created from scratch.

**Money.** Totals are ex-GST and exact to the cent (`decimal.js` + `Decimal` columns, one rounding point,
half-up). The **fuel levy** is applied once to the fuel subtotal at the effective-dated rate in force on the
claim's *expense date*, and that rate is **snapshotted on the claim** so a later rate change never alters an
already-lodged total. GST / inc-GST are shown for reference only and never stored.

**References** are `EXP {2-digit FY}-{seq}` (e.g. `EXP 26-0042`), issued per-org, per-FY from an atomic
sequence inside the write transaction — collision-free under concurrency. FY runs 1 Jul – 30 Jun, derived
from the expense date, never `now()`.

**Two keys, safely.** Above $1,000 ex-GST a claim needs two *different* approvers. Concurrency is handled two
ways at once: a DB unique constraint (`(claimId, revision, actorId)`) stops one person turning both keys, and
a compare-and-swap on the exact current status stops two people racing the same transition. Final approval —
and only final approval — emits a `claim.approved` outbox event, which is what feeds the burn dashboard.

**Endpoints** (all under `/api`, enveloped): `POST /claims`, `GET /claims` (paginated, filter by `status` &
`fy`), `GET /claims/:id` (with decision + audit history), `POST /claims/:id/submit | approve | reject |
reopen`, `POST /claims/import` (best-effort per-claim LegacyPlant CSV — valid claims created, invalid
ones reported with row numbers, real quoted-comma parsing), and `GET /claims/levy-rate?date=` (the
effective-dated rate for a date, so the new-claim preview matches the stored total).

**Screens** (`web/app/claims`): a filterable, paginated **list** with inline lifecycle actions; a **new-claim
form** with a live total that matches the server exactly; and a **claim detail** with the line items, the
GST-for-reference figures, the decision/audit timeline, the two-key state, and the correct-and-reopen editor.
Lifecycle actions are colour-coded (green submit/approve, red reject) and confirmed before they run.

**Tests.** `cd api && npm test` (unit) and `npm run test:e2e` (integration against Postgres). The golden
money examples, reference uniqueness under concurrency, the two-key race, and the CSV quoted-comma trap all
have tests.
