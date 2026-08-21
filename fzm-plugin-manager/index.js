// fzm-plugin-manager — Host entry.
//
// Registers loopback HTTP routes on the host `webServer` service for managing
// ANY DSH-compliant plugin bundle in a profile:
//
//   GET  /fzm-plugin-manager/list     → profile plugin inventory (official vs local)
//   GET  /fzm-plugin-manager/rows     → one bundle's row inventory (from its patch)
//   GET  /fzm-plugin-manager/config   → one row's current effective config
//   POST /fzm-plugin-manager/config   → write one row's config override (user layer)
//   POST /fzm-plugin-manager/toggle   → enable/disable one row (user layer)
//   POST /fzm-plugin-manager/update   → `dsh plugin --profile <p> update <pkg>`
//   GET  /fzm-plugin-manager/models   → configured provider routes + models
//   GET  /fzm-plugin-manager/inspect  → validate one import source path
//   POST /fzm-plugin-manager/import   → `dsh plugin --profile <p> add <spec>`
//   POST /fzm-plugin-manager/remove   → `dsh plugin --profile <p> remove <pkg>`
//
// The browser half (`dsh.client` bundle) is served by dsh-client-modules and
// talks to these routes. Every route requires the `x-fzm-plugin-manager: 1`
// header: it is not a CORS-safelisted header, so cross-origin pages cannot
// call the mutation endpoints without a preflight this server never answers.
// The web profile binds loopback by default; if a deployment binds 0.0.0.0,
// these routes inherit that exposure — install accordingly.
//
// Generalization note: this manager is intentionally plugin-agnostic. It never
// hardcodes a package's config fields; instead it derives a bundle's row
// inventory from its `dsh.bundle.patch` (cordis.patch.yml) and writes row
// overrides into the profile's user layer (cordis.patch.yml), preserving every
// other byte the user wrote there. A bundle that wants a friendly import form
// declares its OWN schema in `dsh.bundle.configSchema` ({fields, defaults?});
// the client renders the form from that declaration, and import writes only
// declared keys. Bundles without a schema fall back to raw YAML row editing.

export const name = 'fzm-plugin-manager'

// Hard dependency: the routes must be registered only once `webServer` is
// mounted. Without inject the row can apply before the webServer provider
// mounts during host boot and silently stay inert (no routes → the SPA
// fallback serves index.html for /fzm-plugin-manager/*).
export const inject = ['webServer']

const PROFILE = 'web'
const ROUTE_BASE = '/fzm-plugin-manager'
const GUARD_HEADER = 'x-fzm-plugin-manager'
const MAX_BODY_BYTES = 65536
const USER_PATCH_FILENAME = 'cordis.patch.yml'

// Local vs official is decided by HOW the package is installed, not by its
// name: the CLI installs path/tgz imports as `file:`-style specs, so a locally
// imported package named @deepseek-ai/* must still count as local (and stay
// removable). Registry semver specs are official/third-party.
function isLocalSpec(spec) {
  return (
    typeof spec === 'string' &&
    (/^(file|link|workspace|portal):/.test(spec) ||
      spec.startsWith('./') ||
      spec.startsWith('../') ||
      spec.startsWith('/') ||
      spec.startsWith('~'))
  )
}

function yamlScalar(value) {
  const s = String(value)
  return /^[A-Za-z0-9_.-]+$/.test(s) ? s : "'" + s.replace(/'/g, "''") + "'"
}

// Dedent a scalar string that may carry surrounding quotes (from a YAML
// literal) into its raw value. Used when re-presenting a `name:` back to the
// client.
function unquoteScalar(value) {
  if (typeof value !== 'string') return value
  if (value.length >= 2 && value[0] === "'" && value[value.length - 1] === "'") {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
    return value.slice(1, -1).replace(/\\"/g, '"')
  }
  return value
}

// Indent every non-empty line of `text` by `pad`. Used to nest a user-supplied
// YAML object under a `config:` key.
function indentYaml(text, pad) {
  return text
    .split('\n')
    .map((line) => (line.trim().length === 0 ? '' : pad + line))
    .join('\n')
}

// Parse a cordis.patch.yml into its row inventory. Every `- id: <id>` is a row
// (whether from an `insert:` block or a top-level override). Rows are
// attributed to their owning entry by indentation: a row's fields are the
// following lines indented deeper than the `- id` line. Returns:
//   [{ id, name, disabled, hasConfig, configText }]
function parsePatchRows(text) {
  const rows = []
  const lines = String(text).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)- id:\s*(\S+)\s*$/.exec(lines[i])
    if (m === null) continue
    const indent = m[1].length
    const row = { id: m[2], name: null, disabled: false, hasConfig: false, configText: '' }
    let j = i + 1
    while (j < lines.length) {
      const line = lines[j]
      if (line.trim().length === 0) {
        j++
        continue
      }
      const lm = /^(\s*)(\S.*)$/.exec(line)
      if (lm === null || lm[1].length <= indent) break
      const t = lm[2].trim()
      if (t.startsWith('name:')) row.name = unquoteScalar(t.slice(5).trim())
      else if (t.startsWith('disabled:')) row.disabled = /^true$/i.test(t.slice(9).trim())
      else if (t.startsWith('config:')) {
        row.hasConfig = true
        // Capture the config body by the `config:` line's OWN indent, not the
        // `- id` line's: row-level fields after `config:` (e.g. `disabled:`)
        // sit between the two and must terminate the body, not be swallowed.
        const configIndent = lm[1].length
        const configLines = []
        // Trailing blank lines are not part of the body: hold them pending
        // and flush only when a deeper content line follows.
        let pendingBlanks = 0
        let k = j + 1
        while (k < lines.length) {
          const cl = lines[k]
          if (cl.trim().length === 0) {
            pendingBlanks++
            k++
            continue
          }
          const clm = /^(\s*)(\S.*)$/.exec(cl)
          if (clm === null || clm[1].length <= configIndent) break
          while (pendingBlanks > 0) {
            configLines.push('')
            pendingBlanks--
          }
          configLines.push(cl)
          k++
        }
        row.configText = configLines.join('\n')
        // Continue scanning: row-level fields may follow the config body.
        j = k
        continue
      }
      j++
    }
    rows.push(row)
    i = j - 1
  }
  return rows
}

