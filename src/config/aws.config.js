import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import dotenv from 'dotenv';

// CRITICAL: Load .env file FIRST before reading any process.env
dotenv.config();

// Log configuration for debugging
console.log('🔧 AWS Configuration Loaded:');
console.log('   Region:', process.env.AWS_REGION);
console.log('   Users Table:', process.env.DYNAMODB_USERS_TABLE);
console.log('   Companies Table:', process.env.DYNAMODB_COMPANIES_TABLE);

const awsConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
};

// S3 Client
export const s3Client = new S3Client(awsConfig);

// DynamoDB Client
const dynamoDBClient = new DynamoDBClient(awsConfig);
export const docClient = DynamoDBDocumentClient.from(dynamoDBClient);

// SQS Client
export const sqsClient = new SQSClient(awsConfig);

// Bedrock Client
export const bedrockClient = new BedrockRuntimeClient({
  region: process.env.BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1',
  credentials: awsConfig.credentials,
});

// OpenSearch Client
export const openSearchClient = new OpenSearchClient({
  node: process.env.OPENSEARCH_ENDPOINT || 'http://localhost:9200',
});

// Table names - CRITICAL: These must match your actual table names in AWS
export const TABLES = {
  PROPOSALS: process.env.DYNAMODB_PROPOSALS_TABLE || 'auto-rfp-proposals',
  USERS: process.env.DYNAMODB_USERS_TABLE || 'auto-rfp-users',
  KNOWLEDGE: process.env.DYNAMODB_KNOWLEDGE_TABLE || 'auto-rfp-knowledge',
  COMPANIES: process.env.DYNAMODB_COMPANIES_TABLE || 'auto-rfp-companies',
  INVOICES: process.env.DYNAMODB_INVOICES_TABLE || 'auto-rfp-invoices',
  USAGE_RECORDS: process.env.DYNAMODB_USAGE_RECORDS_TABLE || 'auto-rfp-usage-records',
  PAYMENT_METHODS: process.env.DYNAMODB_PAYMENT_METHODS_TABLE || 'auto-rfp-payment-methods',
};

// Log table configuration
console.log('📊 DynamoDB Tables:');
Object.entries(TABLES).forEach(([key, value]) => {
  console.log(`   ${key}: ${value}`);
});

// S3 Bucket names
export const BUCKETS = {
  DOCUMENTS: process.env.S3_BUCKET_NAME || 'auto-rfp-documents',
  KNOWLEDGE_BASE: process.env.S3_KNOWLEDGE_BASE_BUCKET || 'auto-rfp-knowledge-base',
};

// SQS Queue URLs
export const QUEUES = {
  PROCESSING: process.env.SQS_PROCESSING_QUEUE_URL || '',
};