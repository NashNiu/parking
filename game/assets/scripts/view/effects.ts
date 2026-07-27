import { Node, Vec3, Color, tween, MeshRenderer, utils, primitives } from 'cc';
import { unlitMaterial, setEmissive } from './materials';

let activeParticles = 0;
const MAX_PARTICLES = 80;

/**
 * Reset the particle budget. Call on level (re)load: particles are parented to
 * the board, and when the board is destroyed mid-flight their tweens are dropped
 * without running killParticle, so the counter would otherwise ratchet up across
 * restarts until it permanently hits the cap and blocks all effects.
 */
export function resetParticleBudget(): void {
    activeParticles = 0;
}

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

function spawnBoxParticle(parent: Node, at: Vec3, color: Color, size: number): Node | null {
    if (activeParticles >= MAX_PARTICLES) return null;
    activeParticles++;
    const n = new Node('confetti');
    const mr = n.addComponent(MeshRenderer);
    mr.mesh = utils.createMesh(primitives.box({ width: size, height: size * 0.3, length: size }));
    mr.material = unlitMaterial(color);
    n.setPosition(at);
    parent.addChild(n);
    return n;
}

const CONFETTI_COLORS = [
    new Color(255, 80, 80), new Color(255, 200, 40), new Color(80, 200, 255),
    new Color(120, 255, 140), new Color(200, 120, 255), new Color(255, 140, 200),
];

/**
 * Victory confetti: ~16 small colored boxes launched outward from `at`, falling
 * under simulated gravity while spinning and shrinking, then self-destructing.
 * Shares the `spawnBoxParticle`/`killParticle` accounting with the sphere
 * particles above, so it respects the same MAX_PARTICLES cap and is swept by
 * `resetParticleBudget()` on restart along with everything else.
 */
export function confetti(parent: Node, at: Vec3): void {
    const g = 4.5; // gravity, world units/s^2
    for (let i = 0; i < 16; i++) {
        const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        const size = 0.1 + Math.random() * 0.08;
        const p = spawnBoxParticle(parent, at, color, size);
        if (!p) break;
        const vx = (Math.random() - 0.5) * 3.0;
        const vz = (Math.random() - 0.5) * 3.0;
        const vy = 1.2 + Math.random() * 1.6;
        const spinX = (Math.random() - 0.5) * 720;
        const spinY = (Math.random() - 0.5) * 720;
        const dur = 0.8 + Math.random() * 0.4;
        tween({ t: 0 })
            .to(dur, { t: 1 }, {
                onUpdate: (target?: { t: number }) => {
                    if (!p.isValid) return;
                    const t = target ? target.t : 1;
                    const elapsed = t * dur;
                    p.setPosition(
                        at.x + vx * elapsed,
                        at.y + vy * elapsed - 0.5 * g * elapsed * elapsed,
                        at.z + vz * elapsed,
                    );
                    p.setRotationFromEuler(spinX * t, spinY * t, 0);
                    const s = Math.max(0.001, 1 - t);
                    p.setScale(s, s, s);
                },
            })
            .call(() => killParticle(p))
            .start();
    }
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
