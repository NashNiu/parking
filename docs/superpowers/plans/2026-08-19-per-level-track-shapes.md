# 每关不同的轨道形状与通道配置 实现计划 (M7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让每关的乘客转盘换一种形状(四边形/六边形/梯形/椭圆/圆形)、换一种长度(8/12/16/20 格)、换一种通道配置(单侧或双侧、前瞻 1–3 批),并且这些差异由关卡 JSON 驱动、由测试守住。

**Architecture:** 轨道的路径几何从 `view/track-view.ts` 搬进 core 变成纯数学(`track-shapes.ts` 出轮廓,`track-path.ts` 出等弧长行走与边界),因此"圆形配 12 格行距只有 0.68、不合法"这类事由 jest 拦下而不是靠预览发现。`LoopSystem` 的固定 `left`/`right` 两条队列泛化成 1–2 条 `channels`(按排空顺序),并按**管道长度**而不是屏幕方位命名(`far`/`near`)。视图只剩画的活:接一个 `TrackPath`,缺口切在入口格自己的 t 上,通道位置与朝向从入口点的外法线推。

**Tech Stack:** TypeScript 5.4,Cocos Creator 3.8.7,jest + ts-jest(仅 core),Node 脚本做离线关卡生成。

**Spec:** [docs/superpowers/specs/2026-08-19-per-level-track-shapes-design.md](../specs/2026-08-19-per-level-track-shapes-design.md)

## Global Constraints

- 所有形状共用同一个外框:半宽 **2.6**、半高 **1.3**。不动相机、不动 HUD、不动停车场。
- 通道最外缘 ≤ **4.67**(轨道深度处的可视半宽)。
- `capacity ∈ {8, 12, 16, 20}`(必须是 4 的倍数),`boardIndex === capacity / 2`。
- 行距 = 周长 / 格数,必须落在 **[0.70, 1.90]**。
- 上车缺口是**绝对弧长 0.55**,不再随格数缩放。
- 入口点外法线 `|ny| ≤ 0.35`;形状最小曲率半径 ≥ **0.6**。
- 前瞻 ≥ 1,且 ≤ 该形状按几何算出的上限(四边形/六边形/梯形/椭圆 = 3,圆形 = 5)。
- core 里**任何文件都不许 import `cc`**,否则 jest 跑不起来。
- 载客量 `CAP_SIZE`(16/24/32)与 `levelParams` 的车数/颜色数/阻挡比例**一行不动**。
- 缺 `track` / `feeds` 字段的关卡回退到 `rect` + 远近双通道 + 前瞻 3;M6 的死局用例必须保持绿。
- 面向用户的文字用中文,代码与注释用英文。

## 文件结构

| 文件 | 职责 |
|---|---|
| `game/assets/scripts/core/track-shapes.ts`(新) | 五个轮廓的等弧长段序列。`line`/`arc`/`roundedPoly`/`ellipsePoly` 与 `buildShape(shape)`。纯数学 |
| `game/assets/scripts/core/track-path.ts`(新) | `TrackPath`(行走/法线/行距)、`entryIndex`、`maxLookahead`、`capacityOptions`、`LANE` 与各项边界常量 |
| `game/assets/scripts/core/types.ts` | 加 `TrackShape` 转出、`FeedSide`、`Feed`、`DEFAULT_TRACK`、`DEFAULT_FEEDS`;`LevelData.loop` 加两个可选字段 |
| `game/assets/scripts/core/loop-system.ts` | `left`/`right` → `channels: Channel[]`(排空顺序);入口从 `entryIndex` 来 |
| `game/assets/scripts/core/level-data.ts` | `validateLevel` 新增 7 条几何/配置规则 |
| `game/assets/scripts/core/level-gen.ts` | `TRACK_CURVE` 10 关表 + `trackParams(id)`;`assemble` 写出新字段 |
| `game/assets/scripts/core/index.ts` | 转出两个新模块 |
| `game/assets/scripts/view/track-view.ts` | 接 `TrackPath`;删掉模块级 `SEGS` 缓存;缺口按绝对弧长;通道从法线推;每侧前瞻独立 |
| `game/assets/scripts/view/GameController.ts` | 透传 `track`/`feeds`,`update(ring, channels)` |
| `logic/tests/track-shapes.test.ts`(新) | 轮廓:周长、闭合、对称、关键点 |
| `logic/tests/track-path.test.ts`(新) | 行走、法线、行距边界、前瞻上限、可用格数 |
| `logic/tests/loop-system.test.ts` | 迁移到 `channels`;新增单通道用例 |
| `logic/tests/game-core.test.ts` | 迁移死局用例到 `channels` |
| `logic/tests/level-data.test.ts` | 新增 7 条规则的拒绝用例 |
| `logic/tests/level-gen.test.ts` | 新增曲线/形状/视野断言 |

**类型闸门已就绪**:`cd logic && npm run typecheck:view`(见提交 `688b709`),视图层每次改完都要跑,当前是零错误。

---

### Task 1: 乘客 draw call 预算 (M7.A)

这一版把最重一关的行数从 18 推到 26(20 格环 + 双通道各 3 批),乘客人偶从 72 涨到 104。一个人偶现在是 **5 个 draw call**(模型导出 5 个材质角色),照这样总数会从实测 562 涨到约 720。**这个任务不通过,20 格的转盘就上不了**,所以它排在形状之前。

两条路都已确认引擎支持(`grep` 过 `C:/ProgramData/cocos/editors/Creator/3.8.7/.../builtin-standard.effect`):

- **实例化**(先试):`USE_INSTANCING` 是引擎全局宏。同一个 mesh + 同一个材质的模型会被合并成一次实例化绘制。五个角色 mesh 是烘一次全局共享的,固定角色各一个材质、`paint` 每色一个材质 —— 理论上全部乘客塌到约 10 次绘制。
- **顶点色合并**(兜底):`builtin-standard` 有 `USE_VERTEX_COLOR`(第 139 行 `#pragma define-meta`),读 `a_color` 乘到 albedo。把 `trim`/`skin`/`eye`/`shoe` 四个角色烘成一个带顶点色的 mesh,`paint` 仍单独一个 → 每人偶 5 → 2。这条是确定能成的。

**Files:**
- Modify: `game/assets/scripts/view/materials.ts`(加 `instancedLitMaterial`)
- Modify: `game/assets/scripts/view/passenger-builder.ts`(用它;兜底时改 `bake` 与 `buildPassenger`/`recolorPassenger`)
- Modify(临时,最后要还原): `game/assets/resources/levels/level-1.json`

**Interfaces:**
- Consumes: `litMaterial(color)`、`readMainColor(mat)`(`view/materials.ts` 现有)
- Produces: 无新导出供后续任务使用;本任务只降开销

- [ ] **Step 1: 量基线,并把最重情形造出来**

先把 `level-1.json` 临时改成 20 格,让 26 行的场面现在就能看到(现有圆角矩形周长 14.23,20 格行距 0.71,画得下):

```bash
python - <<'PY'
import io, json
p = 'game/assets/resources/levels/level-1.json'
d = json.load(io.open(p, encoding='utf-8'))
d['loop']['capacity'] = 20
d['loop']['boardIndex'] = 10
io.open(p, 'w', encoding='utf-8', newline='').write(json.dumps(d, ensure_ascii=False, indent=2))
print('level-1 temporarily at capacity 20')
PY
```

在 Cocos 编辑器里预览第 1 关,勾上 Show FPS,**记下 Draw call 和 Framerate**。这是基线,写进提交信息。预期在 700 上下。

- [ ] **Step 2: 加实例化材质**

在 `game/assets/scripts/view/materials.ts` 末尾加:

```ts
const instancedCache = new Map<string, Material>();

/**
 * Lit material with GPU instancing on. Every model sharing a mesh AND this exact
 * material collapses into one instanced draw call, which is what makes a 26-row track
 * affordable: the passenger figures are 100+ copies of five baked meshes, so the whole
 * crowd costs about one draw call per (mesh, colour) pair instead of five per figure.
 *
 * Same zero-pass guard as `tryStandard`: in some pipeline setups builtin-standard
 * builds no passes when created at runtime, and a pass-less material crashes the
 * renderer later. Falls back to the plain lit material, which is correct but slower.
 */
export function instancedLitMaterial(color: Color): Material {
    const k = key(color);
    const hit = instancedCache.get(k);
    if (hit) return hit;
    let mat: Material | null = null;
    const eff = EffectAsset.get('builtin-standard');
    if (eff) {
        const m = new Material();
        try {
            m.initialize({ effectAsset: eff, defines: { USE_INSTANCING: true } });
            if (m.passes && m.passes.length > 0) {
                m.setProperty('mainColor', color);
                mat = m;
            }
        } catch {
            mat = null;
        }
    }
    const result = mat ?? litMaterial(color);
    instancedCache.set(k, result);
    return result;
}
```

- [ ] **Step 3: 乘客改用它**

`game/assets/scripts/view/passenger-builder.ts`:导入改成
`import { litMaterial, instancedLitMaterial, readMainColor } from './materials';`

`buildPassenger` 里的赋值改成:

```ts
        mr.material = instancedLitMaterial(role === 'paint' ? color : (model.colors[role] ?? Color.WHITE));
```

`recolorPassenger` 里给 `paint` 角色赋色的那一行同样改成 `instancedLitMaterial(...)` —— 两处必须一致,否则重着色会把实例化关掉。

- [ ] **Step 4: 类型检查**

Run: `cd logic && npm run typecheck:view`
Expected: 零错误

- [ ] **Step 5: 量结果**

再预览第 1 关(仍是 20 格),记下 Draw call。**验收线:总数 ≤ 450。**

- 达标 → 跳到 Step 8。
- 没达标(实例化没生效,数字几乎没变)→ 做 Step 6、7。

- [ ] **Step 6: 兜底 —— 把四个固定角色烘成一个顶点色 mesh**

`passenger-builder.ts`。`ROLES` 保持不动(bake 仍按角色分组读几何),改的是**输出**:

在 `interface Baked` 上方加:

```ts
/** The four roles whose colour never varies per passenger; they merge into one mesh. */
const FIXED_ROLES = ['trim', 'skin', 'eye', 'shoe'] as const;
/** Node name for the merged fixed-role geometry (see `bake`). */
const FIXED_NODE = 'role-fixed';
```

`Baked` 改成:

```ts
interface Baked {
    /** `paint` geometry, recoloured per passenger. */
    paint: Mesh | null;
    /** The four fixed roles merged into ONE mesh, each vertex carrying its role's albedo. */
    fixed: Mesh | null;
    size: Vec3;
}
```

`bake` 结尾那段(从 `const meshes: { role: Role; mesh: Mesh }[] = [];` 到 `return { meshes, colors, size: ... };`)整体换成:

```ts
    // Centre the baked geometry on the origin so a passenger node's position is the
    // figure's middle, exactly like the four-ball cluster's node position was.
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2, cz = (minz + maxz) / 2;
    for (const g of groups.values()) {
        for (let i = 0; i < g.positions.length; i += 3) {
            g.positions[i] -= cx;
            g.positions[i + 1] -= cy;
            g.positions[i + 2] -= cz;
        }
    }

    const paintGroup = groups.get('paint');
    const paint = paintGroup && paintGroup.indices.length > 0
        ? utils.createMesh({
            positions: paintGroup.positions,
            normals: paintGroup.normals.length ? paintGroup.normals : undefined,
            uvs: paintGroup.uvs.length ? paintGroup.uvs : undefined,
            indices: paintGroup.indices,
        })
        : null;

    // One mesh for the four fixed roles, each vertex tinted with its role's authored
    // albedo. Five draw calls per figure was the single biggest cost on a 26-row track;
    // this makes it two. `builtin-standard`'s USE_VERTEX_COLOR multiplies albedo by
    // a_color in LINEAR space (it calls SRGBToLinear itself), so 0-1 floats straight
    // off the authored colour are what it wants.
    const merged: Group = emptyGroup();
    const vcolors: number[] = [];
    for (const role of FIXED_ROLES) {
        const g = groups.get(role);
        if (!g || g.indices.length === 0) continue;
        const base = merged.positions.length / 3;
        const c = colors[role] ?? Color.WHITE;
        merged.positions.push(...g.positions);
        merged.normals.push(...g.normals);
        merged.uvs.push(...g.uvs);
        for (let i = 0; i < g.indices.length; i++) merged.indices.push(g.indices[i] + base);
        const verts = g.positions.length / 3;
        for (let i = 0; i < verts; i++) vcolors.push(c.r / 255, c.g / 255, c.b / 255, 1);
    }
    const fixed = merged.indices.length > 0
        ? utils.createMesh({
            positions: merged.positions,
            normals: merged.normals.length ? merged.normals : undefined,
            uvs: merged.uvs.length ? merged.uvs : undefined,
            colors: vcolors,
            indices: merged.indices,
        })
        : null;

    if (!paint && !fixed) return null;
    return { paint, fixed, size: new Vec3(maxx - minx, maxy - miny, maxz - minz) };
```

