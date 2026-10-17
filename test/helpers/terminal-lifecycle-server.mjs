// impure - dedicated disposable process; NEVER boot backend/server.js or dotenv.
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createAuthRouter, requireAuth } from '../../backend/services/auth.js';
import { setupTerminalRoutes, terminalAgentsRouter } from '../../backend/routes/terminal-routes.js';
import { liveTerminalCount } from '../../backend/services/terminal-manager.js';
import { setRoots } from '../../backend/services/user-files.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';
import { loadConfig } from '../../backend/config.js';

loadConfig();
setRoots([process.env.HOME]);
setRealmRoot(process.env.NEUMA_REALM_ROOT);
const app = express();
app.use(express.json());
app.use('/api/v1/auth', createAuthRouter(express));
app.use('/api/v1/terminal', terminalAgentsRouter);
// Read-only fixture observation; never substitutes for any production handler.
app.get('/fixture/count', requireAuth, (req, res) => res.json({ count: liveTerminalCount() }));
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/terminal-ws' });
setupTerminalRoutes(wss);
server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
process.on('SIGTERM', () => process.exit(0));
