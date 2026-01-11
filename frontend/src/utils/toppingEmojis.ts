// Emoji mappings for pizza toppings
export const toppingEmojis: Record<string, string> = {
  // Meats
  'pepperoni': '🔴',
  'sausage': '🌭',
  'bacon': '🥓',
  'ham': '🍖',
  'chicken': '🍗',
  'beef': '🥩',
  'meatball': '🧆',
  'salami': '🔴',
  'prosciutto': '🥓',
  'anchovies': '🐟',
  // Vegetables
  'mushrooms': '🍄',
  'onions': '🧅',
  'peppers': '🫑',
  'bell peppers': '🫑',
  'green peppers': '🫑',
  'olives': '🫒',
  'black olives': '🫒',
  'tomatoes': '🍅',
  'spinach': '🥬',
  'basil': '🌿',
  'garlic': '🧄',
  'jalapeños': '🌶️',
  'jalapenos': '🌶️',
  'hot peppers': '🌶️',
  'artichokes': '🥬',
  'broccoli': '🥦',
  'corn': '🌽',
  'arugula': '🥬',
  'zucchini': '🥒',
  'eggplant': '🍆',
  'sun-dried tomatoes': '🍅',
  // Cheese
  'extra cheese': '🧀',
  'mozzarella': '🧀',
  'parmesan': '🧀',
  'feta': '🧀',
  'feta cheese': '🧀',
  'ricotta': '🧀',
  'goat cheese': '🧀',
  'gorgonzola': '🧀',
  'cheddar': '🧀',
  // Fruits
  'pineapple': '🍍',
  'banana peppers': '🌶️',
  // Other
  'bbq sauce': '🍯',
  'ranch': '🥛',
  'buffalo': '🔥',
  'truffle': '🟤',
  'egg': '🥚',
};

// Get emoji for a topping (case-insensitive)
export const getToppingEmoji = (toppingName: string): string => {
  const lower = toppingName.toLowerCase();
  return toppingEmojis[lower] || '•';
};
