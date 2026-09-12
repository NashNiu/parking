import { DEFAULT_FEEDS, LevelData, STAR_MAX } from './types';
import { LotSystem } from './lot-system';
import { ParkingSystem } from './parking-system';
import { LoopSystem } from './loop-system';
import { BoardingSystem, BoardResult } from './boarding-system';

export type GameState = 'playing' | 'won' | 'deadlock';

/**
 * Why a tap did nothing. The view needs this because the two real refusals look identical
 * on the board -- the car simply stays put -- and want opposite things said about them: a
 * blocked lane points at the car in the way, a full lot points at the parking row. The
 * alternative was re-deriving it in the view from `canExit` and `hasFreeSlot`, i.e. two
 * copies of the rule.
 *
 * 'over' is the game already being won or deadlocked, which the view normally intercepts
 * before it gets this far.
 */
export type TapRefusal = 'blocked' | 'full' | 'over';

export interface TapResult {
  ok: boolean;
  slotIndex: number;
  /** Null when the tap succeeded. */
  reason: TapRefusal | null;
}

export class GameCore {
  readonly lot: LotSystem;
  readonly parking: ParkingSystem;
  readonly loop: LoopSystem;
  readonly boarding: BoardingSystem;
  private state: GameState = 'playing';

  constructor(level: LevelData) {
    this.lot = new LotSystem(
      { w: level.lot.w, h: level.lot.h }, level.lot.cars, level.lot.tunnels ?? [],
    );
    this.parking = new ParkingSystem(level.parking.slots, level.parking.unlocked);
    this.loop = new LoopSystem(
      level.loop.capacity,
      level.loop.boardIndex,
      level.loop.queue,
      level.loop.feeds ?? DEFAULT_FEEDS,
    );
    this.boarding = new BoardingSystem(this.loop, this.parking);
    this.updateState();
  }

  tapCar(carId: number): TapResult {
    if (this.state !== 'playing') return { ok: false, slotIndex: -1, reason: 'over' };
    // A full lot is checked FIRST, and the order is the point: when both refusals apply,
    // saying "blocked" would send the player to clear a car that no stall could take
    // anyway. The condition that stops every tap on the board is the one to report.
    if (!this.parking.hasFreeSlot()) return { ok: false, slotIndex: -1, reason: 'full' };
    if (!this.lot.canExit(carId)) return { ok: false, slotIndex: -1, reason: 'blocked' };
    const car = this.lot.cars.get(carId)!;
    const slotIndex = this.parking.park(car);
    this.lot.removeCar(carId);
    this.updateState();
    return { ok: true, slotIndex, reason: null };
  }

  /**
   * Open one locked stall, and return its index (-1 if there was none, or the game is
   * over). Free, and immediately usable.
   *
   * This is the player's way out of a full bay, which is why `isDeadlocked` counts a
   * lockable stall as room: a level is not over while there is still one to open.
   */
  unlockSlot(): number {
    if (this.state !== 'playing') return -1;
    const slot = this.parking.unlock();
    if (slot >= 0) this.updateState();
    return slot;
  }

  /**
   * The level's star rating, 1 to STAR_MAX: full marks for clearing it without opening a
   * stall, one star fewer for each one opened.
   *
   * The locked stalls are the only resource the game already meters -- nothing counts moves
   * or time -- so they are what a rating can honestly be made of, and metering them is what
   * turns "open a stall" from a free rescue into a decision. `ParkingSystem.unlocksUsed`
   * does the counting; this only applies the scale and the floor.
   *
   * The floor of one is deliberate: a cleared level is a win, and a win showing no stars
   * reads as a failure. The upper stars are what separate a cheap clear from an expensive
   * one.
   *
   * Answerable at any time, not just at the end. It reports the rating the level WOULD earn
   * from here, which is what lets the blocked-stall prompt tell the player what opening one
   * will cost before they agree to it.
   */
  stars(): number {
    return Math.max(1, STAR_MAX - this.parking.unlocksUsed());
  }

  stepLoop(): BoardResult {
    if (this.state !== 'playing') return { flights: [], boardedCount: 0, departedCarIds: [] };
    const res = this.boarding.tick();
    this.updateState();
    return res;
  }

  getState(): GameState {
    return this.state;
  }

  private updateState(): void {
    if (
      this.lot.isEmpty() &&
      this.parking.isEmpty() &&
      this.loop.isDrained()
    ) {
      this.state = 'won';
      return;
    }
    if (this.isDeadlocked()) this.state = 'deadlock';
  }

