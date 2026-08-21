# Changelog — fzm-vision-router

## 0.4.3

- 导出 `__testing` 测试面,新增 `node --test` 单元测试(5 例)
- 新增本 CHANGELOG

## 0.4.2

- `inject` 补齐 `attachments`/`fs`,移除 `ctx.get` 死守卫与 `requireService` 兜底;服务缺失时行进入等待而非首次调用才报错
- 修正文档对图片格式派生与 `UNSUPPORTED_CONTENT` 路径的描述

## 0.4.1

- `package.json` 声明 `dsh.bundle.configSchema`(provider/model + 默认值),供 fzm-plugin-manager 渲染导入表单

## 0.4.0

- 挂载时告警:路由不可解析或目录条目未声明图片模态时写入 harness 日志
- 调用前能力预检:非图片模型报可操作错误,不再静默落到适配器层
