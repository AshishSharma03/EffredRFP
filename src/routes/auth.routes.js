import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from '../config/aws.config.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register new user (creates company too)
 */
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      throw new AppError('Email, password, and name are required', 400);
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
    const companyId = uuidv4();

    // Create company
    const company = {
      id: companyId,
      name: `${name}'s Company`,
      email: email,
      phone: '',
      website: '',
      logoUrl: '',
      planType: 'free',
      subscriptionStatus: 'trial',
      
      limits: {
        maxUsers: 5,
        allowAddUser: true,
        usersAdded: 1,
        allowUpdateLogo: true,
        maxMonthlyProposals: 25,
        proposalsUsed: 0,
        maxMonthlySearches: 1000,
        searchesUsed: 0,
        maxMonthlyExports: 100,
        exportsUsed: 0,
        maxStorageGB: 5,
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
        allowBulkUpload: false,
        maxFileSize: 10,
        allowedFileTypes: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        enableAnalytics: true,
        requireApproval: false,
        enableAISearch: true,
        enableExport: true,
      },
      
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await docClient.send(new PutCommand({
      TableName: TABLES.COMPANIES,
      Item: company,
    }));

    // Create user
    const user = {
      id: userId,
      email,
      name,
      password: hashedPassword,
      phone: '',
      role: 'user',
      companyId,
      
      loginStatus: 'enabled',
      isActive: true,
      
      usage: {
        totalLogins: 0,
        totalSearches: 0,
        totalExports: 0,
        lastLoginAt: null,
        lastPasswordResetAt: null,
      },
      
      department: '',
      jobTitle: '',
      
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      
      resetToken: null,
      resetTokenExpiry: null,
    };

    await docClient.send(new PutCommand({
      TableName: TABLES.USERS,
      Item: user,
    }));

    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        name: user.name, 
        role: user.role,
        companyId: user.companyId,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    const { password: _, ...userWithoutPassword } = user;

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: userWithoutPassword,
    });
  })
);

/**
 * @route   POST /api/v1/auth/login
 * @desc    Login with login status check and usage tracking
 */
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError('Email and password are required', 400);
    }

    // Get user
    const userResponse = await docClient.send(new GetCommand({
      TableName: TABLES.USERS,
      Key: { email },
    }));

    const user = userResponse.Item;

    if (!user) {
      throw new AppError('Invalid credentials', 401);
    }

    // Check if user is active
    if (!user.isActive) {
      throw new AppError('Account is deactivated. Contact your administrator.', 403);
    }

    // Check login status
    if (user.loginStatus === 'disabled') {
      throw new AppError('Login is disabled for this account. Contact your administrator.', 403);
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);

    if (!isValid) {
      throw new AppError('Invalid credentials', 401);
    }

    // Get company to check subscription status
    const companyResponse = await docClient.send(new GetCommand({
      TableName: TABLES.COMPANIES,
      Key: { id: user.companyId },
    }));

    if (companyResponse.Item && companyResponse.Item.subscriptionStatus === 'deactivated') {
      throw new AppError('Company subscription is deactivated. Contact support.', 403);
    }

    // Update login counts and timestamp
    const now = new Date().toISOString();
    
    await docClient.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { email },
      UpdateExpression: 'SET #usage.#totalLogins = #usage.#totalLogins + :inc, #usage.#lastLoginAt = :now',
      ExpressionAttributeNames: {
        '#usage': 'usage',
        '#totalLogins': 'totalLogins',
        '#lastLoginAt': 'lastLoginAt',
      },
      ExpressionAttributeValues: {
        ':inc': 1,
        ':now': now,
      },
    }));

    // Update company login count
    await docClient.send(new UpdateCommand({
      TableName: TABLES.COMPANIES,
      Key: { id: user.companyId },
      UpdateExpression: 'SET #usage.#totalLogins = #usage.#totalLogins + :inc, #usage.#lastLoginAt = :now',
      ExpressionAttributeNames: {
        '#usage': 'usage',
        '#totalLogins': 'totalLogins',
        '#lastLoginAt': 'lastLoginAt',
      },
      ExpressionAttributeValues: {
        ':inc': 1,
        ':now': now,
      },
    }));

    // Generate token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        name: user.name, 
        role: user.role,
        companyId: user.companyId,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    const { password: _, resetToken, resetTokenExpiry, ...userWithoutPassword } = user;

    res.json({
      message: 'Login successful',
      token,
      user: userWithoutPassword,
    });
  })
);

/**
 * @route   POST /api/v1/auth/forgot-password
 * @desc    Request password reset
 */
router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
      throw new AppError('Email is required', 400);
    }

    const userResponse = await docClient.send(new GetCommand({
      TableName: TABLES.USERS,
      Key: { email },
    }));

    if (!userResponse.Item) {
      // Don't reveal if user exists
      return res.json({ message: 'If the email exists, a reset link has been sent' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 3600000).toISOString(); // 1 hour

    await docClient.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { email },
      UpdateExpression: 'SET resetToken = :token, resetTokenExpiry = :expiry',
      ExpressionAttributeValues: {
        ':token': resetToken,
        ':expiry': resetTokenExpiry,
      },
    }));

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    // TODO: Send email
    // await sendEmail({ to: email, subject: 'Password Reset', html: `Reset: ${resetUrl}` });

    res.json({ 
      message: 'Password reset email sent',
      resetToken, // Remove in production
      resetUrl, // Remove in production
    });
  })
);

/**
 * @route   POST /api/v1/auth/reset-password
 * @desc    Reset password with token
 */
router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      throw new AppError('Token and new password are required', 400);
    }

    // Find user with token (need to scan)
    const usersResponse = await docClient.send(new ScanCommand({
      TableName: TABLES.USERS,
      FilterExpression: 'resetToken = :token',
      ExpressionAttributeValues: {
        ':token': token,
      },
    }));

    if (!usersResponse.Items || usersResponse.Items.length === 0) {
      throw new AppError('Invalid or expired reset token', 400);
    }

    const user = usersResponse.Items[0];

    // Check if token is expired
    if (new Date(user.resetTokenExpiry) < new Date()) {
      throw new AppError('Reset token has expired', 400);
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear reset token
    await docClient.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { email: user.email },
      UpdateExpression: 'SET password = :password, resetToken = :null, resetTokenExpiry = :null, #usage.#lastPasswordResetAt = :now',
      ExpressionAttributeNames: {
        '#usage': 'usage',
        '#lastPasswordResetAt': 'lastPasswordResetAt',
      },
      ExpressionAttributeValues: {
        ':password': hashedPassword,
        ':null': null,
        ':now': new Date().toISOString(),
      },
    }));

    res.json({ message: 'Password reset successfully' });
  })
);

export default router;