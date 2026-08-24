import { describe, expect, it } from 'vitest';
import { subjectsAreRelated } from '../src/ingest/provenance.ts';

/*
 Concept-homonym gap (B17): "gamma", "gamma-solution", "gamma-certifications"
 are three different normalized subjects an LLM invented across three
 separately-ingested sources for what is really one product. This function is
 the sole signal deciding whether an existing page is worth showing as a
 reuse candidate before a near-duplicate is created — it must recognize the
 shared root without over-matching on generic short words.
*/
describe('subjectsAreRelated', () => {
  it('matches identical subjects', () => {
    expect(subjectsAreRelated('gamma', 'gamma')).toBe(true);
  });

  it('matches a subject against a compound subject sharing its root', () => {
    expect(subjectsAreRelated('gamma', 'gamma-solution')).toBe(true);
    expect(subjectsAreRelated('gamma-certifications', 'gamma')).toBe(true);
  });

  it('matches two compound subjects sharing only their leading token', () => {
    expect(subjectsAreRelated('securite-et-confidentialite', 'securite-information')).toBe(true);
  });

  it('does not match unrelated subjects', () => {
    expect(subjectsAreRelated('gamma', 'alpha')).toBe(false);
    expect(subjectsAreRelated('pricing-model', 'security-model')).toBe(false);
  });

  it('does not match on a short, generic leading token', () => {
    expect(subjectsAreRelated('de-solution', 'de-tool')).toBe(false);
  });

  it('rejects empty input', () => {
    expect(subjectsAreRelated('', 'gamma')).toBe(false);
    expect(subjectsAreRelated('gamma', '')).toBe(false);
  });
});
