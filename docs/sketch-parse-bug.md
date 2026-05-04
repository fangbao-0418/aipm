你这个对比图非常典型，我直接帮你“对症下药”，不是泛讲，而是**逐块指出你现在少解析了什么**。

***

# 一、先给你结论（最关键）

> 👉 你现在不是“解析少了一点”\
> 👉 而是**只还原了布局框（frame/rect），没还原内容层（text / icon / fill / style）**

***

# 二、从你这两张图看差异（逐块拆）

***

## ① 标题没了（Ico → Icon）

👉 Sketch 有文本\
👉 你解析后没显示

### 说明你缺了：

```
❌ Text 解析（核心缺失）

```

你应该解析：

```
layer._class === "text"
↓
attributedString.string
↓
字体 / 颜色 / 对齐

```

***

## ② 上面一排“圆角标签”变黑块

👉 原图是：

```
多个按钮（带文字）

```

👉 你现在变成：

```
纯黑矩形

```

***

### 说明你缺了：

```
❌ 文本内容（Text）
❌ 填充颜色解析错误（fill）
❌ 圆角解析（radius）

```

你现在只渲染了：

```
rect + 黑色 fill

```

***

## ③ icon 全没了（最关键）

👉 原图是：

```
iconfont / SVG icon

```

👉 你现在：

```
全部消失 ❌

```

***

### 说明你缺了：

```
❌ Text(iconfont) 没解析
或
❌ Vector / ShapePath 没解析

```

***

### 这块可能有两种情况：

#### 情况1：iconfont

```
Text + fontFamily=iconfont + unicode

```

👉 你没加载字体 → 不显示

***

#### 情况2：矢量图

```
shapePath / shapeGroup

```

👉 你没解析 path → 不显示

***

👉 这块是你当前最大缺口

***

## ④ 中间大黑块（应该是图片 / 内容区）

👉 原图：

```
内容卡片（可能有背景、阴影）

```

👉 你现在：

```
纯黑块

```

***

### 说明你缺了：

```
❌ fill.image（背景图）
❌ gradient（渐变）
❌ shadow（阴影）

```

***

## ⑤ 分割线丢失

👉 原图：

```
细线

```

👉 你没有

***

### 说明你缺：

```
❌ border / line 解析

```

***

## ⑥ 间距明显不对

👉 原图：

```
有 padding / spacing

```

👉 你现在：

```
元素挤在一起

```

***

### 说明你缺：

```
❌ group / frame 内部布局偏移处理
❌ 子元素 y 坐标计算问题

```

***

# 三、你当前实现状态（判断）

从效果来看你现在做了：

```
✅ frame
✅ group
✅ x / y / width / height

```

但没做：

```
❌ text
❌ image
❌ vector
❌ style（fill/border/shadow）
❌ symbol

```

***

# 四、你缺的核心模块（按优先级）

我帮你排个必须补的顺序👇

***

# P0（不做就完全不像）

```
1. Text（必须）
2. fill.color（颜色）
3. border（线）
4. radius（圆角）

```

***

# P1（你现在最大问题）

```
5. icon（两种）：
   - iconfont（Text）
   - vector（shapePath）

```

***

# P2（提升质感）

```
6. shadow
7. gradient
8. image（bitmap + fill.image）

```

***

# P3（细节）

```
9. mask
10. symbol override

```

***

# 五、你这张图“最关键缺的3个点”

我直接帮你定死👇

***

## 🔴 1. Text 没解析（最严重）

导致：

```
标题没了
按钮没文字
iconfont 不显示

```

***

## 🔴 2. Vector / Icon 没解析

导致：

```
所有 icon 消失

```

***

## 🔴 3. Style 解析不完整

导致：

```
全部变黑块

```

***

# 六、你下一步应该怎么补（非常具体）

***

## Step 1：先补 Text

```
if (layer._class === "text") {
  return convertText(layer);
}

```

***

## Step 2：补 fill.color

```
backgroundColor = parseSketchColor(fill.color)

```

***

## Step 3：补 radius

```
borderRadius = layer.fixedRadius || layer.cornerRadius

```

***

## Step 4：补 icon（关键）

***

### 如果是 iconfont：

```
fontFamily === "iconfont"
→ 加载字体

```

***

### 如果是 vector：

```
shapePath → SVG path

```

***

## Step 5：补 image

```
fill.image._ref → URL

```

***

# 七、一句话总结

> 👉 你现在只还原了“盒子”，没还原“内容”\
> 👉 核心缺：Text + Icon + Style

***
