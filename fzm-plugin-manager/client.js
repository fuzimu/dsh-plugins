// fzm-plugin-manager — browser bundle (lazy-CJS factory for window.__ModuleLoader__).
//
// Hand-written: no build step. Registers the "自定义插件" tab into the
// Settings → Plugins section (slot `settings.plugins.tab`) and talks to the
// package's Host HTTP routes (/fzm-plugin-manager/*). Only `react` is
// required from the module graph; everything else is platform APIs.
//
// Generalization note: the tab is plugin-agnostic. It lists every profile
// bundle, lets the user expand a bundle to see its rows (from its patch),
// enable/disable a row, edit a row's config as YAML, import/update/remove the
// bundle. A bundle declaring its own `dsh.bundle.configSchema` gets a friendly
// import form rendered generically from that schema; anything else falls back
// to row-level YAML config editing.

window.__ModuleLoader__.load({
  id: 'fzm-plugin-manager',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    var API_BASE = '/fzm-plugin-manager'
    var GUARD_HEADER = { 'x-fzm-plugin-manager': '1' }
    // Host `workspaces` service (provided by dsh-client-runtime): the native
    // directory picker returns a HOST-side path — the exact input our import
    // endpoint consumes, so no upload is involved.
    var workspaces = null

    var CSS = [
      '.plgx-root { padding: 16px 20px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5; }',
      '.plgx-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }',
      '.plgx-title { font-weight: 600; }',
      '.plgx-sub { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-top: 2px; }',
      '.plgx-btn { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 5px 12px; font-size: 12px; cursor: pointer; white-space: nowrap; }',
      '.plgx-btn:hover { border-color: var(--dsw-alias-brand-primary); }',
      '.plgx-btn-primary { background: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); }',
      '.plgx-btn-danger { color: var(--dsw-alias-state-error-primary); }',
      '.plgx-btn-sm { padding: 2px 8px; font-size: 11px; }',
      '.plgx-btn[disabled] { opacity: .5; cursor: default; }',
      '.plgx-banner { border: 1px solid var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; font-size: 12px; }',
      '.plgx-notice { border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; font-size: 12px; }',
      '.plgx-notice-ok { border: 1px solid var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }',
      '.plgx-notice-err { border: 1px solid var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }',
      '.plgx-detail { margin-top: 6px; max-height: 140px; overflow: auto; background: var(--dsw-alias-bg-layer-2); border-radius: 6px; padding: 6px 8px; font-family: monospace; font-size: 11px; white-space: pre-wrap; color: var(--dsw-alias-label-secondary); }',
      '.plgx-list { display: flex; flex-direction: column; gap: 8px; }',
      '.plgx-row { display: flex; align-items: center; gap: 10px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 10px; padding: 10px 12px; }',
      '.plgx-row-click { cursor: pointer; }',
      '.plgx-row-open { border-color: var(--dsw-alias-brand-primary); }',
      '.plgx-name { font-weight: 600; font-family: monospace; }',
      '.plgx-ver { color: var(--dsw-alias-label-secondary); font-size: 11px; margin-top: 2px; word-break: break-all; }',
      '.plgx-state { color: var(--dsw-alias-label-secondary); font-size: 11px; margin-left: auto; white-space: nowrap; }',
      '.plgx-badge { font-size: 11px; border-radius: 999px; padding: 1px 8px; border: 1px solid; white-space: nowrap; }',
      '.plgx-badge-local { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }',
      '.plgx-badge-official { color: var(--dsw-alias-label-secondary); border-color: var(--dsw-alias-border-l2); }',
      '.plgx-badge-off { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }',
      '.plgx-empty { color: var(--dsw-alias-label-secondary); padding: 24px 0; text-align: center; }',
      '.plgx-mask { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }',
      '.plgx-dialog { width: 560px; max-width: 92vw; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 16px; }',
      '.plgx-dialog-title { margin: 0 0 8px; font-size: 14px; font-weight: 600; }',
      '.plgx-field { width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 7px 10px; font-size: 12px; font-family: monospace; }',
      '.plgx-textarea { min-height: 160px; resize: vertical; font-family: monospace; }',
      '.plgx-path { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12px; word-break: break-all; }',
      '.plgx-link { background: none; border: none; color: var(--dsw-alias-brand-primary); font-size: 11px; cursor: pointer; padding: 0; margin: 6px 0 4px; }',
      '.plgx-link:hover { text-decoration: underline; }',
      '.plgx-cfg { margin-top: 10px; }',
      '.plgx-cfg-title { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-bottom: 2px; }',
      '.plgx-select { width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 6px 8px; font-size: 12px; margin-top: 6px; }',
      '.plgx-select:disabled { opacity: .5; }',
      '.plgx-hint { color: var(--dsw-alias-label-secondary); font-size: 11px; margin: 6px 0 12px; }',
      '.plgx-actions { display: flex; justify-content: flex-end; gap: 8px; }',
      '.plgx-rows { margin: 8px 0 0 4px; padding: 8px 0 0 12px; border-left: 1px solid var(--dsw-alias-border-l1); display: flex; flex-direction: column; gap: 6px; }',
      '.plgx-rowitem { display: flex; align-items: center; gap: 8px; font-size: 12px; }',
      '.plgx-rowid { font-family: monospace; font-weight: 600; }',
      '.plgx-rowmeta { color: var(--dsw-alias-label-secondary); font-size: 11px; }',
      '.plgx-chip { font-size: 11px; border-radius: 6px; padding: 1px 6px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }',
    ].join('\n')

    function insertStyles() {
      if (typeof document === 'undefined') return
      var tagId = 'fzm-plugin-manager/styles'
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') !== null) return
      var tag = document.createElement('style')
      tag.dataset.plugin = 'fzm-plugin-manager'
      tag.dataset.pluginCss = tagId
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    function apiJson(path, method, body) {
      var headers = Object.assign({}, GUARD_HEADER)
      if (method && method !== 'GET') headers['content-type'] = 'application/json'
      return fetch(API_BASE + path, {
        method: method || 'GET',
        headers: headers,
        body: body ? JSON.stringify(body) : undefined,
      }).then(function (r) { return r.json() })
    }

    function apiList() { return apiJson('/list') }
    function apiImport(spec, config) {
      var payload = { spec: spec }
      if (config) payload.config = config
      return apiJson('/import', 'POST', payload)
    }
    function apiRemove(name) { return apiJson('/remove', 'POST', { name: name }) }
    function apiUpdate(name) { return apiJson('/update', 'POST', { name: name }) }
    function apiRows(pkg) { return apiJson('/rows?package=' + encodeURIComponent(pkg)) }
    function apiConfigGet(pkg, row) {
      return apiJson('/config?package=' + encodeURIComponent(pkg) + '&row=' + encodeURIComponent(row))
    }
    function apiConfigPost(pkg, row, configText) {
      return apiJson('/config', 'POST', { package: pkg, row: row, configText: configText })
    }
    function apiToggle(pkg, row, disabled) {
      return apiJson('/toggle', 'POST', { package: pkg, row: row, disabled: disabled })
    }

    function messageOf(error) {
      return error && error.message ? error.message : String(error)
    }

    // True when any schema field needs the provider/model catalog (/models).
    function schemaNeedsProviders(schema) {
      var fields = (schema && schema.fields) || {}
      return Object.keys(fields).some(function (k) {
        var t = fields[k] && fields[k].type
        return t === 'provider' || t === 'model'
      })
    }

    // Same display-name rule the official plugin-inventory list uses, so the
    // two lists show identical primary names (e.g. both "vision-router" for
    // the package fzm-vision-router) instead of confusingly different ones.
    function moduleShortName(moduleName) {
      var s = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
      s = s.replace(/^cordis:/, '').replace(/^cordis-plugin-/, '').replace(/^dsh-(?:host-|client-)?/, '')
      return s
    }

    function stateLabel(item) {
      // Local packages: `composed` = the row appears in a fresh compose of the
      // ON-DISK profile files (NOT the live process — a just-installed bundle
      // composes before the restart that actually loads it); `active` = in the
      // bundle stack. The dirty banner carries the "restart required" signal.
      // Official layers ship with the profile — show them as built-in.
      if (item.kind === 'local') {
        if (item.composed === true) return '组合中'
        if (item.active) return '已加入组合(重启后生效)'
        return '已安装(未激活)'
      }
      return item.active ? '内置(随 profile 自带)' : '已安装(未激活)'
    }

    function Badge(props) {
      return React.createElement(
        'span',
        { className: 'plgx-badge ' + (props.kind === 'local' ? 'plgx-badge-local' : 'plgx-badge-official') },
        props.kind === 'local' ? '本地导入' : '官方',
      )
    }

    // A single row inside an expanded bundle: id, name, enable/disable, edit.
    function RowItem(props) {
      var row = props.row
      var pkg = props.pkg
      var busy = props.busy
      return React.createElement(
        'div',
        { className: 'plgx-rowitem' },
        React.createElement('span', { className: 'plgx-rowid' }, row.id),
        row.name ? React.createElement('span', { className: 'plgx-rowmeta' }, row.name) : null,
        row.disabled
          ? React.createElement('span', { className: 'plgx-badge plgx-badge-off' }, '已禁用')
          : React.createElement('span', { className: 'plgx-chip' }, '启用'),
        row.hasConfig ? React.createElement('span', { className: 'plgx-chip' }, '有 config') : null,
        React.createElement(
          'button',
          {
            className: 'plgx-btn plgx-btn-sm',
            disabled: busy,
            onClick: function () { props.onToggle(row.id, !row.disabled) },
          },
          row.disabled ? '启用' : '禁用',
        ),
        React.createElement(
          'button',
          {
            className: 'plgx-btn plgx-btn-sm',
            disabled: busy,
            onClick: function () { props.onEdit(row.id) },
          },
          '编辑 config',
        ),
      )
    }

    function CustomPluginsTab() {
      var initial = { loading: true, items: [], dirty: false, loadError: null }
      var state = React.useState(initial)
      var view = state[0]
      var setView = state[1]
      var dialogState = React.useState(false)
      var dialogOpen = dialogState[0]
      var setDialogOpen = dialogState[1]
      var specState = React.useState('')
      var spec = specState[0]
      var setSpec = specState[1]
      var busyState = React.useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var noticeState = React.useState(null)
      var notice = noticeState[0]
      var setNotice = noticeState[1]
      var confirmState = React.useState(null)
      var confirming = confirmState[0]
      var setConfirming = confirmState[1]
      var manualState = React.useState(false)
      var manual = manualState[0]
      var setManual = manualState[1]
      var inspectState = React.useState(null)
      var inspect = inspectState[0]
      var setInspect = inspectState[1]
      var importReadyState = React.useState(false)
      var importReady = importReadyState[0]
      var setImportReady = importReadyState[1]
      // declarative-form state: the imported package declares its own schema
      // via `dsh.bundle.configSchema` ({fields, defaults?}); values are keyed
      // by field name. `providers` feeds provider/model-typed fields.
      var providersState = React.useState([])
      var providers = providersState[0]
      var setProviders = providersState[1]
      var cfgValuesState = React.useState({})
      var cfgValues = cfgValuesState[0]
      var setCfgValues = cfgValuesState[1]
      // expanded bundle + row config editor
      var expandedState = React.useState(null)
      var expanded = expandedState[0]
      var setExpanded = expandedState[1]
      var editorState = React.useState(null)
      var editor = editorState[0]
      var setEditor = editorState[1]
      // Debounce timer as a ref: a plain closure variable is reset to null on
      // every re-render, so a scheduled inspect can never be cancelled across
      // renders (duplicate requests) and leaks past unmount.
      var inspectTimerRef = React.useRef(null)

      function refresh() {
        return apiList()
          .then(function (res) {
            setView({ loading: false, items: (res && res.items) || [], dirty: !!(res && res.dirty), loadError: null })
          })
          .catch(function (error) {
            setView({ loading: false, items: [], dirty: false, loadError: messageOf(error) })
          })
      }
      React.useEffect(function () { refresh() }, [])
      React.useEffect(function () {
        return function () {
          if (inspectTimerRef.current !== null) clearTimeout(inspectTimerRef.current)
        }
      }, [])

      // Ask the Host what the picked/typed path is: whether it is a valid
      // package, whether it is already installed, its bundle/client status,
      // its row inventory, and (for a known declarative schema) the current
      // provider/model options. Import is only clickable once the path passed
      // host validation (valid package, not already installed).
      function inspectSpec(path) {
        if (inspectTimerRef.current !== null) {
          clearTimeout(inspectTimerRef.current)
          inspectTimerRef.current = null
        }
        if (typeof path !== 'string' || path.trim().length === 0) {
          setInspect(null)
          setImportReady(false)
          setProviders([])
          return
        }
        apiJson('/inspect?path=' + encodeURIComponent(path.trim()))
          .then(function (res) {
            if (!res || !res.ok) {
              setInspect({ kind: 'err', text: (res && res.message) || '该路径不是有效的插件包' })
              setImportReady(false)
              setProviders([])
              return
            }
            if (res.installed) {
              // Early return: falling through would overwrite this error with
              // the green "ok" summary below and hide the conflict warning.
              setInspect({
                kind: 'err',
                text: '该插件已安装' + (res.installed.version ? '(v' + res.installed.version + ')' : '') + ',导入会被拒绝;如需更新请先卸载',
              })
              setImportReady(false)
              setProviders([])
              return
            }
            setImportReady(true)
            var detail = []
            if (res.bundle) detail.push('bundle(进组合)')
            if (res.client) detail.push('client(有浏览器端)')
            if (res.rows) detail.push(res.rows.length + ' 行')
            var schema =
              res.configSchema && typeof res.configSchema === 'object' && res.configSchema.fields ? res.configSchema : null
            setInspect({
              kind: 'ok',
              text: (res.name || '?') + (res.version ? '  v' + res.version : '') + (detail.length ? '  ·  ' + detail.join(' · ') : ''),
              configSchema: schema,
            })
            setCfgValues({})
            if (schema && schemaNeedsProviders(schema)) {
              return apiJson('/models').then(function (mr) {
                if (mr && mr.ok && Array.isArray(mr.providers)) {
                  setProviders(mr.providers)
                } else {
                  setProviders([])
                }
              })
            } else {
              setProviders([])
            }
          })
          .catch(function () {
            setInspect(null)
            setImportReady(false)
            setProviders([])
          })
      }

      function scheduleInspect(path) {
        if (inspectTimerRef.current !== null) clearTimeout(inspectTimerRef.current)
        inspectTimerRef.current = setTimeout(function () {
          inspectTimerRef.current = null
          inspectSpec(path)
        }, 400)
      }

      // Open the Host's native directory picker (macOS/Win32/Linux chooser via
      // the official directory-picker seam). Returns a HOST-side path or null
      // on cancel. Remote/browse deployments have no native backend — fall
      // back to the manual input instead of failing.
      function openPicker() {
        if (busy) return
        if (!workspaces || typeof workspaces.pickDirectory !== 'function') {
          setManual(true)
          setDialogOpen(true)
          setNotice({ kind: 'err', text: '当前部署不支持原生目录选择(远程/SSH 环境),请手动输入路径' })
          return
        }
        workspaces.pickDirectory()
          .then(function (path) {
            if (typeof path === 'string' && path.length > 0) {
              setSpec(path)
              setManual(false)
              setDialogOpen(true)
              inspectSpec(path)
            }
          })
          .catch(function (error) {
            setManual(true)
            setDialogOpen(true)
            setNotice({ kind: 'err', text: '打开目录选择器失败: ' + messageOf(error) })
          })
      }

      function doImport() {
        // importReady is part of the gate (not just the button's disabled
        // flag): the manual input's Enter key reaches here directly.
        if (busy || spec.trim().length === 0 || !importReady) return
        setBusy(true)
        setNotice(null)
        var config = null
        if (inspect && inspect.configSchema) {
          config = {}
          var fields = inspect.configSchema.fields || {}
          Object.keys(fields).forEach(function (fname) {
            var v = cfgValues[fname]
            if (typeof v === 'string' && v.trim().length > 0) config[fname] = v.trim()
          })
          if (Object.keys(config).length === 0) config = null
        }
        apiImport(spec, config)
          .then(function (res) {
            setBusy(false)
            if (res && res.ok) {
              setNotice({ kind: 'ok', text: res.message || '导入成功' })
              setDialogOpen(false)
              setSpec('')
              setInspect(null)
            } else {
              setNotice({ kind: 'err', text: (res && res.message) || '导入失败', detail: res && res.detail })
            }
            refresh()
          })
          .catch(function (error) {
            setBusy(false)
            setNotice({ kind: 'err', text: '导入出错: ' + messageOf(error) })
          })
      }

      function doUpdate(name) {
        if (busy) return
        setBusy(true)
        setNotice(null)
        apiUpdate(name)
          .then(function (res) {
            setBusy(false)
            setNotice(res && res.ok ? { kind: 'ok', text: res.message || '已更新' } : { kind: 'err', text: (res && res.message) || '更新失败', detail: res && res.detail })
            refresh()
          })
          .catch(function (error) {
            setBusy(false)
            setNotice({ kind: 'err', text: '更新出错: ' + messageOf(error) })
          })
      }

      function doRemove(name) {
        if (busy) return
        if (confirming !== name) {
          setConfirming(name)
          return
        }
        setConfirming(null)
        setBusy(true)
        setNotice(null)
        apiRemove(name)
          .then(function (res) {
            setBusy(false)
            setNotice(
              res && res.ok
                ? { kind: 'ok', text: res.message || '已卸载' }
                : { kind: 'err', text: (res && res.message) || '卸载失败', detail: res && res.detail },
            )
            if (expanded === name) setExpanded(null)
            refresh()
          })
          .catch(function (error) {
            setBusy(false)
            setNotice({ kind: 'err', text: '卸载出错: ' + messageOf(error) })
          })
      }

      function toggleRow(pkg, rowId, disabled) {
        if (busy) return
        setBusy(true)
        setNotice(null)
        apiToggle(pkg, rowId, disabled)
          .then(function (res) {
            setBusy(false)
            setNotice(res && res.ok ? { kind: 'ok', text: res.message || '已更新' } : { kind: 'err', text: (res && res.message) || '操作失败' })
            refresh()
          })
          .catch(function (error) {
            setBusy(false)
            setNotice({ kind: 'err', text: '操作出错: ' + messageOf(error) })
          })
      }

      function openEditor(pkg, rowId) {
        setBusy(true)
        apiConfigGet(pkg, rowId)
          .then(function (res) {
            setBusy(false)
            if (!res || !res.ok) {
              setNotice({ kind: 'err', text: (res && res.message) || '读取配置失败' })
              return
            }
            setEditor({ pkg: pkg, row: rowId, configText: res.configText || '', source: res.source, disabled: res.disabled })
          })
          .catch(function (error) {
            setBusy(false)
            setNotice({ kind: 'err', text: '读取配置出错: ' + messageOf(error) })
          })
      }

      function saveEditor() {
        if (busy || !editor) return
        setBusy(true)
        setNotice(null)
        apiConfigPost(editor.pkg, editor.row, editor.configText)
          .then(function (res) {
            setBusy(false)
            if (res && res.ok) {
              setEditor(null)
              setNotice({ kind: 'ok', text: res.message || '已保存' })
            } else {
              setNotice({ kind: 'err', text: (res && res.message) || '保存失败' })
            }
            refresh()
          })
          .catch(function (error) {
            setBusy(false)
            setNotice({ kind: 'err', text: '保存出错: ' + messageOf(error) })
          })
      }

      function toggleExpand(name) {
        setExpanded(expanded === name ? null : name)
      }

      var children = []

      children.push(
        React.createElement(
          'div',
          { className: 'plgx-head', key: 'head' },
          React.createElement(
            'div',
            null,
            React.createElement('div', { className: 'plgx-title' }, '自定义插件'),
            React.createElement('div', { className: 'plgx-sub' }, '导入 / 卸载 / 更新 DSH 插件包,并编辑其组合行配置。'),
          ),
          React.createElement(
            'button',
            { className: 'plgx-btn plgx-btn-primary', onClick: openPicker },
            '+ 添加本地插件',
          ),
        ),
      )

      if (view.dirty) {
        children.push(
          React.createElement('div', { className: 'plgx-banner', key: 'banner' }, '插件组合已变更,重启 dsh web 后生效。'),
        )
      }

      if (notice) {
        children.push(
          React.createElement(
            'div',
            { className: 'plgx-notice ' + (notice.kind === 'ok' ? 'plgx-notice-ok' : 'plgx-notice-err'), key: 'notice' },
            notice.text,
            notice.detail ? React.createElement('pre', { className: 'plgx-detail' }, notice.detail) : null,
          ),
        )
      }

      if (view.loading) {
        children.push(React.createElement('div', { className: 'plgx-empty', key: 'loading' }, '加载中…'))
      } else if (view.loadError) {
        children.push(React.createElement('div', { className: 'plgx-empty', key: 'error' }, '读取插件清单失败: ' + view.loadError))
      } else if (view.items.length === 0) {
        children.push(React.createElement('div', { className: 'plgx-empty', key: 'empty' }, '当前 profile 没有任何插件包。'))
      } else {
        var sorted = view.items.slice().sort(function (a, b) { return a.kind === b.kind ? 0 : a.kind === 'local' ? -1 : 1 })
        children.push(
          React.createElement(
            'div',
            { className: 'plgx-list', key: 'list' },
            sorted.map(function (item) {
              var rowEls = []
              if (expanded === item.name && item.rows && item.rows.length > 0) {
                rowEls = item.rows.map(function (row) {
                  return React.createElement(RowItem, {
                    key: row.id,
                    row: row,
                    pkg: item.name,
                    busy: busy,
                    onToggle: toggleRow,
                    onEdit: openEditor,
                  })
                })
              } else if (expanded === item.name) {
                rowEls = [React.createElement('div', { className: 'plgx-rowmeta', key: 'no-rows' }, '该包没有可管理的组合行(未声明 dsh.bundle)。')]
              }
              return React.createElement(
                'div',
                { key: item.name },
                React.createElement(
                  'div',
                  {
                    className: 'plgx-row plgx-row-click' + (expanded === item.name ? ' plgx-row-open' : ''),
                    onClick: function () { toggleExpand(item.name) },
                  },
                  React.createElement(Badge, { kind: item.kind }),
                  React.createElement(
                    'div',
                    null,
                    React.createElement('div', { className: 'plgx-name' }, moduleShortName(item.name)),
                    React.createElement(
                      'div',
                      { className: 'plgx-ver' },
                      item.name + (item.version ? '  ·  v' + item.version : '') + (item.spec ? '  ·  ' + item.spec : ''),
                    ),
                  ),
                  React.createElement('span', { className: 'plgx-state' }, stateLabel(item)),
                  item.kind === 'local'
                    ? React.createElement(
                        'button',
                        {
                          className: 'plgx-btn plgx-btn-sm',
                          disabled: busy,
                          onClick: function (e) { e.stopPropagation(); doUpdate(item.name) },
                        },
                        '更新',
                      )
                    : null,
                  item.kind === 'local'
                    ? React.createElement(
                        'button',
                        {
                          className: 'plgx-btn plgx-btn-sm plgx-btn-danger',
                          disabled: busy,
                          onClick: function (e) { e.stopPropagation(); doRemove(item.name) },
                        },
                        confirming === item.name ? '确认卸载?' : '卸载',
                      )
                    : null,
                ),
                expanded === item.name ? React.createElement('div', { className: 'plgx-rows', key: 'rows' }, rowEls) : null,
              )
            }),
          ),
        )
      }

      if (dialogOpen) {
        children.push(
          React.createElement(
            'div',
            { className: 'plgx-mask', key: 'dialog', onClick: function () { if (!busy) setDialogOpen(false) } },
            React.createElement(
              'div',
              { className: 'plgx-dialog', onClick: function (e) { e.stopPropagation() } },
              React.createElement('div', { className: 'plgx-dialog-title' }, '添加本地插件'),
              manual
                ? React.createElement('input', {
                    className: 'plgx-field',
                    value: spec,
                    placeholder: '/绝对路径/插件目录(含 package.json)',
                    onChange: function (e) {
                      var v = e.target.value
                      setSpec(v)
                      scheduleInspect(v)
                    },
                    onKeyDown: function (e) { if (e.key === 'Enter') doImport() },
                  })
                : React.createElement(
                    'div',
                    { className: 'plgx-field plgx-path' },
                    spec,
                    React.createElement(
                      'button',
                      { className: 'plgx-btn', onClick: openPicker },
                      '浏览目录…',
                    ),
                  ),
              React.createElement(
                'div',
                { className: 'plgx-hint' },
                manual
                  ? '手动输入插件目录绝对路径(或 ~ 开头)。'
                  : '选择包含 package.json 的插件目录;.tgz 请先解压为目录再选择。导入即加入 profile 组合,重启后启用。',
              ),
              React.createElement(
                'button',
                { className: 'plgx-link', onClick: function () { setManual(!manual) } },
                manual ? '使用目录选择器' : '手动输入路径',
              ),
              inspect
                ? React.createElement(
                    'div',
                    { className: 'plgx-notice ' + (inspect.kind === 'ok' ? 'plgx-notice-ok' : 'plgx-notice-err'), key: 'inspect' },
                    inspect.text,
                  )
                : null,
              inspect && inspect.configSchema
                ? React.createElement(
                    'div',
                    { className: 'plgx-cfg', key: 'cfg' },
                    React.createElement('div', { className: 'plgx-cfg-title' }, '插件配置(可留空用插件默认)'),
                    Object.keys(inspect.configSchema.fields || {}).map(function (fname) {
                      var field = inspect.configSchema.fields[fname] || {}
                      var defaults = inspect.configSchema.defaults || {}
                      var dft = typeof defaults[fname] === 'string' && defaults[fname].length > 0 ? defaults[fname] : null
                      var label = (typeof field.label === 'string' && field.label) || fname
                      function setField(value) {
                        var next = Object.assign({}, cfgValues)
                        next[fname] = value
                        setCfgValues(next)
                      }
                      var control
                      if (field.type === 'provider') {
                        control = React.createElement(
                          'select',
                          {
                            className: 'plgx-select',
                            value: cfgValues[fname] || '',
                            onChange: function (e) {
                              var next = Object.assign({}, cfgValues)
                              next[fname] = e.target.value
                              // changing the provider invalidates model choices
                              Object.keys(inspect.configSchema.fields || {}).forEach(function (other) {
                                var of2 = inspect.configSchema.fields[other]
                                if (of2 && of2.type === 'model') next[other] = ''
                              })
                              setCfgValues(next)
                            },
                          },
                          React.createElement('option', { value: '' }, dft ? '使用插件默认(' + dft + ')' : '(使用插件默认)'),
                          providers.map(function (p) {
                            return React.createElement('option', { key: p.id, value: p.id }, p.name + ' (' + p.id + ')')
                          }),
                        )
                      } else if (field.type === 'model') {
                        // model options come from the first provider-typed field's current value
                        var providerField = null
                        var keys = Object.keys(inspect.configSchema.fields || {})
                        for (var i = 0; i < keys.length; i++) {
                          var f2 = inspect.configSchema.fields[keys[i]]
                          if (f2 && f2.type === 'provider') { providerField = keys[i]; break }
                        }
                        var chosenProvider = providerField ? cfgValues[providerField] || '' : ''
                        var current = null
                        for (var j = 0; j < providers.length; j++) {
                          if (providers[j].id === chosenProvider) { current = providers[j]; break }
                        }
                        var models = current && Array.isArray(current.models) ? current.models : []
                        control = React.createElement(
                          'select',
                          {
                            className: 'plgx-select',
                            value: cfgValues[fname] || '',
                            disabled: chosenProvider.length === 0,
                            onChange: function (e) { setField(e.target.value) },
                          },
                          React.createElement('option', { value: '' }, dft ? '使用插件默认(' + dft + ')' : '(使用插件默认)'),
                          models.map(function (m) {
                            return React.createElement('option', { key: m.id, value: m.id }, m.name + ' (' + m.id + ')')
                          }),
                        )
                      } else {
                        control = React.createElement('input', {
                          className: 'plgx-field',
                          value: cfgValues[fname] || '',
                          placeholder: dft ? '默认: ' + dft : '',
                          onChange: function (e) { setField(e.target.value) },
                        })
                      }
                      return React.createElement(
                        'div',
                        { key: fname },
                        React.createElement('div', { className: 'plgx-cfg-title' }, label),
                        control,
                      )
                    }),
                  )
                : inspect && inspect.kind === 'ok'
                  ? React.createElement(
                      'div',
                      { className: 'plgx-hint', key: 'cfg-hint' },
                      '该包未声明 dsh.bundle.configSchema;导入后可在列表中展开行级编辑 config(YAML)。',
                    )
                  : null,
              React.createElement(
                'div',
                { className: 'plgx-actions' },
                React.createElement('button', { className: 'plgx-btn', disabled: busy, onClick: function () { setDialogOpen(false) } }, '取消'),
                React.createElement(
                  'button',
                  { className: 'plgx-btn plgx-btn-primary', disabled: busy || spec.trim().length === 0 || !importReady, onClick: doImport },
                  busy ? '导入中…' : '验证并导入',
                ),
              ),
            ),
          ),
        )
      }

      if (editor) {
        children.push(
          React.createElement(
            'div',
            { className: 'plgx-mask', key: 'editor', onClick: function () { if (!busy) setEditor(null) } },
            React.createElement(
              'div',
              { className: 'plgx-dialog', onClick: function (e) { e.stopPropagation() } },
              React.createElement('div', { className: 'plgx-dialog-title' }, '编辑 config · ' + editor.row),
              React.createElement(
                'div',
                { className: 'plgx-hint' },
                '当前来源: ' +
                  (editor.source === 'override' ? '用户层覆盖' : editor.source === 'default' ? '插件默认' : '无') +
                  (editor.disabled ? ' · 该行已禁用' : '') +
                  '。写入会整行替换该行的 config(不是字段合并),重启后生效。',
              ),
              React.createElement('textarea', {
                className: 'plgx-field plgx-textarea',
                value: editor.configText,
                spellCheck: false,
                onChange: function (e) { setEditor(Object.assign({}, editor, { configText: e.target.value })) },
              }),
              React.createElement(
                'div',
                { className: 'plgx-actions' },
                React.createElement('button', { className: 'plgx-btn', disabled: busy, onClick: function () { setEditor(null) } }, '取消'),
                React.createElement(
                  'button',
                  { className: 'plgx-btn plgx-btn-primary', disabled: busy, onClick: saveEditor },
                  busy ? '保存中…' : '保存',
                ),
              ),
            ),
          ),
        )
      }

      return React.createElement('div', { className: 'plgx-root' }, children)
    }

    // Only `slots` is a hard dependency. `workspaces` stays optional
    // (ctx.get): the code below degrades to manual path input when the native
    // picker is unavailable, and a hard inject would instead leave the plugin
    // waiting forever on deployments without the service.
    var inject = ['slots']

    function apply(ctx) {
      insertStyles()
      workspaces = ctx.get('workspaces') || null
      ctx.slots.inject('settings.plugins.tab', function () {
        return ctx.slots.register(
          { name: 'settings.plugins.tab', id: 'custom-local', order: 20, label: '自定义插件' },
          function () { return React.createElement(CustomPluginsTab) },
        )
      })
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
