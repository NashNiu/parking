import { CAP_SIZE } from '../src/types';

test('CAP_SIZE maps car sizes to capacities', () => {
  expect(CAP_SIZE.small).toBe(16);
  expect(CAP_SIZE.medium).toBe(24);
  expect(CAP_SIZE.big).toBe(32);
});
