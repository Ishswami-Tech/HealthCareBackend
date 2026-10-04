/**
 * Unit tests for omitNullishFields: POST /profile/completion/update must not
 * forward explicit nulls (allowed by PartialType's @IsOptional) to the user update.
 */

import { omitNullishFields } from '@dtos/profile-completion.dto';

describe('omitNullishFields', () => {
  it('drops null and undefined values but keeps every real value', () => {
    expect(
      omitNullishFields({
        firstName: 'Asha',
        lastName: null,
        phone: undefined,
        address: '',
        isActive: false,
        age: 0,
      })
    ).toEqual({ firstName: 'Asha', address: '', isActive: false, age: 0 });
  });

  it('returns an empty object for an all-null payload', () => {
    expect(omitNullishFields({ firstName: null, lastName: null })).toEqual({});
  });

  it('does not mutate its input', () => {
    const input = { firstName: null, lastName: 'Rao' };
    omitNullishFields(input);
    expect(input).toEqual({ firstName: null, lastName: 'Rao' });
  });
});
