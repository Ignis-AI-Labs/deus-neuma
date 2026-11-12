Fixed
- A benchmark answer's record of tool calls now says why each failed call failed (the refusal or error message) and which argument names the model used, never their values. A round where one call was refused and another ran no longer records the refused call twice and loses the one that ran.
