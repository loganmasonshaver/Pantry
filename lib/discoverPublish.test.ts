import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isReadyToShow } from './discoverPublish.ts'

const AI = 'https://fdafjnkqqtpsjtddbfdz.supabase.co/storage/v1/object/public/meal-images/abc.webp'

test('a YouTube recipe shows only once its AI photo is in our bucket', () => {
  assert.equal(isReadyToShow({ trend_source: 'YouTube trending', image: AI }), true)
  assert.equal(isReadyToShow({ trend_source: 'YouTube trending', image: 'https://i.ytimg.com/vi/abc/hqdefault.jpg' }), false)
  assert.equal(isReadyToShow({ trend_source: 'YouTube trending', image: null }), false)
  assert.equal(isReadyToShow({ trend_source: 'YouTube trending', image: '' }), false)
})

test('a creator recipe needs a photo but not an AI one', () => {
  assert.equal(isReadyToShow({ trend_source: 'creator', image: 'https://cdn.example.com/upload.jpg' }), true)
  assert.equal(isReadyToShow({ trend_source: 'creator', image: null }), false)
})
