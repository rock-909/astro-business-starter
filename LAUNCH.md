# 派生站点上线与交接

本文件负责派生站点从“模板拒绝上线”到“正式上线”的步骤和交接。模板自身不是可上线站点，`npm run readiness` 与生产构建对它的拒绝应继续生效。本项目没有部署流水线、GitHub Environment 或灰度发布；以下步骤由站点负责人在 Cloudflare 和各供应商处完成。

## 1. 替换内容并通过静态门禁

1. 按 [README.md](README.md) 的“派生站点改哪里”替换身份、域名、联系方式、品牌文件和 EN/ES 文案，审阅双语法律正文后才把 `src/site-data.json` 的 `readiness` 标记改为 `true`。
2. 把 `wrangler.jsonc` 的 `name` 改成本站在 Cloudflare 账户内唯一的 Worker 名。Cloudflare 按“账户 + Worker 名”识别 Worker：沿用模板名 `astro-business-starter` 时，同一账户里另一个派生站的部署会替换这个站的代码、域名和 `vars`，并沿用它的 secret。
3. 运行：

   ```sh
   npm run verify
   npm run readiness
   PUBLIC_APP_ENV=production npm run build
   ```

`readiness` 会拒绝：缺失或哨兵配置值、模板 Worker 名、模板身份、未完成的法律文案、`messages.json` 与 `contact.ts` 里残留的模板措辞（如 “non-production”“Inquiry site”“Sitio de consultas”“EN / ES”“sitio de referencia”）、`public/` 下不存在的根相对品牌文件（`brandAssets.ogImage`、`brandAssets.favicon`、`brandAssets.logo.horizontal`），以及仍是模板分享图（图上写着 “Non-production reference site”）的 `brandAssets.ogImage`。`PUBLIC_APP_ENV` 只接受 `production` 或 `experiment`，`Production`、`prod` 等写法会让构建直接失败。通过只说明配置前提齐全，不证明凭证有效、绑定已到 Cloudflare 或邮件已送达。

4. 部署：

   ```sh
   PUBLIC_APP_ENV=production npm run build && npx wrangler deploy
   ```

   `wrangler deploy` 上传 `dist/` 里现有的构建（读取生成的 `dist/server/wrangler.json`）。`npm run verify` 会在 `dist/` 写入带测试 widget key、noindex 的测试构建，生产构建被门禁拦下时它仍留在那里，所以只用 `&&` 把部署接在一次成功的生产构建之后，不要单独执行 `wrangler deploy`。

## 2. Worker 配置放在哪里

`wrangler deploy` 会用 `wrangler.jsonc` 覆盖在 Cloudflare 面板里手动设置的普通变量，secret 则在部署之间保留。因此每个服务端值只能用以下两种方式之一，**不要在面板里设置普通变量**：

| 方式 | 适用的值 |
| --- | --- |
| `npx wrangler secret put <NAME>` | `TURNSTILE_SECRET_KEY`、`RESEND_API_KEY`、`AIRTABLE_API_KEY`、`UPSTASH_REDIS_REST_TOKEN`、`RATE_LIMIT_PEPPER` |
| 派生仓库 `wrangler.jsonc` 的 `vars`（也可用 secret） | `APP_ENV`、`PUBLIC_SITE_URL`、`TURNSTILE_ALLOWED_HOSTS`、`RESEND_FROM_EMAIL`、`INQUIRY_TO_EMAIL`、`AIRTABLE_BASE_ID`、`AIRTABLE_TABLE_NAME`、`UPSTASH_REDIS_REST_URL` |

名称以 `.dev.vars.example` 为准。`TURNSTILE_ALLOWED_HOSTS` 写主机名，用逗号分隔（如 `supplier.com,www.supplier.com`）；同时用 apex 和 `www` 提供站点时两个都要列。写成 `https://` 网址、带端口或用分号、空格分隔时只取主机名；无法识别的条目被忽略，`readiness` 能看到这个值时会拒绝它们。若 `TURNSTILE_ALLOWED_HOSTS`、`PUBLIC_SITE_URL`、`RESEND_FROM_EMAIL`、`INQUIRY_TO_EMAIL`、`AIRTABLE_BASE_ID` 或 `AIRTABLE_TABLE_NAME` 被一次部署清空，询盘就会停止：允许的主机名为空（或全部无法识别）时每次提交都返回 `TURNSTILE_UNAVAILABLE`，日志为 `inquiry.turnstile_unavailable` 且 `reason: "configuration"`；两个交付通道都缺配置时返回 `DELIVERY_UNCONFIRMED`。部署后用 `npx wrangler secret list` 和当前版本的绑定列表核对。