  /**
   * Can a passenger of `color` still get to the boarding index? Not the same as
   * "does one still exist": a queued passenger behind a ring that never empties can
   * never board, which is exactly how a level jams (see `reachableColors`).
   */
  private hasRemainingColor(color: string): boolean {
    return this.loop.reachableColors().has(color);
  }

  /**
   * Can any car on the bay still take a passenger? Only colours that can still REACH the
   * gap count -- a car whose colour is stranded behind a full ring will never fill, however
   * many of its passengers are still in the level.
   */
  private canFill(): boolean {
    return this.parking.parked.some(
      (p) => p !== null && p.filled < p.capacity && this.hasRemainingColor(p.color),
    );
  }

  /**
   * The board has stopped moving and the ONLY legal move left is to open a stall.
   *
   * Not a deadlock -- opening a stall is a real move, and the level goes on afterwards --
   * but from the player's chair the two look identical, and that is a defect worth naming.
   * The bay is full, nothing on it can board, so no ring cell is ever emptied, so no queued
   * passenger can enter and the ring's contents are frozen (see `reachableColors`). The
   * carousel keeps turning and `remainingCount` never changes again.
   *
   * Measured over the ten shipped levels, a player who holds on to their unlocks reaches
   * exactly this state in 59 of 80 runs -- 8 of 8 on level 6 -- and the game used to say
   * nothing at all about it. The human reported it as "it has already failed and the game
   * has not noticed". It had not failed; it had gone quiet.
   *
   * Shares `canFill` with `isDeadlocked` on purpose: this state is what a deadlock is minus
   * the lockable stalls, so the two must not be able to disagree about what "nothing can
   * board" means. Both wait on `stillFilling` for the same reason.
   *
   * NOT ASKED WHILE THE RING IS STILL FILLING. `canFill` is exact -- `reachableColors` says
   * so and is right -- but it is exact about where the ring is GOING, and this was being put
   * to the player while they could still see gaps on the ring and rows streaming in from the
   * channels. Reported as 上方的圆环中还有空位,理论上还没结束. A true answer the player has no
   * way to check reads as a wrong one, and waiting costs nothing: the ring settles in at
   * most `capacity` steps, and once it has, the same question is answered by what is on the
   * screen rather than by a prediction about it.
   */
  needsUnlock(): boolean {
    return this.state === 'playing'
      && !this.parking.hasFreeSlot()
      && this.parking.canUnlock()
      && !this.loop.stillFilling()
      && !this.canFill();
  }

  /**
   * The player was shown the one move left on the board and turned it down. The level is
   * over, and this is the ONLY way a level ends on a position that still had a legal move
   * in it.
   *
   * Deliberately gated on `needsUnlock` rather than trusting the caller: a level must not
   * be endable from a position the player could still have played out, and a caller asking
   * twice must be idempotent rather than able to kill a level that has since started moving
   * again.
   *
   * NOTHING CALLS THIS TODAY, and that is deliberate rather than rot. The prompt's close
   * button used to: an X that lost the level on a position with a free legal move still in
   * it, on a state the player reaches in 59 of 80 runs. Its three answers now all resolve
   * the position instead -- open a stall, replay, or leave for the menu -- so a level ends
   * in a loss only on a real deadlock. This stays because giving up is a real transition a
   * settings menu may well offer later, and it is the only safe way to make it: it re-checks
   * the position rather than believing the caller.
   */
  declineUnlock(): boolean {
    if (!this.needsUnlock()) return false;
    this.state = 'deadlock';
    return true;
  }

  private isDeadlocked(): boolean {
    // A LOCKABLE stall counts as room. The player can open one for free (`unlockSlot`), so
    // a bay that is full but not fully unlocked still has a legal move in it -- calling
    // that a deadlock would end a level the player could have carried on playing. This is
    // also the whole shape of the mechanic: the locked stalls are the way out of a bay
    // filled with the wrong colours, and the more of them are open the harder the level is
    // to lose.
    const room = this.parking.hasFreeSlot() || this.parking.canUnlock();
    const canBringOut = room && this.lot.movableCarIds().length > 0;
    if (canBringOut) return false;
    // The same wait `needsUnlock` makes, and for a stronger reason: this one ENDS the level.
    // Calling a level lost while rows are still arriving would be the same premature
    // judgement, with nothing the player could do about it afterwards.
    if (this.loop.stillFilling()) return false;
    return !this.canFill();
  }
}
