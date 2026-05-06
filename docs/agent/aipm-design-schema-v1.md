# AIPM Design Schema v1

## 定位
AIPM Design Schema 是 AI Design 的中间产物协议。Agent 不能直接靠关键词模板生成 UI，而是必须先生成 `schemaDraft`，再由执行层校验、定位并写入当前画布。

## 生成链路
1. 负责人 Agent 判断任务类型和目标范围。
2. 产品经理 Agent 结构化需求。
3. UI 设计师 Agent 输出设计方案。
4. Schema Agent 输出 `aipm.design.schema.v1`。
5. Schema 执行层把 draft 追加到当前画布右侧，顶对齐，间距 40px。
6. 审核 Agent 做越界、遮挡、主操作、需求覆盖检查。

## Schema Draft
```json
{
  "schemaVersion": "aipm.design.schema.v1",
  "intent": "添加一个产品详情页",
  "platform": "web",
  "designRationale": ["为什么这样设计"],
  "artboards": [
    {
      "refId": "product-detail",
      "name": "产品详情页",
      "width": 1440,
      "height": 1024,
      "layout": "PC detail layout",
      "nodes": [
        {
          "refId": "title",
          "type": "text",
          "name": "产品标题",
          "x": 620,
          "y": 132,
          "width": 560,
          "height": 44,
          "text": "产品名称"
        }
      ]
    }
  ]
}
```

## Node 类型
- `frame`：画板或大容器。
- `container`：普通容器、图片区、地图区、状态区。
- `text`：标题、说明、标签、价格、状态文案。
- `button`：主操作、次操作。
- `input`：输入框、筛选项、表单项。
- `table`：数据表格。
- `card`：信息卡片、商品卡片、详情块。
- `image`：图片占位或资源节点。

## 坐标规则
- draft 里的节点坐标是相对所属 artboard 左上角。
- 执行层负责把 artboard 放到当前画布右侧。
- 执行层必须保证新增画板顶对齐，默认水平间距 40px。
- 节点不能越界，不能明显遮挡，不能输出负宽高。

## 关键原则
- 理解、页面规划、组件策略由 Agent 推理。
- 坐标落位、schema 校验、回滚重试由确定性执行层处理。
- 关键词规则只能作为不可用时的兜底，不能作为主生成链路。