`PUBLIC_*` 构建值（`PUBLIC_APP_ENV`、`PUBLIC_SITE_URL`、`PUBLIC_TURNSTILE_SITE_KEY`、`PUBLIC_GA_MEASUREMENT_ID`、搜索验证值）在构建时写入页面，来自构建机的 shell 或 `.env.production`，见 `.env.example`；不要把 secret 放进 `PUBLIC_*`。

`npm run readiness` 和生产构建的门禁读取同一组来源，按以下顺序，后面的覆盖前面的：`wrangler.jsonc` 的 `vars`（不含 `PUBLIC_*`）、`.env`/`.env.production` 等 mode 文件、构建机 shell。`.dev.vars` 只供本地开发，两个门禁都不读。secret 不在这些来源里，门禁要求它们以同名值出现在 shell 或 `.env.production` 中；那只是本地检查，不会替你绑定到 Cloudflare，也看不到 `wrangler secret put` 的实际值。

## 3. 预览与生产分开

- 预览与生产使用各自的 Upstash 数据库和 Airtable base/table，各自的 `APP_ENV`（限流键以它为前缀）。预览测试不能写入生产 CRM 或联系真实客户。
- Turnstile、Resend 可以同账号，但预览的主机名和收件箱要与生产分开登记。
- 预览要用独立的 Worker：在 `wrangler.jsonc` 加 `env.preview`，给它自己的 `name`、`vars` 和路由。环境在构建时选定，用 `CLOUDFLARE_ENV=preview npm run build && npx wrangler deploy` 部署（不要给 `wrangler deploy` 加 `--env`）；secret 用 `npx wrangler secret put <NAME> --name <预览 Worker 名>` 单独设置。Workers 自带的版本预览 URL 用的是生产 Worker 的 secret 和 `vars`，不算独立预览。

## 4. 供应商与域名

**Airtable。** 下表的 16 列都必须建好，列名与 [BUSINESS-CONTRACT.md](BUSINESS-CONTRACT.md) “External schema” 一行完全一致。后 8 列不是每条记录都写，但一旦写入时缺列，整条记录同样被拒：

| 列 | 何时写入 | 值 |
| --- | --- | --- |
| `Email`、`Submitted At`、`First Name`、`Last Name`、`Message`、`Reference ID` | 每条询盘 | 买家输入、ISO 时间与参考号 |
| `Status` | 每条询盘 | 固定 `New` |
| `Source` | 每条询盘 | 固定 `Website Inquiry` |
| `Requirements` | 买家填写了留言 | 留言原文 |
| `UTM Source`、`UTM Medium`、`UTM Campaign`、`UTM Term`、`UTM Content`、`Landing Page`、`Captured At` | 访客同意分析且带有该归因值 | 对应归因值 |

建议都建成文本列。`Status`、`Source` 若建成单选列，必须预先包含 `New` 和 `Website Inquiry` 这两个选项：请求不带 `typecast`，Airtable 不会自动新建选项。缺一列、拼写不同或单选缺选项时，Airtable 返回 422，整条记录不写入；邮件仍成功，所以买家看到成功，CRM 通道却悄悄丢失。唯一迹象是日志里的 `inquiry.airtable_acceptance_unconfirmed` 和 `inquiry.accepted` 中的 `recordAccepted: false`。

**Turnstile。** 在 Turnstile widget 的主机名列表里加入正式域名；`TURNSTILE_ALLOWED_HOSTS` 必须包含 `PUBLIC_SITE_URL` 的主机名。主机名不匹配时提交被拒，日志为 `inquiry.turnstile_rejected` 且 `reason: "invalid-hostname"`，这是区分主机配置错误的唯一信号。

**限流。** `wrangler.jsonc` 的 `ratelimits` 声明 `INQUIRY_RATE_LIMITER`：在调用 Upstash 之前，按同一个 IP 桶做一次每个 Cloudflare 机房内的廉价预判，已超限的请求不再消耗 Upstash 额度；精确的每分钟 10 次仍由 Upstash 计数。`namespace_id` 在同一 Cloudflare 账户内须唯一，同账户下的另一个派生站要换一个值。预判不能代替 Upstash，`UPSTASH_*` 和 `RATE_LIMIT_PEPPER` 仍然必需。

**Resend。** 先在 Resend 验证 `RESEND_FROM_EMAIL` 所在的发信域名（SPF/DKIM），再用正式域名提交一条合成询盘，确认它确实进入 `INQUIRY_TO_EMAIL` 收件箱（而非垃圾箱）。Resend 显示已接受只代表供应商接收，不代表收件箱到达。

