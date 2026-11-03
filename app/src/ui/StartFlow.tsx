import { useState } from 'react';
import { BackendError, RECOVERY_CODE_KEY, RECOVERY_SAVED_KEY, type Backend } from '../backend/types.ts';
import { decodeRecoveryCode } from '@core/recovery.ts';
import { errorCopy } from './errors.ts';

type Step = 'choose' | 'invite' | 'recover' | 'code' | 'welcome';

/** Groups of four, for reading and writing the code down. */
function groups(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1 ').toUpperCase();
}

export { RECOVERY_SAVED_KEY };

type Props = {
  backend: Backend;
  onDone: (kind: 'new' | 'returning') => void;
  storage?: Storage;
  /** A code that was shown but never confirmed saved (the page was reloaded): show it first. */
  resumeCode?: string;
};

export function StartFlow({ backend, onDone, storage, resumeCode }: Props) {
  const [step, setStep] = useState<Step>(resumeCode ? 'code' : 'choose');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(resumeCode ?? '');
  const [copyNote, setCopyNote] = useState<string | null>(null);

  // Saved (or the account was already set up): the code is no longer needed on this device.
  const markSaved = () => {
    try {
      storage?.setItem(RECOVERY_SAVED_KEY, '1');
      storage?.removeItem(RECOVERY_CODE_KEY);
    } catch { /* blocked */ }
  };

  const go = (s: Step) => { setStep(s); setText(''); setError(null); };

  const redeem = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await backend.redeemInvite(text.trim());
      // A stored code can sign us into an account that already has a home: not a new person.
      const existing = (await backend.getProfile().catch(() => null))?.homeSongId != null;
      if (existing) { markSaved(); setStep('welcome'); }
      else { setCode(r.recoveryCode); setStep('code'); }
    } catch (e) {
      setError(errorCopy(e));
    } finally {
      setBusy(false);
    }
  };

  const recover = async () => {
    if (busy) return;
    if (!decodeRecoveryCode(text)) { setError(errorCopy(new BackendError('bad_code'))); return; }
    setBusy(true);
    setError(null);
    try {
      await backend.recover(text);
      markSaved();
      onDone('returning');
    } catch (e) {
      setError(errorCopy(e));
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('unavailable');
      await navigator.clipboard.writeText(code);
      setCopyNote('Copied');
    } catch {
      setCopyNote("Couldn't copy here. Select the code and copy it by hand.");
    }
  };

  if (step === 'code') {
    return (
      <main className="start">
        <h1>Your recovery code</h1>
        <div className="recovery-code" role="group" aria-label="Recovery code">{groups(code)}</div>
        <p className="warn-text">Save this code. Without it your account can't be recovered.</p>
        <button type="button" className="big" onClick={() => void copy()}>Copy</button>
        {copyNote && <p className="hint" role="status">{copyNote}</p>}
        <button type="button" className="primary big" onClick={() => { markSaved(); onDone('new'); }}>I've saved it</button>
      </main>
    );
  }
  if (step === 'welcome') {
    return (
      <main className="start">
        <h1>Welcome back</h1>
        <p>You're signed in on this phone.</p>
        <button type="button" className="primary big" onClick={() => onDone('returning')}>Continue</button>
      </main>
    );
  }
  if (step === 'choose') {
    return (
      <main className="start">
        <h1>Music Hitchhiking</h1>
        <p>Songs are stars. Dock your ship at one, then hitchhike with others.</p>
        <button type="button" className="primary big" onClick={() => go('invite')}>I have an invite</button>
        <button type="button" className="secondary big" onClick={() => go('recover')}>I have a recovery code</button>
      </main>
    );
  }
  const invite = step === 'invite';
  return (
    <main className="start">
      <h1>{invite ? 'Enter your invite' : 'Sign in with your code'}</h1>
      <form
        className="start-form"
        onSubmit={(e) => { e.preventDefault(); void (invite ? redeem() : recover()); }}
      >
        <label>
          {invite ? 'Invite code' : 'Recovery code'}
          <input
            value={text} onChange={(e) => setText(e.target.value)} autoFocus
            autoCapitalize="off" autoCorrect="off" spellCheck={false}
            className={invite ? '' : 'mono'}
          />
        </label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button type="submit" className="primary big" disabled={busy || !text.trim()}>
          {invite ? 'Continue' : 'Sign in'}
        </button>
        <button type="button" className="secondary big" onClick={() => go('choose')}>Back</button>
      </form>
    </main>
  );
}
