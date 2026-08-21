# dsh-plugins

[![ci](https://github.com/fuzimu/dsh-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/fuzimu/dsh-plugins/actions/workflows/ci.yml)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(DSH)插件集。每个子目录是一个独立、可单独安装/升级的插件包,符合 DSH bundle 规范(`dsh.bundle.patch`)。

## 插件索引

| 插件 | 版本 | 说明 |
|---|---|---|
| [fzm-vision-router](fzm-vision-router/) | 0.4.3 | 注册 `vision_describe` 工具,把图片路由到专用视觉模型(默认 Kimi K3),纯文本主模型也能看图 |
| [fzm-plugin-manager](fzm-plugin-manager/) | 0.4.2 | Web 设置页新增「自定义插件」管理页:导入/更新/卸载任意 DSH 插件包,行级启停与 config 编辑 |

## 安装

任一插件,一条命令(以 vision-router 为例):

```bash
dsh plugin --profile web add ./fzm-vision-router
# 或 GitHub Release 里下载的 tgz
```

重启 `dsh web` 后生效。各插件的详细说明见各自目录的 README。

## 发布产物

`*.tgz` 不入库,附在 [Releases](../../releases) 中;tag 命名 `<包名>-v<版本>`,如 `fzm-vision-router-v0.4.1`。

## License

[MIT](LICENSE)
