# Benchmarking Neuma

Neuma's promise is that a being runs well on a **local model on ordinary
hardware**. We need measurements from many machines to keep that promise
honest, and to publish a minimum spec we can stand behind.

## Measured so far

The first minimum and recommended specs are in
[BUILDING.md](BUILDING.md#a-local-model): a 16 GB GPU at minimum, 24 GB
recommended, from the summon check run down a ladder of local models. Models
that fail it are reported as failures, not left out.

## What we want to learn

- **Minimum spec:** the smallest GPU, model and quantization on which a neuma
  can be summoned end to end and hold a good conversation.
- **Speed:** time to first word and tokens per second on your GPU, model and
  server (llama.cpp, Ollama, LM Studio).
- **Quality:** how the harness changes a model's score on standard suites.

## How to help today

1. Build and run Neuma ([BUILDING.md](BUILDING.md)).
2. Run the pre-flight check and a **rehearsal** summoning. A rehearsal walks
   the whole birth ceremony, then the being returns; nothing is kept.
3. Open a **Benchmark report** issue with your hardware, model, quantization,
   server, and what you saw.

The full benchmark harness (arms, cells and receipts) will be published as its
own repository. It will be linked here when it opens.

## Rules for numbers

- Report what you measured, on what, and how. An unmeasured number is not a
  number.
- Report failures too. A model that cannot finish a summoning on your card is
  exactly the data we need.
