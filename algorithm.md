# Pizza Recommendation Algorithm

This document describes how RSVPizza generates optimized pizza orders based on guest preferences.

## Overview

The algorithm takes guest preferences (liked toppings, disliked toppings, dietary restrictions) and generates a pizza order that:
1. Respects all dietary restrictions
2. Maximizes guest satisfaction
3. Minimizes total pizzas needed
4. Handles non-respondents with sensible defaults

**Core file:** `frontend/src/utils/pizzaAlgorithm.ts`

---

## Input Data

### Guest Preferences
Each guest provides:
- **Liked toppings**: Toppings they want on their pizza
- **Disliked toppings**: Toppings they refuse to eat (veto power)
- **Dietary restrictions**: Vegetarian, Vegan, Gluten-Free, Dairy-Free, or None

### Available Toppings (15)
| Category | Toppings |
|----------|----------|
| Meat | pepperoni, sausage, bacon, ham, chicken |
| Vegetable | mushrooms, onions, bell-peppers, olives, spinach, jalapeños, tomatoes |
| Cheese | extra-cheese, feta |
| Fruit | pineapple |

### Dietary Exclusions
| Restriction | Excluded Toppings |
|-------------|-------------------|
| Vegetarian | pepperoni, sausage, bacon, ham, chicken |
| Vegan | pepperoni, sausage, bacon, ham, chicken, extra-cheese, feta |
| Dairy-Free | extra-cheese, feta |
| Gluten-Free | (handled at crust level, no topping exclusions) |

---

## Algorithm Steps

### Step 1: Group Guests by Compatibility

**Goal:** Create groups of guests who can share a pizza.

**Phase 1 - Dietary Grouping:**
- Guests are first grouped by matching dietary restriction profiles
- This ensures dietary compatibility within each pizza

**Phase 2 - Topping Compatibility (for large groups):**

When a dietary group exceeds the max guests per pizza, we use a greedy algorithm:

```
Compatibility Score between Guest A and Guest B:
  = (shared liked toppings × 2) - conflicts

Where conflicts = toppings A likes that B dislikes + toppings B likes that A dislikes
```

The algorithm:
1. Start with an unassigned guest as the group seed
2. Calculate compatibility score with all remaining guests
3. Add the most compatible guest to the group
4. Repeat until group reaches max size
5. Start new group with next unassigned guest

**Max Guests Per Pizza:**
| Style | Max Guests |
|-------|------------|
| Neapolitan | 2 |
| New York | 5 |
| Detroit | 5 |

---

### Step 2: Select Toppings for Each Group

**Goal:** Choose up to 3 toppings that maximize group satisfaction.

For each guest group:

1. **Build exclusion set**: Collect all toppings excluded by dietary restrictions
2. **Count popularity**: For each allowed topping, count how many guests like it
3. **Apply veto rule**: Remove any topping that ANY guest in the group dislikes
4. **Select top 3**: Sort by popularity, take top 3 most-liked toppings

**Key rule:** A single guest's dislike vetoes a topping for the entire pizza.

---

### Step 2.5: Half-and-Half Detection

**Goal:** When guests have conflicting preferences, split the pizza into two halves.

**When to use half-and-half:**
1. Group has 2+ guests with significant topping conflicts
2. Some guests like toppings that others dislike
3. Half-and-half would improve satisfaction by >20% OR single pizza has negative satisfaction

**Conflict Detection:**
```
For each topping:
  conflictScore += min(guestsWhoLike, guestsWhoDislike)

useHalfAndHalf = conflictScore >= ceil(groupSize / 2)
```

**Split Algorithm:**
1. Find the two least compatible guests (most conflicts)
2. Place them in separate groups
3. Assign remaining guests to whichever group they're more compatible with
4. Generate optimal toppings for each half independently

**Example:**
- Group: Alice (likes pepperoni, dislikes mushrooms), Bob (likes mushrooms, dislikes pepperoni)
- Conflict: Each likes what the other dislikes
- Result: Half pepperoni (Alice), half mushrooms (Bob)

**Output:** Pizza with `isHalfAndHalf: true`, `leftHalf`, and `rightHalf` containing separate toppings and guest assignments.

---

### Step 3: Calculate Pizza Size

**Goal:** Select the smallest pizza that feeds the group.

**Serving Formula (New York & Detroit):**
```
servings = (diameter / 18)² × 4
```

| Size | Diameter | Servings |
|------|----------|----------|
| Personal | 10" | 1.2 |
| Small | 12" | 1.8 |
| Medium | 14" | 2.4 |
| Large | 16" | 3.2 |
| Extra Large | 18" | 4.0 |
| Family | 20" | 4.9 |

**Neapolitan:** Fixed at 1 pizza per 1.5 guests (personal-sized, authentic Italian style)

---

### Step 4: Consolidate Identical Pizzas

**Goal:** Merge pizzas with the same configuration into quantity counts.

