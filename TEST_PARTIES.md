# Test Parties for Wave & Beverage Features

Created: January 13, 2025

## 🎉 Standard 3-Hour Party
**Test:** Multi-wave ordering (3-4 waves expected)

- **Duration:** 3 hours
- **Guests:** 20 expected, 8 RSVPed
- **Beverages:** Coke, Sprite, Water, Lemonade
- **Expected Waves:** 3-4 waves
  - Wave 1: ~5:55 PM (5 min before), 1.25x weight
  - Wave 2: ~50-60 min later
  - Wave 3: ~50-60 min later

**Links:**
- Host: http://localhost:5176/#/party/063e9abc
- Guest RSVP: http://localhost:5176/#/rsvp/063e9abc

---

## ⚡ Quick 1-Hour Meetup
**Test:** Single wave (short party)

- **Duration:** 1 hour
- **Guests:** 8 expected, 5 RSVPed
- **Beverages:** Water, Sparkling Water
- **Expected Waves:** 1 wave only (party too short for multiple waves)

**Links:**
- Host: http://localhost:5176/#/party/26084192
- Guest RSVP: http://localhost:5176/#/rsvp/26084192

---

## 🌟 Epic 6-Hour Party
**Test:** Many waves (6-7 waves expected)

- **Duration:** 6 hours
- **Guests:** 40 expected, 8 RSVPed
- **Beverages:** Coke, Diet Coke, Sprite, Pepsi, Mountain Dew, Orange Juice, Water
- **Expected Waves:** 6-7 waves spread throughout event
  - First wave weighted 1.25x heavier
  - Last wave no closer than 45 min to end

**Links:**
- Host: http://localhost:5176/#/party/82efa78f
- Guest RSVP: http://localhost:5176/#/rsvp/82efa78f

---

## 🍕 Classic Party (No Duration)
**Test:** Backward compatibility (single wave display)

- **Duration:** None
- **Guests:** 15 expected, 8 RSVPed
- **Beverages:** Coke, Sprite, Water
- **Expected:** Shows traditional single-wave display (no wave timing)

**Links:**
- Host: http://localhost:5176/#/party/3047142c
- Guest RSVP: http://localhost:5176/#/rsvp/3047142c

---

## 🎊 Medium 4.5-Hour Event
**Test:** Mid-length party (4-5 waves expected)

- **Duration:** 4.5 hours
- **Guests:** 25 expected, 8 RSVPed
- **Beverages:** Coke, Diet Coke, Fanta, Lemonade, Iced Tea, Water
- **Expected Waves:** 4-5 waves

**Links:**
- Host: http://localhost:5176/#/party/42f6282d
- Guest RSVP: http://localhost:5176/#/rsvp/42f6282d

---

## Sample Guests Added

Each party has sample guests with diverse preferences:

1. **Alice** - Loves pepperoni & mushrooms, hates pineapple, drinks Coke
2. **Bob** - Vegetarian, likes veggies, drinks Sprite & Water
3. **Carol** - Meat lover, drinks Coke & Lemonade
4. **David** - Vegan, likes mushrooms & spinach, drinks Water & OJ
5. **Eve** - Likes pepperoni & jalapeños, drinks Pepsi
6. **Frank** - Gluten-Free, likes chicken & peppers, drinks Sprite & Iced Tea
7. **Grace** - Likes Hawaiian (ham & pineapple), drinks Fanta & Lemonade
8. **Henry** - Vegetarian, likes olives & feta, drinks Sparkling Water

---

## Testing Checklist

### Wave Ordering
- [ ] 3-hour party shows 3-4 waves with proper timing
- [ ] 1-hour party shows single wave only
- [ ] 6-hour party shows 6-7 waves
- [ ] First wave arrives 5 min before party start
- [ ] First wave has ~25% more pizzas than other waves
- [ ] Last wave is at least 45 min before party end
- [ ] Waves are spaced 45-60 minutes apart
- [ ] Wave times display correctly (e.g., "5:55 PM")

### Beverage Ordering
- [ ] Beverage recommendations show in each wave
- [ ] Guest preferences affect beverage quantities
- [ ] Copy wave includes beverages
- [ ] Call script includes beverages

### UI Display
- [ ] Multi-wave stacked sections look good
- [ ] Clock icon shows for each wave
- [ ] Guest allocation displays correctly
- [ ] Pizza cards render in each wave section
- [ ] Copy individual wave works
- [ ] Copy all waves works
- [ ] Call script generates properly for multi-wave

### Backward Compatibility
- [ ] Party without duration shows single wave display
- [ ] No errors or broken UI
- [ ] Traditional copy/call script works

---

## Quick Test Commands

**View all parties:**
```bash
# In Supabase SQL Editor
SELECT name, invite_code, duration, max_guests
FROM parties
ORDER BY created_at DESC
LIMIT 5;
```

**Check wave calculations:**
```bash
# Visit host links above and click "Generate Recommendations"
# Should see wave breakdown with timing
```
