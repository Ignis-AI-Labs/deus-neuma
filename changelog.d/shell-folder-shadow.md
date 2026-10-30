Fixed
- A being's coding shell no longer stops working because a file changed in a folder where the shell once wrote something. The shell now refuses only when a file it changed itself was changed underneath it, or when it replaced a whole folder that then changed.
