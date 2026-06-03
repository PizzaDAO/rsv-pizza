/**
 * Shared fake-detection scan helper (bufalina-60733).
 *
 * Extracted from `GET /api/underboss/fake-detection` so both the underboss
 * review queue and the payments-admin badge feed score parties through one
 * code path.
 *
 * `scorePartiesByIds(partyIds?)`:
 *  - runs the cross-event sybil-wallet pre-pass,
 *  - fetches the full party + guest + linkClick + funnel select used by the
 *    underboss queue,
 *  - scores each party via `scoreEvent`,
 *  - returns the same `FakeDetectionRow[]` shape `scoreEvent` produces.
 *
 * When `partyIds` is provided, the `findMany` is scoped to those ids (still
 * gpp-only); otherwise it behaves exactly as the all-gpp underboss feed.
 */
import { prisma } from '../config/database.js';
import {
  scoreEvent,
  buildSybilWalletSet,
  type FakeDetectionRow,
} from './fakeDetection.js';

/**
 * Cross-event sybil-wallet pre-pass. A wallet is "sybil" when it appears on ≥4
 * distinct events under ≥2 distinct trimmed-lower names. Exported so the
 * underboss feed can still report `meta.sybilWalletCount` without duplicating
 * the query.
 */
export async function buildSybilWalletSetFromDb(): Promise<Set<string>> {
  const sybilRows = await prisma.$queryRaw<
    Array<{ ethereum_address: string; party_ids: string[]; names: string[] }>
  >`
    SELECT
      lower(ethereum_address) AS ethereum_address,
      array_agg(DISTINCT party_id::text) AS party_ids,
      array_agg(DISTINCT lower(trim(name))) AS names
    FROM guests
    WHERE ethereum_address IS NOT NULL
      AND submitted_via IN ('link','rsvp','api')
    GROUP BY lower(ethereum_address)
    HAVING COUNT(DISTINCT party_id) >= 4
  `;
  return buildSybilWalletSet(
    sybilRows.map(r => ({
      ethereumAddress: r.ethereum_address,
      partyIds: r.party_ids,
      names: r.names,
    })),
  );
}

export async function scorePartiesByIds(
  partyIds?: string[],
  precomputedSybilWallets?: Set<string>,
): Promise<FakeDetectionRow[]> {
  const sybilWallets =
    precomputedSybilWallets ?? (await buildSybilWalletSetFromDb());

  const whereClause =
    partyIds && partyIds.length > 0
      ? { eventType: 'gpp' as const, id: { in: partyIds } }
      : { eventType: 'gpp' as const };

  const parties = await prisma.party.findMany({
    where: whereClause,
    select: {
      id: true,
      name: true,
      customUrl: true,
      country: true,
      region: true,
      timezone: true,
      maxGuests: true,
      createdAt: true,
      underbossStatus: true,
      coHosts: true,
      user: { select: { id: true, name: true, email: true } },
      guests: {
        select: {
          id: true,
          name: true,
          email: true,
          ethereumAddress: true,
          submittedAt: true,
          submittedVia: true,
          waitlistPosition: true,
          walletSource: true,
          likedToppings: true,
          dislikedToppings: true,
          likedBeverages: true,
          dislikedBeverages: true,
          dietaryRestrictions: true,
          roles: true,
          pizzeriaRankings: true,
          suggestedPizzerias: true,
          mailingListOptIn: true,
          visitorSessionId: true,
          emailStatus: true,
        },
      },
      linkClicks: {
        select: { clickedAt: true },
      },
      rsvpFunnelEvents: {
        select: { visitorHash: true, step: true, createdAt: true },
      },
    },
  });

  return parties.map(p =>
    scoreEvent(
      {
        id: p.id,
        name: p.name,
        customUrl: p.customUrl,
        country: p.country,
        region: p.region,
        timezone: p.timezone,
        maxGuests: p.maxGuests,
        createdAt: p.createdAt ?? new Date(0),
        underbossStatus: p.underbossStatus ?? null,
        user: p.user
          ? { id: p.user.id, name: p.user.name, email: p.user.email }
          : null,
        coHosts: p.coHosts,
      },
      p.guests.map(g => ({
        id: g.id,
        name: g.name,
        email: g.email,
        ethereumAddress: g.ethereumAddress,
        submittedAt: g.submittedAt,
        submittedVia: g.submittedVia,
        waitlistPosition: g.waitlistPosition,
        walletSource: g.walletSource,
        likedToppings: g.likedToppings,
        dislikedToppings: g.dislikedToppings,
        likedBeverages: g.likedBeverages,
        dislikedBeverages: g.dislikedBeverages,
        dietaryRestrictions: g.dietaryRestrictions,
        roles: g.roles,
        pizzeriaRankings: g.pizzeriaRankings,
        suggestedPizzerias: g.suggestedPizzerias,
        mailingListOptIn: g.mailingListOptIn,
        visitorSessionId: g.visitorSessionId,
        emailStatus: g.emailStatus,
      })),
      p.linkClicks.map(c => ({ clickedAt: c.clickedAt })),
      sybilWallets,
      p.maxGuests,
      p.rsvpFunnelEvents.map(e => ({
        visitorHash: e.visitorHash,
        step: e.step,
        createdAt: e.createdAt,
      })),
    ),
  );
}
