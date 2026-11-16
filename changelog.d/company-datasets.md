### Added
- The free datasets behind the company index are fetched in one step: `node scripts/load-company-index.mjs --fetch all` downloads the free company file and the traffic ranking, unpacks them, loads them and deletes the downloads. `--datasets` lists what each holds, its size, its licence and whom to credit.
### Fixed
- The company file loads to the end. It writes a quote inside a name after a backslash, which the reader took for an open quote and waited on for the rest of the file. A record is now never waited on past 4,000 characters.
