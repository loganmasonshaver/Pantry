// A React Native <Modal> is its own window, and react-native-safe-area-context cannot read that
// window's insets from the app root: inside a Modal, a bare <SafeAreaView> pads by 0 and
// useSafeAreaInsets() returns 0 — sometimes. It races the modal's window, so it passes on one open
// and fails on the next, which is how the same bug shipped in six modals across a month. The remedy
// is a <SafeAreaProvider> scoped to the modal (CLAUDE.md, "There is no SafeAreaProvider in this
// app"). This test makes the remedy mandatory: any Modal subtree that uses safe-area without one
// fails the suite. Runs from the repo root, like the rest of `node --test lib/*.test.ts`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) tsxFiles(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

export function unguardedModals(root = process.cwd()): string[] {
  const findings: string[] = []
  for (const f of [...tsxFiles(join(root, 'app')), ...tsxFiles(join(root, 'components'))]) {
    const s = readFileSync(f, 'utf8')
    for (const m of s.matchAll(/<Modal\b[\s\S]*?<\/Modal>/g)) {
      const block = m[0]
      const usesSafeArea = /<SafeAreaView\b/.test(block) || /\binsets\.(top|bottom|left|right)\b/.test(block)
      if (usesSafeArea && !/<SafeAreaProvider\b/.test(block)) {
        findings.push(`${f.slice(root.length + 1)}:${s.slice(0, m.index).split('\n').length}`)
      }
    }
  }
  return findings
}

test('every <Modal> that uses safe-area has its own <SafeAreaProvider>', () => {
  assert.deepEqual(unguardedModals(), [], 'wrap the Modal\'s content in <SafeAreaProvider> — see PantryScanModal')
})
