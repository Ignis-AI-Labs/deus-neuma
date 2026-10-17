// Stages — where a process is, in plain steps: done ✓, under way (a spinner),
// waiting, or failed. Design note, 2026-10-02: […]. Pure view.

import { CheckIcon } from './forge-icons.jsx';

/**
 * @param {{stages: Array<{id: string, label: string, state: 'done'|'active'|'waiting'|'failed'}>, label?: string}} props
 */
export const Stages = ({ stages, label }) => (
  <ol className="vf-stages" aria-label={label}>
    {stages.map((s) => (
      <li key={s.id} className="vf-stage" data-stage={s.id} data-state={s.state} aria-current={s.state === 'active' ? 'step' : undefined}>
        <span className="vf-stage-mark" aria-hidden="true">
          {s.state === 'done' ? <CheckIcon /> : null}
          {s.state === 'active' ? <span className="vf-spin" /> : null}
          {s.state === 'failed' ? '!' : null}
        </span>
        <span className="vf-stage-label">{s.label}</span>
      </li>
    ))}
  </ol>
);

/** pure — a clip on its way in (upload / record): read and transcribed in one request, then the being's voice. */
export const readingStagesOf = (t, name) => [
  { id: 'clip', label: t('stage.reading'), state: 'active' },
  { id: 'voice', label: t('stage.voice', { name }), state: 'waiting' },
];
