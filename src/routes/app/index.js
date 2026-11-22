// Private user-app routes. Every route here runs behind requireUser (see index.js), so req.userId is set.
// Public user-app routes (register, login, content) are mounted separately in index.js.
import { Router } from 'express';
import profileRoutes from './profile.js';
import walletRoutes from './wallets.js';
import depositRoutes from './deposits.js';
import withdrawalRoutes from './withdrawals.js';
import kycRoutes from './kyc.js';

const router = Router();
router.use(profileRoutes);
router.use(walletRoutes);
router.use(depositRoutes);
router.use(withdrawalRoutes);
router.use(kycRoutes);

export default router;
