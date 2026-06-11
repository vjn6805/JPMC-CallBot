const express  = require('express');
const router   = express.Router();
const { RoomBooking } = require('../models');
const rooms    = require('../data/rooms.json').rooms;
const employees = require('../employees.json');
const { sendRoomBookingEmail } = require('../utils/email');

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

async function isRoomBooked(roomId, date, startTime) {
  return await RoomBooking.exists({ room_id: roomId, date, start_time: startTime, status: 'CONFIRMED' });
}

// Normalize building name — handles "tower a", "Tower A", "towerA", "a" etc.
function normalizeBuilding(input) {
  if (!input) return null;
  const s = input.toLowerCase().trim();
  if (s.includes('a')) return 'Tower A';
  if (s.includes('b')) return 'Tower B';
  if (s.includes('c')) return 'Tower C';
  return null;
}

// TOOL 1: Check room availability
router.post('/check-availability', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const { date, start_time, capacity_needed } = args;

  if (!date || !start_time) {
    return vapiResponse(res, toolCallId, 'Please provide the date and time you need the room for.');
  }

  const needed   = parseInt(capacity_needed) || 1;
  const roomType = args.room_type || 'meeting';
  // Normalize building — fixes "tower a" vs "Tower A" mismatch
  const building = normalizeBuilding(args.building);

  const available = [];
  for (const room of rooms) {
    if (room.type !== roomType)  continue;
    if (room.capacity < needed)  continue;
    if (!room.available)         continue;
    if (building && room.building !== building) continue;
    if (await isRoomBooked(room.room_id, date, start_time)) continue;
    available.push(room);
  }

  if (available.length === 0) {
    // If building filter was applied and nothing found, try without it and suggest alternatives
    const anyAvailable = [];
    for (const room of rooms) {
      if (room.type !== roomType) continue;
      if (room.capacity < needed) continue;
      if (!room.available)        continue;
      if (await isRoomBooked(room.room_id, date, start_time)) continue;
      anyAvailable.push(room);
    }

    if (anyAvailable.length > 0 && building) {
      const alt = anyAvailable[0];
      return vapiResponse(res, toolCallId,
        `No ${roomType} rooms available in ${building} for ${needed} people on ${date} at ${start_time}. ` +
        `However, I found ${anyAvailable.length} room(s) in other buildings. ` +
        `Best option: ${alt.name} on Floor ${alt.floor}, ${alt.building}, capacity ${alt.capacity}. ` +
        `Shall I book this instead?`
      );
    }

    return vapiResponse(res, toolCallId,
      `No ${roomType} rooms are available for ${needed} people on ${date} at ${start_time}. ` +
      `Please try a different time or date.`
    );
  }

  const best = available.sort((a, b) => a.capacity - b.capacity)[0];
  const others = available.slice(1, 3).map(r => `${r.name} in ${r.building}`).join(', ');

  return vapiResponse(res, toolCallId,
    `I found ${available.length} available ${roomType} room(s)${building ? ` in ${building}` : ''}. ` +
    `Best option: ${best.name} on Floor ${best.floor}, ${best.building}, capacity ${best.capacity}. ` +
    `Amenities: ${best.amenities.join(', ')}. ` +
    (others ? `Other options: ${others}. ` : '') +
    `Shall I book ${best.name} for you?`
  );
});

// TOOL 2: Book a room
router.post('/book-room', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);
  const { room_name, date, start_time, duration_hours, agenda } = args;

  if (!room_name || !date || !start_time) {
    return vapiResponse(res, toolCallId, 'I need the room name, date, and time to complete the booking.');
  }

  // Case-insensitive room name match
  const room = rooms.find(r => r.name.toLowerCase() === room_name.toLowerCase());
  if (!room) {
    const roomNames = rooms.filter(r => r.type === 'meeting').map(r => r.name).join(', ');
    return vapiResponse(res, toolCallId,
      `I could not find a room named ${room_name}. Available rooms are: ${roomNames}.`
    );
  }

  if (await isRoomBooked(room.room_id, date, start_time)) {
    return vapiResponse(res, toolCallId,
      `Room ${room.name} is already booked at that time. Would you like me to check other available rooms?`
    );
  }

  const duration = parseFloat(duration_hours) || 1;
  const [hour, minute] = start_time.split(':').map(Number);
  const endTime = `${String(hour + Math.floor(duration)).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  const count     = await RoomBooking.countDocuments();
  const bookingId = `JPMC-RM-${2001 + count}`;

  await RoomBooking.create({
    booking_id:     bookingId,
    room_id:        room.room_id,
    room_name:      room.name,
    room_type:      room.type,
    floor:          room.floor,
    building:       room.building,
    employee_sid:   employee?.sid  || 'UNKNOWN',
    employee_name:  employee?.name || 'Unknown',
    phone_number:   phone || 'Unknown',
    date,
    start_time,
    end_time:       endTime,
    duration_hours: duration,
    agenda:         agenda || 'Not specified',
    status:         'CONFIRMED'
  });

  console.log(`🏢 Room booked: ${bookingId}`);

  // Send confirmation email
  sendRoomBookingEmail(employee, {
    booking_id: bookingId, room_name: room.name, room_type: room.type,
    floor: room.floor, building: room.building, date, start_time,
    end_time: endTime, duration_hours: duration, agenda: agenda || 'Not specified'
  });

  return vapiResponse(res, toolCallId,
    `Done! ${room.name} on Floor ${room.floor}, ${room.building} is booked. ` +
    `Date: ${date}, Time: ${start_time} to ${endTime}. Your booking ID is ${bookingId}.`
  );
});

// TOOL 3: Cancel a booking
router.post('/cancel-booking', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);
  const { booking_id } = args;

  if (!booking_id) {
    return vapiResponse(res, toolCallId, 'Please provide your booking ID to cancel. It looks like JPMC-RM-2001.');
  }

  const booking = await RoomBooking.findOne({ booking_id: new RegExp(`^${booking_id}$`, 'i') });
  if (!booking) {
    return vapiResponse(res, toolCallId, `I could not find booking ${booking_id}. Please check the ID.`);
  }

  if (employee && booking.employee_sid !== employee.sid) {
    return vapiResponse(res, toolCallId, 'Sorry, you can only cancel your own bookings.');
  }

  booking.status       = 'CANCELLED';
  booking.cancelled_at = new Date();
  await booking.save();

  return vapiResponse(res, toolCallId,
    `Booking ${booking_id} for ${booking.room_name} on ${booking.date} at ${booking.start_time} has been cancelled successfully.`
  );
});

// TOOL 4: List my bookings
router.post('/my-bookings', async (req, res) => {
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);

  const myBookings = employee
    ? await RoomBooking.find({ employee_sid: employee.sid, status: 'CONFIRMED' }).sort({ booked_at: -1 }).limit(5)
    : [];

  if (myBookings.length === 0) {
    return vapiResponse(res, toolCallId, 'You have no upcoming room bookings.');
  }

  const summary = myBookings.map(b =>
    `${b.booking_id}: ${b.room_name} in ${b.building} on ${b.date} at ${b.start_time}`
  ).join('. ');

  return vapiResponse(res, toolCallId, `You have ${myBookings.length} booking(s). ${summary}.`);
});

module.exports = router;
