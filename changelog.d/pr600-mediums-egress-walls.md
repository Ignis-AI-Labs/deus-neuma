Security
- A file download or an image save is refused when its web address carries a key, and both now ask for your approval even in AUTO unless you chose Always.
- Outgoing posts, emails, documents and web requests are checked for keys hidden by re-encoding, invisible characters, line breaks or changed case. A bare 64-character hex value or a signed login token is refused too, which includes transaction hashes and SHA-256 checksums.
- The file explorer no longer opens or writes wallet keystores, or credentials that tools keep under an ordinary file name (cluster, container, code-host and browser logins).
- The file explorer no longer creates, saves or moves a file through a linked folder that leads outside the folders you opened.
