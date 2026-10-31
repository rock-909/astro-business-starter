# Astro Business Starter

一个可派生的 **Astro + Cloudflare Workers** 网站底座：英文/西班牙文首页、联系页、隐私页与条款页，带询盘 Action、同意管理、主题和 SEO。

**这是实验性参考底座，不是可直接上线的商业网站。** 默认身份、域名与法律文案都是占位内容，没有真实联系方式、产品或供应商声明。公开源码不等于完成生产验证，也不代表授予开源许可证；来源与许可边界见 [PROVENANCE.md](PROVENANCE.md)。

## 本地运行

需要 Node **24.22.1 或更新的兼容版本**、npm **11.17.0 或更新版本**（发布冷却期依赖它）。依赖版本锁定在 `package-lock.json`。

```sh
npm ci
npm run dev
```

没有真实配置时，受保护表单保持不可提交。不要为了看演示填入生产密钥。

## 验证

首次安装依赖和浏览器需要网络；安装完成后，以下业务测试仅使用模拟外部服务：

```sh
npx playwright install chromium
npm run verify
```

`verify` 依次运行类型检查、测试构建、真实 workerd Action 测试和浏览器测试。只替换 Turnstile、Resend、Airtable、Upstash 与 GA 的外部边界，不替换应用 Action。**测试构建含公开 widget 测试配置，不得部署。**

已有 Chromium 时可指定 `CHROMIUM_PATH=/absolute/path/to/chromium npm run verify`。人名、邮箱、token 和 provider ID 都是合成测试数据。

`build:test` 同时构建模板和 `tests/derived-site.mjs` 描述的派生站夹具（配置了联系方式、Logo、社交链接并改写了文案，去掉了西语、加了一个通用 About 页面，并对它单独运行 `astro check`），workerd 与浏览器测试对两份构建都运行；期望的页面、语言和文案从各自的 `src/site.ts` 与 messages 读取，所以派生站改文案、改页面、改语言不会让测试误报。浏览器测试使用本地 `127.0.0.1:4173`–`4176`（模板应用与控制服务、派生站应用与控制服务）；同一台机器并行运行多个工作副本时用 `TEST_PORT=<起始端口>` 整体移开。控制服务不进入应用构建。端口上已有服务时，本地默认直接报错而不复用，以免测到别的工作副本或旧构建；确认它服务当前构建后才可用 `PLAYWRIGHT_REUSE_EXISTING_SERVER=true` 复用。

```sh
npm run check
npm run build:test
npm test
npm run test:browser
```

代码格式由 Prettier 检查，不在 `verify` 内：`npm run format` 改写格式，`npm run format:check` 只检查；CI 在 `verify` 前运行后者。

验证结果和明确未验证的范围见 [ACCEPTANCE.md](ACCEPTANCE.md)。

## 派生站点改哪里

| 位置 | 用途 |
|---|---|
| `src/site-data.json` | 名称、公开联系/社交、品牌资源、SEO、身份/法律确认标记（`readiness.legalReviewed` 每种语言一项） |
| `src/site-routes.ts` | 唯一的语言表和页面表：语言代码、切换文字、OG 地区码；页面路径、版式（`kind`）、导航位置（`nav`）、是否进 sitemap |
| `src/content/<语言>/` | 每种语言的界面文案（`messages.json`，含首页标题 `home.metadata.title`）、联系页与其他页面正文 |
| `public/` | 品牌文件：分享图 `opengraph-image.png`（模板图写着 “Non-production reference site”）、图标与 Logo |
| `wrangler.jsonc` | 本站唯一的 Worker `name`、正式域名路由、关闭 `workers_dev`/`preview_urls`（见 LAUNCH 第 4 节） |
| `src/styles/global.css` | 设计 token、响应式布局、焦点与主题样式 |
| `.env.example` | 公开域名、Turnstile site key、可选 GA 与搜索验证配置 |
| `.dev.vars.example` | 服务端绑定名称；不要提交真实 secret |
| `src/actions/index.ts`、`src/lib/inquiry.ts` | 唯一询盘 Action、验证与独立双通道交付 |

### 常见改造配方

改动后都运行 `npm run verify`。测试从 `src/site-routes.ts` 和 messages 读取页面、语言和文案，改这些内容本身不需要改测试；只有改变行为时才需要。`tests/derived-site.mjs` 是一个完整示例：只留英语，加一个 About 页面和一个页头二级菜单。

- **改名换品牌**：改 `src/site-data.json`、`public/` 下的品牌文件、`wrangler.jsonc` 的 `name`，以及每种语言 `messages.json` 里的模板措辞（包括首页标题 `home.metadata.title`，它就是首页的 `<title>`；留空时用 `seo.defaultTitle`）。`npm run readiness` 会列出剩下的模板措辞。
- **加一个页面**：
  1. 在 `src/site-routes.ts` 的 `pages` 里加一行，例如 `{ key: 'about', path: '/about', kind: 'content', nav: 'main', sitemap: true }`。`kind: 'content'` 是普通页面，法律文本用 `kind: 'legal'`，两者有二级标题（h2）时在宽屏右侧显示目录；`nav: 'main'` 出现在页头和页脚第一栏（联系页在页头是“Start an inquiry”按钮，不重复成导航链接），`nav: 'support'` 只在页脚第二栏，不写 `nav` 就不进导航。
  2. 每种语言写一份 `src/content/<语言>/<key>.ts`，结构与 `contact.ts` 相同（`metadata.title`、`updatedAt`、`seo`、`content`；可选 `metadata.description` 显示为标题下的一句说明，可选 `metadata.faq` 是 `{ question, answer }` 列表，显示在正文后并生成 FAQPage 结构化数据）。少写一份时构建会报出缺的文件名。
  3. 导航文字默认用页面标题。`npm test` 会打开每个页面里的每个站内链接，没登记的页面在这里报 404。
