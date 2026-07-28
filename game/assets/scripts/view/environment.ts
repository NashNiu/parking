import { Node, DirectionalLight, Color, director, MeshRenderer } from 'cc';
import { makeLitBox } from './placeholder';

/**
 * Adds cartoon lighting + a soft stage floor + warm background decor.
 * Lights are attached to the scene; floor/decor become children of `root`.
 *
 * The scene-level light + ambient setup is idempotent (guarded by a
 * `KeyLight` name check) so repeated calls across restarts don't leak
 * additional DirectionalLight nodes or keep re-lifting ambient values.
 * Floor/decor are parented under `root` and are destroyed/recreated with
 * the board on every restart, so those are intentionally left unguarded.
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

    // Soft rounded stage floor sitting behind/under the board; receives shadows
    // from cars/passengers above it (Task B replaces this with a real platform).
    const floor = makeLitBox('Floor', 16, 10, 0.4, new Color(250, 236, 210));
    floor.setPosition(0, -0.5, -2.2);
    const floorMr = floor.getComponent(MeshRenderer);
    if (floorMr) floorMr.receiveShadow = MeshRenderer.ShadowReceivingMode.ON;
    root.addChild(floor);
}
