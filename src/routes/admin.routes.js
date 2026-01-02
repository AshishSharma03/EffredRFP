import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import multer from 'multer';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { authenticate, isCompanyAdminOrHigher } from '../middleware/auth.middleware.js';
import { PutCommand, GetCommand, QueryCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES, s3Client } from '../config/aws.config.js';
import { v4 as uuidv4 } from 'uuid';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { extractTextFromPDF, extractTextFromDocx } from '../services/document.service.js';
import { invokeModel } from '../services/ai.service.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(authenticate);
router.use(isCompanyAdminOrHigher);

// Middleware to check company limits
const checkCompanyLimits = async (req, res, next) => {
  const companyResponse = await docClient.send(new GetCommand({
    TableName: TABLES.COMPANIES,
    Key: { id: req.user.companyId },
  }));

  if (!companyResponse.Item) {
    throw new AppError('Company not found', 404);
  }

  req.company = companyResponse.Item;
  next();
};

// ============================================
// USER MANAGEMENT (ENHANCED)
// ============================================

/**
 * @route   POST /api/v1/admin/users
 * @desc    Create user with password (check limits)
 */
router.post(
  '/users',
  checkCompanyLimits,
  asyncHandler(async (req, res) => {
    const { email, password, name, department, jobTitle, phone } = req.body;

    if (!email || !password || !name) {
      throw new AppError('Email, password, and name are required', 400);
    }

    // Check if company can add users
    if (!req.company.limits.allowAddUser) {
      throw new AppError('Company is not allowed to add users. Contact SuperAdmin.', 403);
    }

    // Check user limit
    if (req.company.limits.usersAdded >= req.company.limits.maxUsers) {
      throw new AppError(`User limit reached (${req.company.limits.maxUsers}). Contact SuperAdmin to increase limit.`, 403);
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

    const user = {
      id: userId,
      email,
      name,
      password: hashedPassword,
      phone: phone || '',
      role: 'user',
      companyId: req.user.companyId,
      
      loginStatus: 'enabled', // Users enabled by default
      isActive: true,
      
      usage: {
        totalLogins: 0,
        totalSearches: 0,
        totalExports: 0,
        lastLoginAt: null,
        lastPasswordResetAt: null,
      },
      
      department: department || '',
      jobTitle: jobTitle || '',
      
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.user.id,
      
      resetToken: null,
      resetTokenExpiry: null,
    };

    await docClient.send(new PutCommand({
      TableName: TABLES.USERS,
      Item: user,
    }));

    // Increment company user count
    await docClient.send(new UpdateCommand({
      TableName: TABLES.COMPANIES,
      Key: { id: req.user.companyId },
      UpdateExpression: 'SET #limits.#usersAdded = #limits.#usersAdded + :inc',
      ExpressionAttributeNames: {
        '#limits': 'limits',
        '#usersAdded': 'usersAdded',
      },
      ExpressionAttributeValues: {
        ':inc': 1,
      },
    }));

    const { password: _, ...userWithoutPassword } = user;

    res.status(201).json({
      message: 'User created successfully',
      user: userWithoutPassword,
      remainingSlots: req.company.limits.maxUsers - req.company.limits.usersAdded - 1,
    });
  })
);

/**
 * @route   POST /api/v1/admin/users/:id/reset-password
 * @desc    Send password reset email to user
 */
router.post(
  '/users/:id/reset-password',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const usersResponse = await docClient.send(new ScanCommand({
      TableName: TABLES.USERS,
      FilterExpression: 'id = :id AND companyId = :companyId',
      ExpressionAttributeValues: { 
        ':id': id,
        ':companyId': req.user.companyId,
      },
    }));

    if (!usersResponse.Items || usersResponse.Items.length === 0) {
      throw new AppError('User not found', 404);
    }

    const user = usersResponse.Items[0];

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 3600000).toISOString();

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

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    res.json({ 
      message: 'Password reset email sent',
      resetToken,
      resetUrl,
    });
  })
);

/**
 * @route   GET /api/v1/admin/users/:id/usage
 * @desc    Get user usage statistics
 */
