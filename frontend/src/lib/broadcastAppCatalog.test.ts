import { describe, it, expect } from 'vitest';
import { BROADCAST_APPS } from './appDefinitions';
// pesto-58496: drift guard. The backend's broadcastApps catalog is the
// validation authority for the {appLink} token (an unrecognized tab is a hard
// 400). This file is intentionally dependency-free so it resolves cleanly into
// the frontend vitest run via a relative cross-package import.
import { isValidAppTab, BROADCAST_APP_TABS } from '../../../backend/src/lib/broadcastApps';

describe('broadcast app catalog drift guard', () => {
  it('every frontend BROADCAST_APPS tab is accepted by the backend isValidAppTab', () => {
    const offenders = BROADCAST_APPS.filter((app) => !isValidAppTab(app.tab)).map((app) => app.tab);
    expect(offenders).toEqual([]);
  });

  it('every frontend BROADCAST_APPS tab is present in BROADCAST_APP_TABS', () => {
    const backendTabs = new Set(BROADCAST_APP_TABS);
    const offenders = BROADCAST_APPS.filter((app) => !backendTabs.has(app.tab)).map((app) => app.tab);
    expect(offenders).toEqual([]);
  });
});
