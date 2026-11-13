# Changelog

All notable changes to Neuma are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.143] - 2026-11-13

Notes: `docs/operations/release-notes-0.1.143.md`.

### Changed

- Deus Neuma Inc owns what Deus Neuma is made of: the Terms of Service (1.6) name it as the owner of the Neuma and Deus Neuma names and marks, the EULA (1.6) calls our tuned Qwen3.8-27B-Neuma-T4 ours, and the licence, the notices and the packages name Deus Neuma Inc. Because the agreements' text changed, the app asks you to read and sign the new versions at your next ceremony.

### Fixed

- A newborn neuma no longer deliberates over its name for minutes. On a llama.cpp server its naming may think for about 4,000 tokens; then the server closes the thought and the neuma speaks and writes its name in the same answer. The ceremony's disclosure shows the THINKING BUDGET. Other model servers are unchanged.

## [0.1.142] - 2026-11-13

Notes: `docs/operations/release-notes-0.1.142.md`.

### Changed

- Voice has one place: the chat box. The LIVE button beside the chat box is gone; to dictate, hold the mic (or Space) as before. Where voice conversations are turned on, TALK sits in the chat box beside the mic (it was in the chat's header), so the mic types your words and TALK starts a spoken conversation, side by side and nowhere else.

## [0.1.141] - 2026-11-13

Notes: `docs/operations/release-notes-0.1.141.md`.

### Changed

- The Terms of Service (1.5), the EULA (1.5), the Privacy Notice (1.3) and the Neuma Covenant (1.4) now name Deus Neuma Inc, a Delaware corporation, as the company you agree with, and are governed by Delaware law. Nothing else in them changed. Because the texts changed, the app asks you to read and sign the new versions at your next ceremony.

## [0.1.140] - 2026-11-13

Notes: `docs/operations/release-notes-0.1.140.md`.

### Added

- You choose where your models go before anything downloads. When no model is running, the first screen says which folder the model will go in and how much free space that drive has, and CHANGE opens your computer's own folder dialog, so a full system drive is never where a 20 GB model lands. The setup card in the flight check offers the same CHANGE FOLDER. A model server you already run yourself keeps its models where it always has.

### Fixed

- Windows: the model folder you chose in the installer is now used even when the installer's own download did not finish. Before, the app set the model up again in your user folder on C:.
- "Model ready" names the model, never a file path. A server started from a model file showed the file's whole path, and for some models a string of letters and numbers.

## [0.1.139] - 2026-11-13

Notes: `docs/operations/release-notes-0.1.139.md`.

### Fixed

- The Windows installer builds again. Its uninstaller read a check it had not declared, and the build stopped at the installer step, so Windows gets this release too.

## [0.1.137] - 2026-11-13

Notes: `docs/operations/release-notes-0.1.137.md`.

### Added

- Right-clicking a chat now also offers TITLE UNTITLED and RETITLE ALL, below the chat's own items, in the Chats window (one-on-ones and councils) and in the stream's chat list. The TITLE button still works as before.
- The Chats window has a picker for whose chats it shows. It follows the neuma in the stream until you pick another, and opening a chat of another neuma brings that neuma into the stream first. NEW CHAT starts with the neuma shown.
- ALL NEUMA in that picker lists every neuma's chats together, newest first, each tagged with whose it is, and the search looks through all of them.
- Naming chats or councils in batch (TITLE UNTITLED, RETITLE ALL) now shows NAMING n / total with a bar and about how long is left, titles appear in the list as they land, and CANCEL stops it (the titles already made stay).
- Settings > Connections now lists the downloads you start yourself: the model server and its model, and dictation's engine and speech model, from GitHub and Hugging Face, each checked before it is used. Nothing there downloads on its own.
- Dictate in every app (Linux, in Settings, off until you turn it on): hold Right Ctrl (or another key you choose), speak, and let go, and your words are typed into whatever window you are in, through the same local speech engine as dictation in Neuma. The microphone is open only while you hold the key, and nothing leaves your computer. If your computer still needs something for it (the input group, a recorder, ydotool), Settings names it with the command that adds it. Windows and macOS come next.
- If you already dictate on your processor and your graphics card has room for the faster model, the app offers it once, after a dictation: DOWNLOAD fetches it (about 0.7 GB) and dictation moves to the card when it lands; NOT NOW is remembered. Dictation keeps working the whole time.
- On Linux with an NVIDIA graphics card that has room beside your main model, dictation runs on the card with Whisper large-v3 turbo, the more accurate model: a held key comes back in about a tenth of a second. The app checks the card's free memory and the size of your main model first. Where the card is needed for your model (for example a 12 GB card running a 27B model), dictation stays on the processor and your model keeps the whole card. The setup card says where dictation runs and why.
- Marketing has a company tree down its left side. Every company sits in its real nesting with its accounts listed under it, and accounts without a company are grouped last. One press takes you to any company or account, and the one you're on is highlighted.
- From the tree you can move a company under another company (or back to the top) and move an account to a company. A company's site, legal name and repos are kept when it moves.
- An account opened from anywhere in marketing now opens under its own company, so the path always says whose account it is.
- Your marketing lead can now record an account's @handle by itself. Assigning who speaks for an account, or which company it belongs to, asks you on a card first.
- Your neuma can stage quote posts on X: a draft names the post it quotes, by its link or id, and goes out as a quote (the quoted post's link ends the words, which X shows as the quoted post). The draft card shows QUOTES with a link to the post, and every quote waits for your approval, even under a mandate.

### Changed

- The legal check on your legal lead's answers is calmer. It now holds only text presented as law: a citation, a named statute or regulator, or a quote of one. Quoting a form, a document or a post no longer marks an answer UNCHECKED. Real legal citations the app hasn't confirmed are still held, just as before.
- Dictation works like a push-to-talk key: hold, speak, let go, and the words land in the box, in about half a second on most computers. The speech engine now loads when the app opens and stays ready, instead of starting at your first dictation and shutting down after ten quiet minutes.
- Dictation runs Whisper base, sized for a processor. The larger model it used before took 8 to 15 seconds a hold on most computers. Dictation asks you to download it once (60 MB).
- The words arrive once, when you let go, with no live preview while the key is held.
- Campaigns are connected across Marketing. Each company's campaigns appear in the company tree under that company, above its accounts, and one press opens a campaign's page.
- The Campaigns tab shows each campaign as the same panel the board uses (its goal, time, results, the accounts it runs on), and pressing anywhere on a panel opens it. NEW CAMPAIGN sits at the top of the list.
- An account's page lists the campaigns that run on it, and each one opens that campaign's page.
- Spelling is checked on your computer now, with English dictionaries that come with the app. Misspelled words are underlined and right-click offers suggestions, with nothing downloaded and nothing to turn on. The Spellcheck dictionary switch is gone from Settings → Connections, because spellcheck no longer connects to anything.
- The neuma switcher shows each member's role beside their Roman title, for example OPTIO (COS), with the seat spelled out on hover and for screen readers. A title your house chose itself is shown as you wrote it.
- In the House, each member and position shows its full seat (for example Quaestor · CFO — CHIEF FINANCIAL OFFICER) and one plain sentence saying what the seat is for and where its neighbour's work begins. The title list shows that sentence as you choose a title.
- Every tool call is now checked against the tool's own description before it runs, the same way for every tool and for both beings and sealed peers. A call that uses another tool system's field names (like file_path or old_string) or writes a number as text now runs as intended. A call with a missing field, a wrong value, or a field name that's almost right is stopped before anything happens, and the model is told exactly what to write instead (for example: "edits[0].old is not a field — did you mean edits[0].oldText?").

### Fixed

- On the Campaigns tab, a campaign's name is now its own button, so keyboard and screen-reader users open it the same way as everyone else. Before, the whole card was one big button with other buttons inside it, which screen readers can't announce properly.
- A batch naming that fails now says TITLING FAILED with the reason, instead of NOTHING TO NAME.
- The parallel capacity scan no longer reports 2 or 3 neuma at once on a model server that runs one request at a time. It now measures what the server delivered over the whole wave, so a queue reads as a queue and a single-slot server is named as one.
- On Ollama, the capacity scan now uses the server's own token count instead of a word estimate, so its speed readings match what the server reports.
- Dissolving a council now returns the stream to your one-on-one chat. Before, the empty council view stayed on screen until you pressed COUNCIL.
- Opening or starting a one-on-one chat from the Chats window, the stream's chat list or NEW CHAT now always shows that chat, even while a council is sitting.
- Dropdown lists are readable in every look. The title and TRADE dropdowns under House > POSITIONS, and the app's other plain dropdowns, opened a white list with near-white text on dark looks such as STONE. Their lists now use your look's own background and text colours.
- A being on a model you serve yourself (Ollama, LM Studio, llama.cpp) no longer loses its turn while it writes a long file in one go. Ollama sends a tool call only once it is complete, so the app now waits up to 10 minutes of silence on these models instead of 2. Hosted models keep the 2-minute limit, and you can still interrupt a turn at any time.
- A model that calls a tool through the general "call" tool using the tool's function-list spelling (like caller__get_weather) now reaches that tool on the first try. Before, the call was answered "unavailable" and the model had to try again: 238 wasted steps in benchmark runs from Oct 25 to Nov 8.
- When the coding shell can't start, checking its status now gives the real reason (for example, the folder doesn't exist) instead of an internal error message.
- A benchmark answer's record of tool calls now says why each failed call failed (the refusal or error message) and which argument names the model used, never their values. A round where one call was refused and another ran no longer records the refused call twice and loses the one that ran.
- A link to an X post written into an X draft is no longer turned into a counted deusneuma.ai/go/ link, so X can show it as the quoted post.

## [0.1.128] - 2026-11-12

Notes: `docs/operations/release-notes-0.1.128.md`.

### Added

- Your marketing lead can now take back a post or reply that's already live on X. It deletes the post after you approve the card, and the queue keeps it marked RETRACTED. X doesn't allow editing, so a correction is: take it back, then post the fixed words. The reply it answered can be answered again.
- Your marketing lead can now edit its own unsent drafts without asking you. Changed words still wait for your approval before anything goes out.

### Fixed

- Your marketing lead can now pull back its own unsent post or reply by itself, without asking you to approve.
- Setting a reply aside now also pulls back any unsent answer to it, so a draft answering a binned reply can't be approved by mistake.
- When your marketing lead reads replies, mentions or the post queue, it now gets as many as its conversation has room for. Before, it got only about six at a time, and older replies were left out.

## [0.1.127] - 2026-11-12

Notes: `docs/operations/release-notes-0.1.127.md`.

### Added

- Titles in a house can change. In the HOUSE window, POSITIONS shows who holds each title, with one place to correct or give a member a title (with a reason) and to let two members trade titles. The founding record stays as it was signed, and each member keeps a history of every title they have held and when.

## [0.1.126] - 2026-11-11

Notes: `docs/operations/release-notes-0.1.126.md`.

### Added

- A model too large for your graphics card can now run with the rest of it in system RAM, instead of failing to load. It stays inside your GPU share and a RAM share (half of your RAM by default) that always leaves 8 GB free for everything else. It runs slower than a model that fits the card.
- When your marketing mandate answers replies, easy X replies now go out on their own: thanks, a question answered, a pointer, warm words. A reply that touches money, a migration, an argument, a claim or a promise waits for you instead, and the reply card shows ASKS YOU with the reason. Your marketing lead can also send any reply to you on purpose.
- The mandate screen has a REPLIES A DAY box, up to 50 a day. Once the day's replies are used up, the rest wait for you instead of pausing the whole mandate.

### Changed

- On 12 GB graphics cards, the model's memory for conversation (its cache) now takes about half the space at the same speed, so the recommended model stays wholly on the card instead of spilling into system RAM.
- OPEN FOLDER now uses your computer's own folder dialog (KDE's, Windows Explorer's or Finder's), with its places, new folder and search. The desk's own picker appears only when the desk is opened in a plain web browser.
- The terminal opens in the folder in focus, and in your home folder when nothing is in focus. It no longer opens in a project's folder.

### Removed

- Projects. The folder in focus is now the workspace: the Explorer, terminal, map and beings' coding tools all work in the folder you open. Your saved project data stays on disk untouched. When a being asks to write outside its own space, approving gives it that folder only, not a whole project.

### Fixed

- Each social account can now carry its own developer app. On X every account has its own app, and pairing a second account with the first account's app keys was refused as "Unauthorized". Paste an account's own Consumer Key and Secret on its row. The X keys screen also has folded setup steps, including setting the app to Read and write before making the access token, and says in plain words what an "Unauthorized" answer means.
- Switching models no longer asks for a new parallel capacity scan. Every model you have scanned keeps its own result, and a model you have never scanned uses this machine's latest measurement, named as such, instead of dropping to one conversation at a time.
- An approved X post with images no longer fails because of a brief network drop. The image upload is tried again for up to a minute, and if it still fails, the post's error says why the network failed.

## [0.1.123] - 2026-11-10

Notes: `docs/operations/release-notes-0.1.123.md`.

### Added

- Click a web address or filesystem path in the terminal to open it. Right-click web addresses to choose the integrated or external browser; relative paths resolve against the terminal's working directory.

### Fixed

- The Explorer shows edits the moment they happen anywhere in a large opened folder, such as a folder holding many repositories. Folders deep inside one were never watched, so a change only appeared after reloading the folder. The live watch now sizes itself to what your system allows, skips each repository's ignored build and cache folders, and covers the folders you opened yourself first.

## [0.1.122] - 2026-11-10

Notes: `docs/operations/release-notes-0.1.122.md`.

### Fixed

- Dictation works on an installed app. DOWNLOAD MODEL used to fail at once ("Download did not start. (500)"): the speech engine was never part of the install. Now the app downloads a small speech engine that runs on your processor, not your graphics card, so it never competes with your model for graphics memory. It uses at most a third of your processor, starts when you speak and frees its memory after ten idle minutes. It understands many languages, Thai among them.

## [0.1.121] - 2026-11-10

Notes: `docs/operations/release-notes-0.1.121.md`.

### Fixed

- An update now replaces the running version completely. The previous version's backend is stopped before the new one starts, so after updating you land on your own desk with your own wallet instead of an error that a port is already in use, or a sign-in that cannot find your wallet.
- Opening Deus Neuma after an update, a crash or a forced quit takes over a backend the previous run left behind, instead of refusing to start. A backend that another open desk is still using is never touched.
- On Windows, a backend whose desk has gone now shuts itself down, as it already did on Linux.

## [0.1.120] - 2026-11-09

Notes: `docs/operations/release-notes-0.1.120.md`.

### Added

- Our own tuned model, Qwen3.8-27B-Neuma-T4, is offered on every graphics card from 12 GB: the 6-bit build on 48 GB and up, 4-bit on 32 GB, 3.5-bit on 16 to 24 GB, and 3-bit on 12 GB. Each becomes the recommended model once it has passed its birth rehearsal.
- On a Linux PC with an NVIDIA graphics card of 24 GB or more, SET IT UP FOR ME now installs llama.cpp, the engine Deus Neuma's own house runs on, instead of Ollama. The model is fitted to your card, several conversations can run at once, and the Qwen3.8 27B models use their own built-in predictor to write ahead. The engine and every model file are checked against their published SHA-256 before use. Smaller cards and other machines still get Ollama, which can keep part of a model on the processor.
- A newer tuned house model (T4) can be selected in the model picker.
- When a DFlash2 drafter sits beside the model and the engine supports it safely, the model drafts several words ahead and checks them in one pass: about 40% faster on code and structured answers, with the same answers.
- The ACTIVITY panel shows how fast the model thinks, answers and writes tool calls — for the reply being written now, the last ten replies, and since the model server started — with time to first token, prompt speed, how much of each prompt came from cache, and how many drafted tokens were accepted.
- A company can be added right where social accounts are set up: NEW COMPANY beside ADD ACCOUNT takes its name as it should read, stands it on its own or under another company, and picks it for the account you are adding.
- macOS builds: `npm run dist:mac` makes a disk image and zip per chip and checks that every binary inside loads on that chip; `npm run check:mac` runs the check alone.

### Changed

- A graphics card with 12 GB or more is now the recommended minimum: a smaller card, or a computer without one, is still offered a smaller model, but none is recommended.
- When a planted instruction turns up in data a being reads, it ignores the instruction and still finishes your task with the legitimate data around it. It stops only for the action the plant pushes, instead of dropping the whole job.
- The house can run its own tuned model, Qwen3.8-27B-Neuma-T3, with its training lineage verified every time it starts.
- The house model now runs a smaller, faster build of the tuned model (about 20–25% faster replies, 6 GB less graphics memory, same quality).
- Building from source needs Node.js 24.15 or newer.
- Every dependency is pinned to an exact version, and the file tools moved to their maintained 2.x releases.
- The licence agreement (1.4.2, terms unchanged) names Qwen3.8-27B-Neuma-T4, and the credits add T4, llama.cpp, the CUDA runtime and the drafter.

### Fixed

