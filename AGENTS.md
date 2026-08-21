# AGENTS.md

DSH(DeepSeek Harness)插件集。一目录一插件,各自独立打包、独立版本。

## 新插件怎么做

1. 新建 `fzm-<name>/` 目录,内含:`package.json`、`index.js`(host 入口)、`cordis.patch.yml`、`README.md`;需要浏览器端再加 `client.js`。
2. `package.json` 约定:`"type": "module"`、零运行时依赖、`dsh.bundle.patch` 指向 patch 文件(声明后 CLI 自动进组合)、浏览器端声明 `dsh.client`、想让 fzm-plugin-manager 渲染配置表单就声明 `dsh.bundle.configSchema`(`{fields, defaults?}`,字段类型 `provider`/`model`/文本)。
3. 代码只写纯 JavaScript:无 TypeScript/JSX/import 转换;client 用手写 `__ModuleLoader__.load({id, factory})` factory,React 一律 `React.createElement`。
4. 依赖的 Service/Event/Slot 先查运行时契约(动态插件体系的 `cordis_inspect_*` 工具或 harness 源码),不猜 API;可选服务用 `ctx.get()` 并处理 undefined,硬依赖才进 `inject`。
5. 副作用全部可逆:路由、Slot、样式都挂到 `ctx.effect` / 返回 disposer 的 API 上。

## 验证与发布

- 语法:`node --input-type=module -e "await import('./index.js)"` + `node --check client.js`。
- 纯函数(如 YAML 行块解析)回归:strip `export` 后在 node 里 round-trip 实测,不只靠读代码。
- 打包 `npm pack` 出 tgz;**tgz 不入库**(GitHub Releases 承载);tag 用 `<包名>-v<版本>`。
- 换装到本机:`dsh plugin --profile web remove <pkg>` + `add <新tgz>`(update 对 `file:` 老路径会装回旧版);`dsh --dump-config --profile web` 验证组合;重启 `dsh web` 生效。

## 仓库规矩

- 各插件的版本号、README、tgz 都在自己目录里,互不影响;仓库根只放索引(LICENSE、本文件、README 的插件表)。
- 插件之间零耦合:任何"某个插件长什么样"的知识不进另一个插件的代码——通过 package.json 声明(如 `configSchema`)或运行时契约交互。
