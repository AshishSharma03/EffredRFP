import jwt from 'jsonwebtoken';
import { AppError } from './error.middleware.js';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from '../config/aws.config.js';

/**
 * Authenticate user from JWT token
 * Verifies token and attaches user info to request
 */
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('No token provided', 401);
    }

    const token = authHeader.split(' ')[1];

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get fresh user data from database to check current status
    const userResponse = await docClient.send(new GetCommand({
      TableName: TABLES.USERS,
      Key: { email: decoded.email },
    }));

    if (!userResponse.Item) {
      throw new AppError('User not found', 401);
    }

    const user = userResponse.Item;

    // Check if user is active
    if (!user.isActive) {
      throw new AppError('Account is deactivated. Contact your administrator.', 403);
    }

    // Check login status (for company admins and users)
    if (user.loginStatus === 'disabled') {
      throw new AppError('Login is disabled for this account. Contact your administrator.', 403);
    }

    // Check if company is active (except for superadmin)
    if (user.role !== 'superadmin') {
      const companyResponse = await docClient.send(new GetCommand({
        TableName: TABLES.COMPANIES,
        Key: { id: user.companyId },
      }));

      if (companyResponse.Item && companyResponse.Item.subscriptionStatus === 'deactivated') {
        throw new AppError('Company subscription is deactivated. Contact support.', 403);
      }
    }

    // Attach user info to request
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      companyId: user.companyId,
      loginStatus: user.loginStatus,
      isActive: user.isActive,
    };

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      throw new AppError('Invalid token', 401);
    }
    if (error.name === 'TokenExpiredError') {
      throw new AppError('Token expired. Please login again.', 401);
    }
    throw error;
  }
};

/**
 * Authorize based on roles
 * Role hierarchy: superadmin > company_admin > user
 * 
 * @param {...string} allowedRoles - Roles that can access the route
 * @returns {Function} Middleware function
 * 
 * @example
 * router.get('/admin', authenticate, authorize('superadmin', 'company_admin'), handler)
 */
export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new AppError(
        `Access denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${req.user.role}`,
        403
      );
    }

    next();
  };
};

/**
 * Check if user can access company data
 * SuperAdmin can access all companies
 * Company admin and users can only access their own company
 */
export const checkCompanyAccess = (req, res, next) => {
  // SuperAdmin can access all companies
  if (req.user.role === 'superadmin') {
    return next();
  }

  // Get requested company ID from params, body, or user's company
  const requestedCompanyId = req.params.companyId || req.body.companyId || req.user.companyId;

  // Check if user belongs to the requested company
  if (req.user.companyId !== requestedCompanyId) {
    throw new AppError('Access denied. You can only access your own company data.', 403);
  }

  next();
};

/**
 * Check if user is superadmin
 * Use this for routes that only superadmin can access
 * 
 * @example
 * router.post('/companies', authenticate, isSuperAdmin, createCompany)
 */
export const isSuperAdmin = (req, res, next) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  if (req.user.role !== 'superadmin') {
    throw new AppError('Access denied. SuperAdmin only.', 403);
  }

  next();
};

/**
 * Check if user is company admin or higher (superadmin)
 * Use this for routes that company admins can access
 * 
 * @example
 * router.post('/users', authenticate, isCompanyAdminOrHigher, createUser)
 */
export const isCompanyAdminOrHigher = (req, res, next) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  if (req.user.role !== 'company_admin' && req.user.role !== 'superadmin') {
    throw new AppError('Access denied. Company Admin or SuperAdmin required.', 403);
  }

  next();
};

/**
 * Check if user is admin (backward compatibility)
 * This includes superadmin, company_admin, and legacy 'admin' role
 * 
 * @example
 * router.get('/analytics', authenticate, isAdmin, getAnalytics)
 */
export const isAdmin = (req, res, next) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const adminRoles = ['admin', 'company_admin', 'superadmin'];
  
  if (!adminRoles.includes(req.user.role)) {
    throw new AppError('Access denied. Admin access required.', 403);
  }

  next();
};

/**
 * Check if user owns the resource or is admin
 * Useful for routes where users can access their own data or admins can access all
 * 
 * @param {string} userIdParam - Name of the parameter containing user ID (default: 'userId')
 * @returns {Function} Middleware function
 * 
 * @example
 * router.get('/users/:userId/profile', authenticate, canAccessUserData('userId'), getProfile)
 */
export const canAccessUserData = (userIdParam = 'userId') => {
  return (req, res, next) => {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const requestedUserId = req.params[userIdParam] || req.body.userId;

    // SuperAdmin and Company Admin can access any user data
    if (req.user.role === 'superadmin' || req.user.role === 'company_admin') {
      return next();
    }

    // Regular users can only access their own data
    if (req.user.id !== requestedUserId) {
      throw new AppError('Access denied. You can only access your own data.', 403);
    }

    next();
  };
};

/**
 * Check if company has reached a specific limit
 * Use this to enforce usage limits
 * 
 * @param {string} limitType - Type of limit to check ('users', 'searches', 'exports', 'proposals')
 * @returns {Function} Middleware function
 * 
 * @example
 * router.post('/search', authenticate, checkLimit('searches'), performSearch)
 */
export const checkLimit = (limitType) => {
  return async (req, res, next) => {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    // SuperAdmin has no limits
    if (req.user.role === 'superadmin') {
      return next();
    }

    try {
      // Get company limits
      const companyResponse = await docClient.send(new GetCommand({
        TableName: TABLES.COMPANIES,
        Key: { id: req.user.companyId },
      }));

      if (!companyResponse.Item) {
        throw new AppError('Company not found', 404);
      }

      const company = companyResponse.Item;
      const limits = company.limits;

      // Check specific limit
      let limitReached = false;
      let limitMessage = '';

      switch (limitType) {
        case 'users':
          limitReached = limits.usersAdded >= limits.maxUsers;
          limitMessage = `User limit reached (${limits.maxUsers}). Contact your administrator.`;
          break;

        case 'searches':
          limitReached = limits.searchesUsed >= limits.maxMonthlySearches;
          limitMessage = `Monthly search limit (${limits.maxMonthlySearches}) reached. Contact your administrator.`;
          break;

        case 'exports':
          limitReached = limits.exportsUsed >= limits.maxMonthlyExports;
          limitMessage = `Monthly export limit (${limits.maxMonthlyExports}) reached. Contact your administrator.`;
          break;

        case 'proposals':
          limitReached = limits.proposalsUsed >= limits.maxMonthlyProposals;
          limitMessage = `Monthly proposal limit (${limits.maxMonthlyProposals}) reached. Contact your administrator.`;
          break;

        case 'storage':
          limitReached = limits.storageUsedGB >= limits.maxStorageGB;
          limitMessage = `Storage limit (${limits.maxStorageGB}GB) reached. Contact your administrator.`;
          break;

        default:
          throw new AppError('Invalid limit type', 500);
      }

      if (limitReached) {
        throw new AppError(limitMessage, 403);
      }

      // Attach company to request for later use
      req.company = company;

      next();
    } catch (error) {
      throw error;
    }
  };
};

/**
 * Check if company has specific permission enabled
 * Use this to check feature flags
 * 
 * @param {string} permission - Permission to check ('allowAddUser', 'allowUpdateLogo', etc.)
 * @returns {Function} Middleware function
 * 
 * @example
 * router.post('/logo', authenticate, checkPermission('allowUpdateLogo'), uploadLogo)
 */
export const checkPermission = (permission) => {
  return async (req, res, next) => {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    // SuperAdmin has all permissions
    if (req.user.role === 'superadmin') {
      return next();
    }

    try {
      // Get company settings
      const companyResponse = await docClient.send(new GetCommand({
        TableName: TABLES.COMPANIES,
        Key: { id: req.user.companyId },
      }));

      if (!companyResponse.Item) {
        throw new AppError('Company not found', 404);
      }

      const company = companyResponse.Item;
      const hasPermission = company.limits && company.limits[permission];

      if (!hasPermission) {
        throw new AppError(
          `This feature is not enabled for your company. Contact your administrator.`,
          403
        );
      }

      // Attach company to request for later use
      req.company = company;

      next();
    } catch (error) {
      throw error;
    }
  };
};

/**
 * Optional authentication - doesn't fail if no token provided
 * Useful for routes that have different behavior for authenticated vs anonymous users
 * 
 * @example
 * router.get('/public-data', optionalAuth, getData)
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No token provided, continue without user
      req.user = null;
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user data
    const userResponse = await docClient.send(new GetCommand({
      TableName: TABLES.USERS,
      Key: { email: decoded.email },
    }));

    if (userResponse.Item) {
      req.user = {
        id: userResponse.Item.id,
        email: userResponse.Item.email,
        name: userResponse.Item.name,
        role: userResponse.Item.role,
        companyId: userResponse.Item.companyId,
      };
    } else {
      req.user = null;
    }

    next();
  } catch (error) {
    // Invalid token, continue without user
    req.user = null;
    next();
  }
};

/**
 * Rate limiting check (basic implementation)
 * For production, use Redis-based rate limiting
 * 
 * @param {number} maxRequests - Maximum requests allowed
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Function} Middleware function
 */
export const rateLimit = (maxRequests = 100, windowMs = 60000) => {
  const requests = new Map();

  return (req, res, next) => {
    const identifier = req.user?.id || req.ip;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old entries
    if (!requests.has(identifier)) {
      requests.set(identifier, []);
    }

    const userRequests = requests.get(identifier).filter(time => time > windowStart);
    userRequests.push(now);
    requests.set(identifier, userRequests);

    if (userRequests.length > maxRequests) {
      throw new AppError(
        `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowMs / 1000} seconds.`,
        429
      );
    }

    next();
  };
};