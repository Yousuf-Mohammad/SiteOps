# Execution Plan — Claims Workflow

Small, testable phases. **Each phase has a verification gate you can run before moving on.** Commit at each ✅
(meaningful history is graded — do not squash). Reference patterns live in `dockets`; rules live in `CLAUDE.md`.

Legend: 🎯 goal · ✏️ changes · ✅ gate (how you prove it works)

---

## Phase 0 — Baseline & orientation
🎯 Confirm the starter runs and read the answer key.
✏️ `docker compose up -d --build`. Read `dockets.service.ts`, `dockets.controller.ts`, `sequence.service.ts`, `reports.service.ts`.
✅ **Gate:** `curl -s localhost:3100/api/claims -H "x-org-id: <roadco>" -H "x-user-id: <alice>"` returns seeded claims; web dashboard loads at :3000; confirm a DRAFT docket in the UI and watch the burn number move.
📝 Commit: `chore: baseline running notes`

---

## Phase 0.5 — Read the Claims module (know it before you touch it) — ✅ DONE
🎯 Understand the current claims surface so changes are deliberate, not guesses.
✏️ Read `claims.service.ts`, `claims.controller.ts`, `claims.module.ts`, `dto/create-claim.dto.ts`, and the `Claim`/`ClaimLine`/`SurchargeRate` models in `schema.prisma`.
✅ **Gate — write it down** (in `DECISIONS.md` scratch): the current DTO shape, existing routes, the Claim↔Project↔User↔ClaimLine relationships, and current validation. **Note there are no existing tests and no e2e harness** (`test/jest-e2e.json` is missing — Phase 4 scaffolds it).
📝 No commit (reading + notes).

**Recorded in `DECISIONS.md` → "Starter audit (Phase 0.5)":** route table (3 routes, no guards, `findOne` not
org-scoped), DTO shape + validation gaps, entity relationships, and a **12-item bug inventory** with `file:line`
references that the risk log's Bug # column points back to. Confirmed: no `api/test/` directory at all, zero spec
files, `decimal.js` not installed. Also noted — `Claim.approvedBy`/`approvedAt` are single nullable columns, so
the two-key rule is **structurally impossible** in the current schema; that's what Phase 3's `ClaimDecision` fixes.

---

## Phase 0.6 — Risk log (10 min, before any code) — ✅ DONE
🎯 Make the design thinking explicit and testable. Table lives at the top of `DECISIONS.md`.

Scoped to the claims module only (`api/src/claims/`, the claims-owned schema models, `web/app/claims/`).
**Bug #** cross-references the Phase 0.5 inventory in `DECISIONS.md`, so each risk points at its `file:line` defect.

| # | Risk | Mitigation | Bug # | Proven in |
|---|---|---|---|---|
| 1 | Reference collisions under concurrency | `SequenceService.next(tx, orgId, 'claim')` inside the write transaction | 1 | Phase 4 (concurrent-create test) |
| 2 | Floating-point money errors | `decimal.js` + Decimal columns, one rounding point, half-up | 3, 4 | Phase 1, 3 |
| 3 | **Cross-org data leak (security)** | Filter every read/write by `orgId`; validate client-supplied `projectId` | 6, 9, 11 | Phase 4, 5 |
| 4 | Duplicate / double-key approvals | `@@unique([claimId, actorId])` on `ClaimDecision` | — | Phase 7 |
| 5 | Lost-update race on decisions | Conditional `updateMany` (status in WHERE) + `count === 0` | — | Phase 7 (parallel-approval test) |
| 6 | Wrong levy (per-line / hardcoded rate) | Once on fuel subtotal; effective-dated rate lookup | 3 | Phase 1, 2 |
| 7 | Wrong financial year | FY helper from **expense date**, never `now()` | 2 | Phase 2 |
| 8 | Totals mutate when rates change | Snapshot rate + subtotals on the claim | — | Phase 3, 4 |
| 9 | **Privilege escalation (security)** — client POSTs `{"status":"APPROVED"}` | Drop `status` from `CreateClaimDto`; always `DRAFT` on create | 5 | Phase 4 |
| 10 | Self-dealing — submitter approves own claim, incl. as second key | Explicit `submitterId !== actorId` check before the decision insert | — | Phase 7 |
| 11 | State changes leave no trail; burn dashboard never told | `audit.record(…, tx)` every transition; `outbox.enqueue(tx,…)` **only** on final APPROVED | 7 | Phase 4, 6, 7 |
| 12 | Unguarded routes — anyone can create or approve | `@UseGuards(PermissionsGuard)` + `@Permissions('claims.create' / 'claims.approve')` | 10 | Phase 8 |
| 13 | CSV `split(',')` corrupts quoted `"1,299.50"` | Real CSV parser; per-group best-effort with row numbers | — | Phase 9 |
| 14 | Web preview total disagrees with the stored total | Share or exactly mirror `computeTotals`; note any duplication | 14* | Phase 12 |
| 15 | A corrected claim locks out its own approver — `@@unique([claimId, actorId])` blocks whoever rejected it | Scope it to the revision judged: `@@unique([claimId, revision, actorId])` | — | Phase 10 |

