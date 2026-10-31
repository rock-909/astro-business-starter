---
paths:
  - "astro.config.mjs"
  - "wrangler.jsonc"
  - "src/env.d.ts"
  - "src/middleware.ts"
  - "src/security-headers.ts"
  - "src/actions/**/*.ts"
  - "src/lib/inquiry.ts"
  - "src/pages/**/*"
  - "src/site*.ts"
  - "src/layouts/**/*.astro"
  - "public/_headers"
  - "scripts/readiness.mjs"
  - "tests/config.test.mjs"
---

# Astro / Cloudflare 运行边界

- **MUST** 区分预渲染 HTML 与请求时 Worker：`output: 'server'` 不意味着每个页面都动态；当前内容页显式 `prerender = true`，Action、健康检查与 404 在 workerd 执行。改变策略时检查内容、缓存和请求依赖。
- **MUST** `prerenderEnvironment: 'node'` 只影响预渲染，不让请求处理获得完整 Node 环境；新增请求时 API 必须由本项目 workerd 测试证明支持。
- **MUST** Worker 机密继续从 `cloudflare:workers` 读取；`PUBLIC_*` 是可公开、构建时替换的值。不要通过浏览器导入或 HTML 属性传递 server binding，也不要把本地 shell 的值当作部署绑定证据。
- **MUST** 上线 gate 与渲染/索引判断使用同一套已解析的构建 env 值及覆盖优先级；同时验证普通 `.env` 和 shell 输入。不要只用 `process.env` 判 gate，却用 `import.meta.env` 生成另一种上线状态。
- **DEFAULT** 静态正文保持 `.astro` + CSS；仅交互部分使用已有浏览器脚本。不要把 React 的 `use client`、Server Component 或 OpenNext 缓存约定搬进来。
- **MUST** Worker 会加载的模块（含按需路由导入的 `src/site*.ts`）不在模块顶层依赖当前时间：workerd 在请求之外读到的 `Date` 是 1970。需要当前时间的检查放进请求处理或 Node 端的 `readiness`。
- **MUST** 区分静态响应的 `public/_headers` 与 Worker 的 `src/security-headers.ts`；改变共享策略时核对两类实际响应。当前双份值须同步，不能称它们已经自动共用一个源。
- **DEFAULT** 保留现有 `session: false`、图片 passthrough 和兼容日期；仅为真实功能需求改变。若新增平台绑定，类型须与 Wrangler 配置一致；优先现有 Wrangler 的类型生成，不另造运行时类型体系。

理由：预渲染成功不证明 Worker 可运行；静态资源头不会自动覆盖 Worker 响应。
验证：`npm run check`、测试构建后的 workerd Action/静态响应测试；`tests/harness.mjs` 从生成的 `dist/server/wrangler.json` 读取兼容日期、flags 与 assets 设置，配置变化时核对它的绑定，不新加第二套模拟器。
依据：[Astro Cloudflare adapter](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)、[环境变量](https://docs.astro.build/en/guides/environment-variables/)、[Worker 类型](https://developers.cloudflare.com/workers/languages/typescript/)。
