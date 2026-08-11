import { Node, DirectionalLight, Color, director } from 'cc';

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
    lightNode.setRotationFromEuler(-55, 0, 0);

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
