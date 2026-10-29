# Set up Deus Neuma with an AI assistant

You can hand the whole setup to an AI coding assistant that can run commands on
your machine: Claude Code, Codex, Cursor, Windsurf, Gemini CLI, or similar.
Open it in an empty folder where you keep projects, paste the prompt below, and
let it work. It checks your machine, installs what is missing (asking you
first), gets Neuma running from source, and tells you what it found.

Two things stay with you:

- **Approve anything that needs administrator rights** (system packages,
  drivers). The prompt tells the assistant to ask before every such step.
- **Your keys stay yours.** Neuma runs on a model on your own machine; nothing
  in this setup needs a cloud API key. Never paste one into the chat.

If you only want to use Neuma, not develop it, the installers at
[deusneuma.ai/download](https://deusneuma.ai/download/) are simpler.

## The prompt

Copy everything in the box.

```text
You are helping me install and run Deus Neuma from source on this computer.
Deus Neuma is an Electron desktop app with a Node.js backend:
https://github.com/Ignis-AI-Labs/deus-neuma (default branch: dev).
The authoritative build guide is docs/BUILDING.md in that repository. Read it
after cloning and follow it whenever it disagrees with these steps.

How to work:
- Go one step at a time. Run a command, read its output, then decide the next
  step. Never guess at output you did not see.
- Ask me before anything that needs sudo or administrator rights, installs a
  system package, changes a driver, or downloads more than 2 GB. Say what it
  is and why.
- Never invent configuration values or API keys. Never commit or push.
- If a step fails twice the same way, stop and show me the exact error.

Steps:
1. Detect my OS, CPU architecture, RAM, free disk space, and GPU (NVIDIA:
   nvidia-smi; AMD: rocm-smi or lspci; Apple: system_profiler). Report them.
2. Check the prerequisites and install what is missing (asking first):
   - Git.
   - Node.js 22 (20 or newer works). If Node is missing or older, prefer a
     version manager (nvm, fnm, or nvm-windows) over a system install.
   - A C/C++ toolchain for native modules, plus Python 3:
     Linux: build-essential (Debian/Ubuntu) or gcc-c++ and make (Fedora).
     Windows: Visual Studio Build Tools with "Desktop development with C++".
     macOS: Xcode Command Line Tools (xcode-select --install).
3. Clone the repository and enter it:
   git clone https://github.com/Ignis-AI-Labs/deus-neuma.git
   cd deus-neuma
   git branch --show-current     (it must print: dev)
4. Install dependencies: npm install
   If it fails inside onnxruntime-node (common on CUDA 13 machines), run
   instead: ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install
   (on Windows PowerShell: $env:ONNXRUNTIME_NODE_INSTALL_CUDA="skip"; npm install)
5. Create the config: copy .env.example to .env. Leave the defaults. Read the
   comments in .env and tell me about any setting that looks like it needs a
   decision from me; do not fill in keys or accounts yourself.
6. A local model. Neuma needs an OpenAI-compatible model server on this
   machine: Ollama, LM Studio, or llama.cpp's llama-server.
   - If one is already running, say which one and which models it has.
   - If none is, recommend one for my OS (Ollama is the simplest) and ask me
     before installing it.
   - Recommend a model for my GPU using the table in docs/BUILDING.md
     ("A local model"). Ask me before downloading it; models are large.
7. Run the checks: npm run lint, then npx vitest run --project suite test/unit
   Report the pass/fail counts. Failures here do not block running the app;
   list the failing files for me.
8. Start Neuma in development: npm run dev
   It prints the address of the desk. Open that address (or tell me to), and
   confirm the backend answered without errors in the log. For the desktop
   app instead: npm run electron:dev
9. Report back, briefly:
   - what you installed or changed on my machine,
   - versions of Node, npm, Git, and the model server,
   - the model you recommended and why,
   - test results, and anything that failed with its exact error,
   - how I start Neuma again next time.

If something is broken in Neuma itself (not on my machine), help me write a
bug report: the repository's Issues tab has a template for bugs and one for
platform reports. Include the OS, the step, the exact command and the exact
error, and never include personal paths, keys, or tokens.
```

## For contributors

The same assistant can help you change Neuma. Read
[CONTRIBUTING.md](../CONTRIBUTING.md) first: every change goes into `dev` by
pull request (branch from `dev`, open the pull request into `dev`), tests use
real dependencies rather than mocks, and you sign the contributor agreement on
your first pull request. Ask your assistant to run `npm run lint` and the unit
tests before you push.
