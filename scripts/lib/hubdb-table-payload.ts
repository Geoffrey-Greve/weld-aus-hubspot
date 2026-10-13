/**
 * The body for a HubDB `updateDraftTable` that changes COLUMNS and nothing else.
 *
 * The update replaces the table definition rather than merging into it: `name` and `label`
 * are required by the request type, and the table-level settings are what seed-hubdb.ts
 * re-asserts on every update for the same reason. Left out, a publish could take `courses`
 * off its dynamic pages (`useForPages`) or shut the public read the React islands depend
 * on (`allowPublicApiAccess`) - a fault that only shows up on a live portal, after the
 * publish, which is why it has a test and not just a comment.
 *
 * Every setting is taken from the portal's own table, never from `hubdb/*.json`: this is
 * for a one-column change, and a script that also "fixed" a setting on the way past would
 * be making a second change nobody asked it for.
 */
export function tableUpdatePayload(
  table: Record<string, any>,
  columns: unknown[]
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: table.name,
    label: table.label,
    useForPages: table.useForPages ?? false,
    allowPublicApiAccess: table.allowPublicApiAccess ?? false,
    allowChildTables: table.allowChildTables ?? false,
    enableChildTablePages: table.enableChildTablePages ?? false,
    columns,
  }
  if (table.dynamicMetaTags && Object.keys(table.dynamicMetaTags).length > 0) {
    payload.dynamicMetaTags = table.dynamicMetaTags
  }
  return payload
}
