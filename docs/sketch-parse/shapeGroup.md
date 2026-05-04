可以。核心流程：

```text
shapeGroup
↓
读取 shapeGroup.style
↓
遍历 layers: shapePath / rectangle / oval / line
↓
每个 layer 转 SVG path
↓
根据 booleanOperation 合并
↓
输出 Vector SVG
```

---

## 1. booleanOperation 类型

常见映射：

```ts
enum BooleanOp {
  None = -1,
  Union = 0,
  Subtract = 1,
  Intersect = 2,
  Difference = 3,
}
```

---

## 2. 推荐实现策略

### MVP / 80% 还原

```text
Union → 多个 path 直接放一起
Subtract → 用 mask 近似
Intersect → 降级为普通 path
Difference → 降级为普通 path
```

### 高保真 / 90%+

使用布尔几何库：

```text
martinez-polygon-clipping
paper.js
flatten-js
clipper-lib
```

但是注意：这些库需要你把 SVG path 转 polygon，复杂贝塞尔曲线要先 flatten，工作量会大很多。

---

# 一、Schema 输出结构

```ts
type SvgPathNode = {
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fillRule?: "nonzero" | "evenodd";
};

type VectorNode = {
  id: string;
  type: "Vector";
  name: string;
  layout: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  svg: {
    viewBox: string;
    paths: SvgPathNode[];
    masks?: any[];
  };
  style?: any;
};
```

---

# 二、shapeGroup 转 SVG

```ts
function convertShapeGroupToSvg(layer: any): VectorNode {
  const frame = layer.frame || {};
  const width = frame.width ?? 0;
  const height = frame.height ?? 0;

  const groupStyle = parseShapeStyle(layer.style);

  const paths = (layer.layers || [])
    .map((child: any) => convertShapeLayerToPath(child, { width, height }, groupStyle))
    .filter(Boolean);

  const merged = applyBooleanOperations(paths);

  return {
    id: layer.do_objectID,
    type: "Vector",
    name: layer.name,
    layout: {
      x: frame.x ?? 0,
      y: frame.y ?? 0,
      width,
      height,
    },
    svg: {
      viewBox: `0 0 ${width} ${height}`,
      paths: merged,
    },
    style: {
      opacity: layer.style?.contextSettings?.opacity ?? 1,
    },
  };
}
```

---

# 三、子图层转 Path

```ts
function convertShapeLayerToPath(layer: any, size: any, inheritedStyle: any) {
  const style = {
    ...inheritedStyle,
    ...parseShapeStyle(layer.style),
  };

  switch (layer._class) {
    case "shapePath":
      return {
        d: shapePathToSvgD(layer, size),
        ...style,
        booleanOperation: layer.booleanOperation ?? BooleanOp.Union,
      };

    case "rectangle":
      return {
        d: rectToPath(layer, size),
        ...style,
        booleanOperation: layer.booleanOperation ?? BooleanOp.Union,
      };

    case "oval":
      return {
        d: ovalToPath(layer, size),
        ...style,
        booleanOperation: layer.booleanOperation ?? BooleanOp.Union,
      };

    case "line":
      return {
        d: lineToPath(layer, size),
        ...style,
        booleanOperation: layer.booleanOperation ?? BooleanOp.Union,
      };

    default:
      return null;
  }
}
```

---

# 四、shapePath → SVG d

```ts
function shapePathToSvgD(layer: any, size: { width: number; height: number }) {
  const points = layer.points || [];
  if (!points.length) return "";

  const first = parsePoint(points[0].point, size);
  let d = `M ${first.x} ${first.y}`;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    const prevPoint = parsePoint(prev.point, size);
    const currPoint = parsePoint(curr.point, size);

    const c1 = prev.curveFrom ? parsePoint(prev.curveFrom, size) : prevPoint;
    const c2 = curr.curveTo ? parsePoint(curr.curveTo, size) : currPoint;

    const hasCurve =
      prev.curveFrom ||
      curr.curveTo ||
      prev.hasCurveFrom ||
      curr.hasCurveTo;

    if (hasCurve) {
      d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${currPoint.x} ${currPoint.y}`;
    } else {
      d += ` L ${currPoint.x} ${currPoint.y}`;
    }
  }

  if (layer.isClosed !== false) {
    d += " Z";
  }

  return d;
}

function parsePoint(value: string, size: { width: number; height: number }) {
  const nums = value.match(/-?\d+(\.\d+)?/g)?.map(Number) || [0, 0];

  return {
    x: round(nums[0] * size.width),
    y: round(nums[1] * size.height),
  };
}

