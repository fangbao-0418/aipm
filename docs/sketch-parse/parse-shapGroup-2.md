可以。下面这版按**生产可用**来整理，不再按 MVP 说。

# Sketch `shapeGroup` 完整解析规则

## 1. 核心原则

`shapeGroup` 必须作为一个完整矢量节点处理，不能把里面的 `shapePath` 单独提升出来渲染。

```text
shapeGroup
├─ frame            外层位置和尺寸
├─ style            整个图形的填充、描边、阴影、透明度
├─ layers           shapePath / rectangle / oval / line / nested shapeGroup
├─ booleanOperation 当前节点参与父级布尔运算的方式
```

最终输出应是：

```text
一个 shapeGroup → 一个 Vector/SVG 节点
```

---

# 2. shapeGroup 解析总流程

```text
1. 读取 shapeGroup.frame
2. 建立 SVG viewBox
3. 遍历 children
4. 每个 child 转成 path
5. 递归处理 nested shapeGroup
6. 按 Sketch 图层顺序处理 booleanOperation
7. 解析 fill / border / shadow / opacity / blur
8. 输出 SVG 节点
```

推荐结构：

```ts
type VectorNode = {
  type: "Vector";
  id: string;
  name: string;
  layout: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    flipX?: boolean;
    flipY?: boolean;
  };
  svg: {
    viewBox: string;
    paths: SvgPath[];
    defs?: SvgDefs;
  };
  style: {
    opacity?: number;
    mixBlendMode?: string;
  };
};

type SvgPath = {
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  strokeLinecap?: "butt" | "round" | "square";
  strokeLinejoin?: "miter" | "round" | "bevel";
  fillRule?: "nonzero" | "evenodd";
  opacity?: number;
  filter?: string;
};
```

---

# 3. 类型识别规则

`shapeGroup.layers` 里可能出现：

```text
shapePath
rectangle
oval
triangle
polygon
star
line
shapeGroup
```

处理规则：

```ts
function convertShapeChildToPath(child, parentFrame) {
  switch (child._class) {
    case "shapePath":
      return convertShapePath(child, parentFrame);

    case "rectangle":
      return convertRectangleToPath(child, parentFrame);

    case "oval":
      return convertOvalToPath(child, parentFrame);

    case "line":
      return convertLineToPath(child, parentFrame);

    case "triangle":
    case "polygon":
    case "star":
      return convertPresetShapeToPath(child, parentFrame);

    case "shapeGroup":
      return convertNestedShapeGroup(child, parentFrame);

    default:
      return null;
  }
}
```

---

# 4. 坐标规则

这是最容易出错的地方。

## 4.1 外层定位

`shapeGroup.frame` 决定 SVG 的外层位置：

```tsx
<svg
  style={{
    position: "absolute",
    left: group.frame.x,
    top: group.frame.y,
    width: group.frame.width,
    height: group.frame.height,
  }}
  viewBox={`0 0 ${group.frame.width} ${group.frame.height}`}
>
```

## 4.2 内部 path 坐标

`shapePath.points` 生成 SVG 内部路径，不再单独 absolute 定位。

```text
shapeGroup.frame.x/y → SVG 外层定位
shapePath.points     → SVG 内部 path 坐标
```

## 4.3 point 坐标判断

Sketch 中 `point / curveFrom / curveTo` 可能是归一化坐标，也可能已经是实际坐标。

必须判断：

```ts
function isNormalized(x: number, y: number) {
  return Math.abs(x) <= 1 && Math.abs(y) <= 1;
}

function toSvgPoint(value: string, frame: { width: number; height: number }) {
  const [x, y] = parseSketchPoint(value);

  if (isNormalized(x, y)) {
    return {
      x: x * frame.width,
      y: y * frame.height,
    };
  }

  return { x, y };
}
```

不能无脑乘 `width / height`，否则会出现飞线和巨大路径。

---

# 5. `shapePath.points` 解析规则

每个点结构通常包含：

