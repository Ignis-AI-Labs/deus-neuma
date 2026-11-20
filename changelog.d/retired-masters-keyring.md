Fixed
- Changing the install's master key can no longer lock you out of your own account keys or chat history. The old key is now kept, sealed under the new one, so anything the change did not reach still opens, and the next start moves it to the new key by itself. Before this, a key change could leave your social channel keys locked for good and every platform's keys had to be pasted again.
- Each being's previous key is kept the same way when the house is re-keyed.
- If the app's key file goes missing on a computer that already holds your data, Neuma now stops and tells you to put the key back instead of quietly making a new key that opens nothing. The desktop app also keeps a second copy of its locked key record.
- A chat history that cannot be opened is now reported instead of silently showing up short.
- You can keep a copy of your master key off the computer without a password manager: a recovery file sealed under a passphrase you choose, with commands to make it, check it and restore from it.

Security
- Files rewritten during a key change are readable only by you.
