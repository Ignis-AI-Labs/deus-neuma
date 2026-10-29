/**
 * RENDER_CARD — the being's own hand, through the REAL dispatch path.
 *
 * No mock anywhere (RULE 0). The tool is driven by the REAL `handleImageTool`
 * that both seats call, against the REAL brands and templates on disk, the
 * REAL `renderCardSvg`, the REAL `collectOutputs` store, and a REAL Chromium
 * rasterisation — the same one `scripts/render-card.mjs` runs.
 *
 * Metidar, from inside its sandbox (2026-08-29), found ImageMagick's SVG
 * delegate pointing at an uninstalled `rsvg-convert`, sampled the pixels, and
 * proved the text was being dropped silently. It asked for a renderer and the
 * fonts. This is the answer: not a second renderer per sandbox, but the
 * platform's one, reachable from a turn — and landing where the being can
 * actually SEE it, which is the half of the loop it could not close.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, statSync, readFileSync } from 'fs';
import path from 'path';
import { handleImageTool, IMAGE_TOOLS, isImageTool, cardToolsFor } from '../../backend/services/image-forge/image-being-tools.js';
import { resolveImage } from '../../backend/services/image-forge/image-store.js';
import { renderCardForLane, describeCards, chromiumRasterize, groundCardName } from '../../backend/services/branding/card-tool.js';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import { sendToolEvent } from '../../backend/services/portal-tools/tool-events.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { GLOBAL_DEFAULTS } from '../../backend/services/tool-policy.js';

const LANE = 'cardlane';
let dir; let priorStore; let kit;

const connectionFor = (laneId) => ({
  ...kit.connection,
  companion: { neumaId: laneId, name: 'Metidar' },
  _sessionToolPolicy: null,
  activeTurn: null,
});
const ports = () => ({ sendToolEvent });

const call = (args, laneId = LANE) => handleImageTool(
  kit.ws, connectionFor(laneId), null, 'act', { toolName: 'render_card' }, args, ports(),
);

beforeEach(async () => {
  kit = await createHarnessTurnKit(LANE);
  dir = kit.root;
  priorStore = process.env.COMFYUI_IMAGE_STORE_DIR;
  process.env.COMFYUI_IMAGE_STORE_DIR = path.join(dir, 'store');
});

afterEach(async () => {
  if (priorStore === undefined) delete process.env.COMFYUI_IMAGE_STORE_DIR;
  else process.env.COMFYUI_IMAGE_STORE_DIR = priorStore;
  await kit?.close();
});

describe('the tool is really advertised and really gated', () => {
  test('render_card advertises DECOUPLED from the diffusion engine (ruling, 2026-09-03)', () => {
    // NOT in IMAGE_TOOLS anymore: the SVG card infrastructure is its own
    // rendering system, and a house without ComfyUI still designs cards.
    expect(IMAGE_TOOLS.map((t) => t.name)).not.toContain('render_card');
    // The dispatch + policy identity stay in the family (routing, not gating).
    expect(isImageTool({ toolName: 'render_card' })).toBe(true);
    // ALLOWED, not approval-gated: deterministic, local, and it touches
    // nothing in the world. Publishing is still the queue's own gate.
    expect(GLOBAL_DEFAULTS.image.allowed).toContain('render_card');
    expect(GLOBAL_DEFAULTS.image.requireApproval || []).not.toContain('render_card');
  });

  test('the card tool advertises for any lane, engine or no engine', () => {
    expect(cardToolsFor({ companion: { neumaId: 'sodelight' } }).map((t) => t.name)).toContain('render_card');
    expect(cardToolsFor({ companion: {} })).toEqual([]);
    expect(cardToolsFor(null)).toEqual([]);
  });

  test('the being that asks with no template is TOLD the surface, not refused', async () => {
    const out = await call({});
    expect(out.status).toBe('ok');
    expect(out.content).toContain('BRANDS: ignis, umbrae');
    expect(out.content).toContain('milestone (1600x900)');
    // The exact limits, so a being never has to guess and then be refused.
    expect(out.content).toContain('at most 12 characters');
    expect(out.content).toContain('LIVE FIGURES for {stat}');
  });

  test('the surface describes every template that ships', async () => {
    const text = await describeCards();
    for (const name of ['milestone', 'stat', 'announcement']) expect(text).toContain(name);
  });
});

describe('a real card, rendered by the real pipeline, filed in the real lane', () => {
  test('it renders, it lands, and the being is handed SIGHT of it', async () => {
    const out = await renderCardForLane({
      laneId: LANE,
      laneDir: path.join(dir, 'store', LANE),
      rasterize: chromiumRasterize,
      args: {
        brand: 'umbrae',
        template: 'milestone',
        data: {
          eyebrow: 'MILESTONE',
          value: '$100K',
          label: 'claimed by users providing liquidity',
          asOf: '2026-08-28T15:00:00Z',
        },
      },
    });
    expect(out.ok, JSON.stringify(out.errors)).toBe(true);

    // The card is a real PNG of real size — not a zero-byte file that only
    // looks like success.
    const found = resolveImage(LANE, out.imageId);
    expect(found.ok).toBe(true);
    expect(existsSync(found.path)).toBe(true);
    expect(statSync(found.path).size).toBeGreaterThan(20_000);
    expect(found.record.mime).toBe('image/png');
    // It is filed against the card that made it, so a later reader can join
    // the render to the template it came from.
    expect(found.record.jobId).toBe('card:umbrae/milestone');
  }, 60000);

  test('the sight contract is returned, so the next round actually shows it', async () => {
    // This is the half Metidar could not close from a sandbox whose own
    // writes its file reader cannot see.
    const out = await renderCardForLane({
      laneId: LANE,
      laneDir: path.join(dir, 'store', LANE),
      rasterize: chromiumRasterize,
      args: {
        template: 'announcement',
        data: {
          eyebrow: 'NOW LIVE', lineOne: 'Partial', lineTwo: 'withdrawals',
          support: 'Withdraw part of your holdings any time.',
        },
      },
    });
    expect(out.ok).toBe(true);
    expect(resolveImage(LANE, out.imageId).ok).toBe(true);
  });
});

describe('refuse, never deform — through the tool, in the being\'s own words', () => {
  const bad = (args) => call(args);

  test('an over-long line is refused with the exact count, and NOTHING is filed', async () => {
    const out = await bad({
      template: 'milestone',
      data: {
        eyebrow: 'MILESTONE',
        value: '$100,000,000,000',
        label: 'claimed by users',
        asOf: '2026-08-28T15:00:00Z',
      },
    });
    expect(out.status).toBe('error');
    // ⚠️ TEN, not twelve — and this test is why the number is written down in
    // two places. `milestone.json` cut the budget 12 → 10 when the figure grew
    // for mobile legibility ([…]),
    // and this reader was not swept, so it sat red until somebody ran the
    // integration lane. The budget lives in the template; this only echoes it.
    expect(out.error).toContain('"value" is 16 characters and this template holds 10');
    expect(out.error).toContain('That card was not drawn');
    // Nothing reached the lane — there is no half-card to attach by mistake.
    expect(resolveImage(LANE, 'anything').ok).toBe(false);
  });

  test('a misspelled field names the fields that exist', async () => {
    const out = await bad({
      template: 'milestone',
      data: { eyebrow: 'X', value: '$1', labl: 'typo', asOf: 'now' },
    });
    expect(out.status).toBe('error');
    expect(out.error).toContain('"labl" is not a field of this template');
    expect(out.error).toContain('eyebrow, value, label, asOf');
  });

  test('an unknown template and an unknown brand each name themselves', async () => {
    expect((await bad({ template: 'poster' })).error).toContain('no template "poster"');
    expect((await bad({ template: 'milestone', brand: 'acme' })).error).toContain('no brand "acme"');
  });

  test('a figure the feed does not publish is refused with the list that it does', async () => {
    const out = await bad({ template: 'milestone', stat: 'users' });
    expect(out.status).toBe('error');
    expect(out.error).toContain('no such platform figure "users"');
    expect(out.error).toContain('tvl');
  });

  test('every refusal emits a chip, so the operator sees the miss too', async () => {
    await bad({ template: 'milestone', data: {} });
    const chip = await untilHarness(() => kit.frames.find((e) => e.tool === 'image/render_card'));
    expect(chip.status).toBe('error');
    expect(chip.summary).toBe('render_card — refused');
  });
});

describe('the lane is the boundary', () => {
  test('the lane comes from the CONNECTION — a being cannot file under another name', async () => {
    // There is no lane argument to pass; the handler reads companion.neumaId.
    expect(CARD_ARGS_HAVE_NO_LANE()).toBe(true);
    const out = await call({}, 'someoneelse');
    expect(out.status).toBe('ok'); // it answered for ITS lane, not ours
  });
});

/**
 * THE LAST HOP. Metidar, 2026-08-30, after proving every other link live:
 * […] The lane is
 * the being's own ground and its file reader can see it — but a post intent
 * needs the media inside a folder the OPERATOR has open. These tests stand on
 * a REAL house ground with a REAL realm record; nothing about the destination
 * is stubbed, because the destination IS what was missing.
 */