```text
point
curveFrom
curveTo
cornerRadius
curveMode
hasCurveFrom
hasCurveTo
```

## 5.1 贝塞尔规则

从 `prev` 到 `curr`：

```text
起点：prev.point
控制点1：prev.curveFrom
控制点2：curr.curveTo
终点：curr.point
```

对应 SVG：

```text
C c1.x c1.y, c2.x c2.y, curr.x curr.y
```

实现：

```ts
function shapePathToD(layer: any, frame: { width: number; height: number }) {
  const points = layer.points || [];
  if (!points.length) return "";

  const first = toSvgPoint(points[0].point, frame);
  let d = `M ${fmt(first.x)} ${fmt(first.y)}`;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    const currPoint = toSvgPoint(curr.point, frame);
    const prevPoint = toSvgPoint(prev.point, frame);

    const c1 = prev.curveFrom
      ? toSvgPoint(prev.curveFrom, frame)
      : prevPoint;

    const c2 = curr.curveTo
      ? toSvgPoint(curr.curveTo, frame)
      : currPoint;

    const hasCurve =
      prev.hasCurveFrom ||
      curr.hasCurveTo ||
      !samePoint(c1, prevPoint) ||
      !samePoint(c2, currPoint);

    if (hasCurve) {
      d += ` C ${fmt(c1.x)} ${fmt(c1.y)}, ${fmt(c2.x)} ${fmt(c2.y)}, ${fmt(currPoint.x)} ${fmt(currPoint.y)}`;
    } else {
      d += ` L ${fmt(currPoint.x)} ${fmt(currPoint.y)}`;
    }
  }

  if (layer.isClosed !== false) {
    const last = points[points.length - 1];
    const lastPoint = toSvgPoint(last.point, frame);

    const c1 = last.curveFrom
      ? toSvgPoint(last.curveFrom, frame)
      : lastPoint;

    const c2 = points[0].curveTo
      ? toSvgPoint(points[0].curveTo, frame)
      : first;

    const hasCloseCurve =
      last.hasCurveFrom ||
      points[0].hasCurveTo ||
      !samePoint(c1, lastPoint) ||
      !samePoint(c2, first);

    if (hasCloseCurve) {
      d += ` C ${fmt(c1.x)} ${fmt(c1.y)}, ${fmt(c2.x)} ${fmt(c2.y)}, ${fmt(first.x)} ${fmt(first.y)}`;
    }

    d += " Z";
  }

  return d;
}
```

---

# 6. rectangle / oval / line 解析规则

## 6.1 Rectangle

如果是普通矩形，可以转 path：

```ts
function rectToPath(layer: any) {
  const f = layer.frame || {};
  const x = f.x || 0;
  const y = f.y || 0;
  const w = f.width || 0;
  const h = f.height || 0;

  const r = layer.fixedRadius ?? layer.cornerRadius ?? 0;

  if (!r) {
    return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
  }

  const rr = Math.min(r, w / 2, h / 2);

  return [
    `M ${x + rr} ${y}`,
    `H ${x + w - rr}`,
    `Q ${x + w} ${y} ${x + w} ${y + rr}`,
    `V ${y + h - rr}`,
    `Q ${x + w} ${y + h} ${x + w - rr} ${y + h}`,
    `H ${x + rr}`,
    `Q ${x} ${y + h} ${x} ${y + h - rr}`,
    `V ${y + rr}`,
    `Q ${x} ${y} ${x + rr} ${y}`,
    "Z",
  ].join(" ");
}
```

## 6.2 Oval

```ts
function ovalToPath(layer: any) {
  const f = layer.frame || {};
  const x = f.x || 0;
  const y = f.y || 0;
  const w = f.width || 0;
  const h = f.height || 0;

  const rx = w / 2;
  const ry = h / 2;
  const cx = x + rx;
  const cy = y + ry;

  return [
    `M ${cx - rx} ${cy}`,
    `A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy}`,
    `A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`,
    "Z",
  ].join(" ");
}
```

## 6.3 Line

