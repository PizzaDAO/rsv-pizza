import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function linkEventToUser(eventIdentifier: string, userEmail: string) {
  // Find the user
  const user = await prisma.user.findUnique({
    where: { email: userEmail },
  });

  if (!user) {
    console.error(`User with email ${userEmail} not found`);
    return;
  }

  console.log(`Found user: ${user.id} (${user.email})`);

  // Find the party by invite code or custom URL
  const party = await prisma.party.findFirst({
    where: {
      OR: [
        { inviteCode: eventIdentifier },
        { customUrl: eventIdentifier },
      ],
    },
  });

  if (!party) {
    console.error(`Party with identifier ${eventIdentifier} not found`);
    return;
  }

  console.log(`Found party: ${party.id} (${party.name})`);
  console.log(`Current userId: ${party.userId}`);

  // Update the party to link to the user
  const updated = await prisma.party.update({
    where: { id: party.id },
    data: { userId: user.id },
  });

  console.log(`Updated party ${updated.name} to be owned by ${user.email}`);
}

// Run with: npx ts-node scripts/link-event-to-user.ts
const eventIdentifier = process.argv[2] || 'pizza-node';
const userEmail = process.argv[3] || 'hello@rarepizzas.com';

linkEventToUser(eventIdentifier, userEmail)
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
