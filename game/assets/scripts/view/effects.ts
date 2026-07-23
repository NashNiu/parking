import { Node, Vec3, Color, tween, MeshRenderer, utils, primitives } from 'cc';
import { unlitMaterial, setEmissive } from './materials';

let activeParticles = 0;
const MAX_PARTICLES = 80;

/** Tap feedback: quick squash then spring back. */
export function squash(body: Node): void {
    const s = body.scale.clone();
    tween(body)
        .to(0.06, { scale: new Vec3(s.x * 1.15, s.y * 0.8, s.z) })
        .to(0.12, { scale: s }, { easing: 'backOut' })
        .start();
}

/** Move to target with a slight overshoot landing. */
export function overshoot(node: Node, target: Vec3, dur: number, onDone?: () => void): void {
    tween(node)
        .to(dur, { position: target }, { easing: 'backOut' })
        .call(() => onDone && onDone())
        .start();
}

/**
 * Red emissive pulse (used when a car can't exit).
 * Fades bright -> dark: the tweened factor `k` starts at 1 and ends at 0
 * (tween {t:1}->{t:0}, reading the target's own `.t`, since `onUpdate`'s
 * `ratio` argument goes the other way, 0->1, over the tween's duration).
 */
export function flash(node: Node, color: Color = new Color(255, 60, 60)): void {
    setEmissive(node, color);
    tween({ t: 1 })
        .to(0.3, { t: 0 }, {
            onUpdate: (target?: { t: number }) => {
                const k = target ? target.t : 0;
                setEmissive(node, new Color(color.r * k, color.g * k, color.b * k));
            },
        })
        .call(() => setEmissive(node, new Color(0, 0, 0)))
        .start();
}

function spawnParticle(parent: Node, at: Vec3, color: Color, size: number): Node | null {
    if (activeParticles >= MAX_PARTICLES) return null;
    activeParticles++;
    const n = new Node('fx');
    const mr = n.addComponent(MeshRenderer);
    mr.mesh = utils.createMesh(primitives.sphere(size, { segments: 8 }));
    mr.material = unlitMaterial(color);
    n.setPosition(at);
    parent.addChild(n);
    return n;
}

function killParticle(n: Node): void {
    activeParticles--;
    n.destroy();
}

/** A small puff of dust that drifts up and fades (scales to zero) then self-destructs. */
export function dustBurst(parent: Node, at: Vec3): void {
    for (let i = 0; i < 5; i++) {
        const p = spawnParticle(parent, at, new Color(210, 200, 180), 0.12);
        if (!p) break;
        const dx = (i - 2) * 0.12;
        tween(p)
            .to(0.5, { position: new Vec3(at.x + dx, at.y + 0.5, at.z), scale: new Vec3(0.01, 0.01, 0.01) })
            .call(() => killParticle(p))
            .start();
    }
}

/** Rising stars burst (used on depart / win). */
export function stars(parent: Node, at: Vec3, colors: Color[]): void {
    for (let i = 0; i < 8; i++) {
        const c = colors[i % colors.length];
        const p = spawnParticle(parent, at, c, 0.14);
        if (!p) break;
        const ang = (i / 8) * Math.PI * 2;
        const tx = at.x + Math.cos(ang) * 1.2;
        const ty = at.y + 0.8 + Math.sin(ang) * 0.6;
        tween(p)
            .to(0.6, { position: new Vec3(tx, ty, at.z), scale: new Vec3(0.01, 0.01, 0.01) })
            .call(() => killParticle(p))
            .start();
    }
}
