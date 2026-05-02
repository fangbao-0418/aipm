# AIPM 第一阶段技术方案 V1

## 1. 文档目标

本文档只服务当前第一阶段实现：

- 收集散落需求点
- 收集评论、补充说明、回复
- 收集上传文件
- 通过 AI 整理成一份需求点文档
- 支持富文本编辑
- 支持版本历史、diff、回滚

这份技术方案不覆盖后续 `需求文档 / PRD / 原型 / UI 稿` 的完整实现，只保证第一阶段做稳、做透。

## 2. 核心产品原则

### 2.1 主 Agent 必须始终在线

虽然当前先做第一阶段，但系统设计必须遵守一条总原则：

- 所有阶段都要经过 `主 Agent` 跟进回复

落到第一阶段，就是：

- 用户输入一句话或上传文件后，主 Agent 先感知新增来源
- 主 Agent 判断当前输入应该怎么处理
- 主 Agent 在聊天中即时反馈系统正在做什么
- 主 Agent 在整理完成后告诉用户当前识别到了什么、还缺什么
- 主 Agent 判断当前阶段是否已经足够进入下一阶段

当前第一阶段虽然只实现“需求采集”，但技术架构不能写死成“只有阶段内逻辑，没有总 Agent”。

### 2.2 用户要看到过程，不只看到结果

输入后不能长时间无反馈。

系统至少要在聊天里流式反馈：

1. 正在读取哪些来源
2. 当前在做什么判断
3. 当前在做哪一步整理
4. 模型实时输出了什么
5. 当前还缺什么

## 3. 第一阶段的系统边界

### 3.1 当前必须实现

- 项目空间本地初始化
- 来源记录保存
- 上传文件保存与解析
- 需求点文档生成
- 文档编辑
- 版本保存
- 版本 diff
- 版本回滚
- 聊天协作整理
- 主 Agent 跟进回复

### 3.2 当前不强求

- 直接生成 PRD
- 原型和 UI 稿正式产物
- 全流程自动串行推进
- 多人协作
- 云端同步

## 4. 第一阶段总体架构

建议采用 5 层结构：

1. `CLI + Workspace UI`
2. `Workspace API`
3. `MainAgentOrchestrator`
4. `RequirementCollection Services`
5. `Local Storage`

## 5. 运行形态

用户通过：

```bash
aipm workspace
```

启动本地服务和工作台。

第一阶段运行时包括：

- `CLI`
- `Fastify API`
- `React Workspace UI`
- `本地项目空间`
- `LLM Adapter`

## 6. 核心模块设计

### 6.1 WorkspaceProjectService

职责：

- 初始化项目空间
- 读取项目与阶段数据
- 保存来源记录
- 保存和读取上传文件
- 保存需求点文档
- 管理历史版本

### 6.2 MainAgentOrchestratorService

职责：

- 感知当前阶段
- 读取当前项目上下文
- 基于当前输入判断下一步动作
- 生成对用户可见的跟进回复
- 判断当前阶段是否满足推进条件

当前第一阶段里，主 Agent 重点负责：

- 当前输入是否收录
- 需求是否还缺关键内容
- 当前文档是否已经清晰
- 是否建议进入下一阶段

### 6.3 RequirementCollectionService

职责：

- 组织全部来源
- 做来源摘要
- 做需求点整理
- 生成需求点文档
- 管理文档版本

### 6.4 FileParsingService

职责：

- 解析 `txt / md / json / csv / pdf / doc / docx / xls / xlsx`
- 提取正文
- 保留原文件
- 生成文件索引与预览信息

### 6.5 ChatStreamService

职责：

- 把聊天输入转成流式响应
- 实时推送状态和模型输出
- 支持中断

## 7. 第一阶段数据流

### 7.1 输入数据流

输入可以来自：

- 聊天输入
- 来源记录区新增记录
- 来源记录编辑/回复
- 文件上传

数据流如下：

1. 用户输入或上传
2. API 保存原始来源
3. 项目空间落盘
4. 主 Agent 感知变更
5. 如用户触发 `AI 整理`
6. RequirementCollectionService 读取全部来源
7. 生成来源摘要
8. 生成需求点文档
9. 写入新版本
10. 主 Agent 产出阶段反馈

### 7.2 主动整理原则

来源记录的新增、编辑、回复、删除：

- 只保存来源本身
- 不自动重整左侧需求点文档

只有下面几种动作才触发重整：

- 聊天中明确要求整理
- 点击 `AI 整理`
- 上传文件后用户确认整理

## 8. 本地目录结构

第一阶段建议目录如下：

```text
workspace/projects/<projectId>/
  project.json
  stage-state.json
  settings/
    llm.json
    llm.secrets.json
  sources/
    source-records.json
    files/
    file-index.json
  requirement-collection/
    requirement-points.md
    requirement-points.html
    source-summaries.json
    versions/
  agent/
    latest-decision.json
    runs/
```

## 9. 数据对象设计

### 9.1 project.json

建议包含：

- `id`
- `name`
- `description`
- `industry`
- `currentStage`
- `createdAt`
- `updatedAt`
- `llmSettings`

### 9.2 source-records.json

每条来源记录至少包含：

