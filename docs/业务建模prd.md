下面是一份**可直接进入开发的 PRD（第二阶段：业务建模）+ 交互细节**。\
范围：在已有“需求点表格 + 思维导图”的基础上，提供\*\*流程图（Flow）+ 状态机（State）\*\*的一体化建模能力（同一画布、Tab 切换、单一数据源）。

***

# 📄 PRD v2.0 —— 业务建模模块（Flow / State）

## 1. 产品目标

**一句话：**\
把“结构化需求点”加工为**可执行的业务结构（流程图 + 状态机）**，并与需求点双向联动，作为后续 PRD 的骨架。

**成功标准：**

- 从需求点到可用流程图 ≤ 10 分钟
- 流程图 → 状态机一键生成成功率 ≥ 90%
- 三者联动（需求点/流程/状态）点击定位延迟 < 100ms

**非目标（本阶段不做）：**

- 完整 PRD 自动生成（在下一阶段）
- 复杂 BPMN 全量规范（仅做必要子集）
- 导图内复杂编辑（导图主要用于查看）

***

## 2. 关键原则

1. **单一数据源（Graph）**

> Flow/State 共享一份 Graph，Tab 只是视角切换。

1. **需求点驱动（Traceable）**

> 每个节点必须可追溯到一个或多个需求点（Requirement IDs）。

1. **先 Flow 后 State**

> 默认以流程图建模，再一键生成状态机并微调。

1. **轻约束 + 可校验**

> 提供基础规则校验（环、孤立节点、非法流转等），但不阻断编辑。

***

## 3. 信息架构（IA）

```
需求点 | 思维导图 | 业务建模
                  ├─ Tab: [流程] [状态]
                  ├─ 左：需求池（可拖拽）
                  ├─ 中：画布（Canvas）
                  └─ 右：属性面板（节点/边）

```

***

## 4. 数据模型（前后端统一）

### 4.1 Graph

```
type Mode = 'flow' | 'state';

interface Graph {
  nodes: Node[];
  edges: Edge[];
  mode: Mode; // 当前视图
  version: number;
  updated_at: string;
}

```

### 4.2 Node

```
type NodeType = 'action' | 'state';

interface Node {
  id: string;
  type: NodeType;              // flow: action, state: state
  label: string;               // 展示文本
  relatedRequirementIds: string[]; // 关联需求点
  position: { x: number; y: number };
  meta?: {
    module?: string;
    priority?: 'P0' | 'P1' | 'P2';
  };
}

```

### 4.3 Edge

```
interface Edge {
  id: string;
  source: string;  // node.id
  target: string;  // node.id
  action?: string; // 仅状态机使用，如“接单/开始服务”
}

```

### 4.4 约束

- `Node.id` 唯一；`Edge.source/target` 必须存在
- 禁止将节点拖为其子孙（避免循环）——**状态机可允许回边**（如取消/驳回）
- Flow 模式不强制 `action`；State 模式边必须有 `action`

***

## 5. 视图与模式

### 5.1 Flow（流程视图）

- 节点：**动作/步骤（action）**
- 边：**顺序关系**（无 action 文本）
- 目标：表达**用户/业务路径**

### 5.2 State（状态视图）

- 节点：**状态（state）**
- 边：**状态流转（带 action）**
- 目标：表达**系统规则与允许行为**

### 5.3 切换规则

- 同一 Graph，切换 `mode`
- Flow → State：**触发转换（见 §9）**
- State → Flow：直接回显（保留原 Flow 数据快照，或从 State 逆推简化 Flow）

***

## 6. 画布（Canvas）技术选型

- **React Flow**（推荐）
  - 节点/边自定义、拖拽、缩放、连线、事件齐全
- 自动布局：**dagre**（Flow），State 可用简化布局或手动微调
- 性能：节点 ≤ 300，边 ≤ 500，交互流畅

***

## 7. 交互设计（可开发细则）

## 7.1 左侧：需求池（Requirement Panel）

- 列表展示（可搜索/筛选）
- 拖拽到画布 → 生成节点
- 拖入规则：
  - Flow：生成 `type='action'`
  - State：生成 `type='state'`（通常从 Flow 转换，不直接拖）

***

## 7.2 中间：画布（Canvas）

### 基本交互

操作

行为

拖拽空白

平移画布

滚轮

缩放

单击节点

选中（右侧面板显示）

双击节点

编辑 label

拖拽节点

改位置（更新 position）

从节点拖线

创建边（source→target）

Delete

删除选中节点/边

***

### 节点创建

**从需求池拖入：**

```
Node {
  id: genId(),
  type: 'action',
  label: requirement.title,
  relatedRequirementIds: [requirement.id],
  position: dropPosition
}

```

***

### 连线创建

```
Edge {
  id: genId(),
  source: n1.id,
  target: n2.id
}

```

- Flow：仅创建连线
- State：创建后**必须填写 action**（弹出小输入或右侧面板）

***

### 多选与批量

- Shift / 框选
- 批量移动、删除
- 批量设置（仅 State：可统一 action 模板）

