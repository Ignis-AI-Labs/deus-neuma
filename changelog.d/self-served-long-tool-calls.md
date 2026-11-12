Fixed
- A being on a model you serve yourself (Ollama, LM Studio, llama.cpp) no longer loses its turn while it writes a long file in one go. Ollama sends a tool call only once it is complete, so the app now waits up to 10 minutes of silence on these models instead of 2. Hosted models keep the 2-minute limit, and you can still interrupt a turn at any time.
