// ollama-window — the context window every Ollama is asked to serve. Pure (a constant).
//
// THE WINDOW AN OLLAMA SERVES. Unasked, Ollama sizes its context by the GPU it sees (a 96 GB
// card got 262,144 tokens on 2026-10-22; a smaller card gets a smaller one) and cuts a longer
// prompt silently, so a being's identity could be lost on exactly the laptops the 4B tier is
// for. Every chat to Ollama names this window (llm-request-builders.js), the platform's own
// server starts with it as its default (managed-ollama.js), and a model whose trained window
// is smaller keeps its own. 65,536 is the context the setup's tier table sizes every
// recommended model's memory at (substrate-setup.js CHOICES `min`).
export const OLLAMA_SERVED_CONTEXT = 65536;
