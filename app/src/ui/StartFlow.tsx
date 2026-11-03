import { useState } from 'react';
import { BackendError, type Backend } from '../backend/types.ts';
import { decodeRecoveryCode } from '@core/recovery.ts';
import { errorCopy } from './errors.ts';

type Step = 'choose' | 'invite' | 'recover' | 'code' | 'welcome';

/** Groups of four, for reading and writing the code down. */
function groups(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1 ').toUpperCase();
}

export function StartFlow({ backend, onDone }: { backend: Backend; onDone: (kind: 'new' | 'returning') => void }) {
  const [step, setStep] = useState<Step>('choose');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [copyNote, setCopyNote] = useState<string | null>(null);

  const go = (s: Step) => { setStep(s); setText(''); setError(null); };

  const redeem = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const wasMember = (await backend.getSession().catch(() => null))?.isMember === true;
      const r = await backend.redeemInvite(text.trim());
      if (wasMember) setStep('welcome'); // already someone: no new code to save
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
        <p className="recovery-code" aria-label="Recovery code">{groups(code)}</p>
        <p className="warn-text">Save this code. Without it your account can't be recovered.</p>
        <button type="button" className="big" onClick={() => void copy()}>Copy</button>
        {copyNote && <p className="hint" role="status">{copyNote}</p>}
        <button type="button" className="primary big" onClick={() => onDone('new')}>I've saved it</button>
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
      <h1>{invite ? 'Enter your invite' : 'Welcome back'}</h1>
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
