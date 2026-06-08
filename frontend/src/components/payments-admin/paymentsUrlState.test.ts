import { describe, it, expect } from 'vitest';
import {
  filtersToSearchParams,
  searchParamsToFilters,
  type ViewMode,
} from './paymentsUrlState';
import type { AdminPayoutFilters } from '../../types';

// panuozzo-92114: mirrors DEFAULT_FILTERS in PaymentsAdminPage.tsx.
const DEFAULT_FILTERS: AdminPayoutFilters = {
  status: 'all',
  payoutMethod: 'all',
  currency: 'all',
  country: 'all',
  tag: 'all',
  purpose: 'all',
  hideClosed: true,
  hideScams: true,
  sort: 'created_desc',
};

describe('filtersToSearchParams', () => {
  it('emits an empty query string for the default view', () => {
    const params = filtersToSearchParams(DEFAULT_FILTERS, 'by-city');
    expect(params.toString()).toBe('');
  });

  it('only emits keys that differ from defaults', () => {
    const params = filtersToSearchParams(
      { ...DEFAULT_FILTERS, payoutMethod: 'wire', search: 'austin' },
      'by-city',
    );
    expect(params.get('method')).toBe('wire');
    expect(params.get('q')).toBe('austin');
    expect(params.get('status')).toBeNull();
    expect(params.get('view')).toBeNull();
  });

  it('emits a comma-list status', () => {
    const params = filtersToSearchParams(
      { ...DEFAULT_FILTERS, status: 'paid,completed' },
      'by-city',
    );
    expect(params.get('status')).toBe('paid,completed');
  });

  it('emits view only when non-default', () => {
    expect(filtersToSearchParams(DEFAULT_FILTERS, 'by-payment').get('view')).toBe('by-payment');
    expect(filtersToSearchParams(DEFAULT_FILTERS, 'payments').get('view')).toBe('payments');
    expect(filtersToSearchParams(DEFAULT_FILTERS, 'by-city').get('view')).toBeNull();
  });

  it('joins regionPortals with commas', () => {
    const params = filtersToSearchParams(
      { ...DEFAULT_FILTERS, regionPortals: ['latam', 'na'] },
      'by-city',
    );
    expect(params.get('regions')).toBe('latam,na');
  });

  it('default-TRUE booleans: only emits =0 when turned OFF', () => {
    // default (true) -> no key
    expect(filtersToSearchParams(DEFAULT_FILTERS, 'by-city').get('hideClosed')).toBeNull();
    expect(filtersToSearchParams(DEFAULT_FILTERS, 'by-city').get('hideScams')).toBeNull();
    // turned off -> =0
    const off = filtersToSearchParams(
      { ...DEFAULT_FILTERS, hideClosed: false, hideScams: false },
      'by-city',
    );
    expect(off.get('hideClosed')).toBe('0');
    expect(off.get('hideScams')).toBe('0');
  });

  // tigella-58512: default-FALSE toggle — emit `tbd=1` only when ON.
  it('showTbdUnsubmitted: emits tbd=1 only when ON, nothing by default', () => {
    // default (false / undefined) -> no key
    expect(
      filtersToSearchParams(DEFAULT_FILTERS, 'by-city').get('tbd'),
    ).toBeNull();
    expect(
      filtersToSearchParams({ ...DEFAULT_FILTERS, showTbdUnsubmitted: false }, 'by-city').get('tbd'),
    ).toBeNull();
    // turned on -> tbd=1
    expect(
      filtersToSearchParams({ ...DEFAULT_FILTERS, showTbdUnsubmitted: true }, 'by-city').get('tbd'),
    ).toBe('1');
  });

  // pinsa-58293: default-FALSE toggle — emit `unsub=1` only when ON.
  it('showUnsubmitted: emits unsub=1 only when ON, nothing by default', () => {
    // default (false / undefined) -> no key
    expect(
      filtersToSearchParams(DEFAULT_FILTERS, 'by-city').get('unsub'),
    ).toBeNull();
    expect(
      filtersToSearchParams({ ...DEFAULT_FILTERS, showUnsubmitted: false }, 'by-city').get('unsub'),
    ).toBeNull();
    // turned on -> unsub=1
    expect(
      filtersToSearchParams({ ...DEFAULT_FILTERS, showUnsubmitted: true }, 'by-city').get('unsub'),
    ).toBe('1');
  });
});

