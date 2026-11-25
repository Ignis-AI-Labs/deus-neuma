Fixed
- Hold Space to talk no longer loses what you said in the middle of a long hold. The live reading could go deaf while you were still speaking, and its last words were taken as the whole of it. Now the hold watches its own live reading: when you have kept speaking and no new word has come back for five seconds, the hold finishes from its own whole recording, which heard everything.
- A hold is no longer cut when the window loses focus for a moment (a notice, another window, a dialog). The recording goes on while the key is down, for at most twenty seconds away from the window.
- Speech that arrived while the listening engine was still starting is no longer dropped, and audio that cannot be taken in is never dropped silently: the hold finishes from its recording.
- On machines using the Whisper live engine, a hold longer than thirty seconds no longer comes back as its first thirty seconds only.
