---
paths:
  - "src/actions/**/*.ts"
  - "src/lib/admission.ts"
  - "src/lib/inquiry*.ts"
  - "src/lib/attribution.ts"
  - "src/lib/lead-utils.ts"
  - "src/lib/ip-range.ts"
  - "src/lib/text.ts"
  - "src/middleware.ts"
  - "src/components/InquiryForm.astro"
  - "src/components/inquiry*.ts"
  - "tests/action.test.mjs"
---

# 询盘契约

- **MUST** 浏览器只调用注册的 `actions.inquiry`；它是公开端点，不因名字叫 Action 就可信。保留 handler 内的准入检查及同一业务函数；middleware 不能成为唯一校验层。
- **MUST** 保持当前顺序：请求方法/JSON 类型/有值 Origin 的同源检查与体积限制 → 限流 → honeypot → canonical schema → Turnstile → 并行交付。无 Origin 调用仍须走其余检查。`input` 的宽 record 是为了先判 honeypot，不得误改为提前拒绝所有字段。
- **MUST** 64 KiB 限制必须覆盖真实 body 字节；Astro 已有原生限制，当前声明长度补充校验只因已验证的解析边界保留。升级时先复现，再决定删留，不再叠加自制 JSON 框架。
- **MUST** schema 输出是交付输入；HTML maxlength、浏览器提示和草稿裁剪不得各自发明另一套业务限制。共用数据只抽到无 server/content/env 导入的纯模块。
- **MUST** 保留当前故障政策：真实超限为 429；限流设施故障放行但继续验证；Turnstile 不可用不投递。honeypot 使用正常形状的合成成功且跳过验证服务和交付。
- **MUST** 邮件与 CRM 共享 reference ID、独立并行；任一路供应商确认接收即公开成功，两路均未确认时不报告成功，并保留结果未知的区别。HTTP 2xx 本身不足，检查所需接收 ID；不宣称收件箱已收到邮件。
- **MUST** 不确定响应保留草稿，由买家明确重试且重新验证；不加自动重投。错误与日志只含稳定分类和 reference ID，不含字段值、token 或原始供应商错误。保留邮件 HTML 转义和 CRM 文本防公式处理。

理由：这些是现有买家体验和交付契约，不是框架默认保证。
验证：修改哪一环就用 `tests/action.test.mjs` 走真实注册端点，断言结果和供应商调用/不调用；表单状态另用现有 Playwright 场景。
依据：[Astro Actions 的公开端点、错误与 handler 校验](https://docs.astro.build/en/guides/actions/)。
