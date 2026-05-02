下面是一份**可直接进入开发的 PRD（第一阶段：需求点整理）+ 交互说明**。\
目标：**用 Notion 的表格交互做编辑，用 XMind 的效果做思维导图展示**，且两者**同源数据、实时同步**。

***

# 📄 PRD v1.0 —— 需求点整理（AIPM Stage-1）

## 1. 产品目标

**一句话：**\
把“模糊想法/原始材料”沉淀为**结构化需求点（表格）**，并可**一键切换为思维导图**理解结构。

**成功标准：**

- 10 分钟内，从 0 → ≥30 条清晰需求点
- 用户 80% 操作无需鼠标（键盘优先）
- 表格与思维导图切换延迟 < 100ms

**非目标（本阶段不做）：**

- PRD生成、流程图生成
- 自动结构优化（AI仅辅助，不自动改写）

***

## 2. 核心设计原则

1. **单一数据源（SSOT）**

> 表格（Requirements Table）是唯一数据源；树/思维导图均为派生视图。

1. **输入优先（Capture First）**

> 先快录入，再慢整理；任何操作不打断输入流。

1. **键盘优先（Keyboard First）**

> Enter/Tab/快捷键覆盖 80%操作。

1. **弱AI（Human-in-the-loop）**

> AI仅“建议/优化”，不自动改动数据。

***

## 3. 数据模型（后端 & 前端一致）

### 3.1 Requirement

```
{
  "id": "r1",
  "title": "护理员接单",
  "description": "护理员可查看并接收订单",
  "status": "pending",          // pending | confirmed | rejected
  "priority": "P1",             // P0 | P1 | P2
  "module": "订单模块",          // 一级分组（可选）
  "parent_id": "r2",            // 树结构（可空）
  "order": 1,                   // 同级排序
  "type": "feature",            // feature | flow | rule（可选）
  "tags": ["护理员"],            // 多标签
  "source": "manual",           // manual | ai | file
  "confidence": "manual",       // manual | ai | reviewed
  "created_at": "",
  "updated_at": ""
}

```

### 3.2 RawMaterial（只读）

```
{
  "id": "rm1",
  "type": "text|pdf|docx|xlsx",
  "content": "...",
  "created_at": ""
}

```

### 3.3 关键约束

- `id` 唯一、稳定
- `parent_id` 仅允许指向同项目内节点（禁止循环）
- 同一父节点下 `order` 唯一（用于排序）
- 删除父节点时，子节点策略：**默认提升一层**（可配置）

***

## 4. 信息架构（IA）

```
顶部：项目名 + 保存状态 + 搜索/筛选 + 新建
左侧：视图切换（表格｜树｜思维导图）
中间：主内容区（表格/树/导图）
右侧：详情面板（字段编辑）
底部：批量操作浮层（多选时）

```

***

## 5. 功能模块

### 5.1 表格视图（核心）

**字段列（默认可见）：**

- Title（标题，主编辑列）
- Description（描述）
- Status（状态）
- Priority（优先级）
- Module（模块）
- Tags（标签）
- Updated\_at（更新时间）

> 高级字段（type / source / confidence）默认隐藏，可在列设置中开启

***

### 5.2 树视图（结构整理）

- 基于 `parent_id` 渲染层级
- 支持拖拽调整层级（改变 `parent_id`）
- 支持缩进/提升（Tab / Shift+Tab）

***

### 5.3 思维导图视图（XMind 风格）

- **放射状（Radial）布局**：root 在中心，一级节点向四周展开
- 节点样式：圆角矩形 + 轻配色（按 module 或 priority 着色）
- 连线：曲线（Bezier），子节点等距分布
- 仅用于**查看与轻交互**（点击高亮、定位表格），**不做复杂编辑**

***

### 5.4 快速输入（顶栏）

- 单行/多行输入框
- Enter 生成一条；粘贴多行自动拆分
- 解析分隔符（逗号、顿号、换行）自动切分

***

### 5.5 搜索与筛选

- 全文搜索（title + description）
- 多条件筛选（status/priority/module/tags）
- 组合为 AND 逻辑

***

### 5.6 批量操作

- 多选（Ctrl/Shift/A）
- 操作：删除 / 改状态 / 改优先级 / 设为同一父节点 / 合并

**合并规则：**

- 保留第一条为主
- `title` 取主；`description` 拼接其余
- 其余记录删除（支持撤销）

***

### 5.7 撤销/重做

- Ctrl+Z / Ctrl+Shift+Z
- 覆盖：新增、编辑、删除、拖拽、合并

***

### 5.8 保存策略

- 字段编辑：500ms debounce 自动保存
- 批量/拖拽：立即保存
- 顶部状态：Saving… / ✔ Saved / ❌ Error（可重试）

