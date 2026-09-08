import { LoopSystem } from './loop-system';
import { ParkingSystem } from './parking-system';

/**
 * One passenger getting on: which colour, which stall they took, and which figure of which
 * ring cell stood up to do it.
 *
 * `cell` and `seat` exist for the view, which flies the real figure the track was drawing
 * rather than a stand-in, and therefore has to know exactly where it stood. With a doorway
 * BOARD_CELLS wide the cell is no longer implied -- three rows can board on one tick, from
 * three different cells, in three different colours.
 *
 * `seat` is the figure's index INSIDE its row (0 .. GROUP_SIZE - 1). A partly boarded row is
 * drawn as its first `count` figures, so the one that stands up is the LAST of those -- the
 * row empties from its leading edge, nearest the door. Getting this from the core rather
 * than re-deriving it in the view is what stops a flight leaving from a spot where a
 * passenger is still standing.
 */
export interface Flight {
  color: string;
  slot: number;
  cell: number;
  seat: number;
}

export interface BoardResult {
  /**
   * Every passenger who boarded this tick, in boarding order. Replaces the old
   * `boardedColor` + `boardedSlots` pair, which could not describe a tick where two cells
   * of DIFFERENT colours both boarded -- which a doorway wider than one cell makes routine.
   */
  flights: Flight[];
  /** Always equals `flights.length`; kept because most callers only want the number. */
  boardedCount: number;
  departedCarIds: number[];
}

export class BoardingSystem {
  constructor(
    private loop: LoopSystem,
    private parking: ParkingSystem,
  ) {}

  tick(): BoardResult {
    const flights: Flight[] = [];
    // Every cell inside the doorway, leaving edge first -- see `LoopSystem.boardIndices`
    // for why that order and not the middle first.
    for (const cell of this.loop.boardIndices()) {
      const color = this.loop.passengerAt(cell);
      if (!color) continue;
      // Drain the whole row this tick, as far as the matching cars can take it: the row is
      // inside the doorway for a bounded number of ticks, and holding it there would stall
      // the loop. Seats can run out mid-row (and can span two cars of the same colour) --
      // whoever is left stays in the row and rides round again.
      //
      // `seat` counts DOWN from the top of the row, because that is the figure the view is
      // drawing: a row of `count` shows figures 0..count-1, so the one that leaves is
      // count - 1, then count - 2, and so on.
      let seat = this.loop.countAt(cell) - 1;
      while (this.loop.passengerAt(cell) === color) {
        const slot = this.parking.findMatchingSlot(color);
        if (slot === -1) break;
        this.parking.board(slot);
        flights.push({ color, slot, cell, seat });
        this.loop.boardPassengerAt(cell);
        seat--;
      }
    }
    const departedCarIds = this.parking.removeFull();
    this.loop.step();
    return { flights, boardedCount: flights.length, departedCarIds };
  }
}
