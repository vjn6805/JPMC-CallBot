const express  = require('express');
const router   = express.Router();
const { ShuttleBooking } = require('../models');
const registrations = require('../data/transport-registrations.json').registrations;
const schedules     = require('../data/shuttle-schedules.json').routes;
const employees     = require('../employees.json');

function getEmployeeByPhone(phone) { return phone ? (employees[phone] || null) : null; }

function extractArgs(req) {
  try {
    const list = req.body?.message?.toolCallList || req.body?.message?.toolCalls;
    if (list?.[0]?.function?.arguments) {
      const a = list[0].function.arguments;
      return typeof a === 'string' ? JSON.parse(a) : a;
    }
    return req.body;
  } catch { return req.body; }
}

function getToolCallId(req) {
  return req.body?.message?.toolCallList?.[0]?.id
    || req.body?.message?.toolCalls?.[0]?.id
    || 'tool-call-1';
}

function getCallerPhone(req) {
  return req.body?.message?.call?.customer?.number
    || req.body?.message?.customer?.number
    || null;
}

function vapiResponse(res, toolCallId, resultText) {
  return res.json({ results: [{ toolCallId, result: resultText }] });
}

function toMinutes(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }

function isWithinBookingWindow(travelDate, departureTime) {
  const [h, m] = departureTime.split(':').map(Number);
  const dep = new Date(travelDate); dep.setHours(h, m, 0, 0);
  return (dep - new Date()) / 3600000 >= 6;
}

function isWithinCancellationWindow(travelDate, departureTime) {
  const [h, m] = departureTime.split(':').map(Number);
  const dep = new Date(travelDate); dep.setHours(h, m, 0, 0);
  return (dep - new Date()) / 3600000 >= 1;
}

// TOOL 1: Check registration + available shuttles
router.post('/available', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const { travel_date } = args;

  if (!travel_date) return vapiResponse(res, toolCallId, 'Which date would you like to travel?');

  const registration = registrations.find(r => r.phone_number === phone);
  if (!registration?.registered) {
    return vapiResponse(res, toolCallId,
      'NOT_REGISTERED. You are not registered on GoMyTransport. ' +
      'Please register at go.jpmc.com/transport to enable shuttle booking.'
    );
  }

  const assignedRoutes = schedules.filter(r => registration.assigned_routes.includes(r.route_id));
  const availableOptions = [];

  for (const route of assignedRoutes) {
    for (const timing of route.timings) {
      if (!isWithinBookingWindow(travel_date, timing.departure_time)) continue;
      const bookedSeats = await ShuttleBooking.countDocuments({ timing_id: timing.timing_id, travel_date, status: 'CONFIRMED' });
      const availableSeats = route.total_seats - bookedSeats;
      if (availableSeats > 0) {
        availableOptions.push({ ...timing, route_id: route.route_id, route_name: route.route_name, pickup_point: route.pickup_point, available_seats: availableSeats });
      }
    }
  }

  if (availableOptions.length === 0) {
    return vapiResponse(res, toolCallId,
      `No shuttles available for ${travel_date} from ${registration.home_area}. The 6-hour booking window may have passed. Please try a future date.`
    );
  }

  availableOptions.sort((a, b) => toMinutes(a.departure_time) - toMinutes(b.departure_time));

  const optionsList = availableOptions.map((o, i) =>
    `Option ${i + 1}: ${o.route_name} at ${o.departure_time} from ${o.pickup_point}, arrives JPMC at ${o.arrival_time}, ${o.available_seats} seats available`
  ).join('. ');

  return vapiResponse(res, toolCallId,
    `You are registered from ${registration.home_area}. Available shuttles for ${travel_date}: ${optionsList}. Which would you like to book?`
  );
});

