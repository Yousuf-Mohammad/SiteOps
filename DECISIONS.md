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
| 15 | A corrected claim locks out its own approver — `@@unique([claimId, actorId])` means whoever rejected it can never rule on the fix | Scope the constraint to the revision being judged: `@@unique([claimId, revision, actorId])`; correcting a claim spends the old judgements and resets the keys | — | Phase 10 |

Rows 3 and 9 are security defects rather than ordinary bugs, and are called out as such.
Rows 4, 5, 8, 10 and 13 have no bug number because they are not *wrong* in the starter — the functionality
does not exist at all yet. *Row 14 refers to `WORKPLAN.md` item 14 (the web screens), not the Phase 0.5
inventory, which covers the API only.

**Row 15 was added during Phase 10, not written up front** — it only exists because Phase 7's fix to risk 4
collides with the reopen flow. It is recorded here rather than folded silently into the Phase 10 notes: a risk
log that only ever shrinks is a risk log that stopped being read.

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

- **`npm run lint` did not work in either app.** Both `package.json` files shipped a `lint` script but
  neither had ESLint installed and there was no config anywhere in the repo. Fixed after Phase 5 — see
  "Lint tooling" below.
- `npm run typecheck` fails on a fresh host checkout until `npx prisma generate` has run — five errors in
  starter files (`audit.service.ts`, `global-exception.filter.ts`, `reports.service.ts`) that are purely a
  missing generated client. Clean after generating.

### Lint tooling (added after Phase 5)

`api` and `web` both advertised a `lint` script that could not run: `eslint` was absent from both dependency
lists and no config file existed. Phase 14's gate requires lint to pass in both apps, so this was fixed
rather than documented as a known gap.

**api** — ESLint 9 flat config (`api/eslint.config.mjs`) on `typescript-eslint` recommended, with two
deliberate relaxations. `no-explicit-any` is a **warning**, not an error: the kernel's own documented usage
is `audit.record(entry, tx as any)` and every finished controller reads `(req as any).orgId`, so making it
an error would either fail the build on starter code or force 30-odd casts that add nothing.
`no-unused-vars` ignores `_`-prefixed arguments, which is how Nest signals a required-but-unused signature
parameter (`ResponseInterceptor`'s `_ctx`). Result: **0 errors, 33 warnings**, all of them the starter's
existing `any` usage. The script now also covers `test/**`, which it previously skipped.

**web** — `next/core-web-vitals` + `next/typescript` via `FlatCompat`. Two fixes were needed to get to zero:
`next-env.d.ts` is ignored (Next regenerates it every build and its triple-slash reference is Next's own,
not ours), and `lib/api/client.ts:28` had a genuine `any` on the pagination envelope — replaced with an
exported `PaginationMeta` interface, which Phase 11's pager will need anyway.

The script changed from `next lint` to `eslint .`: **`next lint` is deprecated and removed in Next 16**, and
calling the CLI directly is the migration Next itself recommends. It also drops a spurious "multiple
lockfiles" warning that `next lint` emitted because of an unrelated `package-lock.json` in the user's home
directory.

Both now exit 0, on the host and inside the containers.

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

## Phase 13 — Claim detail: two-key UI, timeline, and full reopen

The last screen, and the one where the two-key rule has to become *legible* (`ASSESSMENT-BRIEF.md:60`). New
`web/app/claims/[id]/page.tsx`, built on the `web/app/projects/[id]/page.tsx` shape. The Phase 11 list rows
now link here — the link that phase deliberately deferred until the route existed.

### What the page shows

- **Line items** and a totals block: Total (ex-GST) from `claim.total`, then **GST (10%)** and
  **inc-GST** *labelled "for reference"* — `ASSESSMENT-BRIEF.md:29` is explicit that nothing is stored or
  thresholded inc-GST. GST is computed with `decimal.js` (half-up), never floats. The stored levy snapshot
  (`levyRatePercent`, `levyAmount`, `fuelSubtotal`) is shown too, so the once-on-fuel maths is visible.
- **A history timeline** from the `audit[]` array — every transition with the actor's name (mapped from the
  `users` roster via `useActingUser`), a human label, and the `before → after` status. Audit is the full
  trail and carries the actor for every transition, so it drives the timeline; `decisions[]` is used only for
  the pending-key banner.
- **The two-key state, made legible.** When `PARTIALLY_APPROVED`, a banner names who turned the first key —
  derived from the `decisions` entry with `revision === claim.revision && decision === 'APPROVE'`. The
  revision scope matters: after a reopen, a prior revision's decisions must not be read as the current pending
  key. Verified live: Dan approves a $1,750 claim → "🔑 Dan Okafor turned the first key… awaiting a second,
  different approver"; Carol (a different approver) finishes it → APPROVED, and the dashboard burn rose by
  exactly $1,750.

### Gating — permission *and* ownership, mirroring the server

Approve/Reject show only when `can('claims.approve')` **and** the status is actionable **and**
`actingId !== submitterId`. The self-dealing hide is a UI courtesy — the API enforces it regardless — but
showing an approver a button that can only 403 on their own claim is a worse experience than not showing it.
The `reports.burn` invalidation on a decision is the house rule (`CLAUDE.md` §7): approved claims feed burn,
so the dashboard must be told. The `['claims']` prefix invalidation covers both the list and this detail
query in one call.

### Reopen, in full (the user's scope choice)

