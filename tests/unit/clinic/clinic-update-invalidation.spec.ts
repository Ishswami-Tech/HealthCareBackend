/// <reference types="jest" />
/**
 * PUT /clinics/:id must clear every cache tag GET /clinics/:id registers.
 *
 * GET /clinics/:id is cached for an hour with stale-while-revalidate under tags `clinics` and
 * `clinic:{id}`. PUT /clinics/:id used to invalidate only `user_clinic`, so after an admin saved
 * the clinic settings (e.g. turned in-person consultations off) the screen's immediate reload,
 * and every booking screen, kept reading the old settings until a background revalidation.
 *
 * Reads the controller source (like invalidation-safety.spec.ts) instead of importing it, which
 * would pull in the whole Nest module graph.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTagTemplates } from '@core/interceptors/cache-key-scope.util';
import { scopeInvalidationTags } from '@infrastructure/cache/utils/tag-scope.util';

const CONTROLLER = join(__dirname, '../../../src/services/clinic/clinic.controller.ts');
const source = readFileSync(CONTROLLER, 'utf8');

/** The decorator block between `@<verb>('<path>')` and the method it decorates. */
function decoratorBlock(verb: 'Get' | 'Put', path: string): string {
  const start = source.indexOf(`@${verb}('${path}')`);
  if (start < 0) throw new Error(`@${verb}('${path}') not found`);
  const end = source.indexOf('async ', start);
  return source.slice(start, end);
}

function tagsIn(block: string, decorator: 'Cache' | 'InvalidateCache'): string[] {
  const options = new RegExp(`@${decorator}\\(\\{([\\s\\S]*?)\\}\\)`).exec(block)?.[1] ?? '';
  const list = /tags:\s*\[([^\]]*)\]/.exec(options)?.[1] ?? '';
  return Array.from(list.matchAll(/'([^']*)'/g), match => match[1] ?? '');
}

describe('PUT /clinics/:id cache invalidation', () => {
  const readTags = tagsIn(decoratorBlock('Get', ':id'), 'Cache');
  const writeTags = tagsIn(decoratorBlock('Put', ':id'), 'InvalidateCache');

  it('finds the GET cache tags this test protects', () => {
    expect(readTags).toEqual(expect.arrayContaining(['clinics', 'clinic:{id}']));
  });

  it('invalidates every tag GET /clinics/:id is cached under', () => {
    for (const tag of readTags) {
      expect(writeTags).toContain(tag);
    }
  });

  it('keeps invalidating the my-clinic view', () => {
    expect(writeTags).toContain('user_clinic');
  });

  it('resolves clinic:{id} to the clinic being updated, whatever clinic the admin is in', () => {
    const clinicId = '709c1ef5-00b9-480b-82b7-82c6759ec461';
    const request = {
      method: 'PUT',
      url: `/api/v1/clinics/${clinicId}`,
      headers: {},
      params: { id: clinicId },
      body: {},
    };
    const resolved = resolveTagTemplates(writeTags, request as never, true);
    expect(resolved).toContain(`clinic:${clinicId}`);
    // An entity tag is never re-scoped to the caller's own clinic.
    const scoped = scopeInvalidationTags(resolved, 'another-clinic-id');
    expect(scoped).toContain(`clinic:${clinicId}`);
  });
});
