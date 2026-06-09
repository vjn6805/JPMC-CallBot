const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const ROOMS_PATH    = path.join(__dirname, '../data/rooms.json');
const BOOKINGS_PATH = path.join(__dirname, '../data/bookings.json');
const employees     = require('../employees.json');

function readJSON(fp) { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
function writeJSON(fp, data) { fs.writeFileSync(fp, JSON.stringify(data, null, 2)); }

function getEmployeeByPhone(phone) {
  return phone ? (employees[phone] || null) : null;
}

function extractArgs(req) {
  try {
    if (req.body?.message?.toolCallList?.[0]?.function?.arguments) {
      const a = req.body.message.toolCallList[0].function.arguments;
      return typeof a === 'string' ? JSON.parse(a) : a;
    }
    if (req.body?.message?.toolCalls?.[0]?.function?.arguments) {
      const a = req.body.message.toolCalls[0].function.arguments;
      return typeof a === 'string' ? JSON.parse(a) : a;
    }
    return req.body;
  } catch { return req.body; }
}

function vapiResponse(res, toolCallId, resultText) {
  return res.json({ results: [{ toolCallId: toolCallId || 'tool-call-1', result: resultText }] });
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

// ─────────────────────────────────────────────
// Helper: check if a room is already booked
// for a given date + time slot
// ─────────────────────────────────────────────
function isRoomBooked(roomId, date, startTime) {
  const { bookings } = readJSON(BOOKINGS_PATH);
  return bookings.some(b =>
    b.room_id === roomId &&
    b.date === date &&
    b.start_time === startTime &&
    b.status === 'CONFIRMED'
  );
}

// ─────────────────────────────────────────────
// TOOL 1: Check room availability
// ─────────────────────────────────────────────
router.post('/check-availability', (req, res) => {
  console.log('📥 check-availability:', JSON.stringify(req.body, null, 2));

  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);

  const { date, start_time, capacity_needed } = args;

  if (!date || !start_time) {
    return vapiResponse(res, toolCallId,
      'Please provide the date and time you need the room for.'
    );
  }

  const { rooms } = readJSON(ROOMS_PATH);
  const needed = parseInt(capacity_needed) || 2;

  // Filter rooms that fit capacity and are not already booked
  const available = rooms.filter(room =>
    room.capacity >= needed &&
    room.available &&
    !isRoomBooked(room.room_id, date, start_time)
  );

  if (available.length === 0) {
    return vapiResponse(res, toolCallId,
      `Sorry, no rooms are available for ${capacity_needed} people on ${date} at ${start_time}. ` +
      `Would you like to try a different time?`
    );
  }

  // Suggest the best fit (smallest room that fits)
  const best = available.sort((a, b) => a.capacity - b.capacity)[0];

  const roomList = available.slice(0, 3)
    .map(r => `${r.name} on Floor ${r.floor} in ${r.building} (capacity ${r.capacity})`)
    .join(', ');

  return vapiResponse(res, toolCallId,
    `I found ${available.length} available room(s) for ${needed} people on ${date} at ${start_time}. ` +
    `Best option: Room ${best.name} on Floor ${best.floor}, ${best.building}, capacity ${best.capacity}. ` +
    `Amenities include ${best.amenities.join(', ')}. Shall I book this room for you?`
  );
});

// ─────────────────────────────────────────────
// TOOL 2: Book a room
// ─────────────────────────────────────────────
router.post('/book-room', (req, res) => {
  console.log('📥 book-room:', JSON.stringify(req.body, null, 2));

  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);

  const { room_name, date, start_time, duration_hours, agenda } = args;

  if (!room_name || !date || !start_time) {
    return vapiResponse(res, toolCallId,
      'I need the room name, date, and time to complete the booking.'
    );
  }

  const { rooms } = readJSON(ROOMS_PATH);

  // Find room by name (case insensitive)
  const room = rooms.find(r =>
    r.name.toLowerCase() === room_name.toLowerCase()
  );

  if (!room) {
    return vapiResponse(res, toolCallId,
      `I could not find a room named ${room_name}. Please try again with the correct room name.`
    );
  }

  // Check if already booked
  if (isRoomBooked(room.room_id, date, start_time)) {
    return vapiResponse(res, toolCallId,
      `Room ${room.name} is already booked on ${date} at ${start_time}. ` +
      `Would you like to check other available rooms?`
    );
  }

  // Calculate end time
  const duration = parseFloat(duration_hours) || 1;
  const [hour, minute] = start_time.split(':').map(Number);
  const endHour = hour + Math.floor(duration);
  const endTime = `${String(endHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  // Save booking
  const bookingsData = readJSON(BOOKINGS_PATH);
  const newBookingId = bookingsData.last_booking_id + 1;

  const newBooking = {
    booking_id:    `JPMC-RM-${newBookingId}`,
    room_id:       room.room_id,
    room_name:     room.name,
    floor:         room.floor,
    building:      room.building,
    employee_sid:  employee?.sid  || 'UNKNOWN',
    employee_name: employee?.name || 'Unknown Employee',
    phone_number:  phone || 'Unknown',
    date,
    start_time,
    end_time:      endTime,
    duration_hours: duration,
    agenda:        agenda || 'Not specified',
    status:        'CONFIRMED',
    booked_at:     new Date().toISOString()
  };

  bookingsData.bookings.push(newBooking);
  bookingsData.last_booking_id = newBookingId;
  writeJSON(BOOKINGS_PATH, bookingsData);

  console.log(`🏢 Room booked: ${newBooking.booking_id} by ${newBooking.employee_name}`);

  return vapiResponse(res, toolCallId,
    `Room ${room.name} on Floor ${room.floor}, ${room.building} has been booked successfully. ` +
    `Date: ${date}, Time: ${start_time} to ${endTime}. ` +
    `Your booking ID is ${newBooking.booking_id}. Please note this down.`
  );
});

// ─────────────────────────────────────────────
// TOOL 3: Cancel a booking
// ─────────────────────────────────────────────
router.post('/cancel-booking', (req, res) => {
  console.log('📥 cancel-booking:', JSON.stringify(req.body, null, 2));

  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);

  const { booking_id } = args;

  if (!booking_id) {
    return vapiResponse(res, toolCallId,
      'Please provide your booking ID to cancel. It looks like JPMC-RM-2001.'
    );
  }

  const bookingsData = readJSON(BOOKINGS_PATH);
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
  if (employee && booking.employee_sid !== employee.sid) {
    return vapiResponse(res, toolCallId,
      `Sorry, you can only cancel your own bookings. Booking ${booking_id} belongs to someone else.`
    );
  }

  bookingsData.bookings[bookingIndex].status = 'CANCELLED';
  bookingsData.bookings[bookingIndex].cancelled_at = new Date().toISOString();
  writeJSON(BOOKINGS_PATH, bookingsData);

  console.log(`❌ Booking cancelled: ${booking_id}`);

  return vapiResponse(res, toolCallId,
    `Booking ${booking_id} for Room ${booking.room_name} on ${booking.date} at ${booking.start_time} has been cancelled successfully.`
  );
});


router.post('/my-bookings', (req, res) => {
  console.log('📥 my-bookings:', JSON.stringify(req.body, null, 2));

  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);

  const bookingsData = readJSON(BOOKINGS_PATH);

  const myBookings = employee
    ? bookingsData.bookings
        .filter(b => b.employee_sid === employee.sid && b.status === 'CONFIRMED')
        .slice(-5)
    : [];

  if (myBookings.length === 0) {
    return vapiResponse(res, toolCallId, 'You have no upcoming room bookings.');
  }

  const summary = myBookings
    .map(b => `${b.booking_id}: Room ${b.room_name} on ${b.date} at ${b.start_time}`)
    .join('. ');

  return vapiResponse(res, toolCallId,
    `You have ${myBookings.length} upcoming booking(s). ${summary}.`
  );
});

module.exports = router;