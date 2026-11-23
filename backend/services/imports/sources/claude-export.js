// The Claude.ai data export, read against the real one (docs/work/assistant-import.md, SLICE 2):
//   memories.json       [{conversations_memory, project_memories: {<project uuid>: text}}]
//   projects/<uuid>.json {uuid, name, description, prompt_template, docs: [{filename, content}]}
//   conversations.json  [{uuid, name, created_at, chat_messages: [{sender: human|assistant, created_at,
//                        text, content: [{type: text|tool_use|tool_result|thinking|voice_note|…}],
//                        attachments: [{file_name, extracted_content}], files: [{file_name}]}]}]
// users.json (name, email, phone) is account data and is not carried. impure (reads the export)
import { openExport, readJson } from '../export-files.js';
import { toolLine } from '../transcript.js';

const CONVERSATIONS_MAX = 500_000_000;
const PART_MAX = 200_000_000;

/** A Claude message as words: text, voice notes, tool lines, attached text in full. Pure. */
export const claudeMessageText = (m) => {
  const blocks = Array.isArray(m.content) && m.content.length ? m.content : [{ type: 'text', text: m.text || '' }];
  const parts = blocks.map((b) => {
    if (b.type === 'text' || b.type === 'voice_note') return b.text || '';
    if (b.type === 'tool_use') return toolLine(b.name, b.input, b.message);
    return '';
  }).filter(Boolean);
  for (const a of m.attachments || []) parts.push(`Attached ${a.file_name}:\n\n${a.extracted_content || '(no text for it in the export)'}`);
  for (const f of m.files || []) parts.push(`(a file was shared here, ${f.file_name}; the export does not include its contents)`);
  return parts.join('\n\n');
};

/**
 * Read a Claude export (its .zip or its folder). impure
 * @param {string} target
 */
export const readClaudeExport = async (target) => {
  const ex = await openExport(target);
  try {
    const memories = ex.has('memories.json') ? await readJson(ex, 'memories.json', PART_MAX) : [];
    const projectMemory = Object.assign({}, ...memories.map((m) => m.project_memories || {}));
    const projects = [];
    for (const name of ex.names.filter((n) => /^projects\/[^/]+\.json$/.test(n))) {
      const p = await readJson(ex, name, PART_MAX);
      projects.push({
        id: p.uuid, name: p.name || p.uuid, description: p.description || '', instructions: p.prompt_template || '',
        files: (p.docs || []).map((d) => ({ name: d.filename || d.uuid, text: d.content || '' })),
        memory: projectMemory[p.uuid] || '',
      });
    }
    const raw = ex.has('conversations.json') ? await readJson(ex, 'conversations.json', CONVERSATIONS_MAX) : [];
    return {
      kind: 'claude-export', label: 'Claude', root: target,
      aboutYou: memories.map((m) => m.conversations_memory).filter(Boolean)
        .map((text, i) => ({ name: i ? `claude-memory-${i + 1}.md` : 'claude-memory.md', text })),
      notes: [], persona: [], instructions: [], skills: [], scheduled: [], skipped: [],
      projects,
      conversations: raw.map((c) => ({
        id: c.uuid, title: c.name, started: c.created_at,
        messages: (c.chat_messages || []).map((m) => ({ who: m.sender === 'human' ? 'you' : 'assistant', at: m.created_at, text: claudeMessageText(m) })),
      })),
    };
  } finally {
    await ex.close();
  }
};
