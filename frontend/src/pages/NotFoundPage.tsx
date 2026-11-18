import { NotFoundView } from '../components/NotFoundView';

/** Catch-all for paths no route matches (one-segment paths go to EventPage's own "not found"). */
export function NotFoundPage() {
  return <NotFoundView kind="page" />;
}
