# AIPM 自动落地技术方案 V1

## 1. 文档目标

本文档面向下面这个核心目标：

- 用户输入一句话需求，例如“我想做一个任务管理应用，帮助团队协作和追踪项目进度”
- 或上传一批需求来源文件，例如 `md / doc / xls / pdf / txt`
- 系统不是只做需求采集，而是由一个主 Agent 驱动整条产品落地链路
- 系统自动完成各阶段任务，持续产出：
  - 需求点拆解
  - 需求文档
  - PRD
  - 原型稿
  - 原型标注
  - UI 稿
- 每个阶段完成后，主 Agent 负责审视结果是否满足进入下一阶段的条件
- 如果满足，在聊天中明确提示用户确认是否推进

这份方案不是“生成 demo 文档”的技术方案，而是“从需求输入到产品产出自动落地”的技术方案。

## 2. 一句话定位

`AIPM` 是一个由 `CLI` 启动、以聊天协作为主入口、由主 Agent 编排全流程的本地 AI 产品工作台。

它的目标不是“帮你写一篇 PRD”，而是“帮你把模糊需求自动推进成一整套可编辑、可审视、可导出的产品产物”。

## 3. 最终要交付的产物

对于每一个项目，系统最终至少交付 6 类正式产物：

1. `需求点拆解`
2. `需求文档`
3. `PRD`
4. `原型稿`
5. `原型标注`
6. `UI 稿`

### 3.1 需求点拆解

作用：

- 把散落需求来源拆成结构化需求点
- 明确目标用户、场景、问题、动作、结果、约束、风险

建议文件：

- `requirements/requirement-points.json`
- `requirements/requirement-points.md`

### 3.2 需求文档

作用：

- 形成一份完整的需求说明文档
- 作为后续 `PRD / 原型 / UI` 的基础输入

建议文件：

- `requirements/requirement-doc.html`
- `requirements/requirement-doc.md`

### 3.3 PRD

作用：

- 形成正式产品定义文档
- 包含背景、目标、用户、范围、流程、页面、功能需求、验收标准

建议文件：

- `prd/prd.md`
- `prd/prd.html`
- `prd/prd.json`

### 3.4 原型稿

作用：

- 把 PRD 落成页面结构和交互骨架

建议文件：

- `prototype/pages/*.html`
- `prototype/prototype.json`

### 3.5 原型标注

作用：

- 补充业务、交互、状态、数据、评审说明

建议文件：

- `prototype/annotations.json`
- `prototype/annotation-report.md`

### 3.6 UI 稿

作用：

- 基于前序产物输出图形化 UI 初稿
- 支持继续编辑、继续 review、继续重生成

建议文件：

- `ui/ui-spec.json`
- `ui/ui-guide.md`
- `ui/assets/*.png`
- `ui/pages/*.html`

## 4. 主工作方式

系统采用 `主 Agent + 阶段 Agent` 双层编排。

### 4.1 主 Agent

主 Agent 是整个项目的总编排器，负责：

- 看当前项目所处阶段
- 看前序阶段产物是否完整
- 看当前用户输入和新增来源
- 判断现在应该做什么
- 决定是否需要先追问、先整理、先 review、还是可以推进
- 在聊天中给用户可见反馈
- 在阶段完成后提示“是否确认进入下一阶段”

主 Agent 的核心原则：

- 不把所有事都推给用户自己判断
- 不静默长时间运行无反馈
- 不在信息不足时盲目进入下一阶段

### 4.2 阶段 Agent

每个阶段由对应阶段 Agent 执行具体任务。

例如：

- `需求采集 Agent`
- `需求结构化 Agent`
- `需求澄清 Agent`
- `产品模型 Agent`
- `PRD Agent`
- `原型 Agent`
- `标注 Agent`
- `UI Agent`
- `Review Agent`

阶段 Agent 的职责是：

- 生成本阶段任务计划
- 执行任务
- 产出阶段结果
- 做阶段内自检
- 把结果交给主 Agent 审视

## 5. 标准自动化落地链路

推荐的自动推进链路如下：

