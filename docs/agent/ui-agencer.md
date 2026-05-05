好，这一步是关键升级：从“执行型 Agent”变成**具备设计能力的多角色 Agent 系统**。

我帮你把这个 **UI设计师 Agent** 做成可以直接落地的方案（不是概念）。

---

# 🧠 一、角色定位

## UI设计师 Agent（核心职责）

> 👉 负责「怎么设计」，不是「怎么改节点」

```text
输入：用户需求 / 当前页面
输出：设计方案 + 执行策略 + UI规范
```

---

# 🧩 二、在系统中的位置

```text
用户
↓
主 Agent（调度）
↓
UI设计师 Agent  ⭐（设计决策）
↓
执行 Agent（Schema Tool / Page Tool）
↓
画布更新
```

---

# 🎯 三、UI设计师 Agent 核心能力

## 1. 需求理解（比执行 Agent 更深）

```text
用户说：做一个医疗后台

UI设计师 Agent 会理解：

行业：医疗
用户：医生 / 护士 / 管理员
风格：严肃、可信、清晰
布局：左侧导航 + 顶部状态 + 内容区
组件：表格、筛选、卡片、统计
```

---

## 2. 页面结构规划

输出：

```text
页面结构：

- Header（系统信息）
- Sidebar（菜单）
- Content
  - 筛选区
  - 表格区
  - 分页
```

---

## 3. UI规范设计（重点）

```text
颜色：
- 主色：#1677FF
- 成功：#52C41A
- 警告：#FAAD14

字体：
- 标题：16/18/20
- 正文：14

间距：
- 卡片 padding：16
- 区块间距：24

圆角：
- 组件：6
```

---

## 4. 组件选型

```text
按钮：Primary Button
列表：Table
筛选：Form + Input + Select
菜单：Sidebar Menu
```

---

## 5. 布局规划

```text
布局模式：

- 左右结构
- 左侧固定宽度 220
- 右侧自适应
- 内容区 grid 或 flex
```

---

## 6. 执行策略选择（关键）

UI Agent 不直接改 schema，而是决定：

```text
是新增页面
还是修改现有页面
是替换组件
还是局部优化
```

---

# 🔁 四、执行链路（升级版）

```text
用户输入
↓
UI设计师 Agent（设计方案）
↓
输出设计 plan
↓
执行 Agent（tool 执行）
↓
画布更新
↓
截图
↓
UI设计师 Agent（review）
↓
是否需要二次优化
```

---

# 🧱 五、UI设计师 Agent 输出格式（必须结构化）

## 示例

用户：

```text
给我一个后台页面
```

---

## UI Agent 输出

```json
{
  "designGoal": "后台管理页面",
  "style": {
    "theme": "admin",
    "primaryColor": "#1677FF",
    "background": "#F5F7FA"
  },
  "layout": {
    "type": "sidebar-layout",
    "sidebarWidth": 220
  },
  "structure": [
    {
      "type": "Header",
      "height": 56
    },
    {
      "type": "Sidebar",
      "width": 220,
      "items": ["首页", "用户管理", "订单管理"]
    },
    {
      "type": "Content",
      "children": [
        "FilterBar",
        "Table",
        "Pagination"
      ]
    }
  ],
  "components": [
    "Menu",
    "Table",
    "Form",
    "Button"
  ],
  "spacing": {
    "sectionGap": 24,
    "padding": 16
  },
  "executionStrategy": {
    "mode": "create_page",
    "reason": "当前页面为空"
  }
}
```

---

# 🛠 六、执行 Agent 接管

执行 Agent 根据这个 plan：

```text
create_page
↓
create_sidebar
↓
create_header
↓
create_table
↓
apply styles
```

---

# 🧠 七、UI Review（关键能力）

UI Agent 要具备：

```text
画布截图 → 分析 → 给优化建议
```

---

## 示例

```text
当前问题：

1. 左右间距不统一
2. 表格过密
3. 按钮不突出

优化建议：

- 增加 section 间距到 24
- 表格行高提高到 48
- 主按钮使用 primary color
```

---

# 🔧 八、UI Agent Tool

新增：

```text
analyze_layout
analyze_spacing
analyze_color
analyze_typography
review_ui
generate_design_plan
```

---

# 🧩 九、Prompt 设计（核心）

UI Agent 的 system prompt：

```text
你是一个高级 UI 设计师。

你的职责：
1. 理解用户需求（业务 + 场景）
2. 设计页面结构
3. 制定 UI 规范（颜色、字体、间距）
4. 选择合适组件
5. 输出可执行设计方案
6. 对结果进行 UI Review

你不会直接修改页面，
你只负责“设计决策”。

输出必须结构化。
```

---

# ⚙️ 十、角色分工（非常重要）

| 角色          | 职责               |
| ----------- | ---------------- |
| UI设计师 Agent | 设计、规划、规范         |
| 执行 Agent    | 调用 tool 改 schema |
| 主 Agent     | 调度               |

---

# 🚀 十一、最终能力

你这个系统会变成：

```text
用户一句话
↓
AI 设计页面
↓
AI 自动生成 UI
↓
AI 自动优化 UI
↓
用户只做微调
```

---

# 💥 十二、一句话总结

> UI设计师 Agent = 决定“做什么样的 UI”
> 执行 Agent = 负责“把 UI 做出来”

---

# 如果你要下一步（强烈建议）

我可以帮你直接做：

👉 「UI设计师 Agent Prompt + JSON 输出规范（可直接接你系统）」
👉 「设计 plan → 自动转 schema 的映射规则」
👉 「UI 自动优化规则库（类似设计规范引擎）」

这一步做完，你这个产品就不是“原型工具”，而是：

> **AI 驱动的设计系统 + 原型生成平台**
