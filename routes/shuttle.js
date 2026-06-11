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

function toMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// ─────────────────────────────────────────────
// Fixed date+time comparison using IST (UTC+5:30)
// Render runs in UTC — we add 330 mins offset
// ─────────────────────────────────────────────
function getHoursUntilDeparture(travelDate, departureTime) {
  const [h, m] = departureTime.split(':').map(Number);

  // Parse travel date as IST midnight (add 5h30m = 330min offset)
  const [year, month, day] = travelDate.split('-').map(Number);
  const depIST = new Date(Date.UTC(year, month - 1, day, h - 5, m - 30, 0));

  const nowUTC = new Date();
  return (depIST - nowUTC) / 3600000;
}

function isWithinBookingWindow(travelDate, departureTime) {
  return getHoursUntilDeparture(travelDate, departureTime) >= 6;
}

function isWithinCancellationWindow(travelDate, departureTime) {
  return getHoursUntilDeparture(travelDate, departureTime) >= 1;
}

// ─────────────────────────────────────────────
// TOOL 1: Check registration + available shuttles
// ─────────────────────────────────────────────
router.post('/available', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const { travel_date } = args;

  if (!travel_date) {
    return vapiResponse(res, toolCallId, 'Which date would you like to travel? Please tell me the date.');
  }

  const registration = registrations.find(r => r.phone_number === phone);
  if (!registration?.registered) {
    return vapiResponse(res, toolCallId,
      'You are not registered on GoMyTransport yet. ' +
      'Please register at go.jpmc.com/transport with your home address. ' +
      'Once registered, call back and I can book your shuttle.'
    );
  }

  const assignedRoutes = schedules.filter(r => registration.assigned_routes.includes(r.route_id));
  const availableOptions = [];

  for (const route of assignedRoutes) {
    for (const timing of route.timings) {
      const hoursUntil = getHoursUntilDeparture(travel_date, timing.departure_time);

      // Skip past shuttles — must be at least 6hrs away
      if (hoursUntil < 6) continue;

      const bookedSeats    = await ShuttleBooking.countDocuments({ timing_id: timing.timing_id, travel_date, status: 'CONFIRMED' });
      const availableSeats = route.total_seats - bookedSeats;

      if (availableSeats > 0) {
        availableOptions.push({
          timing_id:       timing.timing_id,
          route_id:        route.route_id,
          route_name:      route.route_name,
          pickup_point:    route.pickup_point,
          departure_time:  timing.departure_time,
          arrival_time:    timing.arrival_time,
          available_seats: availableSeats,
          hours_until:     Math.round(hoursUntil)
        });
      }
    }
  }

  if (availableOptions.length === 0) {
    // Tell user exactly why — helps during demo
    const allTimings = assignedRoutes.flatMap(r =>
      r.timings.map(t => `${t.departure_time} (${Math.round(getHoursUntilDeparture(travel_date, t.departure_time))}hrs away)`)
    );
    return vapiResponse(res, toolCallId,
      `No shuttles are available for booking on ${travel_date} from ${registration.home_area}. ` +
      `Shuttles must be booked at least 6 hours before departure. ` +
      `Available timings for your route are: ${allTimings.join(', ')}. ` +
      `Please try booking for a date where the shuttle is at least 6 hours away.`
    );
  }

  availableOptions.sort((a, b) => toMinutes(a.departure_time) - toMinutes(b.departure_time));

  const optionsList = availableOptions.map((o, i) =>
    `Option ${i + 1}: timing_id=${o.timing_id}, ${o.route_name}, departing ${o.departure_time} from ${o.pickup_point}, arrives JPMC by ${o.arrival_time}, ${o.available_seats} seats left`
  ).join('. ');

  return vapiResponse(res, toolCallId,
    `You are registered from ${registration.home_area}. ` +
    `Available shuttles for ${travel_date}: ${optionsList}. ` +
    `To book, tell me which option you want and I will use the timing_id to book it for you.`
  );
});

