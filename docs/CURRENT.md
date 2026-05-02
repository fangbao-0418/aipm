# AIPM 当前文档入口

这份文件只回答一个问题：

**现在应该以哪几份文档作为实现和继续讨论的主依据。**

## 当前最重要的主文档

### 1. 产品总方案

- [aipm-product-prd-v3-master.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-product-prd-v3-master.md)

这是当前最接近“对外产品 PRD”的总方案，也是后续产品、技术、交互继续对齐时的最高优先级文档。

如果你只看一份文档，就先看这一份。

### 2. 六阶段主流程方案

- [aipm-6-stage-master-flow-plan-v1.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-6-stage-master-flow-plan-v1.md)

这份文档用于补充说明六阶段之间怎么衔接、为什么要这么分阶段。

### 3. 当前对齐版技术方案

- [aipm-aligned-technical-solution-v1.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-aligned-technical-solution-v1.md)

这份文档只保留当前最重要的技术对齐信息：

- 聊天行为原则
- 阶段定义
- 每阶段输入输出
- 产物形式
- 什么时候生成文档
- 什么时候推进阶段

### 4. 当前实现拆解文档

- [aipm-implementation-task-breakdown-v1.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-implementation-task-breakdown-v1.md)

这份文档用于把主 PRD 反推成可执行的实现任务、优先级、依赖和验收标准。

### 5. 当前 P0 开发排期清单

- [aipm-p0-sprint-plan-v1.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-p0-sprint-plan-v1.md)

这份文档用于把当前最优先的 6 个任务进一步压成可执行的迭代排期。

### 6. 当前 P0 开发规格清单

- [aipm-p0-development-spec-v1.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-p0-development-spec-v1.md)

这份文档用于把当前最优先的 6 个任务进一步落成实现可以直接开工的规格说明。

## 当前阶段细化文档

下面这些文档用于逐阶段展开主文档，不替代主文档：

- [aipm-requirement-organization-stage-plan-v1.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-requirement-organization-stage-plan-v1.md)
- [aipm-requirement-document-spec-v1.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-requirement-document-spec-v1.md)
- [aipm-requirement-structuring-stage-plan-v1.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-requirement-structuring-stage-plan-v1.md)
- [aipm-requirement-clarification-stage-plan-v1.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-requirement-clarification-stage-plan-v1.md)
- [aipm-product-model-stage-plan-v1.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-product-model-stage-plan-v1.md)
- [aipm-prd-stage-plan-v1.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-prd-stage-plan-v1.md)
- [aipm-prototype-stage-plan-v1.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-prototype-stage-plan-v1.md)

## 当前交互与规则文档

- [aipm-main-agent-chat-rules-v1.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-main-agent-chat-rules-v1.md)
- [aipm-3-stage-ui-flow-spec-v1.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-3-stage-ui-flow-spec-v1.md)

## 当前建议阅读顺序

1. [aipm-product-prd-v3-master.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-product-prd-v3-master.md)
2. [aipm-6-stage-master-flow-plan-v1.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-6-stage-master-flow-plan-v1.md)
3. [aipm-aligned-technical-solution-v1.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-aligned-technical-solution-v1.md)
4. [aipm-implementation-task-breakdown-v1.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-implementation-task-breakdown-v1.md)
5. [aipm-p0-sprint-plan-v1.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-p0-sprint-plan-v1.md)
6. [aipm-p0-development-spec-v1.md](/Users/fangbao/Documents/self-work/ai-pm/docs/aipm-p0-development-spec-v1.md)
7. 按需阅读具体阶段细化文档

## 当前产品结论

AIPM 当前不是“全自动生成器”，而是：

**一个由主 Agent 持续协作推进的 Chat-First 产品定义工作台。**

它当前围绕 6 个阶段运行：

1. 需求整理
2. 需求结构化
3. 需求澄清
4. 产品模型
5. PRD
6. 原型

后续产品和实现，都应优先围绕这条主线继续收敛。
