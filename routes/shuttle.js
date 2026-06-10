const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const TRANSPORT_PATH       = path.join(__dirname, '../data/transport-registrations.json');
const SCHEDULES_PATH       = path.join(__dirname, '../data/shuttle-schedules.json');
const SHUTTLE_BOOKINGS_PATH = path.join(__dirname, '../data/shuttle-bookings.json');
const employees            = require('../employees.json');

function readJSON(fp) { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
function writeJSON(fp, data) { fs.writeFileSync(fp, JSON.stringify(data, null, 2)); }

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

function vapiResponse(res, toolCallId, resultText) {
  return res.json({ results: [{ toolCallId, result: resultText }] });
}

function getCallerPhone(req) {
  return req.body?.message?.call?.customer?.number
    || req.body?.message?.customer?.number
    || null;
}

// ─────────────────────────────────────────────
// Helper: count booked seats for a timing slot
// ─────────────────────────────────────────────
function getBookedSeats(timingId, date) {
  const { bookings } = readJSON(SHUTTLE_BOOKINGS_PATH);
  return bookings.filter(b =>
    b.timing_id === timingId &&
    b.travel_date === date &&
    b.status === 'CONFIRMED'
  ).length;
}

// ─────────────────────────────────────────────
// Helper: convert "HH:MM" to total minutes
// ─────────────────────────────────────────────
function toMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// ─────────────────────────────────────────────
// Helper: check 6-hour booking cutoff rule
// departure must be at least 6hrs from now
// ─────────────────────────────────────────────
function isWithinBookingWindow(travelDate, departureTime) {
  const now = new Date();
  const [depH, depM] = departureTime.split(':').map(Number);

  const departure = new Date(travelDate);
  departure.setHours(depH, depM, 0, 0);

  const diffHours = (departure - now) / (1000 * 60 * 60);
  return diffHours >= 6;
}

// ─────────────────────────────────────────────
// Helper: check 1-hour cancellation cutoff rule
// ─────────────────────────────────────────────
function isWithinCancellationWindow(travelDate, departureTime) {
  const now = new Date();
  const [depH, depM] = departureTime.split(':').map(Number);

  const departure = new Date(travelDate);
  departure.setHours(depH, depM, 0, 0);

  const diffHours = (departure - now) / (1000 * 60 * 60);
  return diffHours >= 1;
}

// ─────────────────────────────────────────────
// TOOL 1: Check registration + available shuttles
// ─────────────────────────────────────────────
router.post('/available', (req, res) => {
  console.log('📥 shuttle/available');

  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);

  const { travel_date } = args;

  if (!travel_date) {
    return vapiResponse(res, toolCallId,
      'Which date would you like to travel? Please tell me the date.'
    );
  }

  // Check GoMyTransport registration
  const { registrations } = readJSON(TRANSPORT_PATH);
  const registration = registrations.find(r => r.phone_number === phone);

  if (!registration || !registration.registered) {
    return vapiResponse(res, toolCallId,
      'NOT_REGISTERED. You are not registered on GoMyTransport yet. ' +
      'Please register at go.jpmc.com/transport with your home address to enable shuttle booking. ' +
      'Once registered, call back and I can book your shuttle.'
    );
  }

  // Get routes assigned to this employee
  const { routes } = readJSON(SCHEDULES_PATH);
  const assignedRoutes = routes.filter(r => registration.assigned_routes.includes(r.route_id));

  if (assignedRoutes.length === 0) {
    return vapiResponse(res, toolCallId,
      'You are registered on GoMyTransport but no routes have been assigned to you yet. ' +
      'Please contact the transport team at transport@jpmc.com.'
    );
  }

  // Filter timings that satisfy the 6-hour booking window
  const availableOptions = [];

  for (const route of assignedRoutes) {
    for (const timing of route.timings) {
      if (!isWithinBookingWindow(travel_date, timing.departure_time)) continue;

      const bookedSeats = getBookedSeats(timing.timing_id, travel_date);
      const availableSeats = route.total_seats - bookedSeats;

      if (availableSeats > 0) {
        availableOptions.push({
          timing_id:       timing.timing_id,
          route_id:        route.route_id,
          route_name:      route.route_name,
          pickup_point:    route.pickup_point,
          departure_time:  timing.departure_time,
          arrival_time:    timing.arrival_time,
          available_seats: availableSeats
        });
      }
    }
  }

  if (availableOptions.length === 0) {
    return vapiResponse(res, toolCallId,
      `No shuttles are available for booking on ${travel_date} from ${registration.home_area}. ` +
      `This could be because all slots are full or the 6-hour booking window has passed for today's shuttles. ` +
      `Please try booking for a future date.`
    );
  }

  // Sort by departure time
  availableOptions.sort((a, b) => toMinutes(a.departure_time) - toMinutes(b.departure_time));

  const optionsList = availableOptions
    .map((o, i) =>
      `Option ${i + 1}: ${o.route_name} departing at ${o.departure_time} from ${o.pickup_point}, ` +
      `arriving at JPMC at ${o.arrival_time}, ${o.available_seats} seats available`
    ).join('. ');

  return vapiResponse(res, toolCallId,
    `You are registered on GoMyTransport from ${registration.home_area}. ` +
    `Here are the available shuttles for ${travel_date}: ${optionsList}. ` +
    `Which shuttle would you like to book?`
  );
});