**自定义域名与 TLS。** 在 `wrangler.jsonc` 里声明正式域名，并关掉 Worker 的公开副本（模板里有注释示例）：

```jsonc
"routes": [{ "pattern": "www.example.com", "custom_domain": true }],
"workers_dev": false,
"preview_urls": false,
```

只在面板里绑定域名时，配置里没有路由，`wrangler deploy` 会保持 `<name>.<账户子域>.workers.dev` 公开一份完整的生产站（买家在那里提交会被 Turnstile 主机名检查拒绝），版本预览 URL 也默认开启。部署后确认证书生效，`PUBLIC_SITE_URL` 与正式域名一致。模板对每个响应发送 `Strict-Transport-Security: max-age=31536000`，只约束提供站点的那个主机名：浏览器经 HTTPS 访问一次后，一年内不再用 HTTP 访问它，所以上线前先确认该主机名只走 HTTPS。是否加 `includeSubDomains`/`preload`，由域名所有者按整个域名的情况决定——`preload` 会约束所有子域名且难以撤回；要改时同步修改 `public/_headers` 与 `src/security-headers.ts` 两份响应头。

## 5. 搜索、分析与爬虫

- **Google Search Console / Bing Webmaster Tools。** 在构建环境设置 `PUBLIC_GOOGLE_SITE_VERIFICATION` 和 `PUBLIC_BING_SITE_VERIFICATION`（只填 meta 的 content 值），重新构建部署，完成验证后提交 `https://<domain>/sitemap.xml`。
- **GA4。** 设置 `PUBLIC_GA_MEASUREMENT_ID` 后，只在生产构建中、访客同意分析或广告任一类后，浏览器才从 `www.googletagmanager.com` 加载 gtag 脚本；只同意广告时脚本照样加载，但 GA 被停用，不发页面浏览或事件。页面浏览、`generate_lead` 与 `contact_click` 事件只在访客同意分析后发送。询盘成功时发送的 `generate_lead` 不含买家资料；在 GA4 里把 `generate_lead` 标为关键事件（key event）。
- **Cloudflare AI 爬虫与 Bot 设置。** Cloudflare 的托管 robots.txt、AI 爬虫拦截和 Bot 防护可能在站点自己的规则前追加或拦截内容。上线后运行 `curl https://<domain>/robots.txt`，确认生产内容为 `Allow: /`（只禁止 `/api/` 和 `/_actions/`），且没有你不想要的对搜索或 AI 爬虫的拦截。

## 6. 日志

`wrangler.jsonc` 开启 Workers Logs，但只保留站点自己的 `console` 日志（参考号、类别和通道标记，从不含表单字段），关闭调用日志和 traces。用 Cloudflare 面板的 Workers Logs 回查，或用 `npx wrangler tail` 实时查看。需要关注的日志：`inquiry.accepted`（含 `emailAccepted`、`recordAccepted`）、`inquiry.email_acceptance_unconfirmed`、`inquiry.airtable_acceptance_unconfirmed`、`inquiry.turnstile_rejected`、`inquiry.turnstile_unavailable`、`inquiry.rate_limit_unavailable`、`inquiry.unexpected_error`。后三条带 `reason`：`configuration` 表示配置有误，每次都会出现，必须修；`provider`/`storage` 是 Turnstile 或 Upstash 的故障，通常是偶发的；`precheck` 表示原生限流预判出错，Upstash 照常计数。限流配置有误时询盘照常放行（已批准的故障策略），但限流从此不再生效。

保留期与费用（以 Cloudflare 当前价格页为准）：Free 计划保留 3 天、每天 200k 条事件；Paid 计划保留 7 天、每月 20M 条事件。自 2026-12-01 起 Workers Logs 改按 Cloudflare Observability 计价，上线前核对所在账户的费用。

## 7. 回滚

