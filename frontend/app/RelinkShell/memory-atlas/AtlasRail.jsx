// AtlasRail — the ways into a memory: its topics, the people it speaks of, the
// months it falls in, its kinds. Each is a line with its count; pressing one
// narrows the list, pressing it again lifts it. Counts follow the other
// choices already made, so a number always answers […].

import { formatCount } from '../../../utils/format.js';
import { kindWords, monthWords } from './atlas-view.js';

// Twelve small bars: when, over the being's whole life, this topic was spoken of.
const Spark = ({ spark }) => {
  const top = Math.max(1, ...spark);
  return (
    <span className="atlas-spark" aria-hidden="true">
      {spark.map((n, i) => <i key={i} style={{ height: `${n ? Math.max(12, (n / top) * 100) : 0}%` }} />)}
    </span>
  );
};

// One group of ways-in: a line with its name and count that folds. Topics and
// people stand open (they are how a memory is usually entered); the rest fold.
const Group = ({ title, n, open = false, children }) => (
  <details className="atlas-group" open={open}>
    <summary className="atlas-group-sum">
      <span className="atlas-group-title label-data">{title}</span>
      <span className="atlas-group-n label-data">{formatCount(n)}</span>
    </summary>
    {children}
  </details>
);

const Way = ({ on, name, title, n, onPress, spark = null, share = null, dim = false }) => (
  <li>
    <button type="button" className={`atlas-way${on ? ' is-on' : ''}${dim ? ' is-none' : ''}`} aria-pressed={on} title={title} onClick={onPress}>
      <span className="atlas-way-name">{name}</span>
      {spark ? <Spark spark={spark} /> : null}
      {share !== null ? <span className="atlas-way-bar" aria-hidden="true"><i style={{ width: `${share * 100}%` }} /></span> : null}
      <span className="atlas-way-n">{formatCount(n)}</span>
    </button>
  </li>
);

/**
 * @param {{atlas: Object, filters: Object, counts: Object, onToggle: (key: string, value: any) => void}} props
 */
export const AtlasRail = ({ atlas, filters, counts, onToggle }) => {
  const most = (list) => Math.max(1, ...list.map((x) => x.n));
  const ungrouped = counts.topic.get(-1) || 0;
  return (
    <nav className="atlas-rail" aria-label="ways into this memory">
      <Group title="TOPICS" n={atlas.topics.length} open>
        {atlas.topics.length === 0 ? <p className="atlas-none">No topics yet: a topic needs at least three memories that share a subject.</p> : null}
        <ul className="atlas-ways">
          {atlas.topics.map((t) => {
            const n = counts.topic.get(t.id) || 0;
            return (
              <Way key={t.id} on={filters.topic === t.id} name={t.name} n={n} dim={n === 0} spark={t.spark}
                title={`${t.size} memories. For example: ${t.leadLine}`} onPress={() => onToggle('topic', t.id)} />
            );
          })}
          {atlas.totals.ungrouped ? (
            <Way on={filters.topic === -1} name="No topic" n={ungrouped} dim={ungrouped === 0}
              title="Memories that share too little with the others to belong to a topic" onPress={() => onToggle('topic', -1)} />
          ) : null}
        </ul>
      </Group>
      {atlas.people.length ? (
        <Group title="SPEAKS OF" n={atlas.people.length} open>
          <ul className="atlas-ways">
            {atlas.people.map((p) => {
              const n = counts.person.get(p.name) || 0;
              return (
                <Way key={p.name} on={filters.person === p.name} name={p.name} n={n} dim={n === 0} share={n / most(atlas.people)}
                  title={`Memories that name ${p.name}`} onPress={() => onToggle('person', p.name)} />
              );
            })}
          </ul>
        </Group>
      ) : null}
      <Group title="MONTHS" n={atlas.periods.length} open>
        <ul className="atlas-ways">
          {atlas.periods.map((p) => {
            const n = counts.period.get(p.key) || 0;
            return (
              <Way key={p.key} on={filters.period === p.key} name={monthWords(p.key)} n={n} dim={n === 0} share={n / most(atlas.periods)}
                title={`Memories from ${monthWords(p.key)}`} onPress={() => onToggle('period', p.key)} />
            );
          })}
        </ul>
      </Group>
      <Group title="KINDS" n={atlas.kinds.length} open>
        <ul className="atlas-ways">
          {atlas.kinds.map((k) => {
            const n = counts.kind.get(k.kind) || 0;
            return (
              <Way key={k.kind} on={filters.kind === k.kind} name={kindWords(k.kind)} n={n} dim={n === 0} share={n / most(atlas.kinds)}
                title="Memories of this kind" onPress={() => onToggle('kind', k.kind)} />
            );
          })}
        </ul>
      </Group>
    </nav>
  );
};
