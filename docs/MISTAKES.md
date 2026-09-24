# Mistakes Log

Every mistake Claude makes in this repo is recorded here, along with a rule to stop it happening again.
Read this before starting work. Add an entry as soon as a mistake is noticed or pointed out.

## Format

```text
### YYYY-MM-DD — <short title>
What happened: <the mistake, concretely>
Why: <root cause>
Rule: <the check or habit that prevents it next time>
```

## Entries

### 2026-09-24 — Branched a sprint from a main that didn't contain the previous sprint
What happened: Started Sprint 05 by pulling `main` and branching `sprint-05` from it, while Sprint 04's PR was still unmerged. The new code imported Sprint 04 modules that weren't on the branch, and tests failed with "Cannot find module './reconstruct'".
Why: Assumed "checkout main" meant main already had every earlier sprint, without checking.
Rule: Before branching a new sprint, confirm the previous sprint's branch is merged into the base (`git merge-base --is-ancestor <prev-branch> HEAD`). If it isn't, say so and branch from the previous sprint instead.