- `id`
- `content`
- `parentId`
- `createdAt`
- `updatedAt`
- `sourceType`

### 9.3 file-index.json

每个文件至少包含：

- `id`
- `name`
- `mimeType`
- `size`
- `uploadedAt`
- `storedFilename`
- `relativePath`
- `extractionStatus`
- `extractedTextExcerpt`
- `note`

### 9.4 需求点文档对象

建议对象：

- `requirementsDocument`
- `requirementsDocumentHtml`
- `aiSummary`
- `structuredSnapshot`
- `followupQuestions`
- `sourceSummaries`
- `lastOrganizedAt`
- `lastEditedAt`

### 9.5 历史版本对象

版本至少包含：

- `id`
- `createdAt`
- `source`
- `requirementsDocument`
- `requirementsDocumentHtml`

## 10. 第一阶段 AI 子任务设计

### 10.1 输入判定

目标：

- 判断当前输入是收录、建议、追问还是回答

输入：

- 当前消息
- 最近对话历史
- 当前需求点文档摘要

输出：

- `mode`
- `shouldCapture`
- `reply`
- `guidance`

### 10.2 来源摘要

目标：

- 对每份来源和每个分块做摘要

输出：

- `summary`
- `keyPoints`
- `candidateUserGoals`
- `candidateScenarios`
- `candidateFunctions`
- `candidateConstraints`
- `openQuestions`

### 10.3 需求点整理

目标：

- 基于全部来源生成一份清晰需求点文档

输出：

- `aiSummary`
- `requirementsDocument`
- `structuredSnapshot`
- `followupQuestions`

### 10.4 主 Agent 跟进回复

目标：

- 向用户解释当前系统做了什么
- 当前识别到了什么
- 当前还缺什么
- 当前是否适合推进

输出：

- 对用户可见的聊天回复
- `mainAgentDecision`

## 11. API 设计

### 11.1 项目

- `POST /api/workspace/projects`
- `GET /api/workspace/projects/:id/bundle`
- `PUT /api/workspace/projects/:id/settings/llm`

### 11.2 来源记录

- `POST /api/workspace/projects/:id/intake/records`
- `PUT /api/workspace/projects/:id/intake/records/:recordId`
- `DELETE /api/workspace/projects/:id/intake/records/:recordId`

### 11.3 文件

- `POST /api/workspace/projects/:id/intake/files`
- `GET /api/workspace/projects/:id/intake/files/:fileId`

### 11.4 需求点文档

- `PUT /api/workspace/projects/:id/intake/document`
- `POST /api/workspace/projects/:id/intake/document/organize`
- `GET /api/workspace/projects/:id/intake/history`
- `POST /api/workspace/projects/:id/intake/history/:versionId/rollback`

### 11.5 聊天

- `POST /api/workspace/projects/:id/chat`
- `POST /api/workspace/projects/:id/chat/stream`

要求：

- 返回状态流
- 返回模型增量输出
- 支持中断

## 12. 前端交互设计

### 12.1 主界面

- 左侧：项目区
- 中间：聊天区
- 右侧：阶段区

### 12.2 需求采集工作区

打开后全屏：

- 左侧主区域：需求点文档
- 右侧：来源记录和文件

### 12.3 聊天区

要求：

- 发送后立即出现 AI 占位回复
- 先显示状态
- 再显示模型增量输出
- 最后落成正式回复
- 支持停止当前回复

### 12.4 版本区

要求：

- 查看历史版本
- 查看某一版本详情
- 查看 diff
- 回滚

## 13. 模型设置建议

当前第一阶段建议采用：

- 项目级默认模型配置
- 阶段级覆盖只先支持 `capture`

建议配置项：

- `provider`
- `baseUrl`
- `apiKey`
- `modelProfile`
- `capture model`

原因：

- 第一阶段核心是采集和整理
- 现阶段不需要把所有阶段的模型设置都做重
- 先把 `capture` 做稳更重要

## 14. 主 Agent 判断规则

第一阶段里，主 Agent 至少输出这几类判断：

1. `当前输入已收录`
2. `当前输入只作为讨论`
3. `当前需求还缺什么`
4. `当前文档已经比较清晰`
5. `当前阶段还不建议推进`
6. `当前阶段可确认进入下一阶段`

这些判断必须通过聊天对用户可见，而不是只保存在内部状态里。

## 15. 当前实现优先级

建议按下面顺序做：

### P0

- 来源记录保存
- 上传文件保存与解析
- 需求点文档生成
- 文档编辑
- 历史版本
- 回滚
- 聊天流式反馈
- 主 Agent 跟进回复

### P1

- 版本 diff
- 文件预览体验优化
- 主 Agent 推进确认

### P2

- 第一阶段完成后进入第二阶段的正式推进动作

## 16. 当前阶段的完成标准

第一阶段真正完成，不是“界面差不多能用”。

而是满足下面这些条件：

1. 用户可以把散落诉求、评论、文件都收进项目空间
2. 系统不会丢来源
3. AI 能基于全部来源整理出需求点文档
4. 文档支持继续编辑
5. 文档支持版本历史、diff、回滚
6. 主 Agent 会持续跟进回复，而不是只吐一个结果
7. 用户能明确知道当前是否可以进入下一阶段

这才叫第一阶段真正成立。
