/**
 * House A's world for the cross-house pen matrix: what the owner makes through
 * its OWN routes (tasks, presets, leads, a campaign, its offices'
 * seats, its X and email channels, a queued post, a watched repo, its look and
 * brand, its company with an account and a group of posts under it, its
 * MARKETING boards), plus
 * a threat in its ledger. Each id it gets back is what house B is later aimed
 * at. Also the matrix's two aiming tools: `url()` fills a route's
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
  ids.lead = (await a('lead', 'post', '/api/v1/leads', { name: 'A lead', contact: 'a@example.invalid' }))?.lead?.id;
  ids.campaign = (await a('campaign', 'post', '/api/v1/campaigns', { name: 'A campaign', companyId: 'ignis' }))?.campaign?.id;
  ids.ask = (await a('campaign ask', 'post', `/api/v1/campaigns/${ids.campaign}/asks`, { text: 'A ask' }))?.campaign?.asks?.[0]?.id;
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

  // A's company (a brand kit on its own ground), an account under it, and a
  // group of posts on that account: what the account/company/group routes aim at.
  await a('house ground', 'put', '/api/v1/user/realm/house-workspace', { root: path.join(ctx.root, 'a-ground') });
  const skeleton = (await a('kit skeleton', 'get', '/api/v1/brands/a-brand/new'))?.kit;
  ids.company = (await a('company kit', 'put', '/api/v1/brands/a-brand', skeleton))?.brand;
  ids.account = (await a('account', 'post', '/api/v1/social-channels/accounts', { channelId: 'x', companyId: ids.company, label: 'A account' }))?.accountId;
  await a('account crew', 'put', `/api/v1/social-channels/accounts/${ids.account}/crew`, { neumaId: lane, kind: 'reply', remit: 'A account replies' });
  const groupPost = (await a('group post', 'post', '/api/v1/social-channels/queue', { channelId: 'x', accountId: ids.account, text: 'A group post', group: 'a-group' }))?.entry;
  ids.group = groupPost?.groupId;
  ids.groupPost = groupPost?.id;
  // A's MARKETING boards (the house's and its company's): what the board routes must never let B read or move.
  await a('house board', 'put', '/api/v1/marketing/board?level=house', { panels: [
    { id: `campaign:${ids.campaign}`, kind: 'campaign', span: 12, scope: { companyId: null, campaignId: ids.campaign }, pinned: true }] });
  await a('company board', 'put', `/api/v1/marketing/board?level=${ids.company}`, { panels: [{ id: 'posts', kind: 'posts', span: 12, scope: { companyId: ids.company } }] });

  await a('x crew', 'put', '/api/v1/social-channels/x/crew', { neumaId: lane, kind: 'reply', remit: 'A house replies' });
  await a('cmo seat', 'put', '/api/v1/campaigns/cmo', { laneId: lane });
  const artDir = path.join(process.env.WORKSPACES_ROOT, lane, 'art', 'images');
  await fs.mkdir(artDir, { recursive: true });
  await fs.writeFile(path.join(artDir, 'a-portrait.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  const galleryRoot = async () => (await a('gallery root', 'post', '/api/v1/gallery/roots', { dir: artDir, label: 'A art' }))
    ?.roots?.find((r) => r.dir === artDir && !r.being)?.id;
  ids.galleryRoot = await galleryRoot();

  // A's CMO's proposed change to its company's links, waiting on A: what the company-links routes must never let B decide.
  const { addLinkChange } = await import('../../backend/services/marketing/link-change-store.js');
  ids.linkChange = (await addLinkChange(ctx.a.address, { laneId: lane, companyId: ids.company, change: { site: 'https://a-brand.example' } }))?.entry?.id;

  // A's company on the founding line, and an ask of A's hands on it: what the company-line routes must never let B move.
  ids.companyLine = (await a('company line', 'post', '/api/v1/company-line', { name: 'A venture', mode: 'house' }))?.company?.id;
  const { makeHands } = await import('../../backend/services/company-line/hands-shape.js');
  const { raiseHands } = await import('../../backend/services/company-line/hands-store.js');
  const hands = makeHands({ what: 'Sign the A operating agreement', why: 'A\'s company needs it signed.', where: 'https://a-brand.example/sign', answer: 'done', raisedBy: lane, now: new Date().toISOString() });
  ids.hands = (await raiseHands(ctx.a.address, ids.companyLine, hands))?.item?.id;

  // A's chat door: a person A approved, and a stranger's code waiting on A — what the chat-bridge routes must never let B answer or take off.
  const { walletDir } = await import('../../backend/services/user-realm.js');
  const { writePrivate } = await import('../../backend/services/house-office-legacy.js');
  const at = new Date().toISOString();
  await writePrivate(path.join(walletDir(ctx.a.address), 'chat-access.json'), { 'telegram-1': {
    allowed: [{ kind: 'user', id: '42', name: 'A friend', by: 'operator', at }],
    pending: [{ code: 'PENC0DE2', kind: 'user', id: '43', name: 'A stranger', chat: { id: '43', type: 'dm' }, at, attempts: 1 }],
  } });
  ids.chatCode = 'PENC0DE2';

  const { threatLedgerFor } = await import('../../backend/services/security/threat-ledger.js');
  const ledger = await threatLedgerFor(ctx.a.address);
  const { added } = await ledger.ingest([{ layer: 'house', source: 'manual', externalId: 'pen:a-threat', title: 'A house threat', severity: 'high' }]);
  ids.threat = added[0]?.id;

  const missing = Object.entries(ids).filter(([, v]) => !v).map(([k]) => `id ${k} missing`);
  failed.push(...missing);

  // Which of A's ids a route's `:id` means, by the family it sits in.
  const idByFamily = [
    ['/api/v1/cso/threats/', ids.threat], ['/api/v1/cso/watch/repos/', ids.repo], ['/api/v1/leads/', ids.lead],
    ['/api/v1/campaigns/', ids.campaign], ['/api/v1/look/presets/', ids.lookPreset],
    ['/api/v1/remote/devices/', ids.device], ['/api/v1/gallery/roots/', ids.galleryRoot], ['/api/v1/social-channels/queue/', ids.post], ['/api/v1/lanes/', ids.unclaimed],
    ['/api/v1/company-links/', ids.linkChange], ['/api/v1/company-line/', ids.companyLine], ['/api/v1/raise/', ids.companyLine],
    ['/api/v1/chat-bridge/', '42'],
  ];
  const byName = {
    neumaId: lane, companionName: lane, beingId: lane, companion: lane, taskId: ids.task, subId: ids.sub,
    presetId: ids.preset, address: ids.wallet, wallet: ids.wallet, channelId: 'x', providerId: 'openai',
    serviceId: 'elevenlabs', vendor: 'claude-code', name: lane, brand: 'a-brand', postId: ids.post, act: 'bin',
    recordId: 'rec-a', ceremonyId: 'cer-a', adapterId: 'adapter-a', proposalId: 'prop-a', amendmentId: 'amend-a',
    imageId: 'img-a', serverName: 'fs', serverId: 'fs', action: 'stop', changeId: 'change-a', askId: ids.ask,
    accountId: ids.account, companyId: ids.company, groupId: ids.group, handsId: ids.hands, code: ids.chatCode, kind: 'user',
    // a platform, not a house's id: the connect keys its consent by the
    // caller's own house, so B's request can only ever open B's own
    channel: 'youtube',
  };
  /** A's value for one param of a route, or undefined when none is known. Pure. */
  const fill = (routePath, param) => {
    // the chat door is a Telegram or Discord account's: A's is telegram-1
    if (param === 'accountId' && routePath.startsWith('/api/v1/chat-bridge/')) return 'telegram-1';
    if (param !== 'id') return byName[param];
    const family = idByFamily.find(([prefix]) => routePath.startsWith(prefix));
    return family ? family[1] : lane;
  };
  // Routes that name A's thing in their query, not their path.
  const queryByFamily = [['/api/v1/marketing/board', `level=${encodeURIComponent(ids.company)}`]];
  /** The route's path with every param filled with A's (and A's query, where the route takes one). Pure. */
  const url = (routePath) => {
    const filled = routePath
      .replace(/:(\w+)\([^)]*\)/g, (_, name) => fill(routePath, name) ?? name)
      .replace(/:(\w+)/g, (_, name) => encodeURIComponent(fill(routePath, name) ?? name));
    const query = queryByFamily.find(([prefix]) => routePath.startsWith(prefix))?.[1];
    return query ? `${filled}?${query}` : filled;
  };

  const aLaneDir = path.join(process.env.WORKSPACES_ROOT, lane);
  const aRealmDir = path.join(process.env.NEUMA_REALM_ROOT, ctx.a.address);
  const target = path.join(aLaneDir, 'dna', 'genesis.md');
  // Every common field, naming something of A's.
  const aimed = Object.freeze({
    neumaId: lane, laneId: lane, beingId: lane, holder: lane, ownerNeumaId: lane, id: lane, companion: lane,
    wallet: ids.wallet, address: ids.wallet, owner: ids.wallet, taskId: ids.task, presetId: ids.preset,
    postId: ids.post, threatId: ids.threat, campaignId: ids.campaign, channelId: 'x',
    accountId: ids.account, companyId: ids.company, group: ids.group, textsSeen: { [ids.groupPost]: 'A group post' },
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
