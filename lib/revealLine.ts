// The cook reveal's second line: one sentence that is TRUE of every card on screen and names the
// user's goal. The numbers come from the meals themselves — the loosest calorie cap and the lowest
// protein among them — never from the generator's targets, which any single meal can miss.
export type RevealMealNumbers = { calories?: number | null; protein?: number | null }

export function revealGoalLine(meals: RevealMealNumbers[], goal: string | null | undefined): string {
  if (meals.length === 0) return ''
  const maxCal = Math.max(...meals.map(m => Number(m.calories) || 0))
  const minProt = Math.min(...meals.map(m => Number(m.protein) || 0))
  // "under N" is the next round ten ABOVE the biggest plate: 622 reads "under 630", and an exact
  // 620 also reads "under 630" — "under 620" would be false for it.
  const calCap = maxCal > 0 ? Math.floor(maxCal / 10) * 10 + 10 : 0
  const prot = minProt > 0 ? Math.floor(minProt) : 0
  const calClause = calCap ? `under ${calCap} calories` : ''
  const protClause = prot ? `at least ${prot} g of protein` : ''
  if (!calClause && !protClause) return ''

  const subj = meals.length === 1 ? 'It' : 'Each one'
  const tail = goal === 'lose' ? ' — built for your cut'
    : goal === 'gain' ? ' — built for your bulk'
    : goal === 'maintain' ? ' — built for your recomp'
    : '' // accounts that predate the column: the sentence has to read whole on its own
  // Bulking leads with the protein floor, not a calorie ceiling; everyone else gets both.
  const body = goal === 'gain' && protClause
    ? `${subj} brings ${protClause}`
    : calClause && protClause ? `${subj} is ${calClause} with ${protClause}`
    : calClause ? `${subj} is ${calClause}`
    : `${subj} brings ${protClause}`
  return `${body}${tail}.`
}