// Locate the block in `text` that begins with `- id: <rowId>` and extends to
// the next top-level entry (a line indented no deeper than the `- id` line).
// Returns { start, end, name, disabled, configText, hasConfig } or null.
function extractRowBlock(text, rowId) {
  const lines = String(text).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)- id:\s*(\S+)\s*$/.exec(lines[i])
    if (m === null || m[2] !== rowId) continue
    const indent = m[1].length
    const block = { start: i, end: i + 1, name: null, disabled: undefined, configText: '', hasConfig: false }
    let j = i + 1
    while (j < lines.length) {
      const line = lines[j]
      // Blank lines do not extend the block: trailing blanks stay outside
      // [start, end) so rewrites preserve the separator before the next row.
      if (line.trim().length === 0) {
        j++
        continue
      }
      const lm = /^(\s*)(\S.*)$/.exec(line)
      if (lm === null || lm[1].length <= indent) break
      const t = lm[2].trim()
      if (t.startsWith('name:')) block.name = unquoteScalar(t.slice(5).trim())
      else if (t.startsWith('disabled:')) block.disabled = /^true$/i.test(t.slice(9).trim())
      else if (t.startsWith('config:')) {
        block.hasConfig = true
        // Same indent baseline as parsePatchRows: the `config:` line's own
        // indent, so row-level fields after it terminate the body.
        const configIndent = lm[1].length
        const configLines = []
        let pendingBlanks = 0
        let k = j + 1
        while (k < lines.length) {
          const cl = lines[k]
          if (cl.trim().length === 0) {
            pendingBlanks++
            k++
            continue
          }
          const clm = /^(\s*)(\S.*)$/.exec(cl)
          if (clm === null || clm[1].length <= configIndent) break
          while (pendingBlanks > 0) {
            configLines.push('')
            pendingBlanks--
          }
          configLines.push(cl)
          k++
        }
        block.configText = configLines.join('\n')
        // Exclude trailing pending blanks from the block extent.
        block.end = k - pendingBlanks
        // Continue scanning: row-level fields may follow the config body.
        j = k
        continue
      }
      block.end = j + 1
      j++
    }
    return block
  }
  return null
}

// Strip the common leading indent of a YAML fragment's non-empty lines.
// configText arrives with its source indentation intact; without dedenting,
// every edit round would add another 4 spaces under `config:`.
function dedentYaml(text) {
  const lines = String(text).split('\n')
  let min = Infinity
  for (const line of lines) {
    if (line.trim().length === 0) continue
    const m = /^(\s*)/.exec(line)
    if (m[1].length < min) min = m[1].length
  }
  if (min === Infinity || min === 0) return String(text)
  return lines.map((line) => (line.trim().length === 0 ? '' : line.slice(min))).join('\n')
}

// Render one user-layer row block for `rowId`. `name` is preserved when known;
// `configText` (raw YAML object body) is dedented to its canonical form and
// nested under `config:`; `disabled` emits `disabled: true` only when
// explicitly true.
function renderRowBlock(rowId, patch) {
  let out = '- id: ' + rowId + '\n'
  if (patch.name !== undefined && patch.name !== null && String(patch.name).length > 0) {
    out += '  name: ' + yamlScalar(patch.name) + '\n'
  }
  if (typeof patch.configText === 'string' && patch.configText.trim().length > 0) {
    out += '  config:\n' + indentYaml(dedentYaml(patch.configText), '    ') + '\n'
  }
  if (patch.disabled === true) out += '  disabled: true\n'
  return out
}

