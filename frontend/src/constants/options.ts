/**
 * Shared constants for pizza preferences, toppings, beverages, and dietary options.
 * Used across RSVPPage, PizzaContext, and other components.
 */

import { Topping, Beverage, PizzaStyle, PizzaSize } from '../types';

// Dietary restriction options
export const DIETARY_OPTIONS = [
  'Vegetarian',
  'Vegan',
  'Gluten-Free',
  'Dairy-Free',
] as const;

// Role options for RSVP
export const ROLE_OPTIONS = [
  'Biz Dev',
  'Dev',
  'Artist',
  'Marketing',
  'Founder',
  'Student',
  'Investor',
  'Ops',
  'Designer',
] as const;

// Available pizza toppings
export const TOPPINGS: Topping[] = [
  { id: 'pepperoni', name: 'Pepperoni', type: 'meat' },
  { id: 'sausage', name: 'Sausage', type: 'meat' },
  { id: 'bacon', name: 'Bacon', type: 'meat' },
  { id: 'ham', name: 'Ham', type: 'meat' },
  { id: 'chicken', name: 'Chicken', type: 'meat' },
  { id: 'mushrooms', name: 'Mushrooms', type: 'vegetable' },
  { id: 'onions', name: 'Onions', type: 'vegetable' },
  { id: 'bell-peppers', name: 'Bell Peppers', type: 'vegetable' },
  { id: 'olives', name: 'Olives', type: 'vegetable' },
  { id: 'spinach', name: 'Spinach', type: 'vegetable' },
  { id: 'jalapenos', name: 'Jalapeños', type: 'vegetable' },
  { id: 'tomatoes', name: 'Tomatoes', type: 'vegetable' },
  { id: 'pineapple', name: 'Pineapple', type: 'fruit' },
  { id: 'extra-cheese', name: 'Extra Cheese', type: 'cheese' },
  { id: 'anchovies', name: 'Anchovies', type: 'meat' },
];

// Specific drink options for guest selection
export const DRINKS = [
  { id: 'coke', name: 'Coca-Cola', type: 'soda' },
  { id: 'diet-coke', name: 'Diet Coke', type: 'soda' },
  { id: 'sprite', name: 'Sprite', type: 'soda' },
  { id: 'fanta', name: 'Fanta', type: 'soda' },
  { id: 'pepsi', name: 'Pepsi', type: 'soda' },
  { id: 'mountain-dew', name: 'Mountain Dew', type: 'soda' },
  { id: 'dr-pepper', name: 'Dr Pepper', type: 'soda' },
  { id: 'orange-juice', name: 'Orange Juice', type: 'juice' },
  { id: 'apple-juice', name: 'Apple Juice', type: 'juice' },
  { id: 'lemonade', name: 'Lemonade', type: 'juice' },
  { id: 'iced-tea', name: 'Iced Tea', type: 'other' },
  { id: 'water', name: 'Water', type: 'water' },
  { id: 'sparkling-water', name: 'Sparkling Water', type: 'water' },
] as const;

// Drink categories for host selection
export const DRINK_CATEGORIES: Beverage[] = [
  { id: 'water', name: 'Water', type: 'water' },
  { id: 'beer', name: 'Beer', type: 'alcohol' },
  { id: 'soda', name: 'Soda', type: 'soda' },
  { id: 'wine', name: 'Wine', type: 'alcohol' },
  { id: 'cocktail', name: 'Cocktail', type: 'alcohol' },
];

// Pizza styles
export const PIZZA_STYLES: PizzaStyle[] = [
  { id: 'neapolitan', name: 'Neapolitan', description: 'Thin crust, wood-fired, authentic Italian style' },
  { id: 'new-york', name: 'New York', description: 'Large, thin crust, foldable slices' },
  { id: 'detroit', name: 'Detroit', description: 'Square, thick crust, crispy edges' },
];

// Pizza sizes with serving calculations
// Servings based on surface area: 18" feeds 4 people (2 slices each, 1/4 surface area per person)
// Formula: (diameter/2)² * π / (9² * π / 4) = (diameter/18)² * 4
export const PIZZA_SIZES: PizzaSize[] = [
  { diameter: 10, name: 'Personal', servings: 1.2 },
  { diameter: 12, name: 'Small', servings: 1.8 },
  { diameter: 14, name: 'Medium', servings: 2.4 },
  { diameter: 16, name: 'Large', servings: 3.2 },
  { diameter: 18, name: 'Extra Large', servings: 4 },
  { diameter: 20, name: 'Family', servings: 4.9 },
];
