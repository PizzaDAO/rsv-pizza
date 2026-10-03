#!/usr/bin/env node
/** DESTRUCTIVE: drop the dead *_backup_mushroom_48468 + photos_created_at_clobber_backup
 *  tables. DRY RUN default; --apply to execute. Verifies they're gone. */
require('dotenv').config();
const fs=require('fs'), path=require('path');
const { PrismaClient } = require('@prisma/client');
const APPLY=process.argv.includes('--apply');
const prisma=new PrismaClient();
const TABLES=['AIPhoneCall_userId_backup_mushroom_48468','MagicLink_userId_backup_mushroom_48468','User_backup_mushroom_48468','api_keys_user_id_backup_mushroom_48468','parties_user_id_backup_mushroom_48468','payouts_host_user_id_backup_mushroom_48468','photos_created_at_clobber_backup'];
const stmts=fs.readFileSync(path.join(__dirname,'../prisma/migrations/20261003_drop_dead_backup_tables/migration.sql'),'utf8').split('\n').filter(l=>!l.trim().startsWith('--')).join('\n').split(';').map(s=>s.trim()).filter(Boolean);
(async()=>{console.log(`\n=== drop dead backups (${APPLY?'APPLY':'DRY RUN'}) ===`);
 if(!APPLY){console.log('Would drop:',TABLES.join(', '));return;}
 await prisma.$transaction(async tx=>{for(const s of stmts){await tx.$executeRawUnsafe(s);console.log('OK  ',s);}});
 const left=await prisma.$queryRawUnsafe(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])`,TABLES);
 console.log(`\nremaining of ${TABLES.length} targets: ${left[0].n}`);
 if(left[0].n!==0)process.exit(1);
 console.log('✓ all dropped');
})().catch(e=>{console.error('FAILED:',e.message);process.exit(1)}).finally(()=>prisma.$disconnect());
