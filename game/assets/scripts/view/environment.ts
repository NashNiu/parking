import { Node, DirectionalLight, Color, director } from 'cc';
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
        dl.illuminance = 130000;
        dl.color = new Color(255, 250, 235);
        lightNode.setRotationFromEuler(-55, -40, 0);
        scene.addChild(lightNode);

        // Keep ambient LOW so the directional light actually shapes the forms
        // (a bright ambient washes shading out to flat). Warm, dim fill.
        const globals = scene.globals;
        if (globals && globals.ambient) {
            globals.ambient.skyColor = new Color(120, 135, 160, 255) as unknown as any;
            globals.ambient.skyIllum = 8000;
            globals.ambient.groundAlbedo = new Color(90, 80, 70, 255) as unknown as any;
        }
    }

    // Soft rounded stage floor sitting behind/under the board.
    const floor = makeLitBox('Floor', 16, 10, 0.4, new Color(250, 236, 210));
    floor.setPosition(0, -0.5, -2.2);
    root.addChild(floor);

    // A couple of far background slabs for depth (warm gradient feel, no textures).
    const back1 = makeLitBox('BackFar', 30, 18, 0.4, new Color(255, 214, 170));
    back1.setPosition(0, 4, -6);
    root.addChild(back1);
    const back2 = makeLitBox('BackNear', 26, 14, 0.4, new Color(255, 232, 196));
    back2.setPosition(0, 2, -4.5);
    root.addChild(back2);
}
