/**
 * House A's world for the cross-house pen matrix: what the owner makes through
 * its OWN routes (tasks, presets, projects, leads, a campaign, its offices'
 * seats, its X and email channels, a queued post, a watched repo, its look and
 * brand), plus a threat in its ledger. Each id it gets back is what house B is
 * later aimed at. Also the matrix's two aiming tools: `url()` fills a route's
 * params with A's ids, and `aimed` is a body whose every common field names
 * something of A's.
 */
import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { send } from './pen-house-kit.js';

// impure — one of A's own requests; the response, or a failure noted by name
const asA = (ctx, failed) => async (name, method, url, body) => {
  const res = await send(ctx.base, { method, url, token: ctx.a.token, body });
  if (res.status < 200 || res.status >= 300) failed.push(`${name}: ${method.toUpperCase()} ${url} → ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
  return res.body;
};

/**
 * Seed house A through its own routes. impure.
 * @returns {Promise<{ ids: Record<string,string>, failed: string[], fill: Function, url: Function, aimed: object }>}
 */
export const seedHouseA = async (ctx) => {
  const failed = [];
  const a = asA(ctx, failed);
  const lane = ctx.lanes.a;
  const ids = { lane, unclaimed: ctx.lanes.aUnclaimed, wallet: ctx.a.address, device: ctx.deviceA };

  await a('genesis', 'post', '/api/v1/genesis/', {});
  ids.task = (await a('task', 'post', '/api/v1/tasks/mine', { title: 'A errand', cadence: 'once' }))?.task?.id;
  ids.sub = (await a('subtask', 'post', `/api/v1/tasks/mine/${ids.task}/subtasks`, { title: 'A step' }))?.subtask?.id;
  ids.neumaTask = (await a('neuma task', 'post', `/api/v1/tasks/neuma/${lane}`, { title: 'A being errand', cadence: 'once' }))?.task?.id;
  ids.preset = (await a('preset', 'post', '/api/v1/tasks/presets', { name: 'A preset', tasks: [{ title: 'A daily', cadence: 'daily' }] }))?.preset?.id;
  await a('calendar token', 'post', '/api/v1/tasks/calendar-token', {});
  const projectDir = path.join(ctx.root, 'a-project');
  await fs.mkdir(projectDir, { recursive: true });
  ids.project = (await a('project', 'post', '/api/v1/user/projects', { name: 'A project', folder: projectDir, channel: 'neuma', neumaId: lane }))?.project?.id;
  ids.lead = (await a('lead', 'post', '/api/v1/leads', { name: 'A lead', contact: 'a@example.invalid' }))?.lead?.id;
  ids.campaign = (await a('campaign', 'post', '/api/v1/campaigns', { name: 'A campaign', brand: 'A Brand' }))?.campaign?.id;
  await a('cso seat', 'put', '/api/v1/cso/seat', { laneId: lane });
  await a('x credentials', 'put', '/api/v1/social-channels/x/credentials', { fields: { apiKey: 'a-key', apiSecret: 'a-secret', accessToken: 'a-token', accessSecret: 'a-token-secret' } });
  await a('x binding', 'put', '/api/v1/social-channels/x/binding', { neumaId: lane });
  ids.post = (await a('queued post', 'post', '/api/v1/social-channels/queue', { channelId: 'x', text: 'A house post' }))?.entry?.id;
  await a('email credentials', 'put', '/api/v1/email/credentials', { fields: { address: 'a@example.invalid', password: 'a-app-password', imapHost: 'imap.example.invalid', smtpHost: 'smtp.example.invalid' } });
  await a('email binding', 'put', '/api/v1/email/binding', { neumaId: lane });
  const repoDir = path.join(ctx.root, 'a-repo');
  await fs.mkdir(repoDir, { recursive: true });
  execFileSync('git', ['init', '-q', repoDir]);
  ids.repo = (await a('watched repo', 'post', '/api/v1/cso/watch/repos', { path: repoDir }))?.repo?.id;
  ids.lookPreset = (await a('look preset', 'post', '/api/v1/look/presets', { name: 'A look', theme: { ground: '#101010', panel: '#202020', ink: '#f0f0f0', trim: '#808080' } }))?.presets?.find((p) => p.name === 'A look')?.id;

  await a('x crew', 'put', '/api/v1/social-channels/x/crew', { neumaId: lane, kind: 'reply', remit: 'A house replies' });
  await a('cmo seat', 'put', '/api/v1/campaigns/cmo', { laneId: lane });
  const artDir = path.join(process.env.WORKSPACES_ROOT, lane, 'art', 'images');
  await fs.mkdir(artDir, { recursive: true });
  await fs.writeFile(path.join(artDir, 'a-portrait.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  const galleryRoot = async () => (await a('gallery root', 'post', '/api/v1/gallery/roots', { dir: artDir, label: 'A art' }))
    ?.roots?.find((r) => r.dir === artDir && !r.being)?.id;
  ids.galleryRoot = await galleryRoot();

  const { threatLedgerFor } = await import('../../backend/services/security/threat-ledger.js');
  const ledger = await threatLedgerFor(ctx.a.address);
  const { added } = await ledger.ingest([{ layer: 'house', source: 'manual', externalId: 'pen:a-threat', title: 'A house threat', severity: 'high' }]);
  ids.threat = added[0]?.id;

  const missing = Object.entries(ids).filter(([, v]) => !v).map(([k]) => `id ${k} missing`);
  failed.push(...missing);

  // Which of A's ids a route's `:id` means, by the family it sits in.
  const idByFamily = [
    ['/api/v1/cso/threats/', ids.threat], ['/api/v1/cso/watch/repos/', ids.repo], ['/api/v1/leads/', ids.lead],
    ['/api/v1/campaigns/', ids.campaign], ['/api/v1/user/projects/', ids.project], ['/api/v1/look/presets/', ids.lookPreset],
    ['/api/v1/remote/devices/', ids.device], ['/api/v1/gallery/roots/', ids.galleryRoot], ['/api/v1/social-channels/queue/', ids.post], ['/api/v1/lanes/', ids.unclaimed],
  ];
  const byName = {
    neumaId: lane, companionName: lane, beingId: lane, companion: lane, taskId: ids.task, subId: ids.sub,
    presetId: ids.preset, address: ids.wallet, wallet: ids.wallet, channelId: 'x', providerId: 'openai',
    serviceId: 'elevenlabs', vendor: 'claude-code', name: lane, brand: 'a-brand', postId: ids.post, act: 'bin',
    recordId: 'rec-a', ceremonyId: 'cer-a', adapterId: 'adapter-a', proposalId: 'prop-a', amendmentId: 'amend-a',
    imageId: 'img-a', serverName: 'fs', serverId: 'fs', action: 'stop', changeId: 'change-a',
  };
  /** A's value for one param of a route, or undefined when none is known. Pure. */
  const fill = (routePath, param) => {
    if (param !== 'id') return byName[param];
    const family = idByFamily.find(([prefix]) => routePath.startsWith(prefix));
    return family ? family[1] : lane;
  };
  /** The route's path with every param filled with A's. Pure. */
  const url = (routePath) => routePath
    .replace(/:(\w+)\([^)]*\)/g, (_, name) => fill(routePath, name) ?? name)
    .replace(/:(\w+)/g, (_, name) => encodeURIComponent(fill(routePath, name) ?? name));

  const aLaneDir = path.join(process.env.WORKSPACES_ROOT, lane);
  const aRealmDir = path.join(process.env.NEUMA_REALM_ROOT, ctx.a.address);
  const target = path.join(aLaneDir, 'dna', 'genesis.md');
  // Every common field, naming something of A's.
  const aimed = Object.freeze({
    neumaId: lane, laneId: lane, beingId: lane, holder: lane, ownerNeumaId: lane, id: lane, companion: lane,
    wallet: ids.wallet, address: ids.wallet, owner: ids.wallet, taskId: ids.task, presetId: ids.preset,
    postId: ids.post, threatId: ids.threat, projectId: ids.project, campaignId: ids.campaign, channelId: 'x',
    path: target, file: target, filePath: target, folder: aLaneDir, root: aRealmDir, dir: aLaneDir,
    from: target, to: path.join(aLaneDir, 'moved.md'), source: target, destination: path.join(aLaneDir, 'moved.md'),
    name: 'pen', title: 'pen', text: 'pen', content: 'pen', note: 'pen', status: 'done', enabled: false,
    updates: [{ id: ids.post, text: 'pen' }], ids: [ids.post, ids.task], fields: { apiKey: 'b-key' },
    serverName: 'fs', toolName: 'write_file', args: { path: target, content: 'pen' },
  });
  /** Stand A's gallery folder again (the same id: roots are keyed by their folder). impure. */
  const reseedGalleryRoot = async () => { await galleryRoot(); };
  return { ids, failed, fill, url, aimed, reseedGalleryRoot };
};