1. `需求入口接收`
2. `需求采集`
3. `需求点拆解`
4. `需求文档`
5. `需求澄清`
6. `产品模型`
7. `PRD`
8. `原型`
9. `原型标注`
10. `UI 稿`
11. `Review`
12. `导出`

其中第 1 步是输入入口，第 2 到第 10 步是核心生产链，第 11 到第 12 步是质量和交付链。

## 6. 各阶段详细设计

### 6.1 需求入口接收

输入：

- 用户在聊天中输入一句话或多段描述
- 用户上传文件
- 用户在来源记录区补充沟通记录

系统动作：

- 保存原始输入
- 保存上传源文件
- 对文件做解析
- 建立来源记录树
- 把全部来源组织成待处理材料

输出：

- `sources/source-records.json`
- `sources/files/*`
- `sources/file-index.json`

AI 介入：

- 主 Agent 判断输入意图
- 需求采集 Agent 判断当前输入是否应收录
- 对长文档分块摘要

### 6.2 需求采集

目标：

- 把散落来源整理成一份“可继续加工的需求采集稿”

系统动作：

- 读取全部来源记录
- 读取全部源文件
- 长文档分块
- 生成 `source summary`
- 聚合成一份需求采集文档

输出：

- `requirement-collection/requirement-collection.html`
- `requirement-collection/requirement-collection.md`
- `requirement-collection/source-summaries.json`

AI 介入：

- 聊天判定模型：判断本轮输入是收录、建议、追问还是回答
- 来源摘要模型：对每份来源和每个 chunk 做摘要
- 采集整理模型：合成需求采集文档

主 Agent 审视项：

- 是否已经明确产品方向
- 是否已有基本目标
- 是否缺少目标用户或核心场景

推进条件：

- 至少形成一份连续可读的需求采集稿

### 6.3 需求点拆解

目标：

- 把需求采集稿拆成结构化需求点

系统动作：

- 从采集稿抽取：
  - 目标用户
  - 核心场景
  - 核心功能
  - 成功结果
  - 约束条件
  - 风险和待确认项

输出：

- `requirements/requirement-points.json`
- `requirements/requirement-points.md`

AI 介入：

- 结构化 Agent 负责抽取和去重
- 主 Agent 负责判断拆解是否足够支持后续文档生成

主 Agent 审视项：

- 是否拆出了清晰需求点
- 是否还是停留在一句口号
- 是否存在明显遗漏

推进条件：

- 需求点可支持正式需求文档生成

### 6.4 需求文档

目标：

- 形成一份完整需求说明文档

系统动作：

- 基于需求点拆解生成需求文档
- 支持富文本编辑
- 支持版本历史、diff、回滚

输出：

- `requirements/requirement-doc.html`
- `requirements/requirement-doc.md`
- `requirements/versions/*`

AI 介入：

- 文档生成
- 文档改写
- 文档补全
- 文档 review

主 Agent 审视项：

- 用户价值是否清楚
- 场景和结果是否清楚
- 是否具备进入 PRD 的基础

推进条件：

- 文档结构完整
- 缺口可被单独列出

### 6.5 需求澄清

目标：

- 把对落地有影响的关键缺口补齐

系统动作：

- 从需求文档中识别缺口
- 生成澄清问题包
- 在聊天中逐条追问

输出：

- `clarify/question-pack.json`
- `clarify/answers.json`
- `clarify/clarify-report.md`

AI 介入：

- 澄清问题生成
- 多轮追问
- 回答归并

主 Agent 审视项：

- 是否还存在推进阻塞项
- 是否还缺关键约束

推进条件：

- 不再存在必须阻断后续阶段的关键缺口

### 6.6 产品模型

目标：

- 形成统一中间模型，避免 `需求文档 / PRD / 原型 / UI` 各自跑偏

系统动作：

- 生成统一的产品模型对象

输出：

- `model/product-model.json`
- `model/product-model.md`

AI 介入：

- 用户模型
- 业务对象模型
- 流程模型
- 页面模型

主 Agent 审视项：

- 模型是否能支撑后续 PRD 和原型
- 是否与前序文档一致

推进条件：

- 中间模型结构完整且可被复用

### 6.7 PRD

目标：

- 生成正式产品需求文档

系统动作：

- 基于产品模型生成 PRD
- 允许人工编辑
- 允许聊天修改
- 允许 patch 应用

输出：

- `prd/prd.md`
- `prd/prd.html`
- `prd/prd.json`
- `prd/versions/*`

AI 介入：

- PRD 生成
- PRD 改写
- PRD review
- 风险和缺口识别

主 Agent 审视项：

- 目标是否明确
- 范围是否合理
- 页面和流程是否完整
- 功能需求和验收标准是否可执行

推进条件：

- PRD 达到可进入原型阶段的质量

### 6.8 原型

目标：

- 把 PRD 落成页面结构和交互骨架

系统动作：

- 生成页面清单
- 生成站点结构
- 生成页面 HTML 或低保真画布

输出：

- `prototype/pages/*.html`
- `prototype/prototype.json`

AI 介入：

- 页面结构生成
- 模块布局建议
- 主流程交互组织

主 Agent 审视项：

- 页面是否覆盖关键流程
- 页面结构是否和 PRD 对齐

推进条件：

- 原型已经足够支持标注和 UI 稿生成

### 6.9 原型标注

目标：

- 给原型补上业务、交互、状态、数据说明

系统动作：

- 自动生成首版标注
- 允许人工补标
- 允许 AI 继续整理

输出：

- `prototype/annotations.json`
- `prototype/annotation-report.md`

AI 介入：

- 标注生成
- 标注归类
- 标注补漏

主 Agent 审视项：

- 是否还有未说明的关键交互
- 是否存在无法交付研发/设计的歧义

推进条件：

- 原型已具备设计输入价值

### 6.10 UI 稿

目标：

- 基于前序产物输出图形化 UI 初稿

系统动作：

- 先生成 UI 设计说明和 tokens
- 再生成图形化 UI 初稿
- 输出可继续 review 的 UI 资产

输出：

- `ui/ui-spec.json`
- `ui/ui-guide.md`
- `ui/assets/*.png`
- `ui/pages/*.html`

AI 介入：

- 视觉方向生成
- 设计规范生成
- 图形化 UI 初稿生成

主 Agent 审视项：

- UI 是否表达关键产品意图
- 是否和原型/PRD 一致
- 是否还需要再次回改 PRD 或原型

推进条件：

- UI 初稿达到可设计 review 的水平

### 6.11 Review

目标：

- 做整链路质量校验

系统动作：

- review 需求点拆解
- review 需求文档
- review PRD
- review 原型
- review UI 稿

输出：

- `review/review-report.json`
- `review/review-report.md`

AI 介入：

- 各阶段 reviewer
- 主 Agent 全局一致性审视

### 6.12 导出

目标：

- 提供完整交付包

输出：

- `exports/project-bundle.zip`
- `exports/prd.pdf`
- `exports/prototype.zip`
- `exports/ui-assets.zip`

## 7. 聊天交互设计

聊天区是主交互入口，不是附属工具。

### 7.1 输入后系统必须立刻反馈

用户输入一句话或上传文件后，系统必须立刻在聊天中流式反馈：

1. 当前已接收什么
2. 正在读取哪些来源
3. 正在做什么判断
4. 正在输出什么内容
5. 当前阶段是否还缺什么

### 7.2 聊天消息类型

聊天区至少支持这几类消息：

- `收录确认`
- `建议性回复`
- `追问澄清`
- `阶段完成提示`
- `推进确认`
- `Review 反馈`

### 7.3 聊天驱动修改

聊天区应支持：

- “把这段收录进需求文档”
- “帮我把这一段写得更专业”
- “基于现有内容重新整理 PRD”
- “根据这个 PRD 生成原型”
- “对这个原型补标注”
- “基于现有原型生成 UI 初稿”

## 8. 为什么系统要“自己把任务走完”

这个产品的关键竞争力不是“帮你写一段文本”，而是“帮你推进产品落地流程”。

