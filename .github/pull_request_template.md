<!--
Keep the "What / Why / How verified" spine. Reviewers read that first.
-->

## What changed

<!-- One paragraph. Name the behaviour, not the files. -->

## Why

Closes #

## How it was verified

<!--
Paste the summary line(s), not the whole log:
- `pnpm verify`  → vp check (0 errors, 0 warnings) + vp test (N passed) + vp pack
- `pnpm smoke -- --agentmode <preset>` when the change touches flags, presets or composition
-->

```
pnpm verify
```

## Checklist

- [ ] `pnpm verify` is green locally (format, lint, types, tests, build)
- [ ] Added or updated tests for the changed behaviour
- [ ] No new runtime dependency, and `src/ports.ts` still has no harness import
- [ ] `presets/*.patch.yml` untouched by hand (regenerate with `pnpm sync-presets` instead)
- [ ] Nothing machine-specific (absolute paths, tokens, personal data) in the diff
- [ ] Docs updated when behaviour or the flag surface changed
