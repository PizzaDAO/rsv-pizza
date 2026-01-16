-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create User table
CREATE TABLE IF NOT EXISTS "User" (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    "defaultDietaryRestrictions" TEXT[] DEFAULT '{}',
    "defaultLikedToppings" TEXT[] DEFAULT '{}',
    "defaultDislikedToppings" TEXT[] DEFAULT '{}',
    "defaultLikedBeverages" TEXT[] DEFAULT '{}',
    "defaultDislikedBeverages" TEXT[] DEFAULT '{}',
    "defaultAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create Party table
CREATE TABLE IF NOT EXISTS "Party" (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    name TEXT NOT NULL,
    "inviteCode" TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::TEXT,
    "customUrl" TEXT UNIQUE,
    date TIMESTAMP(3),
    duration DOUBLE PRECISION,
    timezone TEXT,
    "pizzaSize" TEXT NOT NULL,
    "pizzaStyle" TEXT NOT NULL,
    "availableBeverages" TEXT[] DEFAULT '{}',
    address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    "maxGuests" INTEGER,
    password TEXT,
    "eventImageUrl" TEXT,
    description TEXT,
    "rsvpClosedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE
);

-- Create Guest table
CREATE TABLE IF NOT EXISTS "Guest" (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    name TEXT NOT NULL,
    email TEXT,
    "ethereumAddress" TEXT,
    roles TEXT[] DEFAULT '{}',
    "mailingListOptIn" BOOLEAN NOT NULL DEFAULT false,
    "dietaryRestrictions" TEXT[] DEFAULT '{}',
    "likedToppings" TEXT[] DEFAULT '{}',
    "dislikedToppings" TEXT[] DEFAULT '{}',
    "likedBeverages" TEXT[] DEFAULT '{}',
    "dislikedBeverages" TEXT[] DEFAULT '{}',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedVia" TEXT NOT NULL DEFAULT 'link',
    "partyId" TEXT NOT NULL,
    FOREIGN KEY ("partyId") REFERENCES "Party"(id) ON DELETE CASCADE
);

-- Create Order table
CREATE TABLE IF NOT EXISTS "Order" (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    provider TEXT NOT NULL,
    "externalOrderId" TEXT,
    pizzas JSONB NOT NULL,
    "totalAmount" DECIMAL(10, 2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    "pizzeriaName" TEXT NOT NULL,
    "pizzeriaAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalPizzas" INTEGER,
    "avgGuestsPerPizza" DOUBLE PRECISION,
    "partyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    FOREIGN KEY ("partyId") REFERENCES "Party"(id),
    FOREIGN KEY ("userId") REFERENCES "User"(id)
);

-- Create OrderItem table
CREATE TABLE IF NOT EXISTS "OrderItem" (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    "orderId" TEXT NOT NULL,
    "pizzaIndex" INTEGER NOT NULL,
    size TEXT NOT NULL,
    toppings TEXT[] DEFAULT '{}',
    "isHalfAndHalf" BOOLEAN NOT NULL DEFAULT false,
    "leftToppings" TEXT[] DEFAULT '{}',
    "rightToppings" TEXT[] DEFAULT '{}',
    "priceEstimate" DECIMAL(10, 2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("orderId") REFERENCES "Order"(id) ON DELETE CASCADE
);

-- Create GuestPizzaMapping table
CREATE TABLE IF NOT EXISTS "GuestPizzaMapping" (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    "guestId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "whichHalf" TEXT,
    "satisfactionRating" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("guestId") REFERENCES "Guest"(id) ON DELETE CASCADE,
    FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"(id) ON DELETE CASCADE,
    FOREIGN KEY ("orderId") REFERENCES "Order"(id) ON DELETE CASCADE,
    UNIQUE ("guestId", "orderItemId")
);

-- Create MagicLink table
CREATE TABLE IF NOT EXISTS "MagicLink" (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    token TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    used BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS "Party_userId_idx" ON "Party"("userId");
CREATE INDEX IF NOT EXISTS "Party_inviteCode_idx" ON "Party"("inviteCode");
CREATE INDEX IF NOT EXISTS "Guest_partyId_idx" ON "Guest"("partyId");
CREATE INDEX IF NOT EXISTS "Order_partyId_idx" ON "Order"("partyId");
CREATE INDEX IF NOT EXISTS "Order_userId_idx" ON "Order"("userId");
CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX IF NOT EXISTS "GuestPizzaMapping_guestId_idx" ON "GuestPizzaMapping"("guestId");
CREATE INDEX IF NOT EXISTS "GuestPizzaMapping_orderItemId_idx" ON "GuestPizzaMapping"("orderItemId");
CREATE INDEX IF NOT EXISTS "MagicLink_token_idx" ON "MagicLink"(token);
CREATE INDEX IF NOT EXISTS "MagicLink_email_idx" ON "MagicLink"(email);
