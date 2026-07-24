# CLAUDE.md

Guidance for working in this repo. SiteOps is an operations platform for Australian road-works
contractors. This is a take-home assessment: a working starter where **one module — expense claims —
is deliberately unfinished and buggy**, and the job is to finish it *the way the finished modules already do it*.

## The one rule that matters

**`dockets` is the answer key. `claims` is the deliberately broken module.**
Before writing any claims code, read `api/src/dockets/dockets.service.ts` and `dockets.controller.ts`.
Every pattern claims needs — org-scoped lookups, sequence-issued numbers, race-safe state changes,
audit + outbox inside one transaction, `@Permissions` guards — is demonstrated there. Match it; don't invent.

## Stack & layout

- **`api/`** — NestJS 11 + Prisma 6 + PostgreSQL. Global `/api` prefix, port 3100.
- **`web/`** — Next.js 15 (App Router) + TypeScript + TanStack React Query. Port 3000.

```
api/src/
  common/         platform kernel — DO NOT reinvent what lives here:
    interceptors/response.interceptor.ts   { success, data, meta?, timestamp } envelope (global)
    filters/global-exception.filter.ts     { success:false, error:{code,message} }; never leaks internals
    guards/permissions.guard.ts            reads req.user.permissions
    decorators/permissions.decorator.ts    @Permissions('claims.approve')
    dto/pagination.dto.ts                  PaginationDto (page/pageSize) + paginationMeta(total, dto)
    sequence/sequence.service.ts           sequence.next(tx, orgId, key) — atomic UPDATE…RETURNING
  audit/audit.service.ts                   audit.record(entry, tx) — pass tx to write in-transaction
  outbox/outbox.service.ts                 outbox.enqueue(tx, event) — dev relay logs deliveries every 10s
  auth/fake-auth.middleware.ts             x-user-id / x-org-id headers -> req.user / req.orgId
  projects|equipment|dockets|notes|reports/  finished platform modules
  claims/                                  ← THE TASK (Priya's create/read path + TODOs)
  users/                                   org members (dev user-switcher)
web/
  app/dashboard|projects|equipment|dockets/  finished screens (copy their shape)
  app/claims/                                two rough screens to rebuild
  lib/api/client.ts    apiGet/apiPost, unwraps envelope, attaches fake-session headers  ← use this
  lib/api.ts           OLD client the claims screens still use  ← migrate off it
  lib/query/keys.ts    queryKeys (add a `claims` entry)
  lib/use-acting-user.ts  acting user + can(permission) for UI gating only
```

## House rules (non-negotiable conventions)

1. **Multi-tenancy is enforced in every query.** Filter by `orgId` on reads *and* writes. Validate that
   any client-supplied id (projectId, etc.) belongs to the acting org before using it. `req.orgId` comes
   from the fake-auth header — never trust ids from the body.
2. **State changes are race-safe.** Put the expected current status *inside* the `updateMany` WHERE clause
   (`where: { id, orgId, status: 'DRAFT' }`) and check `count === 0`. Never read-then-write (TOCTOU).
3. **Audit + outbox go inside the same `prisma.$transaction`** as the mutation they describe. Emit domain
   events only via `outbox.enqueue(tx, …)`, never directly.
4. **Money is Decimal, ex-GST, exact to the cent.** The schema already uses `Decimal` for `Equipment.hireRatePerDay`
   and `Docket.hours`; claims currently uses `Float`, which is a bug. GST/inc-GST are display-only, never stored.
5. **Numbers come from `SequenceService`**, claimed inside the write transaction. Collisions are unacceptable; gaps are fine.
6. **Controllers use `@UseGuards(PermissionsGuard)` + `@Permissions(...)`.** Responses use the platform envelope
   (automatic via the global interceptor). Throw Nest `HttpException`s — the filter maps them to safe codes.
7. **Frontend uses `lib/api/client.ts` + React Query + `queryKeys`.** After approving a claim, invalidate both
   `claims` and `reports.burn` (approved claims feed the burn dashboard).

## Claims domain rules (from ASSESSMENT-BRIEF.md — read literally)

- **FY = 1 Jul – 30 Jun.** Derived from the **expense date only**, never `now()`. `2026-02-10` → FY26; `2026-08-01` → FY27.
- **Reference** = `EXP {2-digit FY}-{seq}`, e.g. `EXP 26-0042`; sequence is **per-org, per-FY**.
- **The levy** = fuel surcharge, applied **once on the fuel subtotal only**, rounded half-up to the cent,
  at the **effective-dated** rate in force on the expense date (seeded: 10% from 2024-07-01, 12.5% from 2026-01-01).
- **Golden examples (must hold exactly, 12.5%):** `3 × $19.99` fuel → **$67.47**; `$1 + $1` fuel + `$5` non-fuel → **$7.25**.
- **Reproducibility:** later rate changes must not alter an already-lodged claim's total → **snapshot the rate on the claim**.
- **Two-key rule:** ex-GST total **> $1,000.00** needs **two different** approvers (`SUBMITTED → PARTIALLY_APPROVED → APPROVED`).
  Exactly $1,000.00 is one key.
- **No self-dealing:** the submitter can never approve/reject their own claim, not even as the second key.
- **Lodgment:** only the claim's own submitter can submit it.
- **Import:** `POST /claims/import`, CSV columns `expense_date, description, quantity, unit_price, is_fuel, group`;
  rows sharing `group` = one claim. Best-effort per claim (one bad line rejects that whole claim, others still create);
  report row numbers + reasons in one response. Prices arrive quoted like `"1,299.50"` — real CSV parsing, not `split(',')`.

## Commands

**Everything in Docker (already wired — root `docker-compose.yml`):**
```bash
docker compose up -d --build       # db (5434) + api (3100) + web (3000); api auto-migrates & seeds
docker compose logs -f api         # watch a service
docker compose down                # stop (keeps data);  down -v wipes the DB
```
> Note: `down -v` reseeds with **new** random org/user ids. `web/.env.local` holds the roadco org id +
> Alice's user id and must be re-synced from the seed output if the volume is wiped.

**Local (per README):** `cd api && docker compose up -d && npm install && npx prisma migrate dev && npx prisma db seed && npm run start:dev`, then `cd web && npm install && npm run dev`.

**Checks:** `npm run typecheck` and `npm run lint` in **both** `api/` and `web/`. Tests: `npm test` (unit), `npm run test:e2e` (needs Postgres).

## Fake auth & seed

No real auth. Requests send `x-user-id` (seeded id) + `x-org-id`. Seeded org `roadco`: **Alice, Bob** (supervisors,
`claims.create`), **Carol** (site lead — `claims.approve` + manage), **Dan** (`claims.approve`). Org `pavecorp`: **Eve** (lead).
Seed prints ids on run (`docker compose logs api | grep org=`).

## Scope discipline (graded)

Do **not** add real auth, S3, email, or CRUD for seeded orgs/users/projects/equipment. Don't theme the UI. Don't gold-plate.
The deliverables `DECISIONS.md` and `AI-USAGE.md` are weighted heavily — record every starter change and its reasoning as you go.
See `plan.md` for the phased execution plan and `WORKPLAN.md` for the full bug inventory.
