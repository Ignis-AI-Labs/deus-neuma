# design — skill pack

The design bench: conceptualize before code. A front-end piece — a new
container, a redesign, a restyle — is first rendered as 2-4 real HTML
variations on one contact sheet the operator opens in a browser. The
operator names the winner. Only then is a real component touched — the
winning variant is the spec, the losers stay in the scratch folder, and no
remnant of an unratified concept ever reaches the tree.

## Contents

| Skill | Summon | What it drives |
|-------|--------|----------------|
| `design-variations` | `/design-variations` (or via `use_skill`) | The variations loop: 2-4 LINE & CYCLE-bound HTML variants + a contact sheet under `designs/<slug>/`, the operator's ratification, then implementation from the winner |

## Requirements

The skill is methodology; the capability is any file-capable agent or being
with a workspace. Nothing platform-specific is required: variations are
self-contained HTML opened in a browser (`file://` or any one-line static
server). When the work concerns the NEUMA desk itself, the variants bind to
`line-and-cycle.md` (shipped beside the skill), the distilled law of
`docs/design/DESIGN_LANGUAGE.md` and `frontend/styles/tokens.css`.

## Doctrine

- **Seen before built.** No real component is written, edited, or restyled
  from an idea alone. The operator judges rendered variations, never
  descriptions of variations.
- **Ratification is a word.** The operator names a variant ("two", "the
  grid one") — that word is the lock. Everything else stays scratch.
- **Scratch stays scratch.** `designs/` is gitignored scratch. The winners
  graduate into real code by being PORTED, not by moving files.
- **On-language or on the table.** A variant that breaks LINE & CYCLE on
  purpose is allowed — but it is labeled an exploration, and ratifying it
  means amending the language, not smuggling a style.

## Attribution

The variations-loop methodology is adapted from
[baoyu-design](https://github.com/JimLiu/baoyu-design) by Jim Liu (刘宇),
used under the MIT License (copyright 2026 Jim Liu). NEUMA's adaptation is
the loop itself bound to LINE & CYCLE and the house's ratification doctrine;
the upstream project carries the full design engine (decks, mobile,
import/export) this pack deliberately does not copy.

> MIT License — Copyright (c) 2026 Jim Liu 刘宇
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.