```ts
function lineToPath(layer: any) {
  const f = layer.frame || {};
  return `M ${f.x || 0} ${f.y || 0} L ${(f.x || 0) + (f.width || 0)} ${(f.y || 0) + (f.height || 0)}`;
}
```

---

# 7. 样式解析规则

## 7.1 样式来源优先级

```text
1. child.style
2. shapeGroup.style
3. sharedLayerStyle resolved style
4. 默认样式
```

但常见情况是：

```text
shapeGroup.style 才是真正样式
shapePath.style 通常为空
```

实现：

```ts
function resolveShapeStyle(child: any, group: any, sharedStyles: any) {
  return deepMerge(
    resolveSharedStyle(group, sharedStyles),
    group.style || {},
    child.style || {}
  );
}
```

---

## 7.2 Fill

Sketch fill 类型：

```text
0 = solid
1 = gradient
4 = image pattern
```

完整规则：

```ts
function parseFills(fills: any[], ctx: any) {
  const enabled = (fills || []).filter(f => f.isEnabled !== false);

  return enabled.map(fill => {
    if (fill.fillType === 0) {
      return {
        type: "solid",
        value: parseColor(fill.color, fill.contextSettings?.opacity),
      };
    }

    if (fill.fillType === 1) {
      return {
        type: "gradient",
        value: parseGradient(fill.gradient),
      };
    }

    if (fill.fillType === 4) {
      return {
        type: "image",
        value: ctx.resolveImage(fill.image?._ref),
        patternFillType: fill.patternFillType,
      };
    }

    return null;
  }).filter(Boolean);
}
```

SVG 处理：

```text
solid   → fill="#xxx"
gradient → fill="url(#gradient-id)"
image   → pattern / image pattern
```

---

## 7.3 Border

```ts
function parseBorders(borders: any[], borderOptions: any) {
  return (borders || [])
    .filter(b => b.isEnabled !== false)
    .map(border => ({
      color: parseColor(border.color),
      width: border.thickness ?? 1,
      position: border.position,
      dashArray: borderOptions?.dashPattern?.join(" "),
      lineCap: mapLineCap(borderOptions?.lineCapStyle),
      lineJoin: mapLineJoin(borderOptions?.lineJoinStyle),
    }));
}
```

SVG 映射：

```text
stroke
strokeWidth
strokeDasharray
strokeLinecap
strokeLinejoin
```

注意：Sketch 的 inside / center / outside stroke 在 SVG 里不是完全等价。生产里建议：

```text
普通形状：stroke center 近似
高精度：path offset 计算
```

如果要非常准，必须用 path offset 库处理 stroke position。

---

## 7.4 Shadow

```ts
function parseShadows(shadows: any[]) {
  return (shadows || [])
    .filter(s => s.isEnabled !== false)
    .map(s => ({
      x: s.offsetX || 0,
      y: s.offsetY || 0,
      blur: s.blurRadius || 0,
      spread: s.spread || 0,
      color: parseColor(s.color),
    }));
}
```

SVG 中建议生成 filter：

```svg
<filter id="shadow-1">
  <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="rgba(...)" />
</filter>
```

多阴影需要多个 `feDropShadow`。

---

## 7.5 Opacity / Blend

```ts
function parseContext(style: any) {
  return {
    opacity: style?.contextSettings?.opacity ?? 1,
    blendMode: mapBlendMode(style?.contextSettings?.blendMode),
  };
}
```

SVG：

```text
opacity
mix-blend-mode
```

---

# 8. booleanOperation 完整规则

## 8.1 值含义

```text
-1 none       无，按 union 处理
0  union      合并
1  subtract   从当前结果中减去
2  intersect  交集
3  difference 异或
```

## 8.2 正确模型

布尔运算必须按 `shapeGroup.layers` 顺序逐步计算。

```text
result = path0
result = boolean(result, path1, path1.booleanOperation)
result = boolean(result, path2, path2.booleanOperation)
...
```

不能只判断有没有 subtract。

---

