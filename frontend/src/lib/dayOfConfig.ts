// Centralised day-of config constants. Edit values here when GPP URLs / sponsor details change.
//
// TODO(snax): set ZOOM_URL and STREAMYARD_URL before GPP day. While set to TODO_*,
// the BroadcastJoinCard renders both buttons disabled with a "Coming soon" subtitle.

export const ZOOM_URL = 'TODO_ZOOM_URL';
export const STREAMYARD_URL = 'TODO_STREAMYARD_URL';

export const isBroadcastUrlReady = (url: string): boolean =>
  !url.startsWith('TODO_') && url.length > 0;
