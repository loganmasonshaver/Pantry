# Grocery & Instacart Features — Implementation Plan

## Phase 0: Database Setup
**New table: `order_history`** — tracks when user orders via Instacart so we can trigger pantry auto-update and reorder.

### Tasks
1. Create Supabase migration `supabase/migrations/20260325_002_create_order_history.sql`:
```sql
CREATE TABLE order_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  items jsonb NOT NULL, -- snapshot of grocery_items at time of order [{name, category, meal}]
  created_at timestamptz DEFAULT now()
);
ALTER TABLE order_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own orders" ON order_history FOR ALL USING (auth.uid() = user_id);
```
2. Run migration: `npx supabase db push` or apply via dashboard

### Verification
- `grep -r "order_history" supabase/migrations/` returns the new file

---

## Phase 1: Auto-Update Pantry After Ordering
**Files:** `app/delivery-webview.tsx`, `app/(tabs)/grocery.tsx`

When user taps "Order with Instacart" → opens webview → returns to app → prompt: "Did you place your order? We'll add everything to your pantry."

### Tasks
1. **`app/(tabs)/grocery.tsx`** — Update the delivery button `onPress` handlers (both Instacart promo card and bottom bar button):
   - Before navigating, save current grocery items to a ref/state
   - Use `router.push('/delivery-webview')` (unchanged)

2. **`app/(tabs)/grocery.tsx`** — Add `useFocusEffect` that checks if user just returned from delivery webview:
   - Add state: `pendingOrder: boolean` — set to `true` before navigating to webview
   - On focus, if `pendingOrder` is true, show an Alert: "Did you place your order?" with "Yes" / "Not yet"
   - On "Yes":
     a. Snapshot current grocery items to `order_history` table (items as JSONB)
     b. Insert all grocery items into `pantry_items` (name, category, in_stock: true)
     c. Delete all grocery items from `grocery_items`
     d. Show toast: "Added X items to pantry ✓"
   - On "Not yet": reset `pendingOrder`, do nothing

### Anti-patterns
- Don't use AppState listener (unreliable) — use `useFocusEffect` which fires when navigating back
- Don't auto-delete grocery items without confirmation

### Verification
- Navigate to webview, come back → alert appears
- Tap "Yes" → grocery list clears, pantry updated, order_history has entry

---

## Phase 2: Meal Prep Timeline
**Files:** `app/(tabs)/grocery.tsx`

After confirming an order (Phase 1 "Yes"), show a prep timeline card at the top of the grocery page based on the meals associated with the ordered items.

### Tasks
1. **`app/(tabs)/grocery.tsx`** — Add state: `recentOrder: { meals: string[], orderedAt: Date } | null`
   - Set when user confirms order in Phase 1
   - Also load from `order_history` on mount (most recent order from today)

2. **`app/(tabs)/grocery.tsx`** — Render a "Prep Timeline" card when `recentOrder` exists:
   ```
   ┌─────────────────────────────────┐
   │ 🕐 Your Meal Prep Schedule      │
   │                                  │
   │ Tonight                          │
   │ ● Prep: Chicken Stir Fry   30m  │
   │ ● Prep: Greek Salad        15m  │
   │                                  │
   │ Tomorrow                         │
   │ ● Prep: Overnight Oats     5m   │
   │                                  │
   │           Dismiss                │
   └─────────────────────────────────┘
   ```
   - Group meals: first 2 as "Tonight", rest as "Tomorrow"
   - Pull prep_time from `saved_meals` if available (match by meal name)
   - Tappable to navigate to meal detail
   - "Dismiss" to clear

3. Store dismiss in local state (not persisted — reappears on next order)

### Verification
- Order groceries with meal associations → prep timeline appears
- Dismiss hides it

---

## Phase 3: One-Tap Reorder
**Files:** `app/(tabs)/grocery.tsx`

When grocery list is empty, show "Reorder last groceries" pulling from `order_history`.

