import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const shell = vi.hoisted(() => ({ crash: false }));
const backend = vi.hoisted(() => ({
  mode: 'live' as const,
  getSession: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));
vi.mock('./backend/supabase.ts', () => ({ createSupabaseBackend: () => backend }));
vi.mock('./ui/NoWebGL.tsx', () => ({ NoWebGL: () => null, supportsWebGL2: () => true }));
vi.mock('./ui/Shell.tsx', () => ({
  Shell: () => {
    if (shell.crash) throw new Error('boom');
    return <div>EXPLORE</div>;
  },
}));
vi.mock('./map/ShipPreview.tsx', () => ({ ShipPreview: () => null }));

import { App } from './App.tsx';
import { ErrorBoundary } from './ui/ErrorBoundary.tsx';

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://x.test');
  vi.stubEnv('VITE_BACKEND', '');
  localStorage.clear();
  localStorage.setItem('mh.recoveryCode', 'ABCDEFGHJKMNPQRS');
  backend.getSession.mockResolvedValue({ isMember: true });
  backend.getProfile.mockReset();
  shell.crash = false;
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('App resumed recovery code', () => {
  it('goes to Explore after "I\'ve saved it" when the member already has a home', async () => {
    backend.getProfile.mockResolvedValue({ homeSongId: 'h', colourSeed: 'x', shipColour: '#fff' });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: "I've saved it" }));
    expect(await screen.findByText('EXPLORE')).toBeInTheDocument();
    expect(localStorage.getItem('mh.recoveryCode')).toBeNull();
    expect(localStorage.getItem('mh.recoveryCodeSaved')).toBe('1');
  });

  it('a profile that fails to load offers a retry instead of sending a member to Ship', async () => {
    backend.getProfile
      .mockRejectedValueOnce(Object.assign(new Error('network'), { code: 'network' }))
      .mockResolvedValue({ homeSongId: 'h', colourSeed: 'x', shipColour: '#fff' });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: "I've saved it" }));
    expect(await screen.findByText("Couldn't load your profile.")).toBeInTheDocument();
    expect(screen.queryByText('Choose your ship')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('EXPLORE')).toBeInTheDocument();
    expect(screen.queryByText('Choose your ship')).not.toBeInTheDocument();
  });

  it('goes to Ship when the member has no home yet', async () => {
    backend.getProfile.mockResolvedValue({ homeSongId: null, colourSeed: 'x', shipColour: '#fff' });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: "I've saved it" }));
    expect(await screen.findByText('Choose your ship')).toBeInTheDocument();
  });
});

describe('App error boundary', () => {
  it('a render error shows "Something went wrong" with a Reload button instead of a blank page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.clear();
    shell.crash = true;
    render(<App />);
    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('Reload calls the reload handler', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onReload = vi.fn();
    const Boom = () => { throw new Error('boom'); };
    render(<ErrorBoundary onReload={onReload}><Boom /></ErrorBoundary>);
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