Row 15 was **added during Phase 10**, not written up front: it only exists because the fix for risk 4 collides
with the reopen flow, which nothing could reach while `REJECTED` was terminal.

Rows 4, 5, 8, 10, 13 carry no bug number — that functionality doesn't exist in the starter yet, so there is
nothing to be wrong. *Row 14 cites `WORKPLAN.md` item 14 (web screens); the Phase 0.5 inventory covers the API only.

✅ **Gate:** table written to `DECISIONS.md`. 📝 Commit `docs: risk log` **skipped — this folder is not a git
repository**. Every phase completed before `git init` collapses into a single undifferentiated baseline, and
`plan.md` treats commit history as graded. Initialize before Phase 1 if that history matters.

---

## Phase 1 — Pure money function (TDD, no DB, no framework)
🎯 Exact ex-GST totals with the levy applied once on the fuel subtotal. **Do this before touching the DB.**
✏️ **Write the failing spec first** → implement → green (classic TDD). Add `decimal.js`. Create `api/src/claims/claim-totals.ts`:
```
computeTotals(lines: {quantity, unitPrice, isFuel}[], levyRatePercent)
  -> { fuelSubtotal, nonFuelSubtotal, levyAmount, total }   // all exact, half-up rounding, one rounding point
```
✅ **Gate — `claim-totals.spec.ts` red-then-green**, covering:
- Golden #1: `3×19.99` fuel @12.5% → `67.47`
- Golden #2: `1×1.00 + 1×1.00` fuel + `1×5.00` non-fuel @12.5% → `7.25`
- Half-cent rounding lands half-up · zero fuel lines → levy 0 · all-fuel claim · 10% rate
- **Extremes:** large value `999999.99`; tiny `0.01`; large qty `10000 × 0.01` = `100.00`; empty lines → `0.00`
📝 Commit: `feat(claims): exact ex-GST totals with fuel levy (TDD + edge cases)`

---

## Phase 2 — FY & levy-rate helpers (pure)
🎯 Derive FY and the effective-dated rate from an expense date.
✏️ `fyForDate(date) -> number` (2-digit, 1 Jul boundary) and a resolver that picks the `SurchargeRate` whose
`effectiveFrom` is the latest `<= expenseDate` for the org.
✅ **Gate — unit tests:** `2026-06-30` → FY26; `2026-07-01` → FY27; rate is 10% before `2026-01-01`, 12.5% on/after.
📝 Commit: `feat(claims): FY + effective-dated levy resolution`

---

## Phase 3 — Schema migration
🎯 Make the data model able to hold correct money, a rate snapshot, and two keys.
✏️ One migration + `schema.prisma`:
- `Claim.total`, `ClaimLine.unitPrice` → `Decimal @db.Decimal(12,2)`
- Add snapshot columns: `Claim.levyRatePercent`, `Claim.fuelSubtotal`, `Claim.levyAmount` (Decimal)
- New `ClaimDecision` model: `(id, claimId, actorId, decision, createdAt)` + **`@@unique([claimId, actorId])`**
- `Claim` `@@unique([orgId, reference])`; index `SurchargeRate(orgId, effectiveFrom)`
- Seed: add a per-org `claim` sequence key
✅ **Gate:** `npx prisma migrate dev` applies cleanly; `npx prisma db seed` runs; `npx prisma studio` shows the new columns;
`reports` burn endpoint still returns numbers (verify `_sum: { total }` survives the Decimal change).
📝 Commit: `feat(db): decimal money, levy snapshot, claim decisions`
📄 Record each schema change + why in `DECISIONS.md` **now**.
> Optional: split into 3 migrations (Decimal / ClaimDecision / indexes) for isolation. Not required — Prisma runs each
> migration file in its own transaction, so a single additive migration already rolls back on failure and reads cleaner in history.

---

