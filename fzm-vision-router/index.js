// fzm-vision-router
//
// A DeepSeek Harness (Cordis) plugin that registers the model-facing
// `vision_describe` tool. The tool routes an image file to a dedicated vision
// model through the host `llm` service and returns the analysis as plain text —
// so a session whose own model accepts no image input (e.g. deepseek-v4-flash)
// can still "see" images without switching session models.
//
// The router is intentionally model-agnostic: it speaks only the harness
// message/stream protocol (image content blocks in, text blocks out) and never
// touches an adapter's private options. Any provider route registered with the
// `llm` service works — OpenAI-compatible (dsh-llm-deepseek), Anthropic
// (dsh-llm-pi-ai), or a future adapter — as long as the target model's catalog
// entry declares the `image` input modality:
//
//   - deepseek routes: `llm-deepseek.models[].inputModalities` in settings.yaml
//   - pi-ai routes:     `llm-pi-ai.providers.<id>.models[].input` (or the
//                       adapter's built-in catalog, which usually already
//                       declares image)
//
// Composition row shape (in an agent preset's agent.cordis.yml):
//
//   - id: fzm-vision-router
//     name: '<path-to-this-package>/index.js'
//     # optional:
//     # config:
//     #   provider: kimi-coding
//     #   model: k3
//     #   maxTokens: 8192          # per-call output cap; auto-capped by the
//     #                             # model's own defaultMaxTokens when lower
//     #   timeoutMs: 180000         # tool timeout
//
// The plugin registers into the host `tools` registry and consumes the host
// `llm`, `attachments`, and `fs` services. It provides nothing itself, so the
// row needs no isolate realm.

export const name = 'fzm-vision-router'

// All four are hard dependencies: the tool cannot function without any of
// them, so the row waits for them instead of failing at first call. They are
// read as ctx.<name> below (guaranteed by inject), never via ctx.get guards.
export const inject = ['tools', 'llm', 'attachments', 'fs']

const DEFAULT_PROVIDER = 'kimi-coding'
const DEFAULT_MODEL = 'k3'
const DEFAULT_MAX_TOKENS = 8192
const DEFAULT_TIMEOUT_MS = 180000

// Reverse table: media type -> candidate file extensions. The plugin derives
// its accepted set at runtime from the deployment's attachments.imageLimits,
// so formats the deployment later admits (e.g. image/avif) work without a
// plugin update. Media types the deployment allows but this table cannot map
// to extensions stay rejected — the mapping is the plugin's only hardcoded
// knowledge about file formats.
const EXT_BY_MEDIA_TYPE = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/avif': ['.avif'],
  'image/bmp': ['.bmp'],
  'image/tiff': ['.tiff', '.tif'],
}

const VISION_SYSTEM = [
  'You are the dedicated vision analysis model for this agent.',
  'Analyze the provided image precisely and answer in the language of the user question.',
  'Report visible text verbatim when asked about text; describe layout, objects, and structure concretely; say clearly when something is not visible instead of guessing.',
].join('\n')

function resolveString(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

function resolvePositiveInt(value, fallback) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  const n = typeof value === 'string' && value.trim().length > 0 ? Number(value) : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : fallback
}

/** The extension->mediaType map accepted by this deployment's attachment store. */
function acceptedExtensions(attachments) {
  const allowed = new Map()
  for (const mediaType of attachments.imageLimits.mediaTypes) {
    for (const ext of EXT_BY_MEDIA_TYPE[mediaType] ?? []) {
      if (!allowed.has(ext)) allowed.set(ext, mediaType)
    }
  }
  return allowed
}

// Test surface for test/*.test.js (node --test); the runtime contract only
// consumes name/inject/apply.
export const __testing = { resolveString, resolvePositiveInt, acceptedExtensions, EXT_BY_MEDIA_TYPE }

