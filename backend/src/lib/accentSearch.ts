import type { PrismaClient } from '@prisma/client';

/**
 * Returns ids of rows in `table` where ANY of `columns` accent-insensitively
 * contains `needle` (case- and diacritic-insensitive). `table`/`columns` are
 * caller-controlled identifiers (NOT user input); only `needle` is parameterized.
 *
 * Relies on the `unaccent` extension (enabled on prod, lives in the public
 * schema so it's called UNQUALIFIED). `id` is cast to text so this works for
 * both uuid-typed (Party) and text-typed (User) primary keys.
 */
export async function unaccentMatchIds(
  prisma: PrismaClient,
  table: string,
  columns: string[],
  needle: string,
): Promise<string[]> {
  const term = needle.trim();
  if (!term) return [];
  const like = `%${term.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  const conds = columns
    .map((c) => `unaccent(coalesce("${c}"::text, '')) ILIKE unaccent($1) ESCAPE '\\'`)
    .join(' OR ');
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text AS id FROM "${table}" WHERE ${conds}`,
    like,
  );
  return rows.map((r) => r.id);
}
