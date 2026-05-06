你这个 Agent 不应该设计成“固定模板生成器”，而应该是 **需求驱动的 UI 生成 Agent**。核心是：**提示词输入 → 结构化理解 → 动态规划页面/流程 → 生成 UI Schema → 渲染 → 自检修正**。

下面是一套整理好的方案。

---

# AI UI Agent 设计方案

## 1. Agent 总目标

用户输入一段自然语言需求，例如：

```text
根据需求生成用户基础模块交互 UI 稿：
手机号验证登录/注册、微信支付宝快捷登录、个人信息管理、实名认证、地址管理……
```

Agent 应该输出：

```text
一组可渲染的 UI Schema
```

再由 Sketch 渲染器生成：

```text
多页面 UI 稿 / 交互流程稿 / 组件化设计稿
```

---

# 2. 不要让 Agent 一上来操作画布

错误方式：

```text
读取当前页面
分析表格
插入筛选区
修改 schema
```

正确方式：

```text
先判断用户要“新建 UI”还是“修改现有 UI”
```

也就是第一层必须是 **任务路由 Router**。

---

# 3. Agent 总流程

```text
User Prompt
  ↓
Router Agent：判断任务类型
  ↓
Requirement Parser：解析需求
  ↓
Product Planner：生成页面与用户流程
  ↓
UX Planner：生成交互状态
  ↓
UI Designer：生成视觉布局
  ↓
Asset Agent：处理图片 / 图标 / 素材
  ↓
Schema Generator：输出可渲染 JSON
  ↓
Renderer：生成 Sketch
  ↓
Critic Agent：截图评审与修正
```

---

# 4. Router Agent：任务路由

## 作用

判断用户是在：

```text
A. 从需求生成新 UI
B. 修改当前页面
C. 基于已有页面扩展
D. 只生成某个组件
E. 生成交互流程图
```

## 输出结构

```json
{
  "task_type": "create_new_ui",
  "requires_current_page": false,
  "target_platform": "mobile_app",
  "deliverable": "interactive_ui_draft",
  "confidence": 0.92
}
```

## 判断规则

```text
如果用户说：
“根据需求生成 UI 稿”
“帮我设计页面”
“生成交互稿”
“做一个 App 页面”
→ create_new_ui

如果用户说：
“在当前页面加一个”
“把这个按钮改成”
“修改这个页面”
“这里增加搜索条件”
→ edit_existing_ui
```

**关键约束：**

```text
只有 task_type = edit_existing_ui 时，才允许调用 page.get_schema。
```

---

# 5. Requirement Parser：需求解析

## 作用

把自然语言拆成结构化需求。

用户输入：

```text
手机号码验证登录/注册；微信或者支付宝快捷登录，一键绑定账号；
个人信息管理；实名认证；地址管理……
```

解析成：

```json
{
  "module": "用户基础模块",
  "features": [
    {
      "name": "手机号验证码登录/注册",
      "type": "auth",
      "priority": "high",
      "entities": ["手机号", "验证码", "登录", "注册"]
    },
    {
      "name": "第三方快捷登录与账号绑定",
      "type": "auth_binding",
      "priority": "high",
      "entities": ["微信", "支付宝", "绑定账号"]
    },
    {
      "name": "个人信息管理",
      "type": "profile",
      "priority": "high",
      "entities": ["头像", "昵称", "手机号", "性别", "生日"]
    },
    {
      "name": "实名认证",
      "type": "identity_verification",
      "priority": "medium",
      "entities": ["身份证正反面", "人脸识别", "账号安全"]
    },
    {
      "name": "地址管理",
      "type": "address",
      "priority": "high",
      "entities": ["地址添加", "编辑", "删除", "地图选址"]
    }
  ]
}
```

这个阶段不生成 UI，只做理解。

---

# 6. Product Planner：动态生成页面清单

不要写死页面，而是按功能生成页面。

## 生成规则

```text
每个功能域至少生成：
- 入口页
- 主操作页
- 成功/失败/空状态
- 必要的中间页
```

比如根据上面的需求，动态得到：

