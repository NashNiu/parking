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
    if (!scene.getChildByName('KeyLight')) {
        // Strong key light from the upper-front-right for clear cartoon shading.
        const lightNode = new Node('KeyLight');
        const dl = lightNode.addComponent(DirectionalLight);
        dl.illuminance = 150000;
        dl.color = new Color(255, 248, 230);
        // Real-time ShadowMap is disabled: on the ~52°-tilted board it casts long,
        // offset, hard shadows onto the slanted ground and is expensive. We use
        // fake blob shadows (blob-shadow.ts) attached to each car/passenger instead.
        dl.shadowEnabled = false;
        lightNode.setRotationFromEuler(-55, -35, 0);
        scene.addChild(lightNode);

        // Keep ambient LOW so the directional light actually shapes the forms
        // (a bright ambient washes shading out to flat). Warm, dim fill.
        const globals = scene.globals;
        if (globals && globals.ambient) {
            globals.ambient.skyColor = new Color(120, 135, 160, 255) as unknown as any;
            globals.ambient.skyIllum = 8000;
            globals.ambient.groundAlbedo = new Color(90, 80, 70, 255) as unknown as any;
        }

        // ShadowMap disabled (see note above) — fake blob shadows are used instead.
        if (globals && globals.shadows) {
            globals.shadows.enabled = false;
        }
    }
}
