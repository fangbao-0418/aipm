可以。下面是 **Sketch → Web 高还原渲染** 需要解析的完整清单。\
目标不是做低代码，而是：**导入** **`.sketch`** **后，在 Web 画布上尽可能还原视觉稿**。

Sketch 文件本质是 ZIP，内部有 JSON 文档和 bitmap 等资源；官方也维护 Sketch 文件格式 schema / TypeScript 类型，可以作为解析依据。([Sketch Developers](https://developer.sketch.com/file-format/?utm_source=chatgpt.com "Sketch Developer — File format"))

***

# Sketch 还原解析清单

## 1. 文件级结构

必须读取：

```
document.json
meta.json
user.json
workspace.json
pages/*.json
images/*
previews/*

```

重点字段：

```
document.pages
document.assets
document.layerStyles
document.layerTextStyles
document.sharedSwatches
document.foreignSymbols
document.foreignLayerStyles
document.foreignTextStyles
document.fontReferences

```

***

## 2. 页面与画板

需要解析：

```
page
artboard
symbolMaster
frame
group

```

要处理：

```
页面名称
画板名称
画板宽高
画板背景色
画板坐标
画板裁剪
画板包含的 layers

```

Web 映射：

```
Page → 页面
Artboard → Frame
SymbolMaster → 可复用素材组件
Group → Group / Container

```

***

## 3. 图层类型

必须覆盖：

```
artboard
group
symbolMaster
symbolInstance
shapeGroup
rectangle
oval
triangle
star
polygon
line
shapePath
text
bitmap
slice
hotspot

```

建议你的内部节点类型：

```
Frame
Group
Shape
Text
Image
Vector
SymbolInstance
Slice
Hotspot

```

***

## 4. 通用图层字段

每个 layer 都要解析：

```
do_objectID
name
_class
frame.x
frame.y
frame.width
frame.height
rotation
isVisible
isLocked
hasClickThrough
isFlippedHorizontal
isFlippedVertical
resizingConstraint
resizingType
shouldBreakMaskChain
hasClippingMask
clippingMaskMode
clippingMask

```

Web 映射：

```
id
name
type
x / y / width / height
transform: rotate / scaleX / scaleY
display / visibility
locked
overflow / clip / mask

```

***

## 5. 坐标系统

必须处理：

```
父子相对坐标
absolute 坐标换算
rotation 后包围盒
flip 后坐标
group 内部偏移
mask 区域影响
symbolInstance 缩放

```

Web 最简单渲染方式：

```
每个节点 position:absolute
父容器 position:relative
子节点使用相对父节点坐标

```

***

## 6. 层级顺序

必须处理：

```
layers 数组顺序
z-index
隐藏节点
锁定节点
group / frame 嵌套
symbol 展开后的层级
mask 与被裁剪节点的顺序

```

注意：Sketch 层级顺序和 Web 叠放顺序要测试，必要时反转 children 顺序。

***

## 7. Fill 填充

需要解析：

```
style.fills[]
fill.isEnabled
fill.fillType
fill.color
fill.gradient
fill.image
fill.patternFillType
fill.contextSettings.opacity

```

支持类型：

```
solid color
linear gradient
radial gradient
angular gradient
image pattern

```

Web 映射：

```
background-color
background-image: linear-gradient(...)
background-image: radial-gradient(...)
background-image: url(...)
background-size
background-position
background-repeat

```

***

## 8. Border 描边

需要解析：

```
style.borders[]
border.isEnabled
border.color
border.thickness
border.position
border.fillType
border.gradient

```

还要解析：

```
style.borderOptions.dashPattern
style.borderOptions.lineCapStyle
style.borderOptions.lineJoinStyle

```

Web 映射：

```
border
outline
box-shadow 模拟 outside/center border
SVG stroke

```

注意：复杂 shape 的描边建议走 SVG。

***

## 9. 圆角

需要解析：

```
fixedRadius
cornerRadius
points[].cornerRadius

```

不同对象处理：

```
rectangle → border-radius
shapePath → SVG path + radius
复杂矢量 → SVG

```

***

## 10. 阴影

需要解析：

```
style.shadows[]
style.innerShadows[]
shadow.isEnabled
shadow.color
shadow.offsetX
shadow.offsetY
shadow.blurRadius
shadow.spread

```

Web 映射：

```
box-shadow
filter: drop-shadow(...)
SVG filter

```

多阴影要组合成：

```
box-shadow: 0 4px 12px rgba(...), 0 1px 2px rgba(...);

```

***

## 11. Blur 模糊

需要解析：

```
style.blur
blur.isEnabled
blur.type
blur.radius
blur.motionAngle
blur.center

```

类型：

```
layer blur
background blur
motion blur
zoom blur

```

Web 映射：

```
filter: blur(...)
backdrop-filter: blur(...)

```

motion / zoom blur Web 很难 100% 还原，建议降级。

***

## 12. 透明度与混合模式

需要解析：

```
style.contextSettings.opacity
style.contextSettings.blendMode

```

Web 映射：

```
opacity
mix-blend-mode
background-blend-mode

```

注意：Sketch 和浏览器 blend mode 视觉可能不完全一致。

***

## 13. 文本内容

必须解析：

```
attributedString.string
attributedString.attributes

```

基础字段：

```
fontFamily
fontPostScriptName
fontSize
fontWeight
lineHeight
letterSpacing
paragraphSpacing
textAlign
verticalAlign
textColor
underline
strikethrough
textTransform

```

还要处理：

```
多段富文本
不同颜色
不同字号
不同字体
emoji
iconfont
缺失字体
文本固定宽高
文本自动高度
文本裁剪

```

Web 映射：

```
div/span
white-space
line-height
letter-spacing
font-family
font-size
font-weight
text-align
overflow
text-overflow

```

多段文本建议：

```
Text node
 ├ span range 1
 ├ span range 2
 └ span range 3

```

***

## 14. 字体资源

需要解析：

```
fontReferences
text layer font name
font postscript name

```

但要注意：Sketch 文件通常不内嵌字体文件，只记录字体引用。你需要：

```
检测缺失字体
提示用户上传字体
注册 @font-face
重新渲染

```

Iconfont 也是 Text：

```
fontFamily = iconfont
text = \ue600

```

没有字体文件就无法准确显示。

***

## 15. 图片资源

需要解析两种来源：

```
bitmap.image._ref
style.fills[].image._ref

```

处理流程：

```
读取 _ref
从 images 资源里取 buffer
保存到你的 assets
生成 URL
写入 schema

```

Web 渲染：

```
bitmap → <img>
pattern fill → background-image

```

还要处理：

```
图片裁剪
fill 模式
contain / cover
tile
stretch
image opacity
image tint

```

***

## 16. 矢量路径

如果想高还原，必须解析：

```
shapePath
shapeGroup.layers
points[]
point
curveFrom
curveTo
cornerRadius
curveMode
isClosed

```

Web 建议转：

```
SVG path d

```

还要处理：

```
fill-rule
stroke-linecap
stroke-linejoin
stroke-dasharray

```

***

## 17. 布尔运算

需要解析：

```
booleanOperation

```

常见：

```
union
subtract
intersect
difference

```

Web 处理方案：

```
优先转换 SVG path
复杂情况用离屏 canvas / flatten 后图片化

```

第一版可以降级为：

```
保留子 shape 叠放
或转图片

```

***

## 18. Mask / Clip

需要解析：

```
hasClippingMask
clippingMaskMode
shouldBreakMaskChain

```

Web 映射：

```
overflow:hidden
clip-path
mask-image
SVG mask

```

优先级：

```
矩形 mask → overflow:hidden
圆形 / path mask → clip-path / SVG mask
复杂 mask → 图片化

```

***

## 19. Symbol / 组件

必须解析：

```
symbolMaster
symbolInstance
symbolID
overrideValues
overrideName
overrideValue

```

Sketch 的 overrides 可覆盖文本、图片、嵌套 Symbol、颜色、文本属性、Layer Style 等。([Sketch](https://www.sketch.com/docs/symbols-and-styles/overrides/?utm_source=chatgpt.com "Overrides"))

建议处理：

```
symbolMaster → Asset
symbolInstance → Instance
overrideValues → patch 到 master schema

```

第一版策略：

```
symbolInstance 直接展开成普通节点
只处理 text override / image override

```

第二版再做：

```
AssetRef
nested override
style override
library symbol

```

***

## 20. Shared Styles

需要解析：

```
document.layerStyles
document.layerTextStyles
document.foreignLayerStyles
document.foreignTextStyles

```

用途：

```
样式复用
样式名称
样式引用
跨文件 library style

```

Web / Schema 映射：

```
styleId
styleName
resolvedStyle

```

建议导入时：

```
先 resolve 成实际样式
再保留 styleId 方便后续编辑

```

***

## 21. Swatches / Colors / Gradients

需要解析：

```
document.assets.colorAssets
document.assets.gradientAssets
document.assets.colors
document.assets.gradients
document.sharedSwatches
document.foreignSwatches

```

用途：

```
颜色变量
渐变变量
设计 Token

```

***

## 22. Library 外部资源

需要解析：

```
foreignSymbols
foreignLayerStyles
foreignTextStyles
foreignSwatches

```

问题：

```
.sketch 文件里可能只有引用
不一定有完整源内容

```

处理策略：

```
能解析则导入
不能解析则标记 missingLibraryAsset
提示用户上传依赖库

```

***

## 23. Export / Slice

需要解析：

```
exportOptions
exportFormats
slice
includedLayerIds

```

用途：

```
导入导出配置
资源切片
图片导出

```

Web 渲染不是必须，但导入设计资源时有用。

***

## 24. Prototype / Hotspot

如果需要原型还原，解析：

```
hotspot
flow
prototypeStartPoint
targetArtboardID
animationType
transition
maintainScrollPosition

```

Web 映射：

```
click area
navigate target
overlay
transition

```

第一版建议只支持：

```
hotspot → 点击区域
targetArtboardID → 页面跳转

```

***

## 25. Resizing / Constraints

需要解析：

```
resizingConstraint
resizingType

```

用途：

```
响应式 resize
artboard 尺寸变化时子元素位置

```

Web 映射：

```
constraints.horizontal
constraints.vertical

```

如果只是静态还原，可以先不生效，但要保存。

***

## 26. Grid / Layout Settings

需要解析：

```
layout
grid
horizontalRulerData
verticalRulerData

```

用途：

```
网格
栅格
参考线
标尺

```

Web 映射：

```
canvas grid overlay
guide lines

```

***

## 27. Artboard 背景

需要解析：

```
hasBackgroundColor
backgroundColor
includeBackgroundColorInExport

```

Web 映射：

```
frame background
export background

```

***

## 28. Metadata

需要解析：

```
meta.app
meta.version
meta.build
meta.pagesAndArtboards
meta.commit
compatibilityVersion

```

用途：

```
版本兼容
导入日志
错误排查
Sketch 版本提示

```

***

## 29. User / Workspace

需要解析但不是渲染核心：

```
user.json
workspace.json

```

用途：

```
视图状态
缩放
当前页面
辅助线显示状态

```

***

# 建议最终转换结构

你的中间 Schema 至少要有：

```
{
  "pages": [],
  "assets": {
    "images": [],
    "fonts": [],
    "symbols": [],
    "styles": [],
    "colors": []
  },
  "missing": {
    "fonts": [],
    "libraries": [],
    "images": []
  },
  "importReport": {
    "supported": [],
    "degraded": [],
    "unsupported": []
  }
}

```

***

# 优先级总结

## P0：没有就无法渲染

```
pages
artboards
layers
frame
visibility
group hierarchy
text
shape
bitmap
fills
borders
radius
images

```

## P1：决定高保真

```
shadows
gradients
text rich styles
symbol instance
symbol override
shared styles
mask
vector path

```

## P2：接近 100%

```
boolean operations
blend mode
background blur
library assets
prototype hotspot
export slices
constraints
grid/guides

```

## P3：可降级

```
motion blur
zoom blur
复杂 mask
复杂矢量布尔
缺失字体
外部 library symbol

```

一句话：**想高还原，解析范围必须从“layer 树”扩展到“资源、字体、Symbol、样式、矢量、Mask、Library”。**
