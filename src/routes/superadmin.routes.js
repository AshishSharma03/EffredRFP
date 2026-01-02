import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { authenticate, isSuperAdmin } from '../middleware/auth.middleware.js';
import { PutCommand, GetCommand, QueryCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from '../config/aws.config.js';
import { v4 as uuidv4 } from 'uuid';
import { sendEmail } from '../utils/email.js';

const router = express.Router();

router.use(authenticate);
router.use(isSuperAdmin);

// ============================================
// COMPANY MANAGEMENT (ENHANCED)
// ============================================

/**
 * @route   POST /api/v1/superadmin/companies
 * @desc    Create company with limits and restrictions
 */
router.post(
  '/companies',
  asyncHandler(async (req, res) => {
    const { 
      name, email, phone, website, address, industry, planType,
      maxUsers, maxMonthlyProposals, maxMonthlySearches, maxMonthlyExports, maxStorageGB
    } = req.body;

    if (!name || !email) {
      throw new AppError('Company name and email are required', 400);
    }

    const companyId = uuidv4();

    const company = {
      id: companyId,
      name,
      email,
      phone: phone || '',
      website: website || '',
      address: address || {},
      industry: industry || '',
      logoUrl: '',
      planType: planType || 'free',
      subscriptionStatus: 'trial',
      
      // Limits (configurable by SuperAdmin)
      limits: {
        maxUsers: maxUsers || 10,
        allowAddUser: true,
        usersAdded: 0,
        allowUpdateLogo: true,
        maxMonthlyProposals: maxMonthlyProposals || 25,
        proposalsUsed: 0,
        maxMonthlySearches: maxMonthlySearches || 1000,
        searchesUsed: 0,
        maxMonthlyExports: maxMonthlyExports || 100,
        exportsUsed: 0,
        maxStorageGB: maxStorageGB || 10,
        storageUsedGB: 0,
      },
      
      // Usage tracking
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
        maxFileSize: 10,
        allowedFileTypes: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        enableAnalytics: true,
        requireApproval: false,
        enableAISearch: true,
        enableExport: true,
      },
      
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.user.id,
    };

    await docClient.send(new PutCommand({
      TableName: TABLES.COMPANIES,
      Item: company,
    }));

    res.status(201).json({
      message: 'Company created successfully',
      company,
    });
  })
);

/**
 * @route   POST /api/v1/superadmin/companies/:id/deactivate
 * @desc    Deactivate company (blocks all access)
 */
router.post(
  '/companies/:id/deactivate',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    await docClient.send(new UpdateCommand({
      TableName: TABLES.COMPANIES,
      Key: { id },
      UpdateExpression: 'SET subscriptionStatus = :status, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':status': 'deactivated',
        ':updatedAt': new Date().toISOString(),
      },
    }));

    res.json({ message: 'Company deactivated successfully' });
  })
);

/**
 * @route   POST /api/v1/superadmin/companies/:id/activate
 * @desc    Activate company
 */
router.post(
  '/companies/:id/activate',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    await docClient.send(new UpdateCommand({
      TableName: TABLES.COMPANIES,
      Key: { id },
      UpdateExpression: 'SET subscriptionStatus = :status, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':status': 'active',
        ':updatedAt': new Date().toISOString(),
      },
    }));

    res.json({ message: 'Company activated successfully' });
  })
);

/**
 * @route   PATCH /api/v1/superadmin/companies/:id/limits
 * @desc    Update company limits
 */
