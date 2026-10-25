---
paths:
  - "src/site*.ts"
  - "src/site-data.json"
  - "src/content/**/*"
  - "src/pages/**/*"
  - "src/layouts/**/*.astro"
  - "src/components/content/**/*"
  - "scripts/readiness.mjs"
  - ".env.example"
  - ".dev.vars.example"
  - "tests/config.test.mjs"
---

# 内容、配置与真实身份

- **MUST** 单一作者源：身份事实在 `site-data.json`；界面文字在 `content/{locale}/messages.json`；页面正文/元信息在对应 locale 的页面模块；路由和 locale 表在 `site.ts`。派生内容不能成为第二份可编辑事实。
- **MUST** JSON→可信配置时 schema 覆盖所有实际消费字段，并使用 parse 返回值及其推导类型；不能以 `as Site`、手写平行接口或只检查部分字段来证明整体有效。区分可缺省字段与缺失后会崩溃的字段。
- **MUST** EN 默认不加前缀，ES 使用 `/es`；canonical、语言切换、hreflang、sitemap、JSON-LD 复用路由源。增加或删除页面/语言时一起调整相关来源和实际 URL，不复制一份 registry。
- **MUST** JSON-LD 继续经 `jsonLd()` 统一序列化/转义；组织事实缺失时省略，不编造公司、地址、评价或报价。`set:html` 仅使用已知安全序列化结果，内容渲染不扩展为未过滤 HTML。
- **MUST** 格式有效与可上线是两层：空白必需身份/SEO、占位身份、待审法务和缺少生产配置继续阻断 readiness；`experiment` 的 noindex 不能因普通 build 改成可索引。不得自动勾选 owner/legal 的确认值。
- **DEFAULT** 保持现有简单静态内容模型；没有查询/加载需求，不为少量页面引入 CMS、通用内容框架或重复 schema。

理由：配置类型断言无法校验运行时；同一事实的多源定义已经造成 schema/消费漂移。
验证：改 schema 用真实 validator 的正反例并渲染消费点；改路由/SEO 检查两种语言实际 HTML；readiness 继续拒绝模板而不是把拒绝当测试失败。
依据：[TypeScript assertions 不做运行时检查](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-assertions)。