***

## 6. 交互说明（逐条可实现）

### 6.1 表格编辑（单元格级）

**进入编辑：**

- 双击 / Enter / 直接输入

**编辑中：**

- Enter：保存并**下移**
- Tab：保存并**右移**
- Shift+Enter：换行（description）
- Ctrl+Enter：保存不移动
- Esc：取消

**离开编辑：**

- 点击他处 / 滚动：自动保存

***

### 6.2 快速录入（高频路径）

- 光标在最后一行，输入标题 + Enter：
  1. 保存当前行
  2. **新增下一行**
  3. 光标聚焦 Title
- 多行粘贴：
  - 每行生成一条记录
  - 若为表格（Excel），按列映射填充

***

### 6.3 行选择与批量

- Click：单选
- Shift+Click：区间
- Ctrl+Click：多选
- Ctrl+A：全选

**多选浮层出现：**

- 删除｜改状态｜改优先级｜设为子节点｜合并

***

### 6.4 拖拽（排序 & 层级）

- **上下拖拽**：改变同级 `order`
- **左右拖拽（或 Tab/Shift+Tab）**：
  - 右移：成为上一行的子节点（`parent_id = 上一行.id`）
  - 左移：提升一层（`parent_id = 父.parent_id`）

**视觉反馈：**

- 插入线（水平）
- 层级指示（缩进辅助线）

***

### 6.5 右侧详情面板

- 打开：点击行 / Space
- 字段：title / description / status / priority / module / tags / source(只读)
- 自动保存（500ms debounce）
- AI按钮（可选）：✨优化描述（点击才调用）

***

### 6.6 树视图交互

- 点击节点：高亮并在表格中定位（滚动到对应行）
- Enter：新建子节点
- Tab / Shift+Tab：层级调整
- 右键：新增子节点 / 删除 / 重命名

***

### 6.7 思维导图交互（XMind 风格）

- 点击节点：高亮 + 定位表格行
- 拖动画布（Pan）、滚轮缩放（Zoom）
- Hover：显示摘要（title + priority）
- 双击：**跳转到表格编辑**（不在导图内编辑）

> 第一版：**导图只读 + 轻交互**，所有编辑回到表格

***

### 6.8 搜索/筛选

- 输入即过滤（300ms debounce）
- 标签/优先级/状态多选筛选（AND）
- 清空按钮一键恢复

***

### 6.9 删除与撤销

- 单行删除：直接删除 + Toast“已删除（Ctrl+Z 撤销）”
- 批量删除：确认弹窗（>3条）
- 所有删除均可撤销

***

### 6.10 空状态

```
暂无需求
👉 在顶部输入或粘贴需求开始
👉 或点击 “+ 新建需求”

```

***

## 7. 思维导图生成规则（与表格强绑定）

**构建树：**

1. root = `parent_id = null` 的集合（若多个，创建虚拟 root）
2. 递归 children：`child.parent_id == current.id`
3. 同级按 `order` 排序

**节点映射：**

- 文本：`title`
- 颜色（可选）：按 `module` 或 `priority`
- Tooltip：`description`

**Mermaid（开发调试用）示例：**

```
mindmap
  root((护理系统))
    订单模块
      护理员接单
      状态流转
    护理计划
      制定计划

```

> 生产环境建议用 Canvas/SVG 实现放射布局（比 Mermaid 更接近 XMind 体验）

***

## 8. API 设计（最小集）

```
GET    /api/requirements?search=&status=&priority=&module=&tags=
POST   /api/requirements
PUT    /api/requirements/{id}
DELETE /api/requirements/{id}

POST   /api/requirements/batch   // 批量：delete/update/merge
POST   /api/requirements/reorder // 拖拽排序与层级变更（提交 {id, parent_id, order}[]）

```

***

## 9. 性能与技术要求

- 表格：虚拟滚动（1000+ 行流畅）
- 编辑响应：< 100ms
- 保存：< 300ms
- 导图：Canvas/SVG，支持平移/缩放，首屏 < 200ms

***

## 10. 开发拆解（可直接排期）

**前端**

- Table（虚拟列表 + inline 编辑 + 键盘交互）
- SidePanel（详情面板）
- TreeView（层级渲染 + 拖拽/缩进）
- Mindmap（放射布局 + 交互）
- Toolbar（快速输入 / 搜索 / 筛选 / 批量浮层）

**后端**

- Requirement CRUD
- 批量接口（merge/update）
- Reorder（层级+排序）
- SQLite schema + 索引（parent\_id, order, updated\_at）

***

## 11. 体验目标（最终验收）

```
像 Excel 一样快速录入，
像 Notion 一样顺手整理，
像 XMind 一样直观理解结构。

```

***

