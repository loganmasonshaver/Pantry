import * as Haptics from 'expo-haptics'

// Physical-feedback vocabulary in one place so strength stays consistent app-wide:
// subtle for routine taps, stronger for confirmations / completions / milestones
// (the "make interactions feel physical" principle). All fire-and-forget — haptics are
// best-effort and unavailable on the simulator and some devices, so we swallow errors.
export const haptic = {
  selection: () => Haptics.selectionAsync().catch(() => {}),                                     // segment/tab change, minor pick
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),           // routine tap / press-in
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),         // deleting a single item, a real commit
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}), // completed task / goal reached
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}), // destructive confirm / bulk clear
}