```json
{
  "pages": [
    {
      "id": "login",
      "name": "登录/注册页",
      "source_feature": "手机号验证码登录/注册"
    },
    {
      "id": "verify_code",
      "name": "验证码输入页",
      "source_feature": "手机号验证码登录/注册"
    },
    {
      "id": "third_party_bind",
      "name": "第三方登录绑定页",
      "source_feature": "第三方快捷登录与账号绑定"
    },
    {
      "id": "profile",
      "name": "个人信息页",
      "source_feature": "个人信息管理"
    },
    {
      "id": "identity",
      "name": "实名认证页",
      "source_feature": "实名认证"
    },
    {
      "id": "id_card_upload",
      "name": "身份证上传页",
      "source_feature": "实名认证"
    },
    {
      "id": "face_verify",
      "name": "人脸识别引导页",
      "source_feature": "实名认证"
    },
    {
      "id": "address_list",
      "name": "地址管理页",
      "source_feature": "地址管理"
    },
    {
      "id": "address_edit",
      "name": "新增/编辑地址页",
      "source_feature": "地址管理"
    },
    {
      "id": "map_pick",
      "name": "地图搜索选址页",
      "source_feature": "地址管理"
    }
  ]
}
```

注意：
这不是写死的，是根据 feature type 动态扩展。

---

# 7. UX Planner：生成交互流程

这一层负责“页面怎么跳”。

输出：

```json
{
  "flows": [
    {
      "name": "手机号登录注册流程",
      "steps": [
        "login",
        "verify_code",
        "profile"
      ]
    },
    {
      "name": "第三方登录绑定流程",
      "steps": [
        "login",
        "third_party_bind",
        "profile"
      ]
    },
    {
      "name": "实名认证流程",
      "steps": [
        "profile",
        "identity",
        "id_card_upload",
        "face_verify",
        "identity_success"
      ]
    },
    {
      "name": "地址新增流程",
      "steps": [
        "address_list",
        "address_edit",
        "map_pick",
        "address_edit",
        "address_list"
      ]
    }
  ]
}
```

同时生成状态：

```json
{
  "states": [
    "default",
    "loading",
    "empty",
    "error",
    "success",
    "disabled",
    "verified",
    "unverified"
  ]
}
```

---

# 8. UI Designer：生成布局策略

这一层不是直接画，而是决定：

```text
端类型：移动端 / Web / 平板
页面密度：低 / 中 / 高
视觉风格：简洁 / 商务 / 年轻化 / 金融 / 医疗
组件风格：卡片 / 表单 / 列表 / 步骤条
```

输出：

```json
{
  "design_direction": {
    "platform": "mobile_app",
    "canvas": {
      "width": 375,
      "height": 812
    },
    "style": "clean_modern",
    "layout": "single_column",
    "density": "medium",
    "navigation": "top_nav",
    "primary_color": "#1677FF"
  }
}
```

---

# 9. Schema Generator：生成可渲染 UI Schema

这是最终给 Sketch 的东西。

Schema 不应该只描述形状，而要描述语义组件：

```json
{
  "page_id": "login",
  "page_name": "登录/注册页",
  "canvas": {
    "width": 375,
    "height": 812
  },
  "nodes": [
    {
      "id": "title",
      "type": "text",
      "content": "手机号登录/注册",
      "x": 24,
      "y": 96,
      "w": 327,
      "h": 36,
      "style": "h1"
    },
    {
      "id": "phone_input",
      "type": "input",
      "label": "手机号",
      "placeholder": "请输入手机号",
      "keyboard": "number",
      "x": 24,
      "y": 168,
      "w": 327,
      "h": 52
    },
    {
      "id": "code_input",
      "type": "input",
      "label": "验证码",
      "placeholder": "请输入验证码",
      "suffix_action": "获取验证码",
      "x": 24,
      "y": 236,
      "w": 327,
      "h": 52
    },
    {
      "id": "login_button",
      "type": "button",
      "content": "登录 / 注册",
      "variant": "primary",
      "x": 24,
      "y": 320,
      "w": 327,
      "h": 48
    },
    {
      "id": "third_party_login",
      "type": "third_party_login_group",
      "providers": ["wechat", "alipay"],
      "x": 24,
      "y": 520,
      "w": 327,
      "h": 96
    }
  ],
  "interactions": [
    {
      "trigger": "click",
      "source": "login_button",
      "target": "profile"
    },
    {
      "trigger": "click",
      "source": "wechat_login",
      "target": "third_party_bind"
    }
  ]
}
```

---

# 10. Asset Agent：素材处理

素材不要由主 Agent 乱找，要统一经过 Asset Agent。

## 输入

```json
{
  "asset_requests": [
    {
      "type": "icon",
      "name": "wechat"
    },
    {
      "type": "icon",
      "name": "alipay"
    },
    {
      "type": "illustration",
      "query": "identity verification security"
    }
  ]
}
```

## 处理优先级

```text
1. 公司内部素材库
2. 本地图标库
3. Iconify / 开源 SVG 图标
4. Unsplash / Openverse 图片
5. AI 生成 SVG / 插画
```

## 输出

```json
{
  "assets": [
    {
      "id": "icon_wechat",
      "type": "svg",
      "source": "local_icon_library",
      "usage": "third_party_login"
    },
    {
      "id": "identity_security_illustration",
      "type": "image",
      "source": "internal_asset_library",
      "usage": "identity_page"
    }
  ]
}
```

---

# 11. Critic Agent：生成后自检

渲染后必须检查，而不是直接交付。

## 检查项

```text
1. 是否覆盖所有用户需求
2. 是否生成了正确页面
3. 是否存在无关业务，比如订单、表格、搜索区
4. 是否页面跳转完整
5. 是否有空状态、错误状态、成功状态
6. 是否布局溢出
7. 是否组件对齐
8. 是否字号、间距统一
```

## 输出

```json
{
  "requirement_coverage": {
    "手机号登录注册": "covered",
    "微信支付宝登录": "covered",
    "账号绑定": "covered",
    "个人信息管理": "covered",
    "实名认证": "covered",
    "地址管理": "covered",
    "地图选址": "covered"
  },
  "irrelevant_content": [],
  "layout_issues": [
    {
      "page": "address_edit",
      "issue": "底部按钮距离安全区过近",
      "fix": "increase_bottom_padding"
    }
  ],
  "decision": "needs_minor_fix"
}
```

---

# 12. 最关键的防跑偏机制

你现在的 Agent 跑偏，本质是没有这三道闸。

## 第一闸：任务类型闸

```text
没有明确“修改当前页面”，禁止使用页面编辑工具。
```

## 第二闸：需求一致性闸

生成计划前后都要比对关键词。

```json
{
  "required_topics": ["登录", "注册", "绑定", "个人信息", "实名认证", "地址"],
  "planned_topics": ["订单", "表格", "搜索"],
  "result": "reject"
}
```

## 第三闸：工具白名单闸

不同任务类型只能调用对应工具。

```json
{
  "create_new_ui": [
    "requirement.parse",
    "flow.generate",
    "page.generate",
    "schema.generate",
    "sketch.render",
    "ui.review"
  ],
  "edit_existing_ui": [
    "page.get_schema",
    "page.analyze_structure",
    "schema.patch",
    "sketch.render",
    "ui.review"
  ]
}
```

---

# 13. 推荐 Prompt 结构

你可以把 Agent 系统提示词拆成这样：

```text
你是一个 UI Design Agent，负责根据用户自然语言需求生成可渲染 UI Schema。

你的首要任务不是画图，而是判断任务类型。

任务类型包括：
1. create_new_ui：根据需求从零生成 UI 稿
2. edit_existing_ui：修改当前已有页面
3. extend_existing_ui：基于已有页面扩展新页面
4. generate_component：生成单个组件
5. generate_flow：生成交互流程

规则：
- 只有用户明确要求修改当前页面时，才允许读取当前页面 schema。
- 如果用户说“根据需求生成 UI 稿”，默认是 create_new_ui。
- 执行计划必须覆盖用户需求中的主要功能点。
- 禁止引入用户没有提到的业务对象。
- 如果计划中出现与需求无关的业务对象，必须重新规划。
- 输出必须是结构化 JSON。
```

---

# 14. 推荐执行计划 Prompt

```text
请根据用户需求生成执行计划。

你必须输出：
1. task_type
2. parsed_features
3. page_list
4. user_flows
5. required_states
6. asset_requests
7. schema_generation_plan
8. validation_checklist

禁止输出与用户需求无关的页面、表格、搜索区、订单列表。
如果无法判断业务类型，使用通用移动端产品设计模式，不要套用已有页面。
```

---

# 15. 这次需求的正确结果应该是

```json
{
  "task_type": "create_new_ui",
  "module": "用户基础模块",
  "platform": "mobile_app",
  "pages": [
    "登录/注册页",
    "验证码登录页",
    "第三方账号绑定页",
    "个人信息页",
    "编辑个人资料页",
    "实名认证页",
    "身份证上传页",
    "人脸识别页",
    "地址管理页",
    "新增/编辑地址页",
    "地图选址页"
  ],
  "flows": [
    "手机号登录注册流程",
    "微信支付宝快捷登录绑定流程",
    "个人信息完善流程",
    "实名认证流程",
    "地址新增编辑流程"
  ],
  "validation": {
    "must_not_include": ["订单", "表格", "搜索筛选区"],
    "must_include": ["手机号", "验证码", "微信", "支付宝", "实名认证", "地址", "地图选址"]
  }
}
```

---

# 16. 一句话设计原则

你的 Agent 要按这个原则设计：

```text
先理解需求，再规划页面，再生成 Schema，再渲染 Sketch；
不要先读画布，不要套页面编辑模板，不要让工具决定任务。
```