## 8.3 生产可用规则

如果要生产可用，建议分两层：

```text
渲染层快速方案：SVG combined + fillRule
几何层精确方案：Path → Polygon → Boolean → Path
```

但你要求生产可用，这里建议直接做精确方案。

## 8.4 精确 boolean 处理流程

```text
1. 每个 path d flatten 成 polygon
2. 按 layers 顺序运算
3. union/subtract/intersect/difference
4. polygon 转回 SVG path
```

可选库：

```text
martinez-polygon-clipping
clipper-lib
paper.js
flatten-js
```

算法结构：

```ts
function applyBooleanExact(paths: BooleanPath[]) {
  if (!paths.length) return [];

  let result = pathToPolygon(paths[0].d);

  for (let i = 1; i < paths.length; i++) {
    const next = pathToPolygon(paths[i].d);
    const op = paths[i].booleanOperation ?? 0;

    if (op === -1 || op === 0) {
      result = polygonUnion(result, next);
    }

    if (op === 1) {
      result = polygonSubtract(result, next);
    }

    if (op === 2) {
      result = polygonIntersect(result, next);
    }

    if (op === 3) {
      result = polygonXor(result, next);
    }
  }

  return polygonToSvgPaths(result);
}
```

## 8.5 贝塞尔 flatten

因为布尔库通常吃 polygon，不吃贝塞尔，所以要先 flatten：

```text
C cubic bezier → 采样成多段线
Q quadratic → 采样成多段线
A arc → 采样成多段线
```

```ts
function flattenCubic(p0, c1, c2, p1, segments = 16) {
  const points = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    points.push(cubicAt(p0, c1, c2, p1, t));
  }

  return points;
}
```

生产建议：

```text
简单 icon：segments 8~16
复杂大图：segments 24~32
```

---

# 9. Fill Rule / Winding 规则

Sketch 里路径方向会影响填充。

SVG 有：

```text
nonzero
evenodd
```

生产建议：

```text
无 boolean：默认 nonzero
有 subtract/difference：优先 exact boolean
无法 exact 时才用 evenodd fallback
```

不要全局强行 `evenodd`，会导致某些实心图形被挖空。

---

# 10. Nested shapeGroup 规则

必须递归。

```text
shapeGroup A
├─ shapePath
├─ shapeGroup B
│  ├─ shapePath
│  └─ shapePath
└─ shapePath
```

处理：

```ts
function resolveShapeGroupToBooleanPath(group) {
  const childPaths = [];

  for (const child of group.layers || []) {
    if (child._class === "shapeGroup") {
      const nested = resolveShapeGroupToBooleanPath(child);
      childPaths.push({
        d: nested.d,
        booleanOperation: child.booleanOperation ?? 0,
      });
    } else {
      childPaths.push(convertChildToBooleanPath(child, group.frame));
    }
  }

  return applyBooleanExact(childPaths);
}
```

---

# 11. Transform / Flip / Rotation 规则

每个 shapeGroup 可能有：

```text
rotation
isFlippedHorizontal
isFlippedVertical
```

处理策略：

```text
外层 SVG 设置 transform
内部 path 不再重复变换
```

```tsx
<svg
  style={{
    transform: `
      rotate(${rotation}deg)
      scaleX(${flipX ? -1 : 1})
      scaleY(${flipY ? -1 : 1})
    `,
  }}
>
```

如果做几何 boolean，布尔前也要把子路径 transform 应用到点坐标，否则 nested group 会错。

---

# 12. Clipping / Mask 规则

如果 `shapeGroup` 或父层有：

```text
hasClippingMask
clippingMaskMode
shouldBreakMaskChain
```

处理：

```text
矩形 mask → overflow hidden / clipPath rect
矢量 mask → SVG mask
复杂 mask → 生成 mask path
```

SVG：

```svg
<mask id="mask-x">
  <path d="..." fill="white" />
</mask>

<g mask="url(#mask-x)">
  ...
</g>
```

---

# 13. Gradients 规则

