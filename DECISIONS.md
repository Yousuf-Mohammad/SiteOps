# Decisions

Design decisions, and the reasoning behind them, recorded as the work happened.

**How to read this document.** The risk log below is the summary — what could go wrong, how it's prevented,
and which phase proves it. Behind it sits a *before* snapshot: what the starter's claims module actually did
on arrival, recorded before any code was changed. The **Bug #** column links the two, so every risk can be
traced to the exact `file:line` defect it came from, and every change can be traced to the risk it answers.

**Scope.** This document covers the claims module only — `api/src/claims/`, the claims-owned schema models
(`Claim`, `ClaimLine`, `SurchargeRate`, and the `ClaimDecision` added in Phase 3), and `web/app/claims/`.
The platform kernel and the finished modules are treated as given and are not modified.

---

## Risk log (Phase 0.6)

Written before any implementation. Each row names a way the module can be wrong, the mechanism that
prevents it, the starter bug it corresponds to, and the phase whose test demonstrates it.

| # | Risk | Mitigation | Bug # | Proven in |
|---|---|---|---|---|
| 1 | Reference collisions under concurrency | `SequenceService.next(tx, orgId, 'claim')` claimed inside the write transaction — atomic `UPDATE … RETURNING`, so two requests can never receive the same value | 1 | Phase 4 (concurrent-create test) |
| 2 | Floating-point money errors | `decimal.js` for arithmetic + `Decimal` columns for storage; exactly one rounding point, half-up | 3, 4 | Phases 1, 3 |
| 3 | **Cross-org data leak (security)** | Every claims read *and* write filtered by `orgId`; client-supplied `projectId` validated against the acting org before use | 6, 9, 11 | Phases 4, 5 |
| 4 | Duplicate / double-key approvals | `@@unique([claimId, actorId])` on `ClaimDecision` — the same person physically cannot turn both keys, enforced by the database | — | Phase 7 |
| 5 | Lost-update race on decisions | Conditional `updateMany` with the expected status inside the WHERE clause, then `count === 0`; never read-then-write | — | Phase 7 (parallel-approval test) |
| 6 | Wrong levy — applied per line, or at a hardcoded rate | Applied **once** to the fuel subtotal, at the effective-dated rate for the expense date | 3 | Phases 1, 2 |
| 7 | Wrong financial year | FY helper derived from the **expense date**, never `now()`; 1 July boundary | 2 | Phase 2 |
| 8 | Totals mutate when rates change | Snapshot the rate and subtotals onto the claim at creation; never recompute from `SurchargeRate` on read | — | Phases 3, 4 |
| 9 | **Privilege escalation (security)** — client POSTs `{"status":"APPROVED"}` and skips the workflow entirely | Remove `status` from `CreateClaimDto`; creation is always `DRAFT`, status changes only through the workflow endpoints | 5 | Phase 4 |
| 10 | Self-dealing — the submitter approves their own claim, including as the second key | Explicit `submitterId !== actorId` check before the decision is inserted; 403 on violation | — | Phase 7 |
| 11 | State changes leave no trail; the burn dashboard is never told | `audit.record(…, tx)` on every transition, in the same transaction; `outbox.enqueue(tx, …)` **only** on final `APPROVED` | 7 | Phases 4, 6, 7 |
| 12 | Unguarded routes — anyone can create or approve | `@UseGuards(PermissionsGuard)` on the controller, `@Permissions('claims.create')` / `('claims.approve')` per route | 10 | Phase 8 |
| 13 | CSV import corrupts quoted values — `split(',')` breaks `"1,299.50"` into two fields | A real CSV parser; per-group best-effort so one bad line rejects only its own claim, with row numbers reported | — | Phase 9 |
| 14 | The web preview total disagrees with the stored total | Share or exactly mirror `computeTotals`; the duplication, if any, is recorded here | 14* | Phase 12 |

Rows 3 and 9 are security defects rather than ordinary bugs, and are called out as such.
Rows 4, 5, 8, 10 and 13 have no bug number because they are not *wrong* in the starter — the functionality
does not exist at all yet. *Row 14 refers to `WORKPLAN.md` item 14 (the web screens), not the Phase 0.5
inventory, which covers the API only.

**On the missing commit.** `plan.md:40` asks for a `docs: risk log` commit at this gate. This folder is not
a git repository, so no commit was made. Recorded here so the gap is a decision, not an oversight.

---

