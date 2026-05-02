# AI PM

本项目是一个本地优先的 AI 产品管理工具，目标是把“多方需求记录 -> 价值评估 -> 阶段流转 -> PRD / 原型 / UI -> 后续任务管理”串成一条可落地流水线。产品形态以 `CLI` 为主入口，并可从 CLI 打开本地 `Workspace` 工作台。

当前这一版已经实现了最小闭环：

- 需求记录
- 需求查看
- 需求阶段流转
- 需求评分与优先级排序
- 任务创建、查看、更新
- `product-model -> PRD -> validate / compare -> wireframe -> annotations -> UI` 流水线
- `refine chat -> 推荐动作 / 任务建议 / 标注建议` 工作流
- 原型标注 -> 任务创建 -> 标注回写
- `SQLite` 索引层 + 本地 JSON / Markdown / HTML 正文存储
- 本地 skills 发现
- React/Vite 本地 Workspace 工作台与 API

## 当前目录

```text
ai-pm/
  configs/
  docs/
  schemas/
  skills/
  src/
```

运行后会在项目根目录自动生成：

```text
requirements/
tasks/
versions/
logs/
data/
artifacts/
```

## 环境要求

- Node.js `>= 22`
- npm

## 安装

```bash
npm install
```

## 环境变量

复制一份环境变量模板：

```bash
cp .env.example .env
```

关键变量：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `AIPM_PROMPT_PROFILE`
- `HOST`
- `PORT`

如果没有设置 `OPENAI_API_KEY`，系统会自动回退到本地模板生成。

## 开发命令

类型检查：

```bash
npm run check
```

编译：

```bash
npm run build
```

开发模式运行 CLI：

```bash
npm run dev:cli -- --help
```

编译后运行 CLI：

```bash
node dist/cli/bin.js --help
```

启动本地 Workspace 服务：

```bash
npm run dev:workspace
```

启动 Workspace 前端开发服务：

```bash
npm run dev:workspace:web
```

编译后运行 Workspace：

```bash
npm run start:workspace
```

默认地址：

```text
http://127.0.0.1:4310
```

也可以直接从 CLI 拉起工作台：

```bash
node dist/cli/bin.js workspace
```

不自动打开浏览器：

```bash
node dist/cli/bin.js workspace --no-open
```

Workspace 当前已支持：

- 查看需求列表和详情
- 查看任务与 skills
- 查看 skills 列表
- 触发 `product-model / prd / validate / compare / wireframe / annotate / ui`
- 查看当前 requirement 的完整 artifact bundle
- 预览 wireframe 和 UI 页面
- 在 Studio 里继续 refine 对话
- 根据原型标注一键创建任务并回写标注
- 在页面里创建需求和任务

## Prompt / Config 管理

AI 行为现在可以通过本地文件管理：

- 模型运行参数：
  - `configs/ai-runtime.json`
- 系统 prompt：
  - `prompts/default/product-model.system.md`
  - `prompts/default/prd.system.md`
  - `prompts/default/prd-validate.system.md`
  - `prompts/default/prd-compare.system.md`
  - `prompts/default/wireframe.system.md`
  - `prompts/default/wireframe-annotate.system.md`
  - `prompts/default/ui.system.md`
  - `prompts/default/refine.system.md`

如果你想切换 prompt 版本，可以新建：

```text
prompts/<your-profile>/*.md
```

然后设置：

```bash
export AIPM_PROMPT_PROFILE=<your-profile>
```

## 当前已支持的 CLI

### 1. 新增需求

```bash
node dist/cli/bin.js req add \
  --title "订阅提醒" \
  --source customer \
  --source-name "Acme" \
  --channel meeting \
  --content "希望增加自动续费提醒和取消入口" \
  --tag billing \
  --tag retention
```

### 2. 查看需求列表

```bash
node dist/cli/bin.js req list
```

按条件过滤：

