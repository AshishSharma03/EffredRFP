import dotenv from 'dotenv';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

dotenv.config();

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const docClient = DynamoDBDocumentClient.from(client);

const tableName = process.env.DYNAMODB_USERS_TABLE || 'auto-rfp-users';

console.log('Testing table:', tableName);
console.log('Region:', process.env.AWS_REGION);

async function test() {
  try {
    const response = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { email: 'test@test.com' },
      })
    );
    console.log('✅ SUCCESS! Table exists and is accessible.');
    console.log('Response:', response);
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    console.error('Table name tried:', tableName);
    console.error('Full error:', error);
  }
}

test();