`materials.ts` 再加一个顶点色材质:

```ts
let vertexColorMat: Material | null = null;

/**
 * Lit material that takes its albedo from the mesh's vertex colours, shared by every
 * passenger's merged fixed-role mesh. One material for the whole crowd, so it also
 * instances. Falls back to plain white lit if builtin-standard builds no passes.
 */
export function vertexColorMaterial(): Material {
    if (vertexColorMat) return vertexColorMat;
    let mat: Material | null = null;
    const eff = EffectAsset.get('builtin-standard');
    if (eff) {
        const m = new Material();
        try {
            m.initialize({ effectAsset: eff, defines: { USE_VERTEX_COLOR: true, USE_INSTANCING: true } });
            if (m.passes && m.passes.length > 0) {
                m.setProperty('mainColor', Color.WHITE);   // vertex colour does the tinting
                mat = m;
            }
        } catch {
            mat = null;
        }
    }
    vertexColorMat = mat ?? litMaterial(Color.WHITE);
    return vertexColorMat;
}
```

`buildPassenger` 里那个 `for (const { role, mesh } of model.meshes)` 循环换成两个节点:

```ts
    if (model.fixed) {
        const n = new Node(FIXED_NODE);
        const mr = n.addComponent(MeshRenderer);
        mr.mesh = model.fixed;
        mr.material = vertexColorMaterial();
        fit.addChild(n);
    }
    if (model.paint) {
        const n = new Node(roleNodeName('paint'));
        const mr = n.addComponent(MeshRenderer);
        mr.mesh = model.paint;
        mr.material = instancedLitMaterial(color);
        fit.addChild(n);
    }
```

`recolorPassenger` 只认 `paint` 节点(名字没变),但 `shade` 现在也要作用在固定角色上 —— 否则暗掉的候车乘客会两色。合并 mesh 的顶点色是烘死的,所以暗化改为给固定角色节点换一个整体着色的材质:把 `recolorPassenger` 里遍历角色节点的那段改成

```ts
    const paintNode = node.getChildByPath(`fit/${roleNodeName('paint')}`);
    if (paintNode) setLitColor(paintNode, shade(color));
    const fixedNode = node.getChildByPath(`fit/${FIXED_NODE}`);
    const fixedMr = fixedNode?.getComponent(MeshRenderer);
    if (fixedMr) {
        // Dimming has to reach the merged roles too, or a dimmed figure goes two-tone.
        // A shaded figure trades its shared vertex-colour material for a flat tinted
        // one; the undimmed case (NO_SHADE) keeps the shared one and keeps instancing.
        const flat = shade(Color.WHITE);
        fixedMr.material = flat.equals(Color.WHITE) ? vertexColorMaterial() : instancedLitMaterial(flat);
    }
```

并把 `setLitColor` 改用实例化材质(`view/materials.ts` 里那一行 `mr.material = litMaterial(color)` → `instancedLitMaterial(color)`)。

> 注:`recolorPassenger` 的现有实现请按当前文件内容对齐 —— 它遍历 `ROLES` 找子节点,上面这段是替换那个遍历。`FIXED_ROLES`/`FIXED_NODE` 要从 `passenger-builder.ts` 转出给它用,如果它在同一文件里就不用。

- [ ] **Step 7: 再量一次**

Run: `cd logic && npm run typecheck:view`
Expected: 零错误

预览第 1 关(20 格),记下 Draw call。**验收线:总数 ≤ 450。** 人偶必须仍然是彩色的:如果全身发白,说明顶点色没生效(`colors` 没进 mesh,或宏名写错),不要继续往下走。

- [ ] **Step 8: 还原 level-1.json**

```bash
git checkout game/assets/resources/levels/level-1.json
```

- [ ] **Step 9: 提交**

```bash
git add game/assets/scripts/view/materials.ts game/assets/scripts/view/passenger-builder.ts
git commit -m "perf(view): collapse the passenger crowd's draw calls

A 26-row track draws 104 figures where the shipped 18-row one draws 72.
At five draw calls each (one per exported material role) that is 520 for
the crowd alone -- measured <BASELINE> total on level 1 forced to 20 ring
slots, against <RESULT> after this change.

<写明走的是哪条路:实例化,或实例化 + 顶点色合并>"
```

---

### Task 2: 五个轮廓 (M7.B1)

**Files:**
- Create: `game/assets/scripts/core/track-shapes.ts`
- Test: `logic/tests/track-shapes.test.ts`

**Interfaces:**
- Consumes: 无(纯新模块,不依赖任何现有代码)
- Produces:
  - `interface Pt { x: number; y: number }`
  - `interface Seg { len: number; at(u: number, out: Pt): void }`
  - `type TrackShape = 'rect' | 'hex' | 'trap' | 'oval' | 'circle'`
  - `const TRACK_SHAPES: TrackShape[]`
  - `interface ShapeDef { segs: Seg[]; minRadius: number }`
  - `function buildShape(shape: TrackShape): ShapeDef`
  - `const TRACK_BOX: { halfW: number; halfH: number }`

- [ ] **Step 1: 写失败的测试**

`logic/tests/track-shapes.test.ts`:

```ts
import {
  buildShape, TRACK_SHAPES, TRACK_BOX, TrackShape, Pt, Seg,
} from '../../game/assets/scripts/core/track-shapes';

/** Measured from the shapes themselves; a change here is a change to the artwork. */
const PERIMETER: Record<TrackShape, number> = {
  rect: 14.5699, hex: 12.7180, trap: 13.1842, oval: 12.5935, circle: 8.1681,
};

/** Walk a segment list by arc length, the way TrackPath will. */
function walk(segs: Seg[], t: number): Pt {
  const total = segs.reduce((a, s) => a + s.len, 0);
  let s = (((t % 1) + 1) % 1) * total;
  const out: Pt = { x: 0, y: 0 };
  for (const seg of segs) {
    if (s <= seg.len) { seg.at(seg.len > 0 ? s / seg.len : 0, out); return out; }
    s -= seg.len;
  }
  segs[segs.length - 1].at(1, out);
  return out;
}

test('every shape has the perimeter it was drawn to have', () => {
  for (const shape of TRACK_SHAPES) {
    const { segs } = buildShape(shape);
    const total = segs.reduce((a, s) => a + s.len, 0);
    expect(total).toBeCloseTo(PERIMETER[shape], 3);
  }
});

test('every shape starts at the top centre', () => {
  // t=0 at the top centre is what puts the boarding gap at t=0.5 and the two channel
  // entrances at t=0.25/0.75 -- the whole index-to-geometry mapping rests on it.
  for (const shape of TRACK_SHAPES) {
    const p = walk(buildShape(shape).segs, 0);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(TRACK_BOX.halfH, 9);
  }
});

test('every shape is closed', () => {
  for (const shape of TRACK_SHAPES) {
    const { segs } = buildShape(shape);
    const a = walk(segs, 0), b = walk(segs, 1 - 1e-12);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-6);
  }
});

test('every shape is mirror-symmetric about x = 0', () => {
  // Left-right symmetry is what makes t=0.5 the bottom CENTRE. The builders anchor the
  // walk analytically (they split the top edge at x=0), so this holds to float noise --
  // a numeric search for the start point would only manage 1e-3.
  for (const shape of TRACK_SHAPES) {
    const { segs } = buildShape(shape);
    for (let i = 1; i < 500; i++) {
      const u = i / 1000;
      const a = walk(segs, 0.5 - u), b = walk(segs, 0.5 + u);
      expect(a.x + b.x).toBeCloseTo(0, 9);
      expect(a.y - b.y).toBeCloseTo(0, 9);
    }
  }
});

test('the boarding gap sits at the bottom centre', () => {
  for (const shape of TRACK_SHAPES) {
    const p = walk(buildShape(shape).segs, 0.5);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(-TRACK_BOX.halfH, 9);
  }
});

test('the quarter point is where each shape docks its channel', () => {
  const DOCK: Record<TrackShape, [number, number]> = {
    rect: [2.6000, 0.0000],
    hex: [2.4702, 0.0000],
    trap: [2.2980, -0.1784],
    oval: [2.6000, 0.0000],
    circle: [1.3000, 0.0000],
  };
  for (const shape of TRACK_SHAPES) {
    const p = walk(buildShape(shape).segs, 0.25);
    expect(p.x).toBeCloseTo(DOCK[shape][0], 3);
    expect(p.y).toBeCloseTo(DOCK[shape][1], 3);
  }
});

test('no shape leaves the box the camera frames', () => {
  for (const shape of TRACK_SHAPES) {
    const { segs } = buildShape(shape);
    for (let i = 0; i < 2000; i++) {
      const p = walk(segs, i / 2000);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(TRACK_BOX.halfW + 1e-9);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(TRACK_BOX.halfH + 1e-9);
    }
  }
});

test('every shape declares a curvature radius a row of four can take', () => {
  // A row stands ACROSS the path, 0.78 wide, so a tight arc squeezes the inner figures.
  for (const shape of TRACK_SHAPES) {
    expect(buildShape(shape).minRadius).toBeGreaterThanOrEqual(0.6);
  }
});

test('the polyline ellipse tracks the true ellipse closely', () => {
  // The parametric form is not arc-length uniform, so the ellipse is a fine polyline;
  // this is the price of that choice, and it has to stay small.
  const { segs } = buildShape('oval');
  const a = TRACK_BOX.halfW, b = TRACK_BOX.halfH;
  let worst = 0;
  for (let i = 0; i < 2000; i++) {
    const p = walk(segs, i / 2000);
    // Implicit form: 1 means on the curve. Convert the residual to a radial distance.
    const f = (p.x * p.x) / (a * a) + (p.y * p.y) / (b * b);
    worst = Math.max(worst, Math.abs(Math.sqrt(f) - 1) * Math.max(a, b));
  }
  expect(worst).toBeLessThan(0.001);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd logic && npx jest tests/track-shapes.test.ts`
Expected: FAIL,`Cannot find module '../../game/assets/scripts/core/track-shapes'`

- [ ] **Step 3: 实现**

`game/assets/scripts/core/track-shapes.ts`:

```ts
/**
 * The five track outlines, as arc-length segment lists.
 *
 * Pure math on purpose: nothing here imports `cc`, so the whole geometry model is
 * jest-testable and the view is left with mesh building only. It used to live inside
 * view/track-view.ts as module-level state, which stopped working the moment a second
 * shape existed — the cache there keys on the track's y, not on the shape.
 *
 * Every outline is walked CLOCKWISE from the top centre. That is what puts the boarding
 * gap at t=0.5 (bottom centre, facing the parking bay) and the two channel entrances at
 * t=0.25 / 0.75, which is the mapping the ring's index arithmetic assumes.
 */

/** A point in board-local coordinates (the track's own frame, origin at its centre). */
export interface Pt { x: number; y: number }

/** One arc-length-parameterised piece of an outline. */
export interface Seg {
    /** Arc length in board units. */
    len: number;
    /** Point at arc-length fraction u in [0,1], written into `out`. */
    at(u: number, out: Pt): void;
}

export type TrackShape = 'rect' | 'hex' | 'trap' | 'oval' | 'circle';

export const TRACK_SHAPES: TrackShape[] = ['rect', 'hex', 'trap', 'oval', 'circle'];

/**
 * The box every shape fits, in board units. Fixed by the camera and its neighbours, not
 * by taste: halfW comes from the visible half-width at the track's depth minus what a
 * feeder channel needs (see LANE in track-path.ts), halfH from the parking bay panel,
 * whose top edge is at y = 2.05 while the track centre sits at 3.8. There is no vertical
 * slack at all — the band's drop shadow already lands exactly on the panel's edge.
 */
export const TRACK_BOX = { halfW: 2.6, halfH: 1.3 };

/**
 * Corner radius, the same for all three polygons: 0.60 is the SMALLEST value that clears
 * MIN_CURVE_RADIUS (0.6), and a fillet is what sets a rounded polygon's tightest curve.
 * Smaller reads as a crisper quadrilateral next to the oval, and was the first choice —
 * but a row of four figures stands 0.78 ACROSS the path, so on a 0.40 corner the innermost
 * figure lands within 0.01 of the arc's own centre and the row visibly folds.
 */
const RECT_R = 0.60;
const HEX_R = 0.60;
const TRAP_R = 0.60;
/** Straight pieces the ellipse is cut into; see `ellipsePoly`. */
const OVAL_SEGMENTS = 120;

function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}

function unit(x: number, y: number): Pt {
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
}

function line(x0: number, y0: number, x1: number, y1: number): Seg {
    const dx = x1 - x0, dy = y1 - y0;
    return {
        len: Math.hypot(dx, dy),
        at: (u, out) => { out.x = x0 + dx * u; out.y = y0 + dy * u; },
    };
}

function arc(cx: number, cy: number, r: number, a0: number, sweep: number): Seg {
    return {
        len: Math.abs(sweep) * r,
        at: (u, out) => {
            const a = a0 + sweep * u;
            out.x = cx + r * Math.cos(a);
            out.y = cy + r * Math.sin(a);
        },
    };
}

/** A rounded corner at `v`, plus the two tangent points the straights must meet. */
function cornerArc(v: Pt, prev: Pt, next: Pt, r: number): { seg: Seg; from: Pt; to: Pt } {
    const u = unit(prev.x - v.x, prev.y - v.y);
    const w = unit(next.x - v.x, next.y - v.y);
    const half = Math.acos(clamp(u.x * w.x + u.y * w.y, -1, 1)) / 2;
    const trim = r / Math.tan(half);
    const from = { x: v.x + u.x * trim, y: v.y + u.y * trim };
    const to = { x: v.x + w.x * trim, y: v.y + w.y * trim };
    const bis = unit(u.x + w.x, u.y + w.y);
    const c = { x: v.x + bis.x * (r / Math.sin(half)), y: v.y + bis.y * (r / Math.sin(half)) };
    const a0 = Math.atan2(from.y - c.y, from.x - c.x);
    const a1 = Math.atan2(to.y - c.y, to.x - c.x);
    // Shortest signed sweep: a corner arc never exceeds half a turn either way.
    let sweep = a1 - a0;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    return { seg: arc(c.x, c.y, r, a0, sweep), from, to };
}

/**
 * Rounded polygon. `verts` runs CLOCKWISE and must start with the two ends of a
 * horizontal top edge straddling x=0 (verts[0] its left end, verts[1] its right end):
 * the walk starts at the MIDDLE of that edge, which is what makes t=0 the top centre.
 * Splitting the top edge in two is the same trick the old buildSegments used.
 */
function roundedPoly(verts: Pt[], r: number): Seg[] {
    const n = verts.length;
    const corners = verts.map((v, i) => cornerArc(v, verts[(i - 1 + n) % n], verts[(i + 1) % n], r));
    const topY = verts[0].y;
    const segs: Seg[] = [];
    segs.push(line(0, topY, corners[1].from.x, corners[1].from.y));
    for (let i = 1; i < n; i++) {
        segs.push(corners[i].seg);
        const next = corners[(i + 1) % n];
        segs.push(line(corners[i].to.x, corners[i].to.y, next.from.x, next.from.y));
    }
    segs.push(corners[0].seg);
    segs.push(line(corners[0].to.x, corners[0].to.y, 0, topY));
    return segs;
}

/**
 * The ellipse as a fine polyline. Its parametric form is NOT arc-length uniform — walking
 * it by angle bunches the rows at the two ends — and a 120-segment polyline is within
 * 0.001 of the true curve while making the arc-length walk exact.
 */
function ellipsePoly(a: number, b: number, n: number): Seg[] {
    const segs: Seg[] = [];
    const at = (i: number): Pt => {
        const th = Math.PI / 2 - (2 * Math.PI * i) / n;   // start at the top, run clockwise
        return { x: a * Math.cos(th), y: b * Math.sin(th) };
    };
    for (let i = 0; i < n; i++) {
        const p = at(i), q = at(i + 1);
        segs.push(line(p.x, p.y, q.x, q.y));
    }
    return segs;
}

export interface ShapeDef {
    segs: Seg[];
    /**
     * Smallest radius of curvature anywhere on the outline. A row of four figures stands
     * ACROSS the path (0.78 wide), so a tight arc squeezes the inner ones together;
     * validateLevel rejects anything under 0.6. Declared rather than measured because
     * the ellipse is a polyline, whose segments each claim infinite radius.
     */
    minRadius: number;
}

export function buildShape(shape: TrackShape): ShapeDef {
    const { halfW, halfH } = TRACK_BOX;
    switch (shape) {
        case 'rect':
            return {
                segs: roundedPoly([
                    { x: -halfW, y: halfH }, { x: halfW, y: halfH },
                    { x: halfW, y: -halfH }, { x: -halfW, y: -halfH },
                ], RECT_R),
                minRadius: RECT_R,
            };
        case 'hex':
            return {
                segs: roundedPoly([
                    { x: -1.7, y: halfH }, { x: 1.7, y: halfH }, { x: halfW, y: 0 },
                    { x: 1.7, y: -halfH }, { x: -1.7, y: -halfH }, { x: -halfW, y: 0 },
                ], HEX_R),
                minRadius: HEX_R,
            };
        case 'trap':
            // Up-down asymmetric on purpose, which is why its quarter point lands on a
            // slanted edge rather than at the widest point — the channel then leaves at
            // 15 degrees, and everything downstream reads that from the path normal.
            return {
                segs: roundedPoly([
                    { x: -1.9, y: halfH }, { x: 1.9, y: halfH },
                    { x: halfW, y: -halfH }, { x: -halfW, y: -halfH },
                ], TRAP_R),
                minRadius: TRAP_R,
            };
        case 'oval':
            // b^2/a, at the two ends, is the tightest this curve ever gets.
            return {
                segs: ellipsePoly(halfW, halfH, OVAL_SEGMENTS),
                minRadius: (halfH * halfH) / halfW,
            };
        case 'circle':
            // Bounded by the VERTICAL budget, so its radius is halfH and its perimeter is
            // barely half the quadrilateral's. That makes it the one genuinely short ring:
            // 8 slots is its only legal length.
            return {
                segs: [arc(0, 0, halfH, Math.PI / 2, -2 * Math.PI)],
                minRadius: halfH,
            };
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd logic && npx jest tests/track-shapes.test.ts`
Expected: PASS,9 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add game/assets/scripts/core/track-shapes.ts logic/tests/track-shapes.test.ts
git commit -m "feat(core): the five track outlines, as pure arc-length segments"
```

---

### Task 3: 路径行走与边界 (M7.B2)

**Files:**
- Create: `game/assets/scripts/core/track-path.ts`
- Modify: `game/assets/scripts/core/index.ts`
- Test: `logic/tests/track-path.test.ts`

**Interfaces:**
- Consumes: `buildShape`、`TrackShape`、`TRACK_SHAPES`、`TRACK_BOX`、`Pt`、`Seg`(Task 2)
- Produces:
  - `class TrackPath { readonly shape; readonly perimeter; readonly minRadius; pointAt(t, out?): Pt; normalAt(t, out?): Pt; rowSpacing(capacity): number }`
  - `type FeedSide = 'far' | 'near'`
  - `function entryIndex(capacity: number, boardIndex: number, side: FeedSide): number`
  - `function maxLookahead(shape: TrackShape): number`
  - `function capacityOptions(shape: TrackShape): number[]`
  - `const LANE: { bandHalf; start; step; margin; edgeLimit }`
  - `const ROW_SPACING_MIN`、`ROW_SPACING_MAX`、`GAP_ARC`、`MIN_CURVE_RADIUS`、`ENTRY_NORMAL_MAX`、`CAPACITY_OPTIONS`

- [ ] **Step 1: 写失败的测试**

`logic/tests/track-path.test.ts`:

```ts
import {
  TrackPath, entryIndex, maxLookahead, capacityOptions,
  LANE, ROW_SPACING_MIN, ROW_SPACING_MAX, CAPACITY_OPTIONS, ENTRY_NORMAL_MAX,
  MIN_CURVE_RADIUS, GAP_ARC,
} from '../../game/assets/scripts/core/track-path';
import { TRACK_SHAPES, TrackShape } from '../../game/assets/scripts/core/track-shapes';

test('the outward normal at a straight side points straight out', () => {
  const p = new TrackPath('rect');
  const n = p.normalAt(0.25);
  expect(n.x).toBeCloseTo(1, 6);
  expect(n.y).toBeCloseTo(0, 6);
});

test('the normal is a unit vector everywhere', () => {
  for (const shape of TRACK_SHAPES) {
    const p = new TrackPath(shape);
    for (let i = 0; i < 500; i++) {
      const n = p.normalAt(i / 500);
      expect(Math.hypot(n.x, n.y)).toBeCloseTo(1, 6);
    }
  }
});

test('the normal points AWAY from the track centre', () => {
  // A channel is placed along this vector, so a sign error would bury it inside the ring.
  for (const shape of TRACK_SHAPES) {
    const p = new TrackPath(shape);
    for (let i = 0; i < 200; i++) {
      const t = i / 200;
      const pt = p.pointAt(t), n = p.normalAt(t);
      expect(pt.x * n.x + pt.y * n.y).toBeGreaterThan(0);
    }
  }
});

test('row spacing is the perimeter split evenly', () => {
  const p = new TrackPath('rect');
  expect(p.rowSpacing(20)).toBeCloseTo(p.perimeter / 20, 9);
});

test('entry indices sit a quarter lap either side of the boarding gap', () => {
  for (const capacity of CAPACITY_OPTIONS) {
    const board = capacity / 2;
    expect(entryIndex(capacity, board, 'near')).toBe(board - capacity / 4);
    expect(entryIndex(capacity, board, 'far')).toBe(board + capacity / 4);
  }
});

test('the near entry is a quarter lap from the gap and the far one three quarters', () => {
  // The ring steps index+1 per tick, so a row at index e reaches the gap in
  // (board - e) mod capacity ticks. This is the difficulty knob, so pin it.
  for (const capacity of CAPACITY_OPTIONS) {
    const board = capacity / 2;
    const near = entryIndex(capacity, board, 'near');
    const far = entryIndex(capacity, board, 'far');
    expect((board - near + capacity) % capacity).toBe(capacity / 4);
    expect((board - far + capacity) % capacity).toBe((capacity * 3) / 4);
  }
});

test('each shape allows only the capacities whose row spacing reads', () => {
  const EXPECTED: Record<TrackShape, number[]> = {
    rect: [8, 12, 16, 20],
    hex: [8, 12, 16],
    trap: [8, 12, 16],
    oval: [8, 12, 16],
    circle: [8],
  };
  for (const shape of TRACK_SHAPES) {
    expect(capacityOptions(shape)).toEqual(EXPECTED[shape]);
  }
});

test('every allowed capacity really is inside the spacing bounds, and every rejected one is not', () => {
  for (const shape of TRACK_SHAPES) {
    const p = new TrackPath(shape);
    const allowed = capacityOptions(shape);
    for (const c of CAPACITY_OPTIONS) {
      const spacing = p.rowSpacing(c);
      const inside = spacing >= ROW_SPACING_MIN && spacing <= ROW_SPACING_MAX;
      expect(allowed.includes(c)).toBe(inside);
    }
  }
});

test('the boarding gap never swallows a neighbouring row', () => {
  // The gap is an absolute arc length now, so the tightest legal spacing has to clear it.
  expect(GAP_ARC).toBeLessThan(ROW_SPACING_MIN);
});

test('lookahead tops out where the channel would leave the visible width', () => {
  const EXPECTED: Record<TrackShape, number> = {
    rect: 3, hex: 3, trap: 3, oval: 3, circle: 5,
  };
  for (const shape of TRACK_SHAPES) {
    expect(maxLookahead(shape)).toBe(EXPECTED[shape]);
  }
});

test('a channel at its lookahead limit stays on screen, and one batch more does not', () => {
  for (const shape of TRACK_SHAPES) {
    const dockX = Math.abs(new TrackPath(shape).pointAt(0.25).x);
    const edge = (look: number) =>
      dockX + LANE.bandHalf + LANE.start + (look - 1) * LANE.step + LANE.margin;
    expect(edge(maxLookahead(shape))).toBeLessThanOrEqual(LANE.edgeLimit);
    expect(edge(maxLookahead(shape) + 1)).toBeGreaterThan(LANE.edgeLimit);
  }
});

test('every shape docks its channels close to horizontal', () => {
  // A steep normal would shove the channel into the HUD or down onto the parking bay.
  for (const shape of TRACK_SHAPES) {
    const p = new TrackPath(shape);
    for (const capacity of capacityOptions(shape)) {
      const board = capacity / 2;
      for (const side of ['far', 'near'] as const) {
        const t = entryIndex(capacity, board, side) / capacity;
        expect(Math.abs(p.normalAt(t).y)).toBeLessThanOrEqual(ENTRY_NORMAL_MAX);
      }
    }
  }
});

test('a non-multiple-of-four capacity is exactly what the normal rule catches', () => {
  // This is not hypothetical: hex-at-18 and oval-at-14 were in the first draft curve,
  // and their entry cells land on curved edges with normals tilted about 30 degrees.
  const hex = new TrackPath('hex');
  expect(Math.abs(hex.normalAt(entryIndex(18, 9, 'near') / 18).y)).toBeGreaterThan(ENTRY_NORMAL_MAX);
  const oval = new TrackPath('oval');
  expect(Math.abs(oval.normalAt(entryIndex(14, 7, 'near') / 14).y)).toBeGreaterThan(ENTRY_NORMAL_MAX);
});

test('every shape clears the curvature floor', () => {
  for (const shape of TRACK_SHAPES) {
    expect(new TrackPath(shape).minRadius).toBeGreaterThanOrEqual(MIN_CURVE_RADIUS);
  }
});

test('pointAt writes into a caller-supplied point and allocates nothing', () => {
  // repositionAll calls this once per row per frame, so it must be allocation-free.
  const p = new TrackPath('oval');
  const out = { x: 0, y: 0 };
  expect(p.pointAt(0.3, out)).toBe(out);
  expect(out.x).not.toBe(0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd logic && npx jest tests/track-path.test.ts`
Expected: FAIL,`Cannot find module '../../game/assets/scripts/core/track-path'`

- [ ] **Step 3: 实现**

`game/assets/scripts/core/track-path.ts`:

```ts
import { buildShape, Pt, Seg, TrackShape } from './track-shapes';

/**
 * Which end of the ring a feeder channel joins, named by PIPELINE LENGTH rather than by
 * screen side. The ring steps one index per tick in one direction, so the two sides are
 * not interchangeable: a row entering at `near` reaches the boarding gap in capacity/4
 * ticks, one entering at `far` takes three times that. That difference is the difficulty
 * knob this milestone turns, and `left`/`right` hid it. The view maps far to -x and near
 * to +x, in one place.
 */
export type FeedSide = 'far' | 'near';

/**
 * Lane geometry, in board units. These were view constants; they live here because
 * validateLevel has to check a level's lookahead against them, and one copy of a number
 * beats two. `edgeLimit` is the visible half-width at the track's depth.
 */
export const LANE = {
    bandHalf: 0.38,
    start: 0.52,
    step: 0.45,
    margin: 0.25,
    edgeLimit: 4.67,
};

/**
 * Legal ring lengths. Multiples of four, because the entry cells are board +- capacity/4
 * and anything else makes that division round -- which lands the entry off the quarter
 * point, on a curved or slanted stretch whose normal is nowhere near horizontal.
 */
export const CAPACITY_OPTIONS = [8, 12, 16, 20];

/**
 * Row spacing bounds, in board units. Below the floor the boarding gap (GAP_ARC) stops
 * reading as a hole between two rows; above the ceiling the ring looks empty.
 */
export const ROW_SPACING_MIN = 0.70;
export const ROW_SPACING_MAX = 1.90;

/**
 * Boarding and entry gaps, as an ABSOLUTE arc length. It used to be half a ring slot,
 * which shrank with the ring: at 20 slots the doorway was 0.37 long and stopped reading
 * as a doorway. Must stay under ROW_SPACING_MIN so a gap never eats its neighbours.
 */
export const GAP_ARC = 0.55;

/** A row of four stands 0.78 across the path; a tighter arc than this crushes its inside. */
export const MIN_CURVE_RADIUS = 0.6;

/** How far off horizontal an entry's outward normal may sit (about 20 degrees). */
export const ENTRY_NORMAL_MAX = 0.35;

/**
 * One track's geometry: an arc-length walk over a shape's segments. Instance state, not
 * module state — the previous version cached its segments in a module-level variable
 * keyed on the track's y, which silently hands level 2 level 1's shape.
 */
export class TrackPath {
    readonly shape: TrackShape;
    readonly perimeter: number;
    readonly minRadius: number;
    private readonly segs: Seg[];
    /** Scratch for the finite-difference normal, so a per-frame call allocates nothing. */
    private readonly _a: Pt = { x: 0, y: 0 };
    private readonly _b: Pt = { x: 0, y: 0 };

    constructor(shape: TrackShape) {
        const def = buildShape(shape);
        this.shape = shape;
        this.segs = def.segs;
        this.minRadius = def.minRadius;
        this.perimeter = def.segs.reduce((a, s) => a + s.len, 0);
    }

    /** Point at arc-length fraction t (wrapped into [0,1)), written into `out`. */
    pointAt(t: number, out: Pt = { x: 0, y: 0 }): Pt {
        let s = (((t % 1) + 1) % 1) * this.perimeter;
        for (const seg of this.segs) {
            if (s <= seg.len) {
                seg.at(seg.len > 0 ? s / seg.len : 0, out);
                return out;
            }
            s -= seg.len;
        }
        this.segs[this.segs.length - 1].at(1, out);
        return out;
    }

    /**
     * Outward unit normal at t. Taken as a finite difference of the path rather than
     * analytically per segment: the segments only answer positions, and a 1/2000-lap
     * difference reads as smooth straight through the corners. For a clockwise walk the
     * outward normal of a tangent (dx, dy) is (-dy, dx).
     */
    normalAt(t: number, out: Pt = { x: 0, y: 0 }): Pt {
        const d = 1 / 4000;
        this.pointAt(t + d, this._a);
        this.pointAt(t - d, this._b);
        const dx = this._a.x - this._b.x, dy = this._a.y - this._b.y;
        const l = Math.hypot(dx, dy) || 1;
        out.x = -dy / l;
        out.y = dx / l;
        return out;
    }

    /** Arc length between two neighbouring ring rows. */
    rowSpacing(capacity: number): number {
        return this.perimeter / capacity;
    }
}

/**
 * Ring index where `side`'s channel joins. Math.round is defensive only: validateLevel
 * requires capacity to be a multiple of four, so the division is exact for every level
 * that ships, and a fractional index would index the ring array with a float.
 */
export function entryIndex(capacity: number, boardIndex: number, side: FeedSide): number {
    const q = Math.round(capacity / 4);
    return side === 'near'
        ? (boardIndex - q + capacity) % capacity
        : (boardIndex + q) % capacity;
}

/**
 * How many waiting batches a channel on this shape may draw before its outer edge leaves
 * the visible width. Independent of capacity: with capacity a multiple of four the entry
 * always lands at t=0.25, so the dock's x is a property of the shape alone.
 */
export function maxLookahead(shape: TrackShape): number {
    const dockX = Math.abs(new TrackPath(shape).pointAt(0.25).x);
    const room = LANE.edgeLimit - dockX - LANE.bandHalf - LANE.start - LANE.margin;
    return 1 + Math.floor(room / LANE.step);
}

/** Ring lengths this shape's perimeter can carry at a legible row spacing. */
export function capacityOptions(shape: TrackShape): number[] {
    const path = new TrackPath(shape);
    return CAPACITY_OPTIONS.filter((c) => {
        const spacing = path.rowSpacing(c);
        return spacing >= ROW_SPACING_MIN && spacing <= ROW_SPACING_MAX;
    });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd logic && npx jest tests/track-path.test.ts`
Expected: PASS,15 个用例全绿

- [ ] **Step 5: 转出新模块**

`game/assets/scripts/core/index.ts`,在 `export * from './types';` 之前插入:

```ts
export * from './track-shapes';
export * from './track-path';
```

- [ ] **Step 6: 全量回归**

Run: `cd logic && npm test`
Expected: 全绿(既有 80 个 + 新增 24 个)

- [ ] **Step 7: 提交**

```bash
git add game/assets/scripts/core/track-path.ts game/assets/scripts/core/index.ts logic/tests/track-path.test.ts
git commit -m "feat(core): arc-length track walking, with the bounds a level must respect"
```

---

### Task 4: 通道泛化成 1–2 条 (M7.C)

**Files:**
- Modify: `game/assets/scripts/core/types.ts`
- Modify: `game/assets/scripts/core/loop-system.ts`
- Test: `logic/tests/loop-system.test.ts`(迁移 + 新增)
- Test: `logic/tests/game-core.test.ts`(迁移)

**Interfaces:**
- Consumes: `FeedSide`、`entryIndex`(Task 3);`TrackShape`(Task 2)
- Produces:
  - `interface Feed { side: FeedSide; lookahead: number }`
  - `const DEFAULT_FEEDS: Feed[]`、`const DEFAULT_TRACK: TrackShape`
  - `LevelData.loop.track?: TrackShape`、`LevelData.loop.feeds?: Feed[]`
  - `interface Channel { side: FeedSide; lookahead: number; entry: number; queue: PaxGroup[] }`
  - `LoopSystem.channels: Channel[]`(排空顺序),构造函数第 4 参 `feeds: Feed[] = DEFAULT_FEEDS`

- [ ] **Step 1: 先改数据类型(没有它测试写不出来)**

`game/assets/scripts/core/types.ts`,在 `LevelData` 之前加:

```ts
import { FeedSide } from './track-path';
import { TrackShape } from './track-shapes';

/**
 * One feeder channel. `lookahead` is how many waiting batches the view draws, which is
 * how far ahead the player can read the incoming colours — a difficulty knob, not a
 * cosmetic length. The queue behind it is longer; the rest is implied off screen.
 */
export interface Feed { side: FeedSide; lookahead: number }

/** What a level without a `track` field gets: the shape M6 shipped. */
export const DEFAULT_TRACK: TrackShape = 'rect';

/** What a level without a `feeds` field gets: M6's two channels, three batches each. */
export const DEFAULT_FEEDS: Feed[] = [
    { side: 'far', lookahead: 3 },
    { side: 'near', lookahead: 3 },
];
```

并把 `LevelData.loop` 改成:

```ts
  loop: {
    capacity: number;
    boardIndex: number;
    track?: TrackShape;
    feeds?: Feed[];
    queue: QueueGroup[];
  };
```

`types.ts` 顶部现在 import 了 `./track-path` 和 `./track-shapes`,两者都不 import `types`,所以没有循环。

- [ ] **Step 2: 写失败的测试**

在 `logic/tests/loop-system.test.ts` 末尾追加:

```ts
import { DEFAULT_FEEDS, Feed } from '../../game/assets/scripts/core/types';

test('the default feeds reproduce two channels split down the middle', () => {
  const loop = new LoopSystem(8, 0, [g('a', 32), g('b', 32)]);
  expect(loop.channels.map((c) => c.side)).toEqual(['far', 'near']);
  expect(loop.channels[0].queue.length).toBe(4);
  expect(loop.channels[1].queue.length).toBe(4);
});

test('channels are ordered by drain order, far first', () => {
  // The far channel is three quarters of a lap from the gap, so draining it first is
  // what gives a twin-channel level its built-in escalation: a wide planning window
  // early, a narrow one once the near channel takes over.
  const loop = new LoopSystem(8, 0, [g('a', 64)]);
  expect(loop.channels[0].side).toBe('far');
  expect(loop.channels[0].entry).toBe(2);
  expect(loop.channels[1].entry).toBe(6);
});

test('a single-channel level puts every waiting row in that one channel', () => {
  const feeds: Feed[] = [{ side: 'near', lookahead: 2 }];
  const loop = new LoopSystem(8, 0, [g('a', 64)], feeds);
  expect(loop.channels.length).toBe(1);
  expect(loop.channels[0].side).toBe('near');
  expect(loop.channels[0].queue.length).toBe(8);   // 16 rows total, 8 on the ring
});

test('a single-channel level only ever admits rows at its own entry', () => {
  const feeds: Feed[] = [{ side: 'near', lookahead: 2 }];
  const loop = new LoopSystem(8, 0, [g('a', 64)], feeds);
  const entry = loop.channels[0].entry;
  const before = loop.channels[0].queue.length;
  // Open a hole anywhere BUT the entry, and step: nothing may enter.
  loop.ring[(entry + 3) % 8] = null;
  loop.step();
  expect(loop.channels[0].queue.length).toBe(before);
  // Open a hole that lands ON the entry after the rotate, and one row enters.
  loop.ring[(entry - 1 + 8) % 8] = null;
  loop.step();
  expect(loop.channels[0].queue.length).toBe(before - 1);
});

test('reachable colors read the channels in drain order', () => {
  const loop = new LoopSystem(4, 0, [g('a', 16)]);
  loop.ring[1] = null;
  loop.ring[2] = null;
  loop.channels[0].queue = [g('b', 1)];
  loop.channels[1].queue = [g('c', 1)];
  // Two holes -> the next two rows of (far ++ near) can still get in.
  expect(loop.reachableColors()).toEqual(new Set(['a', 'b', 'c']));
});

test('reachable colors of a single channel match the same rows in a twin channel', () => {
  // The deadlock check rests entirely on this set, so the single-channel case must not
  // quietly become more (or less) optimistic than the case M6 shipped.
  const rows = [g('a', 16), g('b', 8)];
  const twin = new LoopSystem(4, 0, rows.slice());
  const single = new LoopSystem(4, 0, rows.slice(), [{ side: 'far', lookahead: 3 }]);
  twin.ring[1] = null;
  single.ring[1] = null;
  expect(single.reachableColors()).toEqual(twin.reachableColors());
});

test('a sealed ring admits nothing, whatever the channel layout', () => {
  for (const feeds of [DEFAULT_FEEDS, [{ side: 'near', lookahead: 1 }] as Feed[]]) {
    const loop = new LoopSystem(4, 0, [g('a', 64)], feeds);
    const waiting = loop.channels.reduce((n, c) => n + c.queue.length, 0);
    loop.step();
    expect(loop.channels.reduce((n, c) => n + c.queue.length, 0)).toBe(waiting);
  }
});
```

再把该文件里既有的引用迁过去 —— 逐处替换,一共这几种形态:

| 旧 | 新 |
|---|---|
| `loop.left` | `loop.channels[0].queue` |
| `loop.right` | `loop.channels[1].queue` |
| `loop.entryLeft` | `loop.channels[0].entry` |
| `loop.entryRight` | `loop.channels[1].entry` |
| `[...loop.ring, ...loop.left, ...loop.right]` | `[...loop.ring, ...loop.channels.flatMap((c) => c.queue)]` |

`logic/tests/game-core.test.ts` 同样替换(`game.loop.left = reds(8)` → `game.loop.channels[0].queue = reds(8)`,`right` → `channels[1]`)。测试里的注释若写了 "left"/"right",改成 "far"/"near"。

- [ ] **Step 3: 跑测试确认失败**

Run: `cd logic && npx jest tests/loop-system.test.ts`
Expected: FAIL,`Property 'channels' does not exist on type 'LoopSystem'`

- [ ] **Step 4: 实现**

`game/assets/scripts/core/loop-system.ts`。import 改成:

```ts
import { DEFAULT_FEEDS, Feed, GROUP_SIZE, PaxGroup, QueueGroup } from './types';
import { entryIndex, FeedSide } from './track-path';
```

在 `export class LoopSystem` 之前加:

```ts
/**
 * A feeder channel: its ring entry, the rows waiting in it, and how many of them the
 * view draws. Channels are held in DRAIN ORDER — `channels[0]` empties before
 * `channels[1]` opens — because arrival order is what `reachableColors` (and with it
 * the deadlock check) reasons about.
 */
export interface Channel {
    side: FeedSide;
    lookahead: number;
    entry: number;
    queue: PaxGroup[];
}

/** Far drains before near, so that is the order channels are held in. */
const DRAIN_ORDER: FeedSide[] = ['far', 'near'];
```

`left`/`right`/`entryLeft`/`entryRight` 四个字段换成:

```ts
    /** Feeder channels in drain order; 1 or 2 of them. */
    channels: Channel[];
```

构造函数从 `this.ring = new Array(capacity).fill(null);` 之后整体换成:

```ts
        this.ring = new Array(capacity).fill(null);
        for (let i = 0; i < capacity && all.length > 0; i++) this.ring[i] = all.shift()!;

        // Channels in drain order, then the remaining rows dealt out in that same order.
        // With two channels this is the even split M6 shipped; with one, everything goes
        // to it. The split never reorders anything — a seed, when given, is what changes
        // the order (via the shuffle above).
        const ordered = DRAIN_ORDER.filter((side) => feeds.some((f) => f.side === side))
            .map((side) => feeds.find((f) => f.side === side) as Feed);
        const per = Math.ceil(all.length / ordered.length);
        this.channels = ordered.map((feed, i) => ({
            side: feed.side,
            lookahead: feed.lookahead,
            entry: entryIndex(capacity, boardIndex, feed.side),
            queue: all.slice(i * per, (i + 1) * per),
        }));
```

构造函数签名加第 4 参(在 `shuffleSeed` 之前会破坏既有调用,所以放在它之前并给默认值 —— 既有调用都只传 3 个或 3 个 + seed,而 seed 是第 4 个):

```ts
    constructor(
        capacity: number,
        boardIndex: number,
        queue: QueueGroup[],
        feeds: Feed[] = DEFAULT_FEEDS,
        shuffleSeed?: number,
    ) {
```

> **注意**:`shuffleSeed` 从第 4 参变成第 5 参。改完后 `grep -rn "new LoopSystem(" game logic` 逐个核对,把传 seed 的调用补上 `feeds`(见 Task 8 的 `game-core.ts`)。

`step()` 里那三行选队列的逻辑换成:

```ts
        // One entrance is live at a time, in drain order: the far channel empties before
        // the near one opens. That keeps arrival order identical to a single FIFO pool,
        // which is what `reachableColors` (and the deadlock check) rely on.
        const live = this.channels.find((c) => c.queue.length > 0);
        if (live && this.ring[live.entry] === null) {
            this.ring[live.entry] = live.queue.shift()!;
        }
```

`reachableColors()` 里取候补的那一段换成:

```ts
        const waiting = this.channels.flatMap((c) => c.queue);
        for (let i = 0; i < empty; i++) {
            const grp = waiting[i];
            if (grp === undefined) break;
            reachable.add(grp.color);
        }
```

`remainingCount()` 里两个 for 换成:

```ts
        for (const channel of this.channels) {
            for (const grp of channel.queue) total += grp.count;
        }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd logic && npm test`
Expected: 全绿。**M6 的三个死局用例必须仍然绿** —— 它们是这次改动唯一的安全网。

- [ ] **Step 6: 提交**

```bash
git add game/assets/scripts/core/types.ts game/assets/scripts/core/loop-system.ts logic/tests/loop-system.test.ts logic/tests/game-core.test.ts
git commit -m "refactor(core): one to two feeder channels, named by pipeline length

left/right named the screen side and hid the thing that matters: the ring
steps one way, so a row entering at the near dock reaches the boarding gap
in capacity/4 ticks and one entering at the far dock takes three times
that. far/near says it, and a level can now have just one of them."
```

---

### Task 5: 校验规则 (M7.D1)

**Files:**
- Modify: `game/assets/scripts/core/level-data.ts`
- Test: `logic/tests/level-data.test.ts`

**Interfaces:**
- Consumes: `TrackPath`、`entryIndex`、`maxLookahead`、`capacityOptions`、`ENTRY_NORMAL_MAX`、`MIN_CURVE_RADIUS`(Task 3);`TRACK_SHAPES`(Task 2);`DEFAULT_TRACK`、`DEFAULT_FEEDS`(Task 4)
- Produces: `function validateTrack(level: LevelData): string[]`(7 条几何规则)。`validateLevel` **一行不改**

> **为什么是新函数,而不是往 `validateLevel` 里加**(这一条刻意偏离 spec 原文,理由在这里):
> `validateLevel` 被 `isSolvable`(`solvability.ts:35`,失败即判不可解)和 `game-core` 调用,而 `logic/tests` 里的合成关卡用的是 capacity **2 / 4 / 5 / 6** —— `game-core.test.ts` 的死局用例靠 capacity 2 让两个入口重合在 index 0,`solvability.test.ts` 与 `integration.test.ts` 用 capacity 5,`coverage-m2.test.ts` 用 4 和 6。这些夹具存在的目的是测上车/死局/可解性,**它们从不需要被画出来**。把几何规则塞进 `validateLevel`,等于用"画不出来"这个与它们无关的理由宣布这些关卡不可解,连带打红 5 个测试文件。
> 几何规则约束的是**可绘制性**,适用对象是生成器产出与随包关卡,所以单独一个 `validateTrack`,调用点是:生成器测试、`tools/gen-levels.ts`(不合规就让离线构建失败)、以及 `GameController` 里一句 warn(永不阻断游戏)。

- [ ] **Step 1: 写失败的测试**

在 `logic/tests/level-data.test.ts` 末尾追加(该文件已有的 `level()` 之类工厂请沿用;若没有,用下面这个):

```ts
import { validateTrack } from '../../game/assets/scripts/core/level-data';
import { LevelData, Feed } from '../../game/assets/scripts/core/types';
import { TrackShape } from '../../game/assets/scripts/core/track-shapes';

/** A level that validates clean, so each test can break exactly one thing. */
function trackLevel(over: Partial<LevelData['loop']> = {}): LevelData {
  return {
    id: 1,
    grid: { cols: 4, rows: 4, cars: [{ id: 1, x: 0, y: 0, w: 1, h: 1, dir: 'up', color: 'red', cap: 'small' }] },
    parking: { slots: 7, unlocked: 4 },
    loop: {
      capacity: 12,
      boardIndex: 6,
      track: 'rect',
      feeds: [{ side: 'far', lookahead: 3 }, { side: 'near', lookahead: 3 }],
      queue: [{ color: 'red', count: 16 }],
      ...over,
    },
    powerups: { refresh: 3, hardClear: 1, magnet: 1 },
  };
}

test('the baseline track validates clean', () => {
  expect(validateTrack(trackLevel())).toEqual([]);
});

test('validateLevel still says nothing about geometry', () => {
  // The split is the point: `isSolvable` runs validateLevel, and the synthetic levels in
  // the game-core / solvability / coverage tests use rings of 2, 4, 5 and 6 slots on
  // purpose -- game-core's deadlock cases need capacity 2 so both entrances collapse onto
  // index 0. They test boarding and deadlock and are never drawn, so geometry must not
  // start calling them unsolvable.
  const tiny = trackLevel({ capacity: 4, boardIndex: 2, track: undefined, feeds: undefined });
  expect(validateLevel(tiny)).toEqual([]);
  expect(validateTrack(tiny).length).toBeGreaterThan(0);
});

test('a level with no track or feeds fields validates clean', () => {
  const level = trackLevel();
  delete level.loop.track;
  delete level.loop.feeds;
  expect(validateTrack(level)).toEqual([]);
});

test('an unknown track shape is rejected', () => {
  const level = trackLevel({ track: 'octagon' as TrackShape });
  expect(validateTrack(level).join(' ')).toContain('track shape');
});

test('a capacity that is not a multiple of four is rejected', () => {
  const level = trackLevel({ capacity: 14, boardIndex: 7 });
  expect(validateTrack(level).join(' ')).toContain('multiple of 4');
});

test('a capacity the shape cannot carry legibly is rejected', () => {
  // The circle's perimeter is 8.17, so 12 slots is a row spacing of 0.68 -- under the
  // floor, where the boarding gap stops reading as a hole.
  const level = trackLevel({ track: 'circle', capacity: 12, boardIndex: 6 });
  expect(validateTrack(level).join(' ')).toContain('row spacing');
});

test('a boarding index that is not half a lap is rejected', () => {
  const level = trackLevel({ boardIndex: 5 });
  expect(validateTrack(level).join(' ')).toContain('boardIndex');
});

test('three channels are rejected', () => {
  const feeds = [
    { side: 'far', lookahead: 1 }, { side: 'near', lookahead: 1 }, { side: 'far', lookahead: 1 },
  ] as Feed[];
  expect(validateTrack(trackLevel({ feeds })).join(' ')).toContain('1 or 2');
});

test('no channel at all is rejected', () => {
  expect(validateTrack(trackLevel({ feeds: [] })).join(' ')).toContain('1 or 2');
});

test('two channels on the same side are rejected', () => {
  const feeds = [{ side: 'near', lookahead: 1 }, { side: 'near', lookahead: 2 }] as Feed[];
  expect(validateTrack(trackLevel({ feeds })).join(' ')).toContain('same side');
});

test('a lookahead of zero is rejected', () => {
  const feeds = [{ side: 'near', lookahead: 0 }] as Feed[];
  expect(validateTrack(trackLevel({ feeds })).join(' ')).toContain('lookahead');
});

test('a lookahead past the visible width is rejected', () => {
  // rect docks its channel at x=2.6, which leaves room for three batches, not four.
  const feeds = [{ side: 'near', lookahead: 4 }] as Feed[];
  expect(validateTrack(trackLevel({ feeds })).join(' ')).toContain('lookahead');
});

test('the circle takes a longer lookahead than the quadrilateral', () => {
  // Its dock is at x=1.3, so the horizontal budget stretches to five batches.
  const feeds = [{ side: 'near', lookahead: 5 }] as Feed[];
  expect(validateTrack(trackLevel({ track: 'circle', capacity: 8, boardIndex: 4, feeds }))).toEqual([]);
});

test('every complaint names what is wrong', () => {
  const level = trackLevel({ capacity: 14, boardIndex: 6, track: 'circle' });
  const errors = validateTrack(level);
  expect(errors.length).toBeGreaterThan(0);
  for (const e of errors) expect(e.length).toBeGreaterThan(10);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd logic && npx jest tests/level-data.test.ts`
Expected: FAIL,`level-data has no exported member 'validateTrack'`

- [ ] **Step 3: 实现**

`game/assets/scripts/core/level-data.ts`。import 加:

```ts
import { DEFAULT_FEEDS, DEFAULT_TRACK, LevelData, CAP_SIZE } from './types';
import { TRACK_SHAPES } from './track-shapes';
import {
    capacityOptions, entryIndex, ENTRY_NORMAL_MAX, maxLookahead, MIN_CURVE_RADIUS, TrackPath,
} from './track-path';
```

在**文件末尾追加一个新函数** —— `validateLevel` 本体一行不动:

```ts
/**
 * Whether a level's track can actually be DRAWN: shape, ring length, boarding index and
 * feeder channels, against the geometry budget. Separate from `validateLevel` on purpose.
 *
 * `validateLevel` answers "is this level's data self-consistent", and `isSolvable` treats
 * a failure there as unsolvable. The synthetic levels in the core tests run rings of 2, 4,
 * 5 and 6 slots -- game-core's deadlock cases need capacity 2 so both entrances collapse
 * onto index 0 -- and none of them is ever rendered. Drawability belongs to authored and
 * generated levels, so it is checked where those are made: the generator's tests, the
 * offline tool (which fails the build), and one warning in GameController.
 *
 * These rules read like formalities and are not: the first draft of the difficulty curve
 * had hex-at-18 and oval-at-14 in it, whose entry cells land on curved edges with outward
 * normals tilted 30 degrees -- channels shoved diagonally off screen. Rule 6 caught both
 * before anything was drawn.
 */
export function validateTrack(level: LevelData): string[] {
  const errors: string[] = [];
  const loop = level.loop;
  const shape = loop.track ?? DEFAULT_TRACK;
  if (!TRACK_SHAPES.includes(shape)) {
    errors.push(`unknown track shape ${String(shape)}`);
    // Every rule below needs a buildable shape, so stop here rather than throw.
    return errors;
  }
  const path = new TrackPath(shape);

  if (loop.capacity % 4 !== 0) {
    errors.push(`capacity ${loop.capacity} is not a multiple of 4`);
  }
  if (!capacityOptions(shape).includes(loop.capacity)) {
    errors.push(
      `capacity ${loop.capacity} does not fit ${shape}: row spacing ` +
      `${path.rowSpacing(loop.capacity).toFixed(2)}, allowed ${capacityOptions(shape).join('/')}`,
    );
  }
  if (loop.boardIndex !== loop.capacity / 2) {
    errors.push(`boardIndex ${loop.boardIndex} must be half the capacity (${loop.capacity / 2})`);
  }
  if (path.minRadius < MIN_CURVE_RADIUS) {
    errors.push(`${shape} curves tighter (${path.minRadius}) than a row of four can take`);
  }

  const feeds = loop.feeds ?? DEFAULT_FEEDS;
  if (feeds.length < 1 || feeds.length > 2) {
    errors.push(`a level needs 1 or 2 feeder channels, not ${feeds.length}`);
  }
  if (feeds.length === 2 && feeds[0].side === feeds[1].side) {
    errors.push(`both feeder channels are on the same side (${feeds[0].side})`);
  }
  const limit = maxLookahead(shape);
  for (const feed of feeds) {
    if (feed.lookahead < 1 || feed.lookahead > limit) {
      errors.push(
        `${feed.side} channel lookahead ${feed.lookahead} out of range for ${shape} (1..${limit})`,
      );
    }
    // Only meaningful once the capacity itself is legal; a bad capacity already reported.
    if (loop.capacity > 0 && loop.capacity % 4 === 0) {
      const t = entryIndex(loop.capacity, loop.capacity / 2, feed.side) / loop.capacity;
      const ny = Math.abs(path.normalAt(t).y);
      if (ny > ENTRY_NORMAL_MAX) {
        errors.push(
          `${feed.side} entry on ${shape} at ${loop.capacity} slots leaves at ` +
          `|ny| ${ny.toFixed(3)}, past ${ENTRY_NORMAL_MAX}`,
        );
      }
    }
  }
  return errors;
}
```

> 那句 `return errors;` 就是新函数的结尾 —— 不要再碰 `level.parking`,那是 `validateLevel` 的事。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd logic && npm test`
Expected: 全绿,**且既有用例一条都没动过** —— 这就是拆函数换来的:capacity 2/4/5/6 的合成关卡不受几何规则影响。

- [ ] **Step 5: 提交**

```bash
git add game/assets/scripts/core/level-data.ts logic/tests/level-data.test.ts
git commit -m "feat(core): validateTrack rejects a track a level cannot draw

Kept off validateLevel, which isSolvable treats as a solvability gate:
the core tests run rings of 2, 4, 5 and 6 slots on purpose (game-core's
deadlock cases need capacity 2 so both entrances collapse onto index 0)
and none of them is ever drawn. Drawability is checked where drawn levels
are made -- the generator, the offline tool, and one warning in the view."
```

---

### Task 6: 难度曲线与重新生成 10 关 (M7.D2)

**Files:**
- Modify: `game/assets/scripts/core/level-gen.ts`
- Modify: `tools/gen-levels.ts`(不合规就让构建失败)
- Modify: `game/assets/resources/levels/level-1.json` … `level-10.json`
- Test: `logic/tests/level-gen.test.ts`

**Interfaces:**
- Consumes: `TrackShape`(Task 2);`capacityOptions`、`entryIndex`(Task 3);`Feed`(Task 4)
- Produces:
  - `interface TrackParams { track: TrackShape; capacity: number; feeds: Feed[] }`
  - `function trackParams(id: number): TrackParams`
  - `function planningWindow(p: TrackParams): number[]`(每条通道的视野拍数,排空顺序)

- [ ] **Step 1: 写失败的测试**

在 `logic/tests/level-gen.test.ts` 末尾追加:

```ts
import { trackParams, planningWindow } from '../../game/assets/scripts/core/level-gen';
import { capacityOptions, maxLookahead } from '../../game/assets/scripts/core/track-path';
import { validateTrack } from '../../game/assets/scripts/core/level-data';

test('the curve assigns every level a track its geometry can draw', () => {
  for (const id of IDS) {
    const p = trackParams(id);
    expect(capacityOptions(p.track)).toContain(p.capacity);
    for (const f of p.feeds) expect(f.lookahead).toBeLessThanOrEqual(maxLookahead(p.track));
  }
});

test('the generated levels carry their curve entry', () => {
  for (const id of IDS) {
    const level = generateLevel(id);
    const p = trackParams(id);
    expect(level.loop.track).toBe(p.track);
    expect(level.loop.capacity).toBe(p.capacity);
    expect(level.loop.boardIndex).toBe(p.capacity / 2);
    expect(level.loop.feeds).toEqual(p.feeds);
  }
});

test('the planning window narrows as the levels go on', () => {
  // Planning window = drawn waiting batches + ticks from the entry to the boarding gap.
  // It is the one number the three knobs collapse into, so the curve is checked on it.
  // Level 7 is a deliberate dip -- a single far channel, a breather -- so it is exempt.
  const tail = IDS.map((id) => {
    const w = planningWindow(trackParams(id));
    return w[w.length - 1];
  });
  expect(tail).toEqual([8, 7, 7, 6, 6, 5, 11, 4, 4, 3]);
  for (let i = 1; i < tail.length; i++) {
    if (i + 1 === 7 || i === 7 - 1) continue;   // skip into and out of the breather
    expect(tail[i]).toBeLessThanOrEqual(tail[i - 1]);
  }
});

test('a twin-channel level starts wider than it ends', () => {
  for (const id of IDS) {
    const p = trackParams(id);
    const w = planningWindow(p);
    if (p.feeds.length === 2) expect(w[0]).toBeGreaterThan(w[w.length - 1]);
    else expect(w.length).toBe(1);
  }
});

test('all five shapes appear across the ten levels', () => {
  const used = new Set(IDS.map((id) => trackParams(id).track));
  expect(used.size).toBe(5);
});

test('at least one level runs on a single channel, each side', () => {
  const single = IDS.map((id) => trackParams(id)).filter((p) => p.feeds.length === 1);
  expect(single.length).toBeGreaterThanOrEqual(2);
  expect(new Set(single.map((p) => p.feeds[0].side)).size).toBe(2);
});

test('the curve keeps producing legal tracks past the authored table', () => {
  for (let id = 11; id <= 25; id++) {
    const p = trackParams(id);
    expect(capacityOptions(p.track)).toContain(p.capacity);
    expect(validateLevel(generateLevel(id))).toEqual([]);
    expect(validateTrack(generateLevel(id))).toEqual([]);
  }
});

test('every generated level draws a legal track', () => {
  // validateTrack is the drawability gate, and the generator is its main customer.
  for (const id of IDS) {
    expect(validateTrack(generateLevel(id))).toEqual([]);
  }
});

test('the ring can hold at least one row of every colour a level uses', () => {
  // A ring shorter than the colour count can have a colour entirely absent from it,
  // which turns an ordinary level into a coin flip.
  for (const id of IDS) {
    const level = generateLevel(id);
    const colors = new Set(level.grid.cars.map((c) => c.color));
    expect(level.loop.capacity).toBeGreaterThanOrEqual(colors.size);
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd logic && npx jest tests/level-gen.test.ts`
Expected: FAIL,`level-gen has no exported member 'trackParams'`

- [ ] **Step 3: 实现**

`game/assets/scripts/core/level-gen.ts`。import 加:

```ts
import { Feed } from './types';
import { TrackShape } from './track-shapes';
import { capacityOptions, entryIndex, TRACK_SHAPES_FOR_CAPACITY } from './track-path';
```

> `TRACK_SHAPES_FOR_CAPACITY` 不存在 —— 用 `TRACK_SHAPES` + `capacityOptions` 自己筛。正确的 import 是:
> ```ts
> import { TRACK_SHAPES, TrackShape } from './track-shapes';
> import { capacityOptions } from './track-path';
> import { Feed } from './types';
> ```

删掉 `const LOOP_CAPACITY = 12;` 和 `const BOARD_INDEX = 6;`,换成:

```ts
/** The track knobs for one level: shape, ring length, and its feeder channels. */
export interface TrackParams {
    track: TrackShape;
    capacity: number;
    feeds: Feed[];
}

const TWIN: Feed[] = [{ side: 'far', lookahead: 3 }, { side: 'near', lookahead: 3 }];

/**
 * The track curve, one row per level.
 *
 * The three knobs collapse into one number — the PLANNING WINDOW, in ticks: how long a
 * player has between first seeing a batch of colours and that batch reaching the boarding
 * gap. It is the drawn waiting batches plus the ticks from the channel's entry to the
 * gap, and `planningWindow` computes it. Twin-channel levels have two values: the far
 * channel drains first, so they open wide and tighten when the near one takes over.
 *
 * Level 7 dips on purpose — a single far channel, constant and roomy. It is a breather,
 * and the first level where the player sees a track fed from one side only.
 *
 * Shapes are not free choices: a shape's perimeter decides which ring lengths it can
 * carry at a legible row spacing (see capacityOptions), so the circle — half the
 * quadrilateral's perimeter, because it is bounded by the vertical budget — only ever
 * appears at 8 slots.
 */
const TRACK_CURVE: TrackParams[] = [
    { track: 'rect',   capacity: 20, feeds: TWIN },
    { track: 'hex',    capacity: 16, feeds: TWIN },
    { track: 'trap',   capacity: 16, feeds: TWIN },
    { track: 'oval',   capacity: 16, feeds: [{ side: 'far', lookahead: 2 }, { side: 'near', lookahead: 2 }] },
    { track: 'rect',   capacity: 16, feeds: [{ side: 'far', lookahead: 2 }, { side: 'near', lookahead: 2 }] },
    { track: 'hex',    capacity: 12, feeds: [{ side: 'far', lookahead: 2 }, { side: 'near', lookahead: 2 }] },
    { track: 'trap',   capacity: 12, feeds: [{ side: 'far', lookahead: 2 }] },
    { track: 'rect',   capacity: 12, feeds: [{ side: 'far', lookahead: 1 }, { side: 'near', lookahead: 1 }] },
    { track: 'circle', capacity: 8,  feeds: [{ side: 'near', lookahead: 2 }] },
    { track: 'oval',   capacity: 8,  feeds: [{ side: 'near', lookahead: 1 }] },
];

/**
 * Ticks of warning each channel gives, in drain order. The ring steps one index per
 * tick, so a row entering at index e reaches the gap in (board - e) mod capacity ticks.
 */
export function planningWindow(p: TrackParams): number[] {
    const board = p.capacity / 2;
    return p.feeds.map((f) => {
        const entry = entryIndex(p.capacity, board, f.side);
        return f.lookahead + ((board - entry + p.capacity) % p.capacity);
    });
}

/**
 * Track knobs for `id`. Past the authored table the difficulty holds at the last row's
 * and only the shape rotates, among those that can carry that ring length — endless
 * levels stay legal and stay visually varied without inventing a curve nobody tuned.
 */
export function trackParams(id: number): TrackParams {
    if (id >= 1 && id <= TRACK_CURVE.length) return TRACK_CURVE[id - 1];
    const tail = TRACK_CURVE[TRACK_CURVE.length - 1];
    const fits = TRACK_SHAPES.filter((s) => capacityOptions(s).includes(tail.capacity));
    return { ...tail, track: fits[(id - 1) % fits.length] };
}
```

`assemble` 改成带上这些字段:

```ts
function assemble(id: number, cars: CarSpec[]): LevelData {
    const track = trackParams(id);
    return {
        id,
        grid: { cols: GRID_COLS, rows: GRID_ROWS, cars },
        parking: { slots: SLOTS, unlocked: UNLOCKED },
        loop: {
            capacity: track.capacity,
            boardIndex: track.capacity / 2,
            track: track.track,
            feeds: track.feeds,
            queue: queueFor(cars),
        },
        powerups: { refresh: 3, hardClear: 1, magnet: 1 },
    };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd logic && npm test`
Expected: 全绿

- [ ] **Step 5: 让离线工具把不合规的轨道挡在构建外**

`tools/gen-levels.ts`,在写文件之前加一道闸:

```ts
    const trackErrors = validateTrack(level);
    if (trackErrors.length > 0) {
        console.error(`level ${level.id}: undrawable track`);
        for (const e of trackErrors) console.error(`  ${e}`);
        process.exitCode = 1;
        return;
    }
```

`validateTrack` 从 `../game/assets/scripts/core/level-data` 导入(该文件现有的 import 风格照抄)。这样"生成了一个画不出来的轨道"是构建失败,而不是预览时才发现的画面事故。

- [ ] **Step 6: 重新生成 10 关**

```bash
cd logic && npm run gen
```

Expected: 打印难度表,写出 `level-1.json` … `level-10.json`

- [ ] **Step 7: 核对写出来的文件**

```bash
python - <<'PY'
# -*- coding: utf-8 -*-
import io, json
for i in range(1, 11):
    d = json.load(io.open('game/assets/resources/levels/level-%d.json' % i, encoding='utf-8'))
    lp = d['loop']
    feeds = ' + '.join('%s:%d' % (f['side'], f['lookahead']) for f in lp['feeds'])
    print('level %2d  %-6s cap=%2d board=%2d  %s' % (i, lp['track'], lp['capacity'], lp['boardIndex'], feeds))
PY
```

Expected(与 spec 的曲线表逐行一致):

```
level  1  rect   cap=20 board=10  far:3 + near:3
level  2  hex    cap=16 board= 8  far:3 + near:3
level  3  trap   cap=16 board= 8  far:3 + near:3
level  4  oval   cap=16 board= 8  far:2 + near:2
level  5  rect   cap=16 board= 8  far:2 + near:2
level  6  hex    cap=12 board= 6  far:2 + near:2
level  7  trap   cap=12 board= 6  far:2
level  8  rect   cap=12 board= 6  far:1 + near:1
level  9  circle cap= 8 board= 4  near:2
level 10  oval   cap= 8 board= 4  near:1
```

- [ ] **Step 8: 提交**

```bash
git add game/assets/scripts/core/level-gen.ts tools/gen-levels.ts logic/tests/level-gen.test.ts game/assets/resources/levels/
git commit -m "feat(core): a track curve, and ten levels that ride it"
```

---

### Task 7: 视图接上 TrackPath (M7.E1)

**Files:**
- Modify: `game/assets/scripts/view/track-view.ts`

**Interfaces:**
- Consumes: `TrackPath`、`entryIndex`、`FeedSide`、`GAP_ARC`、`LANE`(Task 3);`Channel`(Task 4)
- Produces: `TrackView` 新构造函数签名
  `constructor(parent: Node, path: TrackPath, capacity: number, boardIndex: number, feeds: Feed[], y: number, tick: number)`
  与 `update(ring: (PaxGroup | null)[], channels: Channel[]): void`

这一步只换几何来源和缺口算法,通道仍按老办法(轴对齐、固定 3 批)摆 —— 拆成两步是为了让预览能分别定位问题。

- [ ] **Step 1: 删掉模块级几何**

`game/assets/scripts/view/track-view.ts` 顶部,删掉这些:`const W`、`const H`、`const R`、`interface Seg`、`function buildSegments`、`let SEGS`、`let SEG_CY`、`let PERIMETER`、`function segments`、`function pathPoint`、`function pathNormal`、`const _nA`、`const _nB`。

`BAND_HALF` 改成从 core 取(它现在是 `LANE.bandHalf`,校验规则要用同一个数):

```ts
import { Channel, Feed, GAP_ARC, LANE, PaxGroup, TrackPath, entryIndex } from '../core/index';

/**
 * Half-width of the white band the rows ride on. Comes from core because validateLevel
 * measures a level's channels against the same number (see LANE in core/track-path.ts).
 */
const BAND_HALF = LANE.bandHalf;
const LANE_STEP = LANE.step;
const LANE_START = LANE.start;
```

删掉本地的 `LANE_VISIBLE`(每侧前瞻现在由 feed 决定,Task 8 用到)。

- [ ] **Step 2: 换构造函数与字段**

`entries` 字段与构造函数换成:

```ts
    private readonly path: TrackPath;
    private readonly capacity: number;
    private readonly boardIndex: number;
    private readonly feeds: Feed[];
    /** Path parameters where the band opens up: the boarding gap and each entry. */
    private gapTs: number[] = [];

    constructor(
        parent: Node, path: TrackPath, capacity: number, boardIndex: number,
        feeds: Feed[], y: number, tick: number,
    ) {
        this.path = path;
        this.capacity = capacity;
        this.boardIndex = boardIndex;
        this.feeds = feeds;
        this.root = parent;
        this.cy = y;
        this.tick = tick;
        this.gapTs = [
            boardIndex / capacity,
            ...feeds.map((f) => entryIndex(capacity, boardIndex, f.side) / capacity),
        ];
        this.buildBand(parent);
        this.buildClusters(parent);
        this.buildLanes(parent);
    }
```

文件里余下所有 `pathPoint(t, this.cy, out)` 换成 `this.point(t, out)`,`pathNormal(t, this.cy)` 换成 `this.normal(t)`,并加两个私有辅助 —— core 的路径以自身中心为原点,视图要把它抬到 `cy`:

```ts
    /** Board-local point at t: the core path, lifted to the track's y. */
    private point(t: number, out: Vec3 = new Vec3()): Vec3 {
        const p = this.path.pointAt(t, this._pt);
        out.set(p.x, this.cy + p.y, 0);
        return out;
    }

    private normal(t: number, out: Vec3 = new Vec3()): Vec3 {
        const n = this.path.normalAt(t, this._nt);
        out.set(n.x, n.y, 0);
        return out;
    }
```

并加两个 scratch 字段(core 的 `Pt`,不是 `Vec3`):

```ts
    private readonly _pt = { x: 0, y: 0 };
    private readonly _nt = { x: 0, y: 0 };
```

- [ ] **Step 3: 缺口改成绝对弧长**

`buildBand` 里那两行:

```ts
        const half = 0.5 / this.capacity; // half a slot wide gap
```
```ts
            if (this.gapTs.some((g) => Math.abs(((t - g + 1.5) % 1) - 0.5) < half)) continue;
```

换成:

```ts
        // The gap is an absolute arc length, not half a slot: as a fraction of the lap it
        // shrank with the ring, and at 20 slots the doorway was 0.37 long and stopped
        // reading as a doorway at all.
        const halfLap = GAP_ARC / 2 / this.path.perimeter;
```
```ts
            if (this.gapTs.some((g) => Math.abs(((t - g + 1.5) % 1) - 0.5) < halfLap)) continue;
```

- [ ] **Step 4: `update` 接 channels**

签名与内部换成:

```ts
    update(ring: (PaxGroup | null)[], channels: Channel[]): void {
```

`this.updateLanes(ring, left, right)` → `this.updateLanes(ring, channels)`,`updateLanes`/`animateLaneShift`/`playEntry`/`lastLen`/`pendingFlier`/`laneClusters`/`laneFigures`/`laneHome` 里所有 `'left' | 'right'` 的键换成 `FeedSide`(`'far' | 'near'`),两侧的遍历改为遍历 `channels`。`updateLanes` 改成:

```ts
    private updateLanes(ring: (PaxGroup | null)[], channels: Channel[]): void {
        // The live channel is the first one still holding rows: drain order, not screen
        // order. The rest are dimmed, so "this one feeds next" reads without a tutorial.
        const live = channels.find((c) => c.queue.length > 0);
        for (const channel of channels) {
            const active = channel === live;
            const nodes = this.laneClusters[channel.side];
            for (let i = 0; i < nodes.length; i++) {
                const group = channel.queue[i];
                const n = nodes[i];
                if (!group) { n.active = false; continue; }
                n.active = true;
                paintRow(this.laneFigures[channel.side][i], colorOf(group.color), group.count,
                    active ? NO_SHADE : dim);
            }
        }
        // Which channel actually lost its head this tick? NOT necessarily the live one:
        // the tick that empties a channel flips `live` to the next, so keying off the
        // live side would miss that entrant — and its lane slide — exactly once per
        // level, at the hand-over. Compare each channel against its own last length.
        let dropped: Channel | null = null;
        for (const channel of channels) {
            const prev = this.lastLen[channel.side];
            if (prev >= 0 && channel.queue.length < prev) { dropped = channel; break; }
        }
        this.animateLaneShift(dropped ?? live ?? channels[0], channels);
        if (dropped) {
            const group = ring[dropped.entry];
            if (group) this.playEntry(dropped.side, group);
        }
    }
```

`animateLaneShift` 签名改成 `(active: Channel, channels: Channel[])`,内部 `const len = active.queue.length;`、`const dir = active.side === 'far' ? -1 : 1;`,并把 `lastLen` 的更新改成遍历 `channels`:

```ts
        const prev = this.lastLen[active.side];
        for (const c of channels) this.lastLen[c.side] = c.queue.length;
        if (prev < 0 || active.queue.length >= prev) return;
```

`lastLen` 字段声明改成 `private lastLen: Record<FeedSide, number> = { far: -1, near: -1 };`。
`pendingFlier` 改成 `Record<FeedSide, Node | null> = { far: null, near: null }`。
`playEntry(side: FeedSide, group: PaxGroup)` 里的 index 改成 `entryIndex(this.capacity, this.boardIndex, side)`。
`boardingFigureWorldPos` 里的 `this.entries.board / this.capacity` 改成 `this.boardIndex / this.capacity`。

- [ ] **Step 5: 类型检查**

Run: `cd logic && npm run typecheck:view`
Expected: 只剩 `GameController.ts` 报参数不匹配(Task 9 会接上)。`track-view.ts` 自身必须零错误。

- [ ] **Step 6: 提交**

```bash
git add game/assets/scripts/view/track-view.ts
git commit -m "refactor(view): the track draws whatever path core hands it

Drops the module-level segment cache, which keyed on the track's y and
would have served level 2 level 1's shape, and makes the boarding gap an
absolute arc length so a 20-slot ring still has a visible doorway."
```

---

### Task 8: 通道从法线推,每侧前瞻独立 (M7.E2)

**Files:**
- Modify: `game/assets/scripts/view/track-view.ts`

**Interfaces:**
- Consumes: Task 7 的 `this.path` / `this.point` / `this.normal` / `this.feeds`
- Produces: 无新导出

- [ ] **Step 1: 重写 buildLanes**

整个方法换成:

```ts
    /**
     * The feeder channels: a floor slab and the head waiting slots, per feed.
     *
     * Position and heading both come from the ENTRY CELL's own path point and outward
     * normal, not from the shape's widest point — the two only coincide on a shape that
     * is symmetric top to bottom. The trapezoid's entry sits on a slanted edge, so its
     * channel leaves at 15 degrees and everything here follows that automatically.
     *
     * The outward reach is bounded: `dockX + BAND_HALF + LANE_START +
     * (lookahead - 1) * LANE_STEP + 0.25` must stay inside the visible half-width
     * (LANE.edgeLimit, 4.67). validateLevel enforces exactly that, against the same
     * constants, so a level that gets here already fits.
     */
    private buildLanes(parent: Node): void {
        for (const feed of this.feeds) {
            const t = entryIndex(this.capacity, this.boardIndex, feed.side) / this.capacity;
            const dock = this.point(t);
            const out = this.normal(t);
            // Across the lane: the rows stand perpendicular to the way the lane runs.
            const across = new Vec3(-out.y, out.x, 0);
            const first = new Vec3(
                dock.x + out.x * (BAND_HALF + LANE_START),
                dock.y + out.y * (BAND_HALF + LANE_START),
                0,
            );
            const span = LANE_STEP * (feed.lookahead - 1);
            const slabW = span + 0.5;
            // Floor centred on the slots it carries, and turned to follow the lane so a
            // tilted channel's slab tilts with it rather than sticking out square.
            const mid = new Vec3(first.x + out.x * span / 2, first.y + out.y * span / 2, 0);
            const angle = Math.atan2(out.y, out.x) * 180 / Math.PI;

            const shadow = makeShadowSlab(`lane-shadow-${feed.side}`, slabW, BAND_HALF * 2, 0.2, 34);
            shadow.setPosition(mid.x, mid.y - BAND_DROP, BAND_Z - 0.06);
            shadow.setRotationFromEuler(0, 0, angle);
            parent.addChild(shadow);

            // Same white as the ring and as deep, so a channel reads as the track running
            // off to the side.
            const slab = makeSlab(`lane-${feed.side}`, slabW, BAND_HALF * 2, 0.06, BAND, 0.2);
            slab.setPosition(mid.x, mid.y, BAND_Z);
            slab.setRotationFromEuler(0, 0, angle);
            parent.addChild(slab);

            this.laneClusters[feed.side] = [];
            this.laneFigures[feed.side] = [];
            this.laneHome[feed.side] = [];
            for (let i = 0; i < feed.lookahead; i++) {
                const n = makeRow(`wait-${feed.side}-${i}`);
                const figures = n.children.slice();
                // Fixed, unlike the ring's rows: a lane never turns, so its rows are laid
                // out once, across the lane's own direction.
                layoutRow(figures, across.x, across.y);
                this.laneFigures[feed.side].push(figures);
                n.setPosition(first.x + out.x * LANE_STEP * i, first.y + out.y * LANE_STEP * i, 0);
                n.active = false;
                parent.addChild(n);
                this.laneClusters[feed.side].push(n);
                this.laneHome[feed.side].push(n.position.clone());
            }
        }
    }
```

字段声明改成按 `FeedSide` 索引、默认空:

```ts
    /** Head-of-channel waiting rows drawn beside the track, per feed side. */
    private laneClusters: Record<FeedSide, Node[]> = { far: [], near: [] };
    private laneFigures: Record<FeedSide, Node[][]> = { far: [], near: [] };
    private laneHome: Record<FeedSide, Vec3[]> = { far: [], near: [] };
```

- [ ] **Step 2: 车道滑动也跟着法线**

`animateLaneShift` 里 `const dir = active.side === 'far' ? -1 : 1;` 那套横向偏移换成沿法线:

```ts
        // Slide along the lane's own direction, so a tilted channel slides along itself.
        const t = entryIndex(this.capacity, this.boardIndex, active.side) / this.capacity;
        const out = this.normal(t);
        const nodes = this.laneClusters[active.side];
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (!n.isValid || !n.active) continue;
            const home = this.laneHome[active.side][i];
            Tween.stopAllByTarget(n);          // a tick can land before the last slide ends
            n.setPosition(home.x + out.x * LANE_STEP, home.y + out.y * LANE_STEP, home.z);
            tween(n).to(this.tick, { position: home.clone() }).start();
        }
```

- [ ] **Step 3: 进场飞行的起点**

`playEntry` 里 `const from = this.laneHome[side][0];` 保持不变 —— 它已经是通道口那一格,现在自动是沿法线摆好的位置。只需确认 `layoutRow(figures, n.x, n.y)` 用的是**环上**的法线(`this.normal(entryT)` 的切向排布),这一行本来就对,不用改。

- [ ] **Step 4: 类型检查**

Run: `cd logic && npm run typecheck:view`
Expected: 只剩 `GameController.ts` 的调用点报错

- [ ] **Step 5: 提交**

```bash
git add game/assets/scripts/view/track-view.ts
git commit -m "feat(view): channels hang off the entry cell's own outward normal"
```

---

### Task 9: 接线、类型闸门、预览验收 (M7.F)

**Files:**
- Modify: `game/assets/scripts/view/GameController.ts`
- Modify: `game/assets/scripts/core/game-core.ts`(如果它构造 `LoopSystem` 时传了 seed)

**Interfaces:**
- Consumes: Task 7/8 的 `TrackView` 构造函数与 `update`;Task 3 的 `TrackPath`;Task 4 的 `DEFAULT_TRACK`/`DEFAULT_FEEDS`
- Produces: 可运行的游戏

- [ ] **Step 1: 核对 LoopSystem 的所有构造点**

```bash
grep -rn "new LoopSystem(" game logic
```

`shuffleSeed` 现在是第 5 参。传了 seed 的调用要补第 4 参 —— 用关卡自己的 feeds:

```ts
    new LoopSystem(level.loop.capacity, level.loop.boardIndex, level.loop.queue,
                   level.loop.feeds ?? DEFAULT_FEEDS, level.id);
```

(`game-core.ts` 里的实参名按该文件现状对齐。)

- [ ] **Step 2: GameController 接线**

import 加:

```ts
import { DEFAULT_FEEDS, DEFAULT_TRACK, TrackPath, validateTrack } from '../core/index';
```

`buildBoard` 里那三行:

```ts
        this.loopView = new TrackView(loopRoot, level.loop.capacity, LOOP_Y, this.TICK, {
            board: loop.boardIndex, left: loop.entryLeft, right: loop.entryRight,
        });
        this.loopView.update(loop.ring, loop.left, loop.right);
```

换成:

```ts
        this.loopView = new TrackView(
            loopRoot,
            new TrackPath(level.loop.track ?? DEFAULT_TRACK),
            level.loop.capacity, loop.boardIndex,
            level.loop.feeds ?? DEFAULT_FEEDS,
            LOOP_Y, this.TICK,
        );
        this.loopView.update(loop.ring, loop.channels);
```

另一处 `this.loopView?.update(lp.ring, lp.left, lp.right);` 换成 `this.loopView?.update(lp.ring, lp.channels);`。

再在 `buildBoard` 里那句 `new TrackView(...)` 之前加一道警告 —— 永不阻断游戏,只是让一个画不出来的轨道在控制台留下痕迹:

```ts
        // validateTrack is the drawability gate; the offline tool already fails the build
        // on it, so anything reaching here is either hand-edited or from an older file.
        for (const problem of validateTrack(level)) console.warn(`[track] ${problem}`);
```

import 里补上 `validateTrack`。

- [ ] **Step 3: 类型闸门 + 全量测试**

Run: `cd logic && npm run typecheck:view`
Expected: 零错误

Run: `cd logic && npm test`
Expected: 全绿

- [ ] **Step 4: 五种形状逐个预览**

在编辑器里依次跑第 1、2、3、9、10 关(四边形 20 格 / 六边形 16 / 梯形 16 / 圆形 8 单近 / 椭圆 8 单近),每关确认:

1. 轨道形状对得上,行沿路径均匀流动,过弯不挤不散;
2. 底部缺口在正中、对着停车场,乘客从缺口起飞去停车位;
3. 通道贴在轨道侧面,数量对(单通道关另一侧是**完整的白带,没有缺口**);
4. 梯形那关通道略微下倾,但不压到停车位面板;
5. 未供应的通道是暗的;
6. Draw call ≤ 450,帧率 60。

任何一条不过,记下是哪关哪一条,不要继续往下。

- [ ] **Step 5: 提交**

```bash
git add game/assets/scripts/view/GameController.ts game/assets/scripts/core/game-core.ts
git commit -m "feat(view): each level draws the track its data asks for"
```

- [ ] **Step 6: 补 .meta**

编辑器导入完新文件后:

```bash
git status --short
git add game/assets/scripts/core/track-shapes.ts.meta game/assets/scripts/core/track-path.ts.meta game/assets/scripts/core/level-gen.ts.meta
git commit -m "chore: import metadata for the new core modules"
```

`level-gen.ts.meta` 是 M6 遗留的未跟踪文件,一并带上。

---

## Self-Review

**1. Spec coverage**

| spec 章节 | 落在哪 |
|---|---|
| 硬约束:几何预算 | Task 2 的 `TRACK_BOX`、Task 3 的 `LANE`/`maxLookahead`,测试断言外框与外缘 |
| 五个形状(含参数表) | Task 2 |
| 格数必须是 4 的倍数 | Task 3(`CAPACITY_OPTIONS`、`entryIndex`)、Task 5(规则 2)、Task 3 测试里 hex-18/oval-14 的反例 |
| 行距上下界 | Task 3 `ROW_SPACING_*` + `capacityOptions`,Task 5 规则 2 |
| 缺口改绝对弧长 | Task 3 `GAP_ARC`、Task 7 Step 3 |
| 难度模型 + 10 关曲线 | Task 6(`TRACK_CURVE`、`planningWindow`) |
| 数据格式 | Task 4 Step 1 |
| 路径几何搬进 core | Task 2、3、7 |
| 入口格与管道 | Task 3 `entryIndex` + 两条管道拍数测试 |
| LoopSystem 泛化 | Task 4 |
| 7 条校验规则 | Task 5,落在新函数 `validateTrack` 上(逐条对应一个拒绝用例);调用点在 Task 6(生成器 + 离线工具)与 Task 9(视图 warn) |
| 性能前置 | Task 1 |
| 测试清单 1–10 | Task 2(1、5)、Task 3(2、3、4)、Task 5(6)、Task 4(7、10)、Task 3+6(8)、Task 6(9) |
| 里程碑 A–F | Task 1 / 2+3 / 4 / 5+6 / 7+8 / 9 |

一处**刻意偏离 spec**:spec 说这 7 条规则加进 `validateLevel`,计划改成新函数 `validateTrack`。理由见 Task 5 开头 —— `validateLevel` 是 `isSolvable` 的判据,而 core 测试里的合成关卡故意用 2/4/5/6 格的环且从不绘制,把可绘制性塞进去会用一个无关的理由宣布它们不可解。spec 的 `## 校验规则` 一节已同步改名。

除此之外无缺口。

**2. Placeholder scan**

Task 1 的提交信息里 `<BASELINE>`/`<RESULT>` 与"走的是哪条路"是**实测值占位**,必须由执行者填真数字 —— 这是刻意的,不是待办。其余无 TBD、无"类似 Task N"、无只描述不给码的步骤。

**3. Type consistency**

- `Pt`(core,`{x,y}`)与 `Vec3`(view)分界清楚:`TrackPath.pointAt/normalAt` 只吞吐 `Pt`,Task 7 的 `this.point/this.normal` 负责转 `Vec3` 并抬到 `cy`。
- `FeedSide` 在 track-path.ts 定义,types.ts / loop-system.ts / track-view.ts 一致使用 `'far' | 'near'`,不再出现 `'left' | 'right'`。
- `Channel`(有 `queue`)只在 loop-system.ts 定义;`Feed`(只有 `side`/`lookahead`)只在 types.ts 定义。Task 7/8 用 `Feed` 建通道、用 `Channel` 更新内容,两者不混。
- `entryIndex(capacity, boardIndex, side)` 三参签名在 Task 3、5、6、7、8 完全一致。
- `capacityOptions` / `maxLookahead` 都只吃 `TrackShape`,不吃 capacity。
- `TrackView` 构造函数七参顺序在 Task 7 定义、Task 9 调用,一致。