export function apply(ctx, config) {
  const provider = resolveString(config?.provider, DEFAULT_PROVIDER)
  const model = resolveString(config?.model, DEFAULT_MODEL)
  const maxTokens = resolvePositiveInt(config?.maxTokens, DEFAULT_MAX_TOKENS)
  const timeoutMs = resolvePositiveInt(config?.timeoutMs, DEFAULT_TIMEOUT_MS)
  const logger = ctx.logger && typeof ctx.logger.warn === 'function' ? ctx.logger : console

  // Mount-time advisory checks: warn (do not fail the mount) about a route
  // that is not resolvable yet OR whose catalog entry is not image-capable,
  // so a missing settings/credential setup or a model declared text-only is
  // visible in the harness log instead of surfacing only at first tool call.
  const llm = ctx.llm
  Promise.resolve()
    .then(() => llm.resolveModelInfo(provider, model))
    .then((info) => {
      const modalities = info?.inputModalities
      if (modalities !== undefined && modalities.includes('image') !== true) {
        logger.warn(
          `[vision-router] route ${provider}/${model} resolves but its catalog entry is NOT image-capable (inputModalities: ${JSON.stringify(modalities)}). ` +
            'vision_describe will reject image calls at its capability preflight. ' +
            'Add "image" to the model’s inputModalities (llm-deepseek.models) or input (llm-pi-ai providers) in settings.yaml.',
        )
      }
    })
    .catch((error) => {
      logger.warn(
        `[vision-router] route ${provider}/${model} is not resolvable yet: ${error?.message ?? error}. ` +
          'Configure it via settings.yaml plus its credential; the tool reports the same error when called.',
      )
    })

  ctx.tools.register({
    name: 'vision_describe',
    description:
      'Analyze an image file with the dedicated vision model and return its findings as text. Call this whenever you need to understand image content — screenshots, photos, diagrams, UI captures, scanned documents — especially when the current session model cannot read images itself. Unlike read_image, which feeds the image to the CURRENT session model and fails when that model accepts no image input, this tool always routes the image to the vision model and returns plain text.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the image file (an image format accepted by this deployment, e.g. PNG/JPEG/WebP/GIF), resolved by the filesystem backend.',
        },
        question: {
          type: 'string',
          description: 'What to extract or answer about the image. Defaults to a thorough description.',
        },
      },
      required: ['file_path'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          provider: { type: 'string' },
          model: { type: 'string' },
        },
        required: ['text', 'provider', 'model'],
      },
      render: (_args, value) => [
        { type: 'text', text: `[vision via ${value.provider}/${value.model}]\n${value.text}` },
      ],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const filePath = typeof args?.file_path === 'string' ? args.file_path.trim() : ''
      if (filePath.length === 0) throw new Error('file_path must be a non-empty string')
      const llmSvc = ctx.llm
      const attachments = ctx.attachments
      const fs = ctx.fs

      // Accepted formats come from the deployment's image limits, not a
      // hardcoded whitelist, so formats the deployment admits later keep
      // working without a plugin update.
      const allowed = acceptedExtensions(attachments)
      const lower = filePath.toLowerCase()
      let mediaType
      for (const [ext, type] of allowed) {
        if (lower.endsWith(ext)) {
          mediaType = type
          break
        }
      }
      if (mediaType === undefined) {
        const formats = [...allowed.keys()].join('/')
        throw new Error(`"${filePath}" is not an accepted image (this deployment accepts: ${formats})`)
      }

      const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
      // Resolve like the official read tools: relative paths land in the
      // calling session's workspace, not the server launch dir.
      const cwd = exec.agent?.session?.header?.cwd
      const target = await fs.resolve(filePath, { ...(cwd ? { cwd } : {}), signal: exec.signal })
      const info = await fs.stat(target, exec.signal)
      if (info === undefined) throw new Error(`cannot read "${target.displayPath}": not found`)
      if (info.type !== 'file') throw new Error(`cannot read "${target.displayPath}": not a regular file`)
      const data = await fs.readBytes(target, exec.signal, byteCap)
      const displayName = target.displayPath.split('/').pop()
      let ref
      try {
        ref = await attachments.saveImage({ data, mediaType, name: displayName })
      } catch (error) {
        if (error && typeof error.code === 'string') {
          if (error.code === 'IMAGE_DIMENSION_TOO_LARGE') {
            throw new Error(
              `cannot read "${target.displayPath}": at least one image side exceeds the ${attachments.imageLimits.maxImageDimension}px limit; downscale the image and read the smaller copy`,
              { cause: error },
            )
          }
          if (error.code === 'IMAGE_TOO_MANY_PIXELS') {
            throw new Error(
              `cannot read "${target.displayPath}": the image exceeds the ${attachments.imageLimits.maxImagePixels}-pixel decoded-size limit; downscale the image and read the smaller copy`,
              { cause: error },
            )
          }
          if (error.code === 'IMAGE_TYPE_MISMATCH') {
            throw new Error(
              `cannot read "${target.displayPath}": the file extension declares ${mediaType}, but the bytes use a different image format; rename the file to match its actual format if it is a supported image, or convert it to one of those formats`,
              { cause: error },
            )
          }
        }
        throw error
      }
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)

      // Resolve the exact model once per call: a capability preflight with
      // actionable guidance (the adapter would fail with a terse
      // UNSUPPORTED_CONTENT instead), and the model's own defaultMaxTokens to
      // cap the output bound so models with a lower output ceiling are not
      // rejected or truncated.
      let modelInfo
      try {
        modelInfo = await llmSvc.resolveModelInfo(provider, model, exec.signal)
      } catch {
        modelInfo = undefined
      }
      const modalities = modelInfo?.inputModalities
      if (modalities !== undefined && modalities.includes('image') !== true) {
        throw new Error(
          `vision model ${provider}/${model} is not image-capable (catalog inputModalities: ${JSON.stringify(modalities)}); ` +
            'declare "image" in the model\u2019s inputModalities (llm-deepseek.models) or input (llm-pi-ai providers) in settings.yaml',
        )
      }
      const effectiveMaxTokens =
        modelInfo?.defaultMaxTokens === undefined ? maxTokens : Math.min(maxTokens, modelInfo.defaultMaxTokens)

      const question =
        typeof args.question === 'string' && args.question.trim().length > 0
          ? args.question.trim()
          : 'Describe this image thoroughly and accurately.'

      const message = {
        id: 'vision-describe-1',
        role: 'user',
        content: [
          { type: 'image', attachment: ref },
          { type: 'text', text: question },
        ],
        source: { kind: 'user' },
      }

      const blocks = []
      let failure = undefined
      let sawFinish = false
      for await (const chunk of llmSvc.stream({
        provider,
        model,
        system: VISION_SYSTEM,
        messages: [message],
        maxTokens: effectiveMaxTokens,
        signal: exec.signal,
      })) {
        if (chunk.type === 'block-end') {
          blocks[chunk.index] = chunk.block
        } else if (chunk.type === 'finish') {
          sawFinish = true
          const kind = chunk.reason.kind
          if (kind === 'error' || kind === 'aborted') failure = chunk.reason
        }
      }
      if (failure !== undefined) {
        // The finish reason for error/aborted carries `failure: LlmFailure`
        // ({ message, code, status?, ... }); read it so the tool error keeps
        // the real cause instead of an empty detail.
        const llmFailure = failure.failure
        const detail = llmFailure && typeof llmFailure.message === 'string' ? llmFailure.message : ''
        const code = llmFailure && typeof llmFailure.code === 'string' ? llmFailure.code : (failure.kind ?? 'error')
        throw new Error(`vision call via ${provider}/${model} failed (${code}): ${detail}`)
      }
      if (!sawFinish) throw new Error(`vision call via ${provider}/${model} ended without a finish chunk`)
      const text = blocks
        .filter((b) => b !== undefined && b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      if (text.length === 0) throw new Error(`vision model ${provider}/${model} returned no text`)
      return { text, provider, model }
    },
  })
}