A REJECTED claim, viewed by its **own submitter**, gets an inline "Correct and reopen" editor pre-filled with
the claim's lines, a live total, and a submit that posts corrected lines to `/reopen`. Expense date and
project are deliberately not editable — Phase 10 fixed them as the claim's identity (reference, FY, rate).
Verified live: reopening the $500 claim at quantity 2 previewed $1,000 and stored a DRAFT revision 2 with
that total.

### The refactor that keeps two live totals identical

The reopen editor and the Phase 12 new-claim form both need a line-array field editor with a live total.
Rather than duplicate, both now use a shared `web/components/claim-line-fields.tsx` (`ClaimLineFields` +
`TotalPreview`) and a shared `web/lib/claim-lines.ts` (`lineSchema`, `emptyLine`, `LEVY_RATE_PERCENT`,
`linesToPayload`, `previewTotals`). The new-claim form was refactored onto them; the Phase 12 goldens were
re-run in the browser afterwards ($67.47, $7.25) and the `web`↔`api` `computeTotals` parity check still
matches, so the extraction changed no behaviour. One consequence worth noting: because both editors share
`previewTotals`, there is now exactly *one* client-side total implementation, which is the strongest form of
risk-14's "share or exactly mirror".

---

## Phase 12 — New-claim form, with a total that matches the server

Closes risk-log row 14. Rebuilds `web/app/claims/new/page.tsx` on the house pattern
(`web/app/dockets/new/page.tsx`): react-hook-form + zod, `useFieldArray` for the line list, a `useMutation`
that invalidates `claims` and returns to the list. Retires `lib/api.ts` — the form was its last caller, so
the file is deleted, completing the migration Phase 11 began.

### The bug the golden examples exist to catch

The starter form applied the levy **per line**, inside the loop:
`amount += Math.round(amount * 0.125 * 100) / 100`. `3 × $19.99` fuel survives that by luck; `$1 + $1` fuel
`+ $5` non-fuel does not — per line it rounds to `$1.13` twice and totals **$7.26**, where the levy applied
once to the `$2` fuel subtotal is `$0.25` and the total is **$7.25**. That one cent is exactly what Golden #2
is designed to expose. Verified live in the browser: the rebuilt preview reads `$7.25`.

### The preview is a mirror of the server's `computeTotals`, not a re-implementation

The preview must equal what the server stores. Reimplementing the arithmetic in float would drift on
half-cent cases, so `web/lib/claim-totals.ts` is a **deliberate line-for-line copy** of
`api/src/claims/claim-totals.ts` — same `decimal.js` clone, same half-up, same single rounding point — and
`decimal.js` was added to `web` so the arithmetic is identical, not merely similar. The two packages don't
share a build, so the duplication is unavoidable and is called out in the file header. A parity check runs
both functions over the two goldens and a half-cent case and asserts identical output; if they ever diverge,
that check fails. This is risk 14 handled by *elimination* (the numbers are provably the same), with the
duplication as the acknowledged cost.

### The one honest gap: the levy rate is hardcoded at 12.5%

The server resolves the rate by expense date (10% before 2026-01-01, 12.5% on/after) from `SurchargeRate`,
which **no endpoint exposes**. The preview hardcodes the current 12.5% rather than adding a rate-lookup
endpoint — a deliberate choice to keep this phase web-only. **Consequence:** a fuel expense back-dated before
2026-01-01 previews at 12.5% while the server stores 10%. Every present-day claim (today is FY26) and both
goldens match exactly, and the server is always authoritative — the *created* claim is correct regardless,
because the server recomputes; only the pre-submit preview can drift, and only for historical fuel dates.
The alternatives were weighed: a `GET /claims/levy-rate?date=` endpoint would close the gap for all dates
(reusing `resolveLevyRate`), and mirroring the rate *table* client-side would match until a rate changes
server-side and the copy goes stale — the worst option, since it duplicates the most volatile thing. The
bounded, documented gap was chosen over both.

### Validation mirrors the DTO

The zod schema restates `CreateClaimDto`/`ClaimLineDto`: project and expense date required, at least one line,
description 1–500 chars, quantity a positive whole number (`@IsInt @IsPositive`), unit price positive with at
most two decimals (`@IsNumber({maxDecimalPlaces:2})`). Verified live: submitting with no project, no date and
blank descriptions surfaces inline messages and makes no network call; `1.005` is rejected before submit.

---

## Phase 11 — Claims list

Rebuilds `web/app/claims/page.tsx` on the same house pattern as the dockets list: `useQuery` with
`keepPreviousData`, a new `queryKeys.claims` entry, status + FY filters, a pager, and explicit
loading/error/empty states — replacing a one-shot `useEffect` fetch on the old `lib/api.ts` client.

Two small things worth recording. **`lib/api.ts` is retired across two phases, not one:** it had two callers
(the list and the form), so Phase 11 moved the list and Phase 12 deleted the file once the form followed —
deleting it in Phase 11 would have broken the form mid-series. And **the list surfaced a real CSS gap:**
`PARTIALLY_APPROVED` is a valid status with no badge rule, so it was rendering on the flat grey base. One
amber rule was added (matching `SUBMITTED`, its in-flight sibling) — the list is simply the first screen to
display that status.

Verified live in the browser (the Windows Docker bind mount silently serves a stale build on file change, so
a `.next` clear + `web` restart is required before trusting the page, and the DOM is read rather than relying
on HTTP 200): status filter narrows the list and the pager total tracks; FY 27 gives a clean empty state,
FY 26 restores all rows; the `PARTIALLY_APPROVED` badge renders amber.

---

## Phase 10 — The rejected-claims question

The brief's one deliberately unanswered question (`ASSESSMENT-BRIEF.md:52`): an ops lead mentioned in passing
that rejected claims *"usually come back around after the supervisor fixes them."* Nothing else is written
down. Opens and closes risk-log row 15.

Before this phase `REJECTED` was terminal — `decide` accepts only `SUBMITTED`/`PARTIALLY_APPROVED` and
`submit` only `DRAFT`, so a rejected claim was a dead row. The supervisor's only recourse was to author a
fresh claim, which burns a sequence number and severs the trail between the two.

### The decision: correct in place, version by revision

`POST /claims/:id/reopen` moves `REJECTED → DRAFT` on the **same claim**, incrementing a new `revision`
counter. The body optionally carries corrected `lines`.

**Why the same claim keeps its reference.** `EXP 26-0007` is the claim's identity — on the paper trail, in the
finance inbox, and in the yard where someone says "0007 came back". Issuing `EXP 26-0012` for a corrected
`EXP 26-0007` leaves two numbers for one real-world expense and makes anyone reconciling them do a join that
exists nowhere on paper. The reference names the *expense*; the revision records that the money underneath it
moved.

**Why correction and transition are one call.** The alternative — reopen to DRAFT, then `PATCH` the lines —
creates an editable-DRAFT surface the brief never asks for (`ASSESSMENT-BRIEF.md:50` lists no PATCH) and
allows a half-fixed claim to sit between two requests. One endpoint, one transaction: the claim is either
still rejected or correctly reopened.

**`lines` is optional.** Omitting it reopens the claim unchanged, which is the "rejected in error" case. The
supplied list *replaces* the existing lines rather than patching them: a claim line has no identity of its
own, and reconciling ids would invent one.

**`expenseDate` is immutable.** It fixes the FY inside the reference and selects the levy rate. Allowing it to
change would make `EXP 26-0007` name a claim it no longer describes. A claim for a different date is a
different claim.

**Reopening is authoring, not approving.** It takes `claims.create` and is restricted to the claim's own
submitter — the same permission and the same ownership rule as `submit`. The approver decides; the submitter
fixes. Correspondingly, reopening publishes **no** outbox event: a claim going back for correction is
internal traffic, and `claim.approved` stays the only domain event this module emits.

### The constraint this exposed — risk 15

Phase 7 put `@@unique([claimId, actorId])` on `ClaimDecision` as the physical guarantee that one person cannot
turn both keys. The reopen flow collides with it head-on: Carol rejects `EXP 26-0007`, the supervisor fixes
it, and Carol is now **permanently unable to rule on the correction she asked for** — `decide` throws
`409 You have already recorded a decision`. The approver most qualified to confirm the fix is the one person
locked out of it.

This was not visible before Phase 10, because nothing could follow a rejection.

The fix is to scope the constraint to what the decision was actually about:

```prisma
@@unique([claimId, revision, actorId])   // was [claimId, actorId]
```

A decision is a judgement about a specific set of numbers. When the numbers change the judgement is spent, and
the keys reset. Carol rejecting revision 1 and approving revision 2 is not one person turning two keys — it is
one person ruling on two different claims that happen to share a reference. Within a revision the original
guarantee is untouched: the same person still cannot decide twice.

Everything else falls out of the status reset. A claim that reached `PARTIALLY_APPROVED` before being rejected
comes back as `DRAFT`, so the two-key count starts from zero — a corrected claim never arrives half-approved.
Prior revisions' decisions are **retained**, not deleted; who rejected what, and when, is the audit trail.

### Money does not move because the claim was corrected

Totals recompute from the `levyRatePercent` **snapshotted on the row**, never a fresh `resolveLevyRate`
lookup. The claim is priced by the rate in force the day the expense was incurred; that is settled at
creation, and fixing a typo in a quantity must not silently reprice the claim because a newer rate has since
taken effect. This is risk-log row 8 applied to a case that did not exist when the row was written.

The test asserts it under adversarial conditions: a 30% rate is inserted *between* the rejection and the fix,
and the corrected total still prices at the snapshotted 12.5%.

### Race safety

`REJECTED` sits inside the `updateMany` WHERE, exactly as `submit` and `decide` do it. Two supervisors
reopening at once produce one 201 and one 409, and the revision lands on **2, not 3**. That last assertion is
the point: a read-then-write would produce revision 3 and two audit rows for one correction.

Ownership is checked outside the compare-and-swap, unlike in `submit`. That is not a TOCTOU — `submitterId` is
immutable after creation, so it cannot change under the check. Only `status` races, and it stays in the WHERE.

### Verification

18 e2e tests (`api/test/claims-reopen.e2e-spec.ts`), of which the load-bearing one is: Carol rejects a $1,750
claim → the supervisor reopens it at $1,600 → resubmits → **Carol approves** (first key) → Dan approves →
`APPROVED`, one outbox event. That test fails with a 409 on the pre-Phase-10 constraint.

**Mutation testing** (two mutants, both killed, restored from a file backup rather than `git checkout` —
see the Phase 5 process note):

