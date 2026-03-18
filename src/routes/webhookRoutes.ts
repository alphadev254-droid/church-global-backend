import { Router } from 'express';
import { paychanguWebhook } from '../controllers/paychanguWebhookController';
import { paychanguCallback } from '../controllers/paychanguCallbackController';
import { paystackWebhook } from '../controllers/paystackWebhookController';

const router = Router();

// Paychangu callback (user redirect - GET)
router.get('/paychangu/callback', paychanguCallback);

// Paychangu webhook (server notification - POST)
router.post('/paychangu', paychanguWebhook);

// Paystack webhook (server notification - POST)
router.post('/paystack', paystackWebhook);

export default router;
