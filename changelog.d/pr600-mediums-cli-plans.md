Security
- `neuma code --watch` acts only on AI comments in lines you have not committed or staged yet. A comment that arrives with a pull, a checkout or a merge is ignored, and the first comment of a session waits for your yes.
- `neuma code --check` asks before each run, listing the files that turn changed, and no longer hands the app's own keys to your check command. With no yes, the check does not run.
- Approval prompts in the terminal and in an editor now show what the act reaches, what a yes grants and the whole act. An act too long to show there is refused and can be approved at the desk.
- A team plan counts as approved only when the app itself recorded the approval. A plan file written any other way is ignored, and a being can no longer write that file.
- On Windows, the Startup folder and the PowerShell profile folders are protected from a being's writes, and paths spelled as file streams, short names or with a trailing dot are refused.
