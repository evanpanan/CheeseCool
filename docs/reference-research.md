# 参考仓库研究

参考项目由金尘马维护。独立浅克隆位于 `/tmp/jinchenma-knowledge-base-reference`，审阅提交为 `d9c0bdaf1eb3f35eea56458f8d9748237d9273ab`。README、LICENSE、NOTICE、依赖清单、Skill 路由及公共契约均位于该克隆。除另行标注的第三方材料外，规则、脚本、模板和 Skill 采用 CC BY-NC 4.0。本项目独立编写实现。 [参考仓库与许可](https://github.com/jinchenma94/jinchenma-knowledge-base/tree/d9c0bdaf1eb3f35eea56458f8d9748237d9273ab)

参考项目主要由 Python 3.10+ 工具、11 个 Agent Skills、Obsidian Vault 模板、配置、示例及测试组成。开发与能力依赖包含 pytest、PyYAML、requests。飞书依赖 lark-cli，抖音和音频路径还涉及 yt-dlp、FFmpeg、浏览器会话或 ASR 服务。

| 机制 | 参考实现 | CheeseCool 的实现 |
| --- | --- | --- |
| 内容采集 | 媒体采集 Skill 根据平台和介质类型调用客户端工具。抖音有单独的下载和转写流程。 | 借鉴平台分流，重写为可在 Vercel 上运行的 HTTP 提取器。普通网页使用正文提取，GitHub 使用公开 API，X 使用公开嵌入接口，小红书和抖音提取公开元数据。 |
| 知识存储 | 独立 Vault 按内容类型、年份和目录存放 Markdown，使用受保护原稿和 Frontmatter 校验。 | Supabase 按用户隔离，采集内容、来源和 AI 派生字段独立存放。 |
| 自动整理 | Skill 结构化归档。分析、个人观点和实体传播有确认流程。 | 粘贴链接后自动生成中文摘要与标签。保存先于外部处理，未完成时可重试。 |
| 检索 | Agent 按问题扩展文件名、别名、标签和正文候选。读取候选与来源后才回答。 | pgvector 检索同账户内容，结合中文片段关键词匹配，结果直接指向原链接。 |
| 知识关联 | 主题页、实体页、双链和时间线组织关系。 | 用语义相似度产生带权收藏边，供将来构建知识图谱。 |
| 来源追溯 | 稳定 URL、哈希、固定 Git 提交及 `derived_from` 链支持去重和证据溯源。 | 记录分享链接、重定向后的地址、来源平台、采集时间和提取文本哈希。规范化后的地址用于账户内去重。 |

私人登录、云同步、响应式收藏界面、pgvector 索引和关系生成均在 Next.js 与 Supabase 中重新实现。会议、飞书、ASR、笔记模板及观点归档不在本期收藏流程中。
