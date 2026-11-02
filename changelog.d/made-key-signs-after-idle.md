### Fixed

- **A key made for you signs again after the wallet locks itself.** When the wallet had locked from being idle, the next signature (signing the covenant before a summoning, for one) asked for a wallet password. A key the app made for you has no password you know, so there was no way past that prompt. The app now opens the wallet from this computer's keychain first, and asks for a password only when there is none kept.
