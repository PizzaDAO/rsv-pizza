// Generate large test parties for RSVPizza
const https = require('https');

const SUPABASE_URL = 'znpiwdvvsqaxuskpfleo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpucGl3ZHZ2c3FheHVza3BmbGVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwMjA0ODQsImV4cCI6MjA4MzU5NjQ4NH0.yAb2_JOtyYD0uqvqoPufzc5kG2pNjyqd1pC97UViXuw';

// Sample data
const firstNames = ['Alex', 'Jordan', 'Taylor', 'Casey', 'Morgan', 'Riley', 'Quinn', 'Avery', 'Peyton', 'Cameron', 'Drew', 'Skyler', 'Reese', 'Parker', 'Hayden', 'Jamie', 'Dakota', 'Kendall', 'Blake', 'Charlie', 'Emery', 'Finley', 'Harper', 'Jesse', 'Kerry', 'Logan', 'Micah', 'Nico', 'Oakley', 'Phoenix', 'Remy', 'Sage', 'Tatum', 'Val', 'Winter', 'Zion', 'Addison', 'Bailey', 'Corey', 'Devon', 'Ellis', 'Flynn', 'Gray', 'Harley', 'Indigo', 'Jules', 'Kit', 'Lane', 'Marley', 'Noel'];
const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson'];

const dietaryRestrictions = ['Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free', 'Nut-Free', 'Halal', 'Kosher'];
const toppings = [
  'pepperoni', 'sausage', 'bacon', 'ham', 'chicken', 'beef', 'meatball',
  'mushrooms', 'onions', 'peppers', 'olives', 'tomatoes', 'spinach', 'basil', 'garlic', 'jalapenos', 'artichokes', 'broccoli',
  'extra cheese', 'mozzarella', 'feta', 'ricotta', 'goat cheese',
  'pineapple', 'anchovies'
];

const meatToppings = ['pepperoni', 'sausage', 'bacon', 'ham', 'chicken', 'beef', 'meatball', 'anchovies'];
const dairyToppings = ['extra cheese', 'mozzarella', 'feta', 'ricotta', 'goat cheese'];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomSubset(arr, min, max) {
  const count = Math.floor(Math.random() * (max - min + 1)) + min;
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function generateGuest() {
  const name = `${randomChoice(firstNames)} ${randomChoice(lastNames)}`;

  // 20% chance of having dietary restrictions
  let restrictions = [];
  if (Math.random() < 0.20) {
    // Pick 1-2 restrictions
    restrictions = randomSubset(dietaryRestrictions, 1, 2);
  }

  // Filter toppings based on dietary restrictions
  let availableLikes = [...toppings];
  let availableDislikes = [...toppings];

  if (restrictions.includes('Vegetarian') || restrictions.includes('Vegan')) {
    availableLikes = availableLikes.filter(t => !meatToppings.includes(t));
  }
  if (restrictions.includes('Vegan') || restrictions.includes('Dairy-Free')) {
    availableLikes = availableLikes.filter(t => !dairyToppings.includes(t));
  }

  // Pick 2-5 liked toppings
  const likedToppings = randomSubset(availableLikes, 2, 5);

  // Pick 0-3 disliked toppings (not overlapping with liked)
  const dislikedToppings = randomSubset(
    availableDislikes.filter(t => !likedToppings.includes(t)),
    0, 3
  );

  return {
    name,
    dietary_restrictions: restrictions,
    liked_toppings: likedToppings,
    disliked_toppings: dislikedToppings,
    submitted_via: 'host'
  };
}

function makeRequest(method, path, data) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
    const options = {
      hostname: SUPABASE_URL,
      port: 443,
      path: `/rest/v1${path}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=representation'
      }
    };
    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch {
          resolve(responseData);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Calculate RSVP rate based on party size
// 80% for ~20 guests, drops to ~15% for 600 guests
function getRsvpRate(expectedGuests) {
  if (expectedGuests <= 20) return 0.80;
  // Exponential decay from 80% to 15%
  const rate = 0.15 + 0.65 * Math.exp(-(expectedGuests - 20) / 180);
  return Math.max(0.15, Math.min(0.80, rate));
}

async function createParty(name, expectedGuests, address) {
  const rsvpRate = getRsvpRate(expectedGuests);
  const actualRsvps = Math.round(expectedGuests * rsvpRate);

  console.log(`\nCreating party: ${name}`);
  console.log(`  Expected guests: ${expectedGuests}, RSVP rate: ${(rsvpRate * 100).toFixed(0)}%, Actual RSVPs: ${actualRsvps}`);

  // Create party with expected guest count (max_guests)
  const party = await makeRequest('POST', '/parties', {
    name,
    host_name: 'Test Host',
    pizza_style: 'new-york',
    max_guests: expectedGuests,
    address
  });

  if (!party || !party[0]) {
    console.error('Failed to create party:', party);
    return null;
  }

  const partyId = party[0].id;
  const inviteCode = party[0].invite_code;
  console.log(`  Party created with invite code: ${inviteCode}`);

  // Generate only the guests who actually RSVP'd
  const batchSize = 50;
  let created = 0;

  for (let i = 0; i < actualRsvps; i += batchSize) {
    const batch = [];
    const batchCount = Math.min(batchSize, actualRsvps - i);

    for (let j = 0; j < batchCount; j++) {
      const guest = generateGuest();
      guest.party_id = partyId;
      batch.push(guest);
    }

    const result = await makeRequest('POST', '/guests', batch);
    created += batchCount;
    console.log(`  Created ${created}/${actualRsvps} RSVPs...`);
  }

  console.log(`  Done! ${actualRsvps} RSVPs out of ${expectedGuests} expected`);
  console.log(`  Link: https://pizzadao.github.io/rsv-pizza/#/party/${inviteCode}`);
  return inviteCode;
}

async function main() {
  console.log('Generating test parties for RSVPizza...');
  console.log('RSVP rates: ~80% for 20 guests, ~40% for 200, ~15% for 600\n');

  // Small party - high RSVP rate
  await createParty(
    'Team Lunch (20 expected)',
    20,
    '123 Main St, Austin, TX'
  );

  // Medium party
  await createParty(
    'Department Offsite (50 expected)',
    50,
    '456 Oak Ave, Denver, CO'
  );

  // Large party
  await createParty(
    'Company All-Hands (200 expected)',
    200,
    '1600 Amphitheatre Parkway, Mountain View, CA'
  );

  // Very large party - low RSVP rate
  await createParty(
    'Tech Conference (600 expected)',
    600,
    '747 Howard St, San Francisco, CA'
  );

  console.log('\n\nAll parties created! View them at:');
  console.log('https://pizzadao.github.io/rsv-pizza/#/parties');
}

main().catch(console.error);