## Phase 1 — Money (`claim-totals.ts`)

Closes risk-log rows 2 and 6. New files: `api/src/claims/claim-totals.ts` + `claim-totals.spec.ts`.
`claims.service.ts` is deliberately **not** touched — wiring it in is Phase 4's job, once the schema can
store the result.

**Decimal, not float.** The brief says "exact to the cent" and states the goldens to the cent, so the
arithmetic has to be exact. `decimal.js` is the same library Prisma uses behind its `Decimal` columns, so
Phase 4 can hand `result.total` straight to Prisma with no conversion. Depending on `decimal.js` directly
rather than `Prisma.Decimal` keeps the function framework-free — no Prisma, no Nest, no clock.

**The levy applies once, to the fuel subtotal.** The starter multiplied the *whole* claim by `1.125`
(bug 3). Applying it per fuel line instead would still pass golden #1 and silently fail #2 — which is
precisely why the brief includes #2. The rate is a parameter; resolving *which* rate applies to an expense
date is Phase 2.

**One rounding point, and the parts must sum.** Line extensions are exact (integer quantity × a 2dp price),
so the only value needing rounding is the levy — `59.97 × 0.125 = 7.49625 → 7.50`. It is rounded *before*
the total is summed, rather than rounding the total at the end. That is what makes the four returned amounts
add up exactly, which matters from Phase 3 on, where all four are stored as separate columns and a reader
has to be able to check the arithmetic. A test asserts the invariant across six different claims.

Half-up is set on a **module-local `Decimal` clone**, not global config, so the rounding mode can't leak
into or out of other code. Banker's rounding would send `0.005 → 0.00`; a test pins the half-up behaviour.

**No input validation.** The function trusts its inputs. Rejecting negatives, zero quantities and
over-precise prices is DTO work in Phase 4; keeping it out here leaves the function single-purpose.

**Correction to `WORKPLAN.md:49`, which claims `3 * 19.99 = 59.970000000000006` in JS.** It does not —
that expression is exactly `59.97` in IEEE-754 double. The float error in the starter's golden-#1 path
comes from the *levy multiply* (`59.97 * 1.125 = 67.46625`), not the line extension. A test now pins a case
where multiplication genuinely does drift (`7 × 13.37 = 93.58999999999999`) so the exactness claim rests on
something true. Worth noting: golden #1 would have survived the float path by luck of rounding — it is
golden #2 that actually fails, at `$7.875` against a required `$7.25`.

### Starter gaps found while running the gate

- **`npm run lint` does not work.** The script exists in `api/package.json:9` but `eslint` is not in
  dependencies and there is no config file. Phase 14's gate requires lint to pass in both apps; that will
  need either an eslint setup or an explicit note that the script was left as-found. Not fixed here —
  adding lint tooling is outside the claims module.
- `npm run typecheck` fails on a fresh host checkout until `npx prisma generate` has run — five errors in
  starter files (`audit.service.ts`, `global-exception.filter.ts`, `reports.service.ts`) that are purely a
  missing generated client. Clean after generating.

---

## Phase 2 — FY & effective-dated levy rate (`claim-fy.ts`)

Closes risk-log rows 6 and 7. New files: `api/src/claims/claim-fy.ts` + `claim-fy.spec.ts`. Still pure —
no Prisma, no Nest, no clock. `claims.service.ts` remains untouched until Phase 4.

**FY comes from the expense date, never `now()`.** The starter used `new Date().getFullYear()`
(bug 2), so the same claim would be stamped differently depending on when it happened to be created — and
an expense dated `2026-08-01` got `26` when it belongs to FY27. References have to be reproducible, so the
FY is a function of the expense date alone. FY runs 1 Jul – 30 Jun and is named for the year it *ends*:
`month >= July → year + 1`, returned `% 100` for the two-digit `EXP 26-0042` format.

