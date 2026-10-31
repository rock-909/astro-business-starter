---
paths:
  - "tests/**/*"
  - "scripts/build-test.mjs"
  - "scripts/readiness.mjs"
  - "playwright.config.ts"
  - "package.json"
  - "package-lock.json"
  - "tsconfig.json"
---

# 验证证据

- **MUST** `check` 与 build 分开：Astro 编译成功不代表 TypeScript 检查通过。当前 `tsconfig` 不检查所有测试/脚本，不能把 `check` 描述为全仓类型证明。
- **MUST** workerd 测试使用当前锁定 Wrangler 附带的 Miniflare 和真实 `dist/server/entry.mjs`；Mock 只放在外部网络边界，未登记外连失败。不能用自己重写的 handler 证明 Action。
- **MUST** 使用新鲜测试构建；会写同一 `dist` 的构建与读取它的测试串行。浏览器测试默认不复用端口上的已有服务；只有确认它服务当前构建后才用 `PLAYWRIGHT_REUSE_EXISTING_SERVER=true`，不能把旧进程的绿灯算进本次结果。并行工作副本用 `TEST_PORT` 错开端口。
- **DEFAULT** 纯逻辑用最小真实函数测试，Action 用现有 harness，跨页面/焦点/存储交互用 Playwright，优先用角色/标签等用户可见定位。断言行为和独立期望，不复制实现、不依赖固定 sleep，不增加新测试框架。
- **MUST** 页面清单、语言和文案期望从 `src/site.ts`/messages 读取（`tests/site-config.mjs`），只在模板状态成立的断言改用冻结夹具，不断言当前仓库仍是模板；workerd 与浏览器测试同时覆盖模板和 `tests/derived-site.mjs` 派生站夹具。
- **MUST** 修改验证逻辑时含一个能被错误实现触发的反例；拒绝无效配置须测试真实 validator，provider mock 的成功不能替代业务校验或真实送达证明。删除或替换某项检查前，证明替代者覆盖同一失败模式、确实在 `verify`/CI 中运行且失败即阻断。

| 验证目的 | 现有命令 |
| --- | --- |
| Astro/应用类型 | `npm run check` |
| 代码格式（Prettier） | `npm run format:check` |
| 生成离线测试用构建 | `npm run build:test` |
| 已构建 Worker 的契约 | `npm test` |
| 浏览器旅程 | `npm run test:browser` |
| 行为改动最终综合检查 | `npm run verify` |
| 生产配置前提，模板预期拒绝 | `npm run readiness` |

理由：运行环境、旧构建和 mock 边界都会制造“通过但未证明”。
依据：[Astro TypeScript 检查](https://docs.astro.build/en/guides/typescript/#type-checking)；命令与 harness 以本仓库为准。
