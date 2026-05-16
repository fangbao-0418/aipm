# AI Design Agent 固定执行管线方案

## 目标

屏幕下方 AI Agent 不是单个聊天生成器，而是一个固定执行管线：

```text
用户输入
-> 负责人 Agent 路由
-> 产品经理 Agent 需求建模
-> UI Designer Agent 设计语义稿
-> Schema Agent 输出 layoutIntent
-> Validator 校验页面模式和最低结构
-> Component / Platform Compiler 编译
-> Layout Runtime 测量和 Reflow
-> Schema Executor 落盘
-> Screenshot Critic 视觉审核
-> Intent Patch 局部修复
-> 负责人 Agent 汇总结果
```

核心原则：

- AI 不直接生成最终坐标稿。
- 产品经理 Agent 不能省略，负责把用户需求变成业务和页面约束。
- UI Designer 负责结构、风格和组件选择。
- Compiler / Runtime 负责稳定布局。
- Validator / Critic 负责拦截和修复，不让错误稿直接落给用户。

## 角色职责

### 负责人 Agent

职责：

- 判断任务类型：新建 UI、修改当前 UI、插入组件、调整布局、解释问题。
- 决定是否需要当前画布 schema、组件库、截图或产品上下文。
- 调度后续 Agent 和工具。
- 失败时决定重试、局部 patch，还是停止并说明原因。

输入：

```json
{
  "userRequest": "string",
  "currentCanvasSummary": "optional",
  "recentMessages": []
}
```

输出：

```json
{
  "taskType": "create_new_ui | edit_existing_ui | insert_component | layout_fix | answer",
  "reason": "string",
  "steps": []
}
```

### 产品经理 Agent

职责：

- 提取业务对象、目标用户、页面目标、关键字段、状态、操作、流程。
- 判断是否缺少关键需求；能合理推断就推断，不能推断才提问。
- 禁止臆测业务对象：用户没说订单，就不能补订单；用户没说商品，就不能补商品。
- 产出页面模式建议和最低验收标准。

输入：

```json
{
  "userRequest": "string",
  "projectContext": "optional",
  "currentCanvasSummary": "optional"
}
```

输出：

```json
{
  "businessDomain": "string",
  "entities": ["string"],
  "pageGoals": ["string"],
  "fields": ["string"],
  "states": ["string"],
  "actions": ["string"],
  "flows": ["string"],
  "pageModeHints": ["collection | detail | form | dashboard | auth | settings | flow"],
  "acceptanceCriteria": ["string"],
  "forbiddenAssumptions": ["string"]
}
```

### UI Designer Agent

职责：

- 基于产品经理输出，选择页面信息架构和组件族。
- 参考本地组件库风格，但不是创建组件库。
- 输出可组合 UI DSL / layoutIntent 设计方案，不输出最终坐标。

输入：

```json
{
  "productBrief": {},
  "componentLibrarySummary": [],
  "platform": "pc_web | mobile_app | wechat_mini_program | h5"
}
```

输出：

```json
{
  "pageSpecs": [
    {
      "name": "string",
      "mode": "collection | detail | form | dashboard | auth | settings | flow",
      "layout": "singleColumn | twoColumn | masterDetail | dashboard | form | table | cards",
      "keyBlocks": ["string"],
      "componentFamilies": ["navigation | form | list | detail | action | feedback"],
      "styleIntent": {
        "density": "compact | comfortable | spacious",
        "tone": "default | primary | muted"
      }
    }
  ]
}
```

### Schema Agent

职责：

- 把 UI Designer 的设计语义稿转成 `aipm.design.schema.v1`。
- 必须优先输出 `artboard.layoutIntent`。
- 可以使用 `Repeat`、`DescriptionList`、`Form`、`Table`、`CardList/Grid` 等语义组件。
- 不允许返回半截对象，比如只有 `sections`、`children`、`components`。

标准输出：

```json
{
  "schemaVersion": "aipm.design.schema.v1",
  "intent": "string",
  "platform": "web | mobile_app",
  "artboards": [
    {
      "refId": "string",
      "name": "string",
      "width": 1440,
      "height": 1024,
      "layoutIntent": {
        "type": "Page",
        "children": []
      },
      "nodes": []
    }
  ]
}
```

### Validator

职责：

- 判断页面模式是否匹配。
- 检查最低结构。
- 检查是否混入未要求的业务对象。
- 检查是否退回 legacy nodes 或半截 schema。

页面模式最低结构：

| Mode | 最低结构 | 禁止项 |
| --- | --- | --- |
| `collection` | Toolbar + Table/CardList/Grid + 主操作或状态反馈 | 无用户要求时禁止臆测业务对象 |
| `detail` | Toolbar + DescriptionList/Panel/Form + 关键状态或操作 | 默认禁止 Table/FilterBar/Pagination |
| `form` | Form + 至少 2 个 Field/Input/Select/Upload + ActionBar | 禁止列表页结构 |
| `dashboard` | MetricGroup + Chart/Card/Grid + 时间或状态信息 | 禁止空白大面板 |
| `auth` | 标题 + 表单字段 + 主按钮 + 辅助入口 | 禁止后台表格 |
| `settings` | 分组导航或 Section + Form/Toggle/ListItem | 禁止无分组堆字段 |
| `flow` | Steps/Timeline + 当前步骤内容 + ActionBar | 禁止只有静态说明 |

### Component / Platform Compiler

职责：

- 按组件族编译，不按业务模板编译。
- 同一 intent 按平台走不同 renderer。

组件族：

- `navigation`：NavBar、Breadcrumb、Tabs、TabBar、SideNav。
- `form`：FormItem、Input、Select、DatePicker、Upload、RadioGroup、CheckboxGroup。
- `list`：Table、CardList、ListItem、Pagination、EmptyState。
- `detail`：DescriptionList、StatusTag、Timeline、ImageGallery。
- `action`：ActionBar、ButtonGroup、MoreMenu。
- `feedback`：Alert、Toast、Modal、Drawer、Loading。

平台差异：

| Platform | Renderer 原则 |
| --- | --- |
| `pc_web` | Ant Design / SaaS 密度，支持双列、表格、顶部工具栏 |
| `mobile_app` | 单列卡片、44px 控件、底部主按钮、安全区 |
| `wechat_mini_program` | 小程序导航、单列表单、轻卡片、底部安全区 |
| `h5` | 移动端单列，视觉更轻，减少复杂嵌套 |

### Layout Runtime

职责：

- 根据 layoutIntent 计算槽位。
- 测量文本和控件实际尺寸。
- 二次 reflow，避免重叠、截断、越界。
- 支持 `singleColumn`、`twoColumn`、`masterDetail`、`dashboard`、`cards`。

输入：

```json
{
  "layoutIntent": {},
  "platformProfile": {},
  "styleTokens": {}
}
```

输出：

```json
{
  "nodes": [],
  "diagnostics": []
}
```

### Screenshot Critic

职责：

- 基于截图审核视觉质量。
- 不只给评价，要输出可执行修复意图。

输出：

```json
{
  "pass": false,
  "findings": [
    {
      "type": "overlap | clipped | wrong_mode | weak_hierarchy | bad_spacing",
      "target": "string",
      "severity": "low | medium | high",
      "suggestedPatch": {
        "operation": "reflow | set_gap | move_section | remove_section | change_layout",
        "target": "string",
        "value": {}
      }
    }
  ]
}
```

### Intent Patch

职责：

- 把 Critic 的问题转成局部修改。
- 优先 patch layoutIntent 或语义结构，不整页重生。

支持操作：

- `reflow`
- `set_gap`
- `move_section`
- `change_layout`
- `add_form_field`
- `add_table_column`
- `remove_irrelevant_section`
- `convert_table_to_card_list`
- `normalize_action_bar`

## 固定执行流程

### 新建 UI

```text
1. 负责人 Agent 判断 create_new_ui。
2. 产品经理 Agent 输出 productBrief。
3. UI Designer Agent 输出 pageSpecs。
4. Schema Agent 输出 schemaDraft.artboards[].layoutIntent。
5. Validator 校验页面模式和最低结构。
6. Compiler + Layout Runtime 生成 nodes。
7. Schema Executor 追加到当前画布右侧。
8. Screenshot Critic 截图审核。
9. 如果失败，生成 Intent Patch 并局部修复。
10. 负责人 Agent 汇总结果。
```

### 修改现有 UI

```text
1. 负责人 Agent 判断 edit_existing_ui。
2. 读取当前页面 schema。
3. 产品经理 Agent 判断修改是否影响业务语义。
4. UI Designer Agent 给出修改意图。
5. Intent Patch 修改局部结构或布局。
6. Validator + Screenshot Critic 校验。
```

## 失败处理

### schemaDraft 缺失 artboards

处理：

- 如果输入是 `pageSpecs/pages/screens/sections/components/children/content`，归一化成 artboards。
- 如果是 `{}` 或空 schemaDraft，丢弃并重新调用 Schema Agent。
- 错误信息必须包含顶层 keys，方便继续补兼容。

### 页面模式混乱

处理：

- `detail` 混入 `Table/FilterBar/Pagination`，阻断落盘。
- `form` 缺少字段或 ActionBar，要求 Schema Agent 修复。
- `collection` 缺少列表内容，阻断落盘。

### 视觉审核失败

处理：

- 先转 Intent Patch。
- patch 后再次截图审核。
- 连续两次失败再重生该页面，不重生已通过页面。

## 近期实现顺序

1. Page Mode Classifier + 产品经理 Agent 输出 `productBrief`。
2. Minimum Structure Validator。
3. Component Family Renderer 扩展。
4. Platform Renderer 分层。
5. Layout Runtime 二次测量 / Reflow。
6. Screenshot Critic -> Intent Patch 自动修复。




先解决 **UI 不标准问题**，再补 task 能力。

原因很直接：现在截图里暴露的是 Runtime/Renderer 的基础质量问题，不是任务编排文档问题。比如右侧文字竖排、内容越界、卡片高度不够、按钮/字段位置乱，这些就算 task 管线再完整，最后还是会被同一个布局 runtime 生成坏稿。

当前优先级应该是：

1. **Layout Runtime 二次测量/Reflow**
   先解决文字宽高、换行、高度撑开、容器裁剪、右侧越界。

2. **移动端 Renderer 补齐**
   这个图明显是移动端/小程序详情页，但 renderer 还像在用通用 PC/卡片规则。要补移动端 `Detail / FormItem / ActionBar / ListItem` 的渲染规则。

3. **Validator 加硬规则**
   生成后如果出现：
   - text 超出父容器
   - 文字竖排
   - 节点越出画板
   - 卡片内容超过卡片高度
   就不应该进入“第三次修复还失败”的循环，而是直接走结构级 reflow。

4. **Critic -> Patch**
   现在审核发现问题，但修复动作不够精准。应该把“竖排文字/越界/高度不足”转成明确 patch，而不是泛泛 reflow 72 个节点。

所以顺序是：

```text
先把生成结果稳定到可用
-> 再补 task 管线和 PM/UI/Schema 协议
```

如果继续补 task，容易变成“流程更完整，但每一步都产出坏 UI”。现在先修 renderer/runtime，收益最大。 

Critic -> Patch 精准化
现在已经能把一些问题转 reflow，但还不够细。下一步要让它区分：

竖排文本 -> 扩宽文本/改上下布局
卡片内容溢出 -> 撑高父容器
移动端表格 -> 转 CardList
按钮偏 -> normalize action bar




接下来做 契约驱动的修复 Patch。

现在生成链路已经能输出契约，Validator 也按契约检查了。下一步要把“契约检查失败”变成明确修复动作，而不是重新生成或停掉。

优先做这几个 patch：

add_required_region
Validator 发现缺 Header / Summary / DescriptionList / Form / ActionBar / Table / Pagination 时，自动补对应区域。

remove_forbidden_region
比如 pageMode=detail 但出现 FilterBar / Table / Pagination，直接移除这些区块，而不是重生整页。

change_page_contract
当 UI 设计计划和实际需求不一致时，允许负责人 Agent 修正契约，比如把误判的 flow 改成 detail。

Schema Agent prompt 加强
明确告诉它：如果 Validator 返回“契约要求 X”，下一轮必须补 X，不要重写已有页面。

建议先做第 1 个：add_required_region。
这是最重要的，因为它能把“页面不完整”从阻塞失败变成局部补齐。

我建议选 **Sketch 识别 + 半强 Renderer**，不要二选一。

也就是：

`Sketch 导入样本 -> 提炼 StyleProfile / ComponentPattern / LayoutPattern -> AI 生成 layoutRecipe -> 半强 Renderer 渲染`

原因很直接：

纯 **强 Renderer**：
- 优点：稳定、不会乱、容易过校验
- 缺点：模板味重，灵活性差，代码量会越来越大

纯 **Sketch AI 识别生成**：
- 优点：更贴近用户已有设计，风格更灵活
- 缺点：如果直接让 AI 从 schema/截图生成节点，还是会出现乱布局、占位、越界

组合方案最好：

- **Sketch 负责风格来源**
  圆角、颜色、字号、间距、按钮样式、输入框样式、卡片密度从导入稿提炼。

- **AI 负责结构创意**
  判断订单详情页需要哪些区块、字段怎么组织、哪些信息优先。

- **Renderer 负责安全落地**
  把 AI 的 recipe 渲染成不重叠、不越界、可编辑的节点。

所以不是：
`AI 自由生成 UI`

而是：
`AI 生成结构 recipe，Renderer 按 Sketch 风格画出来`

我会按这个路线做：

1. 先做 `SketchStyleProfile`
   从导入后的 Sketch 页面提取颜色、字号、圆角、间距、按钮/输入框/卡片样式。

2. 做 `PatternExtractor`
   识别页面里的 Button、FormItem、Card、NavBar、ActionBar、Table/List 等组件模式。

3. 做 `layoutRecipe`
   AI 输出页面模式、业务实体、区块列表、字段列表、区块顺序。

4. 做半强 Renderer
   先支持 `detail / form / collection`，但样式从 Sketch profile 来。

5. 做质量门禁
   没有有效 profile 时用默认设计系统；profile 有异常时降级，不让坏样式污染生成。

这条路既不会完全写死，也不会继续让 AI 乱画。


接下来建议做 **“模板从提示参考升级成确定性约束”**。现在模板已经能框选创建，也能进 Agent 上下文，但它主要还是影响模型输出，确定性不够，所以效果会飘。

优先顺序我建议这样：

1. **Template Matcher**
   生成前根据用户需求匹配最合适的页面模板：页面类型、平台、关键词、尺寸、结构摘要、StyleProfile。  
   不要让模型自己“感觉参考哪个”。

2. **Template Contract**
   从模板提炼出硬约束：画板尺寸、主容器宽度、背景色、区块顺序、基础间距、圆角、按钮风格、输入框风格。  
   Agent 只能在这些约束里生成内容。

3. **Compiler 接入模板 StyleProfile**
   现在 prompt 里有模板信息，但 renderer/compiler 还没有强制使用。  
   要把 `primaryColor / surface / border / radius / spacing / typography` 真正传进 UI Compiler。

4. **结构参考而不是复制节点**
   模板里识别 Header、Summary、Form、List、ActionBar、CardGroup 等区域。  
   生成新页面时沿用“结构骨架”，替换业务内容。

5. **模板预览增强**
   模板列表里显示：平台、页面类型、主色、区块结构。这样后面手动选择模板也方便。

我建议下一步先做 **Template Matcher + Template Contract**。这一步做完，AI 生成 UI 时就不是“随便参考一下模板”，而是明确拿某个模板作为页面骨架和风格来源，效果会稳定很多。



接下来不要再优先堆 Agent prompt，应该继续补 **Compiler 承接能力 + 可观测诊断**。顺序我建议这样：

1. **加 Compiler Coverage 诊断**
   编译后统计 layoutIntent 里有多少 `Text/Button/Image/DescriptionList/Grid/Card/ActionBar`，实际生成了多少对应节点。  
   如果 DescriptionList 有 6 项但只生成 1 个文本，直接报“Compiler 丢失信息”，不要让审核 Agent 继续说通过。

2. **补通用 Renderer**
   重点补这些，不写业务词：
   - `MediaBlock/ImageGallery`：主图 + 缩略图/附件/头像/证件照。
   - `KeyValue/DescriptionList`：支持横排、竖排、多列、自适应高度。
   - `ActionBar`：按钮等宽、文字居中、主次按钮、固定底部/顶部。
   - `Toolbar/Header`：标题、面包屑、右侧操作。
   - `Section/Card`：按内容撑高，而不是固定 148/180。

3. **把 Reflow 降级**
   现在 reflow 反复调整几十个节点是危险信号。  
   以后只有轻微重叠才 reflow；如果是结构缺失、节点缺失、信息缺失，直接回 Compiler 修，不走 reflow。

4. **让审核变硬规则**
   审核不能只靠模型描述截图。要检查：
   - 节点是否越界
   - 文字是否竖排
   - 文本/按钮是否互相覆盖
   - intent 里的关键文本是否真的出现在画布节点里
   - requiredRegions 是否有真实可见节点

5. **最后再优化 Agent**
   等 Compiler 能稳定承接，再让 Agent 输出更好的 intent。否则 AI 输出再完整，落画布还是会丢。

我建议下一步直接做第 1 步：**Compiler Coverage 诊断**。  
它不能补信息，但能把“到底是 AI 没给，还是 Compiler 没渲染”分清楚。现在最痛的是问题混在一起，日志还会误导你。



