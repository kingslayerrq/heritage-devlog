# Heritage devlog

Heritage 的公开开发日志。作者通过 Discord 登记身份，用 Git 分支提交 Markdown；通过检查的内容自动合并并发布到 GitHub Pages。Notion 接入留到这条流程完成真实团队测试之后。

## 作者的一次性设置

1. 在团队 Discord 运行 `/devlog-access register`。网站会公开显示你的 Discord 名称、头像和资料链接。
2. Git 投稿者运行 `/devlog-access link-github`，在 GitHub 完成授权，然后运行 `/devlog-access finish-link`。如有仓库邀请，接受邀请。
3. `/devlog-access status` 显示稳定的作者 ID 和账号状态。每位作者都必须绑定 Discord；仅作为共同作者的人不需要 GitHub。
4. 安装 Node.js 22 或更新版本，然后克隆此仓库并运行 `npm ci`。

作者名称、头像和平台连接由机器人同步。不要手写作者 JSON、上传作者头像或把自己的 GitHub 用户名当作身份凭据；更改平台名称不会改变作者 ID。

## 写作与发布

```sh
git switch main
git pull --ff-only
git switch -c devlog/your-topic
npm run sync:authors
```

`sync:authors` 从公开的、仅含作者显示信息的机器人接口获取资料，用于本地预览。生成的作者 JSON 被 Git 忽略，不会跟文章一起提交。接口暂时不可用时，仍可离线检查内容；缺少本地作者资料会产生待验证警告，GitHub 在发布前使用经过认证的实时登记重新验证。

新建 `src/content/posts/YYYY-MM-DD-short-title.md`。文件名决定公开网址，发布后保持文件名稳定；中文文件名也受支持。作者 ID 从 Discord 状态命令取得，第一位为主作者。

```yaml
---
title: 门厅机关的第一次试玩
date: 2026-11-11
discipline: tech
authors: [your-author-id]
summary: 本次试玩发现了什么，我们如何调整机关反馈。
tags: [机关, 试玩]
cover: /media/2026-11-11-first-playtest/cover.png
coverAlt: 门厅机关亮起的指示灯
draft: false
---

这里是 Markdown 正文。
```

必填字段为 title、date、discipline、authors。discipline 选择 tech、art、design、audio、narrative 或 production。可添加共同作者、摘要、标签和封面。可选 entryId 是稳定的 8–64 位字母数字标识，供未来同步使用；普通 Git 投稿无需填写它。

媒体放入 `public/media/<文章目录>/`，在文中使用 `/media/<文章目录>/文件名`。支持 PNG、JPEG、WebP、GIF、AVIF、静态 SVG、MP4、WebM、自包含 GLB、PDF、ZIP 和文本附件；每个文件最多 25 MiB。文件内容必须符合扩展名。GLB 的纹理和缓冲必须嵌入文件。文章最多 256 KiB。

```sh
npm run validate
npm run dev
git add src/content/posts public/media
git commit -m "Add devlog: first playtest"
git push -u origin devlog/your-topic
```

安装时启用的 pre-push 检查会发现本地内容错误。GitHub 接到分支推送后创建或更新 PR，检查内容与身份，构建，通过后自动合并并部署。报告会发送到 Discord。警告不会阻止有效内容发布；错误必须修复后再推送同一分支。

文章编辑也走同一条分支流程，部署成功后会发送更新报告。草稿转公开会发送首次发布报告；重复运行同一发布不会重复通知。`draft: true` 只从网站隐藏文章，**此仓库本身公开，草稿原文件并不私密**；不要提交 internal 文章或秘密。

## 哪些内容可以修改

| 内容 | 处理方式 |
| --- | --- |
| Markdown 文章及文章媒体 | 检查通过后自动合并 |
| 别人的文章或作者署名 | 允许协作编辑；编辑者及受影响的原作者、现作者会收到报告 |
| 作者身份 JSON、头像绑定 | 只能由可信登记同步生成 |
| 页面、样式、脚本、配置、工作流、依赖 | 普通作者提交会被拒绝；恢复这些文件后重新检查内容 |
| 仓库所有者 kingslayerrq 的站点代码改动 | 允许；仍须通过验证和部署检查 |

不能通过修改 commit author、Markdown 署名或作者 JSON 冒充提交者。GitHub 账号的已验证平台 ID 与 Discord 绑定决定提交身份。

当前两篇示例文章及其示例作者为已有网站内容，保持原样可继续显示。它们不是已验证团队身份，不能复制示例署名作为新文章的作者；修改示例文章时请换成已登记的真实作者。

## 丰富内容

| 内容 | 写法 |
| --- | --- |
| 图集 | `<hx-gallery caption="…">` 包围 Markdown 图片 |
| 前后对比 | `<hx-compare before="/media/…" after="/media/…" before-label="初版" after-label="新版"></hx-compare>` |
| 视频 | `<hx-video src="/media/…/clip.mp4"></hx-video>` 或 `<hx-video youtube="VIDEO_ID"></hx-video>` |
| 3D 模型 | `<hx-model src="/media/…/model.glb" alt="模型说明"></hx-model>` |
| 图表 | mermaid 代码块 |
| 数学公式 | `$行内公式$` 或 `$$` 块 |
| Blueprint | `<hx-blueprint src="https://blueprintue.com/render/ID/"></hx-blueprint>` |
| 构建记录 | `<hx-build version="0.3.1" changelist="1482" date="2026-11-11">` 包围条目 |
| 提示 | `<hx-note>` 或 `<hx-note kind="clue">` 包围文字 |

图集、构建记录和提示的开始标签后、结束标签前留空行。每个 hx-* 块都需要关闭标签。标题、加粗、斜体、列表、表格、引用、链接和代码继续使用 Markdown。

正文 HTML 采用允许列表，禁止脚本、事件属性、任意样式、iframe 和动态组件。普通代码块里的 HTML 示例保持原样。媒体 URL 不能使用 javascript:、data:、路径穿越或无凭据的协议相对地址；Blueprint 嵌入只接受指定的 HTTPS BlueprintUE 地址。

## Discord 报告

- `DISCORD_DEVLOG_ALERTS_WEBHOOK`：检查失败、警告、跨作者修改、权限违规、构建和部署故障。
- `DISCORD_DEVLOG_WEBHOOK`：实际部署成功后的首次发布及文章更新。

报告包含中文说明、状态颜色、涉及文章/文件、修复建议和相关链接，并只提及已验证的相关成员。成功构建不等于成功发布。Webhook 发送具有持久收据；超时等不确定结果不会自动重复发送。

两个 webhook 应放在受保护的 `devlog-publishing` GitHub Environment 中，仅允许受信任的 main 工作流使用。不要把凭据放进仓库文件、普通贡献者分支或公开作者资料。详细的 GitHub App、分支保护、机器人接口及环境配置见 [native publishing setup](docs/NATIVE_PUBLISHING.md)。

## 开发与验证

```sh
npm ci
npm test
npm run lint
npm run validate
npm run build
```

`npm test` 运行 Node 测试，涵盖身份映射、内容安全、Git 策略与通知恢复。`npm run lint` 是不增加依赖的 JavaScript 语法、冲突标记和尾随空白检查；Astro 构建另外检查模板与 TypeScript 编译。`npm run validate -- --json` 输出结构化诊断；也可追加文章路径只检查指定文章。

所有直接依赖均锁定精确版本。unified 11.0.5、remark-parse 11.0.0 和 parse5 8.1.1 已存在于原 Astro 依赖树，现在显式声明为验证器依赖，以使用语法树处理 Markdown、HTML 和编码 URL；不再依赖正则表达式猜测 HTML 安全性。

本地作者同步默认使用 `https://dispatch.kingslayerrq.me/api/devlog-authors`，可通过 `DEVLOG_PUBLIC_API_URL` 或命令参数指定 HTTPS 地址。只为本地测试可传 `--allow-local-test` 使用 127.0.0.1 HTTP。响应限制为 1 MiB、最多 1000 人、不发送凭据、不跟随重定向。这个缓存仅用于本地显示；生产检查不以它作为权限证据。

发布配置显式使用 Astro passthroughImageService，图片以原文件显示，不经 Sharp 解码/转换；远程图片优化允许列表为空，文章也不能引用源码目录的相对图片导入。当前锁定的 Astro 5.18.2 依赖树仍有 npm audit 报告的旧版框架问题（包括 AVIF 优化路径），此配置关闭新投稿流程中的该处理路径，不代表依赖已全面升级。框架升级应单独审查与测试；不要自动运行 npm audit fix --force。

Notion、Google Docs 和独立网页写作编辑器不属于本轮流程。
