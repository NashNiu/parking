import { Node, DirectionalLight, Vec3, Color, director } from 'cc';
import { makeLitBox } from './placeholder';

/**
 * Adds cartoon lighting + a soft stage floor + warm background decor.
 * Lights are attached to the scene; floor/decor become children of `root`.
 */
export function setupEnvironment(root: Node): void {
    // Key directional light, angled from upper-front for soft cartoon shading.
    const lightNode = new Node('KeyLight');
    const dl = lightNode.addComponent(DirectionalLight);
    dl.illuminance = 80000;
    dl.color = new Color(255, 250, 235);
    lightNode.setRotationFromEuler(-50, -30, 0);
    director.getScene()!.addChild(lightNode);

    // Lift ambient so shadows read as soft, not black (warm sky / warm ground bounce).
    const globals = director.getScene()!.globals;
    if (globals && globals.ambient) {
        globals.ambient.skyColor = new Color(180, 200, 235, 255) as unknown as any;
        globals.ambient.groundAlbedo = new Color(150, 130, 110, 255) as unknown as any;
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