- **加页头二级菜单**：在 `src/site-routes.ts` 的 `navMenus` 里写分组和链接（已登记的页面，或新标签页打开的 https 外链），每种语言在 `messages.json` 的 `navigation.menus` 下写菜单名、分组名和外链文字；注释里有完整示例。宽屏是整宽面板，手机在抽屉里折叠展开。缺文字或链到没登记的页面时构建失败，`npm run readiness` 也会列出。
- **去掉一种语言**（如西语）：删掉 `src/site-routes.ts` 里 `localeTable` 的 `es` 那一行，移走 `src/content/es/`，再从 `src/site-data.json` 的 `readiness.legalReviewed` 删掉 `es`（留着会被配置校验拒绝）。只剩一种语言时不显示语言切换，hreflang、og:locale 和 sitemap 只列剩下的语言，旧的 `/es/...` 网址返回 404。
- **增加一种语言**：在 `localeTable` 加一行（`name` 是语言自己的名字，语言菜单里显示它；`ogLocale`），把 `src/content/en/` 复制成 `src/content/<代码>/` 并全部翻译，在 `legalReviewed` 加上这个语言。它的网址在 `/<代码>` 下。第一个语言是默认语言，不加前缀；文案类型以英文 `messages.json` 为准，如果去掉英语，要把 `src/site.ts` 里 `Messages` 的类型来源改成新的默认语言。
- **改主题色**：`src/styles/global.css` 的浅色、`[data-theme='dark']` 和系统深色三块一起改。`npm run test:browser` 会检查两个深色块一致，以及主要文字与背景在两种主题下对比度至少 4.5:1。

公开配置在构建时使用，Cloudflare 运行时另需服务端绑定及域名/主机配置。所有示例均不含真实凭证。不要将服务端 secret 放入 `PUBLIC_*`。

公开构建变量使用 Vite 的优先级：已有 shell 值高于 `.env.[mode].local`、`.env.[mode]`、`.env.local`、`.env`。默认 build 使用 production mode，也可用 `npm run build -- --mode staging`；mode 名不等于 `PUBLIC_APP_ENV` 的上线声明。当前适配器会先导入 Wrangler 本地变量，配置中的小型修正只恢复原有 `PUBLIC_*` shell 输入，再让 Vite 正常解析，避免覆盖顺序改变上线状态。

```sh
npm run readiness
PUBLIC_APP_ENV=production npm run build
```

默认占位身份、模板文案、模板 Worker 名、模板分享图、所配品牌文件缺失及缺失配置会让这两项检查**拒绝上线**；通过也不能证明凭证有效、Cloudflare 已绑定、邮件到达、CRM 持久化或部署成功。本项目没有自动部署流程。上线步骤、Worker bindings、供应商与域名设置、上线证据和交接见 [LAUNCH.md](LAUNCH.md)。

## 关键行为

- 八个内容路由预渲染，询盘使用 Astro Action；包含真实字节上限、来源/类型准入、限流、蜜罐与 Turnstile。
- 邮件与 Airtable 并行交付；任一明确接受即成功。两者都未确认时不会报告成功，也不声称一定没有送达。
- 草稿和错误保留，提交中禁止重复或覆盖。响应丢失显示结果未知；手动重试可能重复，不承诺 exactly-once。
- 主题、同意设置、双语 SEO、真实 404、无 JavaScript 说明与可编辑内容均在范围内。
- 拒绝可选同意也能完整询盘。分析同意才允许 UTM/落地页/时间归因，广告同意才允许广告点击标识；撤回清除对应浏览器记录，不会自动删除已经交付的邮件/CRM 历史。
- 原生控件和普通 CSS 是当前实现选择；未进行 React/Tailwind 性能对照，也不排除有实际需要时使用它们。

完整行为契约见 [BUSINESS-CONTRACT.md](BUSINESS-CONTRACT.md)。

## 编码规则

`AGENTS.md` 是项目总则，`.claude/rules/` 的六份文件是按实际路径分层的领域约束。支持 `paths` 的工具按文件加载；Codex 等其他工具按 AGENTS 索引主动读取相关规则，不复制第二套正文。实际 Claude CLI 加载尚未验证，因此未加入无条件 `CLAUDE.md` 桥接，也不把 glob 校验当作工具加载证明。

## 真实服务与发布边界

本地验证不调用真实 provider，也没有 Cloudflare 部署。真实服务冒烟应使用专用受限凭证、合成内容和独立测试目标，不应写入生产 CRM 或联系真实客户。不要将凭证放入日志、测试快照或提交内容。

尚未验证：真实邮件/CRM/验证码/GA、Safari/Firefox、真实移动硬件、完整辅助技术审计或搜索引擎收录。`package.json` 的 `private: true` 仅用于防止意外发布 npm 包，不影响源码仓库的公开可见性。
