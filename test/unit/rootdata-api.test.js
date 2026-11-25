// RootData's answers as the house reads them (backend/services/sales/rootdata-api.js): the pure parsing, on the shapes
// its own documentation gives (read 2026-11-24). RULE 0: the real module; nothing mocked.
import { describe, expect, it } from 'vitest';
import { projectsOfSearch, projectMatching, projectOf, rootdataWords, rootdataRefusal } from '../../backend/services/sales/rootdata-api.js';

const SEARCH = [
  { introduce: 'Alder is a lending market.', name: 'Alder Finance', logo: 'https://api.rootdata.com/x.jpg', rootdataurl: 'https://api.rootdata.com/Projects/detail/Alder?k=MTI=', id: 12, type: 1 },
  { name: 'Alder Capital', id: 77, type: 2 }, { name: 'Dana Reyes', id: 5, type: 3 }, { name: 'Alderney', id: 13, type: 1 },
];
const ITEM = {
  ecosystem: ['Base'], one_liner: 'A lending market on Base', description: 'Alder Finance lends.', rootdataurl: 'https://api.rootdata.com/Projects/detail/Alder?k=MTI=',
  project_name: 'Alder Finance', investors: [{ name: 'Birch Capital', logo: 'x' }], establishment_date: '2024', tags: ['DeFi', 'Lending'], project_id: 12,
  social_media: { medium: '', website: 'https://alder.example/', twitter: 'https://twitter.com/alderfi', discord: '', linkedin: 'http://www.linkedin.com/company/alder' },
};

describe('what RootData holds for a company', () => {
  it('a search keeps its projects only, and a company is matched by its exact name or its domain\'s label, never a near miss', () => {
    const projects = projectsOfSearch(SEARCH);
    expect(projects.map((p) => [p.id, p.name])).toEqual([[12, 'Alder Finance'], [13, 'Alderney']]);
    expect(projectMatching(projects, { name: 'Alder Finance', domain: 'alder.example' })?.id).toBe(12);
    expect(projectMatching(projects, { name: 'alder-finance', domain: 'x.example' })?.id).toBe(12);
    expect(projectMatching(projects, { name: 'Alder', domain: 'alder.example' })).toBeNull(); // "Alder" is neither project's whole name
    expect(projectMatching(projects, { name: 'Other', domain: 'alderney.example' })?.id).toBe(13);
    expect(projectsOfSearch(null)).toEqual([]);
  });

  it('a project is kept with where it is reached; on a free key it comes with no team, and says so', () => {
    const p = projectOf(ITEM);
    expect(p).toMatchObject({ id: 12, name: 'Alder Finance', founded: '2024', tags: ['DeFi', 'Lending'], ecosystems: ['Base'], investors: ['Birch Capital'], team: [] });
    expect(p.reach).toEqual({ x: 'https://x.com/alderfi', linkedin: 'https://www.linkedin.com/company/alder', site: 'https://alder.example/' });
    expect(rootdataWords(p, 'basic')).toBe('Alder Finance — A lending market on Base (founded 2024)\nTags: DeFi, Lending.\nEcosystems: Base.\nBacked by: Birch Capital.\nReached at: X https://x.com/alderfi · linkedin https://www.linkedin.com/company/alder · site https://alder.example/.\nTeam: none returned — RootData gives team members on its Pro plan only, and this key is on basic.\nSource: https://api.rootdata.com/Projects/detail/Alder?k=MTI=');
  });

  it('a team row is kept only with a name; each carries the handles RootData gives, never an address', () => {
    const p = projectOf({ ...ITEM, team_members: [{ name: 'Dana Reyes', position: 'Co-Founder', X: 'https://twitter.com/danar', linkedin: 'https://www.linkedin.com/in/danar', people_id: 5, email: 'dana@alder.example' }, { website: 'https://alder.example/', twitter: '' }] });
    expect(p.team).toEqual([{ name: 'Dana Reyes', role: 'Co-Founder', x: 'https://x.com/danar', linkedin: 'https://www.linkedin.com/in/danar', peopleId: 5 }]);
    expect(rootdataWords(p, 'pro')).toContain('Team: Dana Reyes (Co-Founder) X https://x.com/danar LinkedIn https://www.linkedin.com/in/danar.');
    expect(projectOf(null)).toBeNull();
  });

  it('a refusal is said in the operator\'s words', () => {
    expect(rootdataRefusal(110)).toBe('RootData refused the key — check it in SETTINGS, API, Lead data');
    expect(rootdataRefusal(403, 'no access')).toBe('RootData: this key\'s plan may not use this part of its API, or its credits are spent (no access)');
    expect(rootdataRefusal(410)).toMatch(/limit for this minute/);
  });
});