// ─────────────────────────────────────────────
// TOOL 2: Book a shuttle
// ─────────────────────────────────────────────
router.post('/book', (req, res) => {
  console.log('📥 shuttle/book');

  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);

  const { timing_id, travel_date } = args;

  if (!timing_id || !travel_date) {
    return vapiResponse(res, toolCallId,
      'I need the shuttle timing and travel date to complete the booking.'
    );
  }

  // Check registration
  const { registrations } = readJSON(TRANSPORT_PATH);
  const registration = registrations.find(r => r.phone_number === phone);

  if (!registration?.registered) {
    return vapiResponse(res, toolCallId,
      'You are not registered on GoMyTransport. Please register at go.jpmc.com/transport first.'
    );
  }

  // Find the route and timing
  const { routes } = readJSON(SCHEDULES_PATH);
  let foundRoute = null;
  let foundTiming = null;

  for (const route of routes) {
    const timing = route.timings.find(t => t.timing_id === timing_id);
    if (timing) { foundRoute = route; foundTiming = timing; break; }
  }

  if (!foundRoute || !foundTiming) {
    return vapiResponse(res, toolCallId,
      'I could not find that shuttle timing. Please check the available options again.'
    );
  }

  // Check 6-hour booking window
  if (!isWithinBookingWindow(travel_date, foundTiming.departure_time)) {
    return vapiResponse(res, toolCallId,
      `Sorry, the booking window for the ${foundTiming.departure_time} shuttle has closed. ` +
      `Shuttles must be booked at least 6 hours before departure. ` +
      `Please choose a later shuttle or book for tomorrow.`
    );
  }

  // Check seat availability
  const bookedSeats = getBookedSeats(timing_id, travel_date);
  const availableSeats = foundRoute.total_seats - bookedSeats;

  if (availableSeats <= 0) {
    return vapiResponse(res, toolCallId,
      `Sorry, the ${foundTiming.departure_time} ${foundRoute.route_name} shuttle is fully booked for ${travel_date}. ` +
      `Please choose a different timing.`
    );
  }

  // Check if already booked for same date and timing
  const { bookings } = readJSON(SHUTTLE_BOOKINGS_PATH);
  const alreadyBooked = bookings.find(b =>
    b.phone_number === phone &&
    b.travel_date === travel_date &&
    b.timing_id === timing_id &&
    b.status === 'CONFIRMED'
  );

  if (alreadyBooked) {
    return vapiResponse(res, toolCallId,
      `You already have a booking for this shuttle. Your booking ID is ${alreadyBooked.booking_id}.`
    );
  }

  // Save booking
  const bookingsData = readJSON(SHUTTLE_BOOKINGS_PATH);
  const newBookingId = bookingsData.last_booking_id + 1;

  const newBooking = {
    booking_id:     `JPMC-SH-${newBookingId}`,
    employee_sid:   employee?.sid  || 'UNKNOWN',
    employee_name:  employee?.name || 'Unknown',
    phone_number:   phone,
    route_id:       foundRoute.route_id,
    route_name:     foundRoute.route_name,
    timing_id:      timing_id,
    pickup_point:   foundRoute.pickup_point,
    departure_time: foundTiming.departure_time,
    arrival_time:   foundTiming.arrival_time,
    travel_date:    travel_date,
    status:         'CONFIRMED',
    booked_at:      new Date().toISOString(),
    cancelled_at:   null
  };

  bookingsData.bookings.push(newBooking);
  bookingsData.last_booking_id = newBookingId;
  writeJSON(SHUTTLE_BOOKINGS_PATH, bookingsData);

  console.log(`🚌 Shuttle booked: ${newBooking.booking_id} for ${newBooking.employee_name}`);

  return vapiResponse(res, toolCallId,
    `Shuttle booked successfully! Your booking ID is ${newBooking.booking_id}. ` +
    `${foundRoute.route_name} on ${travel_date}, departing at ${foundTiming.departure_time} from ${foundRoute.pickup_point}. ` +
    `You will arrive at JPMC by ${foundTiming.arrival_time}. Please be at the pickup point 5 minutes early.`
  );
});

