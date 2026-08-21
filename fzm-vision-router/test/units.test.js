// Unit tests for the pure helpers. Run: node --test test/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { __testing } from '../index.js'

const { resolveString, resolvePositiveInt, acceptedExtensions, EXT_BY_MEDIA_TYPE } = __testing

function fakeAttachments(mediaTypes) {
  return { imageLimits: { mediaTypes } }
}

test('resolveString trims and falls back', () => {
  assert.equal(resolveString('  kimi-coding  ', 'x'), 'kimi-coding')
  assert.equal(resolveString('', 'x'), 'x')
  assert.equal(resolveString('   ', 'x'), 'x')
  assert.equal(resolveString(undefined, 'x'), 'x')
  assert.equal(resolveString(42, 'x'), 'x')
})

test('resolvePositiveInt accepts numbers and numeric strings', () => {
  assert.equal(resolvePositiveInt(8192, 1), 8192)
  assert.equal(resolvePositiveInt('4096', 1), 4096)
  assert.equal(resolvePositiveInt(0, 7), 7)
  assert.equal(resolvePositiveInt(-3, 7), 7)
  assert.equal(resolvePositiveInt(1.5, 7), 7)
  assert.equal(resolvePositiveInt('abc', 7), 7)
  assert.equal(resolvePositiveInt(undefined, 7), 7)
})

test('acceptedExtensions derives from deployment media types', () => {
  const allowed = acceptedExtensions(fakeAttachments(['image/png', 'image/jpeg']))
  assert.equal(allowed.get('.png'), 'image/png')
  assert.equal(allowed.get('.jpg'), 'image/jpeg')
  assert.equal(allowed.get('.jpeg'), 'image/jpeg')
  assert.equal(allowed.has('.gif'), false)
})

test('acceptedExtensions: deployment-admitted types stay accepted, unknown types stay rejected', () => {
  const allowed = acceptedExtensions(fakeAttachments(['image/avif', 'image/heic']))
  // avif has a mapping, heic does not — the mapping table is the plugin's only
  // hardcoded format knowledge (README 注意事项).
  assert.equal(allowed.get('.avif'), 'image/avif')
  assert.equal(allowed.size, 1)
})

test('every mapped media type round-trips to a non-empty extension list', () => {
  for (const [mediaType, exts] of Object.entries(EXT_BY_MEDIA_TYPE)) {
    assert.ok(mediaType.startsWith('image/'), mediaType)
    assert.ok(Array.isArray(exts) && exts.length > 0, mediaType)
    for (const ext of exts) assert.match(ext, /^\.[a-z0-9]+$/, ext)
  }
})