Pizzas are considered identical if they match on:
- Toppings (sorted)
- Dietary restrictions (sorted)
- Size

Identical pizzas are merged: `quantity++`, guest counts combined.

---

### Step 5: Generate Default Pizzas for Non-Respondents

**Goal:** Create sensible pizzas for guests who haven't RSVP'd.

When `expectedGuests > respondedGuests`:

**Default Pizza Types:**
| Type | Toppings | Dietary |
|------|----------|---------|
| Cheese | (plain) | - |
| Pepperoni | pepperoni | - |
| Mushroom | mushrooms | Vegetarian |
| Veggie | mushrooms, bell-peppers, onions | Vegetarian |
| Vegan | mushrooms, bell-peppers, onions | Vegan |
| GF Cheese | (plain) | Gluten-Free |

**Distribution:**
- ~40% Cheese
- ~40% Pepperoni
- ~10% Mushroom (vegetarian)
- ~10% Veggie (vegetarian)
- Plus 1 vegan per 10 non-respondents
- Plus 1 gluten-free per 10 non-respondents

---

## Output

The algorithm produces an array of `PizzaRecommendation`:

```typescript
{
  id: string              // "pizza-1", "pizza-2", etc.
  toppings: Topping[]     // Selected toppings (1-3)
  guestCount: number      // How many guests this serves
  guests: Guest[]         // Which specific guests
  dietaryRestrictions: string[]
  size: PizzaSize
  style: PizzaStyle
  quantity: number        // How many of this exact pizza
  isForNonRespondents?: boolean
  label?: string          // Display name
}
```

---

## Example

**Input:**
- 8 guests responded
- 4 expected non-respondents
- New York style

**Guest preferences:**
- Alice: likes pepperoni, mushrooms; vegetarian
- Bob: likes pepperoni, sausage
- Carol: likes mushrooms, olives; dislikes pepperoni
- Dan: likes pepperoni, bacon
- Eve: likes mushrooms, spinach; vegetarian
- Frank: likes pepperoni; dislikes mushrooms
- Grace: likes olives, jalapeños; vegan
- Henry: likes pepperoni, ham

**Algorithm output:**

| Pizza | Toppings | Guests | Qty | Notes |
|-------|----------|--------|-----|-------|
| 1 | mushrooms, olives | Carol | 1 | Carol alone (many conflicts) |
| 2 | mushrooms, spinach, extra-cheese | Alice, Eve | 1 | Vegetarians grouped |
| 3 | pepperoni, sausage, bacon | Bob, Dan | 1 | Meat lovers grouped |
| 4 | pepperoni, ham, extra-cheese | Frank, Henry | 1 | Compatible preferences |
| 5 | olives, jalapeños | Grace | 1 | Vegan (alone due to restrictions) |
| 6 | extra-cheese | - | 2 | Default for non-respondents |
| 7 | pepperoni, extra-cheese | - | 1 | Default for non-respondents |
| 8 | mushrooms, extra-cheese | - | 1 | Default vegetarian |

---

## Design Decisions

### Why max 3 toppings?
- Simplifies ordering at pizzerias
- Prevents flavor conflicts
- Keeps costs predictable

### Why veto rule for dislikes?
- A pizza with a disliked topping is a failed pizza for that guest
- Better to find common ground than force someone to pick off toppings

### Why greedy grouping instead of optimal?
- Optimal (e.g., ILP) is computationally expensive for large parties
- Greedy produces good-enough results in O(n²) time
- Party sizes rarely exceed 20-30 guests

### Why default pizzas for non-respondents?
- Hosts often invite more people than respond
- Safe defaults (cheese, pepperoni) satisfy most preferences
- Special dietary defaults ensure inclusivity

---

## Potential Improvements

1. **Preference strength**: Allow guests to rank toppings by preference level
2. ~~**Half-and-half pizzas**: Split toppings when two sub-groups exist~~ (Implemented - see Step 2.5)
3. **Cost optimization**: Factor in topping prices
4. **Leftover prediction**: Adjust quantities based on typical consumption patterns
5. **ML-based grouping**: Learn optimal groupings from historical order data (Groundwork laid - see ML Data Collection below)

---

## ML Data Collection (Groundwork)

Database schema includes tables for collecting training data:

**OrderItem** - Granular pizza data:
- `pizzaIndex`, `size`, `toppings[]`
- `isHalfAndHalf`, `leftToppings[]`, `rightToppings[]`

**GuestPizzaMapping** - Guest-to-pizza assignments:
- Links guests to their assigned pizzas
- `whichHalf` for half-and-half pizzas ('left', 'right', or null)
- `satisfactionRating` for optional feedback (1-5)

**Order metadata**:
- `totalPizzas`, `avgGuestsPerPizza`

This data can be used to train ML models for:
- Better guest grouping based on historical preference patterns
- Predicting optimal topping combinations
- Learning from satisfaction feedback