用 Cloudflare 的 Worker 版本回滚（面板的 Deployments，或 `npx wrangler rollback`）。每个 Worker 版本包含代码和绑定（[版本](https://developers.cloudflare.com/workers/versions-and-deployments/)），`wrangler secret put`/`delete` 本身也会创建并立即部署一个新版本（[secret](https://developers.cloudflare.com/workers/configuration/secrets/)）。因此回滚到轮换 secret 之前的版本，可能让 Worker 重新使用旧的 secret 值和旧的 `vars`。

回滚不改变供应商侧的凭证状态：已在 Resend、Airtable、Turnstile 或 Upstash 撤销的密钥不会因回滚恢复有效，Worker 若拿回这把旧密钥，对应通道就会交付失败。回滚也不恢复 DNS、域名设置，或 Airtable、Upstash、邮箱里的数据。回滚后在面板或 `npx wrangler versions view <version-id>` 核对目标版本的绑定，确认每个 secret 都对应供应商处仍有效的凭证，必要时重新 `wrangler secret put`，再按第 8 节重新提交一条合成询盘。

## 8. 什么才算“已上线”

以下每一层都有证据才算正式上线，缺任何一层都只能说“已部署”：

1. **静态门禁**：`npm run verify`、`npm run readiness`、`PUBLIC_APP_ENV=production npm run build` 均通过，部署的是这次生产构建（第 1 节第 4 步）。
2. **Cloudflare 绑定**：第 2 节列出的值都在当前部署版本中（`wrangler secret list` 与版本绑定），没有面板普通变量。
3. **供应商接收**：从正式域名提交一条合成询盘，买家看到参考号，日志中 `inquiry.accepted` 的 `emailAccepted` 与 `recordAccepted` 都为 `true`，且没有任何带 `reason: "configuration"` 的日志。
4. **业务送达**：这条询盘出现在 `INQUIRY_TO_EMAIL` 收件箱，Airtable 中有同一 `Reference ID` 的整行；随后按你的流程标记或删除这条测试记录。
5. **域名与搜索**：HTTPS 正常，`robots.txt` 与 `sitemap.xml` 内容正确，GSC/Bing 已验证并提交 sitemap，GA4 关键事件已设置（如使用 GA）。
6. **法律与交接**：双语隐私与条款已由负责人审阅，下面的数据清单已交给撰写隐私政策的人。

## 9. 模板收集的数据

供撰写隐私政策的人使用。派生站点增加字段、供应商或分析工具时必须同步更新此表。

| 数据 | 何时收集 | 去向 | 保存 |
| --- | --- | --- | --- |
| 姓名、邮箱、留言（可选）、参考号 | 提交询盘 | Resend 邮件发到 `INQUIRY_TO_EMAIL`（回复地址为买家邮箱）；Airtable（`First Name`、`Last Name`、`Email`、`Message`/`Requirements`、`Reference ID`、`Submitted At`） | 由邮箱与 Airtable 的所有者决定；模板不自动删除 |
| 页面语言 | 提交询盘 | 只进邮件 | 同上 |
| 5 个 UTM 值、`landingPage`、`capturedAt` | 仅在访客同意分析后 | 邮件与 Airtable 对应列；提交前存于浏览器 `sessionStorage` 的 `inquiry_attribution` | 撤回同意即清除浏览器记录；已交付的邮件/CRM 不会自动删除 |
| `gclid`、`wbraid`、`gbraid` | 仅在访客同意广告后 | 只进邮件；提交前存于 `inquiry_attribution` | 同上 |
| 访客 IP（`cf-connecting-ip`） | 提交询盘 | 作为 `remoteip` 发给 Cloudflare Turnstile 校验；限流时 IPv4 地址或 IPv6 /64 前缀经 `RATE_LIMIT_PEPPER` 做 HMAC 后作为 Upstash 与 Cloudflare 原生限流的计数键 | 计数键 60 秒后过期；IP 不进邮件、Airtable 或日志 |
| Turnstile 挑战 | 打开询盘表单 | Cloudflare Turnstile 在浏览器中运行 | 按 Cloudflare 的政策 |
| 表单草稿（姓名、邮箱、留言） | 填写表单时 | 浏览器 `sessionStorage` 的 `inquiry-draft`，不离开浏览器 | 当前标签页会话；确认成功后清除 |
| 同意选择 | 访客做出选择 | 浏览器 `localStorage` 的 `cookie-consent` | 直到访客更改或清除 |
| 主题偏好 | 访客切换主题 | 浏览器 `localStorage` 的 `theme` | 直到访客更改或清除 |
| gtag 脚本请求 | 生产构建、已设置 `PUBLIC_GA_MEASUREMENT_ID`，且访客同意分析或广告任一类（包括只同意广告） | 浏览器向 Google（`www.googletagmanager.com`）请求脚本，Google 会收到常规请求信息（如 IP、User-Agent） | 按 Google 的政策 |
| GA4 页面浏览与 `generate_lead`、`contact_click` 事件 | 仅在生产构建、已设置 `PUBLIC_GA_MEASUREMENT_ID` 且访客同意分析后；只同意广告时 GA 被停用，不发送 | Google Analytics；页面地址与来源去掉查询串和 hash，事件不含买家资料 | 按 GA 属性设置；撤回分析同意会停用 GA 并清除 GA cookie |
| Worker 日志 | 每次询盘处理 | Cloudflare Workers Logs：参考号、结果类别、通道标记，不含表单字段或 IP | 3 天（Free）或 7 天（Paid） |
