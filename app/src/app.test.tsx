import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const backend = vi.hoisted(() => ({
  mode: 'live' as const,
  getSession: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));
vi.mock('./backend/supabase.ts', () => ({ createSupabaseBackend: () => backend }));
vi.mock('./ui/NoWebGL.tsx', () => ({ NoWebGL: () => null, supportsWebGL2: () => true }));
vi.mock('./ui/Shell.tsx', () => ({ Shell: () => <div>EXPLORE</div> }));
vi.mock('./map/ShipPreview.tsx', () => ({ ShipPreview: () => null }));

import { App } from './App.tsx';

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://x.test');
  vi.stubEnv('VITE_BACKEND', '');
  localStorage.clear();
  localStorage.setItem('mh.recoveryCode', 'ABCDEFGHJKMNPQRS');
  backend.getSession.mockResolvedValue({ isMember: true });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('App resumed recovery code', () => {
  it('goes to Explore after "I\'ve saved it" when the member already has a home', async () => {
    backend.getProfile.mockResolvedValue({ homeSongId: 'h', colourSeed: 'x', shipColour: '#fff' });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: "I've saved it" }));
    expect(await screen.findByText('EXPLORE')).toBeInTheDocument();
  });

  it('goes to Ship when the member has no home yet', async () => {
    backend.getProfile.mockResolvedValue({ homeSongId: null, colourSeed: 'x', shipColour: '#fff' });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: "I've saved it" }));
    expect(await screen.findByText('Choose your ship')).toBeInTheDocument();
  });
});
