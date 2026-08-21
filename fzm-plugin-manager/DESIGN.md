# fzm-plugin-manager 通用化设计

> 目标：把当前只认识 `fzm-vision-router` 一个可配置插件的管理器，扩展为能管理**所有符合 DSH 规范**的插件包（bundle）——导入、卸载、更新、行级启用/禁用、行级配置编辑。

## 1. 定位与边界

**定位**：官方 `@deepseek-ai/dsh-host-plugin-inventory` 是**只读**的 Loader 树投影（其 README 明确 "cannot enable, disable, add, or remove plugins"）。本管理器是其**写操作补充**，专注：`add`（导入）/ `remove`（卸载）/ `update`（更新）/ 行级 `enable`/`disable` / 行级 `config` 编辑。

**不做**：

- 不替代官方只读清单（那个仍由官方 `ui-settings-plugin-inventory` 展示）。
- 不改动任何 DSH 官方组合文件，只写 profile 用户层 `~/.dsh/profiles/<profile>/cordis.patch.yml`。
- 不管理 agent preset（那是另一个平面，由 `dsh-agent-presets` 服务负责）。

## 2. 一个"符合 DSH 规范"的插件包

包 `package.json` 满足：

- 可解析，`name` 合法（`@scope/name` 或 `name`）。
- 声明 `dsh.bundle.patch`（指向包内 patch 文件）→ 它是一个 **bundle**，会进入 profile 组合层。
- 可选声明 `dsh.client`（`{ platform, inject }`）→ 它有浏览器端 bundle。
- 可选声明 `dsh.bundle.configSchema`（JSON Schema）→ 它的行配置可渲染为表单；未声明则回退通用 YAML 编辑。

其 `cordis.patch.yml` 支持两类操作（`@deepseek-ai/cordis-plugin-include` 语义）：

- `- insert:` 块：插入新行（`id`/`name`/`config`/`inject`/`disabled`）。
- 顶层 `- id: xxx`：**按 id 覆盖**已有行。覆盖是**整行 config 替换，不 merge**（"last write wins per row"）。

## 3. 通用化机制（对照当前硬编码）

| 当前 | 通用化后 |
|---|---|
| `CONFIGURABLE_PACKAGES = ['fzm-vision-router']` | 删除。任何 bundle 的任一行都可配置 |
| `writeRowConfig` 只写 `provider`/`model` | 写任意 `config`（YAML）；声明式 schema 存在时渲染表单 |
| `rowIdFor` 只取第一个 insert id | 解析出**全部行清单** |
| 仅 add / remove | 增加 `update`、行级 `enable`/`disable`、行级 `config` 编辑 |
| `isLocalSpec` 区分 local/official | 保留；并新增"规范符合性"报告 |

### 3.1 行清单（row inventory）

解析 bundle 的 `cordis.patch.yml`，输出该包向组合贡献的每一行：

```
{ id, name, hasConfig, disabled, inInsert }
```

- `inInsert`: 行是否来自 `insert:` 块（bundle 新增行）。
- 顶层覆盖行也列入（它们修改的是既有行，同样可被用户再次覆盖）。

### 3.2 配置编辑

- **基线（通用）**：对任意行，读取"当前生效 config" = bundle 默认 config 与用户层覆盖 config 的合并结果（**以用户层为准**，因为覆盖是整行替换）。用户以 YAML 编辑，写回用户层覆盖该行。
- **声明式特例**：若 bundle 声明 `dsh.bundle.configSchema`，渲染表单（字段从 schema 生成）；否则回退 YAML。schema 由**被管理插件自己的 package.json** 声明（如 `fzm-vision-router` 自带 provider/model 声明）——管理器不内置任何插件的 schema，两者零耦合。

### 3.3 行级启用/禁用

对任意行，写用户层覆盖行 `disabled: true` / 移除该字段。保留该行其他字段（`config`/`inject`/`name`）。

### 3.4 用户层 cordis.patch.yml 读写（安全原则）

写入目标：`~/.dsh/profiles/<profile>/cordis.patch.yml`。

