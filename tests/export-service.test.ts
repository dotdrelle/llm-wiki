import { describe, expect, it } from 'vitest';
import {
  demoteMarkdownHeadings,
  exportOutputPath,
  extractNumericTokens,
  sectionValidationIssue,
  stripCitationMarkers,
} from '../src/services/exportService.ts';

describe('heading demotion', () => {
  it('converts headings to bold text outside code fences', () => {
    const input = [
      '### Introduction',
      'Texte.',
      '```',
      '# commentaire code',
      '```',
      '## **Déjà en gras**',
    ].join('\n');
    expect(demoteMarkdownHeadings(input)).toBe(
      ['**Introduction**', 'Texte.', '```', '# commentaire code', '```', '**Déjà en gras**'].join(
        '\n',
      ),
    );
  });
});

describe('citation marker stripping', () => {
  it('removes canonical and space-padded markers', () => {
    const text = [
      'Exigence RGPD documentée [src: wiki/concepts/conformite.md].',
      'Certification visée [ src: wiki/concepts/souverainete-saas/criteres-secnumcloud.md ].',
      'Audit prévu [  SRC:  wiki/x.md  ].',
    ].join('\n');
    const stripped = stripCitationMarkers(text);
    expect(stripped).not.toMatch(/\[\s*src\s*:/i);
    expect(stripped).toContain('Exigence RGPD documentée.');
    expect(stripped).toContain('Certification visée.');
  });

  it('keeps unrelated bracketed text', () => {
    expect(stripCitationMarkers('Voir [annexe A] et [RFC 6902].')).toBe(
      'Voir [annexe A] et [RFC 6902].',
    );
  });
});

describe('section validation', () => {
  const original = [
    'Le service garantit une disponibilité de 99,9 % et une restitution sous 30 jours.',
    'La certification SecNumCloud 3.2 est exigée.',
  ].join('\n');

  it('accepts an expansion that preserves numbers and length', () => {
    const candidate = [
      'Le service garantit une disponibilité de 99,9 % et une restitution sous 30 jours,',
      'conformément au contrat. La certification SecNumCloud 3.2 est exigée et vérifiée',
      "par un audit annuel de l'ANSSI.",
    ].join('\n');
    expect(sectionValidationIssue(original, candidate, 0.5)).toBeUndefined();
  });

  it('rejects empty output', () => {
    expect(sectionValidationIssue(original, '  ', 0.5)).toBe('empty_output');
  });

  it('rejects added headings outside code fences', () => {
    expect(sectionValidationIssue(original, '## Nouvelle section\ntexte', 0.5)).toBe(
      'heading_added',
    );
    const fenced = '```\n# commentaire dans du code\n```\n' + original;
    expect(sectionValidationIssue(original, fenced, 0.5)).toBeUndefined();
  });

  it('rejects content loss below the minimum ratio', () => {
    expect(sectionValidationIssue(original, 'Court résumé sans les chiffres 99,9 % 30 3.2.', 0.9)).toBe(
      'content_loss',
    );
  });

  it('rejects lost numbers', () => {
    const candidate =
      'Le service garantit une haute disponibilité et une restitution rapide. ' +
      'La certification SecNumCloud 3.2 est exigée et documentée précisément.';
    expect(sectionValidationIssue(original, candidate, 0.5)).toMatch(/^numbers_lost:/);
  });

  it('ignores digits inside [src: ...] citation markers', () => {
    const cited =
      'La restitution est prévue sous 30 jours. [src: raw/ingested/2c4953e3-clausier.md]';
    const candidate =
      'La restitution des données est prévue sous 30 jours selon le contrat établi.';
    expect(sectionValidationIssue(cited, candidate, 0.5)).toBeUndefined();
  });

  it('extracts meaningful numeric tokens', () => {
    const tokens = extractNumericTokens('SLA 99,9 %, 30 jours, version 3.2, note 5');
    expect(tokens).toContain('99,9%');
    expect(tokens).toContain('30');
    expect(tokens).toContain('3.2');
    expect(tokens).not.toContain('5');
  });
});

describe('export service', () => {
  it('does not append export twice to already exported deliverables', () => {
    expect(exportOutputPath('deliverables/brief.md')).toBe(
      'deliverables/brief.export.md',
    );
    expect(exportOutputPath('deliverables/brief.export.md')).toBe(
      'deliverables/brief.export.md',
    );
  });

  it('polishes exported deliverables without duplicating suffixes', () => {
    expect(exportOutputPath('deliverables/brief.md', { polish: true })).toBe(
      'deliverables/brief.export.polished.md',
    );
    expect(exportOutputPath('deliverables/brief.export.md', { polish: true })).toBe(
      'deliverables/brief.export.polished.md',
    );
    expect(
      exportOutputPath('deliverables/brief.export.polished.md', { polish: true }),
    ).toBe('deliverables/brief.export.polished.md');
  });
});
