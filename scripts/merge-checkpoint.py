# Deus Neuma Character XL — how our own model is made (Design note, 2026-11-20: […]). The image model (UNet) of Illustrious-family checkpoints is blended
# tensor by tensor on the processor; the text encoders and the VAE stay the first part's, whole (PerfectDeliberate's VAE is
# a different decoder: averaging two decoders washed the image grey). Only parts whose Civitai terms allow derivatives
# that carry their own permissions may go in (allowDerivatives + allowDifferentLicense, read 2026-11-20): Hale IL v19,
# WAI v17, PerfectDeliberate v10. NOT Bismuth or Illustrious XL 2.0 (a merge inherits their terms) or Prefect (no
# derivatives). The Illustrious base is under the Fair AI Public License 1.0-SD: a released copy ships its weights under it.
# The recipe, the parts' SHA-256 and the terms read ride in the output file's own metadata.
#
#   <ComfyUI venv>/bin/python -I scripts/merge-checkpoint.py <out.safetensors> "<title>" hale=0.8 wai=0.1 deliberate=0.1
#   v0.1 (deusneuma_characterXL_v0.1.safetensors, sha256 ff509539…) = hale=0.8 wai=0.1 deliberate=0.1
#   LIB: the folder holding the parts (default: the operator's ComfyUI library), set with NEUMA_MERGE_LIB.
import hashlib, json, os, sys
import torch
from safetensors import safe_open
from safetensors.torch import save_file

LIB = os.environ.get('NEUMA_MERGE_LIB', '/opt/ComfyUI/models/checkpoints/').rstrip('/') + '/'
PARTS = {
    'hale': ('novaAnimeXL_ilV190.safetensors', 'Hale Anime XL IL v19.0 (Crody, Civitai 376130)', 'fa486caafc330f133605d3c18b418d183812f14946631c6544bfb28730db6d6f'),
    'wai': ('waiIllustriousSDXL_v170.safetensors', 'WAI-illustrious-SDXL v17 (WAI0731, Civitai 827184)', 'f116b0c78ff441467b0cdc8f1936e1ed18ea31e9997c7b132b1b8db533f0bd04'),
    'deliberate': ('perfectdeliberate_v10.safetensors', 'PerfectDeliberate v10 (Desync, Civitai 24350)', 'cbba6875a194e16a0f9e7a812289221fb437d0ebdddf0d99a6876fd0e903ad8e'),
}
out_path, title, *spec = sys.argv[1:]
weights = {k: float(v) for k, v in (s.split('=') for s in spec)}
assert abs(sum(weights.values()) - 1) < 1e-6, f'weights must sum to 1: {weights}'
opened = {k: safe_open(LIB + PARTS[k][0], 'pt') for k in weights}
first = next(iter(weights))
out = {}
for key in opened[first].keys():
    t = opened[first].get_tensor(key)
    # The image model (UNet) only: the text encoders and the VAE stay the first part's, whole. perfectDeliberate's VAE is
    # a different decoder (mean |diff| 0.17 against Hale's, 0.0007 for WAI); averaging two decoders washed draft B grey.
    if key.startswith('model.diffusion_model.') and t.is_floating_point() and all(key in opened[k].keys() for k in weights):
        acc = None
        for k, w in weights.items():
            part = opened[k].get_tensor(key).float()
            assert part.shape == t.shape, (key, k)
            acc = part * w if acc is None else acc + part * w
        t = acc.to(torch.float16)
    out[key] = t.contiguous()
meta = {
    'modelspec.title': title,
    'neuma.recipe': json.dumps({'method': 'weighted sum of the image model (UNet); text encoders and VAE are the first part\'s, whole', 'made': '2026-11-20', 'by': 'Claude (claude-code) for Founder, Ignis AI Labs',
        'parts': [{'model': PARTS[k][1], 'sha256': PARTS[k][2], 'weight': w} for k, w in weights.items()]}),
    'neuma.terms_read': 'Every part on Civitai: allowDerivatives true, allowDifferentLicense true, allowCommercialUse includes Image (read 2026-11-20). Base family: Illustrious XL (its own licence sits underneath).',
}
save_file(out, out_path, metadata=meta)
h = hashlib.sha256()
with open(out_path, 'rb') as f:
    for chunk in iter(lambda: f.read(1 << 24), b''):
        h.update(chunk)
print(out_path, h.hexdigest())