router.patch(
  '/companies/:id/limits',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { 
      maxUsers, allowAddUser, allowUpdateLogo, 
      maxMonthlyProposals, maxMonthlySearches, maxMonthlyExports, maxStorageGB 
    } = req.body;

    const updates = {};
    if (maxUsers !== undefined) updates['limits.maxUsers'] = maxUsers;
    if (allowAddUser !== undefined) updates['limits.allowAddUser'] = allowAddUser;
    if (allowUpdateLogo !== undefined) updates['limits.allowUpdateLogo'] = allowUpdateLogo;
    if (maxMonthlyProposals !== undefined) updates['limits.maxMonthlyProposals'] = maxMonthlyProposals;
    if (maxMonthlySearches !== undefined) updates['limits.maxMonthlySearches'] = maxMonthlySearches;
    if (maxMonthlyExports !== undefined) updates['limits.maxMonthlyExports'] = maxMonthlyExports;
    if (maxStorageGB !== undefined) updates['limits.maxStorageGB'] = maxStorageGB;

    const updateExpr = Object.keys(updates).map((k, i) => `#attr${i} = :val${i}`).join(', ');
    const attrNames = {};
    const attrValues = {};
    
    Object.keys(updates).forEach((key, i) => {
      attrNames[`#attr${i}`] = key;
      attrValues[`:val${i}`] = updates[key];
    });

    await docClient.send(new UpdateCommand({
      TableName: TABLES.COMPANIES,
      Key: { id },
      UpdateExpression: `SET ${updateExpr}, updatedAt = :updatedAt`,
      ExpressionAttributeNames: attrNames,
      ExpressionAttributeValues: { ...attrValues, ':updatedAt': new Date().toISOString() },
    }));

    res.json({ message: 'Company limits updated successfully' });
  })
);

/**
 * @route   GET /api/v1/superadmin/companies/:id/usage
 * @desc    Get detailed usage for a company
 */
router.get(
  '/companies/:id/usage',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    // Get company
    const companyResponse = await docClient.send(new GetCommand({
      TableName: TABLES.COMPANIES,
      Key: { id },
    }));

    if (!companyResponse.Item) {
      throw new AppError('Company not found', 404);
    }

    // Get usage logs (if you implement usage tracking table)
    // For now, return company usage summary
    const company = companyResponse.Item;

    res.json({
      company: {
        id: company.id,
        name: company.name,
      },
      currentUsage: {
        users: company.limits.usersAdded,
        maxUsers: company.limits.maxUsers,
        proposals: company.limits.proposalsUsed,
        maxProposals: company.limits.maxMonthlyProposals,
        searches: company.limits.searchesUsed,
        maxSearches: company.limits.maxMonthlySearches,
        exports: company.limits.exportsUsed,
        maxExports: company.limits.maxMonthlyExports,
        storage: company.limits.storageUsedGB,
        maxStorage: company.limits.maxStorageGB,
      },
      totalUsage: company.usage,
    });
  })
);

// ============================================
// COMPANY ADMIN MANAGEMENT (ENHANCED)
// ============================================

/**
 * @route   POST /api/v1/superadmin/company-admins
 * @desc    Create company admin with email, password, and login disabled
 */
router.post(
  '/company-admins',
  asyncHandler(async (req, res) => {
    const { email, password, name, companyId, department, jobTitle, phone } = req.body;

    if (!email || !password || !name || !companyId) {
      throw new AppError('Email, password, name, and companyId are required', 400);
    }

    // Verify company exists and is active
    const companyResponse = await docClient.send(new GetCommand({
      TableName: TABLES.COMPANIES,
      Key: { id: companyId },
    }));

    if (!companyResponse.Item) {
      throw new AppError('Company not found', 404);
    }

    if (companyResponse.Item.subscriptionStatus === 'deactivated') {
      throw new AppError('Cannot create admin for deactivated company', 400);
    }

    // Check if user exists
    const existingUser = await docClient.send(new GetCommand({
      TableName: TABLES.USERS,
      Key: { email },
    }));

    if (existingUser.Item) {
      throw new AppError('User already exists', 409);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    const companyAdmin = {
      id: userId,
      email,
      name,
      password: hashedPassword,
      phone: phone || '',
      role: 'company_admin',
      companyId,
      
      // Login disabled by default
      loginStatus: 'disabled',
      isActive: true,
      
      // Permissions
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
        lastLoginAt: null,
        lastPasswordResetAt: null,
      },
      
      department: department || 'Administration',
      jobTitle: jobTitle || 'Company Administrator',
      
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.user.id,
      
      resetToken: null,
      resetTokenExpiry: null,
    };

    await docClient.send(new PutCommand({
      TableName: TABLES.USERS,
      Item: companyAdmin,
    }));

    const { password: _, ...adminWithoutPassword } = companyAdmin;

    res.status(201).json({
      message: 'Company admin created successfully (login disabled by default)',
      user: adminWithoutPassword,
      note: 'Use /enable-login endpoint to allow login',
    });
  })
);

