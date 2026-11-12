Fixed
- The parallel capacity scan no longer reports 2 or 3 neuma at once on a model server that runs one request at a time. It now measures what the server delivered over the whole wave, so a queue reads as a queue and a single-slot server is named as one.
- On Ollama, the capacity scan now uses the server's own token count instead of a word estimate, so its speed readings match what the server reports.
