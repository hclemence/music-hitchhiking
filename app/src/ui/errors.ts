import { BackendError } from '../backend/types.ts';

/** Plain-language copy for a failed call. */
export function errorCopy(e: unknown): string {
  const code = e instanceof BackendError ? e.code : '';
  switch (code) {
    case 'invalid_invite': return "That invite didn't work";
    case 'bad_code': return "That code didn't work";
    case 'rate_limited': return 'Too many tries — wait a minute and try again';
    case 'suggestion_limit': return 'Wait for them to see your last songs';
    case 'trace_faded': return 'This trace has faded';
    case 'network': return "You're offline — try again when you're connected";
    default: return 'Something went wrong — try again';
  }
}
