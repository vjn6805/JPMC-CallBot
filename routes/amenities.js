const express = require('express');
const router = express.Router();
const gamesData = require('../data/games.json');
const employees = require('../employees.json');

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

function getEmployeeByPhone(phone) { return phone ? (employees[phone] || null) : null; }

function vapiResponse(res, toolCallId, resultText) {
  return res.json({ results: [{ toolCallId, result: resultText }] });
}

// ─────────────────────────────────────────────
// TOOL: Locate a game in JPMC towers
// ─────────────────────────────────────────────
router.post('/locate-game', (req, res) => {
  const args = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone = getCallerPhone(req);
  const employee = getEmployeeByPhone(phone);

  const gameNameQuery = args.game_name;
  if (!gameNameQuery) {
    return vapiResponse(res, toolCallId, "Please tell me which game or activity you are looking for.");
  }

  const queryLower = gameNameQuery.toLowerCase().trim();

  // Robust fuzzy matching across name, id, and aliases
  const game = gamesData.games.find(g => {
    const nameMatch = g.name.toLowerCase().includes(queryLower) || queryLower.includes(g.name.toLowerCase());
    const idMatch = g.id.toLowerCase().includes(queryLower) || queryLower.includes(g.id.toLowerCase());
    const aliasMatch = g.aliases.some(alias => 
      alias.toLowerCase().includes(queryLower) || queryLower.includes(alias.toLowerCase())
    );
    return nameMatch || idMatch || aliasMatch;
  });

  if (!game) {
    const availableGamesList = gamesData.games.map(g => g.name).join(', ');
    return vapiResponse(res, toolCallId, `I couldn't find a game matching "${gameNameQuery}". We have facilities for: ${availableGamesList}. Which one would you like to locate?`);
  }

  const employeeBuilding = employee?.building || null;

  if (employeeBuilding) {
    // Check if game exists in employee's building/tower
    const localLocation = game.locations.find(loc => loc.building.toLowerCase() === employeeBuilding.toLowerCase());
    if (localLocation) {
      return vapiResponse(res, toolCallId, `The ${game.name} is located in your building (${employeeBuilding}) on Floor ${localLocation.floor}.`);
    } else {
      // Find where else it is located
      const otherLocations = game.locations.map(loc => `${loc.building} (Floor ${loc.floor})`).join(', ');
      return vapiResponse(res, toolCallId, `The ${game.name} is not available in your building (${employeeBuilding}), but it is located in: ${otherLocations}.`);
    }
  } else {
    // No registered building or unauthenticated: return all locations
    const allLocations = game.locations.map(loc => `${loc.building} (Floor ${loc.floor})`).join(', ');
    return vapiResponse(res, toolCallId, `The ${game.name} is located in: ${allLocations}.`);
  }
});

module.exports = router;
