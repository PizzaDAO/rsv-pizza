/**
 * tigella-58512: East/West Africa regional payments portal.
 */
import React from 'react';
import { PAYMENTS_REGION_SCOPES } from '../utils/regions';
import { PaymentsAdminPage } from './PaymentsAdminPage';

export function EastAfricaPaymentsPage() {
  return (
    <PaymentsAdminPage
      regionFilter={Array.from(PAYMENTS_REGION_SCOPES.eastafrica)}
      portalSlug="eastafrica"
    />
  );
}
