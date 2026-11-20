Security
- A being can no longer write into the folders that hold programs the app runs for you: extensions, the dictation engine, a model folder's engines and models, and the webhook settings. Reading them is unchanged.
- Dictation on Linux only uses a speech engine the app itself started. If another program answers in its place, nothing it says is used and the hold fails with a plain message.
- Dictation into other apps types words on one line only: a line break is typed as a space, and control characters are never typed.
- An extension starts only if its files are exactly the ones its security check read. An extension added before this version must be added again once (its keys are kept); one whose files changed is refused until it is added again or removed.
- On Linux, a program run by another account on this computer that answers where Ollama would is never used as your model server. Setup says so and sets up its own beside it.
