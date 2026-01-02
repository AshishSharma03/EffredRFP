import express from 'express';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { GetCommand, UpdateCommand, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES, s3Client } from '../config/aws.config.js';
import { v4 as uuidv4 } from 'uuid';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { invokeModel } from '../services/ai.service.js';
import multer from 'multer';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// All routes require authentication
router.use(authenticate);

// Middleware to check company limits for user
const checkUserLimits = async (req, res, next) => {
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
// USER PROFILE
// ============================================

/**
 * @route   GET /api/v1/user/profile
 * @desc    Get user profile
 */
router.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const userResponse = await docClient.send(new GetCommand({
      TableName: TABLES.USERS,
      Key: { email: req.user.email },
    }));

    if (!userResponse.Item) {
      throw new AppError('User not found', 404);
    }

    const { password, resetToken, resetTokenExpiry, ...user } = userResponse.Item;

    res.json({
      user,
    });
  })
);

/**
 * @route   PATCH /api/v1/user/profile
 * @desc    Update own profile
 */
router.patch(
  '/profile',
  asyncHandler(async (req, res) => {
    const { name, phone } = req.body;

    const updates = {};
    if (name) updates.name = name;
    if (phone) updates.phone = phone;

    if (Object.keys(updates).length === 0) {
      throw new AppError('No fields to update', 400);
    }

    const updateExpr = Object.keys(updates).map((k, i) => `#attr${i} = :val${i}`).join(', ');
    const attrNames = {};
    const attrValues = {};
    
    Object.keys(updates).forEach((key, i) => {
      attrNames[`#attr${i}`] = key;
      attrValues[`:val${i}`] = updates[key];
    });

    await docClient.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { email: req.user.email },
      UpdateExpression: `SET ${updateExpr}, updatedAt = :updatedAt`,
      ExpressionAttributeNames: attrNames,
      ExpressionAttributeValues: { ...attrValues, ':updatedAt': new Date().toISOString() },
    }));

    res.json({ message: 'Profile updated successfully' });
  })
);

/**
 * @route   GET /api/v1/user/company-admin-contact
 * @desc    Get company admin contact information
 */
router.get(
  '/company-admin-contact',
  asyncHandler(async (req, res) => {
    const usersResponse = await docClient.send(new QueryCommand({
      TableName: TABLES.USERS,
      IndexName: 'CompanyIdIndex',
      KeyConditionExpression: 'companyId = :companyId',
      FilterExpression: '#role = :role',
      ExpressionAttributeNames: { '#role': 'role' },
      ExpressionAttributeValues: {
        ':companyId': req.user.companyId,
        ':role': 'company_admin',
      },
    }));

    const admins = (usersResponse.Items || []).map(admin => ({
      name: admin.name,
      email: admin.email,
      phone: admin.phone,
      jobTitle: admin.jobTitle,
    }));

    res.json({
      companyAdmins: admins,
      count: admins.length,
    });
  })
);

// ============================================
// RFP UPLOAD & Q&A
// ============================================

/**
 * @route   POST /api/v1/user/upload-rfp
 * @desc    Upload RFP document
 */
router.post(
  '/upload-rfp',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('RFP file is required', 400);
    }

    const { title, clientName } = req.body;

    const fileKey = `rfps/${req.user.companyId}/${req.user.id}/${uuidv4()}-${req.file.originalname}`;

    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: fileKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));

    const fileUrl = `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${fileKey}`;

    // Create proposal
    const proposalId = uuidv4();
    const proposal = {
      id: proposalId,
      title: title || req.file.originalname,
      clientName: clientName || '',
      userId: req.user.id,
      companyId: req.user.companyId,
      status: 'draft',
      fileKey,
      fileUrl,
      questions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await docClient.send(new PutCommand({
      TableName: TABLES.PROPOSALS,
      Item: proposal,
    }));

    res.json({
      message: 'RFP uploaded successfully',
      proposal,
      fileUrl,
    });
  })
);

/**
 * @route   POST /api/v1/user/search-qa
 * @desc    Ask question to AI (with search limit check)
 */
router.post(
  '/search-qa',
  checkUserLimits,
  asyncHandler(async (req, res) => {
    const { question, context } = req.body;

    if (!question) {
      throw new AppError('Question is required', 400);
    }

    // Check search limit
    if (req.company.limits.searchesUsed >= req.company.limits.maxMonthlySearches) {
      throw new AppError(`Monthly search limit (${req.company.limits.maxMonthlySearches}) reached. Contact your company admin.`, 403);
    }

    const prompt = `
Question: ${question}

Context: ${context || 'No additional context provided'}

Provide a comprehensive and accurate answer based on the company's knowledge base and best practices.
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

    // Update user search count
    await docClient.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { email: req.user.email },
      UpdateExpression: 'SET #usage.#totalSearches = #usage.#totalSearches + :inc',
      ExpressionAttributeNames: {
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
 * @route   GET /api/v1/user/usage
 * @desc    Get own usage statistics
 */
router.get(
  '/usage',
  asyncHandler(async (req, res) => {
    const userResponse = await docClient.send(new GetCommand({
      TableName: TABLES.USERS,
      Key: { email: req.user.email },
    }));

    if (!userResponse.Item) {
      throw new AppError('User not found', 404);
    }

    const user = userResponse.Item;

    res.json({
      usage: user.usage,
      companyLimits: {
        searches: {
          used: req.company?.limits?.searchesUsed || 0,
          max: req.company?.limits?.maxMonthlySearches || 0,
        },
        exports: {
          used: req.company?.limits?.exportsUsed || 0,
          max: req.company?.limits?.maxMonthlyExports || 0,
        },
      },
    });
  })
);

/**
 * @route   GET /api/v1/user/proposals
 * @desc    Get own proposals
 */
router.get(
  '/proposals',
  asyncHandler(async (req, res) => {
    const proposalsResponse = await docClient.send(new QueryCommand({
      TableName: TABLES.PROPOSALS,
      IndexName: 'UserIdIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': req.user.id,
      },
    }));

    const proposals = proposalsResponse.Items || [];

    res.json({
      proposals,
      count: proposals.length,
    });
  })
);

/**
 * @route   POST /api/v1/user/export
 * @desc    Export proposal (with limit check)
 */
router.post(
  '/export',
  checkUserLimits,
  asyncHandler(async (req, res) => {
    const { proposalId, format } = req.body;

    if (!proposalId || !format) {
      throw new AppError('Proposal ID and format are required', 400);
    }

    // Check export limit
    if (req.company.limits.exportsUsed >= req.company.limits.maxMonthlyExports) {
      throw new AppError(`Monthly export limit (${req.company.limits.maxMonthlyExports}) reached. Contact your company admin.`, 403);
    }

    // TODO: Implement actual export logic

    // Increment export counts
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

    await docClient.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { email: req.user.email },
      UpdateExpression: 'SET #usage.#totalExports = #usage.#totalExports + :inc',
      ExpressionAttributeNames: {
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