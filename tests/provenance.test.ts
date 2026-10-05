import { describe, expect, it } from 'vitest';
import { applyProvenance, type PageProvenance } from '../src/ingest/provenance.ts';

describe('applyProvenance — OKF type', () => {
  const provenance: PageProvenance = {
    subject: 'foo',
    scope: 'product',
    kind: 'product',
    tags: [],
  };

  it('writes the OKF type alongside the provenance fields', () => {
    const out = applyProvenance('# Foo\n', provenance, 'product');
    expect(out).toContain('subject: foo');
    expect(out).toContain('type: product');
  });

  it('writes the type even when the provenance is empty', () => {
    const empty: PageProvenance = {
      subject: null, scope: null, kind: null, tags: [],
    };
    const out = applyProvenance('# Bar\n', empty, 'concept');
    expect(out).toContain('type: concept');
  });

  it('never overwrites a manual type', () => {
    const out = applyProvenance('---\ntype: regulation\n---\n# Foo\n', provenance, 'product');
    expect(out).toContain('type: regulation');
    expect(out).not.toContain('type: product');
  });
});
