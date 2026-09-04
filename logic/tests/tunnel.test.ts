import { tunnelBox, mouthCar, tunnelReservation } from '../../game/assets/scripts/core/tunnel';
import { CAP_BOX, CAR_SCALE, CLEARANCE, TunnelSpec, TUNNEL_BOX } from '../../game/assets/scripts/core/types';

const tunnel = (over: Partial<TunnelSpec> = {}): TunnelSpec => ({
  id: 1, x: 1, y: 0, angle: 0,
  cars: [{ color: 'red', cap: 'small' }, { color: 'blue', cap: 'small' }],
  ...over,
});

test('a tunnel body is TUNNEL_BOX at the tunnel own centre and angle', () => {
  const b = tunnelBox(tunnel({ x: 2, y: -1, angle: 90 }));
  expect(b.x).toBe(2);
  expect(b.y).toBe(-1);
  expect(b.angle).toBe(90);
  expect(b.len).toBeCloseTo(TUNNEL_BOX.len, 6);
  expect(b.wid).toBeCloseTo(TUNNEL_BOX.wid, 6);
});

// 0.6 (半个本体) + 0.04 (clearance) + 0.482 (半辆小车) = 1.122
const MOUTH_OFFSET = TUNNEL_BOX.len / 2 + CLEARANCE + CAP_BOX.small.len * CAR_SCALE / 2;

test('the mouth car stands one clearance in front of the body', () => {
  const car = mouthCar(tunnel(), 7);
  expect(car).not.toBeNull();
  expect(car!.id).toBe(7);
  expect(car!.x).toBeCloseTo(1 + MOUTH_OFFSET, 6);
  expect(car!.y).toBeCloseTo(0, 6);
  expect(car!.angle).toBe(0);
  expect(car!.color).toBe('red');   // cars[0], not cars[1]
  expect(car!.cap).toBe('small');
});

test('the mouth car follows the tunnel angle', () => {
  const car = mouthCar(tunnel({ x: 0, y: 0, angle: 90 }), 1);
  expect(car!.x).toBeCloseTo(0, 6);
  expect(car!.y).toBeCloseTo(MOUTH_OFFSET, 6);
});

test('a drained tunnel has no mouth car', () => {
  expect(mouthCar(tunnel({ cars: [] }), 1)).toBeNull();
});

test('the reservation is symmetric: a mouth car space at BOTH ends', () => {
  const r = tunnelReservation(tunnel());
  // Symmetric, so it stays centred on the tunnel however the tunnel is later aimed.
  expect(r.x).toBe(1);
  expect(r.y).toBe(0);
  expect(r.len).toBeCloseTo(TUNNEL_BOX.len + 2 * (CLEARANCE + CAP_BOX.small.len * CAR_SCALE), 6);
  expect(r.wid).toBeCloseTo(TUNNEL_BOX.wid, 6);
});

test('the reservation is sized by the LONGEST car the tunnel holds', () => {
  const r = tunnelReservation(tunnel({ cars: [
    { color: 'red', cap: 'small' }, { color: 'blue', cap: 'big' },
  ] }));
  expect(r.len).toBeCloseTo(TUNNEL_BOX.len + 2 * (CLEARANCE + CAP_BOX.big.len * CAR_SCALE), 6);
});
