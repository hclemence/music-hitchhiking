/**
 * One encounter at a time: a pause after you arrive, then the nearest ship you have not met at
 * this stop flies to you and a pop-up opens. Wait reveals the next one. All ids are dock ids.
 */

export const ARRIVAL_DELAY_MS = 1500;
export const FLY_IN_MS = 1200;
export const WAIT_DRIFT_MS = 800;
export const MAX_PARKED = 4;

export type EncounterPhase = 'idle' | 'pending' | 'arriving' | 'shown' | 'none';
export type EncounterFlowState = {
  /** The stop (hop) this state is about. */
  hopId: string | null;
  phase: EncounterPhase;
  /** Wall-clock ms (Date.now()) at which the next reveal is due, while pending. */
  dueAt: number | null;
  /** The latest revealed dock. */
  current: string | null;
  /** Docks met at this stop, beside your ship, oldest first (at most MAX_PARKED). */
  parked: string[];
  /** The dock whose pop-up is open. */
  popup: string | null;
  /** The pending reveal was asked for with Wait (your ship drifts meanwhile). */
  waiting: boolean;
};

export type EncounterFlowAction =
  | { type: 'arrived'; hopId: string; now: number }
  | { type: 'waitPressed'; now: number }
  | { type: 'revealed'; hopId: string; dockId: string | null; now: number }
  | { type: 'flyInDone'; dockId: string }
  | { type: 'closePopup' }
  | { type: 'openPopup'; dockId: string };

export const initialEncounterFlow: EncounterFlowState = {
  hopId: null, phase: 'idle', dueAt: null, current: null, parked: [], popup: null, waiting: false,
};

export const arrived = (hopId: string, now: number): EncounterFlowAction => ({ type: 'arrived', hopId, now });
export const waitPressed = (now: number): EncounterFlowAction => ({ type: 'waitPressed', now });
export const revealed = (hopId: string, dockId: string | null, now: number): EncounterFlowAction =>
  ({ type: 'revealed', hopId, dockId, now });
export const flyInDone = (dockId: string): EncounterFlowAction => ({ type: 'flyInDone', dockId });
export const closePopup = (): EncounterFlowAction => ({ type: 'closePopup' });
export const openPopup = (dockId: string): EncounterFlowAction => ({ type: 'openPopup', dockId });

export function encounterFlowReducer(s: EncounterFlowState, a: EncounterFlowAction): EncounterFlowState {
  switch (a.type) {
    case 'arrived':
      return { hopId: a.hopId, phase: 'pending', dueAt: a.now + ARRIVAL_DELAY_MS, current: null, parked: [], popup: null, waiting: false };
    case 'waitPressed':
      // During the fly-in the ship lands first; Wait is offered again once it has.
      if (s.hopId === null || s.phase === 'arriving') return s;
      return { ...s, phase: 'pending', dueAt: a.now + WAIT_DRIFT_MS, waiting: true };
    case 'revealed':
      if (a.hopId !== s.hopId) return s;
      if (a.dockId === null) return { ...s, phase: 'none', dueAt: null, popup: null, waiting: false };
      return {
        ...s,
        phase: 'arriving',
        dueAt: null,
        waiting: false,
        current: a.dockId,
        parked: [...s.parked.filter((d) => d !== a.dockId), a.dockId].slice(-MAX_PARKED),
        popup: a.dockId,
      };
    case 'flyInDone':
      return s.phase === 'arriving' && s.current === a.dockId ? { ...s, phase: 'shown' } : s;
    case 'closePopup':
      if (s.phase === 'none') return { ...s, phase: 'idle', popup: null };
      return s.popup === null ? s : { ...s, popup: null };
    case 'openPopup':
      return s.parked.includes(a.dockId) ? { ...s, popup: a.dockId } : s;
  }
}
