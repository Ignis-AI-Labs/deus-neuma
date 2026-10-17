# Versioning and release evidence

Apply to versioned applications, packages, APIs, schemas, and distributable artifacts.

- Declare one version source and the release boundary. Derive displayed/build versions from it; do not duplicate literals. Do not bump versions for every edit unless that is the repository's release policy.
- For semantic versioning, distinguish compatible fixes, compatible features, and public breaking changes. Declare pre-1.0 compatibility rules explicitly. An architectural rewrite alone does not define compatibility.
- Update the version, relevant lock/metadata files, and a dated changelog entry together. Preserve historical entries. Describe user-visible impact and migration requirements.
- Expose the running version where useful for support and stale-client detection. Reuse the existing UI/pipeline; a changelog modal or polling endpoint is a product choice, not mandatory boilerplate.
- Verify release gates on the revision being released and record the artifact/revision association. Confirm the deployed artifact and critical user path after an authorized release.