- **只改"目标 id"的行块**，其余字节（注释、其他行、手写内容）原样保留。
- 覆盖行时写完整行（`id` + 保留的 `name`/`inject` + `config` + `disabled`），避免丢字段。
- 目标行不存在时**追加**到文件末尾；文件为空时生成头部注释。
- 明确提示用户：config 覆盖是**整行替换**，不是字段级合并。

## 4. Host 接口设计（`index.js`）

删掉 `CONFIGURABLE_PACKAGES`，新增/增强端点（全部走 `x-fzm-plugin-manager: 1` 守卫头）：

| 端点 | 方法 | 作用 |
|---|---|---|
| `/list` | GET/POST | 保留；item 增加 `hasBundle`/`hasClient`/`rows`/`configSchema`/`specValid` |
| `/inspect?path=` | GET/POST | 增强：返回规范符合性（`bundle`/`client`/`rows`/`configSchema`/`specValid`）+ 已安装状态 |
| `/rows?package=` | GET/POST | 某 bundle 的行清单 |
| `/config?package=&row=` | GET | 读某行"当前生效 config"（YAML 文本 + 对象） |
| `/config` | POST | 写某行 config 覆盖（用户层） |
| `/toggle?package=&row=` | POST | 行级 enable/disable |
| `/update?package=` | POST | 转发 `dsh plugin --profile <p> update <pkg>` + reconcile |
| `/import` / `/remove` | POST | 保留（增强返回） |

实现要点：

- `bundleInfo(pkgName)`：读包 manifest，解析 `dsh.bundle.patch` → `rows`，读 `dsh.client`、`dsh.bundle.configSchema`。
- `parsePatchRows(text)`：用 `yaml` 解析；失败回退正则。输出行清单。
- `readRowConfig(packageName, rowId)`：从"bundle 默认行"与"用户层覆盖行"解析当前生效 config。
- `writeRowOverride(rowId, { config, disabled })`：按 id 定位用户层行块，整块替换或追加；保留其他内容。
- 所有写操作先 `dirty = true`，提示"重启后生效"。

## 5. Client 端 UI（`client.js`）

- 移除 provider/model 专用下拉逻辑，改为**通用配置编辑**。
- 列表项：展开显示行清单（每行 `id`、`name`、`disabled` 徽标），每行提供 `启用/禁用` 按钮 + `编辑配置` 按钮。
- 编辑配置弹窗：显示当前生效 config 的 YAML 文本，用户编辑后保存（写用户层覆盖）。
- 导入弹窗：显示规范符合性报告（`bundle`/`client`/行数/是否已装），若被导入包声明了 `dsh.bundle.configSchema` 则按其字段渲染表单（`provider`/`model` 类型渲染为下拉，其余为文本框），否则提示"配置可在导入后于行级编辑"。
- 状态标签通用化：`组合中`(磁盘重组可见;是否已加载以重启为准) / `已加入组合(重启后生效)` / `已安装(未激活)` / `内置`。

## 6. 边界与风险

- **整行替换**：config 编辑是整行覆盖，编辑时加载"当前生效 config"（含 bundle 默认 + 用户层覆盖）避免用户不知情丢字段。
- **`!!js` 表达式**：bundle 默认 config 或用户层可能含 `!!js process.env.X`。读取时若 yaml 解析失败，回退给用户原始文本；写入时把用户提供的 YAML 文本按缩进原样放入 `config:` 下，不解析。
- **多行 bundle**：全部列出，不取第一个。
- **update 触发 pnpm + reconcile**：需提示重启后生效，且可能因 git/pnpm allowBuilds 失败（沿用 CLI 的 stderr 提示）。
- **用户层手写内容**：所有写操作只动目标行块，注释与无关行保留。

## 7. 交付与验证

1. `node --check index.js` / `node --check client.js` 语法校验。
2. 重新打包 `fzm-plugin-manager-<ver>.tgz`。
3. `dsh plugin --profile web add <tgz>` 重装（或改 `link:` 开发模式）。
4. `dsh --dump-config --profile web | grep -A2 plugin-manager` 确认组合行。
5. 重启 `dsh web` 后，浏览器 **设置 → 插件 → 自定义插件** 验证：导入任意 bundle、展开行清单、编辑 config、启用/禁用、卸载。
