import { Node, DirectionalLight, Color, director, Camera, postProcess } from 'cc';

/**
 * Pitch of the key light, in degrees, as a node euler-X.
 *
 * EXPORTED because two other things are now derived from it and must not be allowed to drift:
 * the drop shadow's offset (`car-builder.ts`, which needs the direction the light travels) and
 * the car roof's normal tilts (`car-mesh.ts`, which needs the screen-vertical component to be
 * there at all). At -55 the light travels (0, -0.82, -0.57) in board space: mostly down the
 * screen, partly into the board. Level it out toward the board normal and the cars go flat and
 * lose their shadows, with nothing in the console to say why.
 */
export const KEY_LIGHT_PITCH_DEG = -55;

/**
 * Adds cartoon lighting attached to the scene.
 *
 * The scene-level light + ambient setup is idempotent (guarded by a
 * `KeyLight` name check) so repeated calls across restarts don't leak
 * additional DirectionalLight nodes or keep re-lifting ambient values.
 * (The old stage floor lived here; it's replaced by the platform/lot
 * created in scene-stage.ts's setupStage.)
 */
export function setupEnvironment(root: Node): void {
    const scene = director.getScene()!;
    let lightNode = scene.getChildByName('KeyLight');
    if (!lightNode) {
        // Soft key light from straight above-front for gentle cartoon shaping.
        lightNode = new Node('KeyLight');
        const dl = lightNode.addComponent(DirectionalLight);
        // Key light for the 3D car models (real PBR geometry): bright enough that
        // low-luminance paints like red (244,67,72) read as their true vivid color
        // rather than a murky dark. (The earlier dim/flat setup existed only to make
        // the old code-gen boxes' flat faces match — obsolete now that cars are
        // real models that shade correctly on their own curved geometry.)
        dl.illuminance = 70000;
        dl.color = new Color(255, 250, 240);
        // Real-time ShadowMap is disabled: on the ~52°-tilted board it casts long,
        // offset, hard shadows onto the slanted ground and is expensive. We use
        // fake blob shadows (blob-shadow.ts) attached to each car/passenger instead.
        dl.shadowEnabled = false;
        scene.addChild(lightNode);
    }
    // Front-on (yaw 0) so the lighting is left/right symmetric: with a yawed key
    // light, perspective reveals the left car's right side-face and the right car's
    // left side-face, which catch different brightness and make two same-color cars
    // read as different shades. Straight-front-above keeps identical cars identical.
    // Applied every call (not just on creation) so a lingering KeyLight is corrected.
    lightNode.setRotationFromEuler(KEY_LIGHT_PITCH_DEG, 0, 0);

    // Neutral ambient fill so shadowed sides aren't crushed to black, while the key
    // light above does the shaping. Neutral (not blue) so reds stay red.
    const globals = scene.globals;
    if (globals && globals.ambient) {
        globals.ambient.skyColor = new Color(208, 212, 218, 255) as unknown as any;
        globals.ambient.skyIllum = 20000;
        globals.ambient.groundAlbedo = new Color(150, 145, 138, 255) as unknown as any;
    }

    // ShadowMap disabled (see note above) — fake blob shadows are used instead.
    if (globals && globals.shadows) {
        globals.shadows.enabled = false;
    }
}

/**
 * Turn on FXAA for the board camera.
 *
 * The board had NO anti-aliasing of any kind, and the reason was two switches in the engine
 * module config rather than a missing setting: `custom-pipeline-post-process` was off, which
 * is where FXAA lives, and `gfx-webgl2` was off, which is what MSAA on a render target would
 * need. Thirty-six cars parked at thirty-six different angles is close to the worst case for
 * that -- every body edge is a diagonal, and a diagonal with no AA is a staircase. It reads
 * as the models having been sharpened.
 *
 * FXAA rather than MSAA on purpose: it is a fullscreen shader pass, so it works on the WebGL
 * 1 backend this project builds for, and enabling the WebGL 2 backend to get MSAA would swap
 * the graphics backend under a build that is only just working on device.
 *
 * ONLY the board camera. FXAA smooths high-contrast edges, and the highest-contrast edges on
 * this screen are the HUD's type -- running it over the UI camera would soften every label to
 * buy nothing, since 2D sprites and text have no jagged diagonals to fix.
 *
 * Guarded, in the same shape and for the same reason as `tryStandard` in materials.ts: turning
 * a camera's post-process on makes it render offscreen first, and if that fails on some device
 * the failure is a black screen, not a warning. On any throw the camera is put back exactly as
 * it was, which is the state that has been shipping.
 */
export function setupAntiAliasing(camera: Camera | null): void {
    if (!camera) return;
    const scene = director.getScene();
    if (!scene) return;
    // Idempotent by name, like KeyLight above: `setupEnvironment` runs again on every level.
    const existing = scene.getChildByName('PostProcess');
    if (existing) {
        const pp = existing.getComponent(postProcess.PostProcess);
        if (pp) {
            camera.postProcess = pp;
            camera.usePostProcess = true;
        }
        return;
    }
    try {
        const node = new Node('PostProcess');
        const pp = node.addComponent(postProcess.PostProcess);
        // By registered name: the FXAA component is `cc.FXAA` in the engine but is not
        // exported from the `postProcess` namespace, so there is no class to hand to the
        // typed overload.
        node.addComponent('cc.FXAA');
        scene.addChild(node);
        camera.postProcess = pp;
        camera.usePostProcess = true;
    } catch (e) {
        console.warn('[environment] FXAA unavailable, rendering without anti-aliasing', e);
        camera.usePostProcess = false;
        camera.postProcess = null;
    }
}