// TOOL 2: Book a shuttle
router.post('/book', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);
  const { timing_id, travel_date } = args;

  if (!timing_id || !travel_date) return vapiResponse(res, toolCallId, 'I need the shuttle timing and travel date.');

  const registration = registrations.find(r => r.phone_number === phone);
  if (!registration?.registered) return vapiResponse(res, toolCallId, 'You are not registered on GoMyTransport.');

  let foundRoute = null, foundTiming = null;
  for (const route of schedules) {
    const timing = route.timings.find(t => t.timing_id === timing_id);
    if (timing) { foundRoute = route; foundTiming = timing; break; }
  }

  if (!foundRoute) return vapiResponse(res, toolCallId, 'I could not find that shuttle timing.');

  if (!isWithinBookingWindow(travel_date, foundTiming.departure_time)) {
    return vapiResponse(res, toolCallId,
      `The booking window for the ${foundTiming.departure_time} shuttle has closed. Shuttles must be booked at least 6 hours before departure.`
    );
  }

  const bookedSeats = await ShuttleBooking.countDocuments({ timing_id, travel_date, status: 'CONFIRMED' });
  if (bookedSeats >= foundRoute.total_seats) {
    return vapiResponse(res, toolCallId, `The ${foundTiming.departure_time} shuttle is fully booked. Please choose a different timing.`);
  }

  const alreadyBooked = await ShuttleBooking.findOne({ phone_number: phone, travel_date, timing_id, status: 'CONFIRMED' });
  if (alreadyBooked) return vapiResponse(res, toolCallId, `You already have booking ${alreadyBooked.booking_id} for this shuttle.`);

  const count     = await ShuttleBooking.countDocuments();
  const bookingId = `JPMC-SH-${5001 + count}`;

  await ShuttleBooking.create({
    booking_id:     bookingId,
    employee_sid:   employee?.sid  || 'UNKNOWN',
    employee_name:  employee?.name || 'Unknown',
    phone_number:   phone,
    route_id:       foundRoute.route_id,
    route_name:     foundRoute.route_name,
    timing_id,
    pickup_point:   foundRoute.pickup_point,
    departure_time: foundTiming.departure_time,
    arrival_time:   foundTiming.arrival_time,
    travel_date,
    status:         'CONFIRMED'
  });

  console.log(`🚌 Shuttle booked: ${bookingId}`);
  return vapiResponse(res, toolCallId,
    `Shuttle booked! Booking ID: ${bookingId}. ` +
    `${foundRoute.route_name} on ${travel_date}, departing ${foundTiming.departure_time} from ${foundRoute.pickup_point}. ` +
    `Arriving at JPMC by ${foundTiming.arrival_time}. Please be at the pickup point 5 minutes early.`
  );
});

// TOOL 3: Cancel a shuttle booking
router.post('/cancel', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const { booking_id } = args;

  if (!booking_id) return vapiResponse(res, toolCallId, 'Please provide your shuttle booking ID.');

  const booking = await ShuttleBooking.findOne({ booking_id: new RegExp(`^${booking_id}$`, 'i') });
  if (!booking) return vapiResponse(res, toolCallId, `I could not find booking ${booking_id}.`);
  if (booking.phone_number !== phone) return vapiResponse(res, toolCallId, 'You can only cancel your own bookings.');
  if (booking.status === 'CANCELLED') return vapiResponse(res, toolCallId, `Booking ${booking_id} is already cancelled.`);

  if (!isWithinCancellationWindow(booking.travel_date, booking.departure_time)) {
    return vapiResponse(res, toolCallId,
      `Cancellation window has closed. Cancellations must be made at least 1 hour before departure at ${booking.departure_time}.`
    );
  }

  booking.status       = 'CANCELLED';
  booking.cancelled_at = new Date();
  await booking.save();

  return vapiResponse(res, toolCallId,
    `Booking ${booking_id} cancelled. Your seat on ${booking.route_name} at ${booking.departure_time} on ${booking.travel_date} has been released.`
  );
});

// TOOL 4: List my shuttle bookings
router.post('/my-bookings', async (req, res) => {
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);

  const myBookings = await ShuttleBooking.find({ phone_number: phone, status: 'CONFIRMED' }).sort({ booked_at: -1 }).limit(5);

  if (myBookings.length === 0) return vapiResponse(res, toolCallId, 'You have no upcoming shuttle bookings.');

  const summary = myBookings.map(b => `${b.booking_id}: ${b.route_name} on ${b.travel_date} at ${b.departure_time}`).join('. ');
  return vapiResponse(res, toolCallId, `You have ${myBookings.length} shuttle booking(s). ${summary}.`);
});

module.exports = router;
