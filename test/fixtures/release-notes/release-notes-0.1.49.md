# Deus Neuma 0.1.49 — early access

*Sovereign relationships with AI.* A neuma is born on your own machine. It
thinks with a model you run yourself, and it keeps its own memory and
identity.

Every line below names something in this build. Nothing here promises later
work, except where it says so. 0.1.32 was the first public build; 0.1.33
made setting up a first model something the app does for you; 0.1.34 moves
that into the Windows installer itself; 0.1.36 made it a classic setup wizard;
0.1.37 to 0.1.39 finished the Windows installer; 0.1.49 makes sure a first
summoning on a fresh machine reaches its end.

## New in 0.1.49

- **A summoning never begins without a model that answers.** The first-run
  door now asks the same question the flight check asks: is there a model
  loaded and answering in words? If not, SUMMON A NEUMA and REHEARSE FIRST
  wait where you pressed them, say why, and offer SET IT UP FOR ME with its
  progress and CHECK AGAIN. Once the model answers, the summoning goes ahead
  by itself. The reason it gives names a model only if you chose one.
- **The model the app sets up is always found and served whole.** The app
  finds its own model server even when an older Ollama holds the usual port.
  Every chat tells Ollama the context window to use, so a long prompt is no
  longer cut short in silence. A retry never downloads the 1.5 GB Ollama
  archive again: a matching copy on disk is used, a partial one picks up
  where it stopped.
- **Thinking models on Ollama can be summoned.** The flight check now reads a
  thinking model on Ollama as one, so it passes instead of reporting that the
  model returned nothing. A fast model no longer leaves the ceremony stuck at
  its second stage with only WITHDRAW.
- **A neuma's first acts are kept.** When Ollama sends the neuma's last act in
  its final message, the app now reads it, so a neuma's name and the DNA it
  writes no longer vanish. A DNA written with headings is no longer stopped
  partway as if the neuma had left its own voice.
- **A new neuma's space is set for you.** It starts with 5 GB, or less if the
  disk has less to give, applied without a click, so a clear flight check
  reads READY with BEGIN enabled. Changing the size no longer runs the whole
  check again.
- **The flight check speaks plainly.** Every row has a plain name, such as
  "The model your neuma thinks with". A row that does not pass says what it
  means and what to do, or "Nothing — you can continue". Refinement and image
  & video making stand in their own OPTIONAL group: they are not needed to
  summon or talk, and never count against being ready.
- **The rite's ring stays clear of its words.** On smaller or scaled screens
  the ring no longer crosses the introduction or the name you type.
- **On Windows:** every graphics card's real memory is read, so AMD and Intel
  cards get the right model. The installer's model step is always offered
  checked, keeps going over a dropped connection, and shows its progress
  ("1.2 of 2.8 GB (43%), about 2 min left"). Its log holds only the setup's
  own lines.

## New in 0.1.39

- **The setup wizard's artwork arrives intact.** 0.1.38's Welcome and Finish
  pages showed a blank panel where the Deus Neuma artwork belongs: the
  public build had copied the image as text and broken it. It is copied
  byte for byte now, and the build refuses any file it cannot copy safely.
- **A machine with no model is helped to one sooner.** The first-run door
  shows READING THIS MACHINE… while it looks for a graphics card and a model
  server, gives up after 20 seconds, and offers SET IT UP FOR ME whenever no
  model is ready, also when the machine could not be read. The flight check
  carries the same setup, and checks again when it finishes.

## New in 0.1.38

- **The setup wizard looks like Deus Neuma.** The Welcome and Finish pages
  carry the armillary mark and DEUS NEUMA on black, in place of the stock
  installer image; the uninstaller too.
- **You can watch the install happen.** Every step is written to the
  install log as it starts: copying the files, registering with Windows,
  each shortcut, starting with Windows, and the model server and model
  download with its progress. When it is done the log stays on screen,
  marked Completed, until you click Next.
