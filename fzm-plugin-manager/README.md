# fzm-plugin-manager

DeepSeek Harness(DSH)Web 插件:在 **设置 → 插件** 区新增「**自定义插件**」标签页,用于管理**任意符合 DSH 规范**的插件包 —— 导入、更新、卸载,并编辑其组合行的配置。

- 以徽标区分 **官方自带 / 本地导入**;本地插件可**更新 / 卸载**。
- 展开任一插件包,查看它向组合贡献的**行清单**(来自它的 `cordis.patch.yml`)。
- 对每一行:启用/禁用、以 **YAML 编辑 config**(写入 profile 用户层 `cordis.patch.yml`,重启后生效)。
- 导入时,若插件在自己的 `package.json` 声明了 `dsh.bundle.configSchema`(如 `fzm-vision-router` 声明的 provider/model),渲染**表单**;否则提示导入后于行级编辑。

> 定位:官方 `@deepseek-ai/dsh-host-plugin-inventory` 是**只读**的 Loader 树投影(不能增删改)。本插件是其**写操作补充**。

## 工作原理

```
浏览器标签页(React)─ fetch ─→ Host HTTP 路由(/fzm-plugin-manager/*)
                                    ↓
                          dsh plugin --profile web add/update/remove
                                    ↓
                          ~/.dsh/profiles/web/(pnpm 安装 + bundle 层 reconcile)
                            + 行级 config/disabled 写入用户层 cordis.patch.yml
```

- **Host 半侧**(`index.js`):在 `webServer` 服务上注册回环路由,复用 DSH CLI 完成安装/更新/卸载;解析 bundle 的 `dsh.bundle.patch` 得到行清单;把行级 `config`/`disabled` 覆盖写进 profile 用户层 `cordis.patch.yml`(只动目标行,保留其余原文)。
- **浏览器半侧**(`client.js`):手写 `__ModuleLoader__` factory 格式(无构建步骤),注册到官方预留的 `settings.plugins.tab` 扩展点;目录选择复用官方 `workspaces.pickDirectory()`(原生 OS 对话框,返回服务器侧路径)。
- 所有路由要求 `x-fzm-plugin-manager: 1` 自定义头 —— 该头不在 CORS 安全清单内,跨域页面无法在不触发预检的情况下调用,而本服务不应答预检。

## 安装(一条命令)

```bash
dsh plugin --profile web add ./fzm-plugin-manager-0.4.0.tgz
# 或包目录:
dsh plugin --profile web add /path/to/fzm-plugin-manager
```

**重启 `dsh web` 后生效**(host 组合与客户端 bundle 扫描都在启动时进行)。

验证:

```bash
dsh --dump-config --profile web | grep -A2 plugin-manager
# 重启后浏览器:curl -H 'x-fzm-plugin-manager: 1' http://127.0.0.1:3080/fzm-plugin-manager/list
```

## 使用

1. 重启后打开 **设置 → 插件 → 自定义插件**
2. 「+ 添加本地插件」→ 弹出系统目录选择器(复用官方 picker,选中即返回服务器侧路径);远程/SSH 部署无原生对话框时自动切换为手动输入
   - 选择包含 `package.json` 的插件目录;`.tgz` 请先解压为目录
   - 导入声明了 `dsh.bundle` 的包自动加入 profile 组合,重启后启用;未声明的包会提示"已安装为依赖,不会自动进入组合"
3. **行级管理**:列表项可展开,显示该包贡献的组合行;每行可 **启用/禁用**、**编辑 config**(YAML 文本框,整行替换该行 config)
4. 本地插件可 **更新**、**卸载**(两步确认)
5. 任何变更后顶部出现「重启后生效」横幅

## 支持的 Host 路由

| 路由 | 方法 | 作用 |
|---|---|---|
| `/list` | GET/POST | profile 插件清单(含行清单摘要、bundle/client 状态) |
| `/rows?package=` | GET/POST | 某 bundle 的行清单 |
| `/config?package=&row=` | GET | 读某行当前生效 config(用户层覆盖优先,否则插件默认) |
| `/config` | POST | 写某行 config 覆盖(用户层) |
| `/toggle` | POST | 行级启用/禁用 |
| `/update` | POST | `dsh plugin --profile web update <pkg>` |
| `/models` | GET/POST | 已配置的 provider 路由 + 模型(供声明式表单) |
| `/inspect?path=` | GET/POST | 校验导入源:规范符合性、行清单、client、schema |
| `/import` | POST | `dsh plugin --profile web add <spec>` |
| `/remove` | POST | `dsh plugin --profile web remove <pkg>` |

## 通用化说明

本插件**不硬编码任何包的配置字段**,而是:

- 从 bundle 的 `dsh.bundle.patch` 派生行清单;
- 把行级覆盖写进 profile 用户层 `cordis.patch.yml`,保留用户手写的其余内容;
- 声明式表单由**被管理插件自己**在 `package.json` 的 `dsh.bundle.configSchema` 声明(`{fields, defaults?}`;字段类型支持 `provider`/`model` 下拉与文本框),命中则渲染表单,否则回退 YAML。管理器与被管理插件零耦合 —— 任何符合约定的包都能获得表单。

详细设计见 [DESIGN.md](DESIGN.md)。

## 卸载本插件自身

```bash
dsh plugin --profile web remove fzm-plugin-manager
```

(页面里的「卸载」按钮对官方包隐藏,但本包属于本地包 —— 在页面上卸载自身会导致当前会话的页面来源消失,建议用 CLI。)

## 注意事项

- **需要 DSH ≥ v0.1.0-rc.8**,web profile 默认绑定回环地址;若部署绑 `0.0.0.0`,这些路由会随之暴露到局域网,请自行评估
- 变更都需要**重启 dsh web** 才生效(组合在启动时组装)
- **config 覆盖是整行替换**(不 merge):编辑时会加载"当前生效 config"(含插件默认 + 用户层覆盖)避免误丢字段
- 行级 config/toggle 写入后会立即用 `dsh --dump-config` 重组校验,校验失败自动回滚并返回错误 —— 不会把坏 YAML 留到下次启动
- 卸载本地插件时,会一并清理用户层 `cordis.patch.yml` 中该包的行覆盖,不留无主行
- 列表的「组合中」状态来自对磁盘文件的**重新组合**(`dsh --dump-config`),不是运行中进程的实况;是否已加载以重启为准
- 用户层 `cordis.patch.yml` 可能含 `!!js` 表达式,本插件只按行原文处理,不解析,避免破坏
- 本包零运行时依赖(正则处理 YAML 行块),不发布 Cordis 服务,组合里不需要 `isolate` realm
- 与动态插件版的区别:本包装一次重启后常驻;动态版(`plgman-3`)进程重启即消失

## 文件清单

| 文件 | 作用 |
|---|---|
| `index.js` | Host 插件:回环 HTTP 路由 + 安装/更新/卸载 + 行清单/config 读写 |
| `client.js` | 浏览器 bundle:`__ModuleLoader__` factory,设置页 UI(行级管理) |
| `cordis.patch.yml` | bundle 组合层:向 host 组合插入 `plugin-manager` 行 |
| `package.json` | `dsh.bundle.patch`(CLI 自动激活)+ `dsh.client`(客户端 bundle 发现) |
| `DESIGN.md` | 通用化设计文档 |
