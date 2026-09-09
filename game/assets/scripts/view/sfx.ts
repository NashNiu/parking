import { Node, AudioSource, AudioClip, resources } from 'cc';

export type SfxName = 'tap' | 'drive' | 'park' | 'board' | 'depart' | 'win' | 'lose';
const NAMES: SfxName[] = ['tap', 'drive', 'park', 'board', 'depart', 'win', 'lose'];

/** Loads code-generated WAVs from resources/audio and plays them as one-shots. Silent if a clip is missing. */
export class SfxManager {
    private src: AudioSource;
    private clips = new Map<SfxName, AudioClip>();
    /**
     * The player's switch, from the settings panel. Checked at PLAY time rather than by
     * unloading the clips, so turning the sound back on is immediate and does not re-fetch
     * seven files.
     */
    private on = true;

    constructor(host: Node) {
        this.src = host.addComponent(AudioSource);
        for (const name of NAMES) {
            resources.load(`audio/${name}`, AudioClip, (err, clip) => {
                if (!err && clip) this.clips.set(name, clip);
            });
        }
    }

    setEnabled(on: boolean): void {
        this.on = on;
    }

    play(name: SfxName, vol = 1): void {
        if (!this.on) return;
        const clip = this.clips.get(name);
        if (clip) this.src.playOneShot(clip, vol);
    }
}