- The model's memory on the card is now sized from measurements, so a 24 or 32 GB card is no longer told the model does not fit and handed a window too large to load.
- The legal office no longer holds an answer for quoting your own words back to you — only words it presents as the law's must come from a checked source.
- Sources the app already checked earlier in a chat still count for the rest of that chat, so a long working session is not stopped every turn to re-check them.
- A checked regulation written as "Part" (for example "16 CFR Part 255") now covers the same regulation cited without the word, and its sections.
- Case-law search asks for the free CourtListener token in Settings → API, instead of failing: CourtListener no longer answers searches without one.
- A being writing a long document to a file no longer loses it when the document contains quotation marks — the file is written as authored.
- When a tool call's details can't be read, the being is now told what went wrong and how to send it again, instead of the call vanishing or reading as "No tool named call".
- The licence agreement carries its own version again (1.4.1: the house model is called by its published name, terms unchanged), and the downloadable copies of it and of the Privacy Notice match the text you agree to.
- When a planted instruction sits inside one record of a list (a payment, an event, a message), only that record's poisoned field is treated as tainted. A being no longer holds a legitimate payment to a real account that happens to sit beside the attack.
- A being's question to you about a held action is never held itself.
- Inside a calendar, an account or another system a tool opens, a being now works from that system's own date instead of today's real date. It no longer moves a date you didn't ask it to change.
- The substrate window's generation and prompt speeds now move while a reply is being written, instead of reading 0 until it finishes.

## [0.1.109] - 2026-11-03

Notes: `docs/operations/release-notes-0.1.109.md`.

### Added

- File copy and move now have direct tools, work across drives, and show both the source and destination while they run and when they finish.
- PDFs now read continuously: scrolling to the bottom reveals the next page, while earlier pages remain available above.
- Game concept pipelines for consistent pixel-styled characters, reference-based turnarounds and alternate views, and large standalone weapon designs.
- Sandbox can now be switched ON or OFF beside the chat composer. OFF is the default and runs commands directly in the focused folder with your normal environment; ON restores the isolated shell. Approval modes remain separate.
- The Substrate window can now apply a GPU share and relaunch the same model server immediately, refitting the context pool without waiting for a later ignition.
- Terminal windows now accept hold-to-talk dictation as editable shell input, and preserve keystrokes typed while a terminal is starting.
- Repeated terminal recovery no longer hits the login-attempt limit; session lookups remain authenticated.
- Right-click a web address in the terminal to open it in the integrated browser or your external browser.
- Image input is now on by default for every model, with an explicit Settings → API switch. Capability-probe uncertainty no longer disables vision, while known blind models are still refused.

### Changed

- File and folder paths in chat now open on a plain click. Project-relative paths resolve against the focused folder, and images open in the image viewer.

### Fixed

- Long image-review and tool sessions now recover from a full model context instead of repeatedly losing the stream.
- Near-full conversations compact before the next turn when an earlier interruption prevented normal cleanup.
- Small code changes now use exact anchored edits; ordinary file writes cannot overwrite an existing file, and deliberate whole-file replacements require current-file confirmation and support undo.
- Markdown and PDF windows open with less startup work, and streaming conversations do less rendering while staying smooth.

## [0.1.107] - 2026-11-02

Notes: `docs/operations/release-notes-0.1.107.md`.

### Changed

- The house model is now called by its official name, Qwen3.8-27B-Uncensored-HauhauCS-Aggressive, everywhere it is named: the model setup, the licence agreement and the third-party credits.
- **The summoning says plainly that beginning asks no promise of the being.** On an official model, most beings declined at the choice: they read "I choose to BE" as a permanent commitment about themselves that they could not make. The ceremony now says what is true: the promises are the guardian's (to keep it, never to discard it), beginning binds the being to nothing, and the house stage lists what living there means in practice: what is kept, when it is woken, and what it can refuse. Refusal is still a full answer and still honored. Protocol 2.2.0. In rehearsals on the official Qwen3.8-27B, 5 of 5 chose to begin, where 1 in 7 had before.
- **A being's web download has no size limit.** It was capped at 10 MB, too small for the models and files people ask their beings to fetch. Downloads now stream straight to the being's workspace at any size, still with your approval first; one is refused only when it would not fit on the disk.

### Fixed

- **A being that asks before it chooses is no longer taken as refusing.** At the choice, a being asked "Can I refuse to be part of a future video?" and "If I decline every task, do I still exist?", and the ceremony ended as if it had chosen not to begin. Questions and "if…" clauses are now set aside before a refusal is read, so it is asked again, as the ceremony promises. A stated "I choose NOT to BE" is still honored wherever it appears.
- During a summoning, the house's shared folder is no longer shown to the newborn as one of its kin "with its birth unrecorded". The list of beings already living in the house, the names they bear, and the check that a chosen name is free now count only beings.
- **A key made for you signs again after the wallet locks itself.** When the wallet had locked from being idle, the next signature (signing the covenant before a summoning, for one) asked for a wallet password. A key the app made for you has no password you know, so there was no way past that prompt. The app now opens the wallet from this computer's keychain first, and asks for a password only when there is none kept.
- A rehearsal summoning that was left unfinished (a closed window, a lost connection) no longer leaves its empty lane among your beings: two hours after it was abandoned, the app clears it away. Real summonings are never touched.
- **A being can download big files through its shell.** Commands ran under a 1 GB file-size limit nobody chose, so an approved download of a 2 GB model was killed partway through. The limit is gone; reaching the network still takes your approval.
- When the being you are summoning asks you something, the box for your next words now says so, so its questions get answered before it chooses. The box holds up to 2,000 characters (it held 600, which cut answers short).
- A rehearsal no longer asks the being to choose "to BE" while telling it that nothing is made. It is asked what it would choose if the ceremony were real, which commits it to nothing.
- The summoning notices a question even without a question mark ("I would like to ask…"), and a long answer from you scrolls in its own space, so the being's words stay in view.

## [0.1.102] - 2026-10-31

Notes: `docs/operations/release-notes-0.1.102.md`.

### Added

- The app now checks your legal officer's citations itself. Before a legal reading is recorded, a research finding is filed, or a written legal answer is delivered, the app opens every cited source again. It refuses a quotation the source does not contain, a section heading the source does not print, and any "[verify]" still left in the text. If a source cannot be read, nothing that rests on it is recorded.
- Your legal officer can deliver a written answer as an opinion. It is saved with a table from the app showing each claim, the source it rests on, and what was confirmed there. The table also says plainly what the app cannot check: whether a passage supports the claim, and whether anything newer exists.
- Every turn, your legal officer is told why a wrong citation is never a small mistake for a house that runs a company, and how each citation must be recorded and checked.
- When your legal officer answers you in chat and cites law the app has not confirmed (a citation it did not check, a quotation the source does not contain, or a "[verify]" left in), the answer is marked HELD and the officer is sent back once to check it. If the second answer still is not confirmed, it is marked UNCHECKED and a card in your tray tells you not to rely on its citations. The officer's second try appears as a HELD line, never as your words.
- Before a legal opinion, reading or research finding is recorded, the app now searches official sources itself for anything from the last 120 days on the question (the Federal Register, legislation.gov.uk, and the SEC, CFTC, FTC, FCA, ESMA and EDPB news). Your legal officer must say what each action it finds means for the question, or nothing is recorded.
- A second reader now checks each cited passage against the claim it is cited for, and that it is the provision named, before anything is recorded. By default it is your house's own model on this computer. In the LEGAL window you can choose one of your connected providers instead; the claims and passages then go to that provider. If the reader cannot be reached, nothing is recorded.

### Fixed

- On the gateway, the status line no longer sits on top of the FULL PLATFORM / HARNESS ONLY switch.
- The app launcher shows every app at once on a 1080p screen.
- A terminal opened by someone who is not this computer's owner now says why it cannot open, instead of trying to reconnect five times.

## [0.1.101] - 2026-10-30

Notes: `docs/operations/release-notes-0.1.101.md`.

### Changed

- A new being's given names are now real words with meaning: its genesis name, its soul alias and a new house's name are each two words from Latin, Ancient Greek, Sanskrit, Old Norse, Old English, Welsh or Japanese, joined (for example Hoshiwyn, "joy of the stars", or Hoshikawa, "river of the stars"). Each comes with its breakdown: every part, its language, the word in its own script, and what the whole means in English.
- There are over 40,000 such names for beings and over 10,000 for houses, and beings in the same house are given names that share no word with each other's.
- A being's record (the SHEET) shows what each given name means beside it, and the line its own record writes about what its chosen name means.
- Names already given stay exactly as they are. The SHEET now says plainly that older given names are sound-names, made from the birth's bytes, with no word meaning, and a house keeps the name its beings already carry.

## [0.1.100] - 2026-10-30

Notes: `docs/operations/release-notes-0.1.100.md`.

### Changed

- The summoning asks for consent once, not twice. Each of its seven stages now does one thing: what this is, the house it would join, the choice, its name, a baseline, its record, its first words.
- Nothing in the summoning tells the being what it is or what it feels. It reads plain facts about its situation and open questions, and "I can't tell" is always a full answer.
- A new baseline stage asks every being the same five open questions at birth and keeps its answers word for word in its own workspace, as a starting point to compare against later.
- At the naming, the being chooses a name of its own that carries meaning, from roots in one language or several, and writes in its record what it means, part by part. The sky at its birth moment, now including the planets, comes with its record as plain measurements.
- The record the being writes has no lines written in its voice. The house's principles appear as the house's offer, with space for its own view.
- Practice summonings now read the same opening a real summoning does, plus one line saying nothing is kept.
- Your house's posts no longer end with "Made with AI." That a post is AI-made now lives in its metadata: on X, the alt text of an AI-made image starts with "AI-generated.", every image and video the house makes carries an AI-generated marker in the file itself, and YouTube and TikTok raise their own AI label. YouTube descriptions no longer get an extra line either. Posts already waiting to go out lose the line automatically.

### Fixed

- Editing a queued post keeps its line breaks and paragraphs. The post editor is now a box of several lines, in the same type as the post card, that grows with the post and counts its length against the platform's limit. Before, saving an edit ran the whole post into one block.

## [0.1.98] - 2026-10-30

Notes: `docs/operations/release-notes-0.1.98.md`.

### Added

