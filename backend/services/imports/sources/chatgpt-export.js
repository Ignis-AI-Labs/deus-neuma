// The ChatGPT data export (Settings → Data controls → Export data). UNVERIFIED against a real export
// until one is run through it (docs/work/assistant-import.md): built to its published shape —
//   conversations.json [{conversation_id, title, create_time (epoch s), current_node, gizmo_id?,
//                       mapping: {<node id>: {parent, children, message?: {author: {role}, create_time,
//                       recipient, content: {content_type, parts?, text?}, metadata}}}}]
// The visible thread is the path from current_node back to the root (edits and regenerations are
// branches beside it). A conversation inside a ChatGPT project carries a gizmo_id starting "g-p-"; the
// export does not name projects, so the id is what the index shows. user.json (account data) and the
// images are not carried. impure (reads the export)
import { openExport, readJson } from '../export-files.js';
import { toolLine } from '../transcript.js';

const CONVERSATIONS_MAX = 500_000_000;

const partText = (p) => {
  if (typeof p === 'string') return p;
  if (p?.content_type === 'image_asset_pointer') return '(an image was here; the page does not carry it)';
  return typeof p?.text === 'string' ? p.text : '';
};

/** One mapping node's message as words, or null when it is not part of the visible talk. Pure. */
export const chatgptMessage = (msg) => {
  const role = msg?.author?.role;
  if (role !== 'user' && role !== 'assistant') return null;
  if (msg.metadata?.is_visually_hidden_from_conversation) return null;
  const content = msg.content || {};
  if (role === 'assistant' && msg.recipient && msg.recipient !== 'all') {
    return { who: 'assistant', at: msg.create_time ? msg.create_time * 1000 : null, text: toolLine(msg.recipient, content.text ?? (content.parts || []).map(partText).join(' ')) };
  }
  const text = Array.isArray(content.parts) ? content.parts.map(partText).filter(Boolean).join('\n\n') : String(content.text || '');
  if (!text.trim()) return null;
  return { who: role === 'user' ? 'you' : 'assistant', at: msg.create_time ? msg.create_time * 1000 : null, text };
};

/** The visible thread of one conversation, first message first. Pure. */
export const chatgptThread = (conv) => {
  const out = [];
  const seen = new Set();
  for (let id = conv.current_node; id && conv.mapping?.[id] && !seen.has(id); id = conv.mapping[id].parent) {
    seen.add(id);
    const m = conv.mapping[id].message ? chatgptMessage(conv.mapping[id].message) : null;
    if (m) out.push(m);
  }
  return out.reverse();
};

/** Read a ChatGPT export (its .zip or its folder). impure */
export const readChatgptExport = async (target) => {
  const ex = await openExport(target);
  try {
    const raw = await readJson(ex, 'conversations.json', CONVERSATIONS_MAX);
    return {
      kind: 'chatgpt-export', label: 'ChatGPT', root: target,
      aboutYou: [], notes: [], persona: [], instructions: [], skills: [], projects: [], scheduled: [], skipped: [],
      conversations: raw.map((c) => ({
        id: c.conversation_id || c.id, title: c.title, started: c.create_time ? c.create_time * 1000 : null,
        project: typeof c.gizmo_id === 'string' && c.gizmo_id.startsWith('g-p-') ? c.gizmo_id : null,
        messages: chatgptThread(c),
      })),
    };
  } finally {
    await ex.close();
  }
};
