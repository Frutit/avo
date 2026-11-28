# 034 — Ordered next two tasks and flexible routines

id: 034
updated: 2026-11-27

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

## Validation

| Date | Check / scope | Result | Evidence or limitation |
|---|---|---|---|
| 2026-11-27 | `npm run check:tasks` and `npm run test:tasks` | Passed | 31 tasks checked, 0 errors and 0 warnings after parking 033 and activating 034. |
| 2026-11-27 | `npm test` | Passed | 578/578 tests across 57 files (including `taskOrder` overriding priority/seed, 2-card hand swaps with 3 tasks, mixed-weekday routines, and atomic inline routine step creation). |
| 2026-11-27 | `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run db:check`, `git diff --check` | Passed | Zero errors or warnings across Workers/Node TS, ESLint, Prettier, and D1 Drizzle journal. |
| 2026-11-27 | Isolated `npm run build` + `npm run test:e2e` | Passed | Built with `cf build` in `/tmp/avo-034-e2e.*` and passed 32/32 Chromium journeys, including 320px ordered cards, direct `Nueva rutina` + inline new step, ES/EN copy, and Axe. Local automated checks do not prove D1 production, OAuth, Safari, or physical mobile devices. |

## Log

- 2026-11-27 — Diagnosed in Doctor mode why ordered habits could appear inverted in Today (`taskOrder` ignored in `selection.ts`, FNV-1a date hash + category diversity shuffling, 3-card hand trapping a hidden card in a 2-card deck, and `sameWeekdays` + hidden menu friction on routines). Owner approved the three design decisions and asked to proceed while keeping Avo's minimalist UI.
- 2026-11-27 — Implemented `taskOrder`-first selection, 2-card `HAND_CAPACITY`, weekday-filtered routine progression, relaxed `sameWeekdays` across local/D1/Postgres/snapshot/guest-import, atomic inline step creation on routines, quiet `Nueva rutina` button + menu `Subir`/`Bajar`, and `"Siguiente"` / `"Up next"` deck copy. Passed 578/578 unit tests, typecheck, lint, format, `db:check`, `check:tasks`, and 32/32 isolated Chromium E2E tests. Ready for owner device review.
