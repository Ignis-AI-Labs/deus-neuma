// KindPanels — the MARKETING board's panels for […] (marketing-panel-plan.md §3, slice 4), each SUBSTRATE's
// chamfered Panel drawn with the desk's instruments (hud-instruments.jsx):
//
//   PLATFORM   one platform at the level (or one account): each metric it
//              reports as a total today and a Trace over 7 or 30 days; a
//              platform that reports nothing: its tracked links' clicks
//   TOP POSTS  the posts that did the most by one metric: who said it, where
//              it stands, its own first words, its number as a Bar against the top
//   FUNNEL     one company's tree, SEEN → ENGAGED → CLICKED → ACTED, each step
//              a StackBar split by platform on one shared axis
//
// "—" says why on hover; an empty panel is one short line and one door. Pure
// rendering over the board's read (`b`, MarketingBoard.jsx).

import { uiSound } from '../../../services/ui-sound.js';
import { useWindows } from '../../windowing/use-windows.js';
import { isMarketingPlatform } from '../../windowing/retired-windows.js';
import { openDoor } from '../doors/open-door.js';
import { Panel } from '../sub-panel.jsx';
import { Trace, Bar, StackBar } from '../hud-instruments.jsx';
import { BrandMark } from '../brand-marks.jsx';
import { AccountMark } from '../accounts/AccountMark.jsx';
import { StatusMark } from '../StatusMark.jsx';
import { num } from '../marketing-overview/overview-words.js';
import { platformView, topPosts, firstWords } from './platform-fold.js';
import { platformFunnel } from './kinds-fold.js';
import { Empty } from './PanelEmpty.jsx';
import './board-kinds.css';

// Platform swatches, in the accounts' order: a funnel's parts and its legend share them.
const TONES = Object.freeze(['live', 'dim', 'muted', 'empty']);

/**
 * A platform, by sight: its mark and its name — and, like every AccountMark, the door to its account
 * level (the level's first account on it), wherever the board names a platform.
 */
export const PlatformName = ({ id, b }) => {
  const windows = useWindows();
  const words = <><BrandMark id={id} />{b.names.platforms[id] || String(id).toUpperCase()}</>;
  if (!windows?.dispatch || !isMarketingPlatform(id)) return <span className="mkk-plat" data-platform={id}>{words}</span>;
  const accountId = (b.levelAccounts || []).find((a) => a.channelId === id)?.id || null;
  return (
    <button type="button" className="mkk-plat is-door" data-platform={id} title={`open ${String(id).toUpperCase()}${accountId ? ` · account ${accountId}` : ''}`}
      onClick={() => { uiSound('open'); openDoor({ kind: 'account', channelId: id, accountId }, windows); }}>
      {words}
    </button>
  );
};

export const PlatformPanel = ({ entry, b, tools }) => {
  const { platform, accountId } = entry.scope;
  const v = platformView({ panel: entry, accounts: b.levelAccounts, queue: b.data.queue, results: b.data.results, links: b.data.links, now: b.now });
  const days = `${v.days || 7} DAYS`;
  const title = accountId ? <AccountMark accountId={accountId} /> : <PlatformName id={platform} b={b} />;
  const part = `platform:${platform}${accountId ? `:${accountId}` : ''}`;
  if (v.kind === 'empty') {
    return (
      <Panel tools={tools} title={title} span={entry.span} part={part}>
        <Empty line="No account" deskDoor={{ kind: 'keys', channelId: platform, add: true }} deskLabel="+ ACCOUNT" />
      </Panel>
    );
  }
  const hint = v.kind === 'links'
    ? `${b.data.results?.capability?.[platform]?.why || 'this platform reports no post numbers'} · clicks its tracked links counted, day by day`
    : 'each metric: the sum of every sent post\'s reading, as of each day · the metrics this platform reports';
  return (
    <Panel tools={tools} title={title} aside={days} span={entry.span} part={part} hint={hint}>
      <div className="mkk-traces" data-mkk-traces={v.kind}>
        {v.kind === 'links' ? (
          <span className="mkk-trace" data-metric="clicks" title={v.why || `clicks through ${v.codes} tracked link(s), the last ${days.toLowerCase()}`}>
            <Trace label="CLICKS" values={v.values} capacity={v.values.length} span="" unit="" floor={1} current={v.current ?? undefined} />
          </span>
        ) : v.metrics.map((m) => (
          <span key={m.metric} className="mkk-trace" data-metric={m.metric} title={m.why || `${m.word} — all ${v.posts} sent post(s), as of each day`}>
            <Trace label={m.word} values={m.values} capacity={m.values.length} span="" unit="" floor={1} current={m.current ?? undefined} />
          </span>
        ))}
      </div>
    </Panel>
  );
};

