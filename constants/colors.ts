export const COLORS = {
  background: '#000000',      // Pure black — app-wide screen background
  card: '#FFFFFF',            // White card surface (used on the black background for contrast)
  cardDark: '#141414',        // Slightly lifted dark surface, one step above pure black
  accent: '#00D4AA',          // Primary teal accent — buttons, highlights, active states
  accentDim: 'rgba(0, 212, 170, 0.18)', // Teal at low opacity for pill badges and icon tints
  text: '#000000',            // Black text — used on white card surfaces
  textWhite: '#FFFFFF',
  textMuted: '#888888',       // Secondary / placeholder text
  textDim: 'rgba(255, 255, 255, 0.55)', // Tertiary text — captions and disabled labels
  border: 'rgba(255, 255, 255, 0.10)', // Subtle separator lines on dark backgrounds
  tabBar: '#FFFFFF',          // Tab bar background (white bar on black screen)
  tabActive: '#000000',       // Active tab icon color (black on white tab bar)
  tabInactive: '#AAAAAA',     // Inactive tab icon color
  cardElevated: '#1f1f1f',    // Elevated card variant — slightly lighter than cardDark
  trackDark: 'rgba(255,255,255,0.08)', // Progress/slider track fill on dark surfaces
} as const