describe('searchParamsToFilters', () => {
  it('round-trips serialize -> parse -> equals (admin, no regions)', () => {
    const original: AdminPayoutFilters = {
      ...DEFAULT_FILTERS,
      status: 'paid,completed',
      payoutMethod: 'wire',
      partyId: 'abc123',
      search: 'austin',
      tag: 'pfp',
      purpose: 'shipping',
      regionPortals: ['latam', 'na'],
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
      sort: 'amount_desc',
      hideClosed: false,
      hideScams: false,
    };
    const viewMode: ViewMode = 'payments';
    const params = filtersToSearchParams(original, viewMode);
    const { filters, viewMode: parsedView } = searchParamsToFilters(params, undefined);

    expect(parsedView).toBe('payments');
    expect(filters.status).toBe('paid,completed');
    expect(filters.payoutMethod).toBe('wire');
    expect(filters.partyId).toBe('abc123');
    expect(filters.search).toBe('austin');
    expect(filters.tag).toBe('pfp');
    expect(filters.purpose).toBe('shipping');
    expect(filters.regionPortals).toEqual(['latam', 'na']);
    expect(filters.dateFrom).toBe('2026-01-01');
    expect(filters.dateTo).toBe('2026-02-01');
    expect(filters.sort).toBe('amount_desc');
    expect(filters.hideClosed).toBe(false);
    expect(filters.hideScams).toBe(false);
  });

  it('empty params -> defaults, viewMode null', () => {
    const { filters, viewMode } = searchParamsToFilters(new URLSearchParams(), undefined);
    expect(filters.status).toBe('all');
    expect(filters.payoutMethod).toBe('all');
    expect(filters.hideClosed).toBe(true);
    expect(filters.hideScams).toBe(true);
    expect(filters.sort).toBe('created_desc');
    expect(viewMode).toBeNull();
  });

  it('default-TRUE boolean: =0 parses to false', () => {
    const { filters } = searchParamsToFilters(
      new URLSearchParams('hideClosed=0&hideScams=0'),
      undefined,
    );
    expect(filters.hideClosed).toBe(false);
    expect(filters.hideScams).toBe(false);
  });

  // tigella-58512: default-FALSE toggle round-trip.
  it('showTbdUnsubmitted: tbd=1 parses to true; absent stays false', () => {
    const on = searchParamsToFilters(new URLSearchParams('tbd=1'), undefined);
    expect(on.filters.showTbdUnsubmitted).toBe(true);
    // absent -> default false
    const off = searchParamsToFilters(new URLSearchParams(), undefined);
    expect(off.filters.showTbdUnsubmitted).toBe(false);
    // round-trip: ON serializes and parses back to ON
    const params = filtersToSearchParams(
      { ...DEFAULT_FILTERS, showTbdUnsubmitted: true },
      'by-city',
    );
    expect(searchParamsToFilters(params, undefined).filters.showTbdUnsubmitted).toBe(true);
  });

  // pinsa-58293: default-FALSE toggle round-trip.
  it('showUnsubmitted: unsub=1 parses to true; absent stays false', () => {
    const on = searchParamsToFilters(new URLSearchParams('unsub=1'), undefined);
    expect(on.filters.showUnsubmitted).toBe(true);
    // absent -> default false
    const off = searchParamsToFilters(new URLSearchParams(), undefined);
    expect(off.filters.showUnsubmitted).toBe(false);
    // round-trip: ON serializes and parses back to ON
    const params = filtersToSearchParams(
      { ...DEFAULT_FILTERS, showUnsubmitted: true },
      'by-city',
    );
    expect(searchParamsToFilters(params, undefined).filters.showUnsubmitted).toBe(true);
  });

  it('unknown enum values silently fall back to defaults', () => {
    const { filters, viewMode } = searchParamsToFilters(
      new URLSearchParams('sort=bogus&method=carrierpigeon&purpose=nope&status=fake&view=galaxy'),
      undefined,
    );
    expect(filters.sort).toBe('created_desc');
    expect(filters.payoutMethod).toBe('all');
    expect(filters.purpose).toBe('all');
    expect(filters.status).toBe('all');
    expect(viewMode).toBeNull();
  });

  it('partially-invalid comma status falls back to default', () => {
    const { filters } = searchParamsToFilters(
      new URLSearchParams('status=paid,bogus'),
      undefined,
    );
    expect(filters.status).toBe('all');
  });

  it('ignores ?regions= when a portal regions arg is supplied (hard scope wins)', () => {
    const { filters } = searchParamsToFilters(
      new URLSearchParams('regions=na,europe'),
      ['south-america', 'central-america'],
    );
    // regionPortals must NOT be set from the URL on a regional portal...
    expect(filters.regionPortals).toBeUndefined();
    // ...and the hard scope is re-injected from the arg.
    expect(filters.regions).toEqual(['south-america', 'central-america']);
  });

  it('honors ?regions= only on admin /payments (regions arg undefined)', () => {
    const { filters } = searchParamsToFilters(
      new URLSearchParams('regions=latam,na'),
      undefined,
    );
    expect(filters.regionPortals).toEqual(['latam', 'na']);
    expect(filters.regions).toBeUndefined();
  });
});
