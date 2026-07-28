import { Node, DirectionalLight, Color, director, MeshRenderer, renderer } from 'cc';
import { makeLitBox } from './placeholder';

/*
 * Shadow-related enums (ShadowType, PCFType) are NOT flat exports of the 'cc'
 * module in Cocos Creator 3.8.7 — verified against the engine's own
 * `editor/assets/default_renderpipeline/builtin-pipeline.ts`, which accesses
 * them as `renderer.scene.ShadowType` / `renderer.scene.PCFType` after
 * `import { renderer } from 'cc'`. `import { ShadowType } from 'cc'` would
 * fail to resolve (scene-graph/scene-globals.ts imports ShadowType from
 * render-scene internally but never re-exports it). Use `renderer.scene.*`.
 */

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
        dl.shadowEnabled = true;
        dl.shadowDistance = 40;
        dl.shadowPcf = renderer.scene.PCFType.SOFT_2X; // soft shadow edges
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

        // Real-time shadow map so cars/passengers ground themselves visually.
        if (globals && globals.shadows) {
            globals.shadows.enabled = true;
            globals.shadows.type = renderer.scene.ShadowType.ShadowMap;
            globals.shadows.shadowMapSize = 2048;
            globals.shadows.maxReceived = 4;
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
