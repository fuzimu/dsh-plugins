// Row-block parser round-trip suite. Run: node --test test/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { __testing } from '../index.js'

const {
  parsePatchRows,
  extractRowBlock,
  writeRowOverride,
  removeRowOverride,
  yamlScalar,
  isLocalSpec,
  USER_PATCH_HEADER,
} = __testing

test('config body stops at row-level fields that follow it', () => {
  const text = ['- id: fzm-vision-router', '  config:', '    provider: kimi-coding', '    model: k3', '  disabled: true', ''].join('\n')
  const block = extractRowBlock(text, 'fzm-vision-router')
  assert.equal(block.configText.includes('disabled'), false)
  assert.equal(block.disabled, true)
  const rows = parsePatchRows(text)
  assert.equal(rows[0].disabled, true)
  assert.equal(rows[0].configText, '    provider: kimi-coding\n    model: k3')
})

test('config edit round-trip preserves disabled and is idempotent', () => {
  const text = ['- id: fzm-vision-router', '  config:', '    provider: kimi-coding', '  disabled: true', ''].join('\n')
  const block = extractRowBlock(text, 'fzm-vision-router')
  const next = writeRowOverride(text, 'fzm-vision-router', {
    configText: block.configText.replace('kimi-coding', 'other'),
  })
  const again = extractRowBlock(next, 'fzm-vision-router')
  assert.equal(again.disabled, true)
  assert.match(again.configText, /provider: other/)
  assert.match(next, /\n    provider: other/) // canonical 4-space body indent
  // writing back the parsed state changes nothing
  assert.equal(
    writeRowOverride(next, 'fzm-vision-router', { name: again.name, configText: again.configText, disabled: again.disabled }),
    next,
  )
})

test('toggle then config edit keeps the disabled flag', () => {
  const toggled = writeRowOverride('', 'row-a', { disabled: true, configText: 'provider: a' })
  const edited = writeRowOverride(toggled, 'row-a', { configText: 'provider: b' })
  const rows = parsePatchRows(edited)
  assert.equal(rows[0].disabled, true)
  assert.equal(rows[0].configText.trim(), 'provider: b')
})

test('inject survives row rewrites (inline form)', () => {
  const text = ['- id: row-a', '  name: plugin-a', '  inject: [webServer, llm]', '  config:', '    k: v', ''].join('\n')
  assert.equal(extractRowBlock(text, 'row-a').injectText, '[webServer, llm]')
  const toggled = writeRowOverride(text, 'row-a', { disabled: true })
  assert.match(toggled, /inject: \[webServer, llm\]/)
  assert.match(toggled, /k: v/)
  const again = extractRowBlock(toggled, 'row-a')
  assert.equal(again.injectText, '[webServer, llm]')
  assert.equal(again.disabled, true)
})

test('inject survives row rewrites (block form)', () => {
  const text = ['- id: row-b', '  inject:', '    - webServer', '    - llm', '  disabled: true', ''].join('\n')
  const block = extractRowBlock(text, 'row-b')
  assert.equal(block.injectText, '    - webServer\n    - llm')
  assert.equal(block.disabled, true)
  const edited = writeRowOverride(text, 'row-b', { configText: 'x: 1' })
  assert.notEqual(extractRowBlock(edited, 'row-b').injectText, null)
})

test('blank separator lines between rows survive an edit', () => {
  const text = ['- id: a', '  name: A', '', '- id: b', '  disabled: true', ''].join('\n')
  const next = writeRowOverride(text, 'a', { disabled: true })
  assert.match(next, /\n\n- id: b/)
  const rows = parsePatchRows(next)
  assert.equal(rows.length, 2)
  assert.equal(rows[1].disabled, true)
})

test('writing into an empty file emits the header comment', () => {
  const next = writeRowOverride('', 'new-row', { disabled: true })
  assert.ok(next.startsWith(USER_PATCH_HEADER))
  assert.match(next, /- id: new-row/)
})

test('removeRowOverride strips only the target row', () => {
  const text = ['- id: a', '  name: A', '', '- id: b', '  disabled: true', ''].join('\n')
  const removed = removeRowOverride(text, 'a')
  assert.equal(extractRowBlock(removed, 'a'), null)
  const rows = parsePatchRows(removed)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'b')
  assert.equal(removeRowOverride(text, 'nonexistent'), text)
})

test('quoted name survives a round-trip', () => {
  const text = "- id: x\n  name: '@scope/pkg'\n  config:\n    k: v\n"
  const next = writeRowOverride(text, 'x', { disabled: true })
  assert.equal(extractRowBlock(next, 'x').name, '@scope/pkg')
})

test('rows nested in an insert: block parse with their config', () => {
  const text = ['- insert:', '    - id: fzm-vision-router', '      name: fzm-vision-router', '      config:', '        provider: kimi-coding', '', '        model: k3', ''].join('\n')
  const rows = parsePatchRows(text)
  assert.equal(rows.length, 1)
  assert.match(rows[0].configText, /model: k3/)
})

test('yamlScalar quotes only when needed', () => {
  assert.equal(yamlScalar('plain-name_1.2'), 'plain-name_1.2')
  assert.equal(yamlScalar('a: b'), "'a: b'")
  assert.equal(yamlScalar("it's"), "'it''s'")
})

test('isLocalSpec classifies install specs', () => {
  for (const local of ['file:./a.tgz', 'link:../x', 'workspace:*', './dir', '../dir', '/abs/path', '~/x']) {
    assert.equal(isLocalSpec(local), true, local)
  }
  for (const official of ['^1.2.3', 'latest', '@scope/pkg@1.0.0', 'npm:pkg@1']) {
    assert.equal(isLocalSpec(official), false, official)
  }
  assert.equal(isLocalSpec(null), false)
})
