# CheeseCool

把好东西都存起来。

智能收藏与芝士库。

候选域名为 `cheesecool.ai`，所有权与部署地址待确认。

个人链接收藏库。在「收藏」页粘贴链接或带链接的分享文字，按回车或点击 **＋** 保存。在「芝士库」中查看列表、搜索收藏或切到关系图谱。链接先写入 Supabase，随后提取公开内容。管理员配置站点 AI 后，登录用户即可自动生成摘要和标签。配置 OpenAI 向量后，还支持语义搜索和关联。登录同一账户即可在 Mac 和 iPhone 查看同一批收藏。

## 本地启动

需要 Node.js 22.13+ 或 24，推荐使用 Node.js 24。

1. 创建 Supabase 项目，在 SQL Editor 依次执行 [001 收藏与索引](supabase/migrations/001_second_brain.sql)、[002 旧版 AI 设置](supabase/migrations/002_ai_settings.sql) 、[003 站点 AI 设置](supabase/migrations/003_site_ai_settings.sql)，再按编号执行 004、005 和 [006 知识库后端](supabase/migrations/006_knowledge_backend.sql)。再执行 007 补存历史整理结果。已有数据库只执行尚未执行的迁移。
2. 在 Supabase **Authentication → Sign In / Providers** 关闭 Email、Phone 和 Anonymous 登录，只启用 Google 与 GitHub。首次第三方授权会自动建立账号，因此保留全局 Allow new users to sign up；关闭全局新用户会连同首次 OAuth 登录一起阻止。本站不提供邮箱密码注册或登录。
3. 将 `.env.example` 复制为 `.env.local`。填入项目 URL 和 Publishable Key。旧项目也可通过 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 使用 anon key；与 Publishable Key 二选一即可。普通收藏数据权限由用户会话和 RLS 控制。
4. 安装、启动并打开 `http://localhost:3000`。

```sh
npm ci
npm run dev
```

## 站点 AI 管理

普通用户登录后直接使用站点 AI。配置由管理员统一管理，之前的个人设置停止使用，已有收藏、摘要和索引仍可查看。

1. 在 Supabase **Authentication → Users** 复制你的账号 User UID，将其设为部署变量 `AI_ADMIN_USER_IDS`。多个管理员 ID 用英文逗号分隔。
2. 在部署环境设置 `SUPABASE_SECRET_KEY`（旧版 Supabase 可用 `SUPABASE_SERVICE_ROLE_KEY`）以及用 `openssl rand -hex 32` 生成的 `AI_SETTINGS_ENCRYPTION_KEY`。服务端密钥和加密密钥均保存在部署环境中，同一数据库持续使用同一个加密密钥。
3. 登录管理员账号，打开 **站点管理**（`/settings`），选择 OpenAI、Kimi 或 DeepSeek 并保存站点 API Key。保存后立即对所有登录用户生效。只在部署后台统一配置时，也可用 `AI_PROVIDER` 和对应的服务商环境变量。

摘要和标签会使用所选服务商。语义搜索及语义连线独立使用 OpenAI 的 `text-embedding-3-small`，可在后台配置站点 OpenAI 密钥，或设置部署变量 `OPENAI_API_KEY`。只配置 Kimi 或 DeepSeek 时，仍可生成摘要、标签并显示共同标签连线。旧收藏可通过「重试处理」补充摘要或语义索引。

## 支持范围

- 普通网页通过 Open Graph 等页面元数据与 Readability 提取。
- GitHub 仓库页优先读取公开仓库 API 和 README。X 帖子使用公开嵌入接口补充正文。
- 小红书、抖音识别域名和分享链接，可提取服务端公开返回的标题、描述和封面。登录墙、风控和仅客户端可见的内容可能只保存链接。当前版本采集公开 HTML 与 API，可见视频内容未做转写。
- 关键词按片段匹配，支持中文原文子串。语义检索覆盖已索引收藏。相关收藏根据向量相似度写入 `bookmark_edges` 并在卡片中显示，并不需要额外图数据库。
- 常见跟踪参数会清理。规范化起始链接及可成功解析的重定向目标用于账户内去重。记录原始 URL、最终 URL、抓取时间和正文哈希。

## Vercel

将此项目导入 Vercel，选择 Next.js 项目和 Node.js 24。部署完整 Next.js 源码，不要使用导出的静态预览 HTML。页面、注册、登录和会话均由 Next.js 与 Supabase 处理。

1. 完成上面的 Supabase 数据库迁移。在 Vercel **Settings → Environment Variables** 至少设置 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 和 `NEXT_PUBLIC_SITE_URL`。公开密钥也兼容 `NEXT_PUBLIC_SUPABASE_ANON_KEY`。添加到 Production 环境，并重新部署，已有部署不会自动读取新增变量。最后一个填写当前部署的完整站点地址，例如 `https://your-app.vercel.app`，或正式自定义域名，不含路径。变量变更后重新部署。服务端 Secret Key 只用于管理员配置，不需要暴露给浏览器。
2. Supabase **Authentication → URL Configuration** 的 Site URL 填写同一站点地址。在 Redirect URLs 添加精确的 `https://你的域名/auth/callback`，本地开发可另加 `http://localhost:3000/auth/callback`。Vercel Preview 若需独立认证，为该环境分别设置自己的站点地址和回调白名单。
3. 关闭 Supabase 的 Email、Phone 和 Anonymous Provider，只启用 Google 与 GitHub。不要全局关闭新用户创建，否则新的 Google/GitHub 用户也无法首次登录。应用的 `/auth/session` 只接受白名单内的 OAuth Provider 和退出操作，旧邮箱注册、密码登录接口已移除。
4. Google Cloud Console 创建 **Web application** 类型的 OAuth Client。Authorized JavaScript origins 填写站点 origin。Authorized redirect URIs 填写 Supabase 提供的 `https://你的项目.supabase.co/auth/v1/callback`。将 Client ID 和 Client Secret 填入 Supabase **Authentication → Providers → Google** 并启用。Google 应用在 Testing 状态时需添加测试用户，对外开放时完成 Google 要求的发布配置。
5. GitHub **Settings → Developer settings → OAuth Apps → New OAuth App** 创建应用。Homepage URL 填写站点地址，Authorization callback URL 填写同一个 Supabase 回调地址 `https://你的项目.supabase.co/auth/v1/callback`。将 Client ID 和生成的 Client Secret 填入 Supabase **Authentication → Providers → GitHub** 并启用。只请求基础身份权限，不请求仓库访问权限。两家 Client Secret 均只保存在 Supabase，不要添加到 `NEXT_PUBLIC_*` 环境变量中。
6. 分别测试 Google/GitHub 首次授权、再次登录、取消授权、刷新保持会话和退出。Cookie 会话由 Supabase SSR 维护，数据访问由 RLS 按用户隔离。授权地址返回和确认退出成功后才播放离场动画，失败时显示错误并恢复按钮。

收藏处理的函数时长配置为 60 秒。

## 验证

```sh
npm run typecheck
npm test
npm run build
```

测试使用本地 PostgreSQL（PGlite）和真实 pgvector 执行生产迁移，使用固定向量验证索引行为，不消耗 AI 配额。采集测试覆盖分享文字、页面元数据、正文提取和公开网络地址校验。另见 [参考仓库研究](docs/reference-research.md)。

登录卡片的粒子变形参考 [Dissolve ThinkingOrb](https://dissolve.rselmi.com/components/thinking-orb/)，采用 MIT 许可，见 [版权说明](docs/licenses/dissolve.txt)。芝士形状和主题配色为本项目适配。

## 搜索与分享元数据

公开首页包含 canonical、网站结构化数据、Open Graph 与 Twitter 分享图。`NEXT_PUBLIC_SITE_URL` 填写正式域名；未填写时可使用 Vercel 的 `VERCEL_PROJECT_PRODUCTION_URL`。Vercel 预览环境禁止收录，生产环境公开首页允许收录。站点地图只包含公开首页，登录、管理和认证路径不收录。更新域名后重新部署，并在搜索引擎站长平台提交 `/sitemap.xml`。


## 知识库后端与运维

- `bookmark_jobs` 为持久任务队列：保存收藏时在同一数据库事务中入队；工作进程按租约领取，最多并发领取 3 条，失败退避重试最多 4 次。进程中断后租约到期可重新领取。`after()` 只负责尽快启动，恢复保障来自数据库和 Cron。
- `vercel.json` 每分钟触发 `/api/internal/knowledge-worker`，必须配置生产环境 `CRON_SECRET`。内部接口用定时任务密钥认证，不接受普通用户调用；公开接口分别检查登录、同源请求和账号所有权。
- 原始网页快照、提取文本、来源 URL、内容哈希存入 `bookmark_sources`；历史提取文本标记 legacy。模型版本、摘要、标签、逐字证据存入 `bookmark_derivations`。导入版本单独标记，不伪装成本站采集或生成。
- 正文按重叠窗口分块；支持关键词检索。配置 OpenAI 向量密钥后分批建立 1536 维正文向量与语义关联；仅配置 DeepSeek/Kimi 时仍支持标签关联和关键词证据问答。
- `/manage` 提供编辑标题/标签/笔记、回收站恢复、重新采集、任务状态、原文版本、JSON 备份导入导出和带引用问答。人工标签和标题不会被自动整理覆盖。
- 问答仅使用当前账号可访问且未删除的来源分段；服务端校验引用的段落 ID 与原文逐字摘录，证据不足时不返回无引用的答案。这不能替代人工事实核对。
- 普通公开 HTML、GitHub 公开仓库、X 公开嵌入已支持。登录墙、仅客户端渲染的正文、音视频转录、PDF/Office、飞书同步暂不保证采集；失败会显示读取受限，链接和笔记仍保存。此版本不宣称支持任意网站或完整多媒体采集。
- 备份为用户下载的 JSON，不是异地自动灾备。单次最多 500 条收藏、1000 份来源、1000 个整理版本、10 MB；超限明确返回错误，不静默截断。导入逐条执行、自动跳过已有 URL，失败后已成功的条目会保留。手动备份包含原始资料，请自行妥善保管；不包含账号密钥或模型密钥。
- 模型问答限制为每账号每小时 20 次，收藏每账号每天 200 次，导入每天 500 次。定时任务不会对已完成条目反复调用模型。
- 安全与恢复测试：`npm test`；生产构建：`npm run build`。重点覆盖租约恢复、跨账号隔离、原件只读、回收站检索排除、模型引用校验和持久配额。

Supabase 安全检查会提示两个已登录用户可调用的 SECURITY DEFINER RPC：配额函数只使用 auth.uid() 写固定配额，重试函数先核对 auth.uid() 与收藏所有权；均设置固定 search_path、拒绝匿名访问并有跨账号测试。这是有意的有限提权，未授予用户直接修改队列表或配额表的权限。[检查规则与说明](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)。仅服务端配置表与内部配额表无客户端策略是默认拒绝设计。
