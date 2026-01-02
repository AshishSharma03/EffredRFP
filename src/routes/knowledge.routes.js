import express from 'express';
import { PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { docClient, TABLES } from '../config/aws.config.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

/**
 * @route   POST /api/v1/knowledge/search
 * @desc    Search knowledge base
 * @access  Private
 */
router.post(
  '/search',
  asyncHandler(async (req, res) => {
    const { query, category, tags, limit = 10 } = req.body;

    if (!query) {
      throw new AppError('Search query is required', 400);
    }

    // Build filter expression
    let filterExpression = 'companyId = :companyId';
    const expressionValues = {
      ':companyId': req.user.companyId,
    };

    if (category) {
      filterExpression += ' AND category = :category';
      expressionValues[':category'] = category;
    }

    const params = {
      TableName: TABLES.KNOWLEDGE,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionValues,
      Limit: parseInt(limit),
    };

    const response = await docClient.send(new ScanCommand(params));
    let results = response.Items || [];

    // Simple keyword search in title and content
    const searchTerms = query.toLowerCase().split(/\s+/);
    
    results = results
      .map(item => {
        const title = (item.title || '').toLowerCase();
        const content = (item.content || '').toLowerCase();
        const itemTags = item.tags || [];
        
        let score = 0;
        
        searchTerms.forEach(term => {
          if (title.includes(term)) score += 5;
          if (content.includes(term)) score += 2;
          if (itemTags.some(tag => tag.toLowerCase().includes(term))) score += 3;
        });
        
        return { ...item, relevanceScore: score };
      })
      .filter(item => item.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, parseInt(limit));

    res.json({
      query,
      results,
      count: results.length,
    });
  })
);

/**
 * @route   GET /api/v1/knowledge
 * @desc    Get all knowledge base documents
 * @access  Private
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { category, limit = 50 } = req.query;

    let filterExpression = 'companyId = :companyId';
    const expressionValues = {
      ':companyId': req.user.companyId,
    };

    if (category) {
      filterExpression += ' AND category = :category';
      expressionValues[':category'] = category;
    }

    const params = {
      TableName: TABLES.KNOWLEDGE,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionValues,
      Limit: parseInt(limit),
    };

    const response = await docClient.send(new ScanCommand(params));

    res.json({
      documents: response.Items || [],
      count: response.Items?.length || 0,
    });
  })
);

/**
 * @route   GET /api/v1/knowledge/:id
 * @desc    Get single knowledge document
 * @access  Private
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const response = await docClient.send(
      new GetCommand({
        TableName: TABLES.KNOWLEDGE,
        Key: { id },
      })
    );

    if (!response.Item) {
      throw new AppError('Document not found', 404);
    }

    const document = response.Item;

    // Check access
    if (document.companyId !== req.user.companyId && req.user.role !== 'superadmin') {
      throw new AppError('Access denied', 403);
    }

    res.json({
      document,
    });
  })
);

/**
 * @route   POST /api/v1/knowledge
 * @desc    Add knowledge document manually
 * @access  Private (Admin+)
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { title, content, category, tags, description, fileKey } = req.body;

    if (!title || !content) {
      throw new AppError('Title and content are required', 400);
    }

    const knowledgeId = uuidv4();
    const document = {
      id: knowledgeId,
      title,
      content,
      description: description || '',
      category: category || 'general',
      tags: tags || [],
      fileKey: fileKey || '',
      companyId: req.user.companyId,
      uploadedBy: req.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLES.KNOWLEDGE,
        Item: document,
      })
    );

    res.status(201).json({
      message: 'Knowledge document created successfully',
      document,
    });
  })
);

/**
 * @route   PUT /api/v1/knowledge/:id
 * @desc    Update knowledge document
 * @access  Private (Admin+)
 */
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { title, content, category, tags, description } = req.body;

    // Get existing document
    const existing = await docClient.send(
      new GetCommand({
        TableName: TABLES.KNOWLEDGE,
        Key: { id },
      })
    );

    if (!existing.Item) {
      throw new AppError('Document not found', 404);
    }

    // Check access
    if (existing.Item.companyId !== req.user.companyId && req.user.role !== 'superadmin') {
      throw new AppError('Access denied', 403);
    }

    // Build update expression
    const updates = {};
    if (title) updates.title = title;
    if (content) updates.content = content;
    if (category) updates.category = category;
    if (tags) updates.tags = tags;
    if (description !== undefined) updates.description = description;

    if (Object.keys(updates).length === 0) {
      throw new AppError('No fields to update', 400);
    }

    const updateExpression = Object.keys(updates)
      .map((key, i) => `#field${i} = :value${i}`)
      .join(', ');

    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    Object.keys(updates).forEach((key, i) => {
      expressionAttributeNames[`#field${i}`] = key;
      expressionAttributeValues[`:value${i}`] = updates[key];
    });

    expressionAttributeValues[':updatedAt'] = new Date().toISOString();

    await docClient.send(
      new UpdateCommand({
        TableName: TABLES.KNOWLEDGE,
        Key: { id },
        UpdateExpression: `SET ${updateExpression}, updatedAt = :updatedAt`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      })
    );

    res.json({
      message: 'Document updated successfully',
    });
  })
);

/**
 * @route   DELETE /api/v1/knowledge/:id
 * @desc    Delete knowledge document
 * @access  Private (Admin+)
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Get existing document
    const existing = await docClient.send(
      new GetCommand({
        TableName: TABLES.KNOWLEDGE,
        Key: { id },
      })
    );

    if (!existing.Item) {
      throw new AppError('Document not found', 404);
    }

    // Check access
    if (existing.Item.companyId !== req.user.companyId && req.user.role !== 'superadmin') {
      throw new AppError('Access denied', 403);
    }

    // Delete document
    await docClient.send(
      new DeleteCommand({
        TableName: TABLES.KNOWLEDGE,
        Key: { id },
      })
    );

    res.json({
      message: 'Document deleted successfully',
    });
  })
);

export default router;