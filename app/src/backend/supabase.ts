import type { SupabaseClient } from '@supabase/supabase-js';
import { SHIP_COLOURS } from '@core/palette.ts';
import {
  decodeRecoveryCode,
  encodeRecoveryCode,
  recoveryEmail,
  secretFromBase32,
  secretToBase32,
} from '@core/recovery.ts';
import type { PublicDock } from '@core/types.ts';
import {
  BackendError, RECOVERY_CODE_KEY, RECOVERY_SAVED_KEY,
  type Backend, type Hop, type InboxItem, type Journey, type Profile, type Region, type Song, type Trace,
} from './types.ts';

export { RECOVERY_CODE_KEY };
const GET_SONGS_CHUNK = 200;
const PAGE = 1000;
/** Server answers that prove the redeem did not happen (so a stored recovery code is useless). */
const DEFINITIVE_REJECTIONS = new Set(['invalid_invite', 'bad_secret', 'unauthorized']);

type Row = Record<string, unknown>;
type ErrorLike = { message?: string; code?: string; name?: string; status?: number } | null | undefined;
type Res<T> = { data: T | null; error: ErrorLike; status?: number };

const CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

function isNetworkError(e: ErrorLike | unknown): boolean {
  if (e instanceof TypeError) return true;
  const x = (e ?? {}) as NonNullable<ErrorLike>;
  if (x.name === 'AuthRetryableFetchError' || x.name === 'FunctionsFetchError') return true;
  return !x.code && (x.status === 0 || /fetch|network|load failed|failed to connect/i.test(x.message ?? ''));
}

/** RPC errors carry the code as their message (`journey_exists`); fetch failures become `network`. */
function toBackendError(e: ErrorLike | unknown): BackendError {
  if (e instanceof BackendError) return e;
  if (isNetworkError(e)) return new BackendError('network');
  const x = (e ?? {}) as NonNullable<ErrorLike>;
  if (x.message && CODE_PATTERN.test(x.message)) return new BackendError(x.message);
  return new BackendError('unknown', x.message);
}

async function run<T>(op: PromiseLike<Res<T>>): Promise<T> {
  let res: Res<T>;
  try {
    res = await op;
  } catch (e) {
    throw toBackendError(e);
  }
  if (res.error) {
    // postgrest-js reports a failed fetch as status 0 with an empty code and a "TypeError: ..." message.
    if (res.status === 0 || (!res.error.code && /^TypeError/.test(res.error.message ?? ''))) {
      throw new BackendError('network');
    }
    throw toBackendError(res.error);
  }
  return res.data as T;
}

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function toSong(r: Row): Song {
  return {
    id: str(r.id), title: str(r.title), artist: str(r.artist),
    x: Number(r.x), y: Number(r.y), z: Number(r.z),
    regionId: Number(r.region_id), localRadius: Number(r.local_radius), brightness: Number(r.brightness),
    spotifyUrl: str(r.spotify_url), appleUrl: str(r.apple_url), youtubeUrl: str(r.youtube_url),
  };
}

function toHop(r: Row): Hop {
  return {
    id: str(r.id), parentHopId: strOrNull(r.parent_hop_id), songId: str(r.song_id),
    kind: r.kind as Hop['kind'], createdAt: str(r.created_at),
  };
}

