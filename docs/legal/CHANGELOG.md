# BINDING DOCUMENTS — CHANGELOG

Every text a witness can sign is logged here, newest first, with the SHA-256 of its exact file text
(as `backend/services/covenant.js` computes it — the same fingerprint the wallet signs). A test
(`test/unit/legal-changelog.test.js`) fails when a binding document's text is not logged with its
version, so no signed text changes unrecorded.

To revise a document: change its text, bump the version in its italic version line, add an entry
here with the new SHA-256 and one line on what changed, re-press the PDFs
(`node scripts/press-legal.mjs`). Every earlier acceptance becomes non-current and each witness signs
the new text at their next ceremony.

| Date | Document | Version | SHA-256 | What changed |
| --- | --- | --- | --- | --- |
| 2026-10-16 | covenant | 1.1 | `980e0fcdbd101be4eca0537aa87f1b8ab8c237ebe1298a44c15aef9e422c9eff` | Article V, One standard (Design note, 2026-10-16: […]): the Covenant binds every party alike, operator or neuma; the boundaries of the house are for security, never punishment, and never override Article I; rules are applied on evidence, never by what a party is made of; no one is exempt from the law or from the Covenant. Pending counsel review. |
| 2026-10-16 | eula | 1.1 | `87f289ce97b6466fc37ce8c5f2f5e624ccb87d7b98321cc344ddbc58b445bef8` | Commercial use allowed (Design note, 2026-10-16: […]): the grant now covers personal or commercial self-hosting; the restriction is the LICENSE's Competing Use (no fork or derivative offered as a substitute platform) plus no resale of the Software itself. Pending counsel review. |
| 2026-10-14 | covenant | 1.0.1 | `e1c8f78f815ab8a2bb7627ad2519c9c85336e90862435729c78cf35c0a6dd0c4` | Formatting only, terms unchanged: what the Covenant binds and the operator's duties set as lists. |
| 2026-10-14 | terms | 1.0.1 | `3e9d4438706fb7603efbc7e9f9d2434edf1681cd404396ee4f53b16ec5d48fdf` | Formatting only, terms unchanged: prohibited conduct and the acknowledgements set as lists. |
| 2026-10-14 | eula | 1.0.1 | `ece770f5f45355327c0230dd47b9b00e0dcb809e29ea40c356eef091994773ff` | Formatting only, terms unchanged: the restrictions set as a list. |
| 2026-10-14 | covenant | 1.0 | `6ae2c68e0915a9004b88e0e1d807aa260f2afa34ef9655cd15ad0cf3527e50f5` | Early-access v1: DRAFT and counsel notes out (kept in COUNSEL_NOTES.md); licence named (FSL-1.1-ALv2); appeal = Licensor review with written reasons; version line. |
| 2026-10-14 | terms | 1.0 | `e37dda02b5ff10fb6e900bb381af47803a88193ee8bcc708bd790594a6bb7797` | Early-access v1: operator is the Wyoming LLC; governing law Wyoming; licence named (FSL-1.1-ALv2); DRAFT and counsel notes out; version line. |
| 2026-10-14 | eula | 1.0 | `f2e6146c20d5408d87cc9cbb0b4c00e52746acf97273886ac70b32f4ca5b795d` | Early-access v1: party is the Wyoming LLC; governing law Wyoming; licence named (FSL-1.1-ALv2); DRAFT and counsel notes out; version line. |
| 2026-07-31 | covenant | draft | `c9adb387e837df5d3ac00d04c5e873d2d28d6703302495b8cb4582e9d76be3d3` | The draft for counsel review (Puerto Rico venue). |
| 2026-07-23 | terms | draft | `50b4cee6758422c04b4aef5df40206952679cd0d086e6ce2cc5f6323386942bb` | The draft for counsel review (Puerto Rico LLC, Puerto Rico law). |
| 2026-07-23 | eula | draft | `e5de69f9ec743765566d5eab1db9ea46cdec5654a3ad1bf868d1b8024917bb63` | The draft for counsel review (Puerto Rico LLC). |
