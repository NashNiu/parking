import { CarSpec, Lot, TunnelSpec } from './types';
import { OBB } from './geometry';
import { pathClear } from './move-solver';
import { mouthCar, tunnelBox } from './tunnel';

/**
 * The cars in the parking lot, and whether any given one can drive out.
 *
 * Named for the lot rather than for a grid because there is no grid: a car is a body at a
 * position and a heading, and "can it get out" is a swept-box question, not a walk down a
 * column of cells.
 */
export class LotSystem {
  /** The lot's extent in board units, for the exit check to measure against. */
  bounds: Lot;
  cars: Map<number, CarSpec>;

  /**
   * This lot's OWN copy of the level's tunnels, consumed as cars leave. Copied rather than
   * referenced because a level object is replayed: a `LotSystem` that drained the array it
   * was handed would leave the second play of that level with empty tunnels.
   */
  readonly tunnels: TunnelSpec[];

  /** Tunnel bodies, computed once. Nothing ever moves them. */
  private readonly blockers: OBB[];

  /** Which tunnel a live mouth car belongs to, by car id. */
  private mouthOf = new Map<number, TunnelSpec>();

  /**
   * Next id for a car coming out of a tunnel. Starts past every id the level wrote, so a
   * tunnel car can never collide with a grid car's id -- which matters because the parking
   * bay, the view's node map and the debug log all key on that number and none of them knows
   * where a car came from.
   */
  private nextId: number;

  constructor(lot: Lot, cars: CarSpec[], tunnels: TunnelSpec[] = []) {
    this.bounds = { w: lot.w, h: lot.h };
    this.cars = new Map(cars.map((c) => [c.id, { ...c }]));
    this.tunnels = tunnels.map((t) => ({ ...t, cars: t.cars.slice() }));
    this.blockers = this.tunnels.map(tunnelBox);
    this.nextId = cars.reduce((m, c) => Math.max(m, c.id), 0) + 1;
    for (const t of this.tunnels) this.spawnMouth(t);
  }

  /** Put a tunnel's current head car on the board. No-op for a drained tunnel. */
  private spawnMouth(t: TunnelSpec): void {
    const car = mouthCar(t, this.nextId);
    if (!car) return;
    this.nextId++;
    this.cars.set(car.id, car);
    this.mouthOf.set(car.id, t);
  }

  canExit(carId: number): boolean {
    const car = this.cars.get(carId);
    if (!car) return false;
    // pathClear skips the mover by id, so the whole list goes in as it stands.
    //
    // Array.from, NOT [...map.values()] -- see `movableCarIds`.
    return pathClear(car, Array.from(this.cars.values()), this.bounds, this.blockers);
  }

  /**
   * Take a car off the board, and -- if it was a tunnel's mouth car -- move the next one up
   * in the SAME call. There is no in-between state where a tunnel that still holds cars has
   * nothing at its mouth, and that is what makes `isEmpty` still mean "the level's lot is
   * clear" without a word being added to it: a tunnel with cars left always has one on the
   * board.
   *
   * The view's slide-out animation runs afterwards and changes nothing here; core has
   * already moved on. That is the same split `ParkedCar.ready` makes, minus the flag --
   * nothing about the new car's verdict differs during the slide, so core needs no notion
   * of it. The view swallows taps on a car still emerging on its own.
   */
  removeCar(carId: number): void {
    this.cars.delete(carId);
    const t = this.mouthOf.get(carId);
    if (!t) return;
    this.mouthOf.delete(carId);
    t.cars.shift();
    this.spawnMouth(t);
  }

  /** The id of the car at `tunnelId`'s mouth, or null once it is drained. */
  mouthCarId(tunnelId: number): number | null {
    for (const [id, t] of this.mouthOf) if (t.id === tunnelId) return id;
    return null;
  }

  /** How many cars `tunnelId` still holds, the one at the mouth included. */
  remainingIn(tunnelId: number): number {
    return this.tunnels.find((t) => t.id === tunnelId)?.cars.length ?? 0;
  }

  isEmpty(): boolean {
    return this.cars.size === 0;
  }

  /**
   * Array.from over the Map's iterator, NOT `[...this.cars.keys()]`.
   *
   * The spread form does not survive the WeChat mini-game build. Level 1 came up
   * `state=deadlock` there on data that node and the mobile browser both play: the lot held
   * its 36 cars, the geometry was exact (CAR_SCALE 1, CAP_BOX intact, no NaN, 22 cars
   * blocked and 14 clear when `firstBlocker` was handed a plain array), and yet this
   * returned nothing. An empty or garbage key list filters down to nothing and calls
   * `canExit` zero times, so it fails SILENTLY -- no exception, just a lot where nothing can
   * move, which `isDeadlocked` correctly reads as a dead level.
   *
   * These two lines were the only Map-iterator spreads in the whole project, and they were
   * exactly the two functions that broke; every other list built from a Map already went
   * through `Array.from` and every one of those worked in the same build. (The one other
   * spread in core, in level-data, is over `Object.keys` -- a plain array, and arrays
   * iterate fine here.)
   */
  movableCarIds(): number[] {
    return Array.from(this.cars.keys()).filter((id) => this.canExit(id));
  }
}
