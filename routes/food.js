const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const twilio = require('twilio');

const OUTLETS_PATH = path.join(__dirname, '../data/food-outlets.json');
const ORDERS_PATH  = path.join(__dirname, '../data/food-orders.json');
const employees    = require('../employees.json');

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

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
// TOOL 1: Search food by cuisine or item
// Scoped to employee's building first, then all
// ─────────────────────────────────────────────
router.post('/search', (req, res) => {
  console.log('📥 food/search');

  const args        = extractArgs(req);
  const toolCallId  = getToolCallId(req);
  const phone       = getCallerPhone(req);
  const employee    = getEmployeeByPhone(phone);

  const { query } = args;
  if (!query) {
    return vapiResponse(res, toolCallId, 'What are you looking for? You can ask for a cuisine like Chinese, or a specific item like biryani.');
  }

  const { outlets } = readJSON(OUTLETS_PATH);
  const queryLower  = query.toLowerCase();
  const queryWords  = queryLower.split(/\s+/);

  // Score each outlet
  const scored = outlets.map(outlet => {
    let score = 0;

    // Boost outlets in employee's building
    if (employee?.building && outlet.building === employee.building) score += 10;

    // Match cuisine tags
    for (const word of queryWords) {
      if (outlet.cuisine_tags.some(t => t.includes(word) || word.includes(t))) score += 5;
    }

    // Match menu item names
    const matchingItems = outlet.menu.filter(item => {
      const nameLower = item.name.toLowerCase();
      const descLower = item.description.toLowerCase();
      return queryWords.some(w => nameLower.includes(w) || descLower.includes(w) ||
        outlet.cuisine_tags.some(t => t.includes(w) || w.includes(t)));
    });

    score += matchingItems.length * 3;

    return { outlet, matchingItems, score };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return vapiResponse(res, toolCallId,
      `I could not find any outlets serving "${query}" right now. ` +
      `Available cuisines are: Chinese, Indian, Thali, Beverages, Cereal, South Indian, and Healthy bowls.`
    );
  }

  const top = scored[0];
  const outlet = top.outlet;
  const items  = top.matchingItems.length > 0 ? top.matchingItems : outlet.menu.slice(0, 3);
  const inYourBuilding = employee?.building === outlet.building;

  const itemList = items.slice(0, 3)
    .map(i => `${i.name} for rupees ${i.price}`)
    .join(', ');

  const locationNote = inYourBuilding
    ? `in your building ${outlet.building}`
    : `in ${outlet.building}`;

  return vapiResponse(res, toolCallId,
    `I found ${outlet.name} ${locationNote} on Floor ${outlet.floor}, open ${outlet.timings}. ` +
    `They serve: ${itemList}. ` +
    `Would you like to order something from here? Just tell me what you want and I will place the order.`
  );
});

// ─────────────────────────────────────────────
// TOOL 2: Place a food order + send SMS
// ─────────────────────────────────────────────
router.post('/place-order', (req, res) => {
  console.log('📥 food/place-order');

  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);

  const { outlet_id, item_ids } = args;

  if (!outlet_id || !item_ids || item_ids.length === 0) {
    return vapiResponse(res, toolCallId,
      'I need the outlet and items to place the order. Could you confirm what you would like to order?'
    );
  }

  const { outlets } = readJSON(OUTLETS_PATH);
  const outlet = outlets.find(o => o.outlet_id === outlet_id);

  if (!outlet) {
    return vapiResponse(res, toolCallId, 'I could not find that outlet. Please try searching again.');
  }

  // Resolve ordered items
  const orderedItems = item_ids.map(id => outlet.menu.find(m => m.item_id === id)).filter(Boolean);

  if (orderedItems.length === 0) {
    return vapiResponse(res, toolCallId, 'I could not find those items on the menu. Please try again.');
  }

  const totalAmount = orderedItems.reduce((sum, i) => sum + i.price, 0);

  // Save order
  const ordersData  = readJSON(ORDERS_PATH);
  const newOrderId  = ordersData.last_order_id + 1;
  const paymentLink = `https://pay.jpmc-demo.com/order/${newOrderId}`;

  const newOrder = {
    order_id:      `JPMC-FOOD-${newOrderId}`,
    outlet_id:     outlet.outlet_id,
    outlet_name:   outlet.name,
    building:      outlet.building,
    floor:         outlet.floor,
    employee_sid:  employee?.sid  || 'UNKNOWN',
    employee_name: employee?.name || 'Unknown',
    phone_number:  phone || 'Unknown',
    items:         orderedItems.map(i => ({ item_id: i.item_id, name: i.name, price: i.price })),
    total_amount:  totalAmount,
    payment_link:  paymentLink,
    status:        'PENDING_PAYMENT',
    ordered_at:    new Date().toISOString()
  };

  ordersData.orders.push(newOrder);
  ordersData.last_order_id = newOrderId;
  writeJSON(ORDERS_PATH, newOrder);
  writeJSON(ORDERS_PATH, ordersData);

  console.log(`🍕 Order placed: ${newOrder.order_id} for ${newOrder.employee_name}, ₹${totalAmount}`);

  // Send SMS via Twilio
  const itemNames = orderedItems.map(i => i.name).join(', ');
  const smsBody =
    `✅ JPMC Food Order Confirmed!\n` +
    `Order ID: ${newOrder.order_id}\n` +
    `Items: ${itemNames}\n` +
    `Outlet: ${outlet.name}, ${outlet.building} Floor ${outlet.floor}\n` +
    `Total: ₹${totalAmount}\n` +
    `Pay here: ${paymentLink}\n` +
    `Collect from the outlet counter after payment.`;

  twilioClient.messages.create({
    body: smsBody,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: phone
  }).then(msg => {
    console.log(`📱 SMS sent to ${phone}: ${msg.sid}`);
  }).catch(err => {
    console.error(`⚠️ SMS failed: ${err.message}`);
  });

  return vapiResponse(res, toolCallId,
    `Your order has been placed! Order ID is ${newOrder.order_id}. ` +
    `You ordered ${itemNames} from ${outlet.name} on Floor ${outlet.floor}, ${outlet.building}. ` +
    `Total amount is rupees ${totalAmount}. ` +
    `I have sent you an SMS with the payment link. Please pay and collect from the outlet counter.`
  );
});

// ─────────────────────────────────────────────
// TOOL 3: Get outlet menu by outlet ID
// So Alex can confirm items before ordering
// ─────────────────────────────────────────────
router.post('/get-menu', (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const { outlet_id } = args;

  const { outlets } = readJSON(OUTLETS_PATH);
  const outlet = outlets.find(o => o.outlet_id === outlet_id);

  if (!outlet) {
    return vapiResponse(res, toolCallId, 'I could not find that outlet.');
  }

  const menuText = outlet.menu
    .map(i => `${i.name} for rupees ${i.price} — ${i.description}`)
    .join('. ');

  return vapiResponse(res, toolCallId,
    `Here is the full menu for ${outlet.name}: ${menuText}. What would you like to order?`
  );
});

module.exports = router;