// Write (replace or append) a user-layer row block for `rowId` in
// `originalText`. Preserves every other byte. Returns the new text.
function writeRowOverride(originalText, rowId, patch) {
  const block = extractRowBlock(originalText, rowId)
  const newBlock = renderRowBlock(rowId, {
    name: patch.name !== undefined ? patch.name : block ? block.name : undefined,
    configText: patch.configText !== undefined ? patch.configText : block ? block.configText : undefined,
    disabled: patch.disabled !== undefined ? patch.disabled : block ? block.disabled : undefined,
  }).replace(/\n$/, '')
  if (block === null) {
    const trimmed = String(originalText).replace(/\s+$/, '')
    return (trimmed.length === 0 ? '' : trimmed + '\n') + newBlock + '\n'
  }
  const lines = String(originalText).split('\n')
  const before = lines.slice(0, block.start)
  const after = lines.slice(block.end)
  const prefix = before.join('\n')
  return (
    (prefix.length > 0 ? prefix + '\n' : '') +
    newBlock +
    (after.length > 0 ? '\n' + after.join('\n') : '')
  )
}

// Remove the user-layer row block for `rowId` entirely (used when the owning
// bundle is uninstalled, so no orphan overrides survive). Surrounding blank
// separator lines are normalized away. Returns the (possibly unchanged) text.
function removeRowOverride(originalText, rowId) {
  const block = extractRowBlock(originalText, rowId)
  if (block === null) return String(originalText)
  const lines = String(originalText).split('\n')
  const before = lines.slice(0, block.start)
  const after = lines.slice(block.end)
  while (before.length > 0 && before[before.length - 1].trim().length === 0) before.pop()
  while (after.length > 0 && after[0].trim().length === 0) after.shift()
  const parts = []
  if (before.length > 0) parts.push(before.join('\n'))
  if (after.length > 0) parts.push(after.join('\n'))
  return parts.length === 0 ? '' : parts.join('\n') + '\n'
}

