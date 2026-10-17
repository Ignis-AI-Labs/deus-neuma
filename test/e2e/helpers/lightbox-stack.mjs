/** Isolated preview stack: real auth/routes/portal and built desk, no boot schedulers or substrate. */
import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { createAuthRouter } from '../../../backend/services/auth.js';
import { setRealmRoot } from '../../../backend/services/user-realm.js';
import { setupPortalRoutes } from '../../../backend/routes/portal-routes.js';
import socialRoutes from '../../../backend/routes/social-channel-routes.js';
import brandRoutes from '../../../backend/routes/brand-routes.js';
import realmRoutes from '../../../backend/routes/user-realm-routes.js';
import workspaceRoutes from '../../../backend/routes/workspace-routes.js';
import rosterRoutes from '../../../backend/routes/roster-routes.js';
import campaignRoutes from '../../../backend/routes/campaign-routes.js';

setRealmRoot(process.env.NEUMA_REALM_ROOT);
const app = express();
app.use(express.json());
app.use('/api/v1/auth', createAuthRouter(express));
app.use('/api/v1/social-channels', socialRoutes);
app.use('/api/v1/brands', brandRoutes);
app.use('/api/v1/user/realm', realmRoutes);
app.use('/api/v1/workspace', workspaceRoutes);
app.use('/api/v1/roster', rosterRoutes);
app.use('/api/v1/campaigns', campaignRoutes);
app.use(express.static(path.resolve('dist')));
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
setupPortalRoutes(wss, { birthHandler: null });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
process.send?.({ port: server.address().port });
process.on('SIGTERM', () => {
  for (const client of wss.clients) client.terminate();
  wss.close();
  server.close(() => process.exit(0));
});
