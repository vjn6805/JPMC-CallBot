const mongoose = require('mongoose');

// ── IT Tickets ──
const ticketSchema = new mongoose.Schema({
  ticket_id:     String,
  employee_sid:  String,
  employee_name: String,
  department:    String,
  phone_number:  String,
  issue_description: String,
  category:      String,
  category_id:   String,
  assigned_team: String,
  sla_hours:     Number,
  priority:      { type: String, default: 'P3' },
  status:        { type: String, default: 'OPEN' },
  raised_at:     { type: Date, default: Date.now },
  resolved_at:   Date
});

// ── Room / Focus Bookings ──
const roomBookingSchema = new mongoose.Schema({
  booking_id:    String,
  room_id:       String,
  room_name:     String,
  room_type:     String,
  floor:         Number,
  building:      String,
  employee_sid:  String,
  employee_name: String,
  phone_number:  String,
  date:          String,
  start_time:    String,
  end_time:      String,
  duration_hours:Number,
  agenda:        String,
  status:        { type: String, default: 'CONFIRMED' },
  booked_at:     { type: Date, default: Date.now },
  cancelled_at:  Date
});

// ── Food Orders ──
const foodOrderSchema = new mongoose.Schema({
  order_id:         String,
  outlet_id:        String,
  outlet_name:      String,
  building:         String,
  floor:            Number,
  employee_sid:     String,
  employee_name:    String,
  phone_number:     String,
  items:            [{ item_id: String, name: String, price: Number }],
  total_amount:     Number,
  payment_link:     String,
  stripe_session_id:String,
  status:           { type: String, default: 'PENDING_PAYMENT' },
  ordered_at:       { type: Date, default: Date.now }
});

// ── Shuttle Bookings ──
const shuttleBookingSchema = new mongoose.Schema({
  booking_id:     String,
  employee_sid:   String,
  employee_name:  String,
  phone_number:   String,
  route_id:       String,
  route_name:     String,
  timing_id:      String,
  pickup_point:   String,
  departure_time: String,
  arrival_time:   String,
  travel_date:    String,
  status:         { type: String, default: 'CONFIRMED' },
  booked_at:      { type: Date, default: Date.now },
  cancelled_at:   Date
});

// ── Complaints ──
const complaintSchema = new mongoose.Schema({
  complaint_id:    String,
  complaint_type:  String, // e.g., QUICK_FIX, PERSON_REPORT, FOOD_QUALITY, FACILITY
  description:     String,
  location:        String, // e.g., 'TT Court, Building A'
  outlet_id:       String, // when applicable for food quality
  reported_person: String, // optional name or identifier
  severity:        { type: String, default: 'LOW' },
  status:          { type: String, default: 'PENDING' },
  employee_sid:    String,
  employee_name:   String,
  phone_number:    String,
  quick_resolution: { type: Boolean, default: false },
  raised_at:       { type: Date, default: Date.now },
  resolved_at:     Date
});

module.exports = {
  Ticket:          mongoose.model('Ticket', ticketSchema),
  RoomBooking:     mongoose.model('RoomBooking', roomBookingSchema),
  FoodOrder:       mongoose.model('FoodOrder', foodOrderSchema),
  ShuttleBooking:  mongoose.model('ShuttleBooking', shuttleBookingSchema),
  Complaint:       mongoose.model('Complaint', complaintSchema)
};
