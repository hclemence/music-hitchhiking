import { describe, expect, it } from 'vitest';
import {
  ARRIVAL_DELAY_MS, FLY_IN_MS, MAX_PARKED, WAIT_DRIFT_MS,
  arrived, closePopup, encounterFlowReducer, flyInDone, initialEncounterFlow, openPopup, revealed, waitPressed,
  type EncounterFlowState,
} from './encounterFlow.ts';

const run = (...actions: Parameters<typeof encounterFlowReducer>[1][]): EncounterFlowState =>
  actions.reduce(encounterFlowReducer, initialEncounterFlow);

describe('encounterFlowReducer', () => {
  it('has the agreed timings', () => {
    expect([ARRIVAL_DELAY_MS, FLY_IN_MS, WAIT_DRIFT_MS, MAX_PARKED]).toEqual([1500, 1200, 800, 4]);
  });

  it('starts idle with nothing parked', () => {
    expect(initialEncounterFlow).toEqual({ hopId: null, phase: 'idle', dueAt: null, current: null, parked: [], popup: null, waiting: false });
  });

  it('arrival goes pending with dueAt = now + ARRIVAL_DELAY_MS and clears the last stop', () => {
    const s = run(arrived('h1', 1000), revealed('h1', 'd1', 2500), arrived('h2', 9000));
    expect(s).toEqual({ hopId: 'h2', phase: 'pending', dueAt: 9000 + ARRIVAL_DELAY_MS, current: null, parked: [], popup: null, waiting: false });
  });

  it('a reveal brings the dock in, parks it and opens its pop-up', () => {
    const s = run(arrived('h1', 1000), revealed('h1', 'd1', 2500));
    expect(s).toEqual({ hopId: 'h1', phase: 'arriving', dueAt: null, current: 'd1', parked: ['d1'], popup: 'd1', waiting: false });
    expect(encounterFlowReducer(s, flyInDone('d1')).phase).toBe('shown');
  });

  it('flyInDone for another dock is ignored', () => {
    const s = run(arrived('h1', 1000), revealed('h1', 'd1', 2500), flyInDone('d0'));
    expect(s.phase).toBe('arriving');
  });

  it('ignores a reveal for a stale hop', () => {
    const before = run(arrived('h1', 1000), arrived('h2', 1200));
    const after = encounterFlowReducer(before, revealed('h1', 'd1', 2500));
    expect(after).toBe(before);
    expect(after.phase).toBe('pending');
  });

  it('a null reveal means nobody is left', () => {
    const s = run(arrived('h1', 1000), revealed('h1', null, 2500));
    expect(s.phase).toBe('none');
    expect(s.popup).toBeNull();
    expect(s.dueAt).toBeNull();
  });

  it('Wait goes pending with the shorter drift delay and keeps what is parked', () => {
    const s = run(arrived('h1', 1000), revealed('h1', 'd1', 2500), flyInDone('d1'), waitPressed(5000));
    expect(s.phase).toBe('pending');
    expect(s.dueAt).toBe(5000 + WAIT_DRIFT_MS);
    expect(s.parked).toEqual(['d1']);
    expect(s.waiting).toBe(true);
    expect(run(arrived('h1', 1000), revealed('h1', 'd1', 2500), flyInDone('d1'), waitPressed(5000), revealed('h1', 'd2', 5800)).waiting).toBe(false);
    expect(run(arrived('h1', 1000)).waiting).toBe(false);
  });

  it('Wait during the fly-in does nothing (the ship lands first)', () => {
    const s = run(arrived('h1', 1000), revealed('h1', 'd1', 2500));
    expect(s.phase).toBe('arriving');
    expect(encounterFlowReducer(s, waitPressed(3000))).toBe(s);
    const landed = encounterFlowReducer(s, flyInDone('d1'));
    expect(encounterFlowReducer(landed, waitPressed(4000)).phase).toBe('pending');
  });

  it('Wait before any arrival does nothing', () => {
    expect(encounterFlowReducer(initialEncounterFlow, waitPressed(5000))).toBe(initialEncounterFlow);
  });

  it('parked keeps the last 4, oldest first', () => {
    const steps = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'].flatMap((d, i) => [waitPressed(2000 + i * 1000), revealed('h1', d, 2800 + i * 1000)]);
    const s = run(arrived('h1', 1000), ...steps);
    expect(s.parked).toEqual(['d3', 'd4', 'd5', 'd6']);
    expect(s.parked).toHaveLength(MAX_PARKED);
    expect(s.current).toBe('d6');
    expect(s.popup).toBe('d6');
  });

  it('openPopup only opens parked docks', () => {
    const s = run(arrived('h1', 1000), revealed('h1', 'd1', 2500), closePopup());
    expect(encounterFlowReducer(s, openPopup('d9'))).toBe(s);
    expect(encounterFlowReducer(s, openPopup('d1')).popup).toBe('d1');
  });

  it('closePopup keeps the ship parked', () => {
    const s = run(arrived('h1', 1000), revealed('h1', 'd1', 2500), flyInDone('d1'), closePopup());
    expect(s.popup).toBeNull();
    expect(s.parked).toEqual(['d1']);
    expect(s.phase).toBe('shown');
  });

  it('closing the nobody-left pop-up goes back to idle; parked ships stay', () => {
    const s = run(arrived('h1', 1000), revealed('h1', 'd1', 2500), waitPressed(4000), revealed('h1', null, 4800), closePopup());
    expect(s.phase).toBe('idle');
    expect(s.parked).toEqual(['d1']);
  });
});