## Phase 4 — Wire module deps + fix `create`
🎯 Claims service can use the kernel; creation is correct and safe.
✏️ `claims.module.ts`: import Sequence/Audit/Outbox modules, inject into service. Rewrite `create`:
drop `status` from DTO (always `DRAFT`), org-validate `projectId`, inside a transaction take `sequence.next(tx, orgId, 'claim')`,
build `EXP {fy}-{seq}` from **expense-date FY**, compute + **snapshot** totals (Phases 1–2), `audit.record('claim.created', tx)`.
Remove `status` from `CreateClaimDto`.
**Also scaffold the e2e harness here** (first integration test): create `api/test/jest-e2e.json` (config the `test:e2e` script
already expects but is missing) + a Nest bootstrap using `@nestjs/testing` + `supertest` against the Docker Postgres, with per-test cleanup.
✅ **Gate (integration, Supertest + real Postgres):**
- POST a claim → reference matches format `EXP 26-0001` (note the space) · stored `total` equals the pure-fn result · `levyRatePercent` snapshotted.
- **Reference uniqueness, not just format:** three sequential POSTs → `EXP 26-0001`, `EXP 26-0002`, `EXP 26-0003` (no reuse/gap-at-start).
- **Concurrent create:** `Promise.all` of N POSTs → N **distinct** references, no collision (this is where sequence gen is exercised).
- Posting `{status:"APPROVED"}` is ignored (stays DRAFT) · unknown/foreign-org `projectId` → 400 · an audit row exists.
📝 Commit: `fix(claims): safe create — server refs, snapshot totals, org validation, audit` (+ `test: e2e harness`)

---

## Phase 5 — Fix reads (`findOne`, `findAll`)
🎯 Close the cross-tenant leak; make listing paginated + filterable.
✏️ `findOne(orgId, id)` → `where: { id, orgId }`, include lines + decisions + audit history; 404 if not found in org.
`ListClaimsDto extends PaginationDto` with `status` + `fy`; FY filter → expense-date range; return `{ data, meta: paginationMeta(...) }`.
✅ **Gate:** reading another org's claim id → 404 (not the record); `GET /claims?status=APPROVED&fy=26&page=1` paginates and filters;
detail response includes decision + audit arrays.
📝 Commit: `fix(claims): org-scoped detail + paginated/filterable list`

---

## Phase 6 — `submit` (lodgment)
🎯 Only the submitter can lodge their own DRAFT.
✏️ Conditional `updateMany({ where: { id, orgId, status: 'DRAFT', submitterId: actorId } })`; `count===0` → 404/409 with a clear reason; audit `claim.submitted`.
✅ **Gate:** submitter DRAFT→SUBMITTED works; a non-submitter gets denied; submitting a non-DRAFT → 409.
📝 Commit: `feat(claims): lodgment (submitter-only, race-safe)`

---

