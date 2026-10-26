# Installers and first-run setup

Apply to anything a person installs: desktop applications, Windows setup programs, Linux packages, and the setup scripts a person runs. The reference implementation is Deus Neuma's Windows wizard (`neuma/build/installer.nsh`, `neuma/build/installer-preflight.ps1`).

## The person installs, never builds

- Ship one finished installer per platform, built and signed by us: a Windows setup `.exe`, a Linux AppImage plus `.deb` and `.rpm`, a macOS `.dmg`. The person downloads it and double-clicks it. Never hand a person source code, a build script, a terminal command, or a step that compiles anything on their machine.
- Build every platform's installer in our release pipeline from the released revision. Check that every native module is the target platform's binary before anything ships. Do not depend on a person's machine having compilers, runtimes, or developer tools.

## Windows: the classic setup wizard

Every Windows installer is a classic setup wizard, like a game or any common Windows application. It shows these pages in this order, and the person can go Back from any of them:

1. **Welcome:** what the product is, and any eligibility rule (for example adults only, 18+).
2. **Agreement:** the requirements in plain words, then the license, which the person must accept.
3. **Install for:** only me, or everyone on this PC. "Everyone" asks for administrator rights; "only me" never does.
4. **Install location:** the default is `...\Programs\<Product name>`, named with the name the person knows. A Browse button is always there. Space required and space available are shown.
5. **System check:** before anything is written, check the PC and show every finding on its own line: Windows version, memory, graphics card and its memory where it matters, free disk on the chosen drive, any prerequisite already present, and the internet when a download is needed. Each line says what was found and what setup will do about it ("ready", or "setup installs it"). Block only what makes installation impossible, such as a 32-bit or unsupported Windows or a full drive, and say how to fix it. Everything else is a warning the person may proceed past. Run the checks hidden: no console window, ever.
6. **Components:** a checkbox for every optional part. The product is shown checked and disabled as required. Include every prerequisite setup can install (runtimes, servers, models), optional kits, a **Start menu entry** (checked), a **desktop shortcut** (checked), and **start with Windows** (unchecked). Describe each large download with its size. A component that is not ready yet is shown disabled and labelled "coming in a later update". It is never hidden, and never offered when it cannot be delivered.
7. **Locations for large data:** models, caches, and libraries each get their own folder choice, with Browse and a free-space check. Never put large data in the install folder without asking.
8. **Ready to install:** a summary of every choice: folders, components, shortcuts, startup. Nothing is written before the person clicks Install.
9. **Installing:** the details list is a live log. Every step says what it is doing as it starts: copying the files (with their size and an expected time), registering with Windows, each shortcut, startup, and each prerequisite download with its progress. Never let the log sit empty while work happens; turn it back on where a framework silences it (electron-builder: `SetDetailsPrint none`). When the install finishes, the log stays on screen, marked Completed, until the person clicks Next. If an optional step fails, the install still succeeds, and the app offers that step again on first run.
10. **Finish:** a **Launch <Product name>** checkbox, checked by default. It launches as the person, not elevated.

The installer must also:

- **Carry the product's own artwork.** The Welcome and Finish pages (and the uninstaller's) show the brand's mark, name, and colours, never a framework's stock image. Generate the artwork with a committed script from the brand's source files.

- **Be findable like any Windows app.** It appears in the Start menu (unless the person unticked it), on the desktop if chosen, and in Settings > Apps with the product name, version, and publisher.
- **Keep the person's choices.** Store every choice (component folders, Start menu, startup) under `HKCU\Software\<Product name>`. A silent update (`--updated`) shows no page, installs no component again, and keeps every choice.
- **Share one startup switch with the app.** Start with Windows is the same `HKCU\...\Run` entry the app's own setting reads and writes. On Windows the app sets its AppUserModelID to the installer's shortcut ID, so its notifications (including update alerts) are shown.
- **Uninstall cleanly.** The uninstaller removes every shortcut, the startup entry, and its registry keys. It asks before deleting large user data, such as models, and defaults to keeping it.
- **Provide prerequisites itself.** Use the app's own runtime (for an Electron app, the app's `.exe` with `ELECTRON_RUN_AS_NODE=1`) and the same code the app's first-run setup uses. Pin each download to a version and SHA-256. Use the system's own tools by full path (for example `%SystemRoot%\System32\tar.exe`), never whichever copy the PATH finds first.

## Every platform

- **Run a preflight before failing.** Check what is needed, say exactly what is missing, and install it when it can be installed safely. Never print "X is missing" and stop when setup could have installed X. Confirm before anything that needs administrator rights.
- **State requirements up front**, in the installer and on the download page. Never let a person discover a requirement through a failure.
- **Let the app offer what the installer did not finish.** First-run setup offers any step the installer could not finish, using the same code.
- **Make the app notice updates.** An installed app checks for signed updates and tells the person when a new version is available.

## Proof before handing it over

- Run the real installer, built from the released revision, end to end on the target OS or a faithful stand-in: every page, Back on each page, a default install, a custom folder, every component on and off, the finish-page launch, the update path, and the uninstall.
- Capture every page and inspect it for wording, clipping, and layout. Record what could not be tested and why.
- Clean up every shortcut, registry key, and file a test install wrote to the build machine.
