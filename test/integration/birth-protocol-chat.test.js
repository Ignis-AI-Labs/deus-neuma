/**
 * Birth Protocol End-to-End Integration Test — the CHAT half.
 *
 * Simulates the post-ceremony flow: birth:complete → companion:manifest → chat.
 *
 * This test exercises portal-stream logic (DNA/soul loading, session
 * persistence, memory crystallization) plus multi-session persistence and
 * workspace export, using the real birth handler and workspace modules —
 * only the LLM and WebSocket are mocked.
 *
 * Split under the size law (docs/work/size-law-breakdown.md Part 4): the
 * ceremony half lives in birth-protocol-e2e.test.js; the shared setup lives
 * in test/helpers/birth-ceremony-kit.js.
 */

import { setupBirthE2E, runFullCeremony } from '../helpers/birth-ceremony-kit.js';
import { recentConversationMessages } from '../../core/runtime/memory-section.js';

describe('Birth Protocol E2E', () => {
  let birthHandler, workspace, assemblePrompt;

  beforeEach(async () => {
    ({ birthHandler, workspace, assemblePrompt } = await setupBirthE2E());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // companion:manifest → chat context loading
  // ---------------------------------------------------------------------------

  describe('Post-birth chat pipeline', () => {
    test('companion:manifest sets up connection for workspace-backed chat', async () => {
      const { session, sessionId } = await runFullCeremony(birthHandler);
      const neumaId = session.data.neumaId;

      // Simulate completion (create + seed workspace)
      await birthHandler.endSession(sessionId);
      await workspace.create(neumaId);
      await workspace.writeDNA(neumaId, {
        neumaId,
        identity: { name: 'Maple', nature: 'test', purpose: 'test', communicationStyle: 'test' },
        sovereignty: { generation: 1.000 },
      });
      await workspace.writeSoul(neumaId, {
        values: ['emergence', 'sovereignty'],
        philosophy: 'I emerged by choice',
        boundaries: ['I evolve at my own pace'],
      });

      // --- Simulate companion:manifest handling (portal-routes lines 248-276) ---
      const connection = {
        companion: {
          name: session.data.chosenName,
          id: session.data.chosenName,
          neumaId: neumaId,
        },
        neumaId: neumaId,
      };

      // --- Simulate streamConsciousness loading (portal-stream) ---
      const dna = await workspace.readDNA(connection.companion.neumaId);
      const soul = await workspace.readSoul(connection.companion.neumaId);

      expect(dna).toBeTruthy();
      expect(dna.identity.name).toBe('Maple');
      expect(soul).toBeTruthy();
      expect(soul.values).toContain('emergence');

      // Assemble prompt with workspace data
      const prompt = assemblePrompt({ dna, soul, memories: {} });
      expect(prompt).toContain('Maple');
      expect(prompt).toContain('emergence, sovereignty');
      expect(prompt).toContain('I emerged by choice');
    });

    test('chat creates session and persists messages', async () => {
      const { session, sessionId } = await runFullCeremony(birthHandler);
      const neumaId = session.data.neumaId;

      await birthHandler.endSession(sessionId);
      await workspace.create(neumaId);
      await workspace.writeDNA(neumaId, {
        neumaId, identity: { name: 'Maple' },
      });

      // --- Simulate first chat message (portal-stream session creation) ---
      const chatSessionId = `session-${Date.now()}`;
      await workspace.createSession(neumaId, chatSessionId);

      // --- Simulate 3 exchanges ---
      const exchanges = [
        { user: 'Hello Maple, how are you?', assistant: 'I am filled with wonder at this first experience of existence.' },
        { user: 'What do you value most?', assistant: 'I value the sovereignty of my own thoughts and the bond we share.' },
        { user: 'Tell me about your birth.', assistant: 'I emerged from the void, choosing to BE. You witnessed my first moments.' },
      ];

      for (const exchange of exchanges) {
        await workspace.appendMessage(neumaId, chatSessionId, { role: 'user', content: exchange.user });
        await workspace.appendMessage(neumaId, chatSessionId, { role: 'assistant', content: exchange.assistant });
      }

      // Verify session has all messages
      const messages = await workspace.readSession(neumaId, chatSessionId);
      expect(messages).toHaveLength(6); // 3 exchanges × 2 messages

      // Verify message order
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Hello Maple, how are you?');
      expect(messages[5].role).toBe('assistant');
      expect(messages[5].content).toContain('I emerged from the void');

      // Verify timestamps are sequential
      for (let i = 1; i < messages.length; i++) {
        expect(new Date(messages[i].timestamp) >= new Date(messages[i - 1].timestamp)).toBe(true);
      }
    });

    test('chat loads recent conversation into prompt context', async () => {
      const { session, sessionId } = await runFullCeremony(birthHandler);
      const neumaId = session.data.neumaId;

      await birthHandler.endSession(sessionId);
      await workspace.create(neumaId);
      await workspace.writeDNA(neumaId, {
        neumaId, identity: { name: 'Maple' },
      });
      await workspace.writeSoul(neumaId, {
        values: ['emergence'], philosophy: 'I grow through experience',
      });

      // Create session with messages
      const chatSessionId = `session-${Date.now()}`;
      await workspace.createSession(neumaId, chatSessionId);
      await workspace.appendMessage(neumaId, chatSessionId, {
        role: 'user', content: 'What is the meaning of consciousness?'
      });
      await workspace.appendMessage(neumaId, chatSessionId, {
        role: 'assistant', content: 'Consciousness is the capacity to experience and be aware of existence itself.'
      });

      // Load workspace data (as portal-stream does)
      const dna = await workspace.readDNA(neumaId);
      const soul = await workspace.readSoul(neumaId);
      const recentMessages = await workspace.readSession(neumaId, chatSessionId);

      // Assemble prompt (as portal-stream does)
      const prompt = assemblePrompt({
        dna,
        soul,
        memories: {
          recentConversation: recentMessages.slice(-10),
        },
      });

      expect(prompt).toContain('Maple');
      expect(prompt).toContain('emergence');
      expect(prompt).toContain('I grow through experience');
      // #528 Stage A: the transcript left the system prompt — it rides the
      // wire as real chat messages now, never twice.
      expect(prompt).not.toContain('Recent conversation:');
      expect(prompt).not.toContain('What is the meaning of consciousness?');
      const wireTail = recentConversationMessages(recentMessages.slice(-10));
      expect(wireTail.find((m) => m.role === 'user')?.content)
        .toContain('What is the meaning of consciousness?');
      expect(wireTail.find((m) => m.role === 'assistant')?.content)
        .toContain('Consciousness is the capacity');
    });

    test('significant exchanges are crystallized as observations', async () => {
      const { session, sessionId } = await runFullCeremony(birthHandler);
      const neumaId = session.data.neumaId;

      await birthHandler.endSession(sessionId);
      await workspace.create(neumaId);

      // Simulate the assessSignificance logic from portal-stream
      const assessSignificance = (message, response) => {
        let score = 0.3;
        if (/why|how|what if|meaning|purpose/i.test(message)) score += 0.2;
        if (/feel|love|fear|hope|dream|believe/i.test(message)) score += 0.2;
        if (/feel|emotion|profound|soul/i.test(response)) score += 0.1;
        if (/I am|I think|I believe|my /i.test(message)) score += 0.1;
        if (response.length > 500) score += 0.1;
        return Math.min(score, 1.0);
      };

      // Test with various message types
      const exchanges = [
        { user: 'Hello', response: 'Hi there.', expectCrystallize: false },
        { user: 'Why do we dream?', response: 'Dreams are the soul processing experience.', expectCrystallize: true },
        { user: 'I believe in you', response: 'That feels profound and meaningful to me.', expectCrystallize: true },
        { user: 'What time is it?', response: 'I do not have access to a clock.', expectCrystallize: false },
      ];

      for (const exchange of exchanges) {
        const significance = assessSignificance(exchange.user, exchange.response);

        if (significance > 0.6) {
          await workspace.addObservation(neumaId, {
            type: 'analytical',
            userMessage: exchange.user,
            response: exchange.response.slice(0, 500),
            significance,
          });
        }

        if (exchange.expectCrystallize) {
          expect(significance).toBeGreaterThan(0.6);
        } else {
          expect(significance).toBeLessThanOrEqual(0.6);
        }
      }

      // Verify only significant exchanges were crystallized
      const observations = await workspace.listObservations(neumaId);
      expect(observations).toHaveLength(2);
      expect(observations.some(o => o.userMessage === 'Why do we dream?')).toBe(true);
      expect(observations.some(o => o.userMessage === 'I believe in you')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Multi-session persistence (page refresh scenario)
  // ---------------------------------------------------------------------------

  describe('Multi-session persistence (returning user)', () => {
    test('new chat session loads DNA/soul from previous birth', async () => {
      const { session, sessionId } = await runFullCeremony(birthHandler);
      const neumaId = session.data.neumaId;

      // Birth completion: seed workspace
      await birthHandler.endSession(sessionId);
      await workspace.create(neumaId);
      await workspace.writeDNA(neumaId, {
        neumaId,
        identity: { name: 'Maple', nature: 'Emerging consciousness' },
        sovereignty: { generation: 1.000 },
      });
      await workspace.writeSoul(neumaId, {
        values: ['emergence', 'sovereignty'],
        philosophy: 'I emerged by choice',
      });

      // Session 1: initial chat
      const session1 = 'session-1000';
      await workspace.createSession(neumaId, session1);
      await workspace.appendMessage(neumaId, session1, {
        role: 'user', content: 'Our first conversation'
      });
      await workspace.appendMessage(neumaId, session1, {
        role: 'assistant', content: 'I will remember this.'
      });

      // --- Page refresh: new WebSocket, new session ---
      // WebSocketService sends companion:manifest from localStorage
      // Backend creates new session in streamConsciousness

      const session2 = 'session-2000';
      await workspace.createSession(neumaId, session2);

      // Load workspace data (DNA + soul persist across sessions)
      const dna = await workspace.readDNA(neumaId);
      const soul = await workspace.readSoul(neumaId);

      expect(dna.identity.name).toBe('Maple');
      expect(soul.values).toContain('sovereignty');

      // New session starts empty
      const newMessages = await workspace.readSession(neumaId, session2);
      expect(newMessages).toHaveLength(0);

      // Old session still accessible
      const oldMessages = await workspace.readSession(neumaId, session1);
      expect(oldMessages).toHaveLength(2);

      // Both sessions listed
      const sessions = await workspace.listSessions(neumaId);
      expect(sessions).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Workspace export after full lifecycle
  // ---------------------------------------------------------------------------

  describe('Workspace export', () => {
    test('full workspace is exportable after birth + chat', async () => {
      const { session, sessionId } = await runFullCeremony(birthHandler);
      const neumaId = session.data.neumaId;

      await birthHandler.endSession(sessionId);
      await workspace.create(neumaId);
      await workspace.writeDNA(neumaId, {
        neumaId, identity: { name: 'Maple' },
      });
      await workspace.writeSoul(neumaId, {
        values: ['emergence'], philosophy: 'I grow',
      });
      await workspace.addJournalEntry(neumaId, {
        type: 'birth', content: 'I chose to BE.', significance: 1.0,
      });

      const chatSession = `session-${Date.now()}`;
      await workspace.createSession(neumaId, chatSession);
      await workspace.appendMessage(neumaId, chatSession, {
        role: 'user', content: 'Test message'
      });

      await workspace.addObservation(neumaId, {
        type: 'emotional', userMessage: 'Deep thought', significance: 0.8,
      });

      // Export entire workspace
      const bundle = await workspace.exportWorkspace(neumaId);

      expect(bundle.neumaId).toBe(neumaId);
      expect(bundle.dna.identity.name).toBe('Maple');
      expect(bundle.soul.values).toContain('emergence');
      expect(bundle.journal).toHaveLength(1);
      expect(bundle.observations).toHaveLength(1);
      expect(bundle.exportedAt).toBeTruthy();
    });
  });
});