describe('the card reaches the ground a post can attach from', () => {
  let WALLET; let ground;

  const withWallet = (laneId) => ({ ...connectionFor(laneId), walletAddress: WALLET });
  const callAsOperator = (args, laneId = LANE) => handleImageTool(
    kit.ws, withWallet(laneId), null, 'act', { toolName: 'render_card' }, args, ports(),
  );

  const ANNOUNCEMENT = Object.freeze({
    template: 'announcement',
    data: {
      eyebrow: 'NOW LIVE', lineOne: 'Partial', lineTwo: 'withdrawals',
      support: 'Withdraw part of your holdings any time.',
    },
  });

  beforeEach(() => {
    WALLET = kit.connection.walletAddress;
    ground = path.join(dir, 'house');
  });

  test('the ground name carries brand, template, day and the image id', () => {
    // The id is IN the name because Metidar's own finding was that the lane
    // file is a bare uuid — a being that had just reviewed `imageId` could not
    // say which file on disk it had judged.
    expect(groundCardName({
      brand: 'umbrae', template: 'milestone', imageId: 'deadbeef-1111-2222-3333-444444444444',
      createdAt: '2026-08-30T10:00:00.000Z', ext: '.png',
    })).toBe('umbrae-milestone-2026-08-30-deadbeef.png');
    // A clock that produced nonsense drops out of the name rather than
    // poisoning it with "Invalid Date".
    expect(groundCardName({
      brand: 'ignis', template: 'stat', imageId: 'abcd1234-0000-0000-0000-000000000000',
      createdAt: 'not a date', ext: '.png',
    })).toBe('ignis-stat-abcd1234.png');
  });

  test('a rendered card lands in the being\'s working ground, byte-identical to the lane copy', async () => {
    await setHouseWorkspace(WALLET, ground);
    const out = await renderCardForLane({
      laneId: LANE,
      laneDir: path.join(dir, 'store', LANE),
      rasterize: chromiumRasterize,
      wallet: WALLET,
      args: ANNOUNCEMENT,
    });
    expect(out.ok, JSON.stringify(out.errors)).toBe(true);

    // It landed exactly where ensureBeingGround raises the being's own ground —
    // not a path this tool invented for itself.
    expect(path.dirname(out.workspaceFile)).toBe(path.join(ground, 'workspaces', LANE, 'cards'));
    expect(out.workspaceReason).toBeNull();
    expect(existsSync(out.workspaceFile)).toBe(true);
    expect(path.basename(out.workspaceFile)).toContain(out.imageId.slice(0, 8));

    // TWO COPIES, ONE TRUTH: the lane copy is what review_image keys on, the
    // ground copy is what a post attaches. If they could differ, the being
    // would be reviewing one image and publishing another.
    expect(readFileSync(out.workspaceFile).equals(readFileSync(out.path))).toBe(true);
  });

  test('the reported paths are the paths — a being never has to guess where its work is', async () => {
    await setHouseWorkspace(WALLET, ground);
    const out = await renderCardForLane({
      laneId: LANE,
      laneDir: path.join(dir, 'store', LANE),
      rasterize: chromiumRasterize,
      wallet: WALLET,
      args: ANNOUNCEMENT,
    });
    // The same law collectOutputs learned when callers rebuilt lane paths from
    // the store root and showed the operator locations that did not exist.
    expect(out.path).toBe(path.join(out.dir, out.file));
    expect(existsSync(out.path)).toBe(true);
  });

  test('no ground set: the card still renders and is still reviewable — the hop is a message, never a failure', async () => {
    const out = await renderCardForLane({
      laneId: LANE,
      laneDir: path.join(dir, 'store', LANE),
      rasterize: chromiumRasterize,
      wallet: WALLET,          // a wallet, but its house has no ground yet
      args: ANNOUNCEMENT,
    });
    expect(out.ok).toBe(true);
    expect(existsSync(out.path)).toBe(true);       // the lane copy still stands
    expect(out.workspaceFile).toBeNull();
    // And it says what to do about it, rather than failing mutely.
    expect(out.workspaceReason).toContain('no working ground');
  });

  test('no wallet on the seat: same law — rendered, filed, and told why the last hop did not happen', async () => {
    const out = await renderCardForLane({
      laneId: LANE,
      laneDir: path.join(dir, 'store', LANE),
      rasterize: chromiumRasterize,
      args: ANNOUNCEMENT,      // no wallet at all
    });
    expect(out.ok).toBe(true);
    expect(existsSync(out.path)).toBe(true);
    expect(out.workspaceFile).toBeNull();
    expect(out.workspaceReason).toContain('no operator wallet');
  });

  test('through the REAL dispatch path, the being is handed the attachable path in words', async () => {
    await setHouseWorkspace(WALLET, ground);
    const out = await callAsOperator(ANNOUNCEMENT);
    expect(out.status, out.error).toBe('ok');
    // The reply names the ground copy, because a path a being has to hunt for
    // is a path it will guess at.
    expect(out.content).toContain(path.join(ground, 'workspaces', LANE, 'cards'));
    expect(out.content).toContain('a post can attach');
    // And the sight contract still rides along — look before you publish.
    expect(out.sight.imageIds).toEqual([out.content.match(/as ([0-9a-f-]{36})/)[1]]);
  }, 60000);

  test('ONE-ACT STAGING: render + stage files the intent itself — no path transcription', async () => {
    await setHouseWorkspace(WALLET, ground);
    // The intents dir lives under the lane root the platform resolves.
    const workspaces = path.join(dir, 'workspaces-root');
    const { setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
    const savedWsRoot = (await import('../../core/workspace/neuma-workspace.js')).getWorkspacesRoot();
    setWorkspacesRoot(workspaces);
    try {
      const out = await callAsOperator({
        ...ANNOUNCEMENT,
        stage: {
          channel: 'x',
          text: 'the house ships, and the card proves it',
          alt: 'an announcement card',
          type: 'social/queue',
        },
      });
      expect(out.status, out.error).toBe('ok');
      expect(out.content).toContain('Staged in one act');

      // The intent file exists in the lane's intents dir, carries the RIGHT
      // payload, and the media path is the HARNESS-written ground copy — the
      // being never transcribes a path anywhere.
      const intentsDir = path.join(workspaces, LANE, 'intents');
      const files = (await import('fs')).readdirSync(intentsDir).filter((n) => n.endsWith('.json'));
      expect(files).toHaveLength(1);
      const intent = JSON.parse((await import('fs')).readFileSync(path.join(intentsDir, files[0]), 'utf8'));
      expect(intent.type).toBe('social/queue');
      expect(intent.channel).toBe('x');
      expect(intent.text).toBe('the house ships, and the card proves it');
      expect(intent.media[0].path).toContain(path.join(ground, 'workspaces', LANE, 'cards'));
      expect(intent.media[0].alt).toBe('an announcement card');

      // The stage note names the file and the same-round settlement.
      expect(out.content).toContain('settles in THIS round');
    } finally {
      setWorkspacesRoot(savedWsRoot);
    }
  }, 60000);

  test('stage without {channel, text} is refused with the reason — the card still stands', async () => {
    await setHouseWorkspace(WALLET, ground);
    const out = await callAsOperator({ ...ANNOUNCEMENT, stage: { alt: 'no channel, no text' } });
    expect(out.status).toBe('error');
    expect(out.error).toContain('stage needs {channel, text}');
  }, 60000);

  test('THE CHANGELOG TEMPLATE — four required update lines, self-described, rendered', async () => {
    // It self-describes like every sibling — a being calling {} sees it.
    const surface = await describeCards({ wallet: null });
    expect(surface).toContain('changelog');
    expect(surface).toContain('updateOne');
    expect(surface).toContain('at most 52 characters');
    // It renders through the REAL pipeline with all fields given...
    const out = await renderCardForLane({
      laneId: LANE,
      laneDir: path.join(dir, 'store', LANE),
      rasterize: chromiumRasterize,
      args: {
        template: 'changelog',
        brand: 'umbrae',
        data: {
          eyebrow: 'UPDATE 0.1.18',
          headline: 'the pipeline sharpens',
          updateOne: 'one-act staging: card and post in one call',
          updateTwo: 'the queue board is the single decision',
          updateThree: 'approval chips show the actual card',
          updateFour: 'the algorithm source lives local now',
          footer: 'FULL CHANGELOG IN THE RELEASE NOTES',
        },
      },
    });
    expect(out.ok, JSON.stringify(out.errors)).toBe(true);
    // ...and a missing update line is refused with the field's name — the
    // four-line law is the template's, stated at the same seam as every limit.
    const short = await renderCardForLane({
      laneId: LANE,
      laneDir: path.join(dir, 'store', LANE),
      rasterize: chromiumRasterize,
      args: {
        template: 'changelog',
        brand: 'umbrae',
        data: {
          eyebrow: 'UPDATE 0.1.18',
          headline: 'the pipeline sharpens',
          updateOne: 'one',
          updateTwo: 'two',
          updateThree: 'three',
        },
      },
    });
    expect(short.ok).toBe(false);
    expect(short.errors.join(' ')).toContain('updateFour');
  }, 60000);

  test('the wallet comes from the CONNECTION — no argument can name a destination', () => {
    const tool = cardToolsFor({ companion: { neumaId: 'sodelight' } }).find((t) => t.name === 'render_card');
    expect(Object.keys(tool.inputSchema.properties)
      .some((k) => /wallet|ground|dest|dir|path/i.test(k))).toBe(false);
  });
});

// The schema is the proof: there is no way to name a lane in an argument.
const CARD_ARGS_HAVE_NO_LANE = () => {
  const tool = cardToolsFor({ companion: { neumaId: 'sodelight' } }).find((t) => t.name === 'render_card');
  return !Object.keys(tool.inputSchema.properties).some((k) => /lane|neuma|workspace/i.test(k));
};
