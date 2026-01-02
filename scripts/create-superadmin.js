import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import readline from 'readline';

// Load environment variables FIRST
dotenv.config();

// Verify AWS configuration
if (!process.env.AWS_REGION) {
  console.error('❌ ERROR: AWS_REGION not found in .env file');
  console.error('   Please add AWS_REGION=ap-south-1 to your .env file');
  process.exit(1);
}

if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error('❌ ERROR: AWS credentials not found in .env file');
  console.error('   Please add AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to your .env file');
  process.exit(1);
}

// Initialize DynamoDB client
const client = new DynamoDBClient({ 
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});
const docClient = DynamoDBDocumentClient.from(client);

const USERS_TABLE = process.env.DYNAMODB_USERS_TABLE || 'auto-rfp-users';
const COMPANIES_TABLE = process.env.DYNAMODB_COMPANIES_TABLE || 'auto-rfp-companies';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query) =>
  new Promise((resolve) => rl.question(query, resolve));

async function createSuperAdmin() {
  console.log('═══════════════════════════════════════════════');
  console.log('   🔐 SuperAdmin Account Creation Script');
  console.log('═══════════════════════════════════════════════\n');

  console.log('📋 Configuration:');
  console.log('   AWS Region:', process.env.AWS_REGION);
  console.log('   Users Table:', USERS_TABLE);
  console.log('   Companies Table:', COMPANIES_TABLE);
  console.log('');

  try {
    // Get details from user
    const email = await question('Enter SuperAdmin email: ');
    const password = await question('Enter SuperAdmin password (min 8 chars): ');
    const name = await question('Enter SuperAdmin name: ');

    if (!email || !password || !name) {
      console.log('\n❌ All fields are required!');
      rl.close();
      return;
    }

    if (password.length < 8) {
      console.log('\n❌ Password must be at least 8 characters!');
      rl.close();
      return;
    }

    console.log('\n🔍 Checking if user already exists...');

    // Check if user exists
    const existingUserCommand = new GetCommand({
      TableName: USERS_TABLE,
      Key: { email },
    });

    const existingUserResponse = await docClient.send(existingUserCommand);

    if (existingUserResponse.Item) {
      console.log('⚠️  User with this email already exists!');
      console.log('   Current role:', existingUserResponse.Item.role);
      
      const update = await question('\nUpdate existing user to SuperAdmin? (yes/no): ');
      
      if (update.toLowerCase() !== 'yes') {
        console.log('\n❌ Operation cancelled.');
        rl.close();
        return;
      }

      // Update existing user
      console.log('\n🔄 Updating user to SuperAdmin...');
      
      const updateCommand = new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { email },
        UpdateExpression: 'SET #role = :role, loginStatus = :loginStatus, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#role': 'role',
        },
        ExpressionAttributeValues: {
          ':role': 'superadmin',
          ':loginStatus': 'enabled',
          ':updatedAt': new Date().toISOString(),
        },
        ReturnValues: 'ALL_NEW',
      });

      await docClient.send(updateCommand);

      console.log('\n✅ User updated to SuperAdmin successfully!');
      console.log('   Email:', email);
      console.log('   Role: superadmin');
      console.log('   Login Status: enabled');
      
    } else {
      // Create new superadmin
      console.log('🔐 Hashing password...');
      const hashedPassword = await bcrypt.hash(password, 10);

      const userId = uuidv4();
      const companyId = uuidv4();

      // Create SuperAdmin company
      console.log('🏢 Creating SuperAdmin company...');
      
      const company = {
        id: companyId,
        name: 'SuperAdmin Company',
        email: email,
        phone: '',
        website: '',
        logoUrl: '',
        planType: 'enterprise',
        subscriptionStatus: 'active',
        
        limits: {
          maxUsers: 999999,
          allowAddUser: true,
          usersAdded: 1,
          allowUpdateLogo: true,
          maxMonthlyProposals: 999999,
          proposalsUsed: 0,
          maxMonthlySearches: 999999,
          searchesUsed: 0,
          maxMonthlyExports: 999999,
          exportsUsed: 0,
          maxStorageGB: 999999,
          storageUsedGB: 0,
        },
        
        usage: {
          totalLogins: 0,
          totalSearches: 0,
          totalExports: 0,
          totalProposals: 0,
          lastLoginAt: null,
          lastResetAt: new Date().toISOString(),
        },
        
        settings: {
          allowBulkUpload: true,
          maxFileSize: 100,
          allowedFileTypes: [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
          ],
          enableAnalytics: true,
          requireApproval: false,
          enableAISearch: true,
          enableExport: true,
        },
        
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await docClient.send(new PutCommand({
        TableName: COMPANIES_TABLE,
        Item: company,
      }));

      console.log('✅ SuperAdmin company created');

      // Create SuperAdmin user
      console.log('👤 Creating SuperAdmin user...');

      const superAdmin = {
        id: userId,
        email,
        name,
        password: hashedPassword,
        phone: '',
        role: 'superadmin',
        companyId,
        
        loginStatus: 'enabled',
        isActive: true,
        
        permissions: {
          canAddUsers: true,
          canUpdateLogo: true,
          canBulkUpload: true,
          canExportData: true,
          canManageBilling: true,
          canViewAnalytics: true,
        },
        
        usage: {
          totalLogins: 0,
          totalSearches: 0,
          totalExports: 0,
          lastLoginAt: null,
          lastPasswordResetAt: null,
        },
        
        department: 'System Administration',
        jobTitle: 'System Administrator',
        
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        
        resetToken: null,
        resetTokenExpiry: null,
      };

      await docClient.send(new PutCommand({
        TableName: USERS_TABLE,
        Item: superAdmin,
      }));

      console.log('✅ SuperAdmin user created');
      console.log('\n═══════════════════════════════════════════════');
      console.log('   🎉 SuperAdmin Created Successfully!');
      console.log('═══════════════════════════════════════════════\n');
      console.log('SuperAdmin Details:');
      console.log('   Email:', email);
      console.log('   Name:', name);
      console.log('   Role: superadmin');
      console.log('   Login Status: enabled');
      console.log('   User ID:', userId);
      console.log('   Company ID:', companyId);
      console.log('\n⚠️  IMPORTANT: Save these credentials securely!\n');
      console.log('Next Steps:');
      console.log('   1. Login with these credentials');
      console.log('   2. Create companies via POST /api/v1/superadmin/companies');
      console.log('   3. Create company admins via POST /api/v1/superadmin/company-admins');
      console.log('   4. Company admins can then create users\n');
      
      console.log('📝 Test Login:');
      console.log('   curl -X POST http://localhost:3001/api/v1/auth/login \\');
      console.log('     -H "Content-Type: application/json" \\');
      console.log('     -d \'{"email":"' + email + '","password":"' + password + '"}\'\n');
    }
  } catch (error) {
    console.error('\n❌ Error creating SuperAdmin:', error.message);
    
    if (error.name === 'ResourceNotFoundException') {
      console.error('\n💡 Table not found. Please verify:');
      console.error('   1. Tables exist in AWS DynamoDB');
      console.error('   2. Table names in .env are correct');
      console.error('   3. AWS credentials have access to these tables\n');
    }
    
    console.error('\nFull error:', error);
  } finally {
    rl.close();
  }
}

createSuperAdmin();