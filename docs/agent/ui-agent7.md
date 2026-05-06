你的 Agent 现在缺的不是“流式输出”，而是 **页面理解能力 + 布局决策能力 + 多 Agent 审核能力 + 工具补偿能力**。

当前失败点是：

```text
schema.find_nodes 找到 40 个节点
schema.update_node 失败：没有找到可修改的节点
直接 rollback
```

说明它虽然“找到了很多节点”，但不知道：

```text
哪个是商品列表？
哪个是表格？
搜索条件应该插在哪里？
要不要新建筛选区？
插入后布局是否会压住表格？
如果 update_node 失败，是否应该改用 add_nodes？
```

你要做的是把它从“工具执行 Agent”升级成“产品 + UI + Schema 执行 Agent”。

---

# 一、目标效果

用户输入：

```text
当前商品列表页添加搜索条件
```

理想行为应该是：

```text
1. 读取页面 schema
2. 识别当前页面是商品列表页
3. 识别表格区域
4. 判断表格上方是否已有搜索 / 筛选区域
5. 如果已有，则追加搜索字段
6. 如果没有，则在表格上方新建筛选区
7. 动态调整布局，避免遮挡或压住表格
8. 让 Product Agent 判断搜索条件是否符合业务
9. 让 UI Agent 判断布局是否美观规范
10. validate
11. review
12. 完成
```

最终不是停在：

```text
没有找到可修改节点
```

而是自动降级处理：

```text
没有找到可直接修改的筛选区，我将在表格上方新增一个搜索区域。
```

---

# 二、你现在缺的核心能力

## 1. 页面语义识别能力

不能只靠 `schema.find_nodes` 返回 40 个节点。

你需要一个工具或中间层，把 schema 转成页面语义结构。

建议新增工具：

```text
page.analyze_structure
```

返回类似：

```json
{
  "pageType": "product_list",
  "mainRegions": [
    {
      "type": "header",
      "nodeId": "node_header",
      "bbox": { "x": 0, "y": 0, "w": 1200, "h": 80 }
    },
    {
      "type": "filter_bar",
      "nodeId": "node_filter",
      "exists": false
    },
    {
      "type": "table",
      "nodeId": "node_table",
      "businessEntity": "product",
      "bbox": { "x": 24, "y": 160, "w": 1152, "h": 600 },
      "columns": ["商品名称", "价格", "库存", "状态", "操作"]
    }
  ],
  "recommendedInsertionPoints": [
    {
      "purpose": "add_search_conditions",
      "position": "above_table",
      "parentNodeId": "node_content",
      "beforeNodeId": "node_table",
      "reason": "列表页搜索条件通常放在表格上方"
    }
  ]
}
```

没有这个工具，模型只能猜。

---

## 2. 插入点决策能力

你现在的 Agent 是：

```text
find_nodes → update_node
```

但正确逻辑应该是：

```text
find search/filter area
  有 → update_node / append child
  无 → find table
       在 table 上方 add_nodes
```

需要明确规则：

```text
当用户要求给列表页添加搜索条件：
1. 优先查找已有 filter/search/form/query 条件区域
2. 如果找到，则追加字段
3. 如果没找到，则查找 table/list/datagrid
4. 在表格上方创建查询区域
5. 不允许直接修改表格节点本身
6. 不允许因为找不到可修改节点就停止
```

---

## 3. 布局重排能力

你提到“不要把表格压住，动态调整整体布局”，这非常关键。

说明你的工具不能只是：

```text
schema.add_nodes
```

还需要支持布局计算。

建议新增工具：

```text
layout.insert_above
```

它比 `schema.add_nodes` 更高阶。

参数：

```json
{
  "parentNodeId": "content_container",
  "targetNodeId": "product_table",
  "insertNode": {
    "type": "filter_form",
    "height": 96
  },
  "spacing": 16,
  "autoReflow": true
}
```

工具负责：

```text
1. 插入新节点
2. 计算高度
3. 将表格 y 坐标下移
4. 调整父容器高度
5. 避免重叠
6. 返回布局变更 diff
```

否则模型很难可靠处理布局。

---

## 4. 业务判断能力交给 Product Agent

你的想法是对的。

主 Agent 不应该自己拍脑袋决定所有业务字段，而是可以调用：

```text
product.review_requirements
```

输入：

```json
{
  "pageType": "product_list",
  "userRequest": "添加搜索条件",
  "existingColumns": ["商品名称", "价格", "库存", "状态", "操作"],
  "existingFilters": []
}
```

返回：

```json
{
  "recommendedFilters": [
    {
      "label": "商品名称",
      "component": "input",
      "placeholder": "请输入商品名称"
    },
    {
      "label": "商品分类",
      "component": "select"
    },
    {
      "label": "商品状态",
      "component": "select",
      "options": ["上架", "下架"]
    }
  ],
  "actions": ["查询", "重置"],
  "businessReview": "符合商品列表页常见检索逻辑"
}
```

这样主 Agent 负责执行，Product Agent 负责业务合理性。

---

## 5. UI 审核能力交给 UI Agent

新增：

```text
ui.review_design
```

它不只检查 schema 合法，而是检查：

```text
- 搜索区是否在表格上方
- 间距是否合理
- 是否遮挡表格
- 表单控件是否对齐
- 按钮是否在右侧或末尾
- 是否符合设计系统
- 是否过度拥挤
```

返回：

```json
{
  "passed": false,
  "issues": [
    {
      "level": "warning",
      "message": "搜索区与表格间距过小",
      "suggestedFix": {
        "tool": "layout.update_spacing",
        "params": {
          "nodeId": "filter_bar",
          "marginBottom": 16
        }
      }
    }
  ]
}
```

