# AI Usage

AI (Claude Code) was used as an engineering assistant throughout the assessment. It helped with understanding
the existing codebase, scaffolding repetitive code, generating test cases, debugging, reviewing
implementations, and drafting documentation. All significant changes were reviewed and verified manually
before being accepted.

## What I used AI for

- Summarizing existing platform patterns (Dockets, `SequenceService`, Reports, Guards) before implementing the
  Claims module, so the new code matched the platform instead of inventing its own conventions.
- Scaffolding DTOs, services, controllers, React components, and test fixtures.
- Generating unit and integration test cases, especially for money calculations and concurrency.
- Introducing deliberate mutants (levy-per-line, an exclusive date bound, a naive `split(',')` CSV parser) to
  confirm the tests actually failed. A test that never fails is decoration.
- Reviewing implementations for edge cases and drafting project documentation.

## What AI got wrong

- **Floating-point calculations:** AI repeated an incorrect example from the starter documentation —
  `3 * 19.99` does not drift in JavaScript; it is exactly `59.97`. I verified the arithmetic manually and
  re-anchored the justification on a case that genuinely demonstrates floating-point error
  (`7 * 13.37 = 93.58999999999999`), so the argument for `decimal.js` rests on something true.
- **Two-key approval concurrency:** The initial compare-and-swap accepted a *set* of source statuses, which
  passes every sequential test and is wrong under a race — the second approver finds the
  `PARTIALLY_APPROVED` the first just wrote, still inside the accepted set, and overwrites it. A `Promise.all`
  race test exposed it, and the implementation was updated to compare against the exact observed status.
- **Verification:** AI sometimes treated a successful HTTP response as proof that the frontend worked. For a
  client-rendered page a `200` is returned even when the component then throws while rendering. I verified
  functionality using the rendered UI, browser console, and automated tests instead.
- **Awareness of work it did not do:** While rebuilding a screen, AI wrote a complete version from scratch,
  unaware that a parallel session had already committed better-factored work, and was about to commit over
  it. I check `git HEAD` before assuming a phase is undone.
- **Destructive git commands:** AI reverted a mutation with `git checkout -- <file>`, discarding uncommitted
  work along with the mutant. Mutation testing now uses explicit file backups.

## What I deliberately did by hand

- Planned the implementation strategy and reviewed every AI-generated change.
- Made all final design decisions documented in `DECISIONS.md`.
- Verified business rules using unit tests, concurrency tests, and manual browser testing before accepting any
  implementation.
