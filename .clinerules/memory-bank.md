# Memory Bank protocol (always applies)

The repo keeps persistent engineering memory in `memory-bank/`. Chat history may be
compacted or lost; the files on disk are the source of continuity.

## At task start
1. Read `memory-bank/projectbrief.md`, `activeContext.md`, `progress.md`.
2. Before implementing, read the relevant parts of `architecture.md`, `decisions.md`,
   `knownIssues.md`, `taskPlan.md`, and the spec in `.kiro/specs/rnh-tyre-testing-system/`.
3. Run `git --no-pager status --short` and read the source files you will change.
   Source code and real test output beat anything written in memory.
4. For substantial tasks, write down acceptance criteria (in `taskPlan.md`).

## While working
- Search for symbols/callers first; read files on demand, not the whole repo.
- Follow existing conventions (TypeScript, React function components, Vitest,
  shared logic in `packages/shared`, Firebase access in `packages/shared/src/v2data`).
- Never deploy (`npm run deploy:*`) or touch the live Firebase project without asking.
- Never write secrets (API keys, passwords, tokens) into memory files.
- Delete `.tmp_*` scratch files when done.

## Verification
- `npm run build`, `npm test`, `npm run lint`; rules changes also
  `npm run test:rules:emulated`. Record the real outcome, including failures.

## After each milestone and before ending / context reset
- Update `activeContext.md` (objective, files in flight, exact next action).
- Append to `progress.md` (what changed, commands run, real results).
- Update `taskPlan.md` statuses (TODO / IN_PROGRESS / BLOCKED / DONE) and
  `knownIssues.md` / `decisions.md` as needed.
- The handoff must be understandable without this conversation.