**UTC accessors are load-bearing.** Expense dates are stored as UTC midnight (`seed.ts` uses date-only
strings, and the DTO's `@IsDateString` converts the same way). Reading them with `getMonth()`/`getFullYear()`
shifts the day either side of Greenwich, and the FY boundary is exactly where that bites:
`2026-07-01T00:00:00Z` reads as 30 June anywhere west of UTC, silently producing FY26 for an FY27 expense.
This would never show up here — the dev host is UTC+6 and the container is UTC — so two tests pin it from
opposite directions: one fails east of Greenwich on local getters, the other fails west.

**`effectiveFrom` is inclusive**, so an expense dated exactly `2026-01-01` attracts the new 12.5%. That
matches how the seed reads ("12.5% from 2026-01-01") and how a rate change would be announced in practice.

**The resolver is order-independent.** It scans for the latest `effectiveFrom <= expenseDate` rather than
assuming a sorted input, so correctness doesn't depend on Phase 4 remembering an `orderBy`. Ties on the same
`effectiveFrom` resolve to the last one seen — the data model permits it, the seed never produces it.

**A missing rate throws rather than defaulting to 0%.** An expense predating every configured rate is a
configuration fault; charging no levy would understate the money with no signal at all. It throws a plain
`Error` (not a Nest `HttpException`) so the module stays framework-free — Phase 4 maps it to a 400.

**`SurchargeRate.ratePercent` stays `Float`** and is converted to `Decimal` at the boundary. `10` and `12.5`
are both exactly representable in binary floating point, so no precision is lost, and nothing downstream
does float arithmetic. Changing the column would be schema churn for no gain.

Two tests wire Phases 1 and 2 together end to end: the seeded rates resolve `2026-01-18` to 12.5%, which
feeds `computeTotals` to produce `67.47` — golden #1, and the stored total of seeded claim `EXP 26-0003`.
The same lines dated `2025-12-31` resolve to 10% and total `65.97`, which is the reproducibility argument
for snapshotting the rate in Phase 3 made concrete.

**Test rigour.** Five mutants were introduced and all five were caught: local getters instead of UTC (1
failure — only the UTC-boundary test, exactly as designed), the FY boundary off by a month (3), taking the
first applicable rate instead of the latest (6), exclusive instead of inclusive `effectiveFrom` (2), and
returning 0% instead of throwing (3).

---

## Starter audit (Phase 0.5)

Read-only pass over `api/src/claims/` and `api/prisma/schema.prisma`. No code changed in this phase.

### The module as it stands

| File | Size | Contents |
|---|---|---|
| `api/src/claims/claims.service.ts` | 60 lines | `create`, `findAll`, `findOne` |
| `api/src/claims/claims.controller.ts` | 28 lines | 3 routes, no guards, `// TODO: submit / approve / reject / import` |
| `api/src/claims/claims.module.ts` | 9 lines | controller + service only |
| `api/src/claims/dto/create-claim.dto.ts` | 34 lines | `ClaimLineDto`, `CreateClaimDto` |

There is no `list-claims.dto.ts` and no spec file anywhere in the module.

### Route surface

| Route | Handler call | Guard | Org-scoped? |
|---|---|---|---|
| `POST /api/claims` | `create(dto, user.id, orgId)` | none | yes |
| `GET /api/claims` | `findAll(orgId)` | none | yes |
| `GET /api/claims/:id` | `findOne(id)` | none | **no** |

Absent entirely: `submit`, `approve`, `reject`, `import`.

### DTO shape

`CreateClaimDto` — `projectId: string`, `expenseDate: @IsDateString`, `status?: string`, `lines: ClaimLineDto[]`.
`ClaimLineDto` — `description: string`, `quantity: @IsNumber`, `unitPrice: @IsNumber`, `isFuel?: boolean`.

### Validation gaps

- `status` is client-settable and should not be part of the create contract at all (bug 5).
- `lines` has no `@ArrayNotEmpty` — a claim with zero lines is accepted.
- `quantity` and `unitPrice` are bare `@IsNumber()`: negatives, zero, and unbounded decimal places all pass.
  No `@IsPositive`, no `@Min`, no `maxDecimalPlaces`.
- `api/src/main.ts:8` configures `ValidationPipe({ transform: true })` **without `whitelist`**, so unknown
  body keys are not stripped. Not currently exploitable for mass assignment — the service maps fields one by
  one — but it does mean the DTO is the only thing standing between the client and `status`.

### Entity relationships (`api/prisma/schema.prisma`)

- `Claim` → `Organization` (`orgId`), `Project` (`projectId`), `User` (`submitterId`); has many `ClaimLine`.
- `ClaimLine` → `Claim`, `onDelete: Cascade`.
- `SurchargeRate` → `Organization`; holds `ratePercent Float` + `effectiveFrom DateTime`. No index on
  `(orgId, effectiveFrom)`, which is the exact lookup the levy resolver will perform.
- `Claim.reference` is `@unique` **globally** rather than per-org — two orgs cannot hold the same reference,
  which is wrong for a per-org sequence.
- `Claim.total` and `ClaimLine.unitPrice` are `Float`. Money must be `Decimal` (Phase 3).
- `Claim.approvedBy` / `approvedAt` are single nullable columns. **The two-key rule cannot be represented in
  this schema** — one column cannot hold two approvers. This is why Phase 3 introduces `ClaimDecision`.

### Tooling state

- `api/test/` **does not exist**. `npm run test:e2e` runs `jest --config test/jest-e2e.json` and fails
  immediately on a missing config. There are zero spec files in the repo. Phase 4 scaffolds this.
- `decimal.js` is not a dependency yet; Phase 1 adds it.
- `AI-USAGE.md` does not exist yet.

---

## Bug inventory

Numbered so later sections can cite them. "Fix" states the intent, not yet the implementation.

| # | Location | What's wrong | Fix |
|---|---|---|---|
| 1 | `claims.service.ts:10-12` | Reference built from `claim.count() + 1`. Two concurrent creates both read the same count and mint the same reference; deleting a claim reuses a number. | `SequenceService.next(tx, orgId, 'claim')` claimed inside the write transaction. |
| 2 | `claims.service.ts:11` | `new Date().getFullYear()` — the calendar year of *now*. An expense dated `2026-08-01` belongs to FY27 but is stamped `26`. | Derive FY from `expenseDate` only, 1 Jul boundary. |
| 3 | `claims.service.ts:14-18` | Levy multiplied across the **entire** total, including non-fuel lines; rate hardcoded as `1.125`, ignoring the `SurchargeRate` table entirely. | Apply once to the fuel subtotal, at the effective-dated rate for the expense date. |
| 4 | `claims.service.ts:28` | `Math.round(total * 100) / 100` rounds a binary float — not exact, not reliably half-up. | `decimal.js`, half-up, a single rounding point. |
| 5 | `claims.service.ts:26` | `status: dto.status ?? 'DRAFT'` — a client can POST a claim that is already `APPROVED` and bypass the whole workflow. | Always `DRAFT` on create; drop `status` from the DTO. |
| 6 | `claims.service.ts:20` | `projectId` taken from the body and used without checking it belongs to the acting org — cross-tenant write. | Validate against `orgId` first, as `dockets.service.ts:43-48` does. |
| 7 | `claims.service.ts:20` | No `$transaction`, no `audit.record`, no `outbox.enqueue`. Nothing is logged, nothing downstream is notified. | Wrap in one transaction; audit and enqueue inside it. |
| 8 | `claims.service.ts:42-48` | `findAll` returns every claim in the org — no pagination, no filters. | `ListClaimsDto extends PaginationDto` with `status` + `fy`; reuse `paginationMeta`. |
| 9 | `claims.service.ts:50-52` | **`findUnique({ where: { id } })` with no `orgId` — any org can read any claim by id.** The most serious defect in the module. | `findFirst({ where: { id, orgId } })`; 404 when not in org. |
| 10 | `claims.controller.ts:6-8` | No `@UseGuards(PermissionsGuard)` and no `@Permissions(...)` on any route. | Guard the controller; `claims.create` on create/submit, `claims.approve` on approve/reject. |
| 11 | `claims.controller.ts:23` | `findOne` never forwards `orgId` to the service — this is what makes bug 9 reachable. | Pass `req.orgId` through. |
| 12 | `claims.module.ts` | Does not import the Sequence / Audit / Outbox modules, so the service has no access to the platform kernel. | Import them and inject into the service. |

### Reference implementation

`api/src/dockets/dockets.service.ts` is the answer key — it already demonstrates every pattern the claims
module is missing:

| Pattern | Line |
|---|---|
| Validate client-supplied ids belong to the acting org | `:43-48` |
| `sequence.next(tx, …)` inside the write transaction | `:51` |
| `audit.record(…, tx)` in the same transaction | `:64` |
| Race-safe status change — expected status inside the `updateMany` WHERE, then `count === 0` | `:86-94` |
| `outbox.enqueue(tx, …)` committing with the state change | `:110` |

`api/src/dockets/dockets.controller.ts:10-15` shows the `@UseGuards` + `@Permissions` shape.
`paginationMeta` already exists at `api/src/common/dto/pagination.dto.ts:19` and should be reused rather than
reimplemented.

