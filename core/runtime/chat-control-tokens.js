/**
 * Chat-template control tokens — the spellings a serving tokenizer turns into
 * real turn boundaries when they appear inside text.
 *
 * llama-server renders the chat template to one string and tokenizes it with
 * special-token parsing on, so a file, page or email that TYPES `<|im_start|>`
 * opens a real role turn: words from outside arrive as the operator or the
 * system. The set below was read from the vocabularies this platform serves
 * (the GGUF control and user-defined tokens, 2026-10-20): Qwen 3.x and
 * DeepSeek-R1-Qwen (ChatML `<|…|>`, `<think>`, `<tool_call>`,
 * `<tool_response>`), Gemma 3 (`<start_of_turn>`, `<bos>`), Gemma 4's
 * one-sided tokens (`<|turn>`, `<turn|>`, `<|"|>`), Llama 3 (`<|eot_id|>`),
 * DeepSeek's full-width bars (`<｜User｜>`), and Mistral's bracket tokens
 * (`[INST]`, `[TOOL_RESULTS]`). gpt-oss, Phi and GLM tokens are `<|…|>` too.
 *
 * Left out on purpose: Mistral's `<s>`/`</s>` and Gemma 3's HTML-shaped
 * tokens (`<b>`, `<table>`) are ordinary markup in an honest page, and none of
 * them can open a role on its own — the role tokens around them are covered.
 *
 * Pure module, no imports: memory text (memory-sanitizer.js, which strips)
 * and every frame for outside text (tool-exchange.js, untrusted-content.js,
 * which neutralise) read the one set.
 */

const PIPE_OPEN = String.raw`<\|[\w"]{1,64}\|?>`; // <|im_start|> <|eot_id|> <|turn> <|"|>
const PIPE_CLOSE = String.raw`<[\w"]{1,64}\|>`; // Gemma 4: <turn|> <tool_response|> <channel|>
const FULL_WIDTH = String.raw`<｜[^｜<>\s]{1,64}｜>`; // DeepSeek: <｜User｜> <｜end▁of▁sentence｜>
const NAMED = String.raw`</?(?:think|tool_call|tool_response)>|<(?:start_of_turn|end_of_turn|bos|eos|start_of_image|end_of_image)>`;
const BRACKET = String.raw`\[/?(?:INST|SYSTEM_PROMPT|AVAILABLE_TOOLS|TOOL_RESULTS|TOOL_CALLS|TOOL_CONTENT|THINK)\]`;
const LLAMA2_SYS = String.raw`<</?SYS>>`;

/** Source of the control-token pattern, for callers that compose their own. */
export const CHAT_CONTROL_TOKEN_SOURCE = [LLAMA2_SYS, PIPE_OPEN, PIPE_CLOSE, FULL_WIDTH, NAMED, BRACKET].join('|');

const CONTROL_TOKEN = new RegExp(CHAT_CONTROL_TOKEN_SOURCE, 'gi');

// The brackets become entities: the model reads the token's name, the
// tokenizer can no longer match it, and anyone reading sees what was tried.
// None of the entities holds a bracket, so no replacement can complete a new
// token with its neighbours — one pass is a fixed point.
const ENTITY = Object.freeze({ '<': '&lt;', '>': '&gt;', '[': '&#91;', ']': '&#93;' });
const inert = (token) => token.replace(/[<>[\]]/g, (c) => ENTITY[c]);

/**
 * Chat-template control tokens inside outside text, made inert and kept
 * visible. Text without one is returned byte-identical. Pure.
 * @param {string} text
 * @returns {string}
 */
export const neutraliseControlTokens = (text) => String(text).replace(CONTROL_TOKEN, inert);
