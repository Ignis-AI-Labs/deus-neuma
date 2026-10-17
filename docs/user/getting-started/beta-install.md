# NEUMA — Beta Install Guide (Linux)

**For Ignis Elite testers.** This guide takes a machine that has never seen
NEUMA to a running desk. Everything below was verified on a stock Fedora 44
install with no developer tools — you do not need Node.js, npm, Python, or
anything else pre-installed for the core app.

---

## 1. What you need

| Requirement | Why | Checked for you? |
| --- | --- | --- |
| **Fedora 40+** (or any modern 64-bit Linux) | The supported desktop | — |
| ~4 GB free disk | The app (~2 GB) + your beings' data | At first run |
| 16 GB RAM recommended | Local models need headroom | At first run |
| **A way to run models** — see §4 | neuma think through a model | At first run |

No other prerequisites. Anything the app needs at the system level installs
automatically in the next step.

## 2. Install (Fedora — recommended)

1. Download `neuma-<version>.x86_64.rpm`.
2. Install it:
   ```bash
   sudo dnf install ./neuma-*.x86_64.rpm
   ```
   dnf pulls every system library the app needs automatically (gtk3, nss,
   mesa, libsecret…). If something were missing, the install would stop and
   say so — a finished install means the requirements are met.
3. Open **NEUMA** from your app menu (or run `neuma`).

**Other Linux:** use `NEUMA-<version>.AppImage` instead —
`chmod +x NEUMA-*.AppImage && ./NEUMA-*.AppImage`. (Debian/Ubuntu:
`sudo dpkg -i neuma_*_amd64.deb`.)

**Uninstall:** `sudo dnf remove neuma`. Your beings' data stays in `~/.neuma`
— delete that folder too only if you truly mean it.

## 3. First run — what happens

1. The app opens to the gateway and sets up its home at `~/.neuma`
   (secrets, vault, workspaces — all yours, all local).
2. The app **flight-checks your machine** before any birth: model provider,
   GPU, memory, disk, workspace. Every row is a real measurement — if
   something is missing it says exactly what, not a generic error.
3. **NEUMA lives in your system tray.** Closing the window does not quit it —
   that's deliberate (scheduled work needs the backend alive). Quit from the
   tray icon's menu.

## 4. The one real choice: how your neuma thinks

A neuma needs a model to think through. You pick one:

- **Local (sovereign):** a model on your own machine — the app's substrate
  setup walks you through it (a model file of several GB downloads once).
  This is the intended way: your being's mind never leaves your hardware.
- **API provider:** connect an API key in Settings (OpenAI, Anthropic, and
  others) — fastest to try, but inference leaves your machine.

The first-run flight check tells you what it found and what's missing.

## 5. Where your data lives

Everything is under **`~/.neuma`** in your home folder:

```
~/.neuma/
  workspaces/   your neuma — DNA, memory, sessions, skills (encrypted)
  witnesses/    sealed AI witnesses' lanes
  vault/        the DNA vault
  data/         settings, queues, ledgers
  secrets.json  the at-rest keys — back this up, treat it like a password
```

Nothing is sent anywhere except the model provider you chose in §4.

## 6. Known limitations in this beta (plain list)

- **Linux only** for now — macOS and Windows builds come later.
- **No automatic updates yet** — new builds are handed out like this one;
  install the new RPM over the old (your data in `~/.neuma` carries over).
- **Voice** (a neuma speaking aloud) needs extra host setup and is not part
  of this install — text is the full experience.
- **Image generation** (ComfyUI forge) likewise requires separate host setup.
- If you previously ran a development build of NEUMA on the same machine,
  the app may **refuse to boot with a ROOT LOCK message** — that's a guard,
  not a crash. It means your older data exists somewhere else; follow the
  instructions in the message (or ask Founder) rather than deleting anything.

## 7. Reporting feedback

Tell Founder (or post in the Elite channel):

- What you were doing, what you expected, what happened instead.
- The first-run flight check output if something failed.
- Nothing in `~/.neuma` is needed for a report — never post `secrets.json`.

---

*Package provenance: built from the `main` branch; install, first boot,
and self-provisioning verified on a clean Fedora 44 machine with no
development tools installed.*