## Phase 7 — `approve` / `reject` (the centrepiece)
🎯 Two-key rule, no self-dealing, final and race-safe.
✏️ In one transaction: reject self-dealing (`submitterId === actorId` → 403); insert `ClaimDecision` (the unique
`(claimId, actorId)` blocks the same person turning both keys); conditional `updateMany` with the expected current status:
`> 1000 & SUBMITTED → PARTIALLY_APPROVED`; `> 1000 & PARTIALLY_APPROVED → APPROVED`; `<= 1000 → APPROVED`; reject → `REJECTED`.
Audit every transition; `outbox.enqueue(tx, 'claim.approved')` **only on final APPROVED**.
✅ **Gate (integration, Supertest + real Postgres):**
- $1,750 claim: approver A → PARTIALLY_APPROVED; same A again → rejected (unique/self-key); different B → APPROVED + one outbox row.
- $1,000.00 exactly → single approval → APPROVED (boundary).
- Submitter approving own claim → 403.
- **Decision concurrency** (distinct from Phase 4's create concurrency): two `Promise.all` approvals on the same claim → exactly one `count:1`, the other 409.
📝 Commit: `feat(claims): two-key approval, race-safe, no self-dealing`

---

## Phase 8 — Controller guards & endpoints
🎯 Permissions enforced; full endpoint surface.
✏️ `@UseGuards(PermissionsGuard)`; `@Permissions('claims.create')` on create/submit, `'claims.approve'` on approve/reject.
Wire routes: `POST /claims`, `GET /claims`, `GET /claims/:id`, `POST /claims/:id/submit|approve|reject`.
✅ **Gate:** Alice (no `claims.approve`) → 403 on approve; Carol → allowed; every route reachable and enveloped.
📝 Commit: `feat(claims): permission guards on all routes`

---

## Phase 9 — CSV import
🎯 `POST /claims/import`, best-effort per claim.
✏️ Real CSV parse (handles quoted `"1,299.50"`); group rows by `group`; validate each group; create valid claims (reusing Phase 4 logic);
collect `{ rows: number[], reason }` for invalid groups; return created + rejected in one enveloped response. One bad line rejects that whole claim only.
✅ **Gate (integration, Supertest):** a mixed CSV (one good group, one group with a bad line) → good claim created, bad group reported with its row numbers; comma-in-price `"1,299.50"` parsed correctly.
- **CSV edge cases:** UTF-8 BOM on the first header · blank/whitespace-only rows skipped · missing/misordered required headers → clear error (not a crash) · duplicate `group` ids handled deterministically (define: same group = same claim).
📝 Commit: `feat(claims): best-effort LegacyPlant CSV import`

---

## Phase 10 — Rejected-claims decision — ✅ DONE
🎯 Resolve "rejected claims come back around" and implement it.
✏️ Pick one (reopen to DRAFT / new revision / resubmit from REJECTED), implement the minimal transition, document the reasoning.
✅ **Gate:** the chosen transition works end-to-end and is covered by a test; rationale written in `DECISIONS.md`.

**Chosen: correct-and-reopen in place.** `POST /claims/:id/reopen` with optional corrected `lines` moves
`REJECTED → DRAFT` on the same claim — same reference, `revision + 1`, totals recomputed against the
*snapshotted* levy rate. Submitter-only, `claims.create`, race-safe via the status-in-WHERE update, audited,
no outbox event. Exposed and closed **risk 15**: decision uniqueness moved to
`@@unique([claimId, revision, actorId])` so the approver who rejected a claim can rule on the correction.
18 e2e tests; both mutants killed; rationale in `DECISIONS.md` → "Phase 10 — The rejected-claims question".
📝 Commit: `feat(claims): rejected-claim reopen flow`

---

## Phase 11 — Frontend: list
🎯 Claims list matches house style.
✏️ Add `claims` to `queryKeys`; rebuild `app/claims/page.tsx` on `lib/api/client` + React Query (`keepPreviousData`), status + FY filters, pager. Retire `lib/api.ts` usage here.
✅ **Gate:** list paginates + filters against the API; no use of the old client; loading/error states render.
📝 Commit: `feat(web): claims list (react-query, filters, pager)`

---

## Phase 12 — Frontend: new-claim form
🎯 Create a claim with a live total that provably matches the server.
✏️ react-hook-form + zod; add/remove lines with a fuel flag; live preview importing/mirroring `computeTotals` (note any duplication in DECISIONS.md); on success the list updates without a full reload (invalidate `claims`).
✅ **Gate:** entering Golden #1 shows `$67.47` in the preview and the created claim's server total equals it; validation errors surface via zod.
> Stretch (optional, not required by the brief): optimistic insert via `setQueryData` for the new row, with rollback on error.
> `invalidateQueries` already satisfies "reflects the new claim without a full reload" — only add optimism if it doesn't muddy the code.
📝 Commit: `feat(web): new-claim form with live, server-matching total`

---

## Phase 13 — Frontend: claim detail + decisions
🎯 The two-key flow is legible.
✏️ New `app/claims/[id]/page.tsx`: line items, ex-GST total with GST/inc-GST shown *for reference*, status badge, decision + audit **timeline**. Approve/Reject gated by `can('claims.approve')`; clear "X turned the first key — awaiting a second, different approver" messaging. After approval invalidate `claims` **and** `reports.burn`.
✅ **Gate:** approving a >$1,000 claim from the detail page shows PARTIALLY_APPROVED with pending-second-key state; a second approver completes it; burn dashboard reflects it.
📝 Commit: `feat(web): claim detail with decision timeline + two-key UI`

---

## Phase 14 — Docs & final verify
🎯 Ship-ready.
✏️ `DECISIONS.md` (money/rounding, collision-free refs, reproducibility/snapshot, concurrency, final-approval event, rejected-claims call, **what was skipped and why**). `AI-USAGE.md` (specific, with 1–2 real "AI got it wrong / here's how I caught it" examples). `README.md` claims section.
✅ **Gate — full suite green:** in `api/` run `npm test` (unit), `npm run test:e2e` (Postgres), `npm run lint`, `npm run typecheck`;
in `web/` run `npm run lint` + `npm run typecheck`. Golden examples re-verified over HTTP (not just unit tests); `git log --oneline` reads as a story; gold-plating removed.
📝 Commit: `docs: decisions, AI usage, README`

---

### If time runs short (priority order)
1. Phases 1–2 (totals) → 2. Phase 7 (two-key + concurrency) → 3. DECISIONS.md → 4. Phase 13 (detail timeline)
→ 5. Phase 7 Postgres concurrency test → 6. Phase 9 (import endpoint) → 7. AI-USAGE.md → 8. Phase 11 filters
→ **skip the CSV import *screen* and say so** (the endpoint is still required).
