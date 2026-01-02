import express from 'express';
import { GetCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { authenticate, checkCompanyAccess } from '../middleware/auth.middleware.js';
import { docClient, TABLES } from '../config/aws.config.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

/**
 * @route   GET /api/v1/proposals
 * @desc    Get all proposals for user's company
 * @access  Private
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, limit = 50 } = req.query;

    let filterExpression = 'companyId = :companyId';
    const expressionValues = {
      ':companyId': req.user.companyId,
    };

    // Add status filter if provided
    if (status) {
      filterExpression += ' AND #status = :status';
      expressionValues[':status'] = status;
    }

    const params = {
      TableName: TABLES.PROPOSALS,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionValues,
      Limit: parseInt(limit),
    };

    // Add ExpressionAttributeNames if status filter is used
    if (status) {
      params.ExpressionAttributeNames = {
        '#status': 'status',
      };
    }

    const response = await docClient.send(new ScanCommand(params));

    res.json({
      proposals: response.Items || [],
      count: response.Items?.length || 0,
    });
  })
);

/**
 * @route   GET /api/v1/proposals/:id
 * @desc    Get single proposal with all questions
 * @access  Private
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const response = await docClient.send(
      new GetCommand({
        TableName: TABLES.PROPOSALS,
        Key: { id },
      })
    );

    if (!response.Item) {
      throw new AppError('Proposal not found', 404);
    }

    const proposal = response.Item;

    // Check if user has access to this proposal
    if (proposal.companyId !== req.user.companyId && req.user.role !== 'superadmin') {
      throw new AppError('Access denied', 403);
    }

    res.json({
      proposal,
    });
  })
);

/**
 * @route   PATCH /api/v1/proposals/:id
 * @desc    Update proposal
 * @access  Private
 */
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { title, clientName, description, status } = req.body;

    // Get existing proposal
    const existing = await docClient.send(
      new GetCommand({
        TableName: TABLES.PROPOSALS,
        Key: { id },
      })
    );

    if (!existing.Item) {
      throw new AppError('Proposal not found', 404);
    }

    // Check access
    if (existing.Item.companyId !== req.user.companyId && req.user.role !== 'superadmin') {
      throw new AppError('Access denied', 403);
    }

    // Build update expression
    const updates = {};
    if (title) updates.title = title;
    if (clientName) updates.clientName = clientName;
    if (description !== undefined) updates.description = description;
    if (status) updates.status = status;

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
        TableName: TABLES.PROPOSALS,
        Key: { id },
        UpdateExpression: `SET ${updateExpression}, updatedAt = :updatedAt`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      })
    );

    res.json({
      message: 'Proposal updated successfully',
    });
  })
);

/**
 * @route   PUT /api/v1/proposals/:id/questions/:questionId/answer
 * @desc    Update answer for a specific question
 * @access  Private
 */
router.put(
  '/:id/questions/:questionId/answer',
  asyncHandler(async (req, res) => {
    const { id, questionId } = req.params;
    const { draftAnswer, finalAnswer, status } = req.body;

    // Get existing proposal
    const existing = await docClient.send(
      new GetCommand({
        TableName: TABLES.PROPOSALS,
        Key: { id },
      })
    );

    if (!existing.Item) {
      throw new AppError('Proposal not found', 404);
    }

    // Check access
    if (existing.Item.companyId !== req.user.companyId && req.user.role !== 'superadmin') {
      throw new AppError('Access denied', 403);
    }

    const proposal = existing.Item;
    const questions = proposal.questions || [];

    // Find and update the question
    const questionIndex = questions.findIndex(q => q.id === questionId);

    if (questionIndex === -1) {
      throw new AppError('Question not found', 404);
    }

    if (draftAnswer !== undefined) {
      questions[questionIndex].draftAnswer = draftAnswer;
    }
    if (finalAnswer !== undefined) {
      questions[questionIndex].finalAnswer = finalAnswer;
    }
    if (status) {
      questions[questionIndex].status = status;
    }

    questions[questionIndex].updatedAt = new Date().toISOString();
    questions[questionIndex].updatedBy = req.user.id;

    // Update proposal
    await docClient.send(
      new UpdateCommand({
        TableName: TABLES.PROPOSALS,
        Key: { id },
        UpdateExpression: 'SET questions = :questions, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':questions': questions,
          ':updatedAt': new Date().toISOString(),
        },
      })
    );

    res.json({
      message: 'Answer updated successfully',
      question: questions[questionIndex],
    });
  })
);

/**
 * @route   DELETE /api/v1/proposals/:id
 * @desc    Delete proposal
 * @access  Private
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Get existing proposal
    const existing = await docClient.send(
      new GetCommand({
        TableName: TABLES.PROPOSALS,
        Key: { id },
      })
    );

    if (!existing.Item) {
      throw new AppError('Proposal not found', 404);
    }

    // Check access
    if (existing.Item.companyId !== req.user.companyId && req.user.role !== 'superadmin') {
      throw new AppError('Access denied', 403);
    }

    // Soft delete - just update status
    await docClient.send(
      new UpdateCommand({
        TableName: TABLES.PROPOSALS,
        Key: { id },
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'deleted',
          ':updatedAt': new Date().toISOString(),
        },
      })
    );

    res.json({
      message: 'Proposal deleted successfully',
    });
  })
);

export default router;