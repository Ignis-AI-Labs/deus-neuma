Fixed
- The video pipeline whose model licence forbids explicit content no longer refuses ordinary prompts because two words in a row happen to spell a forbidden word ("ripples expand" was read as a sexual word). Words split with spaces, dots or dashes to get past it are still caught.
- When that licence refuses a prompt, the refusal now quotes the word it read and the words it found it in, and says whether it was in the prompt or in what made the source image. If it misread something, you can see what and reword that part.
