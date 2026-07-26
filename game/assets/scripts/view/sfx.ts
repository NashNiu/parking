import { Node, AudioSource, AudioClip, resources } from 'cc';

export type SfxName = 'tap' | 'drive' | 'park' | 'board' | 'depart' | 'win' | 'lose';
const NAMES: SfxName[] = ['tap', 'drive', 'park', 'board', 'depart', 'win', 'lose'];

/** Loads code-generated WAVs from resources/audio and plays them as one-shots. Silent if a clip is missing. */
export class SfxManager {
    private src: AudioSource;
    private clips = new Map<SfxName, AudioClip>();

    constructor(host: Node) {
        this.src = host.addComponent(AudioSource);
        for (const name of NAMES) {
            resources.load(`audio/${name}`, AudioClip, (err, clip) => {
                if (!err && clip) this.clips.set(name, clip);
            });
        }
    }

    play(name: SfxName, vol = 1): void {
        const clip = this.clips.get(name);
        if (clip) this.src.playOneShot(clip, vol);
    }
}