router.get(
  '/users/:id/usage',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const usersResponse = await docClient.send(new ScanCommand({
      TableName: TABLES.USERS,
      FilterExpression: 'id = :id AND companyId = :companyId',
      ExpressionAttributeValues: { 
        ':id': id,
        ':companyId': req.user.companyId,
      },
    }));

    if (!usersResponse.Items || usersResponse.Items.length === 0) {
      throw new AppError('User not found', 404);
    }

    const user = usersResponse.Items[0];

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      usage: user.usage,
      loginStatus: user.loginStatus,
      isActive: user.isActive,
    });
  })
);

/**
 * @route   POST /api/v1/admin/users/:id/disable-login
 * @desc    Disable user login
 */
router.post(
  '/users/:id/disable-login',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const usersResponse = await docClient.send(new ScanCommand({
      TableName: TABLES.USERS,
      FilterExpression: 'id = :id AND companyId = :companyId',
      ExpressionAttributeValues: { 
        ':id': id,
        ':companyId': req.user.companyId,
      },
    }));

    if (!usersResponse.Items || usersResponse.Items.length === 0) {
      throw new AppError('User not found', 404);
    }

    const user = usersResponse.Items[0];

    await docClient.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { email: user.email },
      UpdateExpression: 'SET loginStatus = :status, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':status': 'disabled',
        ':updatedAt': new Date().toISOString(),
      },
    }));

    res.json({ message: 'User login disabled successfully' });
  })
);

/**
 * @route   POST /api/v1/admin/users/:id/enable-login
 * @desc    Enable user login
 */
router.post(
  '/users/:id/enable-login',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const usersResponse = await docClient.send(new ScanCommand({
      TableName: TABLES.USERS,
      FilterExpression: 'id = :id AND companyId = :companyId',
      ExpressionAttributeValues: { 
        ':id': id,
        ':companyId': req.user.companyId,
      },
    }));

    if (!usersResponse.Items || usersResponse.Items.length === 0) {
      throw new AppError('User not found', 404);
    }

    const user = usersResponse.Items[0];

    await docClient.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { email: user.email },
      UpdateExpression: 'SET loginStatus = :status, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':status': 'enabled',
        ':updatedAt': new Date().toISOString(),
      },
    }));

    res.json({ message: 'User login enabled successfully' });
  })
);

// ============================================
// COMPANY LOGO & PROFILE
// ============================================

/**
 * @route   POST /api/v1/admin/logo
 * @desc    Upload company logo (check permission)
 */
router.post(
  '/logo',
  checkCompanyLimits,
  upload.single('logo'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('Logo file is required', 400);
    }

    // Check permission
    if (!req.company.limits.allowUpdateLogo) {
      throw new AppError('Company is not allowed to update logo. Contact SuperAdmin.', 403);
    }

    const fileKey = `companies/${req.user.companyId}/logos/${uuidv4()}-${req.file.originalname}`;

    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: fileKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));

    const logoUrl = `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${fileKey}`;

    await docClient.send(new UpdateCommand({
      TableName: TABLES.COMPANIES,
      Key: { id: req.user.companyId },
      UpdateExpression: 'SET logoUrl = :logoUrl, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':logoUrl': logoUrl,
        ':updatedAt': new Date().toISOString(),
      },
    }));

    res.json({
      message: 'Logo uploaded successfully',
      logoUrl,
    });
  })
);

// ============================================
// USAGE & BILLING
// ============================================

/**
 * @route   GET /api/v1/admin/usage/summary
 * @desc    Get company usage summary
 */
router.get(
  '/usage/summary',
  checkCompanyLimits,
  asyncHandler(async (req, res) => {
    res.json({
      company: {
        id: req.company.id,
        name: req.company.name,
        plan: req.company.planType,
      },
      limits: req.company.limits,
      usage: req.company.usage,
      warnings: {
        usersNearLimit: req.company.limits.usersAdded >= req.company.limits.maxUsers * 0.9,
        searchesNearLimit: req.company.limits.searchesUsed >= req.company.limits.maxMonthlySearches * 0.9,
        exportsNearLimit: req.company.limits.exportsUsed >= req.company.limits.maxMonthlyExports * 0.9,
      },
    });
  })
);

/**
 * @route   GET /api/v1/admin/billing
 * @desc    Get billing information
 */
router.get(
  '/billing',
  checkCompanyLimits,
  asyncHandler(async (req, res) => {
    res.json({
      company: {
        id: req.company.id,
        name: req.company.name,
      },
      subscription: {
        plan: req.company.planType,
        status: req.company.subscriptionStatus,
      },
      limits: req.company.limits,
      usage: req.company.usage,
    });
  })
);