export function apply(ctx) {
  const fs = ctx.get('fs')
  const shell = ctx.get('shell')
  const webServer = ctx.get('webServer')
  const logger = ctx.logger && typeof ctx.logger.warn === 'function' ? ctx.logger : console
  if (webServer === undefined) {
    logger.warn('[fzm-plugin-manager] webServer service is not mounted (not a web profile?); staying inert')
    return
  }

  let dirty = false
  let homeCache

  async function home() {
    if (homeCache !== undefined) return homeCache
    if (shell === undefined) throw new Error('shell service is not mounted')
    const result = await shell.run(shell.resolve({ command: 'printf %s "${DSH_HOME:-$HOME/.dsh}"', timeoutMs: 10000 }))
    const text = (result.stdout && typeof result.stdout.text === 'string' ? result.stdout.text : '').trim()
    if (text.length === 0) throw new Error('无法解析 harness home(DSH_HOME 或 $HOME/.dsh 均为空)')
    homeCache = text
    return text
  }

  function quote(value) {
    return "'" + String(value).replace(/'/g, "'\\''") + "'"
  }

  async function readJson(path) {
    if (fs === undefined) throw new Error('fs service is not mounted')
    const target = await fs.resolve(path)
    const raw = await fs.readText(target)
    return JSON.parse(raw)
  }

  async function exists(path) {
    if (fs === undefined) return false
    const target = await fs.resolve(path)
    return (await fs.stat(target)) !== undefined
  }

  async function readText(path) {
    if (fs === undefined) throw new Error('fs service is not mounted')
    return fs.readText(await fs.resolve(path))
  }

  async function writeText(path, text) {
    if (fs === undefined) throw new Error('fs service is not mounted')
    await fs.writeText(await fs.resolve(path), text)
  }

  async function readVersion(profileDir, pkgName) {
    try {
      const manifest = await readJson(profileDir + '/node_modules/' + pkgName + '/package.json')
      return typeof manifest.version === 'string' ? manifest.version : null
    } catch {
      return null
    }
  }

  async function readUserPatchText(profileDir) {
    try {
      return await readText(profileDir + '/' + USER_PATCH_FILENAME)
    } catch {
      return ''
    }
  }

  // Read a bundle's metadata + row inventory + client/configSchema presence.
  async function bundleInfo(profileDir, pkgName) {
    const manifest = await readJson(profileDir + '/node_modules/' + pkgName + '/package.json')
    const patchRel =
      manifest.dsh && manifest.dsh.bundle && typeof manifest.dsh.bundle.patch === 'string' ? manifest.dsh.bundle.patch : null
    const hasBundle = patchRel !== null
    const hasClient = !!(manifest.dsh && manifest.dsh.client)
    const configSchema = (manifest.dsh && manifest.dsh.bundle && manifest.dsh.bundle.configSchema) || null
    let rows = []
    if (hasBundle) {
      try {
        const patchText = await readText(profileDir + '/node_modules/' + pkgName + '/' + patchRel.replace(/^\.\//, ''))
        rows = parsePatchRows(patchText)
      } catch {
        rows = []
      }
    }
    return {
      name: pkgName,
      version: typeof manifest.version === 'string' ? manifest.version : null,
      hasBundle,
      hasClient,
      configSchema,
      rows,
    }
  }

  // Row ids present in a FRESH compose of the profile's on-disk files
  // (`dsh --dump-config`), or null when the composition cannot be read. This
  // is NOT the live process: a bundle installed but not yet restarted already
  // composes here, and so does any override written this session. Both
  // `active` (bundle-stack membership) and `composed` therefore describe the
  // NEXT boot; whether the running process actually carries a row cannot be
  // observed from here.
  async function composedRows() {
    if (shell === undefined) return null
    try {
      const result = await shell.run(shell.resolve({ command: 'dsh --dump-config --profile ' + PROFILE, timeoutMs: 30000 }))
      const text = (result.stdout && typeof result.stdout.text === 'string' ? result.stdout.text : '').trim()
      const names = new Set()
      if (text.length > 0) {
        const re = /^\s{2}name:\s*(['"]?)([^'"\n]+)\1\s*$/gm
        let match
        while ((match = re.exec(text)) !== null) names.add(match[2])
      }
      return names
    } catch {
      return null
    }
  }

  async function listPayload() {
    const profileDir = (await home()) + '/profiles/' + PROFILE
    const manifest = await readJson(profileDir + '/package.json')
    const deps = manifest.dependencies || {}
    const bundles = (manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles) || []
    const composed = await composedRows()
    const items = []
    async function buildItem(pkgName) {
      const spec = deps[pkgName] || null
      let info = { hasBundle: false, hasClient: false, configSchema: null, rows: [] }
      try {
        info = await bundleInfo(profileDir, pkgName)
      } catch {
        // a dependency whose package is not a valid bundle still lists; row
        // inventory simply stays empty.
      }
      return {
        name: pkgName,
        version: await readVersion(profileDir, pkgName),
        kind: isLocalSpec(spec) ? 'local' : 'official',
        active: bundles.includes(pkgName),
        composed: composed === null ? null : composed.has(pkgName),
        spec,
        hasBundle: info.hasBundle,
        hasClient: info.hasClient,
        configSchema: info.configSchema,
        rowCount: info.rows.length,
        // lightweight row summary for the list; full config text stays on /config
        rows: info.rows.map((r) => ({ id: r.id, name: r.name, disabled: r.disabled, hasConfig: r.hasConfig })),
      }
    }
    for (const pkgName of bundles) items.push(await buildItem(pkgName))
    for (const pkgName of Object.keys(deps)) {
      if (bundles.includes(pkgName)) continue
      items.push(await buildItem(pkgName))
    }
    return { items, dirty, profileDir }
  }

  async function runDsh(tail) {
    if (shell === undefined) throw new Error('shell service is not mounted')
    const result = await shell.run(shell.resolve({ command: 'dsh plugin --profile ' + PROFILE + ' ' + tail, timeoutMs: 180000 }))
    const out = (result.stdout && result.stdout.text) || ''
    const err = (result.stderr && result.stderr.text) || ''
    return { exitCode: result.exitCode, log: (out + (err ? '\n' + err : '')).trim() }
  }

  // Read the package manifest from the import source (directory or .tgz).
  async function getSourceManifest(spec, isTarball) {
    if (isTarball) {
      if (shell === undefined) throw new Error('shell service is not mounted')
      const result = await shell.run(shell.resolve({ command: 'tar -xzf ' + quote(spec) + ' -O package/package.json', timeoutMs: 20000 }))
      const out = result.stdout && typeof result.stdout.text === 'string' ? result.stdout.text : ''
      if (result.exitCode !== 0 || out.trim().length === 0) return null
      try {
        return JSON.parse(out)
      } catch {
        return null
      }
    }
    try {
      return await readJson(spec.replace(/\/+$/, '') + '/package.json')
    } catch {
      return null
    }
  }

  // Read one bundle's row inventory (GET /rows).
  async function rowsPayload(query) {
    const pkgName = typeof query.get === 'function' ? query.get('package') : ''
    if (typeof pkgName !== 'string' || pkgName.trim().length === 0) return { ok: false, message: '缺少 package 参数' }
    const profileDir = (await home()) + '/profiles/' + PROFILE
    let info
    try {
      info = await bundleInfo(profileDir, pkgName.trim())
    } catch (error) {
      return { ok: false, message: '读取包信息失败: ' + (error && error.message ? error.message : String(error)) }
    }
    return { ok: true, name: info.name, version: info.version, hasBundle: info.hasBundle, hasClient: info.hasClient, rows: info.rows }
  }

  // Read one row's current effective config (GET /config?package=&row=). The
  // effective config is the user-layer override when present (it replaces the
  // whole row config), otherwise the bundle's own default for that row.
  async function configGetPayload(query) {
    const pkgName = typeof query.get === 'function' ? query.get('package') : ''
    const rowId = typeof query.get === 'function' ? query.get('row') : ''
    if (typeof pkgName !== 'string' || pkgName.trim().length === 0 || typeof rowId !== 'string' || rowId.trim().length === 0) {
      return { ok: false, message: '缺少 package 或 row 参数' }
    }
    const profileDir = (await home()) + '/profiles/' + PROFILE
    const userText = await readUserPatchText(profileDir)
    const override = extractRowBlock(userText, rowId.trim())
    if (override !== null && override.hasConfig) {
      return {
        ok: true,
        row: rowId.trim(),
        source: 'override',
        configText: override.configText,
        disabled: override.disabled === true,
        name: override.name,
      }
    }
    try {
      const info = await bundleInfo(profileDir, pkgName.trim())
      const row = info.rows.find((r) => r.id === rowId.trim())
      if (row !== undefined) {
        return { ok: true, row: rowId.trim(), source: 'default', configText: row.configText, disabled: row.disabled === true, name: row.name }
      }
    } catch {
      // fall through
    }
    return { ok: true, row: rowId.trim(), source: 'none', configText: '', disabled: false, name: null }
  }

  // Write the user-layer patch and immediately validate the WHOLE composition
  // by re-running `dsh --dump-config`: an invalid override (broken YAML, a
  // config shape the loader rejects) would otherwise only surface at the next
  // boot as a failed startup. On validation failure the original text is
  // restored and the error returned. Returns null on success, or the error
  // message to report.
  async function writeUserPatchValidated(profileDir, original, next) {
    const patchFile = profileDir + '/' + USER_PATCH_FILENAME
    await writeText(patchFile, next)
    if (shell === undefined) return null // cannot validate; accept the write
    try {
      const result = await shell.run(shell.resolve({ command: 'dsh --dump-config --profile ' + PROFILE, timeoutMs: 60000 }))
      if (result.exitCode === 0) return null
      const log = (((result.stderr && result.stderr.text) || '') + '\n' + ((result.stdout && result.stdout.text) || '')).trim()
      await writeText(patchFile, original)
      return log.length > 0 ? log.slice(-500) : 'dsh --dump-config exit ' + result.exitCode
    } catch (error) {
      // Validation itself could not run (CLI missing etc.): keep the write,
      // matching the pre-validation behavior, rather than blocking edits.
      logger.warn('[fzm-plugin-manager] composition validation skipped: ' + (error && error.message ? error.message : String(error)))
      return null
    }
  }

  // Write one row's config override into the user layer (POST /config).
  async function configPostPayload(body) {
    const pkgName = body && typeof body.package === 'string' ? body.package.trim() : ''
    const rowId = body && typeof body.row === 'string' ? body.row.trim() : ''
    const configText = body && typeof body.configText === 'string' ? body.configText : ''
    if (pkgName.length === 0 || rowId.length === 0) return { ok: false, message: '缺少 package 或 row 参数' }
    const profileDir = (await home()) + '/profiles/' + PROFILE
    const original = await readUserPatchText(profileDir)
    const block = extractRowBlock(original, rowId)
    const next = writeRowOverride(original, rowId, {
      name: block ? block.name : undefined,
      configText,
      disabled: block ? block.disabled : undefined,
    })
    const validationError = await writeUserPatchValidated(profileDir, original, next)
    if (validationError !== null) {
      return { ok: false, message: '组合校验失败,已回滚: ' + validationError }
    }
    dirty = true
    return { ok: true, message: '已写入配置覆盖(重启后生效)' }
  }

  // Enable/disable one row (POST /toggle?package=&row=).
  async function togglePayload(body) {
    const pkgName = body && typeof body.package === 'string' ? body.package.trim() : ''
    const rowId = body && typeof body.row === 'string' ? body.row.trim() : ''
    const disabled = !!(body && body.disabled)
    if (pkgName.length === 0 || rowId.length === 0) return { ok: false, message: '缺少 package 或 row 参数' }
    const profileDir = (await home()) + '/profiles/' + PROFILE
    const original = await readUserPatchText(profileDir)
    const block = extractRowBlock(original, rowId)
    const next = writeRowOverride(original, rowId, {
      name: block ? block.name : undefined,
      configText: block ? block.configText : undefined,
      disabled,
    })
    const validationError = await writeUserPatchValidated(profileDir, original, next)
    if (validationError !== null) {
      return { ok: false, message: '组合校验失败,已回滚: ' + validationError }
    }
    dirty = true
    return { ok: true, message: (disabled ? '已禁用' : '已启用') + '(重启后生效)' }
  }

  async function importPlugin(body) {
    let spec = body && typeof body.spec === 'string' ? body.spec.trim() : ''
    if (spec.length === 0) return { ok: false, message: '请填写插件包路径' }
    if (spec.startsWith('~')) spec = (await home()) + spec.slice(1)
    if (!spec.startsWith('/')) return { ok: false, message: '请使用绝对路径(或以 ~ 开头)' }
    if (!(await exists(spec))) return { ok: false, message: '路径不存在: ' + spec }
    const isTarball = /\.t(ar\.gz|gz)$/i.test(spec)
    const specDir = spec.replace(/\/+$/, '')
    if (!isTarball && !(await exists(specDir + '/package.json'))) {
      return { ok: false, message: '该目录下没有 package.json,不是有效的插件包目录' }
    }
    const rawConfig = body && typeof body.config === 'object' && body.config !== null ? body.config : null

    const sourceManifest = await getSourceManifest(spec, isTarball)
    if (!sourceManifest) return { ok: false, message: 'package.json 无法解析,不是合法的插件包' }
    const pkgName = typeof sourceManifest.name === 'string' ? sourceManifest.name.trim() : ''
    const PKG_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i
    if (pkgName.length === 0 || !PKG_NAME_RE.test(pkgName)) {
      return { ok: false, message: '包名不合法: ' + (pkgName || '(空)') }
    }
    // Generic declarative config: the IMPORTED package declares its own form
    // schema in `dsh.bundle.configSchema` ({fields, defaults?}). Only declared
    // field keys with non-empty string values are written, each YAML-quoted.
    const schemaFields =
      sourceManifest.dsh &&
      sourceManifest.dsh.bundle &&
      sourceManifest.dsh.bundle.configSchema &&
      typeof sourceManifest.dsh.bundle.configSchema.fields === 'object' &&
      sourceManifest.dsh.bundle.configSchema.fields !== null
        ? sourceManifest.dsh.bundle.configSchema.fields
        : null
    const CONFIG_KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/
    const configLines = []
    if (rawConfig !== null && schemaFields !== null) {
      for (const key of Object.keys(schemaFields)) {
        if (!CONFIG_KEY_RE.test(key)) continue
        const value = rawConfig[key]
        if (typeof value === 'string' && value.trim().length > 0) configLines.push(key + ': ' + yamlScalar(value.trim()))
      }
    }
    const wantsConfig = rawConfig !== null && Object.keys(rawConfig).some((k) => typeof rawConfig[k] === 'string' && rawConfig[k].trim().length > 0)
    const hasConfig = configLines.length > 0
    const declaredBundle =
      !!(sourceManifest.dsh && sourceManifest.dsh.bundle) && typeof sourceManifest.dsh.bundle.patch === 'string'
    if (declaredBundle && !isTarball) {
      const patchRel = String(sourceManifest.dsh.bundle.patch).replace(/^\.\//, '')
      if (!(await exists(specDir + '/' + patchRel))) {
        return { ok: false, message: '声明了 dsh.bundle 但找不到补丁文件: ' + sourceManifest.dsh.bundle.patch }
      }
    }
    const profileDir = (await home()) + '/profiles/' + PROFILE
    const profileManifest = await readJson(profileDir + '/package.json')
    const deps = profileManifest.dependencies || {}
    if (Object.prototype.hasOwnProperty.call(deps, pkgName)) {
      const installedVersion = await readVersion(profileDir, pkgName)
      return {
        ok: false,
        message: '该插件已安装' + (installedVersion ? '(v' + installedVersion + ')' : '') + ',如需更新请先卸载再导入',
      }
    }

    const run = await runDsh('add ' + quote(spec))
    if (run.exitCode !== 0) {
      return { ok: false, message: 'dsh plugin add 失败(exit ' + run.exitCode + ')', detail: run.log.slice(-2000) }
    }
    if (/declares no dsh\.bundle/.test(run.log)) {
      return {
        ok: true,
        message:
          '已安装为依赖,但该包未声明 dsh.bundle,不会自动进入组合;如需启用请手动添加组合行' +
          (hasConfig ? ';未写入配置(包未进入组合)' : ''),
        detail: run.log.slice(-800),
      }
    }
    dirty = true
    let configNote = ''
    if (hasConfig) {
      const rowId = await firstRowId(profileDir, pkgName)
      if (rowId !== null) {
        const original = await readUserPatchText(profileDir)
        const block = extractRowBlock(original, rowId)
        const configText = configLines.join('\n') + '\n'
        const validationError = await writeUserPatchValidated(
          profileDir,
          original,
          writeRowOverride(original, rowId, {
            name: block ? block.name : undefined,
            configText,
            disabled: block ? block.disabled : undefined,
          }),
        )
        configNote = validationError === null ? '已写入行配置,重启后生效' : '行配置写入后组合校验失败,已回滚: ' + validationError
      } else {
        configNote = '未找到组合行 id,未能写入配置'
      }
    } else if (wantsConfig) {
      configNote = '该插件未声明 dsh.bundle.configSchema,无法表单写入;请在导入后于行级编辑 config'
    }
    const payload = await listPayload()
    const names = payload.items.filter((item) => item.kind === 'local' && item.active).map((item) => item.name)
    return { ok: true, message: '导入成功,重启 dsh web 后启用' + (configNote ? ';' + configNote : ''), names, detail: run.log.slice(-800) }
  }

  async function firstRowId(profileDir, pkgName) {
    try {
      const info = await bundleInfo(profileDir, pkgName)
      return info.rows.length > 0 ? info.rows[0].id : null
    } catch {
      return null
    }
  }

  async function updatePlugin(body) {
    const pkgName = body && typeof body.name === 'string' ? body.name.trim() : ''
    if (pkgName.length === 0) return { ok: false, message: '缺少插件名' }
    const profileDir = (await home()) + '/profiles/' + PROFILE
    const manifest = await readJson(profileDir + '/package.json')
    const spec = (manifest.dependencies || {})[pkgName] || null
    if (!isLocalSpec(spec)) {
      return { ok: false, message: '该插件不是本地导入的(registry 依赖),不能在此更新' }
    }
    const run = await runDsh('update ' + quote(pkgName))
    if (run.exitCode !== 0) {
      return { ok: false, message: 'dsh plugin update 失败(exit ' + run.exitCode + ')', detail: run.log.slice(-2000) }
    }
    dirty = true
    return { ok: true, message: '已更新,重启 dsh web 后生效', detail: run.log.slice(-800) }
  }

  async function removePlugin(body) {
    const pkgName = body && typeof body.name === 'string' ? body.name.trim() : ''
    if (pkgName.length === 0) return { ok: false, message: '缺少插件名' }
    const profileDir = (await home()) + '/profiles/' + PROFILE
    const manifest = await readJson(profileDir + '/package.json')
    const spec = (manifest.dependencies || {})[pkgName] || null
    if (!isLocalSpec(spec)) {
      return { ok: false, message: '该插件不是本地导入的(registry 依赖),不能在此卸载' }
    }
    // Capture the bundle's row ids BEFORE removal, so their user-layer
    // overrides can be stripped afterwards instead of surviving as orphans.
    let orphanRowIds = []
    try {
      orphanRowIds = (await bundleInfo(profileDir, pkgName)).rows.map((r) => r.id)
    } catch {
      orphanRowIds = []
    }
    const run = await runDsh('remove ' + quote(pkgName))
    if (run.exitCode !== 0) {
      return { ok: false, message: 'dsh plugin remove 失败(exit ' + run.exitCode + ')', detail: run.log.slice(-2000) }
    }
    let cleanedNote = ''
    if (orphanRowIds.length > 0) {
      try {
        const original = await readUserPatchText(profileDir)
        let text = original
        for (const rowId of orphanRowIds) text = removeRowOverride(text, rowId)
        if (text !== original) {
          await writeText(profileDir + '/' + USER_PATCH_FILENAME, text)
          cleanedNote = ';已清理用户层残留行覆盖'
        }
      } catch (error) {
        logger.warn('[fzm-plugin-manager] failed to strip user-layer row overrides: ' + (error && error.message ? error.message : String(error)))
      }
    }
    dirty = true
    return { ok: true, message: '已卸载,重启 dsh web 后完全移除' + cleanedNote }
  }

  // Enumerate the currently configured provider routes and their models via
  // the host `llm` service (llm.listProviders + llm.listModels per route).
  async function modelsPayload() {
    const llm = ctx.get('llm')
    if (llm === undefined) return { ok: false, message: 'llm service is not mounted' }
    let providers
    try {
      providers = (typeof llm.listProviders === 'function' ? llm.listProviders() : []) || []
    } catch (error) {
      return { ok: false, message: '读取 provider 失败: ' + (error && error.message ? error.message : String(error)) }
    }
    const out = []
    for (const p of providers) {
      const models = []
      if (typeof llm.listModels === 'function') {
        try {
          const list = await llm.listModels(p.id)
          if (Array.isArray(list)) {
            for (const m of list) {
              if (m && typeof m.id === 'string') {
                models.push({
                  id: m.id,
                  name: typeof m.name === 'string' ? m.name : m.id,
                  inputModalities: Array.isArray(m.inputModalities) ? m.inputModalities : undefined,
                })
              }
            }
          }
        } catch {
          // route without a resolvable catalog: keep it with an empty model list
        }
      }
      out.push({ id: p.id, name: typeof p.name === 'string' ? p.name : p.id, models })
    }
    return { ok: true, providers: out }
  }

  // Inspect an import source path: package name/version, bundle status, row
  // inventory, client presence, config schema, and whether the manager can
  // write a config for it.
  async function inspectPayload(path) {
    let spec = typeof path === 'string' ? path.trim() : ''
    if (spec.length === 0) return { ok: false, message: '缺少 path 参数' }
    if (spec.startsWith('~')) spec = (await home()) + spec.slice(1)
    if (!spec.startsWith('/')) return { ok: false, message: '请使用绝对路径(或以 ~ 开头)' }
    if (!(await exists(spec))) return { ok: false, message: '路径不存在: ' + spec }
    const isTarball = /\.t(ar\.gz|gz)$/i.test(spec)
    const manifest = await getSourceManifest(spec, isTarball)
    if (!manifest || typeof manifest.name !== 'string' || manifest.name.length === 0) {
      return { ok: false, message: '无法读取包名(没有有效的 package.json)' }
    }
    const patchRel =
      manifest.dsh && manifest.dsh.bundle && typeof manifest.dsh.bundle.patch === 'string' ? manifest.dsh.bundle.patch : null
    const hasBundle = patchRel !== null
    const hasClient = !!(manifest.dsh && manifest.dsh.client)
    const configSchema = (manifest.dsh && manifest.dsh.bundle && manifest.dsh.bundle.configSchema) || null
    let rows = []
    if (hasBundle) {
      try {
        const dir = isTarball ? spec : spec.replace(/\/+$/, '')
        const patchText = isTarball
          ? await readTarballFile(spec, patchRel.replace(/^\.\//, ''))
          : await readText(dir + '/' + patchRel.replace(/^\.\//, ''))
        rows = parsePatchRows(patchText)
      } catch {
        rows = []
      }
    }
    let installed = null
    try {
      const profileManifest = await readJson((await home()) + '/profiles/' + PROFILE + '/package.json')
      const deps = profileManifest.dependencies || {}
      if (Object.prototype.hasOwnProperty.call(deps, manifest.name)) {
        installed = { version: await readVersion((await home()) + '/profiles/' + PROFILE, manifest.name) }
      }
    } catch {
      // profile manifest unreadable: report no installed state
    }
    return {
      ok: true,
      name: manifest.name,
      version: typeof manifest.version === 'string' ? manifest.version : null,
      bundle: hasBundle,
      client: hasClient,
      configSchema,
      rows,
      installed,
    }
  }

  async function readTarballFile(spec, relPath) {
    if (shell === undefined) throw new Error('shell service is not mounted')
    const result = await shell.run(shell.resolve({ command: 'tar -xzf ' + quote(spec) + ' -O package/' + relPath, timeoutMs: 20000 }))
    const out = result.stdout && typeof result.stdout.text === 'string' ? result.stdout.text : ''
    return out
  }

  function send(res, status, payload) {
    const bodyText = JSON.stringify(payload ?? null)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(bodyText)
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          reject(new Error('body too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (chunks.length === 0) return resolve({})
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          reject(new Error('invalid JSON body'))
        }
      })
      req.on('error', reject)
    })
  }

  function guarded(methods, handle) {
    return async (req, res) => {
      try {
        if (req.headers[GUARD_HEADER] !== '1') return send(res, 403, { ok: false, message: 'forbidden' })
        if (!methods.includes(req.method)) return send(res, 405, { ok: false, message: 'method not allowed' })
        const query = new URL(req.url || '/', 'http://localhost').searchParams
        const body = req.method === 'GET' ? {} : await readBody(req)
        send(res, 200, await handle(body, query, req))
      } catch (error) {
        send(res, 200, { ok: false, message: error && error.message ? error.message : String(error) })
      }
    }
  }

  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: ROUTE_BASE + '/list',
      handler: guarded(['GET', 'POST'], () => listPayload()),
    }),
  )
  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: ROUTE_BASE + '/rows',
      handler: guarded(['GET', 'POST'], (_body, query) => rowsPayload(query)),
    }),
  )
  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: ROUTE_BASE + '/config',
      handler: guarded(['GET', 'POST'], (body, query, req) => (req.method === 'GET' ? configGetPayload(query) : configPostPayload(body))),
    }),
  )
  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: ROUTE_BASE + '/toggle',
      handler: guarded(['POST'], (body) => togglePayload(body)),
    }),
  )
  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: ROUTE_BASE + '/update',
      handler: guarded(['POST'], (body) => updatePlugin(body)),
    }),
  )
  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: ROUTE_BASE + '/models',
      handler: guarded(['GET', 'POST'], () => modelsPayload()),
    }),
  )
  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: ROUTE_BASE + '/inspect',
      handler: guarded(['GET', 'POST'], (_body, query) => inspectPayload(query.get('path') || '')),
    }),
  )
  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: ROUTE_BASE + '/import',
      handler: guarded(['POST'], (body) => importPlugin(body)),
    }),
  )
  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: ROUTE_BASE + '/remove',
      handler: guarded(['POST'], (body) => removePlugin(body)),
    }),
  )
}
