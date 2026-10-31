---
paths:
  - "src/components/**/*"
  - "src/layouts/**/*.astro"
  - "src/pages/**/*.astro"
  - "src/styles/**/*.css"
  - "src/content/**/messages.json"
  - "public/theme-init.js"
  - "tests/ui.spec.ts"
  - "src/lib/inquiry-limits.ts"
---

# UI、语言与同意状态

- **DEFAULT** 原生 HTML 控件、已有组件和 `global.css` token 优先。保持语义标签、可见键盘焦点、错误关联和 status 播报；禁用 JS 时正文和已配置的替代联系方式仍可用，不假称 Turnstile 表单可无 JS 提交。
- **MUST** 颜色只在 `global.css` 的 token 块定义，浅色、`[data-theme='dark']` 与系统深色媒体查询三处一起改；组件用 `var(--…)`，不写裸色值。保留 `prefers-reduced-motion` 全局降级，JS 滚动/动画同样遵守。
- **MUST** 新增买家界面文字放到每种已登记语言的 messages，各份键集保持一致（`npm test` 拒绝缺键或值类型不一致）；长篇正文按 `content-config.md`。修改临近硬编码文案时顺手归到其现有来源，不全站搬迁无关旧内容。
- **MUST** 语言切换保持等价路径、query、hash 和未提交字段；pending/失败不能静默丢资料。草稿只含当前允许字段、不含验证 token；存储不可用时给可执行反馈。
- **MUST** 同意默认拒绝可选分析/广告；首次启用、修改类别、撤回和重新授权都执行真实状态变化，不仅改勾选框。分析不得携带买家字段；当前 URL 和 referrer 都须去掉 query/hash，内部跳转后仍需验证。
- **MUST** 询盘不依赖营销同意：只有分析同意允许 UTM、落地页和采集时间；只有广告同意允许 gclid/wbraid/gbraid。拒绝或撤回清除浏览器里相应类别记录并停止附带，刷新、切语言和跨标签同步不得复活旧值。浏览器撤回不代表已投递的 CRM/邮件记录被删除；这是客户端数据用途规则，不是后端授权或法律合规证明。
- **MUST** Astro 可处理的本地脚本使用正常 `<script>`；`is:inline` 只用于确需不处理的公共脚本/JSON-LD等边界，不在其中使用待打包的 TS/import。为复用组件新增实例时确认脚本绑定所有实例，而非只取第一个。

理由：当前表单、语言切换和 consent 共用浏览器生命周期；只测试本地存储值会漏掉实际标签行为。
验证：相关 Playwright 流程覆盖 EN/ES、键盘/窄屏、失败或无 JS 的差异路径；consent 看网络和事件，不只看 UI；不要求每个纯样式改动穷举所有组合。
依据：[Astro 脚本处理语义](https://docs.astro.build/en/guides/client-side-scripts/)；其余为本项目行为约定，不是法律结论。
