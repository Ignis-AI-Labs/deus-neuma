// A being's reply carrying tables, drawn through the real <Markdown> inside
// the real stream message frame (.relink-stream > .relink-msg > .relink-msg-body)
// at two stream widths — the owner's 2026-10-24 table crushed its short
// columns to a few letters. markdown-table-browser.test.js measures it.
import { createRoot } from 'react-dom/client';
import { Markdown } from '../../frontend/app/RelinkShell/Markdown.jsx';
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/RelinkShell.css';

const PLATFORMS = [
  '| Platform | Connected | I can read | Per-post views/engagement |',
  '|---|---|---|---|',
  '| X | ✅ | My own posts, mentions and recent search | ✅ impressions, likes, reposts and replies on each post |',
  '| TikTok | ❌ (crew / gate) | Nothing yet — the channel is not bound to me | ❌ needs the business API and a bound account first |',
  '| YouTube | ❌ (crew / gate) | Nothing yet | ❌ views and watch time arrive only through the analytics API |',
  '| LinkedIn | ❌ (crew / gate) | Nothing yet | ❌ the company page needs an approved app before any numbers |',
].join('\n');

const NUMBERS = [
  '| Post | Views | Likes |',
  '|:---|---:|---:|',
  '| Launch thread | 12,480 | 311 |',
  '| Short clip | 904 | 27 |',
].join('\n');

const LONG_TOKEN = [
  '| Source | Link |',
  '|---|---|',
  `| Report | https://example.org/${'a1b2c3d4e5'.repeat(30)} |`,
].join('\n');

const Frame = ({ width }) => (
  <section className="relink-stream" data-frame={width} style={{ width, overflow: 'visible' }}>
    <div className="relink-msg relink-msg--assistant">
      <div className="relink-msg-body">
        <Markdown text={`Here is where I stand on each platform.\n\n${PLATFORMS}\n\nAnd the two posts so far.\n\n${NUMBERS}\n\nThe source.\n\n${LONG_TOKEN}`} />
      </div>
    </div>
  </section>
);

createRoot(document.getElementById('root')).render(
  <>
    <Frame width={980} />
    <Frame width={560} />
  </>,
);