function round(n: number) {
  return Number(n.toFixed(3));
}
```

---

# 五、rectangle / oval / line 转 path

```ts
function rectToPath(layer: any, size: any) {
  const f = layer.frame || {};
  const x = f.x ?? 0;
  const y = f.y ?? 0;
  const w = f.width ?? size.width;
  const h = f.height ?? size.height;
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

function ovalToPath(layer: any, size: any) {
  const f = layer.frame || {};
  const x = f.x ?? 0;
  const y = f.y ?? 0;
  const w = f.width ?? size.width;
  const h = f.height ?? size.height;

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

function lineToPath(layer: any, size: any) {
  const f = layer.frame || {};
  const x = f.x ?? 0;
  const y = f.y ?? 0;
  const w = f.width ?? size.width;
  const h = f.height ?? size.height;

  return `M ${x} ${y} L ${x + w} ${y + h}`;
}
```

---

# 六、样式解析

```ts
function parseShapeStyle(style: any = {}) {
  return {
    fill: parseFill(style.fills),
    stroke: parseStroke(style.borders),
    strokeWidth: parseStrokeWidth(style.borders),
    strokeDasharray: parseDashArray(style.borderOptions),
    strokeLinecap: mapLineCap(style.borderOptions?.lineCapStyle),
    strokeLinejoin: mapLineJoin(style.borderOptions?.lineJoinStyle),
    opacity: style.contextSettings?.opacity ?? 1,
    filter: parseShadow(style.shadows),
  };
}

function parseFill(fills: any[] = []) {
  const fill = fills.find((f) => f.isEnabled !== false);

  if (!fill) return "none";

  if (fill.fillType === 0) {
    return parseSketchColor(fill.color);
  }

  // 渐变建议后面用 defs 实现
  if (fill.fillType === 1) {
    return parseSketchColor(fill.gradient?.stops?.[0]?.color) || "none";
  }

  return "none";
}

function parseStroke(borders: any[] = []) {
  const border = borders.find((b) => b.isEnabled !== false);
  return border ? parseSketchColor(border.color) : "none";
}

function parseStrokeWidth(borders: any[] = []) {
  const border = borders.find((b) => b.isEnabled !== false);
  return border?.thickness ?? 0;
}

function parseDashArray(borderOptions: any = {}) {
  return borderOptions.dashPattern?.length
    ? borderOptions.dashPattern.join(" ")
    : undefined;
}

function parseSketchColor(color: any) {
  if (!color) return undefined;

  const r = Math.round((color.red ?? 0) * 255);
  const g = Math.round((color.green ?? 0) * 255);
  const b = Math.round((color.blue ?? 0) * 255);
  const a = color.alpha ?? 1;

  return a >= 1
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${a})`;
}
```

---

# 七、Boolean 合并逻辑

## 1. 简化版：SVG 层面处理

```ts
function applyBooleanOperations(paths: any[]) {
  if (!paths.length) return [];

  const result: any[] = [];

  for (const path of paths) {
    const op = path.booleanOperation ?? BooleanOp.Union;

    if (op === BooleanOp.Union || op === BooleanOp.None) {
      result.push({
        ...path,
        fillRule: "nonzero",
      });
      continue;
    }

    if (op === BooleanOp.Subtract) {
      // 用 evenodd 近似：把前一个 path 和当前 path 合并成一个复合 path
      const prev = result.pop();

      if (prev) {
        result.push({
          ...prev,
          d: `${prev.d} ${path.d}`,
          fillRule: "evenodd",
        });
      }

      continue;
    }

    if (op === BooleanOp.Intersect) {
      // MVP 降级：保留当前 path
      result.push({
        ...path,
        degraded: true,
        fillRule: "nonzero",
      });
      continue;
    }

    if (op === BooleanOp.Difference) {
      // MVP 降级：使用 evenodd 近似
      const prev = result.pop();

      if (prev) {
        result.push({
          ...prev,
          d: `${prev.d} ${path.d}`,
          fillRule: "evenodd",
          degraded: true,
        });
      }

      continue;
    }
  }

  return result;
}
```

这个版本对 icon 很多场景够用，尤其是：

```text
外轮廓 - 内孔
```

比如：

```text
圆环
眼睛
搜索图标
```

---

# 八、React SVG 渲染

```tsx
function RenderVector({ node }: any) {
  return (
    <svg
      style={{
        position: "absolute",
        left: node.layout.x,
        top: node.layout.y,
        width: node.layout.width,
        height: node.layout.height,
        opacity: node.style?.opacity ?? 1,
        overflow: "visible",
      }}
      viewBox={node.svg.viewBox}
    >
      {node.svg.paths.map((p: any, index: number) => (
        <path
          key={index}
          d={p.d}
          fill={p.fill || "none"}
          fillRule={p.fillRule || "nonzero"}
          stroke={p.stroke || "none"}
          strokeWidth={p.strokeWidth || 0}
          strokeDasharray={p.strokeDasharray}
          strokeLinecap={p.strokeLinecap}
          strokeLinejoin={p.strokeLinejoin}
          opacity={p.opacity ?? 1}
          filter={p.filter}
        />
      ))}
    </svg>
  );
}
```

---

# 九、如果要真正 boolean：高保真方案

真正合并要这样做：

```text
SVG path
↓
flatten 贝塞尔曲线为 polygon
↓
martinez / clipper 做 union/subtract/intersect/xor
↓
polygon 转 SVG path
```

伪代码：

```ts
function applyBooleanHighFidelity(paths: any[]) {
  let current = pathToPolygon(paths[0].d);

  for (let i = 1; i < paths.length; i++) {
    const next = pathToPolygon(paths[i].d);

    switch (paths[i].booleanOperation) {
      case BooleanOp.Union:
        current = polygonUnion(current, next);
        break;

      case BooleanOp.Subtract:
        current = polygonSubtract(current, next);
        break;

      case BooleanOp.Intersect:
        current = polygonIntersect(current, next);
        break;

      case BooleanOp.Difference:
        current = polygonXor(current, next);
        break;
    }
  }

  return [
    {
      d: polygonToPath(current),
      fill: paths[0].fill,
      stroke: paths[0].stroke,
      strokeWidth: paths[0].strokeWidth,
    },
  ];
}
```

但这部分第一版不要硬做，复杂度很高。

---

# 十、最终建议

你的导入还原优先级：

```text
第一版：
shapeGroup → 多 path SVG
Subtract → evenodd 近似
Union → 多 path 叠加

第二版：
支持 gradient defs
支持 shadow filter
支持 mask

第三版：
引入几何布尔库做真 boolean
```

一句话：**shapeGroup 才是真正的图形，shapePath 是路径；boolean 第一版用 SVG evenodd 近似，后期再上几何布尔库。**
