import { WebSocketService } from '../../frontend/services/WebSocketService.js';
import * as portalOutbox from '../../frontend/services/portal-outbox.js';
window.portalOutboxProof = { WebSocketService, ...portalOutbox };
