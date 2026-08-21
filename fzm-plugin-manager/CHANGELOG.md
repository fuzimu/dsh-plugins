# Changelog — fzm-plugin-manager

## 0.4.2

- 导出 `__testing` 测试面,新增 `node --test` 解析器回归套件(12 例)
- 新增本 CHANGELOG

## 0.4.1

- 安全:`readTarballFile` 对包内路径做白名单校验 + shell 引号(堵 `/inspect` 命令注入);包名统一过 `PKG_NAME_RE`(堵路径遍历)
- 行重写保留 `inject` 字段(行内与块形式);`parsePatchRows`/`extractRowBlock` 合并为共享字段游走器 `parseRowFields`
- 空用户层 `cordis.patch.yml` 写入时生成头部注释
- client 样式经 `ctx.effect` 注册,卸载可清理;移除硬 inject 服务的死守卫

## 0.4.0

- 移除内置 `BUILTIN_CONFIG_SCHEMAS` 特例:声明式表单改由被管理包自带 `dsh.bundle.configSchema` 驱动,管理器与具体插件零耦合
- 行级 config/toggle 写入后经 `dsh --dump-config` 重组校验,失败自动回滚
- 卸载插件时清理用户层残留行覆盖
- 修复 config 块解析吞掉后续行级字段(如 `disabled`)的高危 bug;空行分隔保留;configText 写回缩进规范化(幂等)

## 0.3.0

- 首个通用化版本:任意符合 DSH 规范的插件包的导入/更新/卸载、行级启停与 YAML config 编辑