export const TopPostsPanel = ({ entry, b, tools }) => {
  const t = topPosts({ panel: entry, accounts: b.levelAccounts, queue: b.data.queue, results: b.data.results });
  const where = entry.scope.platform ? <PlatformName id={entry.scope.platform} b={b} /> : null;
  return (
    <Panel tools={tools} title={<>TOP POSTS{where}</>} aside={t.word ? `BY ${t.word}` : null} span={entry.span} part={entry.id}
      hint={`the ${entry.count || 5} sent posts that did the most by one metric, the most first${t.unranked ? ` · ${t.unranked} sent post(s) have no reading of it yet` : ''}`}>
      {t.rows.length ? (
        <ol className="mkk-top" data-mkk-top>
          {t.rows.map(({ entry: e, value }, i) => (
            <li key={e.id} className="mkk-top-row" data-top-post={e.id}>
              <span className="mkk-top-head">
                <AccountMark entry={e} />
                <StatusMark entry={e} />
                <span className="mkk-own" data-own-words title={e.text}>{firstWords(e.text)}</span>
                {e.url ? <a className="mko-door" href={e.url} target="_blank" rel="noreferrer" title="OPEN THE POST" aria-label="OPEN THE POST">↗</a> : null}
              </span>
              <Bar name={String(i + 1)} value={value} max={t.top} text={num(value)} tone="live" title={`${t.word} ${value}`} />
            </li>
          ))}
        </ol>
      ) : t.sent ? <Empty line="Not read yet" title="the sweep reads new posts every 6 hours" />
        : <Empty line="Nothing sent" door="CAMPAIGNS" onDoor={() => b.onTab('campaigns')} />}
    </Panel>
  );
};

export const FunnelPanel = ({ entry, b, tools }) => {
  const company = b.companies.find((c) => c.id === entry.scope.company);
  const f = platformFunnel({ companyId: entry.scope.company, companies: b.companies, accounts: b.accounts, queue: b.data.queue, results: b.data.results, links: b.data.links });
  const axis = Math.max(0, ...f.steps.map((s) => s.total || 0));
  const tone = (p) => TONES[f.platforms.indexOf(p) % TONES.length];
  return (
    <Panel tools={tools} title="FUNNEL" aside={company?.name || entry.scope.company} span={entry.span} part={entry.id}
      hint="this company and every company under it · each step split by platform, on one axis · ACTED = downloads its counted links led to · — = no post reported it">
      {!f.platforms.length ? <Empty line="No account" door="ACCOUNTS" onDoor={() => b.onTab('accounts')} /> : (
        <div className="mkk-funnel" data-mkk-funnel>
          <span className="mkk-funnel-key">
            {f.platforms.map((p) => <span key={p} className="mkk-key"><i className={`hud-swatch is-${tone(p)}`} /><PlatformName id={p} b={b} /></span>)}
          </span>
          {f.steps.map((s) => (
            <div key={s.step} className="mkk-step" data-step={s.step}
              title={s.total === null ? `${s.word} — no post here reported it` : s.parts.map((p) => `${b.names.platforms[p.platform] || p.platform} ${num(p.value)} (${p.reporting} of ${p.of} posts)`).join(' · ')}>
              <span className="mkk-step-name">{s.word}</span>
              <StackBar legend={false} total={axis || 1}
                parts={s.parts.filter((p) => p.value).map((p) => ({ key: p.platform, tone: tone(p.platform), value: p.value, label: p.platform, text: num(p.value) }))} />
              <b className="mkk-step-total">{num(s.total)}</b>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
};
