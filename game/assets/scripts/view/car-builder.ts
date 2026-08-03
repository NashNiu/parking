import { Node, Color, MeshRenderer, utils, primitives } from 'cc';
import { litMaterial, unlitMaterial } from './materials';
import { Dir } from './placeholder';
import { blobShadow } from './blob-shadow';

export type Cap = 'small' | 'medium' | 'big';

function litBox(name: string, w: number, h: number, d: number, color: Color): Node {
    const n = new Node(name);
    const mr = n.addComponent(MeshRenderer);
    mr.mesh = utils.createMesh(primitives.box({ width: w, height: h, length: d }));
    mr.material = litMaterial(color);
    mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.ON;
    return n;
}

function unlitBox(name: string, w: number, h: number, d: number, color: Color): Node {
    const n = new Node(name);
    const mr = n.addComponent(MeshRenderer);
    mr.mesh = utils.createMesh(primitives.box({ width: w, height: h, length: d }));
    mr.material = unlitMaterial(color);
    mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.ON;
    return n;
}

function wheel(name: string, r: number, color: Color): Node {
    const n = new Node(name);
    const mr = n.addComponent(MeshRenderer);
    // cylinder axis is Y by default; rotate so it lies like a wheel (axis along X).
    mr.mesh = utils.createMesh(primitives.cylinder(r, r, r * 0.5, { radialSegments: 16 }));
    mr.material = litMaterial(color);
    mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.ON;
    n.setRotationFromEuler(0, 0, 90);
    return n;
}

/**
 * A clean, FLAT direction arrow: a shaft box plus a two-blade chevron head, all thin
 * along Z so the whole thing lies flush on the roof instead of standing up like a
 * raised bar. Built pointing "forward" (local +Y); the caller rotates the returned
 * node about Z to aim it per `dir`.
 */
function roofArrow(totalLen: number, thin: number): Node {
    const arrow = new Node('arrow');
    const white = new Color(255, 255, 255);

    const shaftLen = totalLen * 0.52;
    const shaftW = totalLen * 0.22;
    const tailY = -totalLen / 2;
    const shaft = unlitBox('shaft', shaftW, shaftLen, thin, white);
    shaft.setPosition(0, tailY + shaftLen / 2, 0);
    arrow.addChild(shaft);

    // Chevron head: two blades meeting at the tip (apex), splayed back and outward
    // so the silhouette reads unmistakably as an arrowhead, not a stub.
    const apexY = totalLen / 2;
    const bladeLen = totalLen * 0.46;
    const bladeW = totalLen * 0.18;
    const angleDeg = 38;
    const angleRad = (angleDeg * Math.PI) / 180;
    for (const side of [-1, 1] as const) {
        const blade = unlitBox(`head${side}`, bladeW, bladeLen, thin, white);
        blade.setPosition(
            side * (bladeLen / 2) * Math.sin(angleRad),
            apexY - (bladeLen / 2) * Math.cos(angleRad),
            0,
        );
        blade.setRotationFromEuler(0, 0, side * angleDeg);
        arrow.addChild(blade);
    }
    return arrow;
}

