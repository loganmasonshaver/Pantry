# User Recipe Uploads — Implementation Plan

## Phase 0: Database — Add `is_user_created` column

Add a boolean column to distinguish user-created recipes from AI-saved meals.

### Tasks
1. Create migration `supabase/migrations/20260326000200_add_user_created_to_saved_meals.sql`:
```sql
ALTER TABLE saved_meals ADD COLUMN IF NOT EXISTS is_user_created boolean DEFAULT false;
```
2. Push migration: `npx supabase db push --yes`

### Verification
- `grep "is_user_created" supabase/migrations/` returns the file

---

## Phase 1: AI Auto-Fill Edge Function

Create an Edge Function that takes a meal name/description and returns a full recipe.

### Tasks
1. Create `supabase/functions/generate-recipe/index.ts`:
   - Accepts: `{ description: string }` (e.g. "chicken stir fry" or "high protein pasta with ground beef")
   - Calls GPT-4o-mini with a prompt to generate: name, prepTime, calories, protein, carbs, fat, ingredients (with visual + grams), steps
   - Returns structured JSON matching the saved_meals schema
   - Include rate limiting (10 req/min) using `../_shared/rate-limit.ts`
   - Use the same ingredient format as generate-meals: `{ name, visual, grams }`

2. Prompt template:
```
Generate a complete recipe for: "${description}"

Return JSON with:
- name: recipe name
- prepTime: minutes to prepare
- calories, protein, carbs, fat: per serving
- ingredients: array of { name, visual (e.g. "1 cup"), grams (e.g. "150g") }
- steps: array of instruction strings

Only return valid JSON, no markdown.
```

3. Deploy: `npx supabase functions deploy generate-recipe --no-verify-jwt`

### Verification
- curl test returns valid recipe JSON

---

## Phase 2: Recipe Create/Edit Modal Component

Create a new component `components/RecipeFormModal.tsx`.

### Tasks
1. Create `components/RecipeFormModal.tsx` — a full-screen modal with:

**Props:**
```typescript
type Props = {
  visible: boolean
  onClose: () => void
  onSaved: () => void
  editMeal?: SavedMeal | null  // null = create mode, object = edit mode
}
```

**UI (scrollable form):**
- Header: "New Recipe" or "Edit Recipe" + close button
- **AI Auto-Fill section** (top): TextInput + "Generate with AI" button
  - User types a description → calls generate-recipe Edge Function
  - Auto-fills all fields below
  - Shows loading state while generating
- **Name**: TextInput
- **Prep Time**: TextInput (numeric, minutes)
- **Macros row**: 4 inline TextInputs (calories, protein, carbs, fat)
- **Ingredients section**:
  - List of ingredient rows (name + visual portion + grams)
  - Each row has a delete (X) button
  - "Add ingredient" button at bottom
- **Steps section**:
  - Numbered list of step TextInputs
  - Each has a delete (X) button
  - "Add step" button at bottom
- **Save button**: white pill, full width at bottom

**Style patterns to copy from:**
- Modal structure: `app/(tabs)/pantry.tsx` lines 386-450 (KeyboardAvoidingView + slide modal)
- Input styling: `app/(tabs)/profile.tsx` calculator modal (calcInput, calcLabel styles)
- List with add/remove: similar to ingredient chips in ReceiptScanModal

**Save logic:**
- Create mode: `supabase.rpc('insert_saved_meal', { ...fields, is_user_created: true })`
  - Note: RPC may need updating to accept is_user_created, OR use direct insert
- Edit mode: `supabase.from('saved_meals').update({ ...fields }).eq('id', editMeal.id)`

---

## Phase 3: Wire Into Saved Meals Screen

Update `app/(tabs)/saved.tsx` to show the create button and "My Recipe" badges.

### Tasks
1. **Add "+" button** to the header (next to search or as a FAB):
   - Opens RecipeFormModal in create mode

2. **Add "My Recipe" badge** to MealCard when `meal.is_user_created === true`:
   - Small green pill label at top of card: "My Recipe"

3. **Update SavedMeal type** to include `is_user_created`:
   ```typescript
   type SavedMeal = {
     ...existing fields,
     is_user_created?: boolean
     carbs?: number | null
     fat?: number | null
     ingredients?: any[]
     steps?: string[]
   }
   ```

4. **Update fetch query** to include new columns:
   ```typescript
   .select('id, name, prep_time, calories, protein, carbs, fat, ingredients, steps, is_user_created')
   ```

5. **Add edit functionality**: Long-press or tap edit icon on user-created meals opens RecipeFormModal in edit mode

6. **Add filter option**: "My Recipes" filter chip alongside existing "All", "High Protein", "Quick"

---

## Phase 4: Generate Recipe Image

When a user saves a recipe, generate an image for it using the existing `generate-meal-image` Edge Function.

### Tasks
1. After saving a recipe, call `generate-meal-image` with the recipe name + ingredients
2. Update the saved meal row with the image URL (or rely on the existing image cache)
3. The image loads from cache on subsequent views (already built)

---

## Execution Order

1. **Phase 0** — DB migration (2 min)
2. **Phase 1** — AI Edge Function (10 min)
3. **Phase 2** — Recipe form modal (30 min, biggest piece)
4. **Phase 3** — Wire into Saved screen (15 min)
5. **Phase 4** — Image generation (5 min, reuses existing infra)
