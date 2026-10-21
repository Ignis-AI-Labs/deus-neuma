// ignite-asks-first — IGNITE on a house that runs on Ollama or a cloud
// provider is a QUESTION on the desk, never a silent switch (the 2026-10-19
// ruling). The platform answers `switch-unconfirmed`; the client turns that
// into an ask, and the model bar renders the question with the operator's two
// answers. Real functions, real inputs, the real component rendered to markup.
// The route's own refusal is proven over HTTP in api-substrate-models.test.js.

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { igniteAnswer } from '../../frontend/app/RelinkShell/substrate-client.js';
import { IgniteSwitchAsk, switchQuestion } from '../../frontend/app/RelinkShell/IgniteSwitchAsk.jsx';

describe('igniteAnswer reads the platform answer for the bar', () => {
  it('a house on another provider comes back as a question carrying the model to re-send', () => {
    expect(igniteAnswer(false, { status: 'switch-unconfirmed', from: 'ollama' }, 'pub/beta/beta'))
      .toEqual({ ok: false, ask: { from: 'ollama', model: 'pub/beta/beta' } });
    expect(igniteAnswer(false, { status: 'switch-unconfirmed' }))
      .toEqual({ ok: false, ask: { from: 'another provider', model: null } });
  });

  it('every other answer keeps its old shape', () => {
    expect(igniteAnswer(true, { status: 'igniting' })).toEqual({ ok: true, status: 'igniting' });
    expect(igniteAnswer(false, { status: 'busy' }).error).toMatch(/mid-generation/);
    expect(igniteAnswer(false, { error: 'Invalid model key' })).toEqual({ ok: false, error: 'Invalid model key' });
    expect(igniteAnswer(false, {})).toEqual({ ok: false, error: 'Ignition failed.' });
  });
});

describe('the bar puts the switch to the operator', () => {
  it('names the provider, the move and that it is saved', () => {
    expect(switchQuestion('ollama'))
      .toBe('THIS HOUSE RUNS ON OLLAMA. IGNITE SWITCHES IT TO THE LOCAL LLAMA-SERVER AND SAVES THAT.');
  });

  it('renders the question with SWITCH AND IGNITE and KEEP <provider>', () => {
    const html = renderToStaticMarkup(createElement(IgniteSwitchAsk, {
      ask: { from: 'openai', model: null }, locked: false, onConfirm: () => {}, onCancel: () => {},
    }));
    expect(html).toContain('THIS HOUSE RUNS ON OPENAI.');
    expect(html).toContain('>SWITCH AND IGNITE</button>');
    expect(html).toContain('>KEEP OPENAI</button>');
    expect(html).not.toContain('disabled');
  });

  it('holds both answers while the bar is busy', () => {
    const html = renderToStaticMarkup(createElement(IgniteSwitchAsk, {
      ask: { from: 'ollama', model: null }, locked: true, onConfirm: () => {}, onCancel: () => {},
    }));
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
