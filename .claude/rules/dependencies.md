---
paths:
  - "package.json"
  - "package-lock.json"
  - ".npmrc"
  - ".github/dependabot.yml"
---

# 依赖升级

- **MUST** 版本策略是“最新的兼容稳定版”，不是把每个包机械升到最大版本。Astro、`@astrojs/cloudflare`、`@astrojs/check` 与 TypeScript、Wrangler 互相耦合，取它们能共同通过验证的最新稳定组合。确切版本以 `package.json`、锁文件和当次验证为准，规则里不抄版本号。
- **MUST** 默认只用正式稳定版；canary、beta、rc、experimental 不进入 main，除非下方作为例外登记。
- **MUST** 每次升级证明组合在真实 peer 范围内可用：`npm ci`、`npm run format:check`、`npm run verify`；改到上线前提时加跑 `npm run readiness`（模板预期拒绝）。不要用 `overrides`、`--force`、`--legacy-peer-deps` 或关闭检查制造绿灯。项目 `.npmrc` 固定 `legacy-peer-deps=false`，让本地 `npm ci` 不受用户级 `~/.npmrc` 影响，与 CI 一样拒绝 peer 冲突。
- **MUST** 发布冷却期：项目 `.npmrc` 的 `min-release-age=1` 让 npm 只解析发布满 24 小时的版本；仅 Astro 自身发布族（`astro`、`@astrojs/*`）用 `min-release-age-exclude` 豁免。Dependabot 版本更新另有默认 3 天冷却期；安全更新在仓库设置中开启（不由 `.github/dependabot.yml` 配置），不受该冷却期延迟。`min-release-age` 及其 `min-release-age-exclude` 需要 npm >= 11.17.0（`package.json` 的 `engines.npm`），更旧的 npm 会静默忽略它们；CI 用 Node 24.22.1 自带的 npm 11.19.1。早于冷却期的精确版本须在评审中说明理由，或等其满期后再引入。
- **MUST** 例外只能是已知且说明的：每项写明原因和移除条件，条件满足即移除。
- **DEFAULT** 常规升级只检查受影响的能力；安全、数据完整性、询盘送达和上线状态真实性问题不受收益门槛限制，发现即处理。

## 已有例外

| 例外 | 原因 | 移除条件 |
| --- | --- | --- |
| TypeScript 停在 6.x | TypeScript 7.0 无法运行 `astro check`（`@astrojs/check` 的 peer 只声明 `^5 \|\| ^6`）；不为此采用 beta | TypeScript 7.1 稳定版发布，类型检查改用 `@astrojs/ts-content-mapper`（`tsc --runExternalCode`），且上述验证通过；不等待 `@astrojs/check` 支持 TypeScript 7 |
| Wrangler 依赖 Miniflare 的 `-beta` 版本线 | 这是 Cloudflare 随 Wrangler 发布的版本线，不是本项目选择的预发布版；测试用锁定 Wrangler 附带的 Miniflare（见 `PROVENANCE.md`） | Wrangler 改为依赖稳定版 Miniflare |

理由：本地 `~/.npmrc` 的 `legacy-peer-deps=true` 曾让本地 `npm ci` 放过 TypeScript 7 的 peer 冲突，而 CI 会拒绝。
依据：[npm config：`min-release-age`、`legacy-peer-deps`](https://docs.npmjs.com/cli/v11/using-npm/config)、[Dependabot `cooldown`](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference#cooldown-)。
