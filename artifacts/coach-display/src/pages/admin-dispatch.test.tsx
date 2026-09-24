import { describe, expect, it } from 'vitest';
import {
  assignmentSelectionConflict,
  historyWithoutVisibleActiveAssignments,
  type DispatchAssignment,
} from './admin-dispatch';

const assignment = (overrides: Partial<DispatchAssignment> = {}): DispatchAssignment => ({
  id: 4,
  busNumber: '9923',
  driverId: 'driver-1',
  driverName: 'Driver One',
  officialRunKey: '2026-09-22|1|3|2|225',
  serviceDate: '2026-09-22',
  direction: 'Boro Park → Monsey',
  status: 'ready',
  scheduledDepartureAt: '2026-09-22T01:30:00.000Z',
  assignedAt: '2026-09-21T20:00:00.000Z',
  completedAt: null,
  ...overrides,
});

describe('AdminDispatch conflict preview', () => {
  it('does not invent a conflict before both optional selections are made', () => {
    expect(assignmentSelectionConflict('', '', [assignment()])).toEqual({
      driver: undefined,
      coach: undefined,
      conflict: undefined,
    });
  });

  it('identifies active driver and coach assignments before save', () => {
    const current = assignment();
    expect(assignmentSelectionConflict('driver-1', 'other', [current]).driver).toBe(current);
    expect(assignmentSelectionConflict('driver-2', '9923', [current]).coach).toBe(current);
  });

  it('ignores completed assignment history', () => {
    const completed = assignment({ completedAt: '2026-09-22T04:00:00.000Z' });
    expect(assignmentSelectionConflict('driver-1', '9923', [completed]).conflict).toBeUndefined();
  });
});

describe('AdminDispatch assignment history', () => {
  it('renders one backend assignment once when it is current', () => {
    const current = assignment();
    expect(historyWithoutVisibleActiveAssignments(
      [current],
      [current],
      ['2026-09-22|1|3|2|225'],
    )).toEqual([]);
  });

  it('keeps two distinct assignments, even when their departure times match', () => {
    const current = assignment();
    const distinct = assignment({
      id: 5,
      busNumber: '9924',
      officialRunKey: '2026-09-22|1|3|2|226',
    });
    expect(historyWithoutVisibleActiveAssignments(
      [current, distinct],
      [current],
      ['2026-09-22|1|3|2|225'],
    )).toEqual([distinct]);
  });

  it('does not hide a historical row that only shares a bus or run key', () => {
    const current = assignment();
    const distinct = assignment({ id: 3, completedAt: '2026-09-22T04:00:00.000Z', status: 'completed' });
    expect(historyWithoutVisibleActiveAssignments(
      [current, distinct],
      [current],
      ['2026-09-22|1|3|2|225'],
    )).toEqual([distinct]);
  });
});