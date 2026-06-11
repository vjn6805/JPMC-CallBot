const express   = require('express');
const router    = express.Router();
const twilio    = require('twilio');
const { FoodOrder } = require('../models');
const outlets   = require('../data/food-outlets.json').outlets;
const employees = require('../employees.json');
const { sendFoodOrderEmail } = require('../utils/email');

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

async function createOrder(outlet, orderedItems, phone, employee) {
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

  // Send confirmation email
  sendFoodOrderEmail(employee, {
    order_id: orderId, outlet_name: outlet.name, building: outlet.building,
    floor: outlet.floor, items: orderedItems, total_amount: totalAmount
  }, paymentLink);

  // Send SMS — non-blocking
  twilioClient.messages.create({
    body: `✅ JPMC Food Order Confirmed!\nOrder ID: ${orderId}\nItems: ${itemNames}\nOutlet: ${outlet.name}, ${outlet.building} Floor ${outlet.floor}\nTotal: ₹${totalAmount}\nPay here: ${paymentLink}\nCollect from counter after payment.`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: phone
  }).catch(err => console.error(`⚠️ SMS failed: ${err.message}`));

  return { orderId, itemNames, totalAmount, paymentLink };
}

// ─────────────────────────────────────────────
// TOOL 1: Search food
// Returns outlet + items WITH their IDs embedded
// so the LLM can use them in place_food_order
// ─────────────────────────────────────────────
router.post('/search', (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);
  const { query }  = args;

  if (!query) {
    return vapiResponse(res, toolCallId,
      'What would you like to eat? You can ask for a cuisine like Chinese or South Indian, or a dish like biryani or momos.'
    );
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
      `I could not find "${query}". Available options: Chinese, Indian, Thali, South Indian, Beverages, Cereal, and Healthy bowls. What would you like?`
    );
  }

  const { outlet, matchingItems } = scored[0];
  const items = (matchingItems.length > 0 ? matchingItems : outlet.menu).slice(0, 4);
  const inBuilding = employee?.building === outlet.building;

  // ── KEY FIX: embed outlet_id and item_ids in the response ──
  const itemList = items.map(i =>
    `${i.name} (item_id: ${i.item_id}) for rupees ${i.price}`
  ).join(', ');

  return vapiResponse(res, toolCallId,
    `OUTLET_FOUND. outlet_id: ${outlet.outlet_id}. ` +
    `${outlet.name} ${inBuilding ? `is in your building ${outlet.building}` : `is in ${outlet.building}`}, Floor ${outlet.floor}, open ${outlet.timings}. ` +
    `Menu: ${itemList}. ` +
    `Tell me which items you want and I will place the order for you.`
  );
});

// ─────────────────────────────────────────────
// TOOL 2: Place order by item names (not IDs)
// LLM calls this with outlet_id from search +
// item names as spoken by the user
// ─────────────────────────────────────────────
router.post('/order-by-name', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);

  const { outlet_id, item_names } = args;

  if (!outlet_id || !item_names?.length) {
    return vapiResponse(res, toolCallId,
      'I need the outlet and item names to place the order. Please tell me what you want to order.'
    );
  }

  const outlet = outlets.find(o => o.outlet_id === outlet_id);
  if (!outlet) return vapiResponse(res, toolCallId, 'I could not find that outlet. Please search again.');

  // Fuzzy match item names — handles "fried rice" matching "Veg Fried Rice"
  const orderedItems = [];
  for (const name of item_names) {
    const nameLower = name.toLowerCase().trim();
    const match = outlet.menu.find(m =>
      m.name.toLowerCase().includes(nameLower) ||
      nameLower.includes(m.name.toLowerCase()) ||
      m.name.toLowerCase().split(' ').some(w => nameLower.includes(w) && w.length > 3)
    );
    if (match && !orderedItems.find(i => i.item_id === match.item_id)) {
      orderedItems.push(match);
    }
  }

  if (orderedItems.length === 0) {
    const menuNames = outlet.menu.map(i => i.name).join(', ');
    return vapiResponse(res, toolCallId,
      `I could not find those items at ${outlet.name}. Available items are: ${menuNames}. Which would you like?`
    );
  }

  const totalAmount = orderedItems.reduce((sum, i) => sum + i.price, 0);
  const itemNames   = orderedItems.map(i => i.name).join(' and ');

  // Confirm before placing — return confirmation request to Alex
  return vapiResponse(res, toolCallId,
    `CONFIRM_ORDER. outlet_id: ${outlet.outlet_id}. item_ids: ${orderedItems.map(i => i.item_id).join(',')}. ` +
    `Confirming your order: ${itemNames} from ${outlet.name}, Floor ${outlet.floor}, ${outlet.building}. ` +
    `Total will be rupees ${totalAmount}. ` +
    `Shall I place this order? Say yes to confirm or tell me if you want to change anything.`
  );
});

// ─────────────────────────────────────────────
// TOOL 3: Place order by IDs (called after confirmation)
// ─────────────────────────────────────────────
router.post('/place-order', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);

  let { outlet_id, item_ids } = args;

  // item_ids might come as comma-separated string from CONFIRM_ORDER
  if (typeof item_ids === 'string') {
    item_ids = item_ids.split(',').map(s => s.trim()).filter(Boolean);
  }

  if (!outlet_id || !item_ids?.length) {
    return vapiResponse(res, toolCallId, 'I need the outlet and items to place the order.');
  }

  const outlet = outlets.find(o => o.outlet_id === outlet_id);
  if (!outlet) return vapiResponse(res, toolCallId, 'I could not find that outlet.');

  const orderedItems = item_ids.map(id => outlet.menu.find(m => m.item_id === id)).filter(Boolean);
  if (orderedItems.length === 0) return vapiResponse(res, toolCallId, 'I could not match those items. Please try ordering again.');

  const { orderId, itemNames, totalAmount } = await createOrder(outlet, orderedItems, phone, employee);

  return vapiResponse(res, toolCallId,
    `Order placed! Your order ID is ${orderId}. ` +
    `${itemNames} from ${outlet.name} on Floor ${outlet.floor}, ${outlet.building}. ` +
    `Total is rupees ${totalAmount}. ` +
    `I have sent you an SMS with the payment link. Please pay and collect from the counter.`
  );
});

// ─────────────────────────────────────────────
// TOOL 4: Get full menu by outlet_id
// ─────────────────────────────────────────────
router.post('/get-menu', (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const outlet     = outlets.find(o => o.outlet_id === args.outlet_id);

  if (!outlet) return vapiResponse(res, toolCallId, 'I could not find that outlet.');

  const menuText = outlet.menu.map(i =>
    `${i.name} (item_id: ${i.item_id}) for rupees ${i.price}`
  ).join(', ');

  return vapiResponse(res, toolCallId,
    `Full menu for ${outlet.name}: ${menuText}. What would you like to order?`
  );
});

module.exports = router;
