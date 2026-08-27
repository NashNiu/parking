# art-source

Art that is kept for reference but must NOT be imported by Cocos.

Anything under `game/assets/resources/` is packed into the build whether or not a
single line of code loads it — that is what makes `resources/` loadable by path at
runtime. So an unused asset there is pure weight in a package with a 4MB ceiling.

## passenger.glb

423KB, and nothing loaded it. `view/pax-figure.ts` builds a passenger out of engine
primitives (a sphere head, tapered capsule body, two capsule arms), and its own docblock
records why: it "replaced the old baked-GLB pipeline (passenger-builder.ts, deleted)"
after the loaded humanoid read as visual mush at this game's zoom. The GLB was left
behind when that pipeline went.

It is the output of, per `tools/reduce-model.mjs`:

    node tools/reduce-model.mjs passenger-source.glb passenger.glb 0.25

Kept here in case the figures are ever revisited. To use it again, move it back under
`game/assets/resources/models/` and let Creator re-import it — the old uuid is gone, so
anything addressing it by uuid (as `car-builder.ts` does for its fallback path) needs the
new one from the regenerated `.meta`.
