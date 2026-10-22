import { describe, expect, it } from '@jest/globals';
import { clinicIdsFromQueueKeys } from '@services/appointments/in-person/queue-maintenance.util';

describe('queue maintenance: clinics with a live list today', () => {
  it('reads the clinic of every doctor list of the day, with or without the key prefix', () => {
    const ids = clinicIdsFromQueueKeys(
      [
        'healthcare:queue:clinic:c1:d1:2026-10-22',
        'queue:clinic:c1:d2:2026-10-22',
        'queue:clinic:c2:d1:2026-10-22',
        'queue:clinic:c3:d1:2026-10-21',
        'healthcare:queue:medicine-desk:c4:medicine-desk:c4:2026-10-22',
        'queue:clinic:c5:2026-10-22',
      ],
      '2026-10-22'
    );
    expect(ids.sort()).toEqual(['c1', 'c2']);
  });
});
