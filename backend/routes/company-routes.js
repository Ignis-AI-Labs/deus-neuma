/**
 * THE HOUSE'S COMPANIES — /api/v1/companies (campaign plan §2.3–2.4). A
 * company is a brand kit (kit-locate.js); its `company` block records its
 * parent (a subsidiary under its core company; a client company stands on
 * its own), its site and its legal entity.
 *
 *   GET /             every company of the caller's house, in tree order
 *   POST /            add one {name, parentId?} — a new kit in the house's own ground
 *   PUT /:companyId   its company block {parentId?, site?, legalEntity?, repos?}
 *
 * COMPANY SOURCES (2026-10-24) — each company's site and code repos, and
 * the CMO's read of them (marketing/company-sources.js):
 *   GET    /sources                      every company's site + repos, each repo's grant
 *   PUT    /:companyId/repos             its repos [{path?, remote?, role?}], the rest of its block kept
 *   GET    /:companyId/repo-proposals    repos beside this app that look like the company's (owner, desk)
 *   POST   /:companyId/repos/read-grant  {path} — let the seated CMO read it (owner, desk)
 *   DELETE /:companyId/repos/read-grant  {path} — take that read back (owner, desk)
 *
 * The caller's own house only; a refused block says why in words. Looking at
 * the machine's folders and lending a read of one are the install owner's, at
 * the desk — a read beyond a lane reaches the machine.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { passesInstallOwner, requireInstallOwner } from '../services/install-owner.js';
import { addCompany, listCompanies, setCompanyBlock, setCompanyRepos } from '../services/marketing/companies.js';
import { companySources, proposeRepos } from '../services/marketing/company-sources.js';
import { grantRepoRead, revokeRepoRead } from '../services/marketing/company-repo-grants.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Companies');
const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    res.json({ companies: await listCompanies(req.walletAddress) });
  } catch (error) {
    log.error('companies read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the house\'s companies' });
  }
});

router.post('/', async (req, res) => {
  try {
    const out = await addCompany(req.walletAddress, { name: req.body?.name, parentId: req.body?.parentId || null });
    if (!out.ok) return res.status(out.conflict ? 409 : 400).json({ error: out.error });
    log.info('company added', { companyId: out.company?.id, parentId: out.company?.parentId ?? null, wallet: req.walletAddress });
    return res.status(201).json({ company: out.company });
  } catch (error) {
    log.error('company add failed', { error: error.message });
    return res.status(500).json({ error: 'The company was not added' });
  }
});

router.get('/sources', async (req, res) => {
  try {
    res.json(await companySources(req.walletAddress, { probe: await passesInstallOwner(req) }));
  } catch (error) {
    log.error('company sources read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the companies\' sources' });
  }
});

router.put('/:companyId/repos', async (req, res) => {
  try {
    const set = await setCompanyRepos(req.walletAddress, req.params.companyId, req.body?.repos ?? []);
    if (!set.ok) return res.status(400).json({ error: set.error });
    log.info('company repos recorded', { companyId: req.params.companyId, repos: set.company?.repos?.length ?? 0, wallet: req.walletAddress });
    return res.json({ company: set.company });
  } catch (error) {
    log.error('company repos write failed', { companyId: req.params.companyId, error: error.message });
    return res.status(500).json({ error: 'Failed to record the company\'s repos' });
  }
});

router.get('/:companyId/repo-proposals', requireInstallOwner, async (req, res) => {
  try {
    const out = await proposeRepos(req.walletAddress, req.params.companyId);
    return out.ok ? res.json(out) : res.status(404).json({ error: out.error });
  } catch (error) {
    log.error('repo proposals failed', { companyId: req.params.companyId, error: error.message });
    return res.status(500).json({ error: 'Failed to look for the company\'s repos' });
  }
});

const grantRoute = (act, verb) => async (req, res) => {
  try {
    const out = await act(req.walletAddress, req.params.companyId, String(req.body?.path ?? ''));
    if (!out.ok) return res.status(400).json({ error: out.error });
    log.info(`repo read ${verb}`, { companyId: req.params.companyId, path: out.path, laneId: out.laneId, wallet: req.walletAddress });
    return res.json(out);
  } catch (error) {
    log.error(`repo read ${verb} failed`, { companyId: req.params.companyId, error: error.message });
    return res.status(500).json({ error: `The read was not ${verb}` });
  }
};
router.post('/:companyId/repos/read-grant', requireInstallOwner, grantRoute(grantRepoRead, 'granted'));
router.delete('/:companyId/repos/read-grant', requireInstallOwner, grantRoute(revokeRepoRead, 'taken back'));

router.put('/:companyId', async (req, res) => {
  try {
    const set = await setCompanyBlock(req.walletAddress, req.params.companyId, req.body || {});
    if (!set.ok) return res.status(400).json({ error: set.error });
    log.info('company recorded', { companyId: req.params.companyId, parentId: set.company?.parentId ?? null, wallet: req.walletAddress });
    return res.json({ company: set.company });
  } catch (error) {
    log.error('company write failed', { companyId: req.params.companyId, error: error.message });
    return res.status(500).json({ error: 'Failed to record the company' });
  }
});

export default router;
