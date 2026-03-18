import { Router } from 'express';
import { getEvents, getEvent, createEvent, updateEvent, deleteEvent, bookTicket, getMyTickets, getEventTickets, createManualTicket, getUnallocatedTransactions, getTicketTransaction, markAttendance, downloadTicket, getPublicEvent } from '../controllers/eventController';
import { authenticate, authorizePermission } from '../middleware/auth';

const router = Router();

// Public route (no auth required)
router.get('/:id/public', getPublicEvent);

router.use(authenticate);

// Specific routes first (before /:id)
router.get('/my-tickets', authorizePermission('tickets:read'), getMyTickets);
router.post('/book-ticket', bookTicket); // No permission check for free tickets
router.get('/tickets/:ticketId/transaction', authorizePermission('tickets:read'), getTicketTransaction);
router.get('/tickets/:ticketId/download', authorizePermission('tickets:read'), downloadTicket);

// General CRUD routes
router.get('/',       authorizePermission('events:read'),   getEvents);
router.get('/:id',    authorizePermission('events:read'),   getEvent);
router.post('/',      authorizePermission('events:create'), createEvent);
router.put('/:id',    authorizePermission('events:update'), updateEvent);
router.delete('/:id', authorizePermission('events:delete'), deleteEvent);

// Event-specific ticket routes
router.post('/:id/manual-ticket', authorizePermission('tickets:create'), createManualTicket);
router.get('/:id/unallocated-transactions', authorizePermission('tickets:read'), getUnallocatedTransactions);
router.get('/:id/tickets', authorizePermission('tickets:read'), getEventTickets);
router.patch('/tickets/:ticketId/attendance', authorizePermission('attendance:create'), markAttendance);

export default router;
