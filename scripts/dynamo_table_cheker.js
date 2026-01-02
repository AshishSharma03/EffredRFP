import { DynamoDBClient, ListTablesCommand, CreateTableCommand } from '@aws-sdk/client-dynamodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const REQUIRED_TABLES = [
  {
    name: process.env.DYNAMODB_USERS_TABLE || 'auto-rfp-users',
    keySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
    attributeDefinitions: [
      { AttributeName: 'email', AttributeType: 'S' },
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'companyId', AttributeType: 'S' },
    ],
    globalSecondaryIndexes: [
      {
        IndexName: 'UserIdIndex',
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'CompanyIdIndex',
        KeySchema: [{ AttributeName: 'companyId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    name: process.env.DYNAMODB_PROPOSALS_TABLE || 'auto-rfp-proposals',
    keySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    attributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' },
    ],
    globalSecondaryIndexes: [
      {
        IndexName: 'UserIdIndex',
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    name: process.env.DYNAMODB_KNOWLEDGE_TABLE || 'auto-rfp-knowledge',
    keySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    attributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'companyId', AttributeType: 'S' },
    ],
    globalSecondaryIndexes: [
      {
        IndexName: 'CompanyIdIndex',
        KeySchema: [{ AttributeName: 'companyId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    name: process.env.DYNAMODB_COMPANIES_TABLE || 'auto-rfp-companies',
    keySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    attributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    globalSecondaryIndexes: [],
  },
  {
    name: process.env.DYNAMODB_INVOICES_TABLE || 'auto-rfp-invoices',
    keySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    attributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'companyId', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' },
    ],
    globalSecondaryIndexes: [
      {
        IndexName: 'CompanyIdIndex',
        KeySchema: [
          { AttributeName: 'companyId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    name: process.env.DYNAMODB_USAGE_RECORDS_TABLE || 'auto-rfp-usage-records',
    keySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    attributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'companyId', AttributeType: 'S' },
      { AttributeName: 'month', AttributeType: 'S' },
    ],
    globalSecondaryIndexes: [
      {
        IndexName: 'CompanyMonthIndex',
        KeySchema: [
          { AttributeName: 'companyId', KeyType: 'HASH' },
          { AttributeName: 'month', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    name: process.env.DYNAMODB_PAYMENT_METHODS_TABLE || 'auto-rfp-payment-methods',
    keySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    attributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'companyId', AttributeType: 'S' },
    ],
    globalSecondaryIndexes: [
      {
        IndexName: 'CompanyIdIndex',
        KeySchema: [{ AttributeName: 'companyId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
];

async function checkTables() {
  try {
    console.log('🔍 Checking DynamoDB tables...\n');

    const command = new ListTablesCommand({});
    const response = await client.send(command);
    const existingTables = response.TableNames || [];

    console.log('📋 Existing tables in AWS:');
    if (existingTables.length === 0) {
      console.log('   ❌ No tables found\n');
    } else {
      existingTables.forEach((table) => {
        console.log(`   ✅ ${table}`);
      });
      console.log('');
    }

    console.log('📋 Required tables for Auto RFP:');
    const missingTables = [];

    REQUIRED_TABLES.forEach((table) => {
      const exists = existingTables.includes(table.name);
      if (exists) {
        console.log(`   ✅ ${table.name}`);
      } else {
        console.log(`   ❌ ${table.name} (MISSING)`);
        missingTables.push(table);
      }
    });

    console.log('\n' + '='.repeat(60) + '\n');

    if (missingTables.length === 0) {
      console.log('✅ All required tables exist!');
      console.log('   You can start using the application.\n');
    } else {
      console.log(`❌ Missing ${missingTables.length} tables\n`);
      console.log('📝 Options:\n');
      console.log('   1. Ask your cloud engineer to create these tables');
      console.log('   2. Run: node scripts/create-tables.js (to create them yourself)');
      console.log('   3. Use AWS Console to create tables manually\n');
      
      console.log('📋 Missing tables:');
      missingTables.forEach((table) => {
        console.log(`   - ${table.name}`);
      });
    }

    return missingTables;
  } catch (error) {
    console.error('❌ Error checking tables:', error.message);
    if (error.name === 'UnrecognizedClientException') {
      console.log('\n⚠️  Invalid AWS credentials. Check your .env file:');
      console.log('   - AWS_ACCESS_KEY_ID');
      console.log('   - AWS_SECRET_ACCESS_KEY');
      console.log('   - AWS_REGION\n');
    }
    throw error;
  }
}

async function createTable(tableConfig) {
  try {
    console.log(`\n📝 Creating table: ${tableConfig.name}...`);

    const params = {
      TableName: tableConfig.name,
      KeySchema: tableConfig.keySchema,
      AttributeDefinitions: tableConfig.attributeDefinitions,
      BillingMode: 'PAY_PER_REQUEST',
    };

    if (tableConfig.globalSecondaryIndexes.length > 0) {
      params.GlobalSecondaryIndexes = tableConfig.globalSecondaryIndexes;
    }

    const command = new CreateTableCommand(params);
    await client.send(command);

    console.log(`   ✅ Table ${tableConfig.name} created successfully!`);
    return true;
  } catch (error) {
    console.error(`   ❌ Error creating table ${tableConfig.name}:`, error.message);
    return false;
  }
}

async function createAllMissingTables(missingTables) {
  console.log('\n🚀 Creating missing tables...\n');

  let successCount = 0;
  let failCount = 0;

  for (const table of missingTables) {
    const success = await createTable(table);
    if (success) {
      successCount++;
      // Wait a bit between table creations
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } else {
      failCount++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`\n✅ Created: ${successCount} tables`);
  if (failCount > 0) {
    console.log(`❌ Failed: ${failCount} tables`);
  }
  console.log('\n⏳ Tables are being created. This may take 1-2 minutes.');
  console.log('   Wait a moment, then restart your application.\n');
}

// Main execution
const args = process.argv.slice(2);
const shouldCreate = args.includes('--create') || args.includes('-c');

checkTables()
  .then(async (missingTables) => {
    if (shouldCreate && missingTables.length > 0) {
      await createAllMissingTables(missingTables);
    } else if (missingTables.length > 0 && !shouldCreate) {
      console.log('\n💡 To automatically create missing tables, run:');
      console.log('   node scripts/check-tables.js --create\n');
    }
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });