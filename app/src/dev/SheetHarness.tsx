import type { Backend, InboxItem, Song, Trace } from '../backend/types.ts';
import { HistoryDrawer } from '../ui/HistoryDrawer.tsx';
import { Inbox } from '../ui/Inbox.tsx';

const song = (n: number): Song => ({
  id: `s${n}`, title: `Song ${n}`, artist: `Artist ${n}`, x: 0, y: 0, z: 0, regionId: 0,
  spotifyUrl: '', appleUrl: '', youtubeUrl: '',
} as unknown as Song);

const traces: Trace[] = [
  { id: 't1', originSongId: 'a', originTitle: 'Blue Monday', originArtist: 'New Order', shipColour: '#ff8844', brightness: 0.9 },
  { id: 't2', originSongId: 'b', originTitle: 'Windowlicker', originArtist: 'Aphex Twin', shipColour: '#44aaff', brightness: 0.6 },
  { id: 't3', originSongId: 'c', originTitle: 'A Very Long Song Title That Should Truncate Nicely', originArtist: 'An Artist With A Long Name', shipColour: '#66dd88', brightness: 0.2 },
];
const inbox: InboxItem[] = [
  { id: 'i1', kind: 'suggestion', songId: 'a', title: 'Teardrop', artist: 'Massive Attack', shipColour: '#ff8844', replyTraceId: 'r1', createdAt: '', seenAt: null },
  { id: 'i2', kind: 'kept', songId: 'b', title: 'Windowlicker', artist: 'Aphex Twin', shipColour: null, replyTraceId: null, createdAt: '', seenAt: null },
  { id: 'i3', kind: 'suggestion', songId: 'c', title: 'Xtal', artist: 'Aphex Twin', shipColour: '#44aaff', replyTraceId: null, createdAt: '', seenAt: '2026-11-03T10:00:00Z' },
];

const backend = {
  mode: 'live',
  getTraces: async () => traces,
  getInbox: async () => inbox,
  markInboxSeen: async () => {},
  findTrace: async () => null,
  sendSuggestion: async () => {},
  searchSongs: async (q: string) => (q.length < 2 ? [] : [song(1), song(2), song(3)]),
} as unknown as Backend;

/** Dev-only: ?sheet=history or ?sheet=inbox renders the sheet content over a stubbed live backend. */
export function SheetHarness({ which }: { which: string }) {
  return (
    <div className="sheet-backdrop overlay">
      <div className="route-sheet screen-sheet" role="dialog" aria-label={which}>
        <div className="route-head"><h2>{which === 'inbox' ? 'Inbox' : 'History'}</h2><button type="button" className="secondary">Close</button></div>
        {which === 'inbox' ? <Inbox backend={backend} onJump={() => {}} /> : <HistoryDrawer backend={backend} onJump={() => {}} />}
      </div>
    </div>
  );
}