// ─────────────────────────────────────────────
// TOOL 3: Cancel a shuttle booking
// ─────────────────────────────────────────────
router.post('/cancel', (req, res) => {
  console.log('📥 shuttle/cancel');

  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);

  const { booking_id } = args;

  if (!booking_id) {
    return vapiResponse(res, toolCallId,
      'Please provide your shuttle booking ID to cancel. It looks like JPMC-SH-5001.'
    );
  }

  const bookingsData = readJSON(SHUTTLE_BOOKINGS_PATH);
  const bookingIndex = bookingsData.bookings.findIndex(
    b => b.booking_id.toLowerCase() === booking_id.toLowerCase()
  );

  if (bookingIndex === -1) {
    return vapiResponse(res, toolCallId,
      `I could not find booking ${booking_id}. Please check the ID and try again.`
    );
  }

  const booking = bookingsData.bookings[bookingIndex];

  // Only allow cancellation by the person who booked
  if (booking.phone_number !== phone) {
    return vapiResponse(res, toolCallId,
      'Sorry, you can only cancel your own shuttle bookings.'
    );
  }

  if (booking.status === 'CANCELLED') {
    return vapiResponse(res, toolCallId,
      `Booking ${booking_id} is already cancelled.`
    );
  }

  // Check 1-hour cancellation window
  if (!isWithinCancellationWindow(booking.travel_date, booking.departure_time)) {
    return vapiResponse(res, toolCallId,
      `Sorry, this booking cannot be cancelled. ` +
      `Cancellations must be made at least 1 hour before the shuttle departure time of ${booking.departure_time}. ` +
      `Please contact the transport desk for assistance.`
    );
  }

  bookingsData.bookings[bookingIndex].status = 'CANCELLED';
  bookingsData.bookings[bookingIndex].cancelled_at = new Date().toISOString();
  writeJSON(SHUTTLE_BOOKINGS_PATH, bookingsData);

  console.log(`❌ Shuttle cancelled: ${booking_id}`);

  return vapiResponse(res, toolCallId,
    `Booking ${booking_id} has been cancelled successfully. ` +
    `Your seat on the ${booking.route_name} at ${booking.departure_time} on ${booking.travel_date} has been released.`
  );
});

// ─────────────────────────────────────────────
// TOOL 4: List my shuttle bookings
// ─────────────────────────────────────────────
router.post('/my-bookings', (req, res) => {
  console.log('📥 shuttle/my-bookings');

  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);

  const bookingsData = readJSON(SHUTTLE_BOOKINGS_PATH);
  const myBookings = bookingsData.bookings
    .filter(b => b.phone_number === phone && b.status === 'CONFIRMED')
    .slice(-5);

  if (myBookings.length === 0) {
    return vapiResponse(res, toolCallId, 'You have no upcoming shuttle bookings.');
  }

  const summary = myBookings
    .map(b => `${b.booking_id}: ${b.route_name} on ${b.travel_date} at ${b.departure_time}`)
    .join('. ');

  return vapiResponse(res, toolCallId,
    `You have ${myBookings.length} upcoming shuttle booking(s). ${summary}.`
  );
});

module.exports = router;
