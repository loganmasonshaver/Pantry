// Cold-start instrumentation for the Home screen.
//
// JS_START is captured at module evaluation — the earliest clock available on the client, close
// enough to "the JS bundle began running" for comparing phases against each other.
//
// DEV ONLY, deliberately. These numbers are measured against a Metro dev bundle, which is much
// slower to boot than a release build, so the absolute values are meaningless. The DELTA between
// two marks is the signal: it tells you which phase owns the wait.
const JS_START = Date.now()

export function perfMark(label: string) {
  if (__DEV__) console.log(`[perf] ${label} +${Date.now() - JS_START}ms`)
}