```bash
node dist/cli/bin.js req list --status triaged
node dist/cli/bin.js req list --priority P1
node dist/cli/bin.js req list --source customer
```

输出 JSON：

```bash
node dist/cli/bin.js req list --json
```

### 3. 查看单条需求

```bash
node dist/cli/bin.js req view req-001
```

带评分一起看：

```bash
node dist/cli/bin.js req view req-001 --score
```

### 4. 变更需求阶段

```bash
node dist/cli/bin.js req stage req-001 --to triaged --reason "已补齐背景"
```

当前已接入的阶段流转：

- `captured`
- `triaged`
- `clarifying`
- `modeled`
- `prd_ready`
- `wireframe_ready`
- `ui_ready`
- `reviewing`
- `approved`
- `archived`

### 5. 给需求评分

```bash
node dist/cli/bin.js req score req-001 \
  --user-value 5 \
  --business-value 4 \
  --strategic-fit 4 \
  --urgency 3 \
  --reach 3 \
  --implementation-cost 2 \
  --delivery-risk 2 \
  --reason "提升订阅留存并降低用户流失"
```

可选人工覆盖优先级：

```bash
node dist/cli/bin.js req score req-001 \
  --user-value 5 \
  --business-value 4 \
  --strategic-fit 4 \
  --urgency 5 \
  --reach 4 \
  --implementation-cost 3 \
  --delivery-risk 3 \
  --override-level P0 \
  --override-reason "存在明确业务窗口期"
```

### 6. 查看优先级排序

```bash
node dist/cli/bin.js req prioritize
```

输出 JSON：

```bash
node dist/cli/bin.js req prioritize --json
```

## Product Model / PRD / Wireframe / UI

基于某条需求生成 `product-model.json`：

```bash
node dist/cli/bin.js model generate --requirement req-001
```

查看 product model：

```bash
node dist/cli/bin.js model view --requirement req-001
```

生成 PRD：

```bash
node dist/cli/bin.js prd generate --requirement req-001
```

查看 PRD markdown：

```bash
node dist/cli/bin.js prd view --requirement req-001
```

查看结构化 PRD JSON：

```bash
node dist/cli/bin.js prd view --requirement req-001 --json
```

做 PRD 自动验证：

```bash
node dist/cli/bin.js prd validate --requirement req-001
```

做竞品分析：

```bash
node dist/cli/bin.js prd compare --requirement req-001 --competitor Figma --competitor Notion
```

生成原型与标注：

```bash
node dist/cli/bin.js wireframe generate --requirement req-001
node dist/cli/bin.js wireframe annotate --requirement req-001
```

查看原型 spec 或页面：

```bash
node dist/cli/bin.js wireframe view --requirement req-001
node dist/cli/bin.js wireframe view --requirement req-001 --page page-home
node dist/cli/bin.js wireframe view --requirement req-001 --annotations
```

生成 UI：

```bash
node dist/cli/bin.js ui generate --requirement req-001
```

查看 UI design 或页面：

```bash
node dist/cli/bin.js ui view --requirement req-001
node dist/cli/bin.js ui view --requirement req-001 --page page-home
```

生成结果会落到：

- `artifacts/<requirementId>/context/product-model.json`
- `artifacts/<requirementId>/prd/prd.json`
- `artifacts/<requirementId>/prd/prd.md`
- `artifacts/<requirementId>/prd/prd-validation.json`
- `artifacts/<requirementId>/prd/competitor-analysis.json`
- `artifacts/<requirementId>/wireframes/wireframe-spec.json`
- `artifacts/<requirementId>/wireframes/wireframe-annotations.json`
- `artifacts/<requirementId>/wireframes/pages/*.html`
- `artifacts/<requirementId>/ui/design-style.json`
- `artifacts/<requirementId>/ui/pages/*.html`

## AI 生成说明

如果设置了 `OPENAI_API_KEY`，`product-model`、`PRD`、`validate`、`compare`、`wireframe`、`annotations`、`UI` 会走真实 AI 生成。

