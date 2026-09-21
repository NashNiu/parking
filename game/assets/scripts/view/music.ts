import { Node, AudioSource, AudioClip, resources } from 'cc';

/**
 * How loud the track sits. The WAV is normalised to a 0.86 peak by `tools/gen-music.js`, so
 * this is the only place the mix is decided -- and it is a number rather than a render
 * setting precisely so that making the music quieter does not mean regenerating 345KB.
 *
 * WELL UNDER THE EFFECTS, which play at 1.0. Background music that competes with the tap is
 * not background music; a player has to be able to hear that the car refused to move.
 */
const MUSIC_VOL = 0.32;

/**
 * The looping background track: one clip, one source, and a switch.
 *
 * NOT PART OF `SfxManager`, and the difference is not filing. The effects are seven clips
 * played as one-shots, gated at PLAY time so that turning the sound back on is instant; a
 * loop has no play time to be gated at -- it is either running or it is not -- so its switch
 * has to start and stop the thing itself. Two different shapes of control, and one class
 * holding both would have had to explain which of its two rules each method obeyed.
 *
 * ITS OWN CHILD NODE rather than a second AudioSource beside the effects' one. One node with
 * two sources is a component arrangement the engine does not promise, and the dedicated node
 * also means the music can be stopped without reaching past a component that is mid one-shot.
 *
 * SILENT IF THE CLIP IS MISSING, the same contract `SfxManager` keeps: `resources.load` fails
 * quietly and the game plays on without a track. Music is the most decorative thing in this
 * build; it may not be the thing that takes the boot down with it.
 */
export class MusicManager {
    private src: AudioSource;
    private clip: AudioClip | null = null;
    /**
     * Whether the player wants the track, from the settings panel.
     *
     * KEPT SEPARATELY FROM WHETHER IT IS ACTUALLY PLAYING, because the clip arrives
     * asynchronously: `setEnabled` can be called from `applySettings` on the boot path,
     * several frames before there is anything to play. This field is the ANSWER; the load
     * callback and `kick` are the two places that act on it once acting is possible.
     */
    private wanted = true;

    constructor(host: Node) {
        // No layer set on it: this node draws nothing, and a layer on a node with no
        // renderer is a line that looks like it means something.
        const node = new Node('Music');
        host.addChild(node);
        this.src = node.addComponent(AudioSource);
        this.src.loop = true;
        this.src.volume = MUSIC_VOL;
        // `playOnAwake` is left OFF and the start is explicit, so that a player who switched
        // the music off last session never hears the first bar of it while the settings are
        // still being read.
        this.src.playOnAwake = false;
        resources.load('audio/music', AudioClip, (err, clip) => {
            if (err || !clip) return;
            this.clip = clip;
            this.src.clip = clip;
            if (this.wanted) this.start();
        });
    }

    /**
     * Obey the switch. On starts the loop, off stops it outright.
     *
     * STOP AND NOT PAUSE. A player who turns the music off and back on twenty minutes later
     * wants the track, not the exact bar they left; resuming mid-phrase after a silence reads
     * as a glitch rather than as a courtesy.
     */
    setEnabled(on: boolean): void {
        this.wanted = on;
        if (!on) {
            this.src.stop();
            return;
        }
        this.start();
    }

    /**
     * Try again to get the loop going, from inside a user gesture.
     *
     * THE BROWSER AUTOPLAY GATE is what this exists for. On web the engine defers the first
     * `play()` until it sees a gesture, which usually works -- but "usually" is doing real
     * work in that sentence, and the failure is a game that is silently music-less for the
     * whole session. Called from the press handler, this costs one boolean check per touch
     * and closes the case where the deferral did not fire. On WeChat there is no gate and
     * this never does anything.
     *
     * THE `playing` CHECK IS THE WHOLE SAFETY OF IT: `play()` RESTARTS a source that is
     * already going, so a kick without the guard would jump the track back to bar one on
     * every single tap.
     */
    kick(): void {
        if (!this.wanted || this.src.playing) return;
        this.start();
    }

    private start(): void {
        if (!this.clip || this.src.playing) return;
        this.src.play();
    }
}
