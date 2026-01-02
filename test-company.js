import dotenv from 'dotenv';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const COMPANIES_TABLE = process.env.DYNAMODB_COMPANIES_TABLE || 'auto-rfp-companies';

async function test() {
  console.log('Testing table:', COMPANIES_TABLE);
  
  const company = {
    id: uuidv4(),
    name: 'Test Company',
    email: 'test@test.com',
    createdAt: new Date().toISOString(),
  };
  
  try {
    await docClient.send(
      new PutCommand({
        TableName: COMPANIES_TABLE,
        Item: company,
      })
    );
    console.log('✅ SUCCESS! Company created:', company.id);
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    console.error('Full error:', error);
  }
}

test();