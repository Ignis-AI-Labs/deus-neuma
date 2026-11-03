Added
- macOS builds: `npm run dist:mac` makes a disk image and zip per chip and checks that every binary inside loads on that chip; `npm run check:mac` runs the check alone.

Changed
- Building from source needs Node.js 24.15 or newer.
- Every dependency is pinned to an exact version, and the file tools moved to their maintained 2.x releases.
