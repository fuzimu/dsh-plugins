# fzm-vision-router

DeepSeek Harness(DSH)插件:注册 `vision_describe` 工具,把图片文件路由到专用视觉模型(默认 `kimi-coding/k3`,即 Kimi K3),返回文字分析。

**解决的问题**:会话主模型是纯文本模型(如 deepseek-v4-flash)时,`read_image` 会因模型不支持图片输入而失败。本工具在内部向视觉模型发起一次独立请求,把文字结论返回给主模型 —— 不用切换会话模型,主模型遇到图片文件时自行调用即可。

**模型无关设计**:插件只走 harness 的 `llm` 服务抽象,不依赖任何适配器私有参数。deepseek 路由(OpenAI 兼容 data-URL)和 pi-ai 路由(Anthropic 协议 image block)都已验证可用;将来新增适配器也无需改插件。唯一要求:目标模型的目录条目声明了图片模态(`llm-deepseek.models[].inputModalities` 含 `image`,或 pi-ai 的 `input` 含 `image`,pi-ai 内置目录通常已默认声明)。

```
用户(deepseek-flash 会话)→ 发现图片需求 → 调用 vision_describe(file_path, question?)
   → 插件内部:读图 → 存附件 → 用 kimi-coding/k3 发独立视觉请求
   → 文字分析作为工具结果返回给主模型 → 继续回答
```

## 要求

- DSH ≥ v0.1.0-rc.8(依赖 rc.8 的图片附件与多模态管线)
- 一个支持图片输入的模型路由。默认可用 Kimi K3(`kimi-coding` 路由)

## 部署到一台新机器

### 1. 一条命令安装(host 平面,全局生效)

本包声明了 `dsh.bundle`,DSH CLI 会把它作为组合层自动激活:

```bash
dsh plugin --profile web add ./fzm-vision-router-0.4.1.tgz
# 或者直接给包目录:
dsh plugin --profile web add /path/to/fzm-vision-router
```

CLI 会把包装进 `~/.dsh/profiles/web/`,发现 `dsh.bundle` 声明后自动把它追加进 profile 的 bundle 栈,包内的 `cordis.patch.yml` 随之向 host 组合插入 `fzm-vision-router` 行 —— 所有会话、所有 preset 都会获得 `vision_describe`。**重启 `dsh web` 后生效。**

验证组合结果(不必重启即可静态检查):

```bash
dsh --dump-config --profile web | grep -A2 fzm-vision-router
```

> 本包在 `package.json` 声明了 `dsh.bundle.configSchema`(provider/model 字段 + 默认值)。若同时使用 `fzm-plugin-manager` 管理插件,导入时会据此渲染配置表单 —— 声明在自己包里,管理器无需内置任何特例。

### 2. 配置视觉模型路由与凭据

编辑目标机器的 `~/.dsh/settings.yaml`,注册 Kimi K3 路由:

```yaml
llm-pi-ai:
  providers:
    kimi-coding:
      apiKeyEnv: KIMI_CODING_API_KEY
      models:
        - id: k3
          name: Kimi K3
```

把 Kimi API Key(`sk-kimi-...` 格式,来自 Kimi For Coding 渠道 `api.kimi.com/coding`)写入 `~/.dsh/.credentials.yaml`:

```yaml
KIMI_CODING_API_KEY: sk-kimi-你的key
```

文件权限需为 0600(目录 0700)。也可以在 Web 界面 **设置 → Models** 页面添加 `kimi-coding` 提供方并粘贴 key,效果相同。

> 想换成别的视觉后端(如某个 OpenAI 兼容网关)?在 `llm-pi-ai` 里注册对应路由,再在 `~/.dsh/profiles/web/cordis.patch.yml` 里覆盖行配置:
>
> ```yaml
> - id: fzm-vision-router
>   config:
>     provider: 你的路由
>     model: 你的模型
>     # 可选:
>     # maxTokens: 8192    # 单次输出上限;若模型自身 defaultMaxTokens 更低则自动取小者
>     # timeoutMs: 180000  # 工具超时
> ```
>
> 换模型后注意该模型的目录条目必须声明图片模态,否则挂载日志会告警、首次调用会报 `UNSUPPORTED_CONTENT`(见「注意事项」)。

### 3. 验证

1. 重启 `dsh web`,任选会话(模型保持 deepseek-v4-flash 即可)
2. 发一句:"看下 /path/to/某张图.png 里有什么"
3. 应看到 `vision_describe` 工具卡片,结果前缀标注 `[vision via kimi-coding/k3]`

## 替代方案:按 preset 安装(agent 平面)

不想让全局生效、只想某个 preset 拥有该工具时,不走 CLI:把包目录拷进 preset 目录,在 preset 的 `agent.cordis.yml` 追加:

```yaml
- id: fzm-vision-router
  name: './packages/fzm-vision-router/index.js'   # 相对 preset 目录解析,随 preset 一起拷贝可用
```

路径规则:`./` 开头相对组合文件所在目录解析(推荐);绝对路径直接按文件 URL 加载;裸包名从 harness 安装目录解析(升级会被覆盖,不推荐)。

> 同一名字在 host 平面和 preset 里重复注册会冲突,两种安装方式**二选一**。

## 注意事项

- **换视觉模型 = 换配置,不改插件**:插件是模型无关的。唯一要求是目标模型在路由目录里声明图片模态 —— deepseek 路由在 `settings.yaml` 的 `llm-deepseek.models` 给该模型加 `inputModalities: [text, image]`;pi-ai 路由在 `llm-pi-ai.providers.<id>.models[].input` 含 `image`(pi-ai 内置目录通常已默认声明)。若没声明:**挂载时日志会告警**「NOT image-capable」,首次调用报 `UNSUPPORTED_CONTENT` —— 不再是静默失败。
- **图片格式跟随部署**:插件接受的格式从 `attachments.imageLimits.mediaTypes` 运行时派生(常见 PNG/JPEG/WebP/GIF;部署日后放开如 AVIF 也无需改插件)。
- **直接粘贴图片进输入框**不受本插件保护:rc.8 的 DeepSeek 适配器对纯文本模型会在请求前拒绝含图历史。文本模型会话里看图请走**文件路径或 @ 引用文件**。
- 单请求图片体积受部署的附件上限约束。
- 本插件只注册工具、不发布服务,组合里**不需要** `isolate` realm。
- 卸载:`dsh plugin --profile web remove fzm-vision-router`(bundle 会自动从层栈移除)。

## 文件清单

| 文件 | 作用 |
|---|---|
| `index.js` | 插件本体(具名导出 `name`/`inject`/`apply`) |
| `cordis.patch.yml` | bundle 组合层:向 host 组合插入 `fzm-vision-router` 行 |
| `package.json` | 包元数据;`dsh.bundle.patch` 声明让 CLI 自动激活 |
| `README.md` | 本文档 |
