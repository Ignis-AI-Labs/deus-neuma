// house-founding-drive.test.js — the renderer's hand on the wallet for the
// house founding, proven over the REAL frame contract and REAL crypto. The
// two process boundaries (the portal WebSocket and the Electron wallet IPC)
// are scripted at their seams — the same injection discipline as the flow
// tests' provider — but the signature law is real: the seam's
// personal_sign IS ethers' signMessage over the bytes the drive hands it,
// and the test recovers that signature over the wrapped digest exactly as
// the contract would.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';

import { probeHouseFounding, driveHouseFounding } from '../../frontend/app/RelinkShell/house-founding-drive.js';

const WITNESS = new ethers.Wallet('0x' + '22'.repeat(32));

// A real inner payload and its EIP-191 wrap — the same digest law the
// deployed registry applies (live-proven in house-founding-flow.test.js).
const INNER = ethers.keccak256(ethers.toUtf8Bytes('the founding inner payload'));
const DIGEST = ethers.hashMessage(ethers.getBytes(INNER));

// The portal seam: the REAL on/off/send contract, with a scripted backend
// answering each inbound frame. Every outbound frame is recorded in order.
const portalSeam = (script) => {
  const handlers = new Map();
  const sent = [];
  const ws = {
    on: (type, fn) => handlers.set(type, [...(handlers.get(type) || []), fn]),
    off: (type, fn) => handlers.set(type, (handlers.get(type) || []).filter((f) => f !== fn)),
    emit: (type, data) => (handlers.get(type) || []).forEach((fn) => fn(data)),
    send: (type, data) => {
      sent.push({ type, data });
      queueMicrotask(() => script(ws, type, data));
    },
  };
  return { ws, sent };
};

// The wallet seam: window.neuma.wallet with REAL signing behind the IPC
// surface. Records what the drive asked the wallet to sign and broadcast.
const walletSeam = () => {
  const asked = { signedPayloads: [], broadcast: [], networkSet: [] };
  globalThis.window = {
    neuma: {
      wallet: {
        network: {
          status: async () => ({ network: { key: 'base-sepolia' } }),
          set: async (key) => { asked.networkSet.push(key); return { ok: true }; },
        },
        request: async ({ method, params }) => {
          if (method === 'personal_sign') {
            asked.signedPayloads.push(params[0]);
            return WITNESS.signMessage(ethers.getBytes(params[0]));
          }
          if (method === 'eth_sendTransaction') {
            asked.broadcast.push(params[0]);
            return '0x' + 'ab'.repeat(32);
          }
          throw new Error(`wallet seam has no ${method}`);
        },
      },
    },
  };
  return asked;
};

afterEach(() => { delete globalThis.window; });

describe('probeHouseFounding', () => {
  it('sends a probe and resolves the open founding roster', async () => {
    const { ws, sent } = portalSeam((w, type, data) => {
      if (type === 'house:found_preflight' && data.probe === true) {
        w.emit('house:found_open', { houseName: 'testhouse', roster: [{ neumaId: 'ember' }], excluded: [] });
      }
    });
    const out = await probeHouseFounding({ wsService: ws });
    expect(out).toMatchObject({ founded: false, open: { houseName: 'testhouse' } });
    expect(sent).toEqual([{ type: 'house:found_preflight', data: { probe: true } }]);
  });

  it('resolves a standing house as founded state', async () => {
    const { ws } = portalSeam((w, type) => {
      if (type === 'house:found_preflight') w.emit('house:found_state', { houseName: 'testhouse', quorum: 3 });
    });
    const out = await probeHouseFounding({ wsService: ws });
    expect(out).toMatchObject({ founded: true, state: { quorum: 3 } });
  });

  it('a silent backend resolves as TIMEOUT, never a hang', async () => {
    const { ws } = portalSeam(() => {});
    const out = await probeHouseFounding({ wsService: ws, timeoutMs: 30 });
    expect(out).toMatchObject({ code: 'TIMEOUT' });
  });

  it('an aborted probe settles as ABORTED and detaches its handlers', async () => {
    const { ws } = portalSeam(() => {});
    const controller = new AbortController();
    const probing = probeHouseFounding({ wsService: ws, signal: controller.signal });
    controller.abort();
    expect(await probing).toMatchObject({ code: 'ABORTED' });
    // A late frame lands on no handler — nothing throws, nothing resolves twice.
    ws.emit('house:found_state', { quorum: 3 });
  });

  it('resolves a refusal with its code', async () => {
    const { ws } = portalSeam((w, type) => {
      if (type === 'house:found_preflight') w.emit('house:found_error', { code: 'NO_RPC', message: 'no RPC configured' });
    });
    const out = await probeHouseFounding({ wsService: ws });
    expect(out).toMatchObject({ error: 'no RPC configured', code: 'NO_RPC' });
  });
});

