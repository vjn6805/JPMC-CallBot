const express  = require('express');
const router   = express.Router();
const twilio   = require('twilio');
const { FoodOrder } = require('../models');
const outlets  = require('../data/food-outlets.json').outlets;
const employees = require('../employees.json');

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

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

// TOOL 1: Search food by cuisine or item
router.post('/search', (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);
  const { query }  = args;

  if (!query) {
    return vapiResponse(res, toolCallId, 'What are you looking for? You can ask for a cuisine like Chinese, or a specific item like biryani.');
  }

  const queryWords = query.toLowerCase().split(/\s+/);

  const scored = outlets.map(outlet => {
    let score = 0;
    if (employee?.building && outlet.building === employee.building) score += 10;
    for (const word of queryWords) {
      if (outlet.cuisine_tags.some(t => t.includes(word) || word.includes(t))) score += 5;
    }
    const matchingItems = outlet.menu.filter(item =>
      queryWords.some(w =>
        item.name.toLowerCase().includes(w) ||
        item.description.toLowerCase().includes(w) ||
        outlet.cuisine_tags.some(t => t.includes(w) || w.includes(t))
      )
    );
    score += matchingItems.length * 3;
    return { outlet, matchingItems, score };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return vapiResponse(res, toolCallId,
      `I could not find any outlets serving "${query}". Available cuisines: Chinese, Indian, Thali, Beverages, Cereal, South Indian, and Healthy bowls.`
    );
  }

  const { outlet, matchingItems } = scored[0];
  const items = (matchingItems.length > 0 ? matchingItems : outlet.menu).slice(0, 3);
  const inYourBuilding = employee?.building === outlet.building;

  return vapiResponse(res, toolCallId,
    `I found ${outlet.name} ${inYourBuilding ? `in your building ${outlet.building}` : `in ${outlet.building}`} on Floor ${outlet.floor}, open ${outlet.timings}. ` +
    `They serve: ${items.map(i => `${i.name} for rupees ${i.price}`).join(', ')}. ` +
    `Would you like to order something? Just tell me what you want.`
  );
});

// TOOL 2: Place a food order + send SMS
router.post('/place-order', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);
  const { outlet_id, item_ids } = args;

  if (!outlet_id || !item_ids?.length) {
    return vapiResponse(res, toolCallId, 'I need the outlet and items to place the order.');
  }

  const outlet = outlets.find(o => o.outlet_id === outlet_id);
  if (!outlet) return vapiResponse(res, toolCallId, 'I could not find that outlet.');

  const orderedItems = item_ids.map(id => outlet.menu.find(m => m.item_id === id)).filter(Boolean);
  if (orderedItems.length === 0) return vapiResponse(res, toolCallId, 'I could not find those items on the menu.');

  const totalAmount = orderedItems.reduce((sum, i) => sum + i.price, 0);
  const count       = await FoodOrder.countDocuments();
  const orderId     = `JPMC-FOOD-${3001 + count}`;
  const paymentLink = `https://pay.jpmc-demo.com/order/${orderId}`;

  await FoodOrder.create({
    order_id:      orderId,
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
    status:        'PENDING_PAYMENT'
  });

  const itemNames = orderedItems.map(i => i.name).join(', ');
  console.log(`🍕 Order: ${orderId} for ${employee?.name}, ₹${totalAmount}`);

  twilioClient.messages.create({
    body: `✅ JPMC Food Order!\nOrder ID: ${orderId}\nItems: ${itemNames}\nOutlet: ${outlet.name}, ${outlet.building} Floor ${outlet.floor}\nTotal: ₹${totalAmount}\nPay: ${paymentLink}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: phone
  }).catch(err => console.error(`⚠️ SMS failed: ${err.message}`));

  return vapiResponse(res, toolCallId,
    `Order placed! Order ID is ${orderId}. ` +
    `${itemNames} from ${outlet.name}, Floor ${outlet.floor}, ${outlet.building}. ` +
    `Total rupees ${totalAmount}. SMS with payment link sent to your number.`
  );
});

// TOOL 3: Get full menu
router.post('/get-menu', (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const outlet     = outlets.find(o => o.outlet_id === args.outlet_id);

  if (!outlet) return vapiResponse(res, toolCallId, 'I could not find that outlet.');

  const menuText = outlet.menu.map(i => `${i.name} for rupees ${i.price} — ${i.description}`).join('. ');
  return vapiResponse(res, toolCallId, `Menu for ${outlet.name}: ${menuText}. What would you like to order?`);
});

module.exports = router;
