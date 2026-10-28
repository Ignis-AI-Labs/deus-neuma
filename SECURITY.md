# Security

Neuma runs on your machine. It holds keys, a wallet and your beings'
memories, so we take reports seriously.

## Reporting a vulnerability

**Do not open a public issue.** Instead, do one of these:

- email **security@ignislabs.ai**;
- use GitHub's **private vulnerability reporting** on this repository
  (Security → Report a vulnerability).

Include what you found, how to reproduce it, and its impact. We will reply
within 3 working days and keep you informed until it is fixed. With your
permission, we will credit you.

## Reviewing the code

[docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md) maps the platform for a
security reviewer: listeners, keys, the wallet, what an AI being can do, the
supply chain and the update path.

## Supported versions

Neuma is in early access: fixes ship in the next release, and only the
latest release is supported. There are no long-term support versions yet.

## In scope

- The desktop app, the backend, the CLI and the build pipeline in this
  repository.
- Anything that lets one party read or act as a neuma, a guardian or a wallet
  without consent.

## Out of scope

- Third-party model servers (llama.cpp, Ollama, LM Studio). Report those
  upstream.
- Issues that need an already-compromised machine.
