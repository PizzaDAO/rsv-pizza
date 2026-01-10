const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://znpiwdvvsqaxuskpfleo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpucGl3ZHZ2c3FheHVza3BmbGVvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODAyMDQ4NCwiZXhwIjoyMDgzNTk2NDg0fQ.KkAjyc8k6FbX4YxWPJEhOsInijffOcPtp6roESj4U9s'
);

const TOPPINGS = ['pepperoni', 'sausage', 'bacon', 'ham', 'chicken', 'mushrooms', 'onions', 'bell-peppers', 'olives', 'spinach', 'jalapenos', 'tomatoes', 'extra-cheese', 'feta', 'pineapple'];
const DIETARY = ['Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free'];
const NAMES = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack', 'Kate', 'Leo', 'Mia', 'Noah', 'Olivia', 'Pete', 'Quinn', 'Rose', 'Sam', 'Tina', 'Uma', 'Victor', 'Wendy', 'Xavier', 'Yara', 'Zack'];

function randomPick(arr, count) {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

function generateGuest(name, dietaryChance = 0.15) {
  const hasDietary = Math.random() < dietaryChance;
  const dietary = hasDietary ? randomPick(DIETARY, 1) : [];

  // Filter toppings based on dietary restrictions
  let availableToppings = [...TOPPINGS];
  if (dietary.includes('Vegetarian') || dietary.includes('Vegan')) {
    availableToppings = availableToppings.filter(t => !['pepperoni', 'sausage', 'bacon', 'ham', 'chicken'].includes(t));
  }
  if (dietary.includes('Vegan') || dietary.includes('Dairy-Free')) {
    availableToppings = availableToppings.filter(t => !['extra-cheese', 'feta'].includes(t));
  }

  const likedCount = Math.floor(Math.random() * 4) + 1; // 1-4 liked
  const dislikedCount = Math.floor(Math.random() * 3); // 0-2 disliked

  const liked = randomPick(availableToppings, likedCount);
  const remaining = availableToppings.filter(t => !liked.includes(t));
  const disliked = randomPick(remaining, dislikedCount);

  return {
    name,
    dietary_restrictions: dietary,
    liked_toppings: liked,
    disliked_toppings: disliked,
  };
}

async function createTestParty(name, expectedGuests, respondingGuests, pizzaStyle = 'new-york') {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Creating: ${name}`);
  console.log(`Expected: ${expectedGuests} guests, ${respondingGuests} responding`);
  console.log(`Style: ${pizzaStyle}`);
  console.log('='.repeat(60));

  // Create party
  const { data: party, error: partyError } = await supabase
    .from('parties')
    .insert({
      name,
      host_name: 'Test Host',
      pizza_style: pizzaStyle,
      max_guests: expectedGuests,
    })
    .select()
    .single();

  if (partyError) {
    console.error('Error creating party:', partyError);
    return null;
  }

  console.log(`\nParty created! Invite code: ${party.invite_code}`);
  console.log(`Host URL: https://pizzadao.github.io/rsv-pizza/#/party/${party.invite_code}`);
  console.log(`Guest RSVP URL: https://pizzadao.github.io/rsv-pizza/#/rsvp/${party.invite_code}`);

  // Add responding guests
  const guests = [];
  const usedNames = new Set();

  for (let i = 0; i < respondingGuests; i++) {
    let name;
    do {
      name = NAMES[Math.floor(Math.random() * NAMES.length)];
    } while (usedNames.has(name));
    usedNames.add(name);

    const guestData = generateGuest(name);
    guests.push(guestData);

    const { error: guestError } = await supabase
      .from('guests')
      .insert({
        party_id: party.id,
        name: guestData.name,
        dietary_restrictions: guestData.dietary_restrictions,
        liked_toppings: guestData.liked_toppings,
        disliked_toppings: guestData.disliked_toppings,
        submitted_via: 'link',
      });

    if (guestError) {
      console.error(`Error adding guest ${name}:`, guestError);
    }
  }

  // Print guest summary
  console.log(`\nGuest Responses (${respondingGuests} of ${expectedGuests}):`);
  console.log('-'.repeat(40));
  guests.forEach(g => {
    const dietary = g.dietary_restrictions.length > 0 ? `[${g.dietary_restrictions.join(', ')}]` : '';
    console.log(`  ${g.name} ${dietary}`);
    console.log(`    Likes: ${g.liked_toppings.join(', ')}`);
    if (g.disliked_toppings.length > 0) {
      console.log(`    Dislikes: ${g.disliked_toppings.join(', ')}`);
    }
  });

  return { party, guests };
}

async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('RSVPizza Test Scenarios');
  console.log('='.repeat(60));

  const scenarios = [
    // Scenario 1: Small party, everyone responds
    { name: 'Small Office Lunch', expected: 8, responding: 8, style: 'new-york' },

    // Scenario 2: Medium party, half respond
    { name: 'Birthday Party', expected: 20, responding: 10, style: 'new-york' },

    // Scenario 3: Large party, few respond
    { name: 'Company Event', expected: 50, responding: 12, style: 'detroit' },

    // Scenario 4: Neapolitan style party
    { name: 'Italian Night', expected: 15, responding: 15, style: 'neapolitan' },
  ];

  const results = [];

  for (const scenario of scenarios) {
    const result = await createTestParty(
      scenario.name,
      scenario.expected,
      scenario.responding,
      scenario.style
    );
    if (result) {
      results.push({ ...scenario, ...result });
    }
  }

  // Print summary
  console.log('\n\n' + '='.repeat(60));
  console.log('TEST SUMMARY - Visit these URLs to see recommendations:');
  console.log('='.repeat(60));

  results.forEach(r => {
    console.log(`\n${r.name}:`);
    console.log(`  Expected: ${r.expected} | Responded: ${r.responding} | Style: ${r.style}`);
    console.log(`  Host URL: https://pizzadao.github.io/rsv-pizza/#/party/${r.party.invite_code}`);
  });

  console.log('\n\nDone! Open the Host URLs above and click "Generate Recommendations" to see the pizza orders.\n');
}

runTests().catch(console.error);
