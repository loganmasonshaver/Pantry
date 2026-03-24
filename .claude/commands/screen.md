---
name: screen
description: Scaffold a new screen for the Pantry app following all conventions
---

Build a new screen for the Pantry app: $ARGUMENTS

Follow these steps:
1. Read any related existing screens to understand patterns before writing anything
2. Create the file under `app/` using Expo Router file-based routing conventions
3. Follow ALL Pantry design conventions:
   - `SafeAreaView` with `edges={['top']}` at the root
   - Pure black `#000000` background (`COLORS.background` or `backgroundColor: '#000000'`)
   - Import and use `COLORS` from `@/constants/colors` — never hardcode theme values
   - White cards: `#1A1A1A` or `#111111` background, `borderRadius: 12–16`
   - Accent green `#4ADE80`, accent teal `#00C9A7`
   - Primary action buttons: `backgroundColor: '#FFFFFF'`, `color: '#000000'`, `borderRadius: 30`
   - Text white `#FFFFFF`, text muted `#888888`
   - `ScrollView` for scrollable content, `FlatList` for lists
4. Wire up any data fetching with Supabase (`lib/supabase.ts`)
5. Add the screen to navigation if needed (`app/_layout.tsx` or tab layout)
6. Use `useFocusEffect` for data that should refresh on screen focus
7. Handle loading and empty states
8. If the screen needs auth, check `useAuth()` from `context/AuthContext`

If anything about the screen's purpose or data requirements is ambiguous, ask before building.
