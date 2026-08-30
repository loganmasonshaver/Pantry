// Escaping for values passed to supabase-js .like()/.ilike().
//
// postgrest-js appends the pattern to the query verbatim (`ilike.${pattern}`), so a value used as
// a case-insensitive EQUALITY check is really a LIKE pattern, and any %/_ inside it is a live
// wildcard. Food names carry percent signs constantly — "2% Milk", "0% Greek Yogurt",
// "100% Whole Wheat Bread" — so `.ilike('name', '2% Milk')` matches "2" + anything + " Milk",
// which over-matched a pantry re-stock and an over-broad grocery DELETE.
//
// Postgres LIKE uses backslash as its escape character. Escape the backslash FIRST, or the
// backslashes this function adds would themselves get escaped.
//
// Not handled: PostgREST also accepts `*` as a wildcard alias in like/ilike patterns. Names
// reaching these call sites have any trailing asterisk stripped upstream by cleanIngredientName
// (it is this app's "need to buy" marker), so it has not been an issue — but a name that reaches
// a filter with an interior `*` would still widen the match.
export function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}
