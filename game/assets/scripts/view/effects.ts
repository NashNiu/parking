import { Node, Vec3, Color, tween, Tween, MeshRenderer, utils, primitives } from 'cc';
import { unlitMaterial, setEmissive } from './materials';
import { COLORS } from './colors';

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

/**
 * Tag for the squash tween, so a new squash can cancel the one still running on that node
 * WITHOUT touching the other tweens a car carries (the drive, the nudge, the park refit).
 * `Tween.stopAllByTarget` would have killed those too.
 */
const SQUASH_TAG = 8101;

/**
 * Each node's RESTING scale, captured the first time it is squashed -- at which point no
 * squash is running, so what is read is genuinely the rest pose. Every subsequent squash
 * springs back to this rather than to whatever scale the node happens to be at.
 *
 * A WeakMap, so a car's entry goes when the car does.
 */
const restScale = new WeakMap<Node, Vec3>();

/**
 * Tap feedback: quick squash then spring back.
 *
 * The spring-back target must be the node's RESTING scale, not its current one. A refused
 * tap squashes the same body TWICE -- once from `onTap`, once when `playShake`'s nudge
 * reaches the blocker -- and the second lands inside the first on 99.2% of refused taps
 * over the ten shipped levels: the nudge leg is floored at NUDGE_MIN (0.12s) while this
 * tween runs 0.18s, and a blocked car's gap is 0.01 board units at the median, nowhere
 * near the 0.85 it would take to clear.
 *
 * Reading `body.scale` at that moment captured a MID-ANIMATION value as the rest pose, and
 * the error compounded tap over tap: 0.987 x 1.018 after one refusal, 36% out in aspect
 * after ten, 85% after twenty. Blocked cars are precisely the ones a player taps again and
 * again, so cars of the SAME capacity drifted to visibly different sizes -- and a body left
 * 19% too wide reads as intruding on a lane core knows it is clear of.
 */
export function squash(body: Node): void {
    let rest = restScale.get(body);
    if (!rest) {
        rest = body.scale.clone();
        restScale.set(body, rest);
    }
    // Cancel any squash still in flight and put the node back on its rest pose, so the two
    // tweens cannot fight over `scale` and the one starting here begins from a known state.
    Tween.stopAllByTag(SQUASH_TAG, body);
    body.setScale(rest);
    tween(body)
        .tag(SQUASH_TAG)
        .to(0.06, { scale: new Vec3(rest.x * 1.15, rest.y * 0.8, rest.z) })
        .to(0.12, { scale: rest.clone() }, { easing: 'backOut' })
        .start();
}

/**
 * Red emissive pulse (used when a car can't exit).
 *
 * Note what this CANNOT do: name one car. `setEmissive` mutates the material in place and
 * `litMaterial` is cached per COLOUR, with `recolorCar` handing the same instance to every
 * car sharing a paint -- so flashing a single car lights every car of its colour, about
 * eighteen of them on level 1. Fine as "something happened" feedback, useless as "this is
 * the one". A geometric ring that could name the blocker was built and then removed at the
 * same time as the lane guides; see the README.
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

/**
 * Confetti takes the PLAY PALETTE, lifted, rather than a list of its own.
 *
 * It used to be six hand-written near-matches -- (255,80,80), (255,200,40), (80,200,255),
 * (120,255,140), (200,120,255), (255,140,200) -- chosen to look like the cars without being
 * them. That is a second copy of a palette, and it broke the moment the first one moved: the
 * cars' purple went to magenta when colors.ts was rebuilt in HCL, while this list still held a
 * blue-violet, so a win threw confetti in a colour no car on the board had.
 *
 * Derived, it cannot drift again. The lift is what the hand-written list was really for: this
 * is celebration on top of a dimmed board, so the colours want to be brighter than the cars
 * they came from, and 0.30 toward white is roughly the gap the old list had.
 */
const CONFETTI_LIFT = 0.30;
const CONFETTI_COLORS = Object.values(COLORS).map((c) => new Color(
    Math.round(c.r + (255 - c.r) * CONFETTI_LIFT),
    Math.round(c.g + (255 - c.g) * CONFETTI_LIFT),
    Math.round(c.b + (255 - c.b) * CONFETTI_LIFT),
));

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

/**
 * A small puff of dust that drifts up and fades (scales to zero) then self-destructs.
 *
 * PALE, where it was (116, 122, 133). It is thrown under a car's wheels and so lands on the lot,
 * and the lot went from 170 luminance to 102 when the scene split into pavement and asphalt (see
 * the head of scene-stage) -- which left this puff sitting 2 units off the surface it is drawn
 * against. Not dimmer: INVISIBLE, and invisible without erroring, on the one effect that tells
 * the player a car actually moved.
 *
 * At 174 it clears the asphalt by 72, which is roughly the 49 it used to clear the old lot by,
 * with a little more because it now also has to work over the ring road (93) that cars drive out
 * along. Kicked-up dust being lighter than the tarmac is also just what dust looks like; the old
 * value was only ever darker than its background because the background was pale.
 */
export function dustBurst(parent: Node, at: Vec3): void {
    for (let i = 0; i < 5; i++) {
        const p = spawnParticle(parent, at, new Color(168, 175, 188), 0.12);
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