所以系统应遵循下面这条原则：

- 用户输入目标
- 主 Agent 自己编排阶段
- 阶段 Agent 自己拆计划和执行
- 主 Agent 自己审视质量
- 只有在推进节点和关键分歧点才向用户确认

这样用户体验才像：

- 和一个资深 AI 产品专家协作

而不是：

- 一步一步点按钮驱动一个半自动工具

## 9. 本地目录结构建议

建议项目空间结构如下：

```text
workspace/projects/<projectId>/
  project.json
  settings/
    llm.json
    llm.secrets.json
  sources/
    source-records.json
    files/
    file-index.json
  requirement-collection/
    requirement-collection.md
    requirement-collection.html
    source-summaries.json
    versions/
  requirements/
    requirement-points.json
    requirement-points.md
    requirement-doc.md
    requirement-doc.html
    versions/
  clarify/
    question-pack.json
    answers.json
    clarify-report.md
  model/
    product-model.json
    product-model.md
  prd/
    prd.md
    prd.html
    prd.json
    versions/
  prototype/
    pages/
    prototype.json
    annotations.json
    annotation-report.md
  ui/
    ui-spec.json
    ui-guide.md
    assets/
    pages/
  review/
    review-report.json
    review-report.md
  exports/
  agent/
    latest-decision.json
    runs/
```

## 10. 核心 API 设计

### 10.1 输入入口

- `POST /api/workspace/projects`
- `GET /api/workspace/projects/:id/bundle`
- `POST /api/workspace/projects/:id/chat/stream`
- `POST /api/workspace/projects/:id/intake/files`

### 10.2 阶段动作

- `POST /api/workspace/projects/:id/advance`
- `POST /api/workspace/projects/:id/stages/:stage/rollback`
- `POST /api/workspace/projects/:id/requirement-structure/generate`
- `POST /api/workspace/projects/:id/prd/generate`
- `POST /api/workspace/projects/:id/prototype/generate`
- `POST /api/workspace/projects/:id/ui-draft/generate`

### 10.3 文档编辑

- `PUT /api/workspace/projects/:id/intake/document`
- `PUT /api/workspace/projects/:id/requirement-structure/document`
- `PUT /api/workspace/projects/:id/prd/document`
- `PUT /api/workspace/projects/:id/prototype/document`
- `PUT /api/workspace/projects/:id/ui-draft/document`

### 10.4 版本管理

- `GET /api/workspace/projects/:id/intake/history`
- `POST /api/workspace/projects/:id/intake/history/:versionId/rollback`
- `GET /api/workspace/projects/:id/prd/history`
- `POST /api/workspace/projects/:id/prd/history/:versionId/rollback`

## 11. 模型编排建议

不建议整条链只绑定一个模型。

建议采用：

- `主编排模型`
  - 负责主 Agent 判断、阶段推进、review
- `采集整理模型`
  - 负责聊天判定、来源摘要、需求采集整理
- `文档生成模型`
  - 负责需求文档、PRD、产品模型
- `设计生成模型`
  - 负责原型、标注、UI 稿

推荐原则：

- 每个项目有默认模型配置
- 每个阶段允许覆盖模型
- 每个子任务允许按需要切换模型

## 12. MVP 落地建议

第一版不要试图一次把所有阶段都做满，建议分 4 步实现。

### 第一步

打通：

- 输入一句话
- 上传文件
- 需求采集
- 需求点拆解
- 需求文档

### 第二步

打通：

- 需求澄清
- 产品模型
- PRD

### 第三步

打通：

- 原型
- 原型标注

### 第四步

打通：

- UI 稿
- 全链路 review
- 导出

## 13. 最关键的产品判断

这个产品的正确方向不是：

- 输入一句话
- 直接生成一堆文档

而是：

- 输入一句话或上传文件
- 主 Agent 接管流程
- 每个阶段自动执行任务
- 每一步都给用户可见反馈
- 每个阶段都可回退、可修改、可重新整理
- 最终形成可交付的产品方案包

这才是真正的 `AI PM Agent`。