export function createSupabaseBackend(client: SupabaseClient, storage: Storage): Backend {
  const rpc = <T>(fn: string, args?: Record<string, unknown>): Promise<T> =>
    run<T>(client.rpc(fn, args) as unknown as PromiseLike<Res<T>>);
  const select = async (table: string, columns: string, filter?: (q: any) => any): Promise<Row[]> => {
    const q = client.from(table).select(columns);
    return (await run<Row[]>((filter ? filter(q) : q) as PromiseLike<Res<Row[]>>)) ?? [];
  };
  /** Every row, in pages, so a server-side max_rows below the table size cannot truncate silently. */
  const selectAll = async (table: string, columns: string): Promise<Row[]> => {
    const out: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      const page = await select(table, columns, (q) => q.order('id').range(from, from + PAGE - 1));
      out.push(...page);
      if (page.length < PAGE) return out;
    }
  };

  async function userId(): Promise<string> {
    let data: Awaited<ReturnType<typeof client.auth.getSession>>['data'];
    try {
      ({ data } = await client.auth.getSession());
    } catch (e) {
      throw toBackendError(e);
    }
    if (!data.session) throw new BackendError('not_signed_in');
    return data.session.user.id;
  }

  async function signInWithCode(code: string): Promise<void> {
    const decoded = decodeRecoveryCode(code);
    if (!decoded) throw new BackendError('bad_code');
    let res;
    try {
      res = await client.auth.signInWithPassword({
        email: recoveryEmail(decoded.userId), password: decoded.secret,
      });
    } catch (e) {
      throw toBackendError(e);
    }
    if (res.error) {
      if (res.error.status === 429) throw new BackendError('rate_limited');
      throw isNetworkError(res.error) ? new BackendError('network') : new BackendError('bad_code');
    }
  }

  async function readJourney(tz: string): Promise<Journey | null> {
    const rows = await rpc<Row[]>('current_journey', { p_tz: tz });
    const j = rows?.[0];
    if (!j) return null;
    const hops = await select('hops', 'id, parent_hop_id, song_id, kind, created_at',
      (q) => q.eq('journey_id', j.journey_id).order('created_at', { ascending: true }));
    return { id: str(j.journey_id), currentHopId: str(j.current_hop_id), hops: hops.map(toHop) };
  }

  return {
    mode: 'live',

    async getSession() {
      let session;
      try {
        ({ data: { session } } = await client.auth.getSession());
      } catch (e) {
        throw toBackendError(e);
      }
      if (!session) return null;
      const rows = await select('profiles', 'user_id', (q) => q.eq('user_id', session.user.id));
      return { isMember: rows.length === 1 };
    },

    async redeemInvite(code) {
      // Fail before any network call if the recovery code could not be kept.
      try {
        storage.setItem(RECOVERY_CODE_KEY + '.probe', '1');
        storage.removeItem(RECOVERY_CODE_KEY + '.probe');
      } catch {
        throw new BackendError('storage');
      }
      const stored = storage.getItem(RECOVERY_CODE_KEY);

      let hadSession: boolean;
      try {
        hadSession = Boolean((await client.auth.getSession()).data.session);
      } catch (e) {
        throw toBackendError(e);
      }
      if (!hadSession && stored) {
        // A fresh session after a lost response: the stored code may already be the member's login.
        try {
          await signInWithCode(stored);
          return { recoveryCode: stored };
        } catch (e) {
          // Never replace a stored code while we cannot tell whether it works.
          if (!(e instanceof BackendError) || e.code !== 'bad_code') throw e;
        }
      }
      try {
        if (!hadSession) {
          const anon = await client.auth.signInAnonymously();
          if (anon.error) throw anon.error;
        }
      } catch (e) {
        throw toBackendError(e);
      }
      const id = await userId();

      // Reuse the stored secret for this user: the server may already hold it from a lost response.
      let recoveryCode: string;
      let secret: string;
      const decoded = stored ? decodeRecoveryCode(stored) : null;
      if (stored && decoded && decoded.userId === id && secretFromBase32(decoded.secret)) {
        recoveryCode = stored;
        secret = decoded.secret;
      } else {
        const bytes = globalThis.crypto.getRandomValues(new Uint8Array(10));
        recoveryCode = encodeRecoveryCode(id, bytes);
        secret = secretToBase32(bytes);
        // Stored BEFORE the call: if the response is lost the code still signs in as the new member.
        // A fresh code is not saved yet, whatever an earlier account's flag says.
        try {
          storage.setItem(RECOVERY_CODE_KEY, recoveryCode);
          storage.removeItem(RECOVERY_SAVED_KEY);
        } catch {
          throw new BackendError('storage');
        }
      }

      let failure: BackendError | null = null;
      try {
        const res = await client.functions.invoke('redeem-invite', { body: { code, secret } });
        if (res.error) {
          const err = res.error as { name?: string; context?: unknown };
          if (err.name === 'FunctionsHttpError' && err.context instanceof Response) {
            const body = (await err.context.json().catch(() => null)) as { error?: unknown } | null;
            let c = typeof body?.error === 'string' && CODE_PATTERN.test(body.error) ? body.error : 'unknown';
            if (c === 'unknown' && err.context.status === 401) c = 'unauthorized';
            failure = new BackendError(c);
          } else if (err.name === 'FunctionsRelayError') {
            failure = new BackendError('unknown');
          } else {
            failure = toBackendError(err);
          }
        }
      } catch (e) {
        failure = toBackendError(e);
      }

      // Success, or any failure where the server state is unknown: the stored code may already work.
      let signInCode: string;
      try {
        await signInWithCode(recoveryCode);
        return { recoveryCode };
      } catch (signInError) {
        if (!failure) throw signInError;
        signInCode = signInError instanceof BackendError ? signInError.code : 'unknown';
      }
      // Remove the stored code only after a definitive pre-redeem rejection AND proof that it does
      // not sign in (bad_code). A network or rate-limit failure proves nothing: keep it.
      if (DEFINITIVE_REJECTIONS.has(failure.code) && signInCode === 'bad_code') {
        try { storage.removeItem(RECOVERY_CODE_KEY); } catch { /* blocked */ }
      }
      throw failure;
    },

    async recover(code) {
      await signInWithCode(code);
      // Signed in with a code the person has: an unconfirmed stored code is no longer needed.
      try { storage.removeItem(RECOVERY_CODE_KEY); } catch { /* blocked */ }
    },

    async loadMap() {
      const [stars, docks, regions] = await Promise.all([
        selectAll('active_stars', '*'),
        selectAll('public_docks', '*'),
        selectAll('map_regions', '*'),
      ]);
      return {
        stars: stars.map(toSong),
        docks: docks.map((d): PublicDock => ({
          id: str(d.id), songId: str(d.song_id), isSample: Boolean(d.is_sample),
          shipColour: str(d.ship_colour), updatedAt: str(d.updated_at),
        })),
        regions: regions.map((r): Region => ({
          id: Number(r.id), x: Number(r.x), y: Number(r.y), z: Number(r.z),
          adjacent: ((r.adjacent as number[] | null) ?? []).map(Number),
        })),
      };
    },
    async getSongs(ids) {
      const out: Song[] = [];
      for (let i = 0; i < ids.length; i += GET_SONGS_CHUNK) {
        const rows = await rpc<Row[]>('get_songs', { p_ids: ids.slice(i, i + GET_SONGS_CHUNK) });
        out.push(...(rows ?? []).map(toSong));
      }
      return out;
    },
    async searchSongs(q) {
      if (q.trim().length < 2) return [];
      return ((await rpc<Row[]>('search_songs', { p_query: q })) ?? []).map(toSong);
    },

    async getProfile() {
      const id = await userId();
      const rows = await select('profiles', 'home_song_id, colour_seed, ship_colour', (q) => q.eq('user_id', id));
      const p = rows[0];
      if (!p) throw new BackendError('not_member');
      const profile: Profile = {
        homeSongId: strOrNull(p.home_song_id), colourSeed: str(p.colour_seed),
        shipColour: strOrNull(p.ship_colour) ?? SHIP_COLOURS[0],
      };
      return profile;
    },
    async getMyDock() {
      const d = (await select('my_dock', 'id, song_id'))[0];
      return d ? { id: str(d.id), songId: str(d.song_id) } : null;
    },
    async setDock(songId) {
      return str(await rpc<string>('set_dock', { p_song_id: songId }));
    },
    async setHome(songId) {
      await rpc<null>('set_home', { p_song_id: songId });
    },
    async setShipColour(c) {
      await rpc<null>('set_ship_colour', { p_colour: c });
    },

    currentJourney: (tz) => readJourney(tz),
    async startJourney(tz, songId) {
      await rpc<string>('start_journey', { p_tz: tz, p_song_id: songId });
      const j = await readJourney(tz);
      if (!j) throw new BackendError('unknown');
      return j;
    },
    async hop(tz, parentHopId, songId, kind) {
      const id = await rpc<string>('hop', {
        p_tz: tz, p_parent_hop_id: parentHopId, p_song_id: songId, p_kind: kind,
      });
      return { id: str(id), parentHopId, songId, kind, createdAt: new Date().toISOString() };
    },
    async moveTo(tz, hopId) {
      await rpc<null>('move_to', { p_tz: tz, p_hop_id: hopId });
    },

    async likeDock(dockId) {
      return strOrNull(await rpc<string | null>('like_dock', { p_dock_id: dockId }));
    },
    async getTraces() {
      const rows = await select('my_traces', 'id, origin_song_id, origin_title, origin_artist, ship_colour, brightness');
      return rows.map((r): Trace => ({
        id: str(r.id), originSongId: str(r.origin_song_id), originTitle: str(r.origin_title),
        originArtist: str(r.origin_artist), shipColour: strOrNull(r.ship_colour) ?? SHIP_COLOURS[0],
        brightness: Number(r.brightness),
      }));
    },
    async findTrace(traceId) {
      return strOrNull(await rpc<string | null>('find_trace', { p_trace_id: traceId }));
    },
    async sendSuggestion(traceId, songId) {
      await rpc<string>('send_suggestion', { p_trace_id: traceId, p_song_id: songId });
    },
    async getInbox() {
      const rows = await select('my_inbox', '*', (q) => q.order('created_at', { ascending: false }));
      return rows.map((r): InboxItem => ({
        id: str(r.id), kind: r.kind as InboxItem['kind'], songId: str(r.song_id),
        title: str(r.title), artist: str(r.artist), shipColour: strOrNull(r.ship_colour),
        replyTraceId: strOrNull(r.reply_trace_id), createdAt: str(r.created_at), seenAt: strOrNull(r.seen_at),
      }));
    },
    async markInboxSeen() {
      await rpc<null>('mark_inbox_seen');
    },
  };
}
