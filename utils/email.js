const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

function baseTemplate(title, accentColor, iconEmoji, bodyContent) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#f0f2f5;font-family:'Segoe UI',Arial,sans-serif;padding:32px 16px}
  .wrap{max-width:580px;margin:0 auto}
  .hdr{background:${accentColor};border-radius:12px 12px 0 0;padding:32px 36px;text-align:center}
  .hdr-icon{font-size:40px;margin-bottom:12px}
  .hdr h1{color:#fff;font-size:22px;font-weight:700}
  .hdr p{color:rgba(255,255,255,0.8);font-size:13px;margin-top:6px}
  .body{background:#fff;padding:32px 36px}
  .greeting{font-size:16px;color:#1a1a2e;font-weight:600;margin-bottom:6px}
  .sub{font-size:14px;color:#666;margin-bottom:24px;line-height:1.6}
  .card{background:#f8f9fc;border:1px solid #e8eaf0;border-radius:10px;padding:20px 24px;margin-bottom:16px}
  .card-title{font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eef0f5}
  .row:last-child{border-bottom:none}
  .rl{font-size:13px;color:#888}
  .rv{font-size:13px;color:#1a1a2e;font-weight:600;text-align:right;max-width:60%}
  .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700}
  .b-open{background:#fff3cd;color:#856404}
  .b-confirmed{background:#d1fae5;color:#065f46}
  .b-pending{background:#dbeafe;color:#1e40af}
  .cta{display:block;text-align:center;background:${accentColor};color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:15px;font-weight:600;margin:24px 0 8px}
  .ftr{background:#f8f9fc;border-radius:0 0 12px 12px;padding:20px 36px;text-align:center;border-top:1px solid #e8eaf0}
  .ftr p{font-size:12px;color:#aaa;line-height:1.8}
  .ftr strong{color:#888}
  .divider{height:1px;background:#eef0f5;margin:12px 0}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <div class="hdr-icon">${iconEmoji}</div>
    <h1>${title}</h1>
    <p>JPMorgan Chase &amp; Co. — Employee Assistant</p>
  </div>
  <div class="body">${bodyContent}</div>
  <div class="ftr">
    <p>This is an automated notification from <strong>JPMC Employee Assistant</strong>.<br/>
    Do not reply to this email. For support call extension <strong>1234</strong> or email <strong>helpdesk@jpmc.com</strong>.</p>
  </div>
</div>
</body>
</html>`;
}

function sendMail(to, subject, html) {
  transporter.sendMail({
    from: `"${process.env.GMAIL_FROM_NAME || 'JPMC Employee Assistant'}" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html
  }).then(() => console.log(`📧 Email sent → ${to}`))
    .catch(err => console.error(`⚠️ Email failed: ${err.message}`));
}

// ── 1. IT Ticket ──────────────────────────────
function sendTicketEmail(employee, ticket, category) {
  if (!employee?.email) return;

  const html = baseTemplate('IT Support Ticket Raised', '#0052cc', '🎫',
    `<p class="greeting">Hello ${employee.name},</p>
     <p class="sub">Your IT support ticket has been raised. Our team will contact you within the SLA window.</p>
     <div class="card">
       <div class="card-title">Ticket Details</div>
       <div class="row"><span class="rl">Ticket ID</span><span class="rv">${ticket.ticket_id}</span></div>
       <div class="row"><span class="rl">Issue</span><span class="rv">${ticket.issue_description}</span></div>
       <div class="row"><span class="rl">Category</span><span class="rv">${category.label}</span></div>
       <div class="row"><span class="rl">Assigned To</span><span class="rv">${category.team}</span></div>
       <div class="row"><span class="rl">SLA</span><span class="rv">Within ${category.sla_hours} hours</span></div>
       <div class="row"><span class="rl">Status</span><span class="rv"><span class="badge b-open">OPEN</span></span></div>
       <div class="row"><span class="rl">Raised At</span><span class="rv">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</span></div>
     </div>
     <p class="sub">Keep your Ticket ID <strong>${ticket.ticket_id}</strong> handy. You can check status anytime by calling the JPMC Assistant.</p>`
  );

  sendMail(employee.email, `[${ticket.ticket_id}] IT Support Ticket — ${category.label}`, html);
}

// ── 2. Room / Focus Booking ───────────────────
function sendRoomBookingEmail(employee, booking) {
  if (!employee?.email) return;

  const isFocus = booking.room_type === 'focus';
  const html = baseTemplate(
    isFocus ? 'Focus Room Booked' : 'Meeting Room Booked',
    '#0077b6',
    isFocus ? '🎯' : '🏢',
    `<p class="greeting">Hello ${employee.name},</p>
     <p class="sub">Your ${isFocus ? 'focus room' : 'meeting room'} has been booked successfully.</p>
     <div class="card">
       <div class="card-title">Booking Details</div>
       <div class="row"><span class="rl">Booking ID</span><span class="rv">${booking.booking_id}</span></div>
       <div class="row"><span class="rl">Room</span><span class="rv">${booking.room_name}</span></div>
       <div class="row"><span class="rl">Location</span><span class="rv">Floor ${booking.floor}, ${booking.building}</span></div>
       <div class="row"><span class="rl">Date</span><span class="rv">${booking.date}</span></div>
       <div class="row"><span class="rl">Time</span><span class="rv">${booking.start_time} – ${booking.end_time}</span></div>
       <div class="row"><span class="rl">Duration</span><span class="rv">${booking.duration_hours} hour(s)</span></div>
       <div class="row"><span class="rl">Agenda</span><span class="rv">${booking.agenda || 'Not specified'}</span></div>
       <div class="row"><span class="rl">Status</span><span class="rv"><span class="badge b-confirmed">CONFIRMED</span></span></div>
     </div>
     <p class="sub">To cancel, call the JPMC Assistant and quote Booking ID <strong>${booking.booking_id}</strong>.</p>`
  );

  sendMail(employee.email, `[${booking.booking_id}] ${isFocus ? 'Focus Room' : 'Meeting Room'} Booked — ${booking.room_name}, ${booking.date}`, html);
}

// ── 3. Food Order ─────────────────────────────
function sendFoodOrderEmail(employee, order, paymentLink) {
  if (!employee?.email) return;

  const itemRows = order.items.map(i =>
    `<div class="row"><span class="rl">${i.name}</span><span class="rv">₹${i.price}</span></div>`
  ).join('');

  const html = baseTemplate('Food Order Confirmed', '#e85d04', '🍽️',
    `<p class="greeting">Hello ${employee.name},</p>
     <p class="sub">Your food order is confirmed. Complete payment and collect from the outlet counter.</p>
     <div class="card">
       <div class="card-title">Order Details</div>
       <div class="row"><span class="rl">Order ID</span><span class="rv">${order.order_id}</span></div>
       <div class="row"><span class="rl">Outlet</span><span class="rv">${order.outlet_name}</span></div>
       <div class="row"><span class="rl">Location</span><span class="rv">Floor ${order.floor}, ${order.building}</span></div>
       <div class="row"><span class="rl">Status</span><span class="rv"><span class="badge b-pending">PENDING PAYMENT</span></span></div>
     </div>
     <div class="card">
       <div class="card-title">Items Ordered</div>
       ${itemRows}
       <div class="divider"></div>
       <div class="row">
         <span class="rl" style="font-weight:700;color:#1a1a2e">Total Amount</span>
         <span class="rv" style="font-size:16px;color:#e85d04">₹${order.total_amount}</span>
       </div>
     </div>
     <a href="${paymentLink}" class="cta">💳 Pay Now — ₹${order.total_amount}</a>
     <p class="sub" style="text-align:center;font-size:12px;margin-top:8px">Collect your order from the counter after payment.</p>`
  );

  sendMail(employee.email, `[${order.order_id}] Food Order — ${order.outlet_name} — ₹${order.total_amount}`, html);
}

// ── 4. Shuttle Booking ────────────────────────
function sendShuttleEmail(employee, booking) {
  if (!employee?.email) return;

  const html = baseTemplate('Shuttle Booking Confirmed', '#1a7a3a', '🚌',
    `<p class="greeting">Hello ${employee.name},</p>
     <p class="sub">Your shuttle is booked. Please be at the pickup point at least 5 minutes before departure.</p>
     <div class="card">
       <div class="card-title">Booking Details</div>
       <div class="row"><span class="rl">Booking ID</span><span class="rv">${booking.booking_id}</span></div>
       <div class="row"><span class="rl">Route</span><span class="rv">${booking.route_name}</span></div>
       <div class="row"><span class="rl">Travel Date</span><span class="rv">${booking.travel_date}</span></div>
       <div class="row"><span class="rl">Departure</span><span class="rv">${booking.departure_time}</span></div>
       <div class="row"><span class="rl">Pickup Point</span><span class="rv">${booking.pickup_point}</span></div>
       <div class="row"><span class="rl">Arrives JPMC By</span><span class="rv">${booking.arrival_time}</span></div>
       <div class="row"><span class="rl">Status</span><span class="rv"><span class="badge b-confirmed">CONFIRMED</span></span></div>
     </div>
     <p class="sub">⚠️ Cancellations must be made at least <strong>1 hour before departure</strong>. To cancel, call JPMC Assistant with Booking ID <strong>${booking.booking_id}</strong>.</p>`
  );

  sendMail(employee.email, `[${booking.booking_id}] Shuttle Booked — ${booking.route_name}, ${booking.travel_date} at ${booking.departure_time}`, html);
}

module.exports = { sendTicketEmail, sendRoomBookingEmail, sendFoodOrderEmail, sendShuttleEmail };