// ─────────────────────────────────────────────
// TOOL 2: Book a shuttle
// ─────────────────────────────────────────────
router.post('/book', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);
  const { timing_id, travel_date } = args;

  if (!timing_id || !travel_date) {
    return vapiResponse(res, toolCallId, 'I need the shuttle timing ID and travel date to book.');
  }

  const registration = registrations.find(r => r.phone_number === phone);
  if (!registration?.registered) {
    return vapiResponse(res, toolCallId, 'You are not registered on GoMyTransport. Please register first.');
  }

  // Find route and timing — try timing_id first, fallback to departure time string
  let foundRoute = null, foundTiming = null;
  for (const route of schedules) {
    // Match by exact timing_id OR by departure time (fallback when LLM passes time instead of ID)
    const timing = route.timings.find(t =>
      t.timing_id === timing_id ||
      t.departure_time === timing_id ||
      t.departure_time.replace(':', '') === timing_id.replace(':', '')
    );
    if (timing) { foundRoute = route; foundTiming = timing; break; }
  }

  // Also try matching across only the employee's assigned routes
  if (!foundRoute) {
    const assigned = schedules.filter(r => registration.assigned_routes.includes(r.route_id));
    for (const route of assigned) {
      const timing = route.timings.find(t =>
        t.timing_id === timing_id ||
        t.departure_time === timing_id ||
        t.departure_time.replace(':', '') === timing_id.replace(':', '')
      );
      if (timing) { foundRoute = route; foundTiming = timing; break; }
    }
  }

  if (!foundRoute || !foundTiming) {
    // List available timings so LLM can retry with correct ID
    const assigned = schedules.filter(r => registration.assigned_routes.includes(r.route_id));
    const timingList = assigned.flatMap(r =>
      r.timings.map(t => `${t.timing_id} (${t.departure_time})`)
    ).join(', ');
    return vapiResponse(res, toolCallId,
      `I could not match that shuttle. Available timing IDs for your route are: ${timingList}. Please try again with the correct timing ID.`
    );
  }

  // 6-hour window check
  const hoursUntil = getHoursUntilDeparture(travel_date, foundTiming.departure_time);
  if (hoursUntil < 6) {
    return vapiResponse(res, toolCallId,
      `Sorry, the ${foundTiming.departure_time} shuttle on ${travel_date} cannot be booked anymore. ` +
      `It departs in about ${Math.round(hoursUntil)} hours and the cutoff is 6 hours. ` +
      `Please choose a later shuttle or a future date.`
    );
  }

  // Seat availability
  const bookedSeats = await ShuttleBooking.countDocuments({ timing_id, travel_date, status: 'CONFIRMED' });
  if (bookedSeats >= foundRoute.total_seats) {
    return vapiResponse(res, toolCallId,
      `The ${foundTiming.departure_time} shuttle is fully booked for ${travel_date}. Please choose a different timing.`
    );
  }

  // Duplicate check
  const alreadyBooked = await ShuttleBooking.findOne({ phone_number: phone, travel_date, timing_id, status: 'CONFIRMED' });
  if (alreadyBooked) {
    return vapiResponse(res, toolCallId,
      `You already have booking ${alreadyBooked.booking_id} for this shuttle on ${travel_date}.`
    );
  }

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

  console.log(`🚌 Shuttle booked: ${bookingId} for ${employee?.name}`);

  return vapiResponse(res, toolCallId,
    `Shuttle booked successfully! Your booking ID is ${bookingId}. ` +
    `${foundRoute.route_name} on ${travel_date}, departing at ${foundTiming.departure_time} from ${foundRoute.pickup_point}. ` +
    `You will arrive at JPMC by ${foundTiming.arrival_time}. ` +
    `Please be at the pickup point at least 5 minutes before departure.`
  );
});

// ─────────────────────────────────────────────
// TOOL 3: Cancel a shuttle booking
// ─────────────────────────────────────────────
router.post('/cancel', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const { booking_id } = args;

  if (!booking_id) {
    return vapiResponse(res, toolCallId, 'Please provide your shuttle booking ID. It looks like JPMC-SH-5001.');
  }

  const booking = await ShuttleBooking.findOne({ booking_id: new RegExp(`^${booking_id}$`, 'i') });
  if (!booking) return vapiResponse(res, toolCallId, `I could not find booking ${booking_id}.`);
  if (booking.phone_number !== phone) return vapiResponse(res, toolCallId, 'You can only cancel your own bookings.');
  if (booking.status === 'CANCELLED') return vapiResponse(res, toolCallId, `Booking ${booking_id} is already cancelled.`);

  const hoursUntil = getHoursUntilDeparture(booking.travel_date, booking.departure_time);
  if (hoursUntil < 1) {
    return vapiResponse(res, toolCallId,
      `Sorry, this booking cannot be cancelled. The shuttle departs in less than 1 hour at ${booking.departure_time}. ` +
      `Please contact the transport desk directly for urgent changes.`
    );
  }

  booking.status       = 'CANCELLED';
  booking.cancelled_at = new Date();
  await booking.save();

  return vapiResponse(res, toolCallId,
    `Booking ${booking_id} has been cancelled. ` +
    `Your seat on the ${booking.route_name} at ${booking.departure_time} on ${booking.travel_date} has been released.`
  );
});

// ─────────────────────────────────────────────
// TOOL 4: List my shuttle bookings
// ─────────────────────────────────────────────
router.post('/my-bookings', async (req, res) => {
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);

  const myBookings = await ShuttleBooking.find({ phone_number: phone, status: 'CONFIRMED' }).sort({ booked_at: -1 }).limit(5);

  if (myBookings.length === 0) {
    return vapiResponse(res, toolCallId, 'You have no upcoming confirmed shuttle bookings.');
  }

  const summary = myBookings.map(b =>
    `${b.booking_id}: ${b.route_name} on ${b.travel_date} departing at ${b.departure_time} from ${b.pickup_point}`
  ).join('. ');

  return vapiResponse(res, toolCallId, `You have ${myBookings.length} upcoming shuttle booking(s). ${summary}.`);
});

module.exports = router;
