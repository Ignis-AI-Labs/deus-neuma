/** Component-boundary browser fixture; actual fetch/auth/render code is unchanged. */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ApprovalChip } from '../../frontend/app/RelinkShell/ApprovalChip.jsx';

const root = createRoot(document.getElementById('root'));
window.showApproval = (segment) => root.render(createElement(ApprovalChip, { segment }));
