import { DEFAULT_FEEDS, DEFAULT_TRACK, LevelData, CAP_SIZE } from './types';
import { TRACK_SHAPES } from './track-shapes';
import {
  capacityOptions, entryIndex, ENTRY_NORMAL_MAX, maxLookahead, MIN_CURVE_RADIUS, TrackPath,
} from './track-path';

export function validateLevel(level: LevelData): string[] {
  const errors: string[] = [];

  const carCap: Record<string, number> = {};
  for (const c of level.grid.cars) {
    carCap[c.color] = (carCap[c.color] || 0) + CAP_SIZE[c.cap];
  }
  const paxCount: Record<string, number> = {};
  for (const g of level.loop.queue) {
    paxCount[g.color] = (paxCount[g.color] || 0) + g.count;
  }
  const colors = new Set([...Object.keys(carCap), ...Object.keys(paxCount)]);
  for (const color of colors) {
    const cap = carCap[color] || 0;
    const pax = paxCount[color] || 0;
    if (cap !== pax) {
      errors.push(`color ${color}: car capacity ${cap} != passengers ${pax}`);
    }
  }

  if (level.parking.unlocked > level.parking.slots) {
    errors.push('unlocked > slots');
  }
  return errors;
}

/**
 * Whether a level's track can actually be DRAWN: shape, ring length, boarding index and
 * feeder channels, against the geometry budget. Separate from `validateLevel` on purpose.
 *
 * `validateLevel` answers "is this level's data self-consistent", and `isSolvable` treats
 * a failure there as unsolvable. The synthetic levels in the core tests run rings of 2, 4,
 * 5 and 6 slots -- game-core's deadlock cases need capacity 2 so both entrances collapse
 * onto index 1 -- and none of them is ever rendered. Drawability belongs to authored and
 * generated levels, so it is checked where those are made: the generator's tests, the
 * offline tool (which fails the build), and one warning in GameController.
 *
 * These rules read like formalities and are not: the first draft of the difficulty curve
 * had hex-at-18 and oval-at-14 in it, whose entry cells land on curved edges with outward
 * normals tilted 30 degrees -- channels shoved diagonally off screen. Rule 6 caught both
 * before anything was drawn.
 */
export function validateTrack(level: LevelData): string[] {
  const errors: string[] = [];
  const loop = level.loop;
  const shape = loop.track ?? DEFAULT_TRACK;
  if (!TRACK_SHAPES.includes(shape)) {
    errors.push(`unknown track shape ${String(shape)}`);
    // Every rule below needs a buildable shape, so stop here rather than throw.
    return errors;
  }
  const path = new TrackPath(shape);

  if (loop.capacity % 4 !== 0) {
    errors.push(`capacity ${loop.capacity} is not a multiple of 4`);
  }
  if (!capacityOptions(shape).includes(loop.capacity)) {
    errors.push(
      `capacity ${loop.capacity} does not fit ${shape}: row spacing ` +
      `${path.rowSpacing(loop.capacity).toFixed(2)}, allowed ${capacityOptions(shape).join('/')}`,
    );
  }
  if (loop.boardIndex !== loop.capacity / 2) {
    errors.push(`boardIndex ${loop.boardIndex} must be half the capacity (${loop.capacity / 2})`);
  }
  // Unreachable with today's five shapes -- every minRadius (0.6 for the three rounded
  // polygons, 0.65 for the oval, 1.3 for the circle) already clears the floor. Guards a
  // future shape whose fillet or curvature was picked without checking this bound.
  if (path.minRadius < MIN_CURVE_RADIUS) {
    errors.push(`${shape} curves tighter (${path.minRadius}) than a row of four can take`);
  }

  const feeds = loop.feeds ?? DEFAULT_FEEDS;
  if (feeds.length < 1 || feeds.length > 2) {
    errors.push(`a level needs 1 or 2 feeder channels, not ${feeds.length}`);
  }
  if (feeds.length === 2 && feeds[0].side === feeds[1].side) {
    errors.push(`both feeder channels are on the same side (${feeds[0].side})`);
  }
  const limit = maxLookahead(shape);
  for (const feed of feeds) {
    if (feed.lookahead < 1 || feed.lookahead > limit) {
      errors.push(
        `${feed.side} channel lookahead ${feed.lookahead} out of range for ${shape} (1..${limit})`,
      );
    }
    // Only meaningful once the capacity itself is legal; a bad capacity already reported.
    // Unreachable with today's five shapes at any of their legal capacities (all their
    // entry normals sit well inside ENTRY_NORMAL_MAX -- see track-path.test.ts); guards
    // a future shape or capacity whose entry lands on a steeper stretch of the outline.
    if (loop.capacity > 0 && loop.capacity % 4 === 0) {
      const t = entryIndex(loop.capacity, loop.capacity / 2, feed.side) / loop.capacity;
      const ny = Math.abs(path.normalAt(t).y);
      if (ny > ENTRY_NORMAL_MAX) {
        errors.push(
          `${feed.side} entry on ${shape} at ${loop.capacity} slots leaves at ` +
          `|ny| ${ny.toFixed(3)}, past ${ENTRY_NORMAL_MAX}`,
        );
      }
    }
  }
  return errors;
}
