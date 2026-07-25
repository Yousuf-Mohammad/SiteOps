# AI Usage

AI (Claude, via Claude Code) was used throughout this assessment. This document records what it was used
for, where it genuinely helped, and — more importantly — the places where it was wrong or took the lazy path,
and how I caught it. The reasoning in `DECISIONS.md` is mine; AI was the tool I drove to get there.

## How I used it

- **Reading the answer key.** The brief says `dockets` is the reference implementation. I had AI read
  `dockets.service.ts`, `sequence.service.ts`, `reports.service.ts` and the kernel (interceptor, filter,
  guard) first, and summarise the patterns, so the claims code would match the platform rather than invent.
- **Test-first on the money.** The exact-cent totals and the FY/levy helpers were written red-then-green with
  AI producing the failing spec first. I insisted on the two golden examples plus half-cent and extreme cases
  before any implementation.
- **Mutation testing to prove the tests have teeth.** For every non-trivial change I had AI introduce a
  deliberate mutant (e.g. levy-per-line, exclusive date bound, `split(',')` CSV) and confirm a test failed.
  A test that never fails is decoration.
- **The phased plan.** Work was broken into small phases (`plan.md`), each with a verification gate and its
  own commit, so the history reads as a story rather than one dump.
- **End-to-end verification in a real browser** for the frontend, not just HTTP status codes (see below for
  why that distinction mattered).

## Where AI was wrong, and how I caught it

These are the ones worth reading.

### 1. It repeated a "float is broken" claim that was actually false

`WORKPLAN.md` states `3 * 19.99 = 59.970000000000006` in JavaScript, and AI initially took that at face value
when justifying `decimal.js`. It isn't true — that expression is exactly `59.97` in IEEE-754 double. The real
float error in the golden-#1 path comes from the *levy multiply* (`59.97 * 1.125`), not the line extension.
I made AI actually evaluate the expressions rather than trust the doc, and we re-anchored the test on a case
that genuinely drifts (`7 * 13.37 = 93.58999999999999`) so the exactness argument rests on something true.
The correction is recorded in `DECISIONS.md` (Phase 1). Lesson: AI will confidently echo a plausible-sounding
claim from the surrounding material; make it verify.

### 2. A concurrency bug in the two-key approval that only a race test exposed

The first cut of `approve` used `where: { status: { in: [SUBMITTED, PARTIALLY_APPROVED] } }` in the
compare-and-swap. That looks reasonable and passes every sequential test. It is wrong under a race: two
approvers hitting a `SUBMITTED` claim at once can both succeed, because the second finds `PARTIALLY_APPROVED`
— which the first just wrote — still inside the accepted set, and overwrites it, burning a key without
advancing the claim. A `Promise.all` concurrency test caught it, and the fix was to swap on the *exact* status
the decision was computed from (`status: claim.status`). I would not have trusted this code without the
race test, and AI did not volunteer the bug until the test forced it.

### 3. "It works" based on an HTTP 200 that proved nothing

On the frontend, AI more than once reported a page "verified working" because the request returned `200`. For
a `'use client'` + `useEffect` page, a 200 is returned regardless of whether the component then throws while
rendering (a `Decimal` serialised as a JSON string crashed `toFixed`). I made browser verification mean
*reading the rendered DOM and the console*, not the status code. Related: on this Windows/Docker setup the
bind mount silently serves a stale `.next` build after a file change, so "I changed it and it's 200" was
doubly meaningless — the fix required clearing `.next` and restarting before trusting anything. Every web
phase's gate now includes a real browser check and a console read.

### 4. It re-implemented a whole phase that a parallel session had already committed

While building the claim detail page (Phase 13), AI planned and wrote a complete version from scratch —
unaware that a parallel session had already committed that exact work, better factored (shared components, a
reopen editor). Its `git add -A` was about to overwrite the committed files and delete ones it hadn't
written. I caught it because the commit step inspects `git HEAD` first: the working tree diverged from files
"I" hadn't touched. Rather than let it clobber the parallel work, I had it show me the diff, kept the
committed version, and ported only my one improvement on top. Lesson baked into the workflow: check `HEAD`
before assuming a phase is undone, and never commit over work you didn't write without surfacing it.

### 5. Destructive `git checkout --` during mutation testing

Early on, AI used `git checkout -- <file>` to revert a mutant and discarded genuinely uncommitted work with
it (twice, once losing a full phase's edits). I switched the mutation-testing workflow to explicit file
backups in a scratch directory, and treated `git checkout --` / `git restore` on uncommitted files as
something to reason about, not reflexively run.

### 6. It got its own bug inventory wrong

In the Phase 0.5 starter audit, AI listed "kernel modules must be imported into the claims module" as a bug.
They're `@Global()` — nothing needs importing. I struck the item through rather than delete it, so the audit
shows the correction instead of quietly hiding it.

## The net

AI was genuinely fast at the mechanical work — matching the platform's patterns, scaffolding the e2e harness,
writing exhaustive table-driven tests, and producing the first draft of each screen. It was unreliable
exactly where you'd expect: concurrency, floating-point claims, "done" signals, and awareness of state it
didn't create. The tests, the mutation checks, the real-browser verification, and reading `git HEAD` before
committing are what turned its output into something I'd sign off on.