/** Build a cartoon car sized to its footprint. Returns root (move this) and body (animate this). */
export function buildCar(
    name: string, sizeX: number, sizeY: number, color: Color, dir: Dir, cap: Cap,
): { root: Node; body: Node } {
    const root = new Node(name);

    // Fake contact shadow tucked under the car (lies against the board plane).
    const shadow = blobShadow('shadow', sizeX * 0.9, sizeY * 0.5);
    shadow.setPosition(0, -sizeY * 0.32, -0.06);
    root.addChild(shadow);

    const depth = 0.55;
    const dark = new Color(40, 44, 52);
    const windshieldGlass = new Color(55, 85, 115); // darker tint for the windshield
    const sideGlass = new Color(160, 210, 235); // lighter steel-blue for side windows
    const warmHeadlight = new Color(255, 244, 200);
    const redTaillight = new Color(220, 40, 40);

    // Body = chassis + cabin. Cabin height/window count vary by capacity (rounder
    // look: the cabin is a smaller, centrally-inset box sitting within the chassis
    // footprint rather than a boxy tower — box primitives can't chamfer corners, so
    // this proportion is the cheap approximation).
    const body = new Node('body');
    root.addChild(body);
    const chassis = litBox('chassis', sizeX * 0.92, sizeY * 0.62, depth, color);
    chassis.setPosition(0, -sizeY * 0.12, 0);
    body.addChild(chassis);
    const cabinH = cap === 'small' ? 0.34 : cap === 'medium' ? 0.42 : 0.5;
    const cabin = litBox('cabin', sizeX * 0.66, sizeY * cabinH, depth * 0.9, color);
    cabin.setPosition(0, sizeY * 0.22, 0);
    body.addChild(cabin);

    // Windshield: single dark-tinted patch painted on the cabin's forward (top) face.
    const windshield = litBox('windshield', sizeX * 0.46, sizeY * cabinH * 0.55, 0.05, windshieldGlass);
    windshield.setPosition(0, sizeY * 0.22, depth * 0.9 / 2 + 0.01);
    body.addChild(windshield);

    // Side windows: a strip of light steel-blue windows along the two long edges of
    // the chassis, like bus windows seen from above. Count scales with capacity.
    const sideWinCounts: Record<Cap, number> = { small: 2, medium: 3, big: 4 };
    const totalSideWin = sideWinCounts[cap];
    const leftCount = Math.ceil(totalSideWin / 2);
    const rightCount = totalSideWin - leftCount;
    const chassisYCenter = -sizeY * 0.12;
    const chassisYSpan = sizeY * 0.62;
    const sideWinZ = depth / 2 + 0.01;
    const placeSideWindows = (count: number, xSign: number): void => {
        if (count <= 0) return;
        const usedSpan = chassisYSpan * 0.7;
        const segLen = usedSpan / count;
        const startY = chassisYCenter - usedSpan / 2 + segLen / 2;
        for (let i = 0; i < count; i++) {
            const win = litBox(`sideWin${xSign}_${i}`, sizeX * 0.05, segLen * 0.7, 0.05, sideGlass);
            win.setPosition(xSign * sizeX * 0.44, startY + i * segLen, sideWinZ);
            body.addChild(win);
        }
    };
    placeSideWindows(leftCount, -1);
    placeSideWindows(rightCount, 1);

    // Headlights (front, warm white) and taillights (rear, red) on the `dir` axis.
    const lightZ = depth / 2 + 0.01;
    const front =
        dir === 'up' ? { axis: 'y' as const, sign: 1 } :
        dir === 'down' ? { axis: 'y' as const, sign: -1 } :
        dir === 'left' ? { axis: 'x' as const, sign: -1 } :
        { axis: 'x' as const, sign: 1 };
    const placeLights = (axis: 'x' | 'y', sign: number, color2: Color, namePrefix: string): void => {
        const faceHalf = (axis === 'y' ? sizeY : sizeX) / 2;
        const facePos = sign * faceHalf * 0.94;
        const spreadHalf = (axis === 'y' ? sizeX : sizeY) * 0.28;
        for (const spread of [-1, 1] as const) {
            const light = unlitBox(`${namePrefix}${spread}`, 0.09, 0.07, 0.05, color2);
            const lx = axis === 'y' ? spread * spreadHalf : facePos;
            const ly = axis === 'y' ? facePos : spread * spreadHalf;
            light.setPosition(lx, ly, lightZ);
            body.addChild(light);
        }
    };
    placeLights(front.axis, front.sign, warmHeadlight, 'headlight');
    placeLights(front.axis, -front.sign, redTaillight, 'taillight');

    // Four wheels near the corners (slightly below the chassis, in front of the body plane).
    const wr = Math.min(sizeX, sizeY) * 0.16;
    const wx = sizeX * 0.34, wy = -sizeY * 0.3, wz = depth * 0.35;
    for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
        const w = wheel('wheel', wr, dark);
        w.setPosition(sx * wx, sy < 0 ? wy : wy, sy > 0 ? wz : -wz);
        body.addChild(w);
    }

    // Roof direction arrow: flat (thin along Z), resting just above the chassis's
    // outer face so it reads as painted onto the roof rather than floating above it.
    const shortDim = Math.min(sizeX, sizeY);
    const arrow = roofArrow(shortDim * 0.6, 0.04);
    const off = shortDim * 0.16;
    const arrowZ = depth / 2 + 0.02;
    switch (dir) {
        case 'up': arrow.setPosition(0, off, arrowZ); arrow.setRotationFromEuler(0, 0, 0); break;
        case 'down': arrow.setPosition(0, -off, arrowZ); arrow.setRotationFromEuler(0, 0, 180); break;
        case 'left': arrow.setPosition(-off, 0, arrowZ); arrow.setRotationFromEuler(0, 0, 90); break;
        case 'right': arrow.setPosition(off, 0, arrowZ); arrow.setRotationFromEuler(0, 0, -90); break;
    }
    body.addChild(arrow);

    return { root, body };
}
