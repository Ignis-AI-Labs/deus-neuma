Changed
- On a graphics card too small to hold the model's whole 32,768-token window with its usual 8-bit conversation memory (a 12 GB card with the 27B model, for one), the app's own model server now keeps that memory at 4 bits, so the window stays whole instead of shrinking to 20,480. Image input is kept. Cards with room are unchanged, and your own Ollama setting still wins.
