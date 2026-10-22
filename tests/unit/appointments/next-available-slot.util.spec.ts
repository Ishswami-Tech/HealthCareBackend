import { describe, expect, it } from '@jest/globals';
import {
  NEXT_SLOT_SEARCH_DAYS,
  addDaysToDateKey,
  findNextAvailableSlot,
  formatNextAvailableLabel,
  isDefaultWorkingDateKey,
  noSlotTodayMessage,
} from '@services/appointments/in-person/next-available-slot.util';
import { isBookableDay } from '@utils/clinic-working-days.util';

const TODAY = '2026-10-22';

/** A fake availability grid: free slots per IST day key, every other day closed / full. */
function grid(days: Record<string, string[]>) {
  const asked: string[] = [];
  const loadFreeSlots = async (dateKey: string): Promise<readonly string[]> => {
    asked.push(dateKey);
    return days[dateKey] ?? [];
  };
  return { asked, loadFreeSlots };
}

const search = (loadFreeSlots: (d: string) => Promise<readonly string[]>) => ({
  fromDateKey: TODAY,
  doctorId: 'doc-1',
  locationId: 'loc-a',
  loadFreeSlots,
});

describe('next available in-person slot', () => {
  it('today full: offers the earliest slot of the next day (today itself is never searched)', async () => {
    const g = grid({ [TODAY]: ['18:00'], '2026-10-23': ['10:03', '10:00', '17:00'] });
    await expect(findNextAvailableSlot(search(g.loadFreeSlots))).resolves.toEqual({
      date: '2026-10-23',
      time: '10:00',
      doctorId: 'doc-1',
      locationId: 'loc-a',
    });
    expect(g.asked).toEqual(['2026-10-23']);
  });

  it('skips days with no free slot (doctor leave, clinic holiday, closed day)', async () => {
    // Fri 23 on leave / holiday: the grid returns nothing; Sat 24 and Sun 25 are never asked.
    const g = grid({ '2026-10-26': ['11:00'], '2026-10-27': ['09:00'] });
    const next = await findNextAvailableSlot(search(g.loadFreeSlots));
    expect(next).toMatchObject({ date: '2026-10-26', time: '11:00' });
    expect(g.asked).toEqual(['2026-10-23', '2026-10-26']);
  });

  it('default working days (no clinic rule given): never offers a weekend slot', async () => {
    const g = grid({ '2026-10-24': ['10:00'], '2026-10-25': ['10:00'], '2026-10-26': ['12:00'] });
    const next = await findNextAvailableSlot(search(g.loadFreeSlots));
    expect(next).toMatchObject({ date: '2026-10-26', time: '12:00' });
    expect(isDefaultWorkingDateKey('2026-10-24')).toBe(false);
    expect(isDefaultWorkingDateKey('2026-10-25')).toBe(false);
    expect(isDefaultWorkingDateKey('2026-10-26')).toBe(true);
  });

  it('uses the clinic working-day rule it is given (a clinic open on Saturday)', async () => {
    const g = grid({ '2026-10-24': ['10:00'], '2026-10-26': ['12:00'] });
    const openSaturday = (dateKey: string) =>
      isBookableDay({
        dateKey,
        clinicSettings: {
          appointmentSettings: {
            workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
          },
        },
      });
    const next = await findNextAvailableSlot({
      ...search(g.loadFreeSlots),
      isOpenDay: openSaturday,
    });
    expect(next).toMatchObject({ date: '2026-10-24', time: '10:00' });
    // Fri 23 asked (nothing free), Sat 24 asked and taken; Sunday never reached.
    expect(g.asked).toEqual(['2026-10-23', '2026-10-24']);
  });

  it('crosses month ends', async () => {
    const g = grid({ '2026-11-02': ['09:00'] });
    const next = await findNextAvailableSlot({
      ...search(g.loadFreeSlots),
      fromDateKey: '2026-10-30',
    });
    expect(next).toMatchObject({ date: '2026-11-02', time: '09:00' });
  });

  it('nothing free in the next 14 days: null, and day 15 is never read', async () => {
    const g = grid({ '2026-11-06': ['09:00'] }); // day 15
    await expect(findNextAvailableSlot(search(g.loadFreeSlots))).resolves.toBeNull();
    // 14 calendar days ahead = 10 weekdays (two weekends skipped).
    expect(NEXT_SLOT_SEARCH_DAYS).toBe(14);
    expect(g.asked).toHaveLength(10);
    expect(g.asked[g.asked.length - 1]).toBe('2026-11-05');
  });

  it('ignores malformed slot values', async () => {
    const g = grid({ '2026-10-23': ['', '9:00', '25:00', '12:15'] });
    const next = await findNextAvailableSlot(search(g.loadFreeSlots));
    expect(next?.time).toBe('12:15');
  });

  it('formats the offer for the desk', () => {
    expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(formatNextAvailableLabel('2026-10-23', '10:00')).toBe('Fri 23 Oct, 10:00 AM');
    expect(formatNextAvailableLabel('2026-10-24', '12:05')).toBe('Sat 24 Oct, 12:05 PM');
    expect(formatNextAvailableLabel('2026-10-24', '00:30')).toBe('Sat 24 Oct, 12:30 AM');
    expect(
      noSlotTodayMessage(
        { date: '2026-10-23', time: '10:00', doctorId: 'd', locationId: 'l' },
        'fallback'
      )
    ).toBe('No free slot left today. Next available: Fri 23 Oct, 10:00 AM.');
    expect(noSlotTodayMessage(null, 'fallback')).toBe('fallback');
  });
});