/**
 * @route   POST /api/v1/superadmin/company-admins/:id/enable-login
 * @desc    Enable login for company admin
 */
router.post(
  '/company-admins/:id/enable-login',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Find user by ID
    const usersResponse = await docClient.send(new ScanCommand({
      TableName: TABLES.USERS,
      FilterExpression: 'id = :id AND #role = :role',
      ExpressionAttributeNames: { '#role': 'role' },
      ExpressionAttributeValues: { ':id': id, ':role': 'company_admin' },
    }));

    if (!usersResponse.Items || usersResponse.Items.length === 0) {
      throw new AppError('Company admin not found', 404);
    }

    const admin = usersResponse.Items[0];

    await docClient.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { email: admin.email },
      UpdateExpression: 'SET loginStatus = :status, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':status': 'enabled',
        ':updatedAt': new Date().toISOString(),
      },
    }));

    res.json({ message: 'Login enabled for company admin' });
  })
);

/**
 * @route   POST /api/v1/superadmin/company-admins/:id/disable-login
 * @desc    Disable login for company admin
 */
router.post(
  '/company-admins/:id/disable-login',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const usersResponse = await docClient.send(new ScanCommand({
      TableName: TABLES.USERS,
      FilterExpression: 'id = :id AND #role = :role',
      ExpressionAttributeNames: { '#role': 'role' },
      ExpressionAttributeValues: { ':id': id, ':role': 'company_admin' },
    }));

    if (!usersResponse.Items || usersResponse.Items.length === 0) {
      throw new AppError('Company admin not found', 404);
    }

    const admin = usersResponse.Items[0];

    await docClient.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { email: admin.email },
      UpdateExpression: 'SET loginStatus = :status, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':status': 'disabled',
        ':updatedAt': new Date().toISOString(),
      },
    }));

    res.json({ message: 'Login disabled for company admin' });
  })
);

/**
 * @route   POST /api/v1/superadmin/company-admins/:id/reset-password
 * @desc    Send password reset email to company admin
 */
router.post(
  '/company-admins/:id/reset-password',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const usersResponse = await docClient.send(new ScanCommand({
      TableName: TABLES.USERS,
      FilterExpression: 'id = :id',
      ExpressionAttributeValues: { ':id': id },
    }));

    if (!usersResponse.Items || usersResponse.Items.length === 0) {
      throw new AppError('User not found', 404);
    }

    const user = usersResponse.Items[0];

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 3600000).toISOString(); // 1 hour

    await docClient.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { email: user.email },
      UpdateExpression: 'SET resetToken = :token, resetTokenExpiry = :expiry, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':token': resetToken,
        ':expiry': resetTokenExpiry,
        ':updatedAt': new Date().toISOString(),
      },
    }));

    // Send email (implement sendEmail utility)
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    
    // TODO: Implement email sending
    // await sendEmail({
    //   to: user.email,
    //   subject: 'Password Reset Request',
    //   html: `Click here to reset password: ${resetUrl}`,
    // });

    res.json({ 
      message: 'Password reset email sent',
      resetToken, // Remove in production
      resetUrl, // Remove in production
    });
  })
);

/**
 * @route   PATCH /api/v1/superadmin/company-admins/:id/permissions
 * @desc    Update company admin permissions
 */
router.patch(
  '/company-admins/:id/permissions',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const permissions = req.body;

    const usersResponse = await docClient.send(new ScanCommand({
      TableName: TABLES.USERS,
      FilterExpression: 'id = :id',
      ExpressionAttributeValues: { ':id': id },
    }));

    if (!usersResponse.Items || usersResponse.Items.length === 0) {
      throw new AppError('User not found', 404);
    }

    const user = usersResponse.Items[0];

    await docClient.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { email: user.email },
      UpdateExpression: 'SET permissions = :permissions, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':permissions': permissions,
        ':updatedAt': new Date().toISOString(),
      },
    }));

    res.json({ message: 'Permissions updated successfully' });
  })
);

/**
 * @route   PATCH /api/v1/superadmin/company-admins/:id/profile
 * @desc    Update company admin profile
 */
router.patch(
  '/company-admins/:id/profile',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, phone, department, jobTitle } = req.body;

    const usersResponse = await docClient.send(new ScanCommand({
      TableName: TABLES.USERS,
      FilterExpression: 'id = :id',
      ExpressionAttributeValues: { ':id': id },
    }));

    if (!usersResponse.Items || usersResponse.Items.length === 0) {
      throw new AppError('User not found', 404);
    }

    const user = usersResponse.Items[0];

    const updates = {};
    if (name) updates.name = name;
    if (phone) updates.phone = phone;
    if (department) updates.department = department;
    if (jobTitle) updates.jobTitle = jobTitle;

    const updateExpr = Object.keys(updates).map((k, i) => `#attr${i} = :val${i}`).join(', ');
    const attrNames = {};
    const attrValues = {};
    
    Object.keys(updates).forEach((key, i) => {
      attrNames[`#attr${i}`] = key;
      attrValues[`:val${i}`] = updates[key];
    });

    await docClient.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { email: user.email },
      UpdateExpression: `SET ${updateExpr}, updatedAt = :updatedAt`,
      ExpressionAttributeNames: attrNames,
      ExpressionAttributeValues: { ...attrValues, ':updatedAt': new Date().toISOString() },
    }));

    res.json({ message: 'Profile updated successfully' });
  })
);

// ============================================
// SEARCH & FILTERING
// ============================================

/**
 * @route   GET /api/v1/superadmin/search
 * @desc    Search companies and company admins
 */
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const { query, type } = req.query; // type: 'company' | 'admin' | 'all'

    if (!query) {
      throw new AppError('Search query is required', 400);
    }

    const results = {
      companies: [],
      admins: [],
    };

    // Search companies
    if (type === 'company' || type === 'all' || !type) {
      const companiesResponse = await docClient.send(new ScanCommand({
        TableName: TABLES.COMPANIES,
      }));

      results.companies = (companiesResponse.Items || []).filter(company => 
        company.name.toLowerCase().includes(query.toLowerCase()) ||
        company.email.toLowerCase().includes(query.toLowerCase()) ||
        company.id.includes(query)
      );
    }

    // Search admins
    if (type === 'admin' || type === 'all' || !type) {
      const usersResponse = await docClient.send(new ScanCommand({
        TableName: TABLES.USERS,
        FilterExpression: '#role = :role',
        ExpressionAttributeNames: { '#role': 'role' },
        ExpressionAttributeValues: { ':role': 'company_admin' },
      }));

      results.admins = (usersResponse.Items || [])
        .filter(user => 
          user.name.toLowerCase().includes(query.toLowerCase()) ||
          user.email.toLowerCase().includes(query.toLowerCase()) ||
          user.id.includes(query) ||
          (user.phone && user.phone.includes(query))
        )
        .map(({ password, ...user }) => user);
    }

    res.json({
      query,
      results,
      count: {
        companies: results.companies.length,
        admins: results.admins.length,
      },
    });
  })
);

export default router;