/**
 * tigella-58512: East/West Africa regional payments portal.
 */
import { PAYMENTS_REGION_SCOPES } from '../utils/regions';
import { PaymentsAdminPage } from './PaymentsAdminPage';

export function WestAfricaPaymentsPage() {
  return (
    <PaymentsAdminPage
      regionFilter={Array.from(PAYMENTS_REGION_SCOPES.westafrica)}
      portalSlug="westafrica"
    />
  );
}