### Tasks
1. **`app/(tabs)/grocery.tsx`** — On mount, if `items.length === 0`, fetch most recent `order_history` entry:
   ```typescript
   const { data: lastOrder } = await supabase
     .from('order_history')
     .select('items, created_at')
     .eq('user_id', user.id)
     .order('created_at', { ascending: false })
     .limit(1)
     .single()
   ```

2. **`app/(tabs)/grocery.tsx`** — In the empty state, add a "Reorder" button below "Tap + to add items":
   ```
   ┌──────────────────────┐
   │    🛒 All stocked up │
   │  Tap + to add items  │
   │                      │
   │  ┌────────────────┐  │
   │  │ Reorder Last   │  │
   │  │ 12 items · 3d  │  │
   │  └────────────────┘  │
   └──────────────────────┘
   ```
   - Show item count and relative time ("3d ago", "last week")
   - On tap: insert all items from `lastOrder.items` into `grocery_items` with `checked: false`
   - Refresh the list

### Verification
- Empty grocery list shows reorder button with last order info
- Tapping it populates the list

---

## Phase 4: Progress Bar
**Files:** `app/(tabs)/grocery.tsx`

Show a visual progress indicator encouraging users to complete their order.

### Tasks
1. **`app/(tabs)/grocery.tsx`** — Add a progress card below the header, above the scroll:
   - Calculate: `checkedCount / items.length` as percentage
   - Show progress bar with text:
     - 0% checked: "Check off items as you shop, or order them all now"
     - 1-99%: "X of Y items ready · Order the rest for delivery"
     - 100%: "All items checked! Add to pantry or order for delivery"

2. **UI:**
   ```
   ┌──────────────────────────────────┐
   │ ████████░░░░░░░░░  8 of 12 items │
   │ Order the rest for same-day      │
   │ delivery →                       │
   └──────────────────────────────────┘
   ```
   - Green fill bar (#4ADE80)
   - Tapping the "delivery →" link opens webview
   - Only show when items.length > 0

### Verification
- Add items, check some → progress bar updates
- Tap delivery link → opens webview

---

## Phase 5: Contextual Nudge on Meal Detail
**Files:** `app/meal/[id].tsx`

When viewing a meal, show how many ingredients are missing from pantry with a CTA to add & order.

### Tasks
1. **`app/meal/[id].tsx`** — Fetch user's pantry items on mount:
   ```typescript
   const [pantryNames, setPantryNames] = useState<Set<string>>(new Set())
   useEffect(() => {
     if (!user) return
     supabase.from('pantry_items').select('name').eq('user_id', user.id).eq('in_stock', true)
       .then(({ data }) => setPantryNames(new Set(data?.map(i => i.name.toLowerCase()) ?? [])))
   }, [user])
   ```

2. **`app/meal/[id].tsx`** — Calculate missing ingredients:
   ```typescript
   const missingIngredients = meal?.ingredients.filter(
     i => !pantryNames.has(i.name.toLowerCase())
   ) ?? []
   ```

3. **`app/meal/[id].tsx`** — Render nudge banner above ingredients section when `missingIngredients.length > 0`:
   ```
   ┌──────────────────────────────────┐
   │ Missing 3 ingredients            │
   │ [Add all to grocery list & order]│
   └──────────────────────────────────┘
   ```
   - "Add all to grocery list & order" button:
     a. Insert all missing ingredients into `grocery_items`
     b. Navigate to `/delivery-webview` (or grocery tab)
   - Show which ones are missing as small chips below

4. Update the existing per-ingredient "+ Add to grocery list" to show "✓ In pantry" for items that match.

### Verification
- View a meal with ingredients not in pantry → nudge appears with count
- Tap "Add all" → items added to grocery list

---

## Execution Order

1. **Phase 0** — DB migration (required for Phases 1-3)
2. **Phase 1** — Auto-update pantry (core feature, enables Phase 2)
3. **Phase 4** — Progress bar (standalone, quick win)
4. **Phase 5** — Meal detail nudge (standalone, quick win)
5. **Phase 2** — Prep timeline (depends on Phase 1 order flow)
6. **Phase 3** — One-tap reorder (depends on Phase 0 order_history)
