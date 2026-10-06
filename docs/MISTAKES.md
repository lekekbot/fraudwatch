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

### 2026-09-24 — Relied on Enter submitting a form that had no submit button
What happened: The address label form saved the name in `onSubmit`, but it had two text inputs (name, tags) and no submit button, so pressing Enter never submitted. Browser testing showed the label not appearing on the cards.
Why: Assumed Enter always submits a form. Implicit submission only happens with a submit button, or when the form has a single text field.
Rule: For save-on-Enter fields, handle Enter on the field itself (e.g. blur to trigger the save) rather than relying on form submission. Verify the save happens in the browser without clicking anywhere else.

### 2026-10-03 — Ran Prettier over a whole file in a repo that doesn't use it
What happened: Ran `npx prettier --write` on `wallet-state-view.tsx` and later `filter-panel.tsx` to tidy an edit. The repo has no Prettier config and its files use long lines, so Prettier reformatted the entire file (+381/−122), burying the real change and mixing it with another session's uncommitted work.
Why: Assumed a formatter was part of the workflow without checking for a config.
Rule: Don't run a formatter unless the repo configures one (`.prettierrc`, a `format` script, or a lint rule). Match the surrounding style by hand. If a file does get reformatted, rebuild it from `HEAD` plus the known content changes, and confirm with a formatted-vs-formatted diff before overwriting.

### 2026-10-06 — Rewrote a hand-formatted JSON file through a serializer
What happened: To drop one section from `protocols/sources/tribixbite-solana-programs.json`, loaded it and wrote it back with `json.dump`. The file's irregular hand formatting (trailing spaces, `" : "`, blank lines) was normalised, turning a 26-line removal into a 1,700-line diff. Caught before committing and redone as a text edit.
Why: Treated "valid JSON in, valid JSON out" as equivalent, ignoring that the diff is part of the change.
Rule: Edit committed data files textually (remove or insert only the lines that change), then parse the result to confirm it's still valid. Check `git diff --stat` matches the size of the intended change before moving on.
