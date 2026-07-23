import { Node, Label, UITransform, Color, Layers } from 'cc';

function canvasHeight(canvas: Node): number {
    const ct = canvas.getComponent(UITransform);
    return ct ? ct.height : 1280;
}

function makeLabel(parent: Node, name: string, fontSize: number, y: number): Label {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform);
    const label = n.addComponent(Label);
    label.fontSize = fontSize;
    label.lineHeight = Math.round(fontSize * 1.2);
    label.color = Color.WHITE.clone();
    parent.addChild(n);
    n.setPosition(0, y, 0);
    return label;
}

/**
 * Minimal HUD built at runtime under the editor-created Canvas: a level label,
 * a remaining-passengers label, and a center banner for win/lose.
 */
export class HudView {
    private canvas: Node;
    private levelLabel: Label;
    private progressLabel: Label;
    private bannerLabel: Label;

    constructor(canvas: Node) {
        this.canvas = canvas;
        const h = canvasHeight(canvas);
        this.levelLabel = makeLabel(canvas, 'LevelLabel', 44, h / 2 - 70);
        this.progressLabel = makeLabel(canvas, 'ProgressLabel', 32, h / 2 - 130);
        this.bannerLabel = makeLabel(canvas, 'Banner', 64, 0);
        this.bannerLabel.node.active = false;
    }

    /** A small floating label (for per-car seat counts); caller positions/updates/destroys it. */
    newSeatLabel(): Label {
        const label = makeLabel(this.canvas, 'seat', 30, 0);
        label.color = new Color(255, 255, 255);
        return label;
    }

    setLevel(id: number): void {
        this.levelLabel.string = `第 ${id} 关`;
    }

    setProgress(remaining: number): void {
        this.progressLabel.string = `剩余乘客 ${remaining}`;
    }

    showBanner(text: string): void {
        this.bannerLabel.string = text;
        this.bannerLabel.node.active = true;
    }

    hideBanner(): void {
        this.bannerLabel.node.active = false;
    }
}
