import { describe, expect, it } from 'vitest';
import { stampConceptPageIdentities } from '../src/ingest/identity.ts';

const page = (subject: string, conceptId: string, subjectId: string) => [
  '---', `subject: ${subject}`, `concept_id: ${conceptId}`, `subject_id: ${subjectId}`,
  'family: infrastructure', 'generated:', '  by: llm-wiki-tags', '---', '', `# ${subject}`, '',
].join('\n');

describe('TAXO concept-page identities', () => {
  it('assigns an independent concept identity to a new tag in an existing family', () => {
    const existing = new Map([
      ['wiki/concepts/infrastructure/network.md', page('network', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000011')],
      ['wiki/concepts/infrastructure/security.md', page('security', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000012')],
    ]);
    const [operation] = stampConceptPageIdentities([{
      type: 'create',
      path: 'wiki/concepts/infrastructure/availability.md',
      content: '---\nsubject: availability\nfamily: Infrastructure\ngenerated:\n  by: llm-wiki-tags\n---\n\n# Availability\n',
    }], existing);

    expect(operation?.content).toContain('subject: availability');
    expect(operation?.content).toMatch(/concept_id: ["']?[0-9a-f-]{36}/i);
    expect(operation?.content).toMatch(/subject_id: ["']?[0-9a-f-]{36}/i);
    expect(operation?.content).not.toContain('10000000-0000-4000-8000-000000000001');
    expect(operation?.content).not.toContain('10000000-0000-4000-8000-000000000002');
  });

  it('refuses conflicting concept identities for the same tag, regardless of family path', () => {
    const existing = new Map([
      ['wiki/concepts/networking/network.md', page('network', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000011')],
      ['wiki/concepts/infrastructure/network.md', page('network', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000012')],
    ]);

    expect(() => stampConceptPageIdentities([{
      type: 'create',
      path: 'wiki/concepts/new-family/network.md',
      content: '---\nsubject: network\n---\n\n# Network\n',
    }], existing)).toThrow(/conflicting concept_id/);
  });
});