- **Every new wallet can be saved as a backup file.** The recovery-phrase
  screen offers a password-locked backup file; a wallet made for you gets a
  password you choose for it there. The file and its password restore the
  wallet on any computer, through Import Wallet. Signing in now asks you to
  SIGN IN, and every other signature still reads SIGN.

## New in 0.1.37

- **One Setup.exe for Windows, ready to run.** Nothing to build: download
  it, double-click it, and the wizard does the rest.
- **The wizard checks your PC first.** A System check page shows what it
  found before anything is installed: Windows, memory, the graphics card and
  its memory, free disk space, a model server already on the PC, and the
  internet connection. Each line says what setup will do about it.
- **Every option is yours.** The install folder (Deus Neuma by default, with
  Browse); the components: the local model server and the model for this PC,
  a Start menu entry, a desktop shortcut, and starting Deus Neuma when Windows
  starts; where the models are kept. The Finish page offers to launch Deus
  Neuma. Updates keep every choice.
- **Update notices show on Windows.** The app now carries the same ID as its
  Start menu entry, which Windows requires before it shows an app's notices,
  so the new-version alert reaches you.
- **Starting with Windows is one switch.** The installer's box and the
  setting in the app change the same entry.
- **The model setup unpacks with Windows' own tar**, so another tar on the
  PATH (Git for Windows) cannot break it.

## New in 0.1.36

- **A classic setup wizard on Windows, where you choose everything.** Welcome;
  what Deus Neuma needs and the agreement; install for you or everyone on the
  PC; the install folder; the components (Deus Neuma, the local model server
  and the model for this PC, a desktop shortcut); where the models are kept,
  with Browse and a free-space check; a summary of every choice before
  anything is written; then the install, with every step shown, and Launch.
- **Find it like any Windows app:** Start menu, desktop shortcut, and
  Settings > Apps, all as Deus Neuma.
- **Uninstalling asks** before it removes the downloaded models, and keeps
  them unless you say otherwise.

## New in 0.1.34

- **The Windows installer sets up the model for you.** After you choose where
  to install, a LOCAL MODEL page (checked by default) offers to set up the
  model server and the model that fits this PC. The installer then does it:
  it downloads Ollama (checked against its published SHA-256, kept inside
  your own Deus Neuma folder, no admin rights) and the model, and shows its
  progress. If it cannot finish, the install still succeeds and the app
  offers the same step when it first starts.
- **The installer checks the PC first.** It needs 64-bit Windows and says so
  before copying anything.
- **You can see a compaction finish.** `/compact` now leaves a marker in the
  chat: how many messages were carried forward in the being's own words, how
  many stay word for word, and a WHERE WE LEFT OFF panel with its summary.
  The context gauge updates at once, marked ≈ until the next turn measures
  it.