主 Agent 收到后继续修复，而不是直接结束。

---

# 三、推荐的 Agent 架构

建议拆成 5 层：

```text
1. Orchestrator Agent 主控 Agent
2. Page Understanding Agent 页面理解
3. Product Agent 业务判断
4. UI Agent 视觉审核
5. Schema Executor 工具执行
```

流程：

```text
用户需求
  ↓
Orchestrator Agent
  ↓
page.get_schema
  ↓
page.analyze_structure
  ↓
product.review_requirements
  ↓
layout.plan_insert
  ↓
schema / layout tools 执行
  ↓
schema.validate
  ↓
ui.review_design
  ↓
如果有问题 → 自动修复
  ↓
完成
```

---

# 四、针对这个案例的理想执行链路

用户：

```text
当前商品列表页添加搜索条件
```

Agent 应该这样执行：

```text
1. page.get_schema
2. page.analyze_structure
3. product.review_requirements
4. schema.find_nodes，查找已有搜索区
5. 如果没有搜索区：
   layout.insert_above，在商品表格上方新增搜索区
6. schema.validate
7. ui.review_design
8. 如果 UI 审核发现问题：
   layout.adjust
9. 再次 schema.validate
10. done
```

不是：

```text
find_nodes → update_node → 失败 → rollback
```

---

# 五、需要新增或增强的工具

## 必须增强

```text
page.analyze_structure
layout.insert_above
layout.reflow
schema.find_nodes_by_semantic
schema.add_child
schema.insert_before
schema.get_node_tree
ui.review_design
product.review_requirements
```

## 当前工具不足时的替代方案

如果你暂时没有布局工具，至少要让 schema.add_nodes 支持：

```json
{
  "parentNodeId": "content",
  "position": {
    "type": "before",
    "targetNodeId": "product_table"
  },
  "autoLayout": true
}
```

否则模型只能生成节点，但不能保证“不压住表格”。

---

# 六、主 Agent Prompt 可以这样写

```text
你是一个自主执行型 UI Schema Orchestrator Agent。

你的职责不是简单调用工具，而是完成用户的页面编辑目标。

当用户要求添加、修改、删除 UI 时，你必须：
1. 读取当前页面 schema
2. 分析页面结构和业务语义
3. 判断目标区域、插入位置和布局影响
4. 必要时调用 Product Agent 判断业务逻辑
5. 必要时调用 UI Agent 审核样式和布局
6. 调用 schema/layout 工具执行修改
7. 校验 schema
8. 如果失败或审核不通过，自动修复
9. 直到满足完成标准才结束

针对列表页规则：
- 搜索条件通常放在表格上方
- 如果已有搜索区，则追加搜索字段
- 如果没有搜索区，则在表格上方新增搜索区
- 不允许把搜索区插入表格内部
- 不允许遮挡或压住表格
- 新增搜索区后必须调整表格位置或容器布局
- 查询条件默认包含与当前业务实体相关的核心字段

失败处理规则：
- 如果 schema.update_node 失败，不允许直接停止
- 应切换到 schema.add_nodes、schema.insert_before 或 layout.insert_above
- 如果 find_nodes 找到多个节点，必须根据语义、位置、组件类型进行排序选择
- 如果无法确认目标节点，优先选择主内容区中的第一个业务表格
- 只有 validate 通过且 UI review 无阻塞问题，才算完成
```

---

# 七、给 Agent 一个决策策略

你需要让它知道失败后怎么走。

```text
当添加搜索条件时：

Step 1：找已有搜索区
- 关键词：search、filter、query、form、筛选、搜索、查询
- 位置：表格上方
- 组件：form、input group、toolbar

Step 2：如果找不到搜索区，找主表格
- 关键词：table、list、grid、商品、product
- 优先选择面积最大、列最多、位于主内容区的表格

Step 3：确定插入位置
- parent = 表格父容器
- position = before table
- layout = vertical stack
- marginBottom = 16

Step 4：生成搜索区
- 商品名称 input
- 商品分类 select
- 商品状态 select
- 查询按钮
- 重置按钮

Step 5：布局重排
- 插入搜索区后，表格整体下移
- 父容器高度增加
- 不允许重叠

Step 6：审核
- Product Agent 审核字段是否合理
- UI Agent 审核布局是否合理
```

---

# 八、最关键的改造点

你现在的 Agent 是：

```text
工具驱动
```

需要变成：

```text
目标驱动
```

也就是：

```text
不是“我调用了 update_node，失败了，所以结束”
而是“用户要添加搜索条件，update 失败只是一个中间失败，我要换策略继续完成”
```

---

# 九、推荐完成标准

每个任务都应该有 Done Criteria。

针对“商品列表页添加搜索条件”：

```text
1. 页面中存在商品列表表格
2. 表格上方存在搜索条件区域
3. 搜索条件包含至少 2 个以上业务相关字段
4. 有查询和重置操作
5. 搜索区没有遮挡表格
6. 页面布局没有节点重叠
7. schema.validate 通过
8. product.review 通过
9. ui.review 通过
```

---

# 十、一句话总结

你要做的是一个不断进化的多 Agent 系统：

```text
主 Agent 负责目标拆解和执行闭环
Page Agent 负责理解当前页面
Product Agent 负责判断业务是否正确
UI Agent 负责判断样式和布局是否合理
Tool 层负责真实修改 schema 和自动布局
```

最重要的是补齐这三个能力：

```text
1. page.analyze_structure：让模型知道页面上有什么
2. layout.insert_above / reflow：让模型能安全插入并重排
3. product.review + ui.review：让模型能被专业 Agent 反馈并自动修复
```
