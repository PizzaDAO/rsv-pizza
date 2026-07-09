// napoletana-58547: tz-lookup ships no bundled types. It default-exports a
// single synchronous fn: (lat, lng) => IANA timezone id (e.g. "America/New_York").
declare module 'tz-lookup' {
  export default function tzlookup(lat: number, lng: number): string;
}
