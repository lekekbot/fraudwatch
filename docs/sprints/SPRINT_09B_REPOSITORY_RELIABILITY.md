# Sprint 09B — Repository Reliability Cleanup

**Status:** ✅ Complete (checked 2026-09-29)

**Goal:** Close the concrete reliability issues found in the whole-repository review without expanding product scope.

## Scope

- Make the fixture verifier ignore raw fixture collections that are not replay scenarios.
- Prevent a filtered-out graph connection from remaining visually selected.
- Correct stale Sprint 01 paths after the route-group move.

## Verification

- `node scripts/fixtures/verify.ts`
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm exec next build --webpack`

## Acceptance criteria

- [x] Fixture verification completes across the current fixture tree.
- [x] Removing a selected connection with filters does not dim every remaining connection.
- [x] Sprint 01 links name the current source locations.
- [x] Existing tests, types, lint, and production build pass.

## Deliberate limit

No browser-test dependency is added for one selection guard. Add browser automation in Sprint 11 when there are several stable critical flows worth maintaining end to end.