***

## 7.3 右侧：属性面板（Inspector）

### Node 面板

字段：

- label（可编辑）
- relatedRequirementIds（可增删）
- module / priority（只读或同步自需求点）

操作：

- “定位需求点”（跳转表格并高亮）
- “合并节点”（合并为一个节点，合并其 requirements）

***

### Edge 面板

- Flow：仅显示 source/target
- State：
  - `action`（必填，可编辑）
  - “推荐动作”（从关联需求点抽取动词，如“接单/提交/审核”）

***

## 7.4 顶部工具栏

- 模式切换：`[流程] [状态]`
- 操作：
  - 新建节点
  - 自动布局
  - 生成状态机（仅在 Flow）
  - 校验（validate）
  - 撤销 / 重做

***

## 7.5 联动（核心价值）

### 点击节点（Flow/State）

- 高亮左侧**相关需求点**
- 高亮另一视图中的对应节点（若存在映射）

### 点击需求点（表格）

- 在画布中高亮关联节点（闪烁/描边）
- 若不存在节点：提供“快速加入流程”按钮

***

## 8. 校验规则（Validate）

触发：点击“校验”或自动提示（非阻断）

- 孤立节点（无入边且无出边）
- Flow：多起点/多终点提示（非强制）
- State：
  - 边无 `action`
  - 不可达状态
  - 终态无出口（可接受，但提示）
- 循环：
  - Flow：默认不允许（提示）
  - State：允许（用于取消/回退），但需有 action

输出：问题列表 + 点击定位

***

## 9. Flow → State 转换（核心算法）

### 9.1 规则

1. **节点映射**
   - Flow `action` 节点 → State `state` 节点（可做语义标准化：如“接单”→“已接单”）
2. **边映射**
   - Flow `A → B` → State `A --action--> B`
3. **action 来源**
   - 优先从边两端节点 label 提取动词
   - 次优从 `relatedRequirementIds` 的标题提取动词（关键词词典：接单/提交/审核/取消…）
4. **去重/合并**
   - 同名状态合并（保留一节点，合并入/出边）
5. **补充终态**
   - 若存在明显结束节点（如“完成/关闭”），标记为终态（UI弱提示）

### 9.2 API

```
POST /api/model/flow-to-state
Body: { nodes: Node[], edges: Edge[] }
Resp: { nodes: Node[], edges: Edge[] }

```

***

## 10. API 设计

```
GET    /api/graph
PUT    /api/graph              // 保存（全量或增量）

POST   /api/graph/node
PUT    /api/graph/node/{id}
DELETE /api/graph/node/{id}

POST   /api/graph/edge
PUT    /api/graph/edge/{id}
DELETE /api/graph/edge/{id}

POST   /api/model/flow-to-state
POST   /api/model/validate

```

***

## 11. 状态管理与保存

- 前端：Zustand（Graph store）+ Undo/Redo 栈
- 请求：TanStack Query（乐观更新）
- 保存策略：
  - 拖拽/连线：即时保存
  - 文本编辑：500ms debounce
- 顶部状态：Saving… / ✔ Saved / ❌ Error（重试）

***

## 12. 性能指标

- 节点 ≤ 300，边 ≤ 500：交互 < 16ms/帧
- 初次渲染 < 200ms
- 切换 Flow/State < 100ms

***

## 13. 权限与并发（可选）

- 单人编辑（v1）
- 后续：版本号 + 冲突检测（乐观锁）

***

## 14. 开发拆解（两周示例）

**前端**

- Canvas 基座（React Flow）
- Node/Edge 自定义（Action/State）
- 需求池拖拽接入
- Inspector 面板
- Flow 模式（建图/连线/删除）
- 自动布局（dagre）
- Flow→State 转换按钮 & 调用
- State 模式（action 编辑）
- 校验面板
- 三者联动（与表格）

**后端**

- Graph CRUD
- 转换接口（flow-to-state）
- 校验接口（validate）

***

## 15. 风险与对策

- **用户混淆两种视图** → 明确模式提示（画布角标：Flow/State + 简短说明）
- **数据双源** → 严格 SSOT（Graph）
- **自动转换不准确** → 提供可编辑的结果（用户微调）
- **画布复杂度上升** → 第一版限制节点类型、禁用复杂 BPMN

***

## 16. 验收用例（必须通过）

1. 从需求池拖入 5 个节点，连成一条主流程 → 成功保存
2. 点击“生成状态机” → 得到带 action 的状态图，可编辑
3. 点击任一节点 → 表格高亮对应需求点
4. 修改边的 action → 状态机规则立即生效
5. 校验能发现：孤立节点、无 action 边（State）

***

## 17. 总结

```
一套 Graph（单一数据源）
+ 一个 Canvas（React Flow）
+ 两种模式（Flow / State）
= 完整的业务建模能力

```

如果你要直接开工，我可以继续给你：

- 👉 React Flow 组件骨架（含 Node/Edge 自定义）
- 👉 Flow→State 转换函数（可用代码）
- 👉 Inspector 面板实现代码

