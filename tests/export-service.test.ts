import { describe, expect, it } from 'vitest';
import {
  demoteMarkdownHeadings,
  exportOutputPath,
  exportVersionParts,
  extractNumericTokens,
  nextExportVersionNumber,
  sectionValidationIssue,
  stripCitationMarkers,
  versionedExportPath,
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
      'Documented GDPR requirement [src: wiki/concepts/compliance.md].',
      'Targeted certification [ src: wiki/concepts/sovereignty-saas/sovereign-seal-criteria.md ].',
      'Planned audit [  SRC:  wiki/x.md  ].',
    ].join('\n');
    const stripped = stripCitationMarkers(text);
    expect(stripped).not.toMatch(/\[\s*src\s*:/i);
    expect(stripped).toContain('Documented GDPR requirement.');
    expect(stripped).toContain('Targeted certification.');
  });

  it('keeps unrelated bracketed text', () => {
    expect(stripCitationMarkers('See [appendix A] and [RFC 6902].')).toBe(
      'See [appendix A] and [RFC 6902].',
    );
  });
});

describe('section validation', () => {
  const original = [
    'Le service garantit une disponibilité de 99,9 % et une restitution sous 30 jours.',
    'La certification SovereignSeal 3.2 est exigée.',
  ].join('\n');

  it('accepts an expansion that preserves numbers and length', () => {
    const candidate = [
      'Le service garantit une disponibilité de 99,9 % et une restitution sous 30 jours,',
      'conformément au contrat. La certification SovereignSeal 3.2 est exigée et vérifiée',
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
      'La certification SovereignSeal 3.2 est exigée et documentée précisément.';
    expect(sectionValidationIssue(original, candidate, 0.5)).toMatch(/^numbers_lost:/);
  });

  it('ignores digits inside [src: ...] citation markers', () => {
    const cited =
      'La restitution est prévue sous 30 jours. [src: raw/ingested/2c4953e3-demo.md]';
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

/*
 Every export and polish keeps a versioned copy: `<name>_v-YY<kindSuffix>.md`.
 The suffix stays on the version so the kind stays recognisable, exports and
 polishes number independently, and a custom output or a version-of-a-version
 is never versioned.
 */
describe('export versioning', () => {
  it('names the first version with a two-digit counter', () => {
    expect(versionedExportPath('deliverables/brief.export.md', 1)).toBe(
      'deliverables/brief_v-01.export.md',
    );
    expect(versionedExportPath('deliverables/brief.export.polished.md', 5)).toBe(
      'deliverables/brief_v-05.export.polished.md',
    );
  });

  it('keeps the folder of the output and pads beyond two digits', () => {
    expect(versionedExportPath('deliverables/technical/brief.export.md', 12)).toBe(
      'deliverables/technical/brief_v-12.export.md',
    );
    expect(versionedExportPath('deliverables/brief.export.md', 100)).toBe(
      'deliverables/brief_v-100.export.md',
    );
  });

  it('never versions a plain name or a versioned copy itself', () => {
    expect(versionedExportPath('deliverables/brief.md', 1)).toBeNull();
    expect(versionedExportPath('deliverables/brief_v-01.export.md', 2)).toBeNull();
    expect(exportVersionParts('deliverables/custom.out.md')).toBeNull();
  });

  it('numbers each kind series from the existing versions, independently', () => {
    // The caller passes listDeliverablePaths, which already excludes .tmp.
    const existing = [
      'deliverables/brief.export.md',
      'deliverables/brief_v-01.export.md',
      'deliverables/brief_v-02.export.md',
      'deliverables/brief_v-01.export.polished.md',
      'deliverables/other_v-07.export.md',
    ];
    expect(nextExportVersionNumber(existing, 'deliverables/brief.export.md')).toBe(3);
    expect(nextExportVersionNumber(existing, 'deliverables/brief.export.polished.md')).toBe(2);
    expect(nextExportVersionNumber(existing, 'deliverables/other.export.md')).toBe(8);
  });

  it('starts at one when nothing was kept yet', () => {
    expect(nextExportVersionNumber([], 'deliverables/brief.export.md')).toBe(1);
    expect(nextExportVersionNumber(['deliverables/unrelated.md'], 'deliverables/brief.export.md')).toBe(1);
    // No kind to hang a version on: never versioned at all.
    expect(nextExportVersionNumber([], 'deliverables/brief.md')).toBeNull();
  });
});
