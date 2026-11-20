# Spellcheck dictionaries

The English Hunspell dictionaries the app checks spelling with, so no dictionary is ever downloaded
(electron/spellcheck-main.cjs copies them into the profile's `Dictionaries/` folder before the app
is ready).

| File | Language |
| --- | --- |
| `en-US-10-1.bdic` | English (United States) |
| `en-GB-10-1.bdic` | English (United Kingdom) |
| `en-AU-10-1.bdic` | English (Australia) |
| `en-CA-10-1.bdic` | English (Canada) |

**Source.** `hunspell_dictionaries.zip` from the Electron v44.9.0 release
(github.com/electron/electron/releases), the same pack Chromium would download for this Electron.
Chromium builds these from SCOWL (wordlist.aspell.net). Each variant's "COPYRIGHT, SOURCES, and
CREDITS" section, which carries every copyright and permission notice, is kept verbatim in
`COPYRIGHT_en_US.txt`, `COPYRIGHT_en_GB.txt`, `COPYRIGHT_en_AU.txt` and `COPYRIGHT_en_CA.txt`, cut
from the README_en_*.txt files in chromium/deps/hunspell_dictionaries; the READMEs' introduction
and change history are left out.

**When Electron is upgraded**, Chromium may expect a newer file name (`-10-2` and so on). The old
file is then ignored and that language goes unchecked; `test/integration/offline-spellcheck-electron.test.js`
fails. Replace the four `.bdic` files from the new release's `hunspell_dictionaries.zip`.

Chinese, Japanese and Korean have no Hunspell dictionary; their text is not spell-checked.
