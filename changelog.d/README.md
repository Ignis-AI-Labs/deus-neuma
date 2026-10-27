# changelog.d — one file per change

Every commit that changes what a person sees or does adds one file here, in the same commit
(AGENTS.md Rule 11; the commit-msg hook asks for it):

```
Fixed
- A summoning on a fresh machine reaches its end even when the model loads slowly.
```

The first line is one of Added, Changed, Fixed, Removed, Security. The lines after it start with
`- ` and say, in plain words, what changed for the person using the app. At a release, the release flow's
fold moves them into CHANGELOG.md under the new version and
removes these files.
