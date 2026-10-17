/** Isolated dream-journal stack: real auth and the real dream routes on a temp realm, nothing else. */
import express from 'express';
import { createServer } from 'node:http';
import { loadConfig } from '../../../backend/config.js';
import { createAuthRouter } from '../../../backend/services/auth.js';
import { setRealmRoot } from '../../../backend/services/user-realm.js';
import dreamRoutes from '../../../backend/routes/dream-routes.js';

// As the desk does: AUTH_SECRET from config, so a session outlives a restart (the spec restarts this stack).
loadConfig();
setRealmRoot(process.env.NEUMA_REALM_ROOT);
const app = express();
app.use(express.json());
app.use('/api/v1/auth', createAuthRouter(express));
app.use('/api/v1/user/dreams', dreamRoutes);
const server = createServer(app);
await new Promise((resolve) => server.listen(Number(process.env.DREAMS_PORT) || 0, '127.0.0.1', resolve));
process.send?.({ port: server.address().port });
process.on('SIGTERM', () => server.close(() => process.exit(0)));
