import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTransportFailure } from './edgeError.ts'

// The bug this guards: iOS suspends the network stack when the app is backgrounded, killing the
// in-flight fetch while the Edge Function runs to completion — storing meals, spending one of six
// daily generations and billing OpenAI. Observed live on funnel run 31.

test('the backgrounded-app failure is transport, and rescuable', () => {
  assert.equal(isTransportFailure({ name: 'FunctionsFetchError' }), true)
  assert.equal(
    isTransportFailure({ message: 'Failed to send a request to the Edge Function' }),
    true,
  )
})

test('a server that ANSWERED is never transport, however it phrases itself', () => {
  // The daily cap is the case that must never be "rescued": the server decided, nothing was made.
  assert.equal(isTransportFailure({ message: 'Edge Function returned a non-2xx status code', context: { status: 429 } }), false)
  assert.equal(isTransportFailure({ message: 'anything', context: { status: 401 } }), false)
  assert.equal(isTransportFailure({ message: 'anything', context: { status: 500 } }), false)
})

test('a status present alongside the transport wording still means the server answered', () => {
  // Ordering matters: a real response outranks a message that merely looks like a fetch failure.
  assert.equal(
    isTransportFailure({ message: 'Failed to send a request to the Edge Function', context: { status: 500 } }),
    false,
  )
})

test('junk never claims to be a rescuable failure', () => {
  assert.equal(isTransportFailure(null), false)
  assert.equal(isTransportFailure(undefined), false)
  assert.equal(isTransportFailure({}), false)
  assert.equal(isTransportFailure({ message: 'Network request failed' }), false)
})
