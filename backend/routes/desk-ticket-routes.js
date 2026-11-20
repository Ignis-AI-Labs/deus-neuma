import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { issueDeskTicket, sessionExpiryForRequest } from '../services/desk-tickets.js';

const router = Router();
router.use(requireAuth);

router.post('/', (req, res) => {
  const issued = issueDeskTicket({
    address: req.walletAddress,
    sessionExpiresAt: sessionExpiryForRequest(req),
    method: req.body?.method,
    path: req.body?.path,
    query: req.body?.query,
  });
  if (!issued) return res.status(400).json({ error: 'Unknown desk lane or invalid resource' });
  res.set('Cache-Control', 'no-store');
  return res.json(issued);
});

export default router;
