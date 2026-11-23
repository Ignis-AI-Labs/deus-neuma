// SubstrateNetwork — the SUBSTRATE window's NETWORK tab (Design note, 2026-11-22: […]).
// What the machine's own socket table holds right now (backend network/network-watch.js): one line of state first,
// then what LEAVES for the internet, what stays on your network, what came IN, what LISTENS and who can reach it, and
// the platform's own connections that run by themselves, each on or off. The platform's own traffic is marked apart
// from other programs' on the machine. No name is looked up for an address: asking would itself go out.
// impure — polls the network read while the tab is on screen.
import { useRef, useState, useEffect } from 'react';
import { Fold } from './fold/Fold.jsx';
import { Sheet } from './sheet/Sheet.jsx';
import { EmptyState } from './empty-state.jsx';
import { loadNetwork, loadNetworkHistory } from './substrate-client.js';
import { useVisibleInterval } from './use-visible-interval.js';

export const NETWORK_POLL_MS = 4000;
const HISTORY_POLL_MS = 30000;
const n = (v) => Number(v || 0).toLocaleString('en-US');
const PLACE = Object.freeze({ internet: 'THE INTERNET', lan: 'YOUR NETWORK', tailnet: 'YOUR TAILNET', machine: 'THIS MACHINE', any: 'ANY ADDRESS' });
const REACH = Object.freeze({ machine: 'THIS MACHINE ONLY', tailnet: 'YOUR TAILNET', lan: 'YOUR NETWORK', internet: 'A PUBLIC ADDRESS', any: 'ANYONE WHO CAN REACH THIS MACHINE' });
const whose = { head: 'WHOSE', cell: (r) => (r.ours ? `THE PLATFORM${r.owner ? ` — ${String(r.owner).toUpperCase()}` : ''}` : 'ANOTHER PROGRAM'), tone: (r) => (r.ours ? 'on' : undefined) };
const program = { head: 'PROGRAM', cell: (r) => (r.process ? `${r.process}${r.pid ? ` (${r.pid})` : ''}` : 'NOT SHOWN TO THIS USER'), exact: true };
const farEnd = [
  { head: 'ADDRESS', cell: (r) => r.address, exact: true },
  { head: 'PORT', cell: (r) => r.port },
  { head: 'KIND', cell: (r) => String(r.proto).toUpperCase() },
  { head: 'SOCKETS', cell: (r) => n(r.sockets), sort: (r) => r.sockets },
];
const Flow = ({ label, rows }) => (
  <Sheet label={label} rows={rows} rowKey={(r) => `${r.process}:${r.pid}:${r.address}:${r.port}:${r.proto}`} rowName={(r) => `${r.process ?? 'a program'} to ${r.address}`} rowAttrs={(r) => ({ 'data-net-flow': r.address, 'data-net-ours': r.ours ? 'yes' : 'no' })}
    columns={[program, ...farEnd, { head: 'WHERE', cell: (r) => PLACE[r.place] }, whose]} empty={<p className="sub-net-note label-data">NONE RIGHT NOW.</p>} />
);

const when = (iso) => (iso ? `${String(iso).slice(0, 10)} ${String(iso).slice(11, 19)}` : null);
const stood = (r) => (r.there ? 'STILL THERE' : r.seconds == null ? null : r.seconds < 90 ? `${r.seconds} S` : r.seconds < 5400 ? `${Math.round(r.seconds / 60)} MIN` : `${Math.round(r.seconds / 360) / 10} H`);
const DIR = Object.freeze({ out: 'WENT OUT', in: 'CAME IN', open: 'LISTENED' });
const KIND = Object.freeze({ in: 'CAME IN', open: 'A PORT OPENED', noName: 'PROGRAM NOT SHOWN', brief: 'THERE AND GONE', newPlace: 'A NEW PLACE' });
const WEIGHT = Object.freeze({ high: 'LOOK AT THIS', medium: 'WORTH A LOOK', low: 'FOR THE RECORD' });

