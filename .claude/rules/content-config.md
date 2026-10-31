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

- **MUST** 单一作者源：身份事实在 `site-data.json`；界面文字在 `content/{locale}/messages.json`；页面正文/元信息在对应 locale 的页面模块；语言表和页面表只在 `site-routes.ts` 登记，`site.ts`、schema、readiness、Action 与布局都从它派生。派生内容不能成为第二份可编辑事实。
- **MUST** JSON→可信配置时 schema 覆盖所有实际消费字段，并使用 parse 返回值及其推导类型；不能以 `as Site`、手写平行接口或只检查部分字段来证明整体有效。区分可缺省字段与缺失后会崩溃的字段。
- **MUST** 第一个登记的语言（EN）不加前缀，其余语言用 `/<code>`（ES 为 `/es`）；canonical、语言切换、hreflang、og:locale、sitemap、JSON-LD 复用路由源。增加或删除页面/语言只改 `site-routes.ts` 并增删对应内容文件，不在消费点另写 EN/ES 分支或复制一份 registry。每种语言给出完整本地化正文与元信息（含首页 `home.metadata.title`），不以英文内容充当 `/es` 页面；缺内容文件时构建报错，不得静默回退英文；不按 IP 或 `Accept-Language` 跳转或在同一 URL 换语言。
- **MUST** JSON-LD 继续经 `jsonLd()` 统一序列化/转义；组织事实缺失时省略，不编造公司、地址、评价或报价。`set:html` 仅使用已知安全序列化结果，内容渲染不扩展为未过滤 HTML。进入 `href`/`src` 的正文与配置 URL 只允许 `http(s)://` 或站内根相对路径（沿用 `InlineMarkdown` 的 `linkHref` 与 `site-schema` 的 `httpsUrl`/`rootRelativePath`）；`mailto:`/`tel:`/`wa.me` 只由已校验字段拼出。
- **MUST** 格式有效与可上线是两层：空白必需身份/SEO、占位身份、待审法务和缺少生产配置继续阻断 readiness；`experiment` 的 noindex 不能因普通 build 改成可索引。不得自动勾选 owner/legal 的确认值。
- **DEFAULT** 保持现有简单静态内容模型；没有查询/加载需求，不为少量页面引入 CMS、通用内容框架或重复 schema。

理由：配置类型断言无法校验运行时；同一事实的多源定义已经造成 schema/消费漂移。
验证：改 schema 用真实 validator 的正反例并渲染消费点；改路由/SEO 检查每种语言的实际 HTML；readiness 继续拒绝模板而不是把拒绝当测试失败。
依据：[TypeScript assertions 不做运行时检查](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-assertions)。
