import { Router } from 'express';
import { initiatePackageSubscription } from '../controllers/paymentController';
import { initiateTicketPurchase } from '../controllers/ticketPaymentController';
import { initiateGuestTicketPurchase, getGuestTicketFees } from '../controllers/guestTicketController';
import { getGuestDonationFees } from '../controllers/givingController';
import { getMpesaPaymentStatus } from '../controllers/mpesaCallbackController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/subscribe-package', authenticate, initiatePackageSubscription);
router.post('/purchase-ticket', authenticate, initiateTicketPurchase);
router.post('/guest-ticket', initiateGuestTicketPurchase);
router.get('/guest-ticket/fees', getGuestTicketFees);
router.get('/guest-donation/fees', getGuestDonationFees);
router.get('/mpesa/status/:checkoutRequestId', getMpesaPaymentStatus);        // M-Pesa polling (Kenya)

export default router;
