import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Every lenient delegate copied by PrismaService must be a real model in schema.prisma; a name
 * without a model stays undefined at runtime and its endpoints fail with "undefined.findMany".
 * The list is parsed from the source instead of imported, because the service pulls in Nest.
 */
const root = join(__dirname, '..', '..', '..');
const service = readFileSync(
  join(root, 'src/libs/infrastructure/database/prisma/prisma.service.ts'),
  'utf8'
);
const schema = readFileSync(
  join(root, 'src/libs/infrastructure/database/prisma/schema.prisma'),
  'utf8'
);

function lenientDelegates(): string[] {
  const block = /export const LENIENT_MODEL_DELEGATES = \[([\s\S]*?)\] as const;/.exec(service);
  if (!block?.[1]) {
    return [];
  }
  return [...block[1].matchAll(/'([A-Za-z]+)'/g)].map(m => m[1] ?? '');
}

function modelDelegateNames(): Set<string> {
  const names = [...schema.matchAll(/^model\s+([A-Za-z0-9_]+)\s*\{/gm)].map(m => m[1] ?? '');
  return new Set(names.map(n => n.charAt(0).toLowerCase() + n.slice(1)));
}

describe('LENIENT_MODEL_DELEGATES', () => {
  it('is not empty', () => {
    expect(lenientDelegates().length).toBeGreaterThan(0);
  });

  it('only names models that exist in schema.prisma', () => {
    const models = modelDelegateNames();
    const missing = lenientDelegates().filter(name => !models.has(name));
    expect(missing).toEqual([]);
  });

  it('includes the Ayurveda nadi-pariksha delegate that previously stayed undefined', () => {
    expect(lenientDelegates()).toContain('nadiPariksha');
  });

  it('includes every Ayurveda clinical delegate the Ayurveda services read', () => {
    expect(lenientDelegates()).toEqual(
      expect.arrayContaining([
        'nadiParikshaRecord',
        'prakritiAssessment',
        'doshaImbalance',
        'sampraptiStage',
        'ayurvedicDiagnosis',
      ])
    );
  });

  it('has no two schema models sharing one client delegate name', () => {
    // `model NadiPariksha` and `model nadiPariksha` both became `prisma.nadiPariksha`; the
    // legacy one won, so pulse-diagnosis queries hit the wrong table and answered 500.
    const names = [...schema.matchAll(/^model\s+([A-Za-z0-9_]+)\s*\{/gm)].map(m => m[1] ?? '');
    const delegates = names.map(n => n.charAt(0).toLowerCase() + n.slice(1));
    const duplicates = delegates.filter((d, i) => delegates.indexOf(d) !== i);
    expect(duplicates).toEqual([]);
  });
});
