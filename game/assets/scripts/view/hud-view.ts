import { Node, Label, UITransform, Color, Layers, Vec3, tween } from 'cc';

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
    private starLabels: Label[] = [];

    constructor(canvas: Node) {
        this.canvas = canvas;
        const h = canvasHeight(canvas);
        this.levelLabel = makeLabel(canvas, 'LevelLabel', 44, h / 2 - 70);
        this.progressLabel = makeLabel(canvas, 'ProgressLabel', 32, h / 2 - 130);
        this.bannerLabel = makeLabel(canvas, 'Banner', 64, 0);
        this.bannerLabel.node.active = false;
        for (let i = 0; i < 3; i++) {
            const label = makeLabel(canvas, `Star${i}`, 60, 100);
            label.node.setPosition((i - 1) * 80, 100, 0);
            label.node.active = false;
            this.starLabels.push(label);
        }
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

    /** Victory panel: big banner + a row of 3 stars, filled left-to-right up to `starCount`, each popping in in turn. */
    showWin(starCount: number): void {
        this.bannerLabel.string = '过关!\n点击重玩';
        this.bannerLabel.node.active = true;
        this.starLabels.forEach((label, i) => {
            const filled = i < starCount;
            label.string = filled ? '★' : '☆'; // ★ / ☆
            label.color = filled ? new Color(255, 210, 60) : new Color(120, 120, 120);
            label.node.active = true;
            label.node.setScale(0.01, 0.01, 0.01);
            tween(label.node)
                .delay(i * 0.12)
                .to(0.18, { scale: new Vec3(1.3, 1.3, 1.3) }, { easing: 'backOut' })
                .to(0.1, { scale: Vec3.ONE }, { easing: 'backOut' })
                .start();
        });
    }

    /** Failure panel: deadlock message; the stuck-car highlight itself is driven by the caller. */
    showLose(): void {
        this.bannerLabel.string = '卡住了\n点击重试';
        this.bannerLabel.node.active = true;
        for (const label of this.starLabels) label.node.active = false;
    }

    /** Hides the banner and any win-panel stars; used on restart to clear whichever panel was shown. */
    hideBanner(): void {
        this.bannerLabel.node.active = false;
        for (const label of this.starLabels) label.node.active = false;
    }
}