Sketch gradient 需要转 SVG defs。

```ts
function parseGradient(gradient) {
  return {
    type: gradient.gradientType,
    from: gradient.from,
    to: gradient.to,
    stops: gradient.stops.map(stop => ({
      offset: stop.position,
      color: parseColor(stop.color),
    })),
  };
}
```

SVG：

```svg
<defs>
  <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#..." />
    <stop offset="100%" stop-color="#..." />
  </linearGradient>
</defs>
<path fill="url(#g1)" />
```

---

# 14. Image Fill 规则

Sketch image fill：

```text
fill.fillType = 4
fill.image._ref
patternFillType
```

SVG 使用 pattern：

```svg
<defs>
  <pattern id="p1" patternUnits="objectBoundingBox" width="1" height="1">
    <image href="..." width="..." height="..." preserveAspectRatio="xMidYMid slice" />
  </pattern>
</defs>
<path fill="url(#p1)" />
```

---

# 15. 输出 SVG 策略

生产推荐：

```text
一个 shapeGroup → 一个 svg
一个 shapePath → 一个 path
复杂 boolean 后 → 一个或多个 path
复杂 filter / gradient / pattern → defs
```

不要：

```text
一个 shapePath → 一个独立 svg
```

---

# 16. 完整生产级伪代码

```ts
function convertShapeGroup(group, ctx) {
  const frame = group.frame;

  const rawPaths = [];

  for (const child of group.layers || []) {
    const childPath = convertShapeChild(child, group, ctx);

    if (childPath) {
      rawPaths.push(childPath);
    }
  }

  const style = resolveShapeStyle(group, ctx);

  const booleanResult = applyBooleanOperations(rawPaths, {
    exact: true,
    flattenSegments: 16,
  });

  const defs = buildSvgDefs(style, ctx);

  return {
    id: group.do_objectID,
    type: "Vector",
    name: group.name,
    layout: {
      x: frame.x || 0,
      y: frame.y || 0,
      width: frame.width || 0,
      height: frame.height || 0,
      rotation: group.rotation || 0,
      flipX: group.isFlippedHorizontal || false,
      flipY: group.isFlippedVertical || false,
    },
    svg: {
      viewBox: `0 0 ${frame.width} ${frame.height}`,
      defs,
      paths: booleanResult.paths.map(path => ({
        d: path.d,
        fill: resolveFill(style, defs),
        stroke: resolveStroke(style),
        strokeWidth: resolveStrokeWidth(style),
        strokeDasharray: resolveDash(style),
        strokeLinecap: resolveLineCap(style),
        strokeLinejoin: resolveLineJoin(style),
        opacity: style.opacity,
        filter: resolveFilter(style, defs),
        fillRule: path.fillRule || "nonzero",
      })),
    },
    style: {
      opacity: style.opacity,
      mixBlendMode: style.blendMode,
    },
  };
}
```

---

# 17. 调试规则

生产必须做导入报告：

```json
{
  "shapeGroup": {
    "total": 120,
    "exactBoolean": 87,
    "fallbackBoolean": 12,
    "unsupported": 3,
    "missingImages": 0
  }
}
```

每个 shapeGroup 记录：

```text
id
name
pathCount
hasBoolean
hasGradient
hasImageFill
hasMask
hasShadow
fallbackReason
```

否则后期无法排查。

---

# 18. 最终规则总结

```text
1. shapeGroup 是最终矢量节点
2. shapePath 只是 path 片段
3. shapeGroup.frame 定位外层 SVG
4. shapePath.points 生成内部 d
5. style 优先 shapeGroup.style
6. booleanOperation 必须按顺序逐步运算
7. union/subtract/intersect/difference 要完整支持
8. 精确 boolean 需要 path flatten + polygon boolean
9. gradient/image/shadow/filter 进入 SVG defs
10. nested shapeGroup 必须递归
11. transform 不能重复应用
12. path 顺序必须稳定
```

这套规则才是完整生产级 shapeGroup 解析规则。