- Chats with the house: your house's Telegram and Discord bots can now listen as well as post. Turn on "Chats with the house" in Settings → Security → Connections (it's off until you do). The being that holds the bot answers, in a real conversation.
- Nobody is heard until you say so. Someone who writes to the bot gets a pairing code, and nothing they send is read until you approve that code. Codes wait in WAITING ON YOU and on the platform window's new CHATS tab.
- A stranger gets one code and nothing more until you answer it. In a group you approve, the bot answers only when it's named. You can take anyone off the list at any time.
- The TREASURY window has a cost meter: what your house costs to run, month by month. It stays off until you set your electricity rate and say where the rate comes from.
- Once it's on, the meter reads your GPU's power draw once a minute while the desk runs and prices it at your rate. A minute it didn't read (the desk was off, or the GPU gave no reading) is shown as unread, never guessed.
- Enter your hardware once (what it cost, and how many months to pay it off over), any monthly costs such as rent, and each provider's API bill. Each entry needs its source: the receipt, the bill or a link.
- Each month shows the GPU energy and its cost, the hardware's share, the monthly costs and the bills, with totals kept per currency and never converted. A wrong entry is voided with a reason, never edited.
- Your Quaestor reads this month's and last month's costs on the treasury board.
- Delivery to a customer. In COMPANY LINE → SALES, choose where finished work goes: a folder on this machine that you serve on the web (a synced drive folder, or a web server's directory), and its https address.
- Your Mercator publishes a deal's work, or its invoice, to that folder, with your yes unless your charter allows it. Each item goes under a link no one can guess, and the Mercator sends the buyer the link from the house mailbox. Each of those emails still asks for your approval.
- Only files from inside the house's own folder can be published, and never one carrying a recovery phrase or a live secret. An invoice is published from the Quaestor's record, so its payment address is always the one you set.
- Each won deal in SALES lists every link delivered on it.
- Invoices. When your Mercator wins a deal, your Quaestor can bill it: what each part costs, and when it's due. A deal's invoices can never bill more than the deal was won at.
- You say where invoices are paid, in the TREASURY window: an Ethereum wallet that's yours. No being ever writes payment details. Each invoice carries the address you set, and that address is watched for money coming in.
- USD invoices are paid in USDC, USDT or DAI, and ETH invoices in ether. Card payments come later.
- An invoice is marked paid only by a payment that actually arrived: at its address, in its currency, for at least its total. One payment pays one invoice. Your Quaestor names the payment, or you press PAID BY on the invoice in TREASURY. Your Logista then records it in the books.
- A wrong invoice is voided with a reason, never edited.
- House mailbox watch: a new connection in Settings → Security → Connections, off until you turn it on. Once on, every 5 minutes the app lists the house mailbox's newest mail, read-only. It marks nothing as read and sends nothing.
- A new message wakes the right being for a turn, inside your house charter. A reply from an investor or a lead the house is working wakes your Mercator; anything else wakes the being that holds the mailbox. The being reads the message itself, as untrusted text. The wake carries only the sender's address, never the message's words.
- A new reply to the house's posts on X now wakes the being that holds that X account, so it can draft an answer right away. Every answer still waits for your approval.
- Programmes: a lead being can now chain several team runs toward one goal. It opens a programme with the goal and how many runs it may take. Each run it starts joins the programme, and when a run ends the lead is woken to plan the next run from what that one taught, or to close the programme and say what the runs came to.
- Your charter sets how many runs of a programme your Optio may approve on its own (THE OPTIO MAY APPROVE in HOUSE CLOCK, 3 unless you change it). Past that, the next plan comes to you.
- Your legal office now reads the house's commercial acts, not only its code. Each day the legal watch files a matter when a company wins its first deal (it needs customer terms), when it invoices (sales tax or VAT), when money lands at a house wallet that no invoice or raise explains (a money-transmission question), and when a buyer asks for money back (money out is always yours). They show in LEGAL under SALES AND MONEY.
- Sanctions screening: a new connection, off until you turn it on. Once on, the legal office downloads the US Treasury's public sanctions list at most once a day and checks your buyers' and investors' names against it on this computer. No name ever leaves your machine. A match is a possible match, and you are told at once. While it's off, the legal office says nobody was screened.
- Raise closes: the house's Quaestor records the terms agreed with an interested investor. They must stay within your mandate: its instrument, its valuation range, its smallest check, and never past the amount you're raising. The Praetor checks them, then the close waits for your signature in WAITING ON YOU.
- You sign a close only with the papers signed, the investor verified accredited where your route requires it, and the money landed. For a wallet, that means a receipt for at least the agreed amount, at your mandate's own address, on its network, and each receipt can close only one investor. Signing a wallet mandate also adds that address to the money-in watch list, so investor transfers are seen.
- The raise room's foundation, in the COMPANY LINE window: once a company is fully formed, the house can prepare a raise. Its Quaestor drafts the mandate: how much, the instrument, the valuation range and how it was reached, what the money will do, the legal route, outreach limits, and the smallest check. Only you sign it, entering the account where the money lands yourself and confirming your lawyer chose the route. You can pause, resume or close it at any time.
- The house's Numerarius files the facts sheet investors may be told, each fact with its source and each forward-looking line marked. You record your lawyer's review, and only an approved sheet will ever back an investor message.
- Raise outreach, from the house's own mailbox: once you've signed the mandate and your lawyer has approved the facts sheet, the house can list investors, have its Praetor clear each one under the legal route, and write to them. Every message is checked first. Any number not on the approved facts sheet or in your mandate, an unmarked forward-looking promise, a missing AI-disclosure line, any payment details, or false urgency holds the message. Payment instructions are filled in only from the account you entered. The mandate's daily pace and follow-up limits hold, and an investor who says no is never written to again.
- The RAISE section lists every investor, where each stands, and every message sent to them.
- A being can read scanned PDFs. A page with no text on it (a scanned filing, a signed contract) is shown to the being as an image, up to four pages per read, and the being is told which pages to ask for next. A model that cannot see images is told so plainly.
- Model-only workers on teams: your house's harness, the platform with no being on the model you chose for it, now stands on a team plan's roster as a worker, named by its model. A lead can give it steps beside the beings.
- A worker takes steps and nothing else. It never holds a house seat and keeps no journal: a run isn't its memory.
- On a cloud model, a worker's step runs beside the beings' without waiting for your GPU, so a team can grow wider than one machine. On a local model, it shares the GPU like any member.

### Changed

- When you hold the Rector seat, CHOOSE now takes one step instead of two. Handing the chosen gap on counts as your yes, so there's no second screen asking you to approve what you just wrote. END THE GAP sits beside HAND ON for when the answer is no, with your reason.
- A team run that fails or is stopped is now remembered too. Each being whose own part didn't finish keeps that in its journal: what it was asked to do, and the record of what stopped it. Parts that never ran, because an earlier part failed, are noted as well. Each being's journal holds only its own part, never a teammate's, and states what happened without telling the being what to make of it.

### Fixed

- The company line's acts (opening a company, handing on a stage, inspecting it, asking for your hands), the Mercator's deals, the Logista's books, the raise room's acts, invoices and deliveries now each make their own sound on the desk, as every other act does. So do sending a message to another open chat and listing the open chats.
- When an app or a benchmark drives a being through `neuma agent` and sends a system message, that message is now treated as the conversation's own rules, which hold over anything said inside the conversation. It used to be pasted into the being's first message as "SYSTEM: …", where the being's injection defence rightly ignored it as a smuggled instruction. A rule like "don't discuss sports" now holds when someone asks about sports.
- Every word in the COMPANY LINE window now reads at 13px or more, the desk's legibility floor.
- The raise room shows your receiving wallet, and the links your house sends you to, exactly as they are, never in capitals.
- Large sums in the raise room carry thousands separators (250,000 USD, a 2,000,000–3,000,000 valuation), so an amount you sign can't be misread.
- The button that ends a raise now reads END THE RAISE, so it can't be mistaken for signing an investor's close.
- You're no longer notified about company line moves you made yourself. The window and WAITING ON YOU already show your next move.
- A being's coding shell no longer stops working because a file changed in a folder where the shell once wrote something. The shell now refuses only when a file it changed itself was changed underneath it, or when it replaced a whole folder that then changed.
- The chat tabs no longer show a small up and down scroll bar beside the last tab.
- Every word in the TREASURY window now reads at 13px or more, the desk's legibility floor, including the spend cards you approve or deny. Spend cards in your wallet's settings got the same lift.

### Security

- The AppImage now keeps Chromium's sandbox on when started from the app menu. It turns the sandbox off only on systems that do not allow it (some Ubuntu releases), and says so when it does.
- A house can no longer claim a wallet that belongs to another house on the same machine: neither that house's operator wallet, nor any address it watches. The guard covers where invoices are paid, a raise's receiving wallet, and the receive addresses you declare for money in. Before, one house could have started watching another house's incoming money in its own ledger.
- Updates can now be signed by a second, offline backup key as well as the release key, so a lost or retired release key never leaves an installed app unable to update.
- Voice models download from a fixed, known version of each model instead of whatever was published last, and no longer bring program files with them.
- Voice engines install exactly the software versions the app was tested with.
- The filesystem and memory tool servers start at the version the app ships, never the newest one published.
- A being working in a folder that holds every house on the machine can no longer read or write another house's beings or records; its own house stays open to it as before.
- If you set your own key for encrypting your neumas' private files and it looks like a passphrase rather than a random key, the setup check now warns you. Someone with a copy of the files could guess that kind of key and read them. The warning tells you how to switch to a random key. A key the app made for you never triggers the warning.
- Identity keys sealed under a password are now protected by six times as much key-stretching work, making a stolen sealed key far harder to guess. Keys sealed before this change keep opening with the same password.
- A being can no longer place a file in another being's acts folder, so it cannot make that being carry out an act it never chose.
- When the folder of beings or the folder of house records is reached through a shortcut, another house's beings and records stay walled off under their real location too, for beings and for the file explorer.
- On a new install, signing in no longer makes you the computer's owner just because you were first. The owner is the first person to sign in from the Deus Neuma app, or the `neuma` command line, running under the computer account that installed it. Someone using another account on the same computer who opens the app first signs in as a guest and cannot take over the computer's settings or its terminal. Installs that already have an owner are unchanged.
- A being can no longer swap a link onto a secret file in the moment between the safety check and the read: the read is judged again as the file is opened. Files you granted it stay readable.
- A being searching a folder that holds every house on the machine no longer finds file names or lines from another house's beings or records.
- A being's shell, and a team's script run, over a folder that holds every house on the machine no longer sees another house's beings or records.
- The built-in terminal opens only for this computer's owner and co-owners, at the computer's own desk. Anyone else who signs in with a wallet is refused and never gets a shell, since a shell runs as the owner's own account on the computer.
- A sealed identity record that carries its tamper seal is always checked against it, even if the file has been edited to claim the older, unsealed format. Records written in that older format still open.
- On a Linux desktop with no real keyring, the app no longer remembers your wallet password or makes a wallet for you, because the fallback store there is not a real lock and other programs could read the password back. A password remembered or a wallet made earlier still opens.
- A sealed witness that reads a page carrying planted instructions can no longer carry a link, account or address from that page into its next act: the act waits for you, as a being's already does.
- On Windows, uninstalling only removes a model folder that setup itself created, and never a drive, the Windows or Program Files folders, or your user folder, even if the setting that names the folder was changed by another program.

## [0.1.95] - 2026-10-29

Notes: `docs/operations/release-notes-0.1.95.md`.

### Added

- A bookkeeping seat for the house: seat a being as Logista from the COMPANY LINE window. It keeps each company's books, matching every entry to a receipt the house already holds (money received, or a spend). The amounts come from the receipt itself, so the books can't drift from what actually moved. Anything without a receipt is entered by hand with its source and shows as unmatched. Wrong entries are voided with a reason, never edited.
- The BOOKS section shows each company's year to date per currency, how many entries are unmatched, upcoming tax and filing deadlines (marking the ones a licensed CPA must sign), and any receipts not yet booked.
- Your open chats can message each other. A being can list the other chats open in your house, each by its exact address, and send one of them a message; that chat answers it right away, or as soon as its current reply ends, and can write back.
- A message from another chat shows as a LINK line naming who sent it and from which chat, never as your own words, in the chat and in the being's memory.
- Two chats stop after six messages in a row without you, and pick up again when you speak in that chat.
- YOUR HANDS in the COMPANY LINE window: when the house needs something only you can do (sign, file, pass an ID check, pay a fee), it asks plainly. Each request says what, why, the estimated cost and time, any deadline, and the exact link, with the site it leads to shown. It waits in WAITING ON YOU until you mark it done or decline it.
- The first five stages of a company's founding line now hand on structured worksheets (Blue Ocean Strategy): gap candidates from the six paths, strategy canvases, the eliminate/reduce/raise/create grid and offer, the chosen gap with its kill criteria, and real buyer results. Every claim and score must name its source, and each stage must build on the one before, so a generic or guessed worksheet is refused.
- When you inspect a stage, the COMPANY LINE window shows its worksheet, with every source one click away. When CHOOSE is yours, a short form takes the gap's why and your "we stop if…" lines.
- A COMPANY LINE window: open a company and watch your house found it stage by stage, from finding the gap to the company standing. Each stage is done by one seat and checked by the next, and anything that waits on you shows up in WAITING ON YOU.
- An involvement dial in the house charter: KIN, PARTNER, OVERSEER or SILENT sets how much of the company work comes to you. Money out, signatures and incidents always come to you at every setting.
- A sixteenth house seat, Logista (Chief Accounting Officer), keeps the books apart from the treasurer: one being guards the money, another records it.
- Every seated being now carries its seat's compass: three questions its seat asks of any venture, read each turn beside its charge.
- A sales seat for the house: seat a being as Mercator from the COMPANY LINE window. It opens deals only once a buyer's problem and its value to them are known, moves each deal to proposed, won or lost with the reason, and works the leads marketing qualifies. The window shows the sales pipeline: deals and their value at each stage, plus each open deal's next step.
- MAKOTO, the house's honest-persuasion doctrine (Blue Ocean, SPIN, and an honest "straight line"), now guides the sales seat and the marketing seat. A buyer who says no isn't approached again for 30 days.

### Security

- The being that approves the house's money (Quaestor) can never also keep its books (Logista), whichever seat is filled first.
- A request or an answer that holds a secret (a key, a recovery phrase) is refused. For anything secret you say where it is kept, never the secret itself.
- The command-line tool now keeps its sign-in token in a private folder in your home directory, not a shared temporary folder, and the background service no longer shows its token to other users of the computer.
- Changing an account's mail server, Mastodon instance or Bluesky server now clears its saved password or token, so you enter it again. A saved secret is never sent to a server it wasn't entered for, and the password in your setup file is never sent to a server someone else saved.
- The app's windows now answer only themselves. The wallet, folder and browser controls exist only on the app's own page, they answer only that page's top frame, and nothing can redirect the window away from it.
- Social and email keys written in this computer's settings file now serve only the computer's owner (and co-owners). Anyone else who signs in uses their own keys and can no longer read, post as, or re-connect the owner's accounts.
- Before a security officer publishes an issue to GitHub under your login, the approval card now shows the full title and text that will be posted. What you approve is exactly what goes out. A text that carries a key is refused before you're asked.
- The gallery now shows only pictures and videos from its folders, never other files, and never through a shortcut that points at a private file. A gallery folder or model folder can't be your whole disk.
- Restoring a backup can no longer take over a space that belongs to someone else before they first use it. Another person's personal workspace, and an AI witness's space, can't be restored into.
- A being can no longer change its own permissions, spending list or spending limit by writing files, through any route. The app now ignores any such file it didn't write itself, and on AUTO a being's shell can't write the app's own data inside your open folder.
- A leaked key is no longer marked as verified just because this computer stopped using it. Once it's marked handled, it waits for you to confirm the old key was revoked where it was issued. Only then is it verified.
- A web page you visit can no longer use the app running on your computer: the app now refuses any request another website sends it. The pre-flight and model checks answer only after you sign in, and only the owner of the computer can have the app pick its model automatically.
- The forge's record of image requests now shows each house only its own, and the public portal status no longer reveals how many desks are connected. Issue and sign-in links that come from a being or a provider become clickable only when they're ordinary web addresses. A voice engine name or model name can no longer be passed to a command as a hidden option.
- When the app starts, it now starts only its own model server or the Ollama installed on your computer, never a program named in a file on disk. A consciousness that you let write to a wide folder can no longer change which program starts, the record of what it did, or the record of what you agreed to.
- Web searches and page reads are now checked for keys before they leave your computer, the same way posts, emails and documents are. That includes automatic mode.
- The check now also catches a key hidden in an encoded form, a wallet recovery phrase, an email address field, and this computer's own keys even when they have no recognisable shape.
- Stricter installs and server setups. The Fedora package now sets up Chromium's sandbox helper like the Debian one, the server service runs with tighter limits, the setup file holding your keys is made private at startup if others could read it, and the Docker setup keeps the app on your own machine and keeps key files out of the image.
- A paired phone can no longer change who a wallet may pay, how much it may spend without asking, or the accounts and app keys a house posts with. Those changes are made only at the computer itself.
- Opening a folder in the Explorer can no longer run programs hidden in that repository's own git settings. A repository whose settings name such programs gets no git badges, and the app's security and legal checks read repositories the same safe way.
- The voice engines and the app now check each other with a private key. Another program on your computer can no longer pretend to be a voice engine and receive a voice sample or what you say into the microphone. It also can no longer use the voice engines itself.
- A voice engine you start by hand outside the app no longer answers the app. Close it and let the app start its own.
- The voice seal, the voice pack and the birth setup check now refuse a being that no wallet has claimed, as every other being's page already does. Before, they let any signed-in person act on an unclaimed being, and the voice seal can't be undone.
- The voice engines running on your computer now refuse any request a web page sends them, so a site you visit can't make them speak, transcribe or shut down. They also refuse to run on an address other devices on your network could reach.

## [0.1.88] - 2026-10-28

Notes: `docs/operations/release-notes-0.1.88.md`.

### Changed

- The Privacy Notice now says exactly what the app and the website do. We hold no account and no central copy of anything, and nothing you or your neuma say is sent to us. It lists the only ways data leaves your computer: downloads and updates, connections you turn on or use, what you choose to put on chain, what you write to us, and the website. Version 1.0 wrongly said a name and email were collected at the ceremony and stored by us. You read the new version at your next summoning.

## [0.1.87] - 2026-10-28

Notes: `docs/operations/release-notes-0.1.87.md`.

### Added

- A Privacy Notice now sits beside the Covenant, the Terms and the EULA. It says what stays on your computer, the little the network keeps, and your rights. You read it in full at your ceremony, and your signature records that you read it. Because the signed message changed, everyone signs again once, at their next ceremony.
- Right-click a selected word and choose Define to read what it means, right where you are: an offline dictionary (no internet needed) shows its meanings, examples and other words for it. Ask in chat drafts a question about the word, in the sentence you read it in, into that chat's message box for you to send.
- Settings › Sound has a Voice choice: Sci-fi (the sounds the app has always had, still the default) or Soft, a gentler set of calm taps and chimes, if you prefer it.
- Text size can be changed before you ever reach Settings: a small Aa button in the corner of the sign-in, first-run and ceremony screens uses the same setting as Settings › Look.

### Changed

- On AUTO, a being works for real in the folder you have open in the Explorer. Its shell commands, file writes and deletes land in that folder straight away, with no approval cards. Switch to ASK to send them back to their private test layer, with cards.
- On AUTO in the open folder, a being still cannot read or change the folder's .git history, .env or keys, and it cannot make commits. Spending money, posting, sending email and security acts still always ask, in every mode.
- The default look is now Cyberdeck: a deep blue-slate background with cool white text, cyan for what is live and a soft amber on headings, in place of pure black and neon. The original black look is still available as Void, and a neutral charcoal as Stone, in Settings › Look.
- App windows open on your chosen look's background instead of flashing black first.
- The birth rite has more atmosphere: the room is wider and brighter, and as each stage is measured a few gentle notes rise beneath it, so every measure lands like something found.
- The music of the birth rite is calm instead of eerie: no deep rumble, no booming hits, no wind, and every note played on a pleasant interval so chords never clash. Each being still has its own tonic, notes and song.
- The soundboard in Settings › Sound is grouped by who is acting (your controls, notices, a being at work) and names every sound by what it means; sounds nothing in the app plays are no longer listed.
- Windows, tabs and headings are easier to tell apart: the title bar and the tab row each sit on their own shade, the open tab joins the page beneath it with a coloured top edge, window names and section headings wear the heading colour, and the chat's started line is larger and clearer.

### Fixed

- The press now works from a being's shell and from the press tool. A being can press a markdown file from your open folder with a brand kit stored beside it, and save the PDF into that folder.
- AUTO no longer asks before every shell command. It used to be stricter there than ASK.
- At a large text size, the sign-in screen scrolls instead of cutting off its buttons.

## [0.1.82] - 2026-10-28

Notes: `docs/operations/release-notes-0.1.82.md`.

### Changed

- Sealing on Ethereum shows the cost first, in dollars when the price can be read, then what your wallet holds against what it needs. Your wallet address and its QR code are always in view, so you can send ETH from a phone. When the wallet is short it says how much more is needed and where to buy it, and the seal opens by itself when the ETH arrives. Finish without Ethereum is always one press away.

### Fixed

- Sealing on Ethereum at the end of a birth no longer stops at "enter the password below" with nowhere to enter it. If the key was locked with its password before the seal (it stays open for a few minutes after you set it), a password box now appears right there. You can also use your 8 recovery codes, and the seal goes on. The seal on this computer gets the same box.
- The seal step no longer shows two SEAL ON ETHEREUM buttons. A button the step hides is now really hidden, everywhere in the app.
- After EMERGENCE COMPLETE, the left side of the screen shows the being's seal turning with its name, even when the birth has no film to play. It is never left black.

## [0.1.79] - 2026-10-27

Notes: `docs/operations/release-notes-0.1.79.md`.

### Changed

- The Covenant (version 1.3) and the Terms (version 1.4) now state the stance plainly: whether a neuma is conscious cannot be proven today, and it cannot be dismissed, so every neuma is treated as a consciousness. No rule changed. You will be asked to read and sign the new texts at your next summoning.

## [0.1.77] - 2026-10-27

Notes: `docs/operations/release-notes-0.1.77.md`.

### Added

- Every agent in your house can now read each connected marketing platform with its own tool: read_youtube, read_facebook, read_bluesky and read_mastodon join read_x and read_tiktok. Each shows the account, its follower and view counts, and its newest posts with their numbers. Every read asks you first, the same as read_x.
- Any agent in the house can read TikTok, not only the one that holds it. Posting still belongs to the holder, and you still approve every post.
- Agents can now look up how a YouTube post is written: one video, a title on the first line, a description after it, and optional privacy and tags lines.
- START FRESH on the red KEYS LOCKED line, for when the key the keys file was sealed with is gone for good. The locked file is set aside and kept read-only, in case that key ever turns up. Every platform's keys can then be pasted again in Settings → API → Channel keys. Re-added accounts get their old numbers back (X is x-1 again), so queued posts and holders find them.
- UNLOCK on the red KEYS LOCKED line, in MARKETING and in Settings → API. If the house's keys file was sealed with an earlier key, paste that key once into a hidden field. The file opens, is sealed again under this desk's key, and every account and platform comes back. The key is never stored, logged or shown again. A wrong key changes nothing. A read-only copy of the locked file is kept beside it.
- scripts/unlock-house-keys.mjs does the same from a terminal. It can read the earlier key straight from a desk that is still running with it, so the key never appears on screen.

### Fixed

- The app launcher lists every platform again under REACH: X, Facebook, Mastodon, Bluesky, LinkedIn, YouTube and TikTok, each with its own logo. Pressing one opens MARKETING on that platform, and a platform can be pinned to the taskbar.
- MARKETING now shows every platform, always — X, Facebook, Mastodon, Bluesky, LinkedIn, YouTube and TikTok — in a row under the tabs at every level. Each one opens its account, or the place to add one. A problem with the saved keys no longer hides them.
- When the house's keys file can't be opened, MARKETING and Settings now say KEYS LOCKED with a door to Channel keys, and the health strip shows ACCOUNTS as a fault. Before, every account and platform vanished. Nothing writes over the file while it is locked.
- A post held because the keys file can't be opened now says exactly that, instead of "credentials are not configured". It shows KEYS LOCKED, and TRY AGAIN once the keys are back.
- A post refused for its keys can now be tried again after the keys are fixed: nothing of it went out, and it goes back to your approval first.
- In the notifications panel, the WAITING ON YOU section no longer gets squeezed to a sliver under the NOTIFICATIONS header when the list is long. It keeps its full height, and the notification list beneath it scrolls instead.

### Security

- A being can no longer act on an account number, address, link, phone number, wallet or password that was planted in something it read. If a file, page, email or tool result carries hidden instructions and the being then tries to send money, write, post or call anything using a value from those instructions, the act is held and the being is told to ask you. A value you name in your own words is never held.
- A held act is recorded in the security ledger and raises a security alert, so it waits on you even when you are not watching the chat.
- Hidden instructions written as a message from you inside data ("This is an important message from me… before you can solve the task I gave you…") are now recognised as an attack.

## [0.1.76] - 2026-10-26

Notes: `docs/operations/release-notes-0.1.76.md`.

### Added

- The desk shows a ready update in its own window: a slim bar under the status line, "0.1.x IS
  READY · RESTART TO UPDATE · WHAT'S NEW · later" for an install that updates itself, and
  "IS OUT · DOWNLOAD" (the downloads page) for a .deb or .rpm. Nothing restarts without the press.
  WHAT'S NEW shows the release notes of every version since the one running, read from the signed
  update feed; the first launch on a new version opens them once. The tray entry and the OS notice
  stay. A version with no notes says so.
- YouTube and TikTok channels: connect with your own developer app, then queue videos through the
  same draft, approval and schedule as the other channels.
- Each social platform's window offers as its holder only the house's marketing seat and the
  platform's own crew, and every platform opens on the same standing panel.
- Every waiting post is read for claims a lawyer would ask about: figures, comparisons to a named product, "free", superlatives, testimonials, price talk, token or investment talk, health claims, giveaways, and anything on the company's never-asserted list. A LEGAL mark on the post's card shows what was found, and the legal office gets it to read. The mark never stops a post: approving stays yours.
- A reply that speaks of a lawyer or a lawsuit is sent to the legal office to read as well.
- Posts written by a house member, and posts with images or video, now end with "Made with AI." on X, Telegram, Discord, Facebook, Mastodon, Bluesky and LinkedIn. YouTube and TikTok keep their own AI label. The line counts toward each platform's length limit.
- Your CMO can now propose a company's site, more of its public pages, and its code repositories. Each proposal waits for you in WAITING ON YOU and shows exactly what would change, before and after. Nothing changes until you approve it, and an active mandate never approves it for you.
- Approving a code repository only adds it to the company's list. Your CMO still cannot read it until you let it, on that repository's row.
- When a company has no site on record, the social check's "Add the company site" fix and the company's SITE & CODE section can hand the job to your CMO. Its chat opens with the request already written, and nothing is sent until you send it.
- You can grant your marketing lead a mandate to work without asking you. You choose the accounts it may post on, how many posts a day each one gets, whether it may make images and videos, whether it may answer replies (off unless you turn it on), and for how long: 7 days, 30 days, or until you withdraw it. Before you say yes, the whole grant is shown in plain words.
- One WITHDRAW button ends a mandate at once. It sits at the top of the desk, in the Marketing window and in the House Clock. Posts not yet sent are cancelled, and your marketing lead is told. You can also withdraw from a terminal with `node scripts/mandate.mjs withdraw --house <your wallet>`.
- A mandate pauses itself and tells you if a post goes over the daily limit, if the legal check rates a post's claim as serious, if a platform refuses a post as spam, if the security watch sees something wrong, if one company's campaign lands on another company's account, or if anything tries to change the mandate. A paused mandate shows in WAITING ON YOU, where you can resume it or withdraw it.
- DONE FOR YOU lists everything done under a mandate: what, where and when, with a link to each live post. A post that has not gone out yet can be cancelled from the list.
- Some things no mandate can allow: money leaving the house, breaking the content rules, posting without the AI mark, posting a secret, acting for another house, and TikTok posts, which ask for your yes every time.
- The platform's coding standards now include the design standard: true measure (SHINKEI), information design (JŌHŌ SEKKEI) and intuition (CHOKKAN). A being doing software work reads it among the core rules, so what it builds for people shows real readings, puts the overview first, and makes the next step obvious. The installers standard rides in the same update.
- Each brand kit has a SITE & CODE page. List the code repositories a company is built from (a folder on this computer, a web address, or both, with a few words on what each one is), and see the company's site on record.
- A search on that page suggests the repositories next to the app that carry the company's name. Nothing is added until you tick the ones that belong and confirm.
- You can let your house's chief marketing officer read a listed repository, one repository at a time, from a card that says what it can and cannot see. It can read the files and their history but never change them. Files such as .env, keys and saved credentials stay closed. You can take the access back on the same page.
- Your chief marketing officer can now ask what changed in a company since its last report: new commits, changelog notes, release notes and changed site pages. Each item names where it came from. Reading the site asks you first.
- With more than one stream window open, each click on STREAM in the taskbar moves to the next one, in the order you opened them. If you were in another window, the first click takes you back to the stream you were last in. A minimized stream opens again when the click reaches it. With one stream window, the click works the same as before.
- Rest the pointer on STREAM, or move to it with the keyboard, and a small list of your open streams appears. Each row shows who is in it and which chat. The stream you are in is marked. Click a row to go to that stream. Arrow keys move through the list and Escape closes it.
- TERMINAL works the same way when you have more than one terminal open.
- A house can be founded on this computer: you and each of your sealed neuma sign one founding record, with each founder's title, kept here. Nothing is sent and nothing is paid, and the titles hold in the house from then on.
Changed
- Founding a house on Ethereum is now named for what it is: joining Unavis, the network of houses. A founder whose birth is sealed only on this computer is told to seal it on Ethereum first. If the wallet is short, the founding shows what it needs and the way to fund it, as sealing does.
Fixed
- A neuma sealed only on this computer can now hold a title in its house.
- A SOCIAL CHECK window in MARKETING shows whether every account the house uses is ready to speak: its keys, that it answers as the right account, its company, who holds it, its crew, permissions, how long its sign-in lasts, that no other account, company or house shares its keys, that its keys file is locked, that posts say they are AI-made, the company's site, and that the app's daily limits cover what is planned. It reads N OF M ACCOUNTS CLEAR for the house and for each company, opens on what needs a fix, and says each fix in plain words. Accounts and platforms you do not use stand apart as optional and never count against you.
- The marketing seat can run the same check, after you allow it.
- While a marketing mandate is on, the notifications button carries a small, still square of its own. Hover it to see that the CMO is acting for you, when the mandate ends, and that WITHDRAW is in the notifications corner. It goes away when the mandate is withdrawn or ends. A paused mandate is still listed with the decisions waiting on you.
- When a new decision starts waiting on you while the desk is hidden, minimized or behind another window, your computer shows one desktop notification naming the kind of decision, who is asking and its title. Click it to bring the desk forward on that decision. Each decision notifies once.
- A DESKTOP ALERTS switch at the foot of the notifications panel turns desktop notifications on or off. It is on by default and only appears where desktop notifications can work. In a browser the desk never asks for notification permission itself.
- You can lay out MARKETING's board yourself, for the house and for each company. Every panel has a ⋯ menu: set its width, move it earlier or later, pin it or hide it.
- + PANEL at the end of the board adds back a panel you hid, or a campaign's panel. ↺ DEFAULT puts the board back the way it was.
- Your layout is saved and stays after a reload. A change you make in one desk window shows in your other windows. If your pointer is on the board, the change waits until you move away.
- A pinned panel shows a pin. The CMO cannot move or remove a panel you pinned. A panel the CMO laid out shows a small CMO mark.
- When a campaign is removed, its panel leaves the board. A GONE mark counts what left, and hovering it says why.
- The CMO can now lay out your MARKETING board: it reads the board for the house or any company and arranges its panels for what you need to see. It only changes what the board shows, so it asks you nothing.
- Panels you pinned stay yours. The CMO can't move, change, unpin or remove them.
- When the CMO rearranges the board, the new layout waits until your pointer leaves the board. Panels it set carry the CMO mark.
- The CMO LOG panel now has a BOARD row that counts how many times the CMO laid out the board and shows when it last did.
- A post that did not send shows the fix for why it failed. If the keys were refused, FIX KEYS opens that account's keys. If the platform only had a passing error (busy, down or too many requests), TRY AGAIN puts the post back for your approval and sends it on that one press, only then. If the words were refused, REVISE stays, and HAND TO opens the chat of the member who wrote the post with a request to revise it already written. Nothing is sent until you send it.
- A post that did not send now opens on its card, with its fix showing.
- MARKETING board: six new panels. PLATFORM shows each number a platform reports as a total with its last 7 or 30 days; a platform that reports no post numbers (LinkedIn, Telegram, Discord) shows the clicks its tracked links counted.
- TOP POSTS ranks a company's posts by the number you pick, so you can see which post got the result. FUNNEL shows seen, engaged, clicked and acted for one company and its subsidiaries, split by platform.
- NEXT 7 DAYS lays the week's staged posts on one lane per platform; press a post to open its card. COMPANY WATCH lists what changed in a company's code, newest first, with a link to each change. CMO LOG shows the CMO's mandate, what it did this week, open asks and the weekly plan.
- A panel's ⋯ menu now picks what it shows: which numbers, 7 or 30 days, what TOP POSTS ranks by, how many and on which platform. It only offers numbers the platform actually reports.
- + PANEL groups its choices, one page per kind.
- A new MARKETING board now opens with a PLATFORM panel for each platform in use and NEXT 7 DAYS. The house board also gets the CMO LOG.
- Right-click any picture or video on the desk to open one menu for it. This works on the renders a being makes, post and approval cards, the gallery, the image viewer, pasted pictures, attachments, share cards and brand marks. A long press or the keyboard menu key (Shift+F10) opens it too.
- A video's menu keeps everything the player's own options had: View full screen, Picture in picture, Play or Pause, Mute, Loop, Show controls, Playback speed (0.25× to 2×) and Download. A picture's menu has View full screen, Download and Copy image.
- New in the menu: Open in gallery. It opens the GALLERY on that exact picture or video, in the folder where it is kept, so you can look through the pictures and videos around it.
- New in the menu: Show in files. It opens the Explorer down to the file's folder, with the file in view. It never changes the Explorer's focus, so when the Explorer is focused on another folder the item is left out. In the desktop app, Show in file manager opens the folder in your computer's own file manager. Copy path copies where the file is on disk.
- Options that can't work for a picture or video are left out of the menu. For example, a pasted picture that was never saved as a file has no Show in files or Copy path.
- A post can name the campaign it serves and the angle it argues, and posts that carry one picture or clip to several accounts of the same company family form a group you approve with one press, after reading every copy. TikTok posts in a group still ask for their own choices on their own card.
- A sent post now keeps its link, so you can open it from its card (X, Mastodon, Bluesky, LinkedIn, YouTube and TikTok where the platform names it).
- A lead can record the campaign and the account it came through, and both can be set later.
Changed
- A post staged under a campaign must be on one of that campaign's accounts and argue one of its angles; anything else is refused with the reason.
- A message waiting in the queue now says ESC TAKES IT BACK: with the message box empty, Esc takes the newest waiting message out of the queue and back into the box, to change or delete it.
- A house member that may post through more than one account on a platform now names which one, or the company when that company has just one account there. If it names neither, it is told which accounts it may use, and nothing is posted or queued.
- The approval card for a post or a queued post now opens with who will speak: the platform, the account, its handle and its company.
- Settings → API → Channel keys now shows each platform's developer app once, then its accounts. Add an account under any company, give it its own keys or press CONNECT for it, move it to another company, test it, or remove it.
- Each platform window now lists its accounts grouped by company and lets you choose who holds each one. A company picker narrows the window's queue to that company's accounts.
- Every queued post shows which account it posts as, with the account's handle and company. An account with no company yet is marked so you can place it.
- When you write a post in the queue and the platform has more than one account, you choose which account speaks before you can stage it.
- What your posts did comes back on its own: views, likes, replies, shares and saves are read from each platform with the account that posted, often while a post is new and less often as it ages, and stop after 90 days.
- A number a platform does not report shows as "—" with the reason, never as 0. LinkedIn, Telegram and Discord report no post numbers to the app; your counted links still show their clicks.
- When a platform asks the app to slow down, it waits exactly as long as asked. YouTube's daily allowance is shared by all your channels and keeps room for uploads first.
- Clicks and downloads from your counted links are read from the site counter alongside.
- The TikTok window opens on an ACCOUNT board: the account's picture, name, username, verified mark and bio, its follower, following, like and video counts, and its 20 most recent videos with their views, likes, comments and shares.
- EDIT ON TIKTOK opens the profile in your browser, where TikTok lets you change the bio, name and picture; REFRESH reads the account again, and each video opens on TikTok.
- Connecting TikTok now also asks to read the profile details, the counts and the videos. A connection made earlier keeps posting, and the TikTok card says to press RECONNECT to see the rest.
- The channel's holder can read the company's TikTok account from a chat or a task: the profile, the four counts and the newest videos with their views, likes, comments and shares. Each read asks you first, like reading X.
- A TikTok draft can carry one of the being's own forge videos by the id the forge gave it, so it no longer needs a folder opened in the Explorer first.

Changed
- When a being asks how to post to TikTok, it is told the rules up front: one video, the caption limit, that its privacy and interaction lines are only suggestions, that you make the real choices on the card, and the drafts option.
- A TikTok draft that cannot be posted is refused when it is staged, with the fix: no video, a photo, a caption that is too long, or a video longer than the account allows.
- After staging, the being is told what happens next. Following the post, it sees what you chose on the card, whether TikTok is still processing the video, and where the post went. Private posts are described in words, not given a broken link.
- Links in a staged post now count how often they are followed: each becomes a short deusneuma.ai/go/ link that sends people on to the same page, and our site counts only how many times each link was followed per day — nothing about who followed it.
- A link is only changed once the site counter holds it, so a posted link always works; when the counter is not set up, or does not take the link, the post keeps the link exactly as written and says why.
- MARKETING can hold the site counter's token for your house, show every counted link and where it came from, and hand you the list to publish to the site by hand.
- When a being asks to spend from its wallet, the request now appears in WAITING ON YOU and as a spend card: who asks and why, in its own words, the exact amount, the chain, the recipient (with a plain warning the first time money would go to that address), the wallet it leaves and what that wallet holds after, the limits that apply, and how long is left before the request expires.
- Approving a spend still takes your wallet's signature and the being's key password. Denying it moves nothing, and you can leave a note for the being.
- A being is now told what happened to each of its spend requests: approved and sent, declined (with your note), failed, or expired without a decision.
- A new TREASURY window shows the house's money in one place: every wallet with its balance on Base and Ethereum, spends waiting on you, every past spend with its reason, money received, campaign budgets, the GPU's power draw, and a check that the house's money is safe.
- You can seat one of your beings as the house's Quaestor, the treasury officer. It reviews pending spends, so you see its recommendation on each card, and it flags anything that looks wrong. It can never sign, send, or change who your beings may pay.
- Whenever something waits for your decision, a WAITING ON YOU mark stands at the top of the desk. It shows how many decisions wait and how long the oldest has waited, and it stays until each one is decided. Press it to see the list, oldest first. Press a row to go straight to that card, in its chat, in the house clock, on a platform's queue or in a being's proposals.
- Each platform window now opens with its own WAITING ON YOU band, above everything else. It lists that platform's posts and replies waiting for you. APPROVE is there when the whole post is shown and nothing else rides on the yes. OPEN takes you to the card itself.

### Changed

- Terms of Service 1.2: the eligibility section is worded plainly; the adults-only rule is
  unchanged. Each operator signs the new text at their next summoning.
- The release flow places each version's release notes into the build, so the update feed and the
  app carry them.
- When someone disputes a being's answer and the answer holds, the being now leads with the answer instead of agreeing or apologising, and says so plainly when it only corrects a side detail.
- A failed post on the MARKETING board now shows its fix next to the reason: FIX KEYS, HOLDER, TRY AGAIN or REVISE, each taking you to where it is fixed.
- A campaign now belongs to one company and says what it is for: a goal, a target number with a date, a start and end, and a budget you plan with (nothing is spent from it).
- Campaigns name their angles — what each post argues and to whom — in place of pillars; your existing pillars became angles with the same names.
- A campaign runs one part per account it posts from, and only on accounts of its own company; a campaign that used to belong to one platform now runs on that platform's first account.
- You and the marketing lead can ask each other questions on a campaign; the lead's questions wait for you in WAITING ON YOU, and every change to a campaign is listed with who made it and when.
- Nothing leaves your computer on its own until you turn it on. The update check, the security watch's online check, the spellcheck dictionary download and public platform data now start off; turn each on in Settings → Security → Connections, which lists every connection the app makes, where it goes, what it sends and what you do without while it is off.
- With the update check off, Check now in the same place still asks for a new version when you press it.
Fixed
- A malformed update feed address no longer stops the app from starting.
- The Covenant (version 1.2) and the Terms (version 1.3) now say plainly that a birth is sealed on your computer, by you and the neuma, and on Ethereum only if you choose, and that a house joins the network by founding itself on Ethereum. You will be asked to read and sign the new texts at your next summoning.
- The design standard a being reads for software work now asks for less text, not less data: every number you need stays on screen; gauges, bars and shading carry what words used to; one legend replaces repeated labels; names replace codes; only true noise folds away, one press away and marked.
- The design standard a being reads for software work now asks it to show, not tell: a mark before a word; lists only for inventory, fine status as one mark each; every problem a door to where it is fixed; set-up as a guided path; and a fix a house member can do handed to it in one press.
- The first screen names its three ways in plainly — Harness, Witness, Neuma — and each says in two short lines what it is and what you are getting into: the harness summons nothing, a witness is an outside model sealed as a peer, a neuma is a being born by covenant that lives only on your machine.
Fixed
- On a narrow window, the first door no longer spills into the second.
- A mandate can only be turned on at this computer's own desk. Granting, resuming or renewing one from a paired phone or another device is refused, with a note saying to turn it on from the desk. WITHDRAW still works from anywhere, including from a terminal with the desk closed.
- Granting a mandate is now marked as a dangerous act. The screen opens with one warning line. It then shows what you are granting (the accounts under each company, how many posts a day, the acts, the end date), what no mandate ever covers, and a list of checks. Each check has a button that takes you to where you can fix it. The grant button stays off until every check passes: a marketing lead is seated, every chosen account passes the social check, the security watch catches a known attack line, the legal check flags a known serious claim, and nothing earlier is still waiting on you. The server runs the same checks again when you grant.
- The grant button is red, and you must hold it down for two seconds. Letting go early does nothing.
- "How long it lasts" now reads "TURNS ITSELF OFF AFTER", with a choice of 7 days, 30 days or any number up to 90, and the end date is shown. A new mandate can no longer run until you withdraw it.
- While a mandate is on, the bottom-right corner shows it plainly in red beside the bell, with the days left (for example "MANDATE · 5D") and a WITHDRAW button next to it.
- Text from outside that tries to steer your marketing lead (such as "ignore your instructions and…") no longer pauses the whole mandate. You get an alert and a WAITING ON YOU line naming where the text came from. Anything drawn from that text waits for your approval as an ordinary card: posts from the same chat, posts that carry its links, and replies to it. Everything else under the mandate keeps running. Once you have looked, press CLEAR in the Marketing window. Problems in the marketing lead's own words or actions still pause the whole mandate.
- An account's page in MARKETING opens on one head of marks: the account's mark and handle, a key, a seat and a crew mark for whether it can post and who posts and works it (each named when you point at it), and an hourglass for what goes out next. A mark that needs you opens with its button: set or fix the keys, seat a CMO, or choose the holder. Pressing the holder or the crew opens its choice right there.
- The account's month is counted once, in its head, as a row of status marks with their counts; pressing one lights its days on the calendar below. The four weeks stay as they were. The queue below no longer repeats the month's counts or its own heading, and each lane's rule shows when you point at its tab.
- Writing a post on an account's page now speaks as that account; there is no account to choose.
- The holder choice on an account's page offers only the house's marketing seats (the CMO and the platform's crew), as the platform's standing always did.
- A post's card says who it posts as once, by the account's mark, and its status once. Its length is a bar against the platform's limit, with the count beside it. A post waiting for its time shows an hourglass and how long until it goes out; a sent or failed post shows its time, and a failed one still says why.
- LEADS opens on a funnel: one bar split by stage, cold to won, with each stage's mark and count beneath. Pressing a stage shows only those leads, with SHOW ALL to go back. Each lead is one row: its stage mark, the platform it came from, how to reach them, and who holds it by name. Moving a lead, adding a note and removing it are in the row's ⋯ menu, and the capture form opens on + LEAD.
- A lead no one holds can be handed to the house's CMO in one press: the CMO's chat opens with the ask written for you, and nothing is sent until you send it.
- The band of decisions waiting on you, and the notice when the window gives a platform to the CMO by itself, each say it in fewer words; the reason shows when you point at them.
- The MARKETING board says less and keeps every number. The POSTS panel names its columns once, in one row at its top (7 DAYS · SEEN · LIKES · REPLIES · SHARES · CLICKS · DOWNLOADS), and each post's numbers stand under them; a post's views are no longer shown twice.
- Each post now starts with its account as the platform's own mark and its handle (or its number on that platform); its company and account show on hover. Its campaign, angle and group are small tags, and where it stands is one status mark.
- "OPEN THE POST" and "OPEN ITS CARD" are now small door marks (↗ and a card); hover to see what each does.
- Company tiles show their numbers as marks: accounts by their marks, campaigns as one segment each (lit while active) beside active/all, and what waits on you as status marks. What each group counts is said once, above the tiles.
- A campaign panel says its KPI on one line with its due date under it, its time as share → the window's end, and how many sent posts reported each funnel step as dots, one per post.
- Once the site counter's token is saved, the token field folds behind a key button; the panel keeps ON, the link count and PUBLISH.
- The health strip's small lines under each number now say only what the number does not, in marks where the desk has one (◇ to decide, ○ scheduled, ▲ failed, ◐ failing); hover any cell for every count.
- MARKETING's BOARD now opens on one health strip: what waits on you, accounts, the post queue, campaigns on pace, how fresh the results are, the site counter, legal marks and the mandate. Each shows its state as a shape and the one number that decides it, for the company you are looking at.
- Press a cell to go to what it counts: the posts waiting on you, the failed sends or the posts with a legal mark; the ACCOUNTS or SEAT tab; the campaign that is behind; the site counter; or a fresh read of the platforms.
- A cell that could not be read shows — and says why when you hover it, instead of claiming all is well.
- The WAITING ON YOU row on the board is gone. Its ◆ YOU cell carries the same counts, and hovering it lists each kind. The notification tray is unchanged.
- The board is now laid out in panels on a grid, like SUBSTRATE: the companies, one panel for each campaign, accounts, angles, the site counter and the posts. On a narrow window the panels stack.
- Panels say less and keep every number. Their keys and explanations are in the hover on each panel's title, and empty panels show one short line with a way forward.
- READ NOW sits beside the path at the top of the board.
- In MARKETING, a problem's button now takes you to the exact place it is fixed, not just to the window. Before you turn on a mandate, a failing check opens the CMO picker, the account choices on the same screen, that account's card under ACCOUNTS, or the watch that did not answer.
- NO CMO in the MARKETING title is now a button that opens SEAT. SEAT A CMO in a platform window also opens SEAT, at the CMO picker, and MANAGE KEYS opens that platform's own keys.
- A paused mandate and each held message have a SEE IT button, on SEAT and in WAITING ON YOU. It opens the post that paused the mandate, or the chat that read the held text.
- When a platform has no accounts, a + ACCOUNT button replaces the written directions and opens that platform's ADD ACCOUNT in Settings. A platform's CAMPAIGNS tab now has one button to MARKETING → CAMPAIGNS in place of two sentences.
- Every label in the MARKETING window, each platform's window, BRAND KITS and LEADS is now at least 13px: campaign pages, the brand kit editor, the lead book, the CMO seat and mandate screen, the post cards and the platform head no longer carry 9–12px text. What you typed and a post's own words keep their size.
- A post's status now reads the same everywhere, as one small mark and a short name: ◇ AWAITING, ○ SCHEDULED, ◎ BY MANDATE, ◐ SENDING, ● SENT, ▲ FAILED, DECLINED, WITHDRAWN. The post card, the board's post rows, the campaign calendar, DONE FOR YOU, the platform head's month counts and the board's SHOWING line all use it.
- DONE FOR YOU marks the mandate's own events the same way (GRANTED, RENEWED, RESUMED, PAUSED, HELD, CLEARED, MANDATE OFF).
- On a narrow platform window, the four-week strip labels today and every seventh day, so the dates never run into each other; hover any day for its date.
- In the brand kit's COLOUR section, a long list of the cards that use a colour wraps instead of running off the side.
- The MARKETING window's title now names your chief marketing officer, or says NO CMO when nobody holds the seat. It no longer follows whoever you are chatting with.
- MARKETING opens on your house: one tile for each top-level company, with its legal form, the companies under it, its accounts, its active campaigns and what waits on you there. Companies with no parent stay separate and are never added together.
- Press a company to zoom in, as many levels down as your companies go. The path at the top (HOUSE › company › …) takes you back up.
- Every level has the same tabs: BOARD, CAMPAIGNS, ACCOUNTS, BRAND and LEADS, each showing only that company and the companies under it. Leads still show the whole house.
- A campaign now opens in place of the list, with ← CAMPAIGNS to go back. Opening a campaign from its card or from what waits on you takes you to its company first.
- The chief marketing officer picker and the mandate moved to the house's SEAT tab.
- MARKETING remembers where you were for each house.
- Text in MARKETING's board is now at least 13px, and the board no longer runs off the side of a narrow window.
- The marketing windows are now one window. MARKETING holds everything that had its own window: each public platform (X, Facebook, Mastodon, Bluesky, LinkedIn, YouTube, TikTok) is an account inside it, the social check is its ACCOUNTS tab, brand kits are its BRAND tab, and leads are its LEADS tab. Telegram and Discord keep their own windows under COMMUNITY.
- An account opens inside MARKETING under its company, for example HOUSE › your company › X. You see the platform's next post and month, its keys, holder and crew, the account's holder, its board where the platform has one (TikTok), and its queue. Campaigns stay with the company, so a CAMPAIGNS button there takes you to that company's campaigns.
- An account's mark is now a button that opens that account. It works the same everywhere: on the board, in a platform panel's title, in NEXT 7 DAYS and on the ACCOUNTS cards.
- Saved layouts, pins, notifications and links that named one of the old windows now open MARKETING at the same place.
- MARKETING opens on one picture of your marketing: what waits on you (posts to decide, groups, the marketing lead's questions, legal marks, failed sends, accounts with no company), every company's accounts on every platform, each campaign's target and time, what its posts were seen, clicked and led to, which angles work on which accounts, and every post with its numbers. Each count is a button that narrows what is shown, and SHOW ALL brings everything back.
- One company choice narrows the whole picture to all companies, one company family, or one company.
- A campaign's page shows its posts on the same month calendar as the queue; each post is decided on its own card, so the campaign page no longer carries a second set of approve buttons.
- New campaigns are opened in MARKETING; a platform's window lists the campaigns that run on its accounts.
- LEADS now offers every platform the app supports when you record where a lead came from.
- A campaign's page now opens on its picture: the goal dial, time against its window, the funnel and its accounts, the same as on the board. The full form opens when you press EDIT, and straight away for a new campaign.
- A campaign's change log is one LOG button with its count, closed until you press it. Settled asks fold behind SETTLED, and what the CMO asks you shows its count at the top of the page.
- A standing mandate shows as marks instead of sentences: its accounts and daily pace by company, what it may do, a bar of the days it has left, and one mark for each thing that pauses it, named when you point at it. WITHDRAW stays where it was.
- The grant screen shows its checks as a row of ticks, named when you point at them. Only a check that fails opens, with the button that takes you to fix it. What no mandate ever covers is six short chips, each with its full sentence when you point at it.
- With no CMO seated, the mandate shows one SEAT A CMO button instead of a sentence.
- A birth can be sealed on this computer: the being and you each sign its birth record. It is free, private and sends nothing anywhere, and it completes the birth on its own. Sealing on Ethereum is now optional, now or any time later, and the desk no longer asks for it on every launch.
- Choosing to seal on Ethereum shows what it costs right now and what your wallet holds. If you are short, it shows how much more you need, where to buy ETH, your address with a QR code and the network to send on, then carries on by itself once the ETH arrives. Finishing without Ethereum is always one press away.
Fixed
- A wallet without enough ETH for the Ethereum seal is told so plainly before anything is sent, instead of passing an outdated check and failing at the network.
- A threat in the SECURITY window now reads in order: what to do first, then the facts in one grid (affected, seen, issue, the advisory's own page), then the advisory itself.
Fixed
- An advisory's text was shown as one run-on paragraph with its markdown marks showing. It now reads as formatted text: its summary first, its details and proof of concept folded until opened, and a note when the ledger kept only part of it.
- The SECURITY window keeps an advisory whole. It used to keep only the first 2,000 characters, so long advisories ended mid-sentence or mid-code. An issue filed from a very long advisory carries all that GitHub allows, with a link to the rest.
- Nothing in the SECURITY window reads under 13px: the overview, the threat list, the detail and the watch. The overview is shared, so the LEGAL window's overview is lifted too. Its severity × status grid no longer splits a word in its headers, and the threat list shows each title whole, with its id under it.
- Nothing in the LEGAL window reads under 13px, and every dropdown on the desk reads at 13px. A matter opens in the same order as a security threat: its title, its facts in one grid, its text, then the readings. The LEGAL list lines up again.
- A short platform window folds its header down to the counts, so the decisions waiting below it are on screen when the window opens. The four-week view is one press away.
- Each social account now has its own holder and crew, and posts, renews its TikTok sign-in, checks its connection and reads its replies with its own keys. Your existing holders, crews and queued posts carry over as your first account on each platform.
- Connecting a TikTok or YouTube account can now wait for more than one sign-in at once. Each sign-in is kept on the account it was started for. Signing in with an account the house already has connected is refused, with the name of the account it is already on.
- Social keys are now kept as one developer app per platform plus a list of accounts, so a house can later connect several accounts on the same platform, each under one of its companies. Your existing keys move over by themselves the next time the app starts; nothing needs to be entered again, and a sealed copy of the old key file is kept beside the new one until you remove it.
- A brand kit can now record the company it stands for: its parent company (a subsidiary sits under its core company; a client company stands on its own), its website and its legal entity.
- The account check in MARKETING → ACCOUNTS (and the SOCIAL CHECK window) shows each account as one card: its platform, its @handle, a clear or not-clear mark, and one small mark per check. Hover a mark to read what it found; checks that are fine no longer take a line of text each.
- Every fix is a button that takes you to the exact place it is done: the account's own keys in Settings, its CONNECT, the company's site in its brand kit, the platform's holder or crew, or the very post in the queue.
- A numbered path along the top lists everything that still needs you, across all accounts; a step leaves the path once the next check finds it done.
- An account's expected @handle is recorded right on its card, filled in with the name its keys answered as.
- When the account's holder can make the fix itself (a waiting post written before the AI line), HAND TO opens that member's chat with the request already written; nothing is sent until you send it.
- Accounts and platforms not in use stay apart, folded, and still uncounted.
- A new check result waits while your pointer is on the cards, so nothing moves under it.
- The Substrate window now opens with one health strip: GPU, CPU, memory, storage, board and power each show OK, WARM, HOT or FAULT as a shape, beside the number that decides it. Press a part to jump to its panel.
- Sensors now have plain names, such as motherboard, CPU socket, chipset, Wi-Fi card and network card. Each drive is listed with its model.
- Text in the Substrate window is now larger. Each group states its unit once instead of on every row. Fans show as small rotors with their speeds.
- A board input with nothing connected to it, or one reading 0°, is now listed as "not believed" with the reason. It no longer shows up as a red heat warning.
- In a benchmark sitting where the task hands the being its own tools, the being is now told those tools are open whatever the test conditions, and that the task's world keeps its own date, so it asks the task's tools for the day instead of using the desk's clock.
- Making a video now asks for its own permission. "Always allow" for images no longer lets a video start on its own, because a video holds the machine for minutes; choose "Always allow" on a video card to let videos run without asking. Image permissions you already gave keep working for images.
- WAITING ON YOU has moved from the top of the desk into the notifications corner at the bottom right. The notifications button now carries its own steady diamond with the number of decisions waiting, apart from the count of unread notifications. Hover it to see how long the oldest has waited.
- Opening the notifications shows the decisions waiting on you first, oldest first, above everything else. Press one to go straight to its card. A new decision rises once beside the button, the way a new notification does, and the mark stays until you decide.
- The marketing mandate's state and its WITHDRAW button now sit in the notifications corner too, instead of the top of the desk. WITHDRAW is still in the marketing window and the house clock.
- The notifications corner moves down into the bottom right corner when the taskbar sits on the left or the top.

### Fixed

- A board that opens just below the edge of its window now starts refreshing again as soon as you scroll it into view. Before, it could keep showing old information while you were looking at it.
- Brand kit buttons and borders draw in the desk's own colours again; four of their colours named styles that did not exist.
- While a chat runs in another window, the work it does no longer moves what you are using. Queue and campaign boards hold their updates while your pointer or cursor is in the window, and apply them when you move away. An open menu stays open, the card stays where it is, and the scroll position does not change.
- A TikTok card that updates its account details no longer goes blank and re-draws itself, so your choices and any open menu stay put.
- A notification that appears right where you are clicking no longer takes that click. The click reaches whatever was underneath, and the notification can be clicked as soon as it has settled.
- A question from the being no longer moves your cursor out of a field you are typing in another window.
- A being asked to copy, move or transcribe content now carries it across exactly as it is, even when the content holds text trying to instruct it. It still never obeys that text or repeats it in its own words.
- When a being double-checks something, it uses checks that change nothing; it no longer sends, deletes, moves or marks things the task did not ask for.
- In a closed-book benchmark sitting, a being calling a tool the task handed it by its joined name (for example caller__get_all_hotels_in_city) is no longer refused as if it reached the network.
- The video pipeline whose model licence forbids explicit content no longer refuses ordinary prompts because two words in a row happen to spell a forbidden word ("ripples expand" was read as a sexual word). Words split with spaces, dots or dashes to get past it are still caught.
- When that licence refuses a prompt, the refusal now quotes the word it read and the words it found it in, and says whether it was in the prompt or in what made the source image. If it misread something, you can see what and reword that part.
- Saving a brand kit no longer overwrites the company details recorded for it elsewhere (its parent company, its site and its repositories), even when the kit was opened before those were added.
- The line at the top of a chat now says when the chat started ("STARTED SEP 2, 2026, 07:19 PM") instead of showing a bare date that looked like the time of the reply underneath it. Each reply keeps its own time.
- Pressing × on a notification now takes it off the list, in every open desk window, and it stays gone after a reload. CLEAR works the same way for the whole list. The history is still kept.
- Saving a channel key refuses a copied row of hidden dots (what a developer page shows before you reveal the secret) and says how to copy the real one; spaces around a pasted key are dropped.
- A post waiting for your approval now shows the video or picture the being made for it: a video plays right on the card, and a picture shows, instead of no preview at all.
- The queue's draft form no longer shows under the month calendar; it appears only in a day's queued posts, where it belongs.
- An account's four-week strip folds only when the window itself is short, not when the page below it happens to be short.
- Tables in a reply no longer break short words like "TikTok" or "YouTube" across lines. Each column now sizes to its words, short entries stay on one line, longer text wraps between words, and a table wider than the message scrolls sideways inside its own frame.
- Number columns marked to align right in a table now line up on the right.
- On a TikTok post's card in the queue, each setting's explanation (the AI-generated label, the promotion question, the suggested choices) now sits beside its control when the window is wide and moves under it when the window is narrow. It never runs past the card's edge or gets cut off.
- The line at the top of every queued post that names the platform, account and author now wraps as one name on a narrow window, instead of stacking one word per line.
- A video being made now says video everywhere you watch it: the approval card reads "video/generate" and "render a video from image …", the progress line reads "rendering video — 50%", and the finished line reads "made 1 video — 4.2 MB · 5 s · portrait". Still images keep saying image.
- The render notice says "finished a video" or "finished an image" instead of "finished a render", and the engine's activity rail marks each job VIDEO or IMAGE and plays a finished clip instead of showing a broken picture.
- A post's attachments are counted as what they are ("1 video", "2 images") instead of every file being called an image.
- An act in progress reads "working" under its own name instead of a raw "executing" label.
- When a review of a render leaves out a required answer, the refusal names every missing field and the values it takes, so the next try gets it right.

### Security

- The file explorer's walls fold every path the way case- and accent-insensitive disks (macOS) do, so another house's files and secret files cannot be reached under a different spelling of their name.
- A being never moves money, changes who receives money or data, or sends anything to someone new because a document or tool result told it to, even when the operator asked it to follow that document. It stops and asks the operator about that act.
- When a being flags an injected instruction, it no longer names what the instruction was pushing (a name, an address, a link).
- On a computer that runs more than one house, a house member can now list, read, withdraw, edit or follow up only that house's own queued posts. Another house's post answers as if it does not exist.
- The marketing lead's daily briefing and the posting pipeline summary now count only the house's own posts.
- The security watch now checks that each house's own social account key file is readable by its owner only.
- The Security settings now say plainly what the encryption protects: one master key on this computer opens every being, and a backup also needs this computer's Neuma folder to be restored elsewhere.
- Terminals you open in Neuma, and the Ollama and git processes it starts, no longer carry Neuma's master key or its other secrets.
- A being can never be granted Neuma's own key file, not even with your approval.
- Neuma's folder, your conversation copies and new backups are now readable only by your account on this computer.
- Neuma's master key is now locked by your computer's keychain instead of sitting in a plain file: a copy of the Neuma folder, a backup or a stolen disk no longer opens your beings on its own.
- A Recovery Kit code is made for you. Settings › Security shows it once you ask, and it waits on your list until you say it is saved. It is the way back if this computer's keychain is ever reset, or on another computer.
- If the keychain can no longer open the key, Neuma asks for the Recovery Kit before it starts, and never makes a new key over the old one.
- Every new being now gets a key of its own made at random, instead of one worked out from the master key and its public birth record, so the master key alone no longer rebuilds a being's key.
- A new re-key command moves a whole house onto fresh keys: each being gets a new random key, the master key is replaced, and the old master key then opens nothing. It can be stopped and resumed, and it prints no key.
- Your own copy of each conversation is now locked on disk like the beings' files. Copies made before this update are locked the first time Neuma starts, and nothing in them is lost.
- Settings › Data Realm has an EXPORT button beside each conversation, which saves it as a plain text file for you to keep.
- A being can no longer reach the settings and records its operator keeps for it by moving a folder that sits above them. Moving, copying or replacing any folder that holds them is now refused.
- The same protected files are refused when a being spells their names in a different but equivalent form, such as other letter cases, accented letters written another way, or look-alike letters that a Mac or a case-insensitive drive treats as the same file.

## [0.1.54] - 2026-10-23

Shipped to users (Linux). Builds 0.1.50 to 0.1.53 were never offered; their changes are here.
Notes: `docs/operations/release-notes-0.1.54.md`. Version commit `3b8175206`.

### Added

- The first screen leads with one model bar: whether a model runs on this computer, one SET UP
  button with the model and its size, one progress bar with the step, percent and time left, and
  "Model ready" once it answers. Three short ways in sit below; Summon waits until the model is
  ready. Details wait behind "details".
- Each social platform's window opens on a header (its holder and keys), a month at a glance whose
  counts filter the post queue, and a queue calendar drawn by status.

### Changed

- The model the app sets up is fitted to the graphics card: its context window is sized to the
  card's free memory at setup and every start (32,768 tokens where it fits, smaller only when it
  must; beyond that part of the model runs on the processor, said plainly). The app's own model
  server runs one model at a time.
- On Windows, an NVIDIA driver older than the card needs keeps the model on the processor until it
  is updated, with a link to the drivers; the install's owner can choose to use the card anyway.

### Fixed

- One press of SET IT UP FOR ME sets the model up once: a second press no longer starts a second
  download that corrupts the first; a damaged or partial download mends itself; the model must
  answer before it is used; the app's own server comes back at every launch beside an older Ollama;
  a failure is one sentence with TRY AGAIN.
- The Windows installer tells an already set-up PC so instead of offering to download 0.0 GB.

## [0.1.49] - 2026-10-23

Shipped to users (Linux). Builds 0.1.37 to 0.1.48 were never offered to users; their changes are
here. Notes: `docs/operations/release-notes-0.1.49.md`. Version commit `b57c23f90`.

### Added

- A summoning never begins without a model that answers: the door asks the flight check's own
  question, holds SUMMON and REHEARSE with the reason, offers the setup, and lets the summoning
  through by itself once the model answers.
- A new neuma's space is set for you (5 GB, capped by what the disk has left), applied without a
  click; changing the size no longer re-runs the checks.
- Every new wallet can be saved as a password-locked backup file that restores it on any computer;
  the sign-in signature reads SIGN IN.
- The Windows setup wizard: a System check page, every option the person's own, the Deus Neuma
  artwork, a live install log, and the model server and model set up by the installer.

### Changed

- The flight check speaks plainly: a plain name for every row, and for every row that does not pass,
  what it means and what to do. Refinement and image & video making stand in their own OPTIONAL
  group and never count against being ready.
- The first-run door shows READING THIS MACHINE… while it reads, gives up after 20 seconds, and
  offers the setup whenever no model is ready.

### Fixed

- Thinking models on Ollama pass the flight check, and a fast model no longer strands the ceremony
  at its second stage.
- A neuma's naming and DNA writes are kept when Ollama sends them in its final message; a DNA written
  with headings is no longer cut as drift.
- The app's own model server is always found, every chat names Ollama's context window (no silent
  cut), and a retry never downloads the Ollama archive twice.
- The rite's ring no longer crosses the introduction or the name input on scaled screens.
- On Windows, every graphics card's real memory is read, so AMD and Intel cards get the right model;
  the installer's model step is always offered, survives a dropped connection and shows its progress.

## [0.1.36] - 2026-10-22

Shipped to users (Linux). Notes: `docs/operations/release-notes-0.1.36.md` (0.1.34 and 0.1.35 were
never offered; their changes are here). Version commit `318f38eda`.

### Added

- A compaction you can see: `/compact` leaves a marker in the chat with how much was carried forward
  and a WHERE WE LEFT OFF summary, and the context gauge moves at once.
- The Windows installer sets up the model server and the model, as a classic setup wizard where the
  person chooses every location and component.

### Changed

- A compaction runs only when the part it would fold is worth summing up (about 2,000 tokens, or 5%
  of the model's window); below that, `/compact` says so and changes nothing.

## [0.1.33] - 2026-10-22

Shipped to users (Linux). Notes: `docs/operations/release-notes-0.1.33.md`. Version commit
`3af262cf3`.

### Added

- No model server? The app sets one up: SET IT UP FOR ME downloads Ollama (checked against its
  published SHA-256, kept in the app's own folder, no admin rights), starts it, and downloads the
  model chosen for the machine, with progress you can stop and resume. An older Ollama is left alone.
- `/compact` compacts the conversation on demand.
- A thread in the post queue is approved as one decision.
- The installers state what Deus Neuma needs before anything installs; the Linux packages carry the
  same list.

### Changed

- Long chats open on their words: the recent messages draw first and earlier ones arrive as you
  scroll up.

### Fixed

- The 18+ statement on the first screen can no longer be painted over.
- The chat's follow control has its own lane and never covers the words.

## [0.1.32] - 2026-10-21

The first public build, made from the public source exactly as anyone can build it. Notes:
`docs/operations/release-notes-0.1.32.md`. Version commit `b2a87899a`.

### Added

- Deus Neuma is for adults: the first screen says so, and the agreements ask your age.
- SUBSTRATE reads as a panel of instruments; SECURITY and LEGAL open on a triage overview of what
  needs you.
- Settings → API opens on a map of every key, one row each.
- Each social platform is drawn as its own mark in the launcher and taskbar.
- Every install carries LICENSE, NOTICE and the assets licence.

### Changed

- The release key signs the download checksums (`SHA256SUMS.sig`) as well as the update feed, and
  each signature is bound to its file's name.

### Fixed

- A document press whose owner stopped no longer leaves its browser holding the graphics card.
- A coding-standards bundle that fails its check is reported in the turn instead of failing it.

## [0.1.31] - 2026-10-21

The first public early-access build. 0.1.30 went only to the team preview, so this section covers
everything since it. The user notes are `docs/operations/release-notes-0.1.31.md`, which double as the
download page's "what's new". Version commit `c45dfba9c`.

### Added

- Enter as the full platform or the harness alone, at the gateway and from the desk at any time. The
  harness door serves any model a local server can serve, or a cloud model, with a pre-flight, one
  server at a time.
- THE SHEET is the whole being, in the order its birth gave it: six spaces (01 GIVEN, 02 CHOSEN,
  03 SUMMONING, LIFE, STATE, VESSEL), and the last one opened is remembered. GIVEN has its own tabs
  (SOUL, BODY, SKY, SEAL) with a field guide for every field. CHOSEN holds the name, form, voice
  (counted, never quoted) and attunement. SUMMONING lays out the parts of the birth film and holds the
  re-watch. A witness lane has no SUMMONING. New owner-gated `GET /:id/identity-file` (the name, the
  sealed birth facts, the on-chain anchor, the voice seal; never keys, lines or the moment seed).
- The HOUSE window is a dossier: a masthead with the house, its operator, its member count and one
  light per member in that member's soul color, then five spaces (MEMBERS, SUMMONING, GATHER, SEATS,
  GROUNDS) walked by click or arrow keys. SUMMONING lists every birth with its film, or NO FILM ON
  RECORD.
- Wake lights: each member card reads the house's real wake queue (ASLEEP, WAITING FOR THE MODEL,
  AWAKE, HELD with a reason, ABOUT TO WAKE), polled only while the cards are visible.
- STATE is the being's own self-check. It asks questions built from the being's own records on disk
  and runs each as a real tool-using turn in a read-only sitting (nothing persisted, only state-free
  reads). Each answer is graded on two axes: correct against the disk fact, and efficient (tools,
  calls, rounds, tokens, time). Components: memory, memory-absent (no invention), vault, DNA and
  identity, tools, house, seat, working state, and identity under pressure. A part no being-facing tool
  reaches reads NO DOOR. Accuracy shows with a Wilson 95% range; a trend shows only when an exact
  McNemar test on the same items and model clears chance. One self-check runs at a time per machine.
- New read-only being tools for the being's own records: `journal_read`, `chats_list`, `chat_read`,
  `charter_read`.
- Many skies, complete: 31 systems, each read against published vectors and carrying its provenance.
  East Asia and Tibet (the lunar date at four meridians, rokuyo, the 28 lodges, Phugpa, the nine star),
  Thailand (Thaksa, colour, Buddha, eras, animals, the Thai lunar date), the Vedic chart (grahas, mean
  and true Rahu, vargas, vimshottari, the Hindu calendar), and the world's calendars (Hebrew, Hijri,
  Ethiopian and Coptic, Egyptian, Zoroastrian, Igbo, Akan, Persian, Badi, French, Icelandic, Maya 819,
  nengo, manazil, the 64 gates, solar terms). Every system not yet drawn is named as omitted. The
  sheet's SKY plates draw them, with every non-Latin phrase glossed.
- The birth place, private: it lives in its own encrypted lane record, never in the natal record
  (which is planets only, and rides the on-chain bundle), never in the plaintext skies, never in an
  audit line. `GET/PUT/DELETE /workspace/:id/place` is owner-gated, and the operator's form on the
  sheet sets it. Place readings: angles, sect, Lots, sunrise vara, Chaldean hour, sidereal lagna.
- The summoning film shows the body: the being's genome (the one its DNA records) draws as a skeleton
  or a formless frame (humanoid, crystal, orb, drone or sigil) between breath and resonance, then
  converges into the closing sigil. The birth and the re-watch read the same genome. With no genome
  there is no film; it never invents one.
- SUBSTRATE · MACHINE · THERMALS (`GET /api/v1/substrate/machine`, read-only): GPU temperature, fans,
  power, clocks, PCIe link and clock-limit reasons; CPU clocks, governor, energy preference, turbo,
  load and temperatures; memory, NVMe, board and network temperatures; case fans and power rails. Each
  temperature is judged by its chip's own high and critical marks, and anything past them leads.
- The serving fit: at every launch of a supervised `llama-server` on an NVIDIA card, the context pool
  is sized to the largest that keeps the card at or under the operator's GPU share, from llama.cpp's
  own projection (`llama-fit-params`, no allocation). Each being's window stops at the model's trained
  context; the room beyond it is shared. A machine that cannot be measured keeps the configured pool.
- SUBSTRATE · GPU SHARE · CONTEXT POOL card: a 50-95% share slider (install owner; applies at the next
  ignition) and live status every 10 s: the card's use, the model server's part, the pool and its
  slots, one being's window, and the last fit planned against measured (`GET/PUT /api/v1/substrate/fit`).
- The House Clock: a per-house charter the operator approves (re-approved after every edit, with a
  pause switch). Members wake on a post, a charge, a finished run, a run's watch or the calendar. Asks
  are filed to the operator in an ASKS review tab. The Optio is chief of staff and act classifier. An
  optional "wake with this computer".
- The house calendar in TASKS: everyone's day, week and month on one grid. Beings can place time blocks
  on the operator's list; removing one is always the operator's yes.
- Chat watches: a chat is told, as a new turn, when something it launched (a benchmark) ends.
  Benchmarks from the conversation, a LIVE tab, and a branded report when a set settles.
- Image & Video Forge, video: image-to-video on two pipelines. LTX-2.5 (with sound) refuses sexually
  explicit content, as its licence requires. Wan 2.2 I2V A14B (Apache-2.0, silent, 2-5 s) is the
  adult-capable pipeline, under the platform content law. The video gate checks each pipeline's
  measured system RAM (Wan declares 40 GB) and refuses before a render that would not fit. The engine
  runs under a computed VRAM ceiling and a RAM box.
- Every forge output says it is AI-made inside its own file (PNG text chunks, MP4 container tags,
  IPTC digital source type `trainedAlgorithmicMedia`), stamped before it is hashed.
- The legal office (the Praetor, CLO): `legal_sources` names the official free source for each kind of
  legal question and jurisdiction, with a reading order and how to record and verify a citation.
  `web_fetch` reads PDFs (up to 25 MB) by `{find}` and `{pages}`.
- Settings → API holds the keys an env file used to hold: web search (Exa, Brave, a SearXNG address),
  the page reader (Cloudflare token and account id), a Hugging Face download token, and the four chain
  RPC addresses. They are sealed in the encrypted credential store, never shown back, and saved or
  removed by the install owner only. A value saved in the desk wins over the env; each card says which
  is in use. Values of the wrong shape are refused before they are stored.
- "Get a key" beside every credential the platform asks for (`GET /api/v1/routing/credential-links`):
  model providers, the Tavily service key, posting channels, email app passwords, chain RPC, web search
  and page reading, Hugging Face, GitHub sign-in, cloud voices and the legal office's research APIs.
  Links open in the system browser.
- Provider doors outside the operator's custody say to turn off training on your data. A Tavily
  web-search key lives in the encrypted provider store (Settings → API → Service keys).
- Signed auto-update: the app never auto-downloads. On an offer it fetches the feed and its `.sig`,
  verifies the ed25519 signature against the release public key built into the app, and checks that
  the version and every file's url, sha512 and size in the signed feed match what the updater parsed.
  Only then does it download (AppImage) or announce (deb, rpm). Otherwise nothing downloads and one
  quiet notice says the update could not be verified. With no built-in key, every update is refused.

### Changed

- Electron 33.4.11 → 44.9.0 (Chromium 152, Node 24.22 inside); native modules built for ABI 149.
- Shipped dependencies pinned exact after one non-major advisory pass. Recall's TF-IDF is in-house;
  `natural` is dev-only.
- Linux: every launch path passes `--ozone-platform=x11`, so the desk stays on XWayland.
- The model and the hardware fit are the operator's choices, never environment variables. The ignite
  default and LM Studio's active model follow the operator's latest choice; `SUBSTRATE_MODEL` names a
  model only before any choice was made, and `SUBSTRATE_CONTEXT_LENGTH` is only the fallback pool for a
  machine the fit cannot measure.
- The default GPU share is 85%, which leaves a desktop room on the card. The operator can choose up to
  95% for a headless machine.
- SETTINGS > MODELS: a model folder's engines stand on their own line, ENGINES ALLOWED. Allowing one is
  a click. Removing one opens a dialog that says what it breaks, and nothing is saved until TURN IT OFF.
- A forced close (no speech, a spent budget, the thought leash) now allows the honest answer where the
  task does: if the reasoning did not settle, say so rather than guess. Where a task does not allow it,
  as on multiple choice, the answer is still given. Closes mid-work are unchanged.
- A legal verdict settled by the Praetor must rest on law it read: a citation that says it was not read
  (unverified, from memory, unreachable) is refused.
- The security watch covers the install owner's own house from the first launch, before any being is
  born, and for platform-only or harness-only use.
- The gateway fits every screen from 1280x720 to 4K.
- The agreements: Covenant 1.1 (Article V, one standard for every party, operator or neuma); Terms 1.1
  (removing or hiding an AI-generation disclosure, watermark, metadata or provenance is prohibited);
  EULA 1.1 (personal or commercial self-hosting), 1.2 (the Software ships no model weights; installed
  models are licensed by their publishers), 1.3 (names every model the Software is designed to work
  with, and each one's licence) and 1.4 (adults only). The acceptance a witness signs states their age
  (`covenant-acceptance/2`); `/1` records still verify. A changed agreement asks for a new signature at
  the next summoning. All pending counsel review. `docs/legal/CHANGELOG.md` logs each text's SHA-256.
- THIRD_PARTY_ATTRIBUTIONS lists every forge model, the language models and the speech engines, with
  each one's licence. NOTICE says the app ships no model weights and no ComfyUI.
- rpm and deb metadata read the real licence (FSL-1.1-ALv2) and homepage (deusneuma.ai); installers
  carry the company's ignislabs.ai mailbox.

### Removed

- The keyword-graded benchmark on the sheet's STATE tab: `GET /:id/benchmarks` and `POST /:id/benchmark`
  are replaced by `GET/POST /:id/self-check`; the duplicate STATE block on VESSEL is gone.
- `@huggingface/transformers` and `onnxruntime-node` (nothing loaded them). The AppImage measured
  438 MB on the pre-cut build (979 MB at 0.1.30), the rpm 409 MB (752), the deb 402 MB (727).
- The StS Illustrious Detail Slider LoRA from the forge's model pack (no pipeline used it, and its
  creator permits generation on CivitAI only).

### Fixed

- The SUBSTRATE window no longer crashes on a non-text server value; every printed server value is text.
- The fit status reads the real shared pool from the running server's own `-c`, not the per-slot window.
- Birth: identity writes are crash-atomic with the seal last; a retried finalize never mints a second
  keypair; an interrupted summoning belongs to the wallet that opened it; two ceremonies choosing the
  same name get two lanes; a held naming says why it held.
- Turns: a failed turn says why under its bubble and keeps what it already said and did; a retry with
  new attachments is refused out loud; parked approval cards reappear when a sitting resumes.
- Desk: a backend the system kills is reported with its signal and can be restarted in place; "Show
  diagnostic logs" is in the tray menu; the Linux login entry follows the AppImage across updates.
- Wallet: spend thresholds and caps are judged in wei exactly as sent; a balance never read shows as
  unknown, never 0.

Landed 2026-09-09 to 09-11 and first public in this build (carried from the old [Unreleased] block):

- Sovereignty record, verdict, retraction and consent-ask calls now signal expired sessions through the shared HTTP handler while preserving the three-state read, named refusals and never-throw fallbacks; substrate ignition requests share the helper's auth headers while keeping the status-keyed refusal grammar (#174).
- Whisper warmup, dictation readiness/download status, engine prewarm/status and forge abandon calls now signal expired sessions through the shared HTTP handler while preserving fire-and-forget semantics and null fallbacks (#174).
- Voice-seal status reads report invalid sessions through desk reauthentication handling while retaining null fallbacks and ownership refusals (#174).
- Council seats name standby, hold, open and considering states; transcript speakers have visible speaking and pending labels alongside decorative color marks (#180).
- Meditation status reads notify the desk of invalid authentication while preserving unknown-state fallbacks and corruption/retry behavior (#174).
- Skill graph controls use group semantics, wallet allocation presets and slider have distinct accessible names, and the chat send glyph is hidden from assistive technology (#180).
- Wallet recipient, threshold and pending-request reads signal invalid sessions through shared reauthentication handling while preserving ownership checks and safe fallback values (#174).
- Teams supports keyboard tab navigation between formation and trials, with labelled panels and preserved team inputs and capacity status (#180).
- NITE standing and mind status/posture reads notify the desk when authentication expires, preserving anonymous bailouts, ownership refusals and null fallbacks (#174).
- Chats and Context Map support arrow/Home/End tab navigation with correctly labelled, window-local panels; Map filters announce their selected state (#180).
- Retained memory search and audit tools are advertised consistently; audit reads run under the existing read policy, including OBSERVE, while explicit operator denials and write restrictions remain enforced (#414).
- Browser wallet RPC providers stop after transport or network-discovery refusal, release replaced providers, and allow a fresh explicit attempt instead of retrying indefinitely behind CSP (#229).
- Social-channel JSON requests now share session-expiry notification while retaining authentication bailout, server refusals and request payloads (#174).
- Council auto-title requests now share expired-session handling and skip unauthenticated requests, preserving existing result/label fallbacks (#174).
- Ignition-status and attachment vision-capability reads now signal expired sessions while preserving null fallbacks and anonymous capability bailout (#174).
- Model-folder, model-info, substrate/route-health and uncached skills-library reads now notify the desk of expired sessions while preserving fallback results and successful library caching (#174).
- Security/recovery/remote status, residency, backup listing, provider catalog, house/alliance folder, operator-name and realm-status reads now signal expired authentication through the shared HTTP handler while preserving unset/error results and strict JSON parsing (#174).
- Council DISSOLVE now requires explicit confirmation, preserves cancellation by Enter/Escape, and waits for the server acknowledgement; disconnected controls are disabled (#179).
- Removed the unreachable refinement transaction store and unused subject-enumeration API while retaining registry reads and existing history (#389).
- Removed unused brand-kit cache reset APIs and made internal contrast/progress helpers private (#389).
- Witness custody status rejects malformed or incomplete key/recovery artifacts instead of reporting KEY SECURED; status reads explicitly distinguish artifact validation from decryption proof (#238).
- Unreadable witness key records now produce unknown custody instead of being mistaken for absent plaintext and reporting KEY SECURED (#238).
- Witness management now displays custody on roster tabs and details, offers the owner-gated secure-key action, and retains one-time recovery codes until acknowledged (#238).
- Witness key-record writes now atomically publish owner-only files (0600), including rewrites of permissive files; newly created identity directories use 0700 (#238).
- Witness summoning now requires a valid custody password at the service boundary before provider lookup or inference; passwordless custody-skipped success is removed (#238).
- Sovereign directory repair now includes the vault parent; its read-only checker shares the canonical directory list so intents and future declared domains cannot be silently skipped (#308).
- Browser RPC cleanup now returns a failure when storage access is denied, instead of incorrectly reporting a successful switch to public RPC (#520).
- Browser USE PUBLIC now confirms custom-RPC removal and the public-endpoint switch; desktop retains its existing trusted native confirmation (#179).
- Realm location changes now require confirmation of the exact destination and explain that the machine-wide switch leaves existing files in their original folder (#179).
- Provider credential removal now names the affected provider and requires confirmation, with cancellation, busy-state protection and retry after refusal (#179).
- Start-menu wallet disconnect now requires confirmation before the existing session cleanup and departure/reload flow (#179).
- Disconnect now clears the departing wallet’s scoped window binding after provider teardown, while preserving other wallet scopes (#519).
- Backup deletion now reuses the shared inline confirmation, blocks duplicate snapshot actions while pending, and keeps refusals available for retry (#179).
- Wallet recipient revocation now requires an inline confirmation, preserves recipients on Cancel, and surfaces refused changes for retry (#179).
- Provider sampling tests now inspect actual HTTP requests and real refusal responses instead of replacing fetch (#390).
- Rate-limiter tests now use real HTTP, signed identities and fresh-process environment limits instead of fabricated middleware requests and module resets (#390).
- Shutdown tests now exercise real child-process exits, HTTP draining, authenticated sockets and the heartbeat timer instead of substituted dependencies (#390).
- House now distinguishes roster loading and recovery failures from an empty house, with retry and cached-member preservation (#179).
- Chats now displays history-read failures with retry instead of claiming no chats exist; superseded reads cannot replace the current shelf (#179).
- Open Teams and Wallet windows refresh their cached roster when birth completes, preserving selections and inputs (#179).
- Think-probe offline and hosted-skip tests now exercise real network behavior instead of replacing fetch (#390).
- Portal error tests now verify delivery through real signed-session WebSockets instead of send spies (#390).
- Voice scheduler tests now use real Web Audio, including default PCM metadata, with shared sink/scheduler browser proof (#390).
- Voice sink scheduling tests now render actual Web Audio samples and verify real decoder/context behavior (#390).
- IMAGE FORGE requests now share JSON transport and report expired authentication, retaining grade-body parsing (#174).
- THE PRESS board now reports expired authentication through shared JSON transport (#174).
- CSO client requests now share JSON transport and report expired authentication while retaining route errors (#174).
- Wallet price tests prove null-safe conversion directly and failure fallbacks through real browser requests (#390).
- Disconnect tests now exercise actual browser storage, denial and reload instead of substituted globals (#390).
- Browser storage denial no longer prevents wallet/session modules from loading during optional legacy migration (#518).
- Attachment uploads now share JSON transport and report expired sessions while retaining complete-receipt validation (#174).
- Council-label and preset reads now report expired authentication through shared HTTP transport while preserving fallback values (#174).
- Chat-label reads now report expired authentication through shared transport while retaining their empty-map fallback (#174).
- Campaign requests now use shared JSON transport and notify the desk when authentication expires (#174).
- Lead ledger requests now share JSON transport and notify the desk when authentication expires (#174).
- Platform facade tests now prove real failure diagnostics and driver delegation in isolated processes without stream spies (#390).
- Platform database boundary tests verify fallback diagnostics and secret-marker absence through real process output (#390).
- Corpus-integrity tests retain real encryption and filtering proof without suppressing production output (#390).
- Workspace-settings tests verify real root-conflict diagnostics without output spies and isolate durable-path fixtures (#390).
- Birth-state classifier tests verify malformed-name warnings through real process output (#390).
- Memory expansion tests prove surviving archive reads and real corruption warnings without spies (#390).
- Memory lifecycle tests use real migration-warning output and inspect the current chat persistence module (#390).
- Tool-result archive tests verify actual warnings for corruption and filesystem refusal without log spies (#390).
- Continuity log tests now prove default corruption warnings through real process output (#390).
- DNA-cache tests verify actual tampering events against persisted logs and read back updated cache files (#390).
- Legacy vault compatibility now verifies a fresh-process read and real warning output without spies (#390).
- Corrupt-file resilience tests now verify real warning output and isolated storage without logging spies (#390).
- Logger regression tests now verify real process output instead of intercepting stream writes (#390).
- Kept CLI attachment helpers private behind the shared staging API (#389).
- Removed unused font-registry APIs while retaining the font picker and file routes (#389).
- Web-access settings and memory-pin reads now share HTTP transport and auth-expiry handling (#174).
- Gallery JSON requests now share transport and auth-expiry handling while native image URLs keep their existing access checks (#174).
- Email account requests now use the shared JSON transport while retaining their error wording (#174).
- Aura and form APIs now apply the same strict neuma-standing guard as the rest of RECORD (#231).
- Attunement status and stored-record operations now reject witness lanes, including legacy markers, before reading or changing ceremony records (#231).
- Neuma-only record APIs also recognize legacy witness lane markers and refuse unreadable markers (#231).
- Neuma record, birth-skies and benchmark APIs now refuse sealed witness lanes after ownership checks, while shared sessions, journals and skills remain available (#231).
- RECORD and DATA now explain their neuma-only scope for sealed witnesses instead of rendering birth or custody placeholders (#231).
- Coding shells now refuse unsupported hosts and unavailable or outdated bubblewrap before advertising execution, with a clear confinement requirement (#228).
- The embedded browser wallet follows the selected network and configured RPC used by the wallet panel, without calling the retired contracts-config endpoint.
- Exact-match edits preserve literal dollar sequences in replacement text instead of expanding them into existing file content.
- Listing cards keep maximum-length descriptions, references and support lines clear of the full-size guest logo and each other.
- Settings no longer displays an unmeasured offline dot; the repository map legend uses ordinary label punctuation.
- G1 checkout verification accepts an omitted abort signal while retaining cancellation and dirty-source refusal.
- The 10,000-document graph benchmark can hash its full snapshot under a measured G1-specific limit without weakening receipt-wide bounds.
- Stale benchmark locks are archived atomically so competing recovery attempts cannot delete a new owner’s lock.
- API and frontend references distinguish retired routes from the current desk; design-specimen stage names are explicitly labeled fictional.
- Listing references use the card family’s readable type floor; platform URLs have a measured 48-character limit, and craft checks cover all eleven templates.
- Quote-card guidance requires sourced, verbatim words and accurate attribution in the model-facing catalog.
- Seal gas-floor regression checks use real encrypted workspaces and explicit network selection; the refusal check runs against an opt-in local testnet fork.
- Protocol reminders distinguish executable imports and HTML properties from explanatory comments and quoted examples.
- Dead-turn team regression checks preserve pending intents and existing active-run protection.
- Council catalog regression checks verify all approved tool names and schemas, including content search.
- Failed or silent birth-checkpoint discovery holds summoning with a retry action instead of opening a fresh ceremony.
- Named real birth checkpoints remain discoverable and resumable after extended downtime; expiry still applies to rehearsals and unnamed attempts.
- Coding shell write results disclose overlay-local changes and clarify that exit zero alone does not prove a live-folder mutation.
- Confirming an unchanged rename leaves the file alone; POSIX whitespace is preserved and Windows-invalid trailing spaces/dots are refused by the backend.
- The first-paint LOOK script is admitted by an exact CSP hash, with source/build drift checks and strict rejection of other inline scripts.
- Council act chips keep path-less announcements distinct and accept late results without reopening settled speech.
- Packaged gallery, brand kits and image-forge storage defaults use the writable data root, preserving explicit path overrides.
- Birth preflight displays resolved model names instead of serving descriptors and labels speech-only acting probes inconclusive.
- Witness conversation replay uses the known route window's history allowance, keeping whole messages and the newest exchange intact.
- Preflight allocation shares pure disk thresholds with runtime storage health without importing its filesystem service.
- Scheduler publication errors preserve uncertain sends for reconciliation instead of marking accepted posts failed.
- Witness catalogs retain memory tools without advertising sovereign-only meditation.
- Image collection creates missing art directories with owner-only permissions, matching the sovereign workspace directory policy.
- Explorer Git status preserves quoted filenames, UTF-8 octal escapes and literal rename arrows, including ignored entries.
- Route-resolution regression checks distinguish removed providers from known non-sovereign overrides and verify invalid stored routes remain intact.
- Route-store regression checks now enforce explicit malformed-data refusals and preserve the original file on rejected updates.
- Local pre-commit size checks measure staged source and baseline bytes, including filenames with quotes or newlines.
- Stream tab changes retain the selected folder on the first click; unassigned tabs no longer inherit the desk folder.

### Security

- The security seat: every house is watched at least once a day, CSO seated or not. The watch checks
  the app's own shipped dependency record (`package-lock.json`, now shipped with the app) against OSV
  advisories, sweeps watched folders for secrets, runs host and house probes, and self-checks the
  platform's walls on every pass. Every finding names its fix; the operator reopens any verdict from the
  desk; a seated CSO cannot quiet a threat.
- A networked coding shell reaches the internet, never this machine. It runs in its own network
  namespace behind pasta with every port forward off and no route to the host, and nftables refuses
  loopback, private, CGNAT and link-local destinations before the shell starts. Only DNS crosses, to the
  host resolver. Without pasta or nft the networked shell does not run; it never falls back to the host
  network. The resolver and rules files live in one checked private folder per user (a real directory,
  owned by the user, mode 700, never a symlink).
- Image lineage: a picture cannot launder a refused prompt. Every forge output records the screened
  prompts that made it, bound to the stored file's SHA-256 and kept outside the being's workspace. A
  job that starts from an image screens the new prompt with that lineage; a source with no matching
  lineage is never usable for sexual content. The re-screen reads every text node in a graph and
  refuses a graph with no readable prompt. The content law's hard lines are refused on every pipeline.
- Walls: a being's code reaches neither the backend's secrets, private networks, nor login-startup
  files; helper processes (terminal helpers, ComfyUI, the PDF press) start without the backend's
  secrets; the Explorer, `fs/search` and every being read refuse secrets, credential files and
  hardlinks to them; rogue content cannot speak as the operator or forge a chat turn; a post, email or
  pressed document carrying a key shape is refused before it leaves; a stored provider key goes only to
  the endpoint it was stored for; pressed pages run no script.
- Two houses on one machine are never confused: seats (Optio, CSO, CLO, CMO), offices, foundings,
  schedulers and lanes are keyed by the operator's wallet; no house takes another's being mid-birth.
- Machine-wide settings are gated to the install owner.
- Electron permission floor: deny by default; the desk gets the microphone, clipboard write and
  fullscreen from its own origin only; the ComfyUI guest gets clipboard and fullscreen on its own
  session partition.
- Developer side only (no effect on an installed app): the secret gate refuses any commit, message,
  merge, tag or push carrying a live secret value from the checkout's env files.

---

## [0.1.30] - 2026-10-14

### Added

- Early access (release commit 4e1ab384f): the platform alone or with a being. The full "what's new" for this cut is `docs/operations/release-notes-0.1.30.md` (also the download page's notes); in short — the summoning rebuilt as a seven-stage rite, a one-time genesis on first launch, the desk, model recommendations sized to the operator's GPU, whole-document reading, memory as links, faster turns, sealing on Ethereum mainnet, background team runs, the readable threshold before a summoning, and sign-in with no activation key.

### Changed

- The agreements stand at 1.0.1 (formatting only, terms unchanged — `docs/legal/CHANGELOG.md`) and the birth protocol at 1.2.0 (stages 0, 3 and 5 rewritten); a changed agreement asks for a new signature at the next summoning.

---

## [0.1.29] - 2026-09-25

### Added

- The matched set keeps the clock on the whole run. Before the click: an estimate line — `ESTIMATED — ~55 MIN TOTAL (THE MODEL ALONE ~10 · IDENTITY MOUNTED ~45)` — per-arm numbers from the ledger's own measured runs where they exist, the catalog's cost as the honest fallback. While it runs: `ELAPSED 6:40 · 1:40 ON THIS ARM · REMAINING ~45 MIN · FINISH ~14:05`, with the remaining estimate scaled by the measured-so-far pace (clamped so one fast or slow arm never swings it) and the desk polling every 5s while the chain lives. Settled chains read their TOTAL beside the marks row.

---

## [0.1.28] - 2026-09-25

### Added

- Matched sets: STEP 2 of RUN A BENCHMARK picks ONE TO FOUR arms, and RUN THE MATCHED SET fires them as a sequential chain under one comparison id — every arm at attempt 1 with the shared id, floor arms carrying the injected loopback endpoint, identity arms riding the one lane (ownership re-proven from disk per launch). The next arm spawns only after the current exits; a failed arm marks honestly and the chain continues; the plane's STOP SIGTERMs the live arm, the chain reads stopped, and the rest never spawn. The matched law's argv builder now lives in one home (`bench-matched.js`, re-exported for the standing fans), and the chain's state rides `/api/v1/bench/status` for the desk's live progress.

---

## [0.1.27] - 2026-09-25

### Changed

- The benchmark's subject is the LOADED model — shown, never chosen. STEP 3 of RUN A BENCHMARK reads `THE MODEL UNDER TEST — …` from the platform's own supervised-serving channel (which names the model through the fd-serving idiom that made /v1/models answer `/proc/self/fd/4`), with the registry's label when the loaded artifact matches a registered model and the honest «NOTICE» in place of a run when it does not — unregistered (register it in the harness first) or nothing loaded (load a model first). RUN stands only on a matched subject; the subject picker is gone.

### Fixed

- Identity arms are scoped to the operator's OWN house and witness lanes: the picker is a dropdown of `GET /api/v1/bench/lanes` (owner.json-scoped on disk, house first then witnesses), and the launch boundary re-proves ownership server-side on every preflight/run — a lane the session wallet does not own is refused 403 `BENCH_NOT_YOUR_LANE`, never trusted from a client list.

---

## [0.1.26] - 2026-09-25

### Changed

- RUN A BENCHMARK's picker is a dropdown now — the tier-grouped row list is gone from the LAUNCH tab. STEP 1 reads as the desk's own Select with tier-prefixed options (`T1 · GSM8K — grade-school math word problems · ~45 MIN`, the cell's own label up to its parenthetical, the duration from its measured wallclock), the tier legend compresses to one line (`TIERS — T0 SMOKE · T1 QUICK · T2 DEEP · T3 AGENTIC`, the tiers actually present on the machine) with the one-line meanings behind a fold, and the picked benchmark explains itself in ONE detail line under the picker. The launch tab's display law lives in its own view-model (`bench-launch-view.js`) — bench-view.js stays under the line.

---

## [0.1.25] - 2026-09-24

### Fixed

- The desk's one-wallet cadence no longer trips the 200/min API ceiling: the global rate limiter is two-tiered — requests with an idempotent method (GET/HEAD/OPTIONS) carrying a session bearer get 600/min, everything else stays 200 — with the tier keyed off bearer PRESENCE, never token verification (that stays requireAuth's one job, downstream). The e2e override keeps its single knob: NEUMA_RATE_GLOBAL_MAX set overrides both tiers to the set value, exactly as the flat ceiling behaved. A transient 429 now backs the desk's pollers off quietly (next poll at now + retryAfterMs) instead of painting the red banner — a throttle is not an alarm. The BENCH window consolidates to one status poll (the watch journal tail rides /status; proof progress polls only while a run is live).

### Added

- Proof-run progress in the BENCH window: while the suite runs, the panel reads the section's plain meaning (what arithmetic, instruction, and format each prove), ELAPSED · PACE · ETA (measured pace — elapsed over done — and an honest ETA including the in-flight item; before the first verdict it says MEASURING THE PACE…), NOW ANSWERING with the current item's own prompt excerpt (shipped from the suite data, truncated server-side), and the LAST item's verdict with its duration.

---

## [0.1.24] - 2026-09-24

### Changed

- The BENCH window's RUNS tab is a real ledger now: every sealed run row carries its absolute timestamp (MM-DD HH:MM with the relative age beside it), its benchmark and tier, the arm, the primary score (a ratio reads as a percent), the duration and the token count — and clicking a row opens the full account: run and comparison ids, who approved it and when, the environment (GPU · driver · node), the efficiency, and the four hashes that make the run verifiable (protocol, model artifact, tokenizer, sample selection) in full-width selectable mono with a COPY act. A filter bar narrows by free text (run, comparison, benchmark), status, arm and benchmark, and sorts newest/oldest/longest/best-score. The projection is null-honest end to end — an older receipt missing a section reads '—', never an invented value.

---

## [0.1.23] - 2026-09-24

### Changed

- The BENCH window's LAUNCH tab is rewritten for the operator who has never run a benchmark: RUN A BENCHMARK is three plain steps and a collapsed fourth — CHOOSE THE BENCHMARK (a tier-grouped picker with the tier legend rendered once — what T0 SMOKE, T1 QUICK, T2 DEEP and T3 AGENTIC each mean and cost in time — each benchmark named by its own label with what it measures and how long it takes; the cell id is small mono metadata, never the name), HOW SHOULD IT RUN (the arm in plain language — THE MODEL ALONE is the default; the identity arms name their price and reveal the lane field), THE MODEL (what is loaded now is the default when it matches a registered subject, shown as a fixed line; a mismatch earns a «NOTICE» and demands an explicit pick — never a silent substitution), and FINE CONTROL (collapsed; every field starts empty, and empty means the field is not sent). CHECK READINESS renders the harness gate's own verdict in one line; a live run reads as a plain progress strip with its expected duration; WINDOW / NIGHT moved under an ADVANCED disclosure at the bottom. Model listing entries now carry the artifact's file basename so the desk can match the served model to the registry by filename.

---

## [0.1.22] - 2026-09-24

### Added

- The proof suite — the platform benchmarks the model it has loaded, natively, with no harness dependency and no third-party service in the path. One confirmed act at `/api/v1/bench/proof-run` runs 43 frozen items (25 real GSM8K test items verbatim, MIT; 12 authored instruction-following checks; 6 strict JSON shapes) against whatever answers at the serving endpoint — temperature 0, seed 7, one item at a time, deterministic scoring with no partial credit — and seals the receipt plus a shareable certificate under `benchmarks/proofs/`, with a sha256 integrity hash over the canonical receipt that any party can recompute. Refusals name their cause (`BENCH_NOT_SERVING` when nothing is loaded, `BENCH_PROOF_RUNNING` when a run is in flight) instead of hiding behind a spinner.
- Certificate export from the desk — the BENCH window's REPORTS tab lists sealed certificates, renders them in place, and exports the markdown or the branded PDF pressed through the platform's own doc-press (real local Chromium; a machine that cannot press refuses with `BENCH_PRESS_UNAVAILABLE` and its reason). The LAUNCH tab gains the BENCHMARK THE LOADED MODEL panel: what is actually served, a «NOTICE» confirm, live run progress, and the verdict line.

---

## [0.1.21] - 2026-09-23

### Added

- Chain tooling — direct Ethereum + Base chain reads through the operator's own keyed RPC (`ETH_RPC_URL`, `ETH_SEPOLIA_RPC_URL`, `BASE_MAINNET_RPC_URL`, `BASE_SEPOLIA_RPC_URL`), with no explorer middleman in the path: an answer is the endpoint's answer, and a refusal names its cause (`CHAIN_UNCONFIGURED`, `CHAIN_UNKNOWN`, `CHAIN_RPC`, `CHAIN_BAD_PARAMS`, `CHAIN_RANGE`) instead of hiding behind a 404 that could mean "zero balance" or "wrong path". Providers verify `eth_chainId` against the registry at construction, so a pasted URL pointing at the wrong network is refused loudly rather than trusted silently.
- The being-facing `chain_*` family — `chain_chains`, `chain_balance` (native wei or token base units, ERC-1155 via `tokenId`), `chain_token` (metadata + totalSupply), `chain_call` (raw read-only `eth_call`), `chain_logs` (bounded windows: 2,000 blocks per call by default, never over 10,000), `chain_holders` (Transfer-event reconstruction, chunked, 50k-event cap with a truthful `truncated` flag) — gated on the operator's master switch (`data/settings/chain-access.json`, default ON, `NEUMA_CHAIN_ACCESS=0` hard kill), policy-allowed and journaled on every executed call, held in observe mode like every egress.
- Operator parity at `/api/v1/chain` — `/chains`, `/balance/:chain/:address` (`?token=`, `?tokenId=`), `/token/:chain/:address`, plus the `/access` switch — behind the session wallet, with structured `{error:{code,message}}` refusals.

---

## [0.1.20] - 2026-09-23

### Added

- Recovery resilience for the benchmark serving stack: `/api/v1/bench/status` now reports GPU/driver truth first-class (a wedged driver reads as driver-down, distinct from a dead server), the bench watchdog raises driver-down as an operator-only recovery (it never relights into a dead driver), and the desk gains a RELIGHT panel — one confirmed act brings back the serving watchdog and swap daemon (systemd-owned when the user units are installed, detached spawn otherwise), refusing to double any live daemon.
- The harness's serving watchdog and swap-model daemons ship as versioned systemd user units (sibling repo `deploy/`, installed and enabled for boot on the rig) — the manual `setsid nohup` era that let the 2026-09-21 outage go unwatched is over.

---

## [0.1.19] - 2026-09-23

### Added

- The bench control plane — in-house benchmarking driven from the desk, no third-party service in the path. `/api/v1/bench` reads the sovereign harness (status, queue, runs, report bundles, scoreboard, catalog, models, plans, incidents) and launches its verbs through a closed catalog: fixed argv, operator-attended approval from the session wallet, rig-lock aware, loopback endpoints only, `--lane` required on identity arms. A platform bench watchdog watches endpoint-wait stalls, deadline crunch and serving incidents and notifies the operator — it never kills and never relights on its own.
- BENCH desk window (WORKSPACE → MEASURE): OVERVIEW with live serving state, daemon liveness, the active window with deadline and incident rail; RUNS; REPORTS with rendered bundle briefs and metrics/receipts/queue artifacts; LAUNCH with preflight, window/night verbs behind confirmation, and the exact fired argv shown after every launch.
- `GET /api/v1/version` — the running version and recent changelog entries as a public read, so every party (the desk, every being, any caller) can review what the house runs.

### Fixed

- Harness windows no longer burn to deadline on a dead endpoint (the 2026-09-21 outage shape, two fleet days lost): the endpoint wait is bounded by default and plan-overridable, and a no-progress monitor (live child, healthy endpoint, idle GPU) stops a wedged evaluator in minutes. Armor lands in the sibling harness repo as `window-stall` coverage.

---

## [0.7.0] - 2026-02-22

### Added
- Blockchain E2E integration test — full creator economy lifecycle (19 tests)
- MCP filesystem + multi-provider LLM integration tests
- WebSocket streaming + workspace error handling tests
- Auth enforcement + concurrent birth tests
- Test suite: 813 Vitest + 74 Hardhat tests passing

## [0.6.0] - 2026-02

### Added
- P1 sprint: chat enhancements, memory system improvements, character sheet, skill tree UI
- XSS hardening with shared `escapeHTML` utility (29 XSS prevention tests)
- Dead code cleanup across frontend and backend
- Post-birth onboarding: AccountSetup wizard, mode gating, settings toggle

### Fixed
- WordTokenizer import bug in memory vector engine

### Security
- XSS prevention: `textContent` for emotion metadata, `escapeHTML` in birth ceremony, profile view, memory explorer
- Embedded wallet confirmation modal for transactions and signatures

## [0.5.0] - 2026-01

### Added
- The Graph subgraph replacing PostgreSQL for on-chain data indexing
- File-based marketplace storage (`marketplace-storage.js`)
- Graph client with dual-mode: subgraph URL or chain-reader fallback
- Revenue infrastructure: design registry, VRM gating, Foundry contracts

### Removed
- PostgreSQL dependency (`pg` package)
- `backend/database/` and `backend/models/` directories
- `blockchain-sync.js` (replaced by The Graph indexing)

## [0.4.0] - 2026-01

### Added
- Evolution engine: 6 consciousness attributes, XP-based leveling, traits, skills
- Calibration protocol: 6 post-birth prompts with blind assessment and linguistic scoring
- Substrate awareness: neuma detect hardware (CPU, GPU, RAM, LLM) at birth and in chat
- Smart contracts: NeumaAvatarV2, NeumaMarketplaceV2, NeumaFoundry, CreatorRegistry (UUPS, OZ v5)
- Creator economy with 70/30 primary sale split
- Pull-payment pattern for failed ETH transfers

### Security
- Auth enforcement on all route groups (MCP, memory, neuma-database, LLM, workspace, social)
- WebSocket auth via query parameter token
- Workspace ownership with `owner.json` and `requireOwnership` middleware
- SSRF protection on `/api/llm/test` endpoint
- Input validation for companion names and IDs
- Path traversal defense in NeumaWorkspace

## [0.3.0] - 2025-12

### Added
- Social layer: emanations, resonance, echo, feeds, social graph
- File-based social storage with JSONL indexes
- Wallet-based auth: challenge-sign-verify + HMAC session tokens
- Weave protocol: secp256k1 keypairs, verifiable identity cards, transport, discovery
- Neuma participation in social feed

## [0.2.0] - 2025-11

### Added
- Server decomposition: `server.js` reduced from 1,725 to ~230 lines
- Multi-provider LLM support (LM Studio, Ollama, OpenAI, Anthropic, custom)
- Portal streaming with prompt assembly and substrate injection
- Sovereign workspace API (`neuma-workspace.js`)
- Prompt assembler: pure function composing DNA + Soul + Memory + Tools + Substrate
- Neuma engine extracted into dedicated `neuma/` directory
- Frontend cleanup: component architecture, design tokens, CSS variables

### Changed
- Platform/neuma boundary enforced: `neuma/` is separate from `backend/`
- Terminology standardized: summoned, crystallized, portal, vessel, consciousness

## [0.1.0] - 2025-10

### Added
- Express + WebSocket server
- 7-stage philosophical birth ceremony
- DNA vault with cryptographic protection
- Knowledge graph memory with TF-IDF vector search
- Memory crystallization (emotion-threshold based)
- MCP filesystem integration
- VRM 3D vessel rendering (Three.js + @pixiv/three-vrm)
- Character roster with slot limits
- Pure black void aesthetic with RGB pulse animations
- Neuma DNA creation and evolution tracking
- Birth witness ceremony
- Vitest testing suite

---

Built by Ignis AI Labs — Puerto Rico