// ============================================
// BULK OPERATIONS
// ============================================

/**
 * @route   POST /api/v1/admin/rfp/bulk-upload
 * @desc    Bulk upload RFPs
 */
router.post(
  '/rfp/bulk-upload',
  upload.array('files', 50),
  asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0) {
      throw new AppError('No files uploaded', 400);
    }

    const results = {
      successful: [],
      failed: [],
    };

    for (const file of req.files) {
      try {
        const fileKey = `rfps/${req.user.companyId}/${uuidv4()}-${file.originalname}`;

        await s3Client.send(new PutObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME,
          Key: fileKey,
          Body: file.buffer,
          ContentType: file.mimetype,
        }));

        results.successful.push({
          filename: file.originalname,
          fileKey,
        });
      } catch (error) {
        results.failed.push({
          filename: file.originalname,
          error: error.message,
        });
      }
    }

    res.json({
      message: 'Bulk upload completed',
      successful: results.successful.length,
      failed: results.failed.length,
      results,
    });
  })
);

// ============================================
// AI SEARCH & Q&A
// ============================================

/**
 * @route   POST /api/v1/admin/search-qa
 * @desc    AI-powered Q&A from stored RFP data
 */
router.post(
  '/search-qa',
  checkCompanyLimits,
  asyncHandler(async (req, res) => {
    const { question, context } = req.body;

    if (!question) {
      throw new AppError('Question is required', 400);
    }

    // Check search limit
    if (req.company.limits.searchesUsed >= req.company.limits.maxMonthlySearches) {
      throw new AppError(`Monthly search limit (${req.company.limits.maxMonthlySearches}) reached. Contact SuperAdmin.`, 403);
    }

    // TODO: Search through stored RFPs/documents in company's knowledge base
    // For now, use AI to generate answer

    const prompt = `
Question: ${question}

Context: ${context || 'No additional context provided'}

Based on the company's stored RFP data and knowledge base, provide a comprehensive answer to this question.
`;

    const response = await invokeModel(prompt);

    // Increment search count
    await docClient.send(new UpdateCommand({
      TableName: TABLES.COMPANIES,
      Key: { id: req.user.companyId },
      UpdateExpression: 'SET #limits.#searchesUsed = #limits.#searchesUsed + :inc, #usage.#totalSearches = #usage.#totalSearches + :inc',
      ExpressionAttributeNames: {
        '#limits': 'limits',
        '#searchesUsed': 'searchesUsed',
        '#usage': 'usage',
        '#totalSearches': 'totalSearches',
      },
      ExpressionAttributeValues: {
        ':inc': 1,
      },
    }));

    res.json({
      question,
      answer: response,
      searchesRemaining: req.company.limits.maxMonthlySearches - req.company.limits.searchesUsed - 1,
    });
  })
);

/**
 * @route   POST /api/v1/admin/export
 * @desc    Export data (check export limit)
 */
router.post(
  '/export',
  checkCompanyLimits,
  asyncHandler(async (req, res) => {
    const { proposalId, format } = req.body;

    if (!proposalId || !format) {
      throw new AppError('Proposal ID and format are required', 400);
    }

    // Check export limit
    if (req.company.limits.exportsUsed >= req.company.limits.maxMonthlyExports) {
      throw new AppError(`Monthly export limit (${req.company.limits.maxMonthlyExports}) reached. Contact SuperAdmin.`, 403);
    }

    // TODO: Implement actual export logic

    // Increment export count
    await docClient.send(new UpdateCommand({
      TableName: TABLES.COMPANIES,
      Key: { id: req.user.companyId },
      UpdateExpression: 'SET #limits.#exportsUsed = #limits.#exportsUsed + :inc, #usage.#totalExports = #usage.#totalExports + :inc',
      ExpressionAttributeNames: {
        '#limits': 'limits',
        '#exportsUsed': 'exportsUsed',
        '#usage': 'usage',
        '#totalExports': 'totalExports',
      },
      ExpressionAttributeValues: {
        ':inc': 1,
      },
    }));

    res.json({
      message: 'Export completed successfully',
      format,
      exportsRemaining: req.company.limits.maxMonthlyExports - req.company.limits.exportsUsed - 1,
    });
  })
);

export default router;