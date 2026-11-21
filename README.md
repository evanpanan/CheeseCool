# CheeseCool

Save the cool stuff. 把好东西都存起来。

Your AI-powered second brain. 你的 AI 智能收藏与芝士网络。

候选域名为 `cheesecool.ai`，所有权与部署地址待确认。

私人链接收藏库。在首页粘贴链接或带链接的分享文字，按回车或点击 **＋** 收藏。链接先写入 Supabase，随后提取公开内容。有 OpenAI 密钥时自动生成中文摘要、标签、向量和相关收藏。登录同一账户即可在 Mac 和 iPhone 查看同一批收藏。

## 本地启动

需要 Node.js 22.13+ 或 24，推荐使用 Node.js 24。

1. 创建 Supabase 项目，在 SQL Editor 依次执行 [001 收藏与索引](supabase/migrations/001_second_brain.sql) 和 [002 AI 设置](supabase/migrations/002_ai_settings.sql)。已运行过 001 的实例只需补跑 002。
2. 在 Supabase **Authentication → Users** 创建并确认邮箱密码用户。在 **Authentication → Providers / Sign In** 关闭新用户注册，只为获准账号手动创建用户。
3. 将 `.env.example` 复制为 `.env.local`。填入项目 URL 和 Publishable Key。旧项目也可使用 anon key。应用只需公开客户端密钥，数据权限由用户会话和 RLS 控制。
4. 登录后打开 **AI 设置**，选择 OpenAI、Kimi 或 DeepSeek 生成摘要和标签。可在部署环境配置对应的 API 密钥，也可以先在部署环境设置 `AI_SETTINGS_ENCRYPTION_KEY`，再从网页录入个人密钥。用 `openssl rand -hex 32` 生成加密密钥，在持续使用同一数据库的部署中保留它。该变量和各服务密钥均为服务端变量。
5. 安装、启动并打开 `http://localhost:3000`。

```sh
npm ci
npm run dev
```

摘要与标签会把标题和部分公开正文提交给所选服务商。语义搜索及语义连线独立使用 OpenAI 的 `text-embedding-3-small`，可使用部署环境的 `OPENAI_API_KEY` 或在设置页填 OpenAI 密钥。只配置 Kimi 或 DeepSeek 时，仍可生成摘要、标签并显示共同标签连线。旧收藏可通过「重试处理」补充摘要或语义索引。

## 支持范围

- 普通网页通过 Open Graph 等页面元数据与 Readability 提取。
- GitHub 仓库页优先读取公开仓库 API 和 README。X 帖子使用公开嵌入接口补充正文。
- 小红书、抖音识别域名和分享链接，可提取服务端公开返回的标题、描述和封面。登录墙、风控和仅客户端可见的内容可能只保存链接。当前版本采集公开 HTML 与 API，可见视频内容未做转写。
- 关键词按片段匹配，支持中文原文子串。语义检索覆盖已索引收藏。相关收藏根据向量相似度写入 `bookmark_edges` 并在卡片中显示，并不需要额外图数据库。
- 常见跟踪参数会清理。规范化起始链接及可成功解析的重定向目标用于账户内去重。记录原始 URL、最终 URL、抓取时间和正文哈希。

## Vercel

将此项目导入 Vercel，选择 Next.js 项目和 Node.js 24。在 **Settings → Environment Variables** 添加 `.env.example` 对应变量，完成数据库迁移并创建私人账户后部署。变量变更后需要重新部署。页面和登录均由 Next.js 服务端处理，收藏处理的函数时长配置为 60 秒。

## 验证

```sh
npm run typecheck
npm test
npm run build
```

测试使用本地 PostgreSQL（PGlite）和真实 pgvector 执行生产迁移，使用固定向量验证索引行为，不消耗 AI 配额。采集测试覆盖分享文字、页面元数据、正文提取和公开网络地址校验。另见 [参考仓库研究](docs/reference-research.md)。