| Mutant | Result |
|---|---|
| `ClaimDecision.revision` hardcoded to `1` (i.e. the old constraint's behaviour) | 4 failures — all four revision-isolation tests |
| `status: 'REJECTED'` dropped from the reopen WHERE | 4 failures — the three wrong-status tests **and the concurrency test**, which is what proves the CAS bounds the revision |

Live round trip against the running container confirmed the whole cycle end to end, with the database showing
decisions stamped `(1, REJECT)`, `(2, APPROVE)`, `(2, APPROVE)`, a `claim.reopened` audit row recording
`1750.00 → 1600.00`, and exactly one `claim.approved` outbox event carrying the corrected total.

**Migration:** `20260725090000_claim_revisions`. Both columns default to `1`, so existing rows are revision 1 —
which is what they have always effectively been — and the new unique key is strictly weaker than the one it
replaces, so no existing row can violate it. No backfill needed.

---

## Phase 9 — Best-effort CSV import

The last endpoint. Closes risk-log row 13.

**The parser is hand-rolled, not a dependency.** The brief plants the trap explicitly — prices arrive as
`"1,299.50"`, and `split(',')` turns a six-column row into seven fields with the money cut in half. Parsing
is the skill being probed, so `csv.ts` is a ~90-line RFC 4180 reader handling quoted commas, quoted newlines,
`""` escapes, CRLF, a UTF-8 BOM, and blank rows. It carries **1-based line numbers through the whole
pipeline**, including past skipped blank lines, so a rejection report points at the line the operator sees in
their spreadsheet — verified live: a file with a blank line 4 still reported the bad row as `5`.

**The CSV has no project column, so the project comes from the request.** `POST /claims/import` takes
`projectId` as a form field alongside the file — one export, one job. Validated against the acting org
exactly as `POST /claims` does, once up front: if the project is wrong, nothing in the file can succeed and
reporting it per group would be noise.

**Import reuses `create()` rather than a bulk insert.** Every imported claim therefore gets the same org
validation, effective-dated rate, exact totals, sequence-issued reference and audit row as any other claim.
There is no second code path to keep in step — confirmed by a test asserting golden #1 arriving via CSV
stores `67.47` with `levyRatePercent` snapshotted.

**Best-effort means each group commits in its own transaction.** Wrapping the whole import in one transaction
would be the *opposite* of best-effort: one bad group would roll back every good one. A test proves the
distinction by putting a group with an expense date predating every levy rate *after* a valid group — the
first claim persists, the second is reported.

**Whole-file failures are 400; per-group failures are 200 with a report.** The request was well-formed even
though some of its contents weren't. Missing or misordered headers, an empty file, a missing file, a missing
or foreign `projectId` — all 400. Bad rows, bad groups, ungrouped rows — all reported in the response body.

**Headers may arrive in any order**; only their presence is required. Rows sharing a `group` form one claim
**even when non-contiguous** — same group means same claim.

**A group whose rows disagree on `expense_date` is rejected** rather than silently taking the first. One
claim has one expense date, and both the FY in its reference and the levy rate applied hang off it; picking
arbitrarily would fabricate data that looks authoritative.

### Test rigour

48 new unit tests (101 total) plus 19 e2e (114 total). The decisive mutation: swapping the parser for the
naive `split(',')` implementation fails **11 unit tests and the end-to-end quoted-price test** — the claim's
stored total comes out wrong rather than the request erroring, which is exactly why this needed a test rather
than a review.

Verified live against a realistic file:

```
created:  G1 EXP 26-0004 total=67.47    rows=[2]
          G2 EXP 26-0005 total=3299.50  rows=[3,6]    <- non-contiguous, "1,299.50" intact
rejected: G3 rows=[5] row 5: quantity "notanumber" is not a whole number
          G4 rows=[7,8] rows disagree on expense_date (2026-01-18, 2026-03-02)
summary:  { groups: 4, created: 2, rejected: 2 }
```

---

## Phase 8 — Permission guards

Closes bug 10 / risk-log row 12 — the last authorization gap in the backend.

**The hole was real and demonstrated, not theoretical.** During the Phase 7 verification, **Bob turned the
first key on a $1,750 claim** despite holding only `claims.create`. No claims route had a guard, so the
seeded permission model was decorative. Now:

```
Bob approves    -> FORBIDDEN: Missing permission: claims.approve
Alice approves  -> FORBIDDEN: Missing permission: claims.approve
Carol approves  -> PARTIALLY_APPROVED
Dan approves    -> APPROVED
```

| Route | Permission |
|---|---|
| `GET /claims`, `GET /claims/:id` | — (org-scoped only) |
| `POST /claims`, `POST /claims/:id/submit` | `claims.create` |
| `POST /claims/:id/approve`, `/reject` | `claims.approve` |

**Reads carry no permission because no such permission exists in this system.** Every other module guards
reads with `<module>.read`, but **no seeded user holds `claims.read`** — enforcing an invented one would 403
every seeded user and break the web app, and borrowing `claims.create` would assert something untrue ("you
may read claims because you may create them"). `NotesController` is the precedent: a finished module that
attaches the guard at class level and declares no per-route permissions, relying on org scoping. Claims does
the same. The model stays honest — only permissions that are actually granted are enforced.

**`submit` takes `claims.create`, not a permission of its own.** Lodging is the tail of authoring. Note that
permission and ownership are *separate* checks doing different jobs: the permission answers "may you do this
kind of thing", the Phase 6 ownership rule answers "may you do it to *this* record". A test covers Bob —
who clears the guard with `claims.create` and is then stopped by ownership with a different message.

**Denied requests never reach the service.** A test asserts the database is untouched after a refused
approval — no `ClaimDecision`, no audit row, no status change, no outbox event — rather than merely checking
the status code. Confirmed live: after Bob's and Alice's denied attempts, only Carol's and Dan's decisions
exist.

**The guard must not change Phase 5's isolation semantics** — a foreign claim still 404s rather than 403ing,
since a 403 would confirm the id exists. Asserted explicitly.

### A test-fixture bug this phase exposed

The e2e harness gave carol/dan `claims.approve` **without** `claims.create`, unlike the real seed where site
leads hold both. Once guards existed, the self-dealing tests would have passed for the wrong reason: an
approver submitting and then approving their own claim would be blocked by the *permission* guard, never
reaching the self-dealing rule they were written to exercise. Fixed the harness to mirror the seed, and
rewrote those tests to use Carol — who holds `claims.approve` — so they now test what their names claim.
A test that passes for the wrong reason is worse than one that fails.

**Test rigour.** 13 new e2e tests (95 total). Removing `@UseGuards(PermissionsGuard)` fails 7 of them.

---

## Phase 7 — Two-key approval

The centrepiece. Closes risk-log rows 4, 10 and 11, and finishes row 5.

### Two independent guarantees, doing different jobs

This is the part worth being precise about, because the two are easy to conflate:

- **`@@unique([claimId, actorId])` on `ClaimDecision`** stops the **same person** turning both keys. A
  *correctness* rule, enforced by Postgres rather than by a query the application could forget to run.
  A duplicate raises `P2002`, caught and rethrown as 409 *"You have already recorded a decision on this
  claim"* — the generic filter message would say "a record with these values already exists", which explains
  nothing to a reviewer.
- **Compare-and-swap on the exact observed status** stops **two different people** both winning the same
  transition. A *concurrency* rule.

Neither substitutes for the other. The unique constraint is useless against two distinct approvers racing;
the CAS is useless against one person submitting twice with different timing.

### A real bug the tests caught

My first implementation matched a *set* of acceptable source statuses:
`where: { status: { in: ['SUBMITTED', 'PARTIALLY_APPROVED'] } }`. Two approvers racing on a `SUBMITTED`
$1,750 claim then **both succeeded** — the second found `PARTIALLY_APPROVED`, which the first had just
written, still inside the set, and overwrote it with the same value. Two keys were burned and the claim never
advanced.

The fix is genuine compare-and-swap: `where: { id, orgId, status: claim.status }` — the exact status the
decision was computed from. Anything else and the second writer silently no-ops.

The lesson is that "put the status in the WHERE clause" is not sufficient on its own; it has to be the
*expected* status, not a set of tolerable ones. The concurrency test is what surfaced this — it was written
before the implementation was believed correct, and it failed the first time it ran.

### The rules, as implemented

| Action | From | Condition | To |
|---|---|---|---|
| approve | `SUBMITTED` | total ≤ $1,000.00 | `APPROVED` |
| approve | `SUBMITTED` | total > $1,000.00 | `PARTIALLY_APPROVED` |
| approve | `PARTIALLY_APPROVED` | — | `APPROVED` |
| reject | `SUBMITTED` or `PARTIALLY_APPROVED` | — | `REJECTED` |

**The threshold is `>`, not `>=`.** The brief says the rule applies when the total *exceeds* $1,000.00, so
exactly $1,000.00 is one key and $1,000.01 is two. Compared as `Decimal`, never a float. Both sides of the
boundary are asserted, because that is exactly where an operator slip hides.

**No self-dealing** is checked explicitly and *first*, so the submitter gets an error naming the real reason
rather than a confusing state conflict later. It applies to rejection too, and to the second key — a test
covers the case where the submitter tries to finish a claim someone else has already part-approved.

**Rejection is single-key and decisive from either state.** One reviewer objecting stops the claim even after
a colleague approved it; the earlier `APPROVE` row stays as history, so Phase 13's timeline can show the
disagreement rather than hiding it.

**Only final approval publishes.** `outbox.enqueue` fires when the status actually becomes `APPROVED`, never
on a first key — verified live: a two-key claim produced exactly one `claim.approved` event, and the dev
relay delivered it. `reports.service.ts` sums `status: 'APPROVED'`, so burn moved with no extra wiring.

**The loser of a race is rolled back entirely** — its decision row disappears with the transaction, so a 409
leaves no trace and the reviewer simply retries, at which point their decision lands as the second key. A
test walks exactly that recovery.

### Test rigour

26 new e2e tests (82 total). Three mutants, all killed:

| Mutation | Tests failed |
|---|---|
| `>` → `>=` on the threshold | 1 (the $1,000.00 boundary) |
| CAS → match any acceptable from-status | 3 (all race-safety cases) |
| Remove the self-dealing check | 4 |

Verified live end to end: submitter → 403, Carol → `PARTIALLY_APPROVED`, Carol again → 409, Dan → `APPROVED`;
$1,000.00 → one key; $1,000.01 → two; reject from `PARTIALLY_APPROVED` → `REJECTED`. Audit trail reads
`claim.created → claim.submitted → claim.partially_approved → claim.approved`.

---

## Phase 6 — Lodgment (`submit`)

The first state change in the module, and the first place the race-safety pattern lands. Closes risk-log
row 5 for this transition.

**Ownership and state are enforced in one atomic statement.** The `updateMany` WHERE carries all four
conditions — `{ id, orgId, status: 'DRAFT', submitterId: actorId }` — so the database decides, not the
application. Of two racing submissions exactly one gets `count: 1`; a read-then-write would let both through
(TOCTOU) and audit the transition twice.

**The follow-up read only explains a failure, it never decides one.** On `count === 0` the service re-reads
inside the same transaction purely to produce a useful message:

| Cause | Code | Message |
|---|---|---|
| No such claim in this org | 404 | `Claim <id> not found` |
| Actor is not the submitter | 403 | `Only the submitter can lodge this claim` |
| Status is not `DRAFT` | 409 | `Claim is SUBMITTED, expected DRAFT` |

**Ownership is checked before status.** "You may not act on this claim at all" outranks "wrong state", so a
colleague trying to lodge someone else's already-submitted draft gets the 403 that actually explains the
problem. 403 leaks nothing here — any org member can already read that claim through `GET /claims/:id`, which
is exactly why the same information is a 404 across orgs and a 403 within one.

**No outbox event.** The brief reserves the domain event for *final* approval, which is what the burn
dashboard consumes. Lodgment is audited, not broadcast — a test asserts the outbox stays empty.

**Only `DRAFT` is lodgeable.** Whether a `REJECTED` claim can be re-lodged is Phase 10's open question and is
deliberately not answered here.

**Test rigour.** 15 new e2e tests. Replacing the conditional `updateMany` with a read-then-write — the exact
TOCTOU shape `dockets.service.ts:80-83` warns about — fails **3 of them**: the two-way race, the
audited-exactly-once assertion, and the five-way burst. Those three tests are the entire reason the pattern
is worth writing this way, and they were confirmed to fail without it rather than assumed to.

Verified live as well: Bob → 403, Alice → 201, Alice again → 409, with an audit trail reading
`claim.created (→DRAFT)` then `claim.submitted (DRAFT→SUBMITTED)`.

---

## Phase 5 — Org-scoped detail, paginated list

Closes bugs 8, 9 and 11, and completes risk-log row 3. `create` is untouched.

**The cross-tenant leak is closed.** `findOne` was `findUnique({ where: { id } })` with no `orgId`, and the
controller never passed one. Now `findFirst({ where: { id, orgId } })` — `findUnique` cannot express a
compound condition on a non-unique pair, so the method signature had to change too. Proven live: the exact
request that returned `200` with pavecorp's `EXP 26-0101` to a roadco user now returns `404`.

**A foreign claim 404s identically to a nonexistent one.** Returning 403, or a distinguishable message,
would confirm the id is real — which is itself a leak. A test asserts both paths produce the same error code.

**FY filtering is a date range over `expenseDate`, not a string match on the reference.** The reference is a
label; the expense date is the fact, and the two could disagree if a reference were ever corrected. Added
`fyDateRange(fy)` to `claim-fy.ts` as the inverse of `fyForDate`, returning a **half-open** UTC interval —
FY26 → `[2025-07-01, 2026-07-01)`. Half-open avoids the classic bug: an inclusive upper bound needs the last
representable instant of 30 June, and any expense stored with a time component falls through the gap.
Unit tests assert both ends round-trip through `fyForDate` and that consecutive years are exactly adjacent.

Verified live at the boundary: a claim dated `2026-06-30` appears under `fy=26` and gets `EXP 26-0004`;
`2026-07-01` appears only under `fy=27` and gets `EXP 27-0001`.

**Pagination orders by `expenseDate desc, id desc`.** The `id` tiebreak is load-bearing — without it, claims
sharing an expense date can reorder between page requests, so a row is returned twice or skipped. A test
walks all pages of a 7-claim set and asserts each id is seen exactly once. The starter ordered by
`createdAt desc` alone. Page and count run in one `$transaction` (the `dockets.service.ts:25` pattern) so
`meta.total` can't disagree with the page.

**The list no longer embeds line items.** It returns references, statuses, the money snapshot and the
project. Lines belong to the detail endpoint; fanning out a join per row for data no caller reads is waste.
Non-breaking — the existing web list only reads reference, status, expenseDate, total and project.

**Detail returns `lines`, `decisions` and `audit`.** `decisions` is a real relation since Phase 3, so it is
included; `AuditLog` has no relation to `Claim`, so it comes from `AuditService.forEntity` rather than a
hand-rolled query.

**Filters are `status` + `fy` only.** `projectId` would mirror `ListDocketsDto` and is plausibly useful, but
nothing in the brief asks for it and unused filters read as gold-plating.

**Test rigour.** 18 new e2e tests. Removing `orgId` from the `findOne` where-clause — reinstating the exact
starter bug — fails 2 of them.

### A process note worth recording

Reverting that mutation with `git checkout -- claims.service.ts` silently discarded the **uncommitted**
Phase 5 work along with the mutation, because checkout restores from the last commit, not from a pre-mutation
snapshot. The same mistake happened in Phase 2 with an untracked file. Mutation testing needs an explicit
file backup, not `git checkout`, whenever the working tree holds uncommitted changes. Caught immediately
because the suite went from 41 passing to reporting the old method signatures.

---

## Phase 4 — Safe `create` + the e2e harness

Closes risk-log rows 1, 3 (write half), 9 and 11, and retires bugs 1–7. First phase to touch
`claims.service.ts`. `findAll`/`findOne` are deliberately left broken — Phase 5 owns them.

**`create` now follows `dockets.service.ts` exactly.** The project is org-validated before anything else
(400 if it isn't ours), then one `$transaction` does the rest: read the org's rates → `resolveLevyRate` →
`computeTotals` → `sequence.next(tx, orgId, 'claim:<fy>')` → write the claim → `audit.record(…, tx)`. The
rate that prices the claim, the number that identifies it, and the record that it happened all commit or roll
back together. A rolled-back create skips a sequence value rather than reusing it — gaps are fine, duplicates
are not.

**Status is hardcoded `'DRAFT'`** and `status` is gone from `CreateClaimDto`. `main.ts` runs the
`ValidationPipe` without `whitelist`, so an unknown key is ignored rather than rejected — removing the field
is enough, and a test POSTs `{"status":"APPROVED"}` to prove the claim still lands as DRAFT.

**Validation now guards the money path**: `@ArrayNotEmpty` on lines, `@IsInt`/`@IsPositive` on quantity,
`@IsPositive` + `maxDecimalPlaces: 2` on unitPrice. A three-decimal price would otherwise be rounded away
silently, and a claim with no lines would total `$0.00`.

**A missing surcharge rate becomes a 400, not a 500.** `resolveLevyRate` throws a plain `Error` by design
(Phase 2 keeps it framework-free); the service catches it and rethrows as `BadRequestException`.

### Correction: bug 12 was wrong

The Phase 0.5 audit claimed `claims.module.ts` couldn't reach the kernel because it doesn't import
Sequence/Audit/Outbox. **It can** — all four kernel modules are `@Global()`, which is why `dockets.module.ts`
also has no `imports` array yet injects all three services. `plan.md:108` carries the same mistake. No module
change was needed; only the service constructor. The inventory entry is struck through rather than deleted,
since a withdrawn finding is part of the record.

### `GlobalExceptionFilter` was dead code

It was defined but never registered — no `APP_FILTER`, no `useGlobalFilters`. Errors came back as raw Nest
defaults (`{"message":"Unknown user","error":"Unauthorized","statusCode":401}`) rather than the envelope
`CLAUDE.md` documents as global behaviour. Registered via `APP_FILTER` in `app.module.ts`, mirroring the
`APP_INTERCEPTOR` already there. Errors are now
`{"success":false,"error":{"code":"BADREQUEST","message":"Unknown project"},"timestamp":…}`.

This is outside `api/src/claims/`, but Phase 4's and Phase 8's gates both assert on enveloped errors, and the
frontend client (`web/lib/api/client.ts:40`) already reads `body.error.message` — it was coded against a
contract the server wasn't honouring.

### Observed but not fixed: the auth stand-in doesn't bind user to org

`auth/fake-auth.middleware.ts:20-26` looks the user up by id and accepts whatever `x-org-id` is sent — it
never checks `user.orgId === orgId`. Any valid user id can be paired with any org id. Not fixed: it is the
fake-auth stand-in, and the brief explicitly says not to add real auth. It is, however, precisely why the
service must scope every query by `req.orgId` and validate client-supplied ids rather than trusting the
caller — the defence has to live in the data layer because the auth layer isn't one.

### The e2e harness

`npm run test:e2e` pointed at `test/jest-e2e.json`, which never existed. Now scaffolded:

- `test/setup-app.ts` boots the real `AppModule` and configures it **exactly as `main.ts` does** (same global
  prefix, same `ValidationPipe`), so tests exercise the real pipeline including the envelope and the filter.
- **Each run creates its own organization** with its own users, project and rates, and deletes everything
  under that `orgId` afterwards. Seeded data is never touched, `npm run test:e2e` needs no setup beyond a
  running container, and a brand-new org means its claim sequence starts at 1 — so `EXP 26-0001` can be
  asserted without depending on what else is in the database. Verified after a full run: still exactly two
  orgs, the four seeded claims unchanged, sequences still 4 and 102.
- 23 tests covering reference format and per-FY numbering, both golden examples, effective-dated rate
  selection, client-supplied status, org scoping, validation, the audit row, rollback behaviour, and the
  response envelope in both success and error shapes.

**The concurrency test has teeth.** Restoring the starter's `claim.count() + 1` in place of
`sequence.next` fails 2 of the 23 — including `Promise.all` of five creates, which produces duplicate
references. That is the test the starter could not pass, and the reason `SequenceService` exists.

---

## Phase 3 — Schema migration

Closes risk-log rows 2 (storage half), 4 and 8. One migration:
`20260724170000_decimal_money_levy_snapshot_claim_decisions`.

| Change | Why |
|---|---|
| `Claim.total`, `ClaimLine.unitPrice` → `Decimal(12,2)` | Exact to the cent. The rest of the schema already used `Decimal` (`Equipment.hireRatePerDay`, `Docket.hours`) — claims was the outlier, so this is matching house style, not inventing it. |
| `Claim.levyRatePercent Decimal(5,2)` | **The reproducibility fix.** Phase 2 showed the same lines total `67.47` at 12.5% and `65.97` at 10%. Without the rate stored, January's change silently rewrites a December claim — and burn figures the office already signed off. The rate is an input to a decision, so it is stored with the decision. |
| `Claim.fuelSubtotal`, `Claim.levyAmount` | Make the total auditable. A reader can check `fuelSubtotal + nonFuel + levyAmount = total` without recomputing anything. Verified in SQL against all four seeded claims. |
| New `ClaimDecision` + `@@unique([claimId, actorId])` | `approvedBy String?` cannot hold two approvers, so the two-key rule was structurally impossible. The unique constraint **is** the no-double-key guarantee, enforced by the database rather than by application logic. |
| `Claim.reference`: drop global `@unique`, add `@@unique([orgId, reference])` | References are issued per-org, so two orgs must be able to hold `EXP 26-0001`. The global constraint made that impossible — and is exactly why the seed gave pavecorp `EXP 26-0101` instead. Proven both ways in SQL: cross-org insert succeeds, same-org duplicate is rejected. |
| `SurchargeRate @@index([orgId, effectiveFrom])` | The precise shape of the effective-dated lookup. |

**Snapshot columns are `NOT NULL DEFAULT 0`, not nullable.** Every claim must have an answer to "what rate
was this priced at". Nullable would permit a claim with no answer; existing rows take the default during
migration and are immediately replaced, since the seed deletes and recreates all claims.

**`approvedBy` / `approvedAt` were kept.** `ClaimDecision` is now authoritative for who turned which key;
the old columns remain as a denormalised "final approver" the seed already populates. Dropping them would be
churn Phase 7 doesn't need.

**One migration, not three.** Prisma runs each migration file in its own transaction, so a single additive
migration already rolls back atomically and reads as one intent in the history.

### Sequence keys are per-FY

`claim:26`, `claim:27`, … not a single `claim` counter. The brief says the sequence is "per-org, **per-FY**",
so numbering restarts each financial year — a single counter would make FY27's first claim `EXP 27-0007`.
Seeded past the fixtures (roadco `claim:26` → 4, pavecorp → 102) because `SequenceService.next` self-heals
from 1, which would have minted `EXP 26-0001` straight into a collision with a seeded claim.

### The seed now proves the money rather than asserting it

`seed.ts` imports `computeTotals` and `resolveLevyRate`, derives each claim's snapshot from its own lines and
expense date, and **throws if the computed total disagrees with the hardcoded one**. All four fixtures pass
unchanged, which independently confirms Phases 1–2 against data written before they existed. A silent
divergence here would have every downstream test asserting against a fixture that was already wrong.
Money literals are strings (`'88.40'`), so nothing round-trips through a float on the way in.

### Knock-on changes outside `api/src/claims/`

Two were unavoidable consequences of `total` becoming `Decimal`, both minimal and both recorded rather than
made quietly:

- **`reports/reports.service.ts:32`** — `Math.round(decimal * 100)` is a type error. Wrapped the aggregate in
  `Number(...)` at that one boundary. Burn figures are display values, so the report keeps its number-based
  API and its existing rounding. `plan.md:98` makes this part of the gate; verified `M7-RESURF` still reports
  `approvedClaims: 67.47`.
- **`web/app/claims/page.tsx:51`** — Prisma serialises `Decimal` to a JSON **string**, so `c.total.toFixed(2)`
  would throw at runtime. Changed to `Number(c.total).toFixed(2)` and the type to `string | number`. Phase 11
  rebuilds this screen anyway, but leaving the list page broken between phases was not acceptable.

**API shape note for Phases 11–13:** `total`, `fuelSubtotal`, `levyAmount` and `levyRatePercent` now arrive as
strings (`"67.47"`), and `Decimal.toString()` drops trailing zeros (`"187"`, not `"187.00"`). Formatting is the
frontend's job.

### The db port moved to 5434

The starter published Postgres on `5433`, but that port is commonly taken by a locally-installed PostgreSQL —
on this machine two host services (17 and 18) run at startup and one owned `0.0.0.0:5433`, leaving Docker with
only the IPv6 binding. `localhost:5433` then reached *host* Postgres, which has no `claims` user, so every
host-run Prisma command failed with `P1000: Authentication failed`.

Changed the published port to **5434** in both `docker-compose.yml` files and `api/.env.example` (and the
`CLAUDE.md` note). Stopping the host services would also have worked but needs administrator rights and takes
away a service the machine may want; changing a published port costs nothing and makes the project work on any
machine where 5433 is already claimed. The container-internal address is unaffected — the API still reaches
`db:5432`, which is why nothing inside Docker ever noticed the problem.

**Migrations are generated and applied inside the container** regardless: `migrate dev` is interactive when it
detects column casts, which a scripted environment can't answer. The SQL was produced with
`prisma migrate diff --script`, reviewed, saved as a migration, and applied with the non-interactive
`migrate deploy`. `prisma/` is bind-mounted, so the generated files land on the host.

### Two verification traps worth remembering

**An HTTP 200 does not prove a client-rendered page works.** `web/app/claims/page.tsx` is a `'use client'`
component that fetches in `useEffect`, so Next.js returns a 200 shell no matter what the client does
afterwards. The `.toFixed` crash was found by reading the code, not by the 200 check — and it was later
*observed* in a real browser, which is the only thing that actually proves the page renders.

**Docker bind mounts on Windows do not reliably deliver file-change events, and `.next` survives a restart.**
After fixing the page, the browser still showed the old code: the file was correct on the host *and* inside
the container, but the dev server never recompiled, and `docker compose restart` reuses the same container
filesystem so the stale `.next` cache persisted. It took `rm -rf .next` plus a restart. If a frontend edit
appears to do nothing, suspect the cache before suspecting the edit.

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
| 12 | ~~`claims.module.ts`~~ | ~~Does not import the Sequence / Audit / Outbox modules, so the service has no access to the platform kernel.~~ **Withdrawn — this was wrong.** `SequenceModule`, `AuditModule`, `OutboxModule` and `PrismaModule` are all `@Global()`, so no import is needed; `dockets.module.ts` has an empty `imports` and injects all three regardless. | No module change. Inject into the service constructor. Corrected in Phase 4. |

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

