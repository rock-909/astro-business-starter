# Project guidance

Astro Business Starter 是 Astro + Cloudflare 的英/西语企业网站底座，包含询盘能力。项目总则只放在本文件；领域细则只放在 `.claude/rules/`。依赖及命令以 `package.json`、锁文件和实际安装版本为准。

## 实现原则

- **MUST** 保持 Home、Contact、Privacy、Terms 的两种语言旅程、询盘交付语义和真实的上线状态；改变这些产品契约时明确说明变化，不把重构当作授权。
- **DEFAULT** 先读直接调用方和已有实现，在共同根因处作最小修复；优先现有模块、原生 HTML/CSS/Web API，不为单一场景增设框架、依赖或兼容层。
- **MUST** 敏感值和买家资料不得进入源码、公开构建物或日志。环境示例只记录名称和假值。
- **MUST** 保留已有严格检查；测试证明用户行为或真实边界，不把文件布局、行数和历史实现变成永久契约。
- **DEFAULT** 不顺手重命名、统一旧注释、拆模块或增加 gate；只有当前需求或可复现缺陷需要时再做。

## 领域规则入口

修改前按目标文件查找下列规则；每个文件顶部的 `paths` 是唯一适用范围，多个匹配一起读。增加调用方或移动文件时同步检查适用范围。

| 主题 | 唯一规则文件 |
| --- | --- |
| Astro 渲染、Cloudflare、环境变量与响应边界 | `.claude/rules/astro-runtime.md` |
| Action、输入、防滥用和双通道交付 | `.claude/rules/inquiry-contract.md` |
| UI、语言切换、无障碍和同意状态 | `.claude/rules/ui-i18n-consent.md` |
| 站点身份、内容、schema、SEO 和上线前提 | `.claude/rules/content-config.md` |
| 本地测试、workerd 证据与验证命令 | `.claude/rules/testing-runtime.md` |
| 依赖升级、版本策略、冷却期与例外 | `.claude/rules/dependencies.md` |

Claude Code 可按 `paths` 自动加载匹配规则；在 Codex 或其他不提供该机制的工具中，执行本索引指令主动打开匹配文件。不要假定 `.claude/rules/` 会被 Codex 自动加载，不要复制出第二套正文。

## 验证与交付

- 先运行能证明改动的最窄检查；行为改动最后运行 `npm run verify`，记录通过、失败和未执行项。纯规则/文档变更只检查引用、范围和差异。
- 缺陷修复应有修复前失败、修复后通过的最小复现；若本地环境不能复现，说明证据和限制，不声称已证明。
- 本地测试只替换外部服务，不能联系真实邮件、CRM、Turnstile、限流或分析服务；实际注册 Action 和 workerd 链路不能被替身绕过。
- 生产前提、真实供应商接收、最终业务送达和部署是不同证据；`verify` 通过不等于可上线，模板的 `readiness` 拒绝应继续生效。
