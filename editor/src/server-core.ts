// Bundled for Node (CJS) so server.js can run the REAL core validation/solvability
// server-side as a second safety net when saving levels.
export { validateLevel, isSolvable } from '../../game/assets/scripts/core/index';