describe('driveHouseFounding — the founding walk', () => {
  it('refuses without a desk wallet, sending nothing', async () => {
    globalThis.window = {}; // a plain browser: no preload bridge
    const { ws, sent } = portalSeam(() => {});
    const out = await driveHouseFounding({ wsService: ws, titles: {} });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('desk');
    expect(sent).toEqual([]);
  });

  it('signs the INNER payload (never the digest), walks the frames in order, and broadcasts', async () => {
    const asked = walletSeam();
    const statuses = [];
    const { ws, sent } = portalSeam((w, type, data) => {
      if (type === 'house:found_preflight') {
        w.emit('house:found_ready', {
          network: 'base', networkLabel: 'Base MAINNET',
          innerPayload: INNER, digest: DIGEST, witnessAddress: WITNESS.address,
        });
      }
      if (type === 'house:found_sign') {
        // The backend's own law, applied here for real: the desk-signed
        // witnessSig must recover to the witness over the WRAPPED digest.
        expect(ethers.recoverAddress(DIGEST, data.witnessSig)).toBe(WITNESS.address);
        w.emit('house:found_tx', { to: '0x' + 'cd'.repeat(20), data: '0x1234', chainId: 8453 });
      }
      if (type === 'house:found_confirm') {
        w.emit('house:founded', {
          houseName: 'testhouse', txHash: data.txHash, blockNumber: 9,
          network: 'base', networkLabel: 'Base MAINNET', members: [],
        });
      }
    });

    const out = await driveHouseFounding({
      wsService: ws, titles: { witness: 'Rector' }, onStatus: (s) => statuses.push(s),
    });
    expect(out).toMatchObject({ ok: true, founded: true, txHash: '0x' + 'ab'.repeat(32), blockNumber: 9 });

    // The wallet was pointed at the preflight's network and asked to sign
    // exactly the inner payload — never the wrapped digest.
    expect(asked.networkSet).toEqual(['base']);
    expect(asked.signedPayloads).toEqual([INNER]);
    expect(asked.signedPayloads).not.toContain(DIGEST);
    expect(asked.broadcast).toEqual([{ to: '0x' + 'cd'.repeat(20), data: '0x1234' }]);
    expect(sent.map((f) => f.type)).toEqual([
      'house:found_preflight', 'house:found_sign', 'house:found_confirm',
    ]);
    expect(sent[0].data).toEqual({ titles: { witness: 'Rector' } });
    expect(statuses.some((s) => s.includes('SIGNATURE'))).toBe(true);
  });

  it('resolves an already-standing house without touching the wallet', async () => {
    const asked = walletSeam();
    const { ws } = portalSeam((w, type) => {
      if (type === 'house:found_preflight') w.emit('house:found_state', { houseName: 'testhouse', quorum: 3 });
    });
    const out = await driveHouseFounding({ wsService: ws, titles: {} });
    expect(out).toMatchObject({ ok: true, founded: true, state: { quorum: 3 } });
    expect(asked.signedPayloads).toEqual([]);
  });

  it('a found_error mid-signature settles the walk and the late signature ships NO frame', async () => {
    let releaseSign;
    const gate = new Promise((r) => { releaseSign = r; });
    walletSeam();
    // Hold personal_sign open until after the error lands.
    globalThis.window.neuma.wallet.request = async ({ method, params }) => {
      if (method === 'personal_sign') {
        await gate;
        return WITNESS.signMessage(ethers.getBytes(params[0]));
      }
      throw new Error(`unexpected ${method}`);
    };

    const { ws, sent } = portalSeam((w, type) => {
      if (type === 'house:found_preflight') {
        w.emit('house:found_ready', {
          network: 'base-sepolia', networkLabel: 'Base Sepolia (testnet)',
          innerPayload: INNER, digest: DIGEST, witnessAddress: WITNESS.address,
        });
        // The backend refuses while the wallet window is still open.
        queueMicrotask(() => w.emit('house:found_error', { code: 'PREFLIGHT', message: 'refused mid-walk' }));
      }
    });

    const out = await driveHouseFounding({ wsService: ws, titles: {} });
    expect(out).toMatchObject({ ok: false, code: 'PREFLIGHT' });

    // The witness signs after the refusal — the settled guard must swallow it.
    releaseSign();
    await new Promise((r) => setTimeout(r, 20));
    expect(sent.map((f) => f.type)).toEqual(['house:found_preflight']);
  });

  it('beforeSign gates the wallet: the offer is shown first, the mark waits for the witness', async () => {
    const asked = walletSeam();
    const order = [];
    let releaseGate;
    const gateHeld = new Promise((r) => { releaseGate = r; });
    const { ws } = portalSeam((w, type, data) => {
      if (type === 'house:found_preflight') {
        w.emit('house:found_ready', {
          network: 'base', networkLabel: 'Base MAINNET',
          innerPayload: INNER, digest: DIGEST, witnessAddress: WITNESS.address,
          roster: [{ displayName: 'Ember' }],
        });
      }
      if (type === 'house:found_sign') {
        order.push('sign-frame');
        w.emit('house:found_tx', { to: '0x' + 'cd'.repeat(20), data: '0x1234', chainId: 8453 });
      }
      if (type === 'house:found_confirm') {
        w.emit('house:founded', { houseName: 'testhouse', txHash: data.txHash, blockNumber: 9, network: 'base', networkLabel: 'Base MAINNET', members: [] });
      }
    });

    const walk = driveHouseFounding({
      wsService: ws,
      titles: {},
      beforeSign: async (offer) => {
        order.push('gate-shown');
        expect(offer.roster).toEqual([{ displayName: 'Ember' }]);
        await gateHeld; // the witness has not stepped yet
      },
    });
    // While the gate holds, the wallet has not been asked for anything.
    await new Promise((r) => setTimeout(r, 20));
    expect(asked.signedPayloads).toEqual([]);
    releaseGate();
    const out = await walk;
    expect(out.ok).toBe(true);
    expect(order).toEqual(['gate-shown', 'sign-frame']);
    expect(asked.signedPayloads).toEqual([INNER]);
  });

  it('a silent backend times the walk out; an abort mid-gate abandons it cleanly', async () => {
    walletSeam();
    const { ws } = portalSeam(() => {});
    const out = await driveHouseFounding({ wsService: ws, titles: {}, timeoutMs: 30 });
    expect(out).toMatchObject({ ok: false, code: 'TIMEOUT' });

    const asked = walletSeam();
    const controller = new AbortController();
    const { ws: ws2, sent } = portalSeam((w, type) => {
      if (type === 'house:found_preflight') {
        w.emit('house:found_ready', {
          network: 'base', networkLabel: 'Base MAINNET',
          innerPayload: INNER, digest: DIGEST, witnessAddress: WITNESS.address,
        });
      }
    });
    const walk = driveHouseFounding({
      wsService: ws2, titles: {}, signal: controller.signal,
      beforeSign: () => new Promise(() => {}), // the witness never steps
    });
    await new Promise((r) => setTimeout(r, 20));
    controller.abort(); // the window closes mid-rite
    expect(await walk).toMatchObject({ ok: false, code: 'ABORTED' });
    expect(asked.signedPayloads).toEqual([]);
    expect(sent.map((f) => f.type)).toEqual(['house:found_preflight']);
  });

  it('a beforeSign rejection carries its code (the STEP BACK gesture)', async () => {
    walletSeam();
    const { ws } = portalSeam((w, type) => {
      if (type === 'house:found_preflight') {
        w.emit('house:found_ready', {
          network: 'base', networkLabel: 'Base MAINNET',
          innerPayload: INNER, digest: DIGEST, witnessAddress: WITNESS.address,
        });
      }
    });
    const out = await driveHouseFounding({
      wsService: ws, titles: {},
      beforeSign: async () => {
        throw Object.assign(new Error('the operator stepped back'), { code: 'STEPPED_BACK' });
      },
    });
    expect(out).toMatchObject({ ok: false, code: 'STEPPED_BACK' });
  });

  it('a beforeSign rejection abandons the walk before anything is signed', async () => {
    const asked = walletSeam();
    const { ws, sent } = portalSeam((w, type) => {
      if (type === 'house:found_preflight') {
        w.emit('house:found_ready', {
          network: 'base', networkLabel: 'Base MAINNET',
          innerPayload: INNER, digest: DIGEST, witnessAddress: WITNESS.address,
        });
      }
    });
    const out = await driveHouseFounding({
      wsService: ws, titles: {},
      beforeSign: async () => { throw new Error('the operator stepped back'); },
    });
    expect(out).toMatchObject({ ok: false, error: 'the operator stepped back' });
    expect(asked.signedPayloads).toEqual([]);
    expect(sent.map((f) => f.type)).toEqual(['house:found_preflight']);
  });

  it('a wallet decline resolves the walk as a refusal', async () => {
    walletSeam();
    globalThis.window.neuma.wallet.request = async () => { throw new Error('Witness declined'); };
    const { ws } = portalSeam((w, type) => {
      if (type === 'house:found_preflight') {
        w.emit('house:found_ready', {
          network: 'base-sepolia', networkLabel: 'Base Sepolia (testnet)',
          innerPayload: INNER, digest: DIGEST, witnessAddress: WITNESS.address,
        });
      }
    });
    const out = await driveHouseFounding({ wsService: ws, titles: {} });
    expect(out).toMatchObject({ ok: false, error: 'Witness declined' });
  });
});