// What was kept, and what in it stands out: read when the tab opens and every half minute after.
const NetworkHistory = () => {
  const [log, setLog] = useState(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const watch = useVisibleInterval(async () => { const got = await loadNetworkHistory(); if (alive.current && got) setLog(got); }, HISTORY_POLL_MS);
  if (!log) return <div ref={watch}><p className="sub-net-note label-data" role="status">READING WHAT WAS KEPT…</p></div>;
  const high = log.audit.filter((a) => a.weight === 'high');
  return (
    <div ref={watch}>
      <Fold id="net-audit" title="AUDIT" level={2} waits={high.length > 0} stats={[`${n(high.length)} TO LOOK AT`, `${n(log.audit.length - high.length)} MORE`, log.since ? `SINCE ${when(log.since)}` : 'NOTHING KEPT YET']}>
        <Sheet label="what stands out in the network history" rows={log.audit} rowKey={(a) => a.key} rowName={(a) => a.what} rowAttrs={(a) => ({ 'data-net-audit': a.kind, 'data-net-weight': a.weight })}
          columns={[
            { head: 'WHAT HAPPENED', cell: (a) => a.what, wrap: true },
            { head: 'KIND', cell: (a) => KIND[a.kind] },
            { head: 'WEIGHT', cell: (a) => WEIGHT[a.weight], tone: (a) => (a.weight === 'high' ? 'alert' : undefined) },
            { head: 'FIRST SEEN', cell: (a) => when(a.at), sort: (a) => String(a.at) },
            { head: 'LAST SEEN', cell: (a) => when(a.lastAt), sort: (a) => String(a.lastAt) },
            { head: 'TIMES', cell: (a) => n(a.times), sort: (a) => a.times },
          ]} empty={<p className="sub-net-note label-data">NOTHING IN WHAT WAS KEPT STANDS OUT: NOTHING CAME IN FROM OUTSIDE, NO PORT OPENED, NO PROGRAM HID.</p>} />
        <p className="sub-net-note label-data">IT FLAGS; IT STOPS NOTHING. EACH ADDRESS OR PORT IS NAMED ONCE, THE FIRST TIME IT WAS SEEN, WITH HOW MANY TIMES SINCE. A PORT THAT WAS ALREADY OPEN WHEN THE WATCH BEGAN IS NOT CALLED OPENED.</p>
      </Fold>
      <Fold id="net-history" title="HISTORY" level={2} stats={[`${n(log.kept)} KEPT`, `${n(log.retentionDays)} DAYS`]}>
        <Sheet label="the network history" rows={log.history} rowKey={(r) => `${r.key}:${r.firstSeen}`} rowName={(r) => `${r.process ?? 'a program'} and ${r.address}`}
          columns={[
            { head: 'FIRST SEEN', cell: (r) => when(r.firstSeen), sort: (r) => String(r.firstSeen) },
            { head: 'WHAT', cell: (r) => DIR[r.dir] },
            program,
            { head: 'ADDRESS', cell: (r) => r.address, exact: true },
            { head: 'PORT', cell: (r) => r.port },
            { head: 'WHERE', cell: (r) => (r.dir === 'open' ? REACH[r.place] : PLACE[r.place]) },
            { head: 'STOOD FOR', cell: stood, sort: (r) => (r.there ? Infinity : r.seconds ?? -1) },
            whose,
          ]} empty={<p className="sub-net-note label-data">NOTHING HAS BEEN KEPT YET: THE WATCH KEEPS WHAT CONNECTS WHILE THE DESK IS OPEN.</p>} />
        <p className="sub-net-note label-data">KEPT ON THIS MACHINE ONLY, FOR {n(log.retentionDays)} DAYS, WHILE THE DESK IS OPEN: WHAT CONNECTED BEYOND THIS MACHINE AND WHAT LISTENED BEYOND IT, READ EVERY FEW SECONDS. A CONNECTION THAT OPENED AND CLOSED BETWEEN TWO READINGS IS NOT IN IT.</p>
      </Fold>
    </div>
  );
};

export const SubstrateNetwork = () => {
  const [net, setNet] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const watch = useVisibleInterval(async () => {
    const got = await loadNetwork();
    if (!alive.current) return;
    setNet((prev) => (got == null && prev != null ? prev : got));
    setLoaded(true);
  }, NETWORK_POLL_MS);
  if (!loaded) return <div className="sub-body" ref={watch}><EmptyState title="READING THE NETWORK…" /></div>;
  if (!net) return <div className="sub-body" ref={watch}><p className="hud-down label-data">THE NETWORK COULD NOT BE READ — NOT AUTHENTICATED OR BACKEND UNREACHABLE</p></div>;
  const c = net.counts ?? {};
  const out = net.out ?? [];
  const leaving = out.filter((r) => r.place === 'internet');
  const near = out.filter((r) => r.place === 'lan' || r.place === 'tailnet');
  const local = [...out.filter((r) => r.place === 'machine'), ...(net.in ?? []).filter((r) => r.place === 'machine')];
  const cameIn = (net.in ?? []).filter((r) => r.place !== 'machine');
  const open = (net.listening ?? []).filter((l) => l.reach !== 'machine');
  const on = (net.selfRunning ?? []).filter((s) => s.on === true);
  return (
    <div className="sub-body" ref={watch} data-substrate-network="">
      {net.measured ? (
        <p className="sub-net-line" role="status" data-net-summary="">
          {n(c.leaving)} CONNECTION{c.leaving === 1 ? '' : 'S'} LEAVING FOR THE INTERNET TO {n(c.addresses)} ADDRESS{c.addresses === 1 ? '' : 'ES'} — {n(c.leavingOurs)} THE PLATFORM&apos;S OWN, {n(c.leaving - c.leavingOurs)} OTHER PROGRAMS&apos; · {n(c.inFromOutside)} CAME IN FROM OUTSIDE THIS MACHINE · {n(c.open)} PORT{c.open === 1 ? '' : 'S'} OPEN BEYOND THIS MACHINE · {n(on.length)} SELF-RUNNING CONNECTION{on.length === 1 ? '' : 'S'} ON
        </p>
      ) : <p className="hud-down label-data" role="alert">THE NETWORK WAS NOT MEASURED — {String(net.why ?? 'no reason given').toUpperCase()}</p>}
      <NetworkHistory />
      <Fold id="net-leaving" title="GOING OUT TO THE INTERNET" level={2} waits={leaving.some((r) => r.ours)} stats={[`${n(leaving.length)} NOW`, `${n(leaving.filter((r) => r.ours).length)} THE PLATFORM'S`]}>
        <Flow label="connections leaving for the internet" rows={leaving} />
      </Fold>
      <Fold id="net-in" title="CAME IN FROM OUTSIDE" level={2} waits={cameIn.length > 0} stats={[`${n(cameIn.length)} NOW`]}>
        <Flow label="connections that came in from outside this machine" rows={cameIn} />
      </Fold>
      <Fold id="net-open" title="LISTENING BEYOND THIS MACHINE" level={2} stats={[`${n(open.length)} PORTS`, `${n(open.filter((l) => l.ours).length)} THE PLATFORM'S`]}>
        <Sheet label="ports open beyond this machine" rows={open} rowKey={(l) => `${l.proto}:${l.address}:${l.port}`} rowName={(l) => `port ${l.port}`} rowAttrs={(l) => ({ 'data-net-open': String(l.port) })}
          columns={[{ head: 'PORT', cell: (l) => l.port }, { head: 'KIND', cell: (l) => String(l.proto).toUpperCase() }, { head: 'BOUND TO', cell: (l) => l.address, exact: true }, { head: 'WHO CAN REACH IT', cell: (l) => REACH[l.reach], tone: (l) => (l.reach === 'any' || l.reach === 'internet' ? 'alert' : undefined) }, program, whose]}
          empty={<p className="sub-net-note label-data">NOTHING ON THIS MACHINE LISTENS BEYOND ITSELF.</p>} />
      </Fold>
      <Fold id="net-near" title="ON YOUR OWN NETWORK" level={2} stats={[`${n(near.length)} NOW`]}>
        <Flow label="connections to your own network and tailnet" rows={near} />
      </Fold>
      <Fold id="net-local" title="INSIDE THIS MACHINE" level={2} stats={[`${n(local.length)} NOW`, 'NOTHING LEAVES']}>
        <Flow label="connections between programs on this machine" rows={local} />
      </Fold>
      <Fold id="net-self" title="CONNECTIONS THE PLATFORM MAY MAKE BY ITSELF" level={2} stats={[`${n(on.length)} ON`, `${n((net.selfRunning ?? []).filter((s) => s.on === false).length)} OFF`]}>
        <Sheet label="the platform's self-running connections" rows={net.selfRunning ?? []} rowKey={(s) => s.id} rowName={(s) => s.name} rowAttrs={(s) => ({ 'data-net-self': s.id })}
          columns={[{ head: 'CONNECTION', cell: (s) => s.name }, { head: 'STATE', cell: (s) => (s.on === true ? 'ON' : s.on === false ? 'OFF' : 'ONLY WHEN YOU USE IT'), tone: (s) => (s.on === true ? 'on' : undefined) }, { head: 'GOES TO', cell: (s) => s.to, exact: true }, { head: 'WHEN', cell: (s) => s.when }, { head: 'WHAT IT SENDS', cell: (s) => s.sends, wrap: true }]} />
        <p className="sub-net-note label-data">TURNED ON AND OFF IN SETTINGS, SECURITY, CONNECTIONS.</p>
      </Fold>
      <p className="sub-net-note label-data">READ FROM THIS MACHINE&apos;S OWN SOCKET TABLE EVERY FEW SECONDS: WHAT IS CONNECTED NOW, NOT A HISTORY. AN ADDRESS IS SHOWN AS IT IS — NO NAME IS LOOKED UP FOR IT, BECAUSE ASKING WOULD ITSELF GO OUT. A CONNECTION ANOTHER USER&apos;S PROGRAM HOLDS SHOWS WITHOUT ITS PROGRAM.</p>
    </div>
  );
};
