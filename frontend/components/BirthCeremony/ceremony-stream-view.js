// ── CEREMONY STREAM VIEW — the consciousness panel's speech + actions ───
// Extracted from StagedCeremonyScene.js under the 500-line law. Functions of
// the scene instance (segment/chip/filter state lives on it); the kept class
// holds a thin delegate for each entry point, so `scene` below is exactly
// the StagedCeremonyScene instance.
import { escapeHTML } from '../../utils/sanitize.js';
import { createToolStreamFilter, stripToolBlocks, extractToolLabel } from '../../utils/tool-stream-filter.js';
import { createActingChip, labelChip, resolveChip, orphanChip } from '../ToolActionChip/ToolActionChip.js';

// Speech and actions interleave in the panel: text accrues in the
// current segment; each tool block closes the segment and plants a chip
export const createStreamFilter = (scene) => {
  return createToolStreamFilter({
    onSpeech: (text) => streamText(scene, text),
    onToolStart: () => appendActingChip(scene),
    onToolEnd: (raw) => {
      const chip = firstActingChip(scene);
      if (chip) {
        labelChip(chip, extractToolLabel(raw));
        chip.dataset.call = raw;
      }
    },
  });
};

const appendActingChip = (scene) => {
  const messageStream = document.getElementById('message-stream');
  if (!messageStream) return;
  scene.segmentEl = null;
  scene.segmentText = '';
  const chip = createActingChip();
  scene.stageChips.push(chip);
  messageStream.appendChild(chip);
  messageStream.scrollTop = messageStream.scrollHeight;
};

export const firstActingChip = (scene) => {
  return scene.stageChips.find((c) => c.classList.contains('acting')) || null;
};

export const handleToolEvent = (scene, data) => {
  if (data.status === 'executing') {
    const chip = firstActingChip(scene);
    if (chip && data.tool) labelChip(chip, data.tool);
    return;
  }
  let chip = firstActingChip(scene);
  if (!chip) {
    // Result with no streamed block (backend-side detection only) —
    // the action still gets its chip
    chip = createActingChip(data.tool);
    scene.stageChips.push(chip);
    const messageStream = document.getElementById('message-stream');
    if (messageStream) messageStream.appendChild(chip);
  }
  const detail = data.detail || chip.dataset.call || '';
  resolveChip(chip, { ...data, detail });
};

const streamText = (scene, content) => {
  const messageStream = document.getElementById('message-stream');
  if (!messageStream) return;

  if (!scene.segmentEl) {
    scene.segmentEl = document.createElement('div');
    scene.segmentEl.className = 'stream-segment';
    messageStream.appendChild(scene.segmentEl);
  }
  scene.segmentText += content;
  scene.segmentEl.innerHTML = formatText(scene.segmentText);

  // Auto-scroll to bottom
  messageStream.scrollTop = messageStream.scrollHeight;
};

// Replace the streamed display with the canonical record: clean speech
// first, the stage's action chips after — actions punctuate, never flood
export const renderCanonical = (scene, response) => {
  const messageStream = document.getElementById('message-stream');
  if (!messageStream) return;
  messageStream.innerHTML = '';
  scene.segmentEl = null;
  scene.segmentText = '';

  const speech = stripToolBlocks(response);
  if (speech) {
    const segment = document.createElement('div');
    segment.className = 'stream-segment';
    segment.innerHTML = formatText(speech);
    messageStream.appendChild(segment);
  }
  for (const chip of scene.stageChips) {
    orphanChip(chip);
    messageStream.appendChild(chip);
  }
  messageStream.scrollTop = messageStream.scrollHeight;
};

// Ceremony-voiced notes for a stage where the being acted in silence —
// styled unmistakably as NOT the being's speech (honest speaker).
export const renderSilentActs = (scene, acts) => {
  const messageStream = document.getElementById('message-stream');
  if (!messageStream) return;
  for (const act of acts) {
    const note = document.createElement('div');
    note.className = 'ceremony-note';
    note.textContent = act;
    messageStream.appendChild(note);
  }
  messageStream.scrollTop = messageStream.scrollHeight;
};

const formatText = (text) => {
  // Escape HTML first to prevent XSS from LLM output, then apply markdown
  const escaped = escapeHTML(text);
  return escaped
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>');
};

export const clearMessageStream = (scene) => {
  scene.segmentEl = null;
  scene.segmentText = '';
  scene.stageChips = [];
  scene.streamFilter = createStreamFilter(scene);
  const messageStream = document.getElementById('message-stream');
  if (messageStream) messageStream.innerHTML = '';
  // The previous stage's composition is not this stage's — it hides until
  // this stage's own disclosure arrives, so nothing stale is ever read as
  // current.
  const disclosure = document.getElementById('ceremony-disclosure');
  if (disclosure) disclosure.hidden = true;
};