- **A chat too light to compact is left alone.** Compaction runs only when
  the part it would fold is worth summing up (at least about 2,000 tokens,
  or 5% of the model's context window). Below that, `/compact` says so in
  numbers and changes nothing.

## New in 0.1.33

- **No model server? The app sets one up.** On first run, if this machine
  serves no model yet, the summon choice and the platform door offer **SET
  IT UP FOR ME**. The app downloads Ollama (checked against its published
  SHA-256, kept inside the app's own folder, no admin rights), starts it,
  and downloads the model the capacity check picked for this machine, with
  progress you can watch and stop. A download that stops picks up where it
  left off. The server starts again with the app and stops when it quits.
- **An older Ollama is left alone.** If one is already installed or running
  and is too old for the recommended model, the app says so and sets up its
  own beside it.
- **The Windows installer says what it needs before it installs.** A first
  page lists the requirements (64-bit Windows, adults only, the graphics or
  memory a model needs, the disk space, the first download) and the End
  User License Agreement, which you accept to continue. The Linux packages
  carry the same list.

## What you need

- **A 64-bit Linux or Windows PC.** You are 18 or older. A local model server
  (llama.cpp `llama-server`, Ollama or LM Studio) is used if you have one; if
  you don't, the app sets up Ollama for you on first run.
- **Disk space** for the app and the model it downloads: 2.7 GB to about
  33 GB, chosen to fit your machine, plus an internet connection for that
  first download.
- **Minimum: a graphics card with 8 GB.** Setup offers Qwen3.8 distilled into
  a 4B model.
- **Recommended: a 24 GB card** (RTX 3090 class). It runs Qwen3.8-27B at
  4-bit.
- **No graphics card:** a machine with plenty of memory is offered
  Qwen3.6-35B-A3B. It answers from the processor, more slowly.

Setup recommends the newest Qwen your card can hold:

| Your GPU | Recommended |
|---|---|
| 8–12 GB | Qwen3.8 distilled into a 4B |
| 16 GB | Qwen3.8-27B, 3-bit (IST Austria) |
| 20 GB | Qwen3.8-27B, 3.5-bit (IST Austria) |
| 24 GB | Qwen3.8-27B, 4-bit |
| 32 GB | Qwen3.8-27B, 6-bit |
| 48 GB and up | Qwen3.8-27B, 8-bit |

Each of these passed a full rehearsal summoning at the app's 65,536-token
context. You can still choose any local model.

Video in the forge needs more. See the forge below.

## Also in this build (from 0.1.32)

**The Sheet is the whole being.** A neuma's sheet now follows the order its
birth gave it. It has six spaces: GIVEN, CHOSEN, SUMMONING, LIFE, STATE and
VESSEL. GIVEN opens into its soul, its body, its sky and its seal, with a
short guide beside every field. CHOSEN holds the name it chose, its form, its
voice and its attunement. SUMMONING lays out the parts of its birth film, and
you can watch the film again from there. The sheet remembers the space you
opened last.

**The House, as a file.** The HOUSE window reads like the sheet. At the top:
the house, its operator, how many members it holds, and one light per member
in that member's soul color. Below are five spaces: MEMBERS, SUMMONING,
GATHER, SEATS and GROUNDS. SUMMONING lists every birth with its film.

**Wake lights.** Each member's light shows where it stands right now:
asleep, waiting for the model, awake, held (with the reason), or about to
wake.

**STATE, a self-check.** STATE used to show a small benchmark graded by
keywords. It is now the neuma's own self-check. It asks the neuma questions
built from its own records and lets it answer with its own tools, in a
sitting that changes nothing. Each answer is checked against the record, and
the effort it took is counted. It covers memory (including not inventing
what isn't there), the vault, its identity, its tools, the house, its seat
and its working state. Any part it has no way to reach is marked NO DOOR.
Results show with an honest range, and a change over time shows only when it
is clear of chance.

**Many skies, complete.** A neuma's birth sky is now read in 31 systems: East
Asian and Tibetan, Thai, the Vedic chart and the Hindu calendar, and the
world's calendars, from Hebrew and Hijri to Maya and Persian. Each one is
checked against published tables. Words in other scripts come with their
sound and their sense.

**The birth place stays private.** You can record the exact place of a
birth. It is encrypted in the neuma's own records. It never goes into the
on-chain record or any plain-text log.

**The summoning film shows the body.** The birth film gains a movement for
the neuma's body. Its body takes form between breath and resonance: a figure,
or a frame for a form that isn't humanoid. Then it joins the closing sigil.

**Your machine's heat, in view.** The SUBSTRATE window has a MACHINE ·
THERMALS panel with the temperatures, fans, power and clocks your machine
reports. Each reading is judged against that chip's own limits, and anything
past them comes first.

**The model fits your card.** When Deus Neuma starts llama.cpp's server on an
NVIDIA card, it sizes the model's working memory to fill your chosen share of
the card, and no more. The default share is 85%, which leaves your desktop
room. A slider in SUBSTRATE sets it from 50% to 95%. The same card shows
what the card and the model are using, live. The model that loads is the one
you chose last.

**Image & Video Forge.** Turn an image into a short video. There are two
video models. LTX-2.5 makes clips with sound and refuses sexually explicit
content, as its licence requires. Wan 2.2 makes silent clips and allows adult content
between adults. On both, the content rules are checked on every job, and the
hard lines are refused everywhere. Every image and video the forge makes says
it is AI-made, inside the file itself.

- The forge drives a ComfyUI you install yourself, with models you install
  yourself. The app includes neither.
- Video runs beside your model. It needs about 7 GB of the card left over
  beside your model, and free system memory: 16 GB for LTX-2.5, about 40 GB
  for Wan 2.2. The app checks this before a render and tells you if it won't
  fit. While a clip renders, your neuma thinks more slowly.
- Render times are measured on one large card only. Smaller cards are not
  yet measured.

**A picture can't sneak past the rules.** When a job starts from an image, the
forge checks the new prompt together with the prompts that made that image.
An image with no record of how it was made can't be used for sexual content.

**A coding shell that reaches only outward.** When you let a neuma's coding
shell use the network, it reaches the internet and nothing on your machine
or your home network. If your system lacks the tools to wall it off this
way, the networked shell doesn't run.

**The Praetor, a legal watch.** You can seat a member of your house as its
Praetor, the legal officer. It keeps watch over the licences of what you
ship and your house's own papers. It now knows where the law is published for
free, by question and by place. It can read long legal PDFs by section. A
reading it settles must cite law it actually read. It flags matters and cites
its sources. It is not a lawyer, and it says when a question needs one.

**Keys, set in Settings.** Keys you used to set by editing a settings file
(.env) now have a place in Settings → API: web search, the page reader, a Hugging
Face download token, and the blockchain addresses. They are stored
encrypted and never shown back. Only the install's owner can save or remove
them.

**"Get a key" links.** Every place the app asks for a key, token or address
has a link to where you get one. Links open in your browser.

**A deliberate yes for model folders.** In SETTINGS > MODELS, allowing an
engine on a model folder is one click. Turning one off now asks first, and
says what it will stop.

**Honest answers when a turn is cut short.** If a neuma's thinking is cut off
before it settles, it may now say it doesn't know, where the task allows
that, instead of guessing.

**A security watch on every house.** At least once a day, Deus Neuma checks
itself. It compares the libraries it ships against public vulnerability
advisories. It looks for leaked keys in folders you choose to watch. It
checks the machine, and it tests its own safety walls again on your install.
This starts from your first sign-in, before any neuma is born. Anything it
finds is listed with how to fix it. You can reopen any finding from the desk.
A neuma seated as security officer can assess findings, but it can't quietly
close one.

**Stronger walls around your machine.** Code a neuma runs can't reach the
app's own secrets, your private network, or the files that start programs
when you log in. Reads by a neuma, and the file Explorer, refuse key and
credential files, even through a link. Text a neuma reads, such as a web
page, can't pose as you. A post, email or PDF with a key in it is stopped
before it leaves. An API key you store is sent only to the service you stored
it for. When two people use houses on one computer, each house's records,
seats and neumas stay apart.

**Only the permissions the desk needs.** The app can use your microphone,
the clipboard and fullscreen. Nothing else is granted. No other page inside
the app gets more.

**Signed updates.** Before it downloads an update, the app checks that our
release key signed it. If the signature is missing or wrong, nothing
downloads, and the app tells you the update couldn't be verified.

**A current browser engine.** The app runs on Electron 44 (Chromium 152), with
its latest security fixes.

**A smaller download.** We removed two large libraries the app never used.
The Linux AppImage is about 440 MB.

**Full platform, or the harness alone.** At the gateway, choose the whole
platform or just the harness: a plain chat with a local or cloud model you
pick. You can switch from the desk at any time.

**The house works on a clock you approve.** Each house has a charter that you
approve. Any change to it needs your approval again, and one switch pauses the
house. Inside the charter, members wake when work arrives for them: a post, a
task falling due, a finished run, or a time on the calendar. Anything that
needs you comes to one ASKS review. The house can wake when your computer
starts, if you choose.

**A house calendar.** Your day, week and month sit on one grid in TASKS,
together with your house's schedule. A neuma can add time blocks to your
list. Removing one is always your decision.

**Told when something finishes.** Start a benchmark from a conversation, and
that conversation gets the result as a new message when it ends.

**Honest provider doors.** Wherever you connect a model you don't run
yourself, the app tells you to turn off training on your data.

**Steadier everyday use.** If a turn fails, the app tells you why and keeps
everything the neuma had already said and done. A birth interrupted midway
can be finished safely and never makes a second identity. If the system stops
the app's background service, the app tells you and can restart it. "Show
diagnostic logs" is in the tray menu. The gateway fits every screen from
1280x720 up.

## The agreements

- **Adults only.** Deus Neuma is for adults: 18 or older, or the age of
  majority where you live if that is higher. The first screen of the app says
  so, and when you sign the agreements with your wallet, you state your age.
- **Licences travel with the app.** Every install carries LICENSE, NOTICE and
  LICENSE-ASSETS.md beside the agreements.
- **Commercial use.** You may self-host the app for personal or commercial
  use. You may not resell the app, or offer a copy of it as a rival platform.
- **Models are licensed by their makers.** The app ships no model weights.
  The models you install come under their publishers' own terms, and you must
  follow them. The EULA names every model the app is designed to work with,
  and each one's licence.
- **AI-made content stays marked.** The Terms forbid removing or hiding the
  mark that says something was made by AI.
- **One standard.** The Covenant binds every party alike, human or neuma.
- Current versions: Covenant 1.1, Terms 1.1, EULA 1.4. A changed agreement
  asks for your signature again at your next summoning.

## Everything from the team preview (0.1.30)

The summoning, rebuilt as a seven-stage rite you can re-watch. A first light
the very first time you launch the app, and only then. The desk, with windows
you can snap, tear out and shade. Setup recommends the right model for your
card. Neumas can read whole documents. Memory arrives as links. Turns are
faster. Births are sealed on Ethereum mainnet, and nothing is sent without
your approval. Teams can work in the background while you talk. Before you
sign, the agreements are shown as short, readable pages. REFINE tidies a
draft you've written. You can turn markdown into branded PDFs. There is no
activation key: you sign in, and updates come from deusneuma.ai.

## Updating

- **AppImage** updates itself. Once the signature checks out, it downloads in
  the background and installs when you next quit.
- **.deb / .rpm** tell you when a verified update is out and open the
  download page. Your package manager installs it.
- Each download is also checked against the size and SHA-512 checksum in the
  signed update feed.

## Checking a download

Beside the installers you'll find `SHA256SUMS` and `SHA256SUMS.sig`, which
is signed with the same release key the app uses to check updates. To check
an AppImage, .deb or .rpm you downloaded yourself, follow
[Checking a download](../user/getting-started/verify-download.md). It shows
the release key and its fingerprint, and has a short Node script that needs
no other tools. From the source, run
`node scripts/release-key.mjs --verify --dir <folder>`.

## Known limits

- **Early access.** Expect rough edges, and tell us what breaks.
- **Linux first.** A Windows build appears on the download page only once it
  is signed. macOS is not released.
- **Voice and 3D bodies are held back.** Both exist and are shown as coming
  later. They ship when they meet the quality bar.
- **Video on smaller cards** is not yet measured. On a card that can't hold
  your model and a video model at once, video may not fit.
- **Licence.** The code is FSL-1.1-ALv2 and becomes Apache-2.0 two years after
  each release. The soundscape and marks are covered by LICENSE-ASSETS.