如果没有设置，系统会自动回退到本地模板生成，这样可以先完成本地开发和联调。

`refine chat` 也遵循同样规则。

## 当前已支持的 Task

创建任务：

```bash
node dist/cli/bin.js task create \
  --title "实现续费提醒配置" \
  --type frontend \
  --priority P1 \
  --requirement req-001 \
  --owner "Alice" \
  --description "完成提醒入口和详情态的前端实现" \
  --acceptance "支持展示提醒状态"
```

查看任务列表：

```bash
node dist/cli/bin.js task list
```

查看单条任务：

```bash
node dist/cli/bin.js task view task-001
```

更新任务：

```bash
node dist/cli/bin.js task update task-001 --status in_progress --owner "Alice"
```

任务看板：

```bash
node dist/cli/bin.js task board
```

## 当前已支持的 Skills

查看所有 skills：

```bash
node dist/cli/bin.js skill list
```

按阶段筛选：

```bash
node dist/cli/bin.js skill list --stage prd
```

查看单个 skill：

```bash
node dist/cli/bin.js skill view prd-validator
```

当前自带两个示例 skill：

- `prd-validator`
- `wireframe-annotator`

## Studio API

当前基础接口：

- `GET /health`
- `GET /api/requirements`
- `GET /api/requirements/:id`
- `POST /api/requirements`
- `POST /api/requirements/:id/stage`
- `POST /api/requirements/:id/score`
- `GET /api/skills`
- `GET /api/skills/:id`
- `GET /api/tasks`
- `GET /api/tasks/:id`
- `POST /api/tasks`
- `POST /api/tasks/:id/update`
- `POST /api/generation/product-model`
- `POST /api/generation/prd`
- `GET /api/project/product-model`
- `GET /api/project/prd`

健康检查示例：

```bash
curl -s http://127.0.0.1:4310/health
```

获取需求列表示例：

```bash
curl -s http://127.0.0.1:4310/api/requirements
```

## 数据存储

当前第一版采用本地文件存储：

- 需求：
  - `requirements/req-xxx/requirement.json`
- 评分：
  - `requirements/req-xxx/score.json`
- 变更日志：
  - `versions/changelog.jsonl`

后续会逐步接入：

- SQLite 索引
- 更真实的 AI product-model / PRD 生成
- 原型 / UI 生成
- PRD 自动验证
- 竞品对比分析
- 原型标注
- 任务管理

## 评分规则

默认评分配置在：

- `configs/default-priority-weights.json`

当前采用：

- 正向维度：
  - `userValue`
  - `businessValue`
  - `strategicFit`
  - `urgency`
  - `reach`
- 负向维度：
  - `implementationCost`
  - `deliveryRisk`

输出结果包括：

- `valueScore`
- `priorityScore`
- `priorityLevel`

## 重要文件

- 需求方案：
  - `docs/ai-pm-cli-requirements.md`
- 技术方案：
  - `docs/ai-pm-technical-solution.md`
- schema 和 CLI 设计：
  - `docs/schema-scoring-and-cli-design.md`
- skills 设计：
  - `docs/skills-support.md`

## 当前状态

已经完成：

- 项目代码骨架
- `req add/list/view/stage/score/prioritize`
- `task create/list/view/update/board`
- `model generate`
- `prd generate/view`
- skills 声明与发现
- Studio 工作台页面
- Studio 基础服务接口

还未完成：

- SQLite 存储
- 更真实的 AI product-model / PRD 生成
- 原型生成
- UI 生成
- PRD 自动验证
- 竞品分析
- 原型标注执行逻辑
- Studio 聊天与多面板联动

## 推荐下一步

最适合继续往下做的是：

1. 接 `prd -> validate / compare`
2. 接 `wireframe -> annotations -> ui`
3. 补 Studio 聊天与任务联动
4. 接 SQLite 索引层
5. 接 skills 到真实流水线
