Added
- Deus Neuma Character XL, the house's own image model, as the `still.neuma.txt2img` pipeline. It's a blend of three anime and 2.5D models: 80% Hale Anime (for its look), 10% WAI and 10% PerfectDeliberate. It reads prompts with Hale's own text encoders, so it runs on Hale's author's recipe. Like every character pipeline, it does a second pass that enlarges the picture 1.5 times, and it keeps the house's adult floor. Images made with it are yours to use, including commercially. The script that makes it (`scripts/merge-checkpoint.py`) accepts only parts whose terms allow a blend to carry its own permissions, and it writes the recipe and every part's fingerprint into the model file itself.
- Three more prompting rules for the character pipelines, each learned on a real render:
  - A word can turn into an object: "ball joints" drew a ball in her hand.
  - A strong colour spreads: "gold" turned the whole body gold and brought wings and halos.
  - Hands and faces need their own close-up prompt.
