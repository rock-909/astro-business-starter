---
paths:
  - "package.json"
  - "package-lock.json"
  - ".npmrc"
  - ".github/dependabot.yml"
  - ".github/workflows/ci.yml"
---

# 依赖升级

- **MUST** 版本策略是“最新的兼容稳定版”，不是把每个包机械升到最大版本。Astro、`@astrojs/cloudflare`、`@astrojs/check` 与 TypeScript、Wrangler 互相耦合，取它们能共同通过验证的最新稳定组合。确切版本以 `package.json`、锁文件和当次验证为准，规则里不抄版本号。
- **MUST** 默认只用正式稳定版；canary、beta、rc、experimental 不进入 main，除非下方作为例外登记。
- **MUST** 每次升级证明组合在真实 peer 范围内可用：`npm ci`、`npm run format:check`、`npm run verify`；改到上线前提时加跑 `npm run readiness`（模板预期拒绝）。不要用 `overrides`、`--force`、`--legacy-peer-deps` 或关闭检查制造绿灯。项目 `.npmrc` 固定 `legacy-peer-deps=false`，让本地 `npm ci` 不受用户级 `~/.npmrc` 影响，与 CI 一样拒绝 peer 冲突。
- **MUST** 发布冷却期：项目 `.npmrc` 的 `min-release-age=1` 让 npm 只解析发布满 24 小时的版本；仅 Astro 自身发布族（`astro`、`@astrojs/*`）用 `min-release-age-exclude` 豁免。Dependabot 版本更新另有默认 3 天冷却期；安全更新在仓库设置中开启（不由 `.github/dependabot.yml` 配置），不受该冷却期延迟。`min-release-age` 及其 `min-release-age-exclude` 需要 npm >= 11.17.0（`package.json` 的 `engines.npm`），更旧的 npm 会静默忽略它们，所以项目 `.npmrc` 设 `engine-strict=true`，让低于 `engines` 的 npm 或 Node 直接拒绝安装。CI 在 `.github/workflows/ci.yml` 固定 Node 24.22.1，使用其自带的 npm 11.19.1。早于冷却期的精确版本须在评审中说明理由，或等其满期后再引入。
- **MUST** 依赖的安装脚本先审后跑：项目 `.npmrc` 设 `strict-allow-scripts=true`，`package.json` 的 `allowScripts` 未登记的安装脚本会让安装失败。批准用 `npm install-scripts approve <pkg>` 写入带版本的条目，所以升级 esbuild、workerd 等带安装脚本的包（包括 Dependabot 升级 Wrangler 带来的新 workerd）时 `npm ci` 会失败，须先看新版本的安装脚本再重新批准（重新批准会把条目改到新版本）。不需要运行的脚本用 `npm install-scripts deny <pkg>` 明确拒绝（`fsevents` 自带预编译文件）。不要用只写包名的批准、`--dangerously-allow-all-scripts` 或关闭该设置来绕过审查。
- **MUST** 例外只能是已知且说明的：每项写明原因和移除条件，条件满足即移除。
- **DEFAULT** 常规升级只检查受影响的能力；安全、数据完整性、询盘送达和上线状态真实性问题不受收益门槛限制，发现即处理。

## 已有例外

| 例外 | 原因 | 移除条件 |
| --- | --- | --- |
| TypeScript 停在 6.x | TypeScript 7.0 无法运行 `astro check`（`@astrojs/check` 的 peer 只声明 `^5 \|\| ^6`）；不为此采用 beta | Astro 自身的类型检查工具以稳定、非实验性的版本支持 TypeScript 7，且该组合通过 `npm ci`、`npm run format:check` 和 `npm run verify`；仅 TypeScript 7 发布稳定版不构成移除条件。`.github/dependabot.yml` 对 `typescript` 主版本更新的 `ignore` 随本例外一并移除 |
| Wrangler 依赖 Miniflare 的 `-beta` 版本线 | 这是 Cloudflare 随 Wrangler 发布的版本线，不是本项目选择的预发布版；测试用锁定 Wrangler 附带的 Miniflare（见 `PROVENANCE.md`） | Wrangler 改为依赖稳定版 Miniflare |

理由：本地 `~/.npmrc` 的 `legacy-peer-deps=true` 曾让本地 `npm ci` 放过 TypeScript 7 的 peer 冲突，而 CI 会拒绝。
依据：[npm config：`min-release-age`、`legacy-peer-deps`](https://docs.npmjs.com/cli/v11/using-npm/config)、[Dependabot `cooldown`](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference#cooldown-)。
