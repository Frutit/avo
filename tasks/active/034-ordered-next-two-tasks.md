# 034 — Ordered next two tasks and flexible routines

id: 034
updated: 2026-11-28

## Goal

Make Today respect the exact habit order configured in Habits (`Settings.taskOrder`) ahead of task priority, remove random daily seed reversals and category-diversity shuffling, align the open hand capacity to the 2 visible cards in `TaskDeck` so swapping always works with a third eligible candidate, and make sequential routines easy to create/use across habits with different weekdays while preserving Avo's minimal design.

## Out of scope

- Database schema changes or remote migrations in D1/Neon, deploys, commits, or OAuth/account changes.
- Nested routines, branching dependency graphs, dashboards, or visual clutter in Today/Habits.

## Next step

Owner visually reviews the two-card ordered Today flow and minimal routine creation in a real browser/device; once accepted, close 034 and resume 033 for the Cloudflare cutover.

## Checklist

### Domain, storage, and sync rules

- [x] Park task 033 in backlog, register 034 as the sole active task, update `tasks/README.md`, and pass `npm run check:tasks`.
- [x] Update `lib/domain/task-order.ts` so unordered tasks fall back to time, priority, and `createdAt` instead of alphabetical title order.
- [x] Update `lib/domain/selection.ts` so `eligibleCandidates` and `proposeHand` respect `taskOrder` and chronological blocks ahead of priority, return at most 2 cards, and evaluate `currentRoutineStep` against only the member tasks scheduled on the current weekday.
- [x] Pass `settings.taskOrder` into `ensureFranja` and `swapFranjaTask`, trim open hands to 2 cards, keep in-progress routine steps (`step > 1`) and due anchors ahead of deferred/partial cards, and share date-aware routine progress with active sessions.
- [x] Relax the `sameWeekdays` restriction in `lib/db/repository.ts`, `lib/sync/d1-repository.ts`, `lib/sync/server-repository.ts`, `lib/sync/guest-import.ts`, and `lib/db/snapshot.ts`, and add atomic routine save with inline new step habits.

### Minimal UI and localization

- [x] Remove hidden third-card rendering in `components/task-deck.tsx`, refresh `TaskDeck` ordering cleanly in `components/runo-home.tsx`, and update back-card/help copy in `messages/es.json` and `messages/en.json`.
- [x] Add a quiet `Nueva rutina` entry point and optional inline `+ Crear paso nuevo` inside the routine form in `components/task-editor.tsx`, allow grouping habits across different weekdays, add one-tap `Subir`/`Bajar` actions in the habit menu, and add Safari `-webkit-user-select: none` on `.task-grip`.

### Verification

- [x] Add and update unit/integration tests (`selection.test.ts`, `task-order.test.ts`, `franja.test.ts`, `repository.test.ts`, `persistence.test.ts`, `task-deck-render.test.tsx`).
- [x] Update/extend Playwright E2E coverage for ordered 2-card Today flow, direct routine creation with inline steps, ES/EN copy, narrow viewport, and Axe.
- [x] Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run db:check`, `npm run check:tasks`, and an isolated `npm run build` + `npm run test:e2e`; record evidence and real-device limits.
- [ ] Owner real-browser/device visual acceptance.

## Files

- `lib/domain/task-order.ts`, `lib/domain/selection.ts`, `lib/domain/franja.ts` — pure ordering, 2-card hand proposal, and weekday-filtered routine progression.
- `lib/db/repository.ts`, `lib/db/snapshot.ts`, `lib/sync/d1-repository.ts`, `lib/sync/server-repository.ts`, `lib/sync/guest-import.ts` — habit order wiring in franja selection and swaps, flexible routine days, and atomic routine creation with new step tasks.
- `components/task-deck.tsx`, `components/runo-home.tsx`, `components/task-editor.tsx`, `app/globals.css` — 2-card deck, minimal routine creation/inline step flow, menu reordering, and drag-handle polish.
- `messages/es.json`, `messages/en.json`, `docs/design/sequential-routines.md` — localized ES/EN copy and updated feature spec.
- `e2e/sequential-routines.spec.ts` — end-to-end verification of ordered cards, routine creation, and accessibility.

## Decisions

- 2026-11-27 — Owner confirmed: (1) explicit habit order (`taskOrder`) wins over task importance (`priority`), (2) Today's open hand moves from 3 to 2 cards matching the 2 visible cards without category/hash shuffling, and (3) routine creation becomes visible and supports different weekdays per step while strictly preserving Avo's minimal, low-noise aesthetic.
- 2026-11-28 — After owner-authorized read-only review of the 50-habit account snapshot, owner approved four follow-up fixes and repairing that account's frozen alphabetical `task_order` in D1 (with a private rollback backup): (A) active windows and any-time habits precede expired `missed` habits from earlier blocks, (B) reordering one block in Habits no longer freezes indices in untouched blocks, (C) unstarted routine step 1 respects saved `taskOrder` while `step > 1` takes focus immediately, and (D) routine step selection groups habits by daypart when multiple blocks exist.

## Validation

| Date | Check / scope | Result | Evidence or limitation |
|---|---|---|---|
| 2026-11-27 | `npm run check:tasks` and `npm run test:tasks` | Passed | 31 tasks checked, 0 errors and 0 warnings after parking 033 and activating 034. |
| 2026-11-28 | `npm test` | Passed | 580/580 tests across 57 files (including active blocks before `missed`, section-scoped `reorderTaskOrder`, routine step 1 respecting `taskOrder` and step 2 taking focus, 2-card swaps, and mixed-weekday routines). |
| 2026-11-28 | `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run db:check`, `npm run check:tasks`, `git diff --check` | Passed | Zero errors or warnings across Workers/Node TS, ESLint, Prettier, D1 Drizzle journal, and task guard. |
| 2026-11-28 | Authorized D1 `runo_settings.task_order` repair | Passed | Backed up pre-change row privately (`0600`) outside Git, updated the 50-habit account `task_order` to revision 5 in D1 `avo`, verified 50/50 keys, and simulated 08:00, 13:30, and 20:00 rankings. |
| 2026-11-28 | Isolated `npm run build` + `npm run test:e2e` | Passed | Built with `cf build` in an isolated `/tmp` copy and passed 32/32 Chromium journeys, including daypart-grouped routine picker, 320px ordered cards, ES/EN copy, and Axe. Local automated checks do not prove OAuth, Safari, or physical mobile devices. |

## Log

- 2026-11-27 — Diagnosed in Doctor mode why ordered habits could appear inverted in Today (`taskOrder` ignored in `selection.ts`, FNV-1a date hash + category diversity shuffling, 3-card hand trapping a hidden card in a 2-card deck, and `sameWeekdays` + hidden menu friction on routines). Owner approved the three design decisions and asked to proceed while keeping Avo's minimalist UI.
- 2026-11-27 — Implemented `taskOrder`-first selection, 2-card `HAND_CAPACITY`, weekday-filtered routine progression, relaxed `sameWeekdays` across local/D1/Postgres/snapshot/guest-import, atomic inline step creation on routines, quiet `Nueva rutina` button + menu `Subir`/`Bajar`, and `"Siguiente"` / `"Up next"` deck copy.
- 2026-11-28 — Owner authorized inspecting the primary 50-habit account snapshot to double-check real usage and approved applying four additional fixes plus repairing the frozen alphabetical `task_order` in D1 `avo`. Saved a private `0600` rollback backup of `runo_settings`, updated `task_order` to revision 5, updated selection/ordering/routine-picker code, and re-verified all unit, static, and isolated E2E checks. Ready for owner device review.
