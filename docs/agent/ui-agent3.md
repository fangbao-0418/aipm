UI Agent 不应该“独立乱跑”，而是作为 **主 Agent 的一个设计决策子 Agent** 被调用。

核心链路：

```text
用户需求
↓
主 Agent 判断任务类型
↓
如果涉及页面设计 / 排版 / 视觉 / 组件选择
↓
调用 UI Agent
↓
UI Agent 输出设计方案
↓
主 Agent 把设计方案转成执行计划
↓
执行 Agent 调用 Schema Tool 修改页面
↓
截图 / 校验
↓
UI Agent Review
↓
必要时二次调整
```

---

# 1. 主 Agent 什么时候调用 UI Agent

## 需要调用 UI Agent 的场景

```text
生成页面
优化页面
调整排版
修改风格
根据 PRD 生成 UI
根据图片生成 UI
页面不美观需要优化
组件选择不确定
业务页面结构不明确
```

例如：

```text
“帮我生成一个医疗后台首页”
“这个页面不好看，优化一下”
“左侧加菜单，中间加表格”
“根据这个 PRD 生成 UI”
```

---

# 2. 主 Agent 的判断逻辑

```ts
function shouldCallUIAgent(userInput: string) {
  return containsAny(userInput, [
    "页面",
    "UI",
    "设计",
    "排版",
    "风格",
    "布局",
    "好看",
    "原型",
    "组件",
    "后台",
    "表单",
    "表格",
  ]);
}
```

更准确可以让模型分类：

```json
{
  "taskType": "ui_design",
  "needUIAgent": true,
  "needSchemaTools": true,
  "needCanvasScreenshot": true
}
```

---

# 3. UI Agent 在流程中的位置

## 创建页面时

```text
主 Agent
↓
调用 UI Agent：生成设计方案
↓
调用执行 Agent：按方案生成 Schema
↓
渲染画布
↓
调用 UI Agent：Review 结果
```

---

## 修改页面时

```text
主 Agent
↓
读取当前页面 schema
↓
截图当前画布
↓
调用 UI Agent：分析问题 + 给修改方案
↓
执行 Agent 修改 schema
↓
再次截图
↓
UI Agent Review
```

---

# 4. UI Agent 输入什么

主 Agent 传给 UI Agent 的上下文应该包括：

```json
{
  "userRequest": "把页面改成医疗后台风格",
  "currentPageSchema": {},
  "selectedNodes": [],
  "canvasScreenshot": "base64 或 imageUrl",
  "projectInfo": {
    "productType": "AI 原型工具",
    "targetPlatform": "web"
  },
  "constraints": {
    "componentLibrary": "antd",
    "editable": true,
    "outputSchema": true
  }
}
```

---

# 5. UI Agent 输出什么

UI Agent 不直接改 schema，而是输出设计方案：

```json
{
  "designGoal": "医疗后台页面优化",
  "businessUnderstanding": "页面面向护士/管理员，需要突出任务状态和患者信息",
  "layoutPlan": {
    "type": "sidebar-dashboard",
    "areas": ["sidebar", "header", "content", "table"]
  },
  "styleGuide": {
    "primaryColor": "#1677FF",
    "background": "#F5F7FA",
    "cardRadius": 8,
    "spacing": 16,
    "fontSize": 14
  },
  "componentPlan": [
    {
      "type": "Menu",
      "position": "left",
      "reason": "后台系统需要稳定导航"
    },
    {
      "type": "Table",
      "position": "content",
      "reason": "用于展示业务数据"
    }
  ],
  "executionPlan": [
    {
      "action": "create_or_update_sidebar",
      "target": "left",
      "component": "Menu"
    },
    {
      "action": "update_content_layout",
      "component": "Table"
    }
  ]
}
```

---

# 6. 主 Agent 如何使用 UI Agent 的结果

主 Agent 不直接相信 UI Agent，而是把它转成 tool 调用计划：

```text
UI Agent 输出设计 plan
↓
主 Agent 编排为 tool steps
↓
执行 Agent 调用 schema tools
```

例如：

```json
[
  {
    "tool": "get_page_schema",
    "input": { "pageId": "current" }
  },
  {
    "tool": "create_node",
    "input": {
      "type": "Menu",
      "parentId": "root",
      "layout": { "x": 0, "y": 0, "width": 220, "height": 768 }
    }
  },
  {
    "tool": "validate_schema",
    "input": { "pageId": "current" }
  }
]
```

---

# 7. 主 Agent 调度伪代码

```ts
async function handleUserTask(input, context) {
  const task = await classifyTask(input, context);

  const plan = [];

  if (task.needCurrentSchema) {
    plan.push({
      tool: "get_page_schema",
      input: { pageId: context.currentPageId },
    });
  }

  if (task.needScreenshot) {
    plan.push({
      tool: "capture_canvas",
      input: { pageId: context.currentPageId },
    });
  }

  if (task.needUIAgent) {
    plan.push({
      agent: "ui_designer",
      input: {
        userRequest: input,
        currentPageSchema: "{{get_page_schema.result}}",
        screenshot: "{{capture_canvas.result}}",
      },
    });
  }

  plan.push({
    agent: "executor",
    input: {
      designPlan: "{{ui_designer.result}}",
    },
  });

  return executePlan(plan);
}
```

---

# 8. UI Agent 不应该做什么

```text
❌ 不直接调用 update_node
❌ 不直接修改 schema
❌ 不负责文件读写
❌ 不负责联网搜索
❌ 不负责错误兜底
```

它只负责：

```text
理解业务
判断设计方向
输出设计规划
做 UI Review
```

---

# 9. 推荐最终角色结构

```text
Main Agent
├─ UI Designer Agent
│  ├─ 需求理解
│  ├─ 页面规划
│  ├─ 视觉规范
│  └─ UI Review
│
├─ Executor Agent
│  ├─ Schema Tool
│  ├─ Page Tool
│  └─ Canvas Tool
│
├─ Research Agent
│  ├─ 联网搜索
│  └─ 素材参考
│
└─ Import Agent
   ├─ Sketch 解析
   └─ 图片转 Schema
```

---

# 10. 一句话总结

> **主 Agent 是调度者，UI Agent 是设计决策者，Executor Agent 是执行者。**

不要让 UI Agent 直接改页面。
让它先输出高质量设计方案，再由主 Agent 转成标准 tool 调用。
