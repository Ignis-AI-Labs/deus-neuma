Added
- Three image pipelines for anime and 2.5D characters that come out clean every time: WAI Illustrious v17 (still.wai.txt2img), perfectDeliberate v10 (still.deliberate.txt2img) and Hale Anime IL v19 (still.hale.txt2img). Each one runs on the settings its model's author publishes: the sampler, the steps, the guidance range, the CLIP skip, the quality tags and the negative prompt. Each then does a second pass that enlarges the picture 1.5 times and redraws the fine detail. A being only describes the subject. It can choose the size, the seed, the steps and the guidance within the author's range. It cannot rewire the graph or drop the second pass. Its negative prompt is added to the author's and does not replace it.
- Every render through these pipelines also keeps the house's adult line in its negative prompt, which steers away from childlike bodies. The being cannot remove it, and the content law still checks the being's own words first.
- A pipeline now says before any render if the image engine is missing its checkpoint or its upscaler, and names the file.

Changed
- The SDXL text-to-image pipeline now says plainly that it is SDXL Base. It suits photos and plain-sentence prompts and does not understand anime tags such as "1girl" or "masterpiece", and it names the three character pipelines to use instead. Characters made through it came out muddy for that reason.
