# Decisions

Claims module only — `api/src/claims/`, its schema models, `web/app/claims/`.

## Starter changes

- **Schema:** Changed money fields from `Float` to `Decimal(12,2)`; added levy snapshot fields (`levyRatePercent`, `fuelSubtotal`, `levyAmount`), `ClaimDecision`, and `Claim.revision`; changed reference uniqueness from global `@unique` to `@@unique([orgId, reference])`.
- **Service:** Rebuilt claim creation using the Dockets transaction pattern (validated project, single transaction, sequence generation, audit logging); secured `findOne` with `orgId` — it previously let any org read any claim by id, and now 404s exactly as a nonexistent claim does; added pagination and filtering to `findAll`.
- **DTO:** Removed client-settable `status`, which allowed a claim to be POSTed already `APPROVED`; added validation for non-empty line items, positive integer quantities, and positive prices with two decimal places.
- **Controller:** Added `PermissionsGuard`, `claims.create` / `claims.approve` permissions, and the missing submit, approve, reject, reopen, and import endpoints.
- **Outside the module (unavoidable):** `GlobalExceptionFilter` was defined but never registered, so errors bypassed the documented response envelope — registered via `APP_FILTER`. Two `Number(...)` conversions where `Decimal` now serialises as a JSON string (`reports.service.ts`, the claims list page). Database port `5433 → 5434`, which was occupied by a host PostgreSQL install. ESLint added — both apps shipped a `lint` script with neither ESLint nor a config.

*Why: The starter implementation could not satisfy the required workflow, exact monetary calculations, concurrency guarantees, or tenant isolation.*

## Money & rounding

- Calculations use `decimal.js`; money is stored as Prisma `Decimal`.
- Half-up rounding is applied using a module-local `Decimal` clone, so the rounding mode cannot leak into other code. The library default is half-even, which would send `0.005` to `0.00`.
- The levy is applied **once** to the fuel subtotal, then rounded once before calculating the final total — not per line and not across the whole claim. Golden example #1 passes under all three readings; #2 fails the wrong two by a cent.
- Financial year is derived from `expenseDate` using UTC accessors. Dates are stored as UTC midnight, so local accessors read 1 July as 30 June west of Greenwich — exactly the FY boundary.
- The web preview mirrors `computeTotals` line-for-line (`web/lib/claim-totals.ts`) rather than importing it, since the two packages do not share a build. The duplication is deliberate and flagged in the file header; the preview also resolves the levy rate for the expense date through `GET /claims/levy-rate`, so it matches the stored total for any date rather than only today's. **Next step:** extract both into a shared workspace package so the copy cannot drift.

*Why: This guarantees exact monetary calculations, ensures the stored values always reconcile, and prevents incorrect financial years caused by entry date or timezone differences.*

## Collision-free references

- Claim references are generated with `sequence.next(tx, orgId, 'claim:<fy>')` inside the claim creation transaction — an atomic `UPDATE … RETURNING`, replacing the starter's `count() + 1`, which mints duplicates under concurrent creates and reuses numbers after a delete.
- Each financial year has its own sequence, so numbering restarts on 1 July.

*Why: Database sequences are safe under concurrent requests. Gaps after rollbacks are acceptable; duplicate references are not.*

## Reproducible totals

- The applied levy rate, fuel subtotal, and levy amount are snapshotted when the claim is created and never recalculated later — including when a rejected claim is corrected, which reprices against the snapshot rather than the current rate table.

*Why: Historical claims must always produce the same totals, even if levy rates change in the future. The same lines total `$67.47` at 12.5% and `$65.97` at 10%, so a rate change would otherwise rewrite a claim already approved and reported on.*

## Concurrent decisions (two-key)

- Each approval is stored as a `ClaimDecision`.
- `@@unique([claimId, revision, actorId])` prevents duplicate approvals within the same revision; the resulting `P2002` is mapped to a 409 with a meaningful message.
- Workflow transitions use compare-and-swap on the **exact status the decision was computed from**. Accepting a *set* of source statuses is not sufficient — two approvers racing a `SUBMITTED` claim both succeed, the second overwriting `PARTIALLY_APPROVED` with itself.
- Claims over `$1,000.00` require two different approvers. The threshold is `>`, so exactly `$1,000.00` needs one key.
- A submitter can never approve or reject their own claim, including as the second key; this is checked before anything else so the error names the real reason.

*Why: The unique constraint prevents one user approving twice, while compare-and-swap prevents concurrent requests from corrupting the workflow. Neither substitutes for the other.*

## Final approval event

- The `claim.approved` outbox event is published only when the claim reaches the final `APPROVED` state, inside the same transaction. No event is emitted on submit, a first key, rejection, or reopen.

*Why: Downstream systems should react only to completed approvals, and the database change and event must succeed or fail together.*

## Rejected claims

- Rejected claims are reopened on the same claim by incrementing `revision`; the claim reference is preserved. Corrected lines are supplied in the same call, so a claim is never left half-fixed between two requests.
- `expenseDate` and project remain immutable — they fix the financial year in the reference and select the levy rate.
- Reopening uses the same permission as claim creation, is restricted to the claim's own submitter, and does not publish an event.
- `revision` is part of the decision uniqueness key for this reason: without it, the approver who rejected a claim could never rule on the correction she asked for. A decision is a judgement about a specific set of numbers, so it is spent when those numbers change. Earlier revisions' decisions are retained as history.

*Why: The claim reference identifies the original business transaction. Using revisions preserves that identity, maintains a complete audit trail, and allows the approval process to restart for the corrected claim.*

## Deliberately skipped

- Real authentication, file storage, and email notifications.
- CRUD screens for seeded reference data (organizations, users, projects, equipment).
- CSV import UI (the API endpoint was implemented as required). **Next:** a thin upload screen reusing the existing endpoint and rendering its per-group rejection report.
- **Frontend tests.** Testing effort went where the money and the concurrency are — 101 unit and 132 e2e tests on the API, the latter against a real Postgres. The web layer is verified in a browser (rendered DOM and console, not status codes), because a component test would not have caught the two bugs that actually occurred there: a `Decimal`-as-string crash and a stale Docker build. **Next:** React Testing Library on the line-item editor, and a committed parity test asserting the web and api total functions agree.
- The fake-auth middleware does not bind the acting user to the supplied `x-org-id`; correcting that is real authentication.
- Read endpoints carry no permission: no seeded user holds `claims.read`, so enforcing an invented one would deny every user. `NotesController` is the precedent — guard at class level, rely on org scoping.
- `GET /claims` omits line items — the detail endpoint carries them.

*Why: These items are outside the assessment scope or explicitly marked as optional. Tenant isolation is still enforced within the Claims module by filtering every query by `orgId`, which is precisely why the data layer cannot rely on the auth layer.*
