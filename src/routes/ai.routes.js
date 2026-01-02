import express from 'express';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { authenticate, checkLimit } from '../middleware/auth.middleware.js';
import { docClient, TABLES } from '../config/aws.config.js';
import { generateAnswer, improveAnswer, generateSummary, searchKnowledgeBase } from '../services/ai.service.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

/**
 * @route   POST /api/v1/ai/generate-answer
 * @desc    Generate draft answer for a question
 * @access  Private
 */
router.post(
  '/generate-answer',
  checkLimit('searches'),
  asyncHandler(async (req, res) => {
    const { proposalId, questionId, question } = req.body;

    if (!proposalId || !questionId || !question) {
      throw new AppError('proposalId, questionId, and question are required', 400);
    }

    // Get proposal
    const proposalResponse = await docClient.send(
      new GetCommand({
        TableName: TABLES.PROPOSALS,
        Key: { id: proposalId },
      })
    );

    if (!proposalResponse.Item) {
      throw new AppError('Proposal not found', 404);
    }

    const proposal = proposalResponse.Item;

    // Check access
    if (proposal.companyId !== req.user.companyId && req.user.role !== 'superadmin') {
      throw new AppError('Access denied', 403);
    }

    // Search knowledge base (simplified - you can enhance this)
    const context = ''; // TODO: Implement knowledge base search

    // Generate answer
    const result = await generateAnswer(question, context);

    // Update question with draft answer
    const questions = proposal.questions || [];
    const questionIndex = questions.findIndex(q => q.id === questionId);

    if (questionIndex !== -1) {
      questions[questionIndex].draftAnswer = result.answer;
      questions[questionIndex].confidence = result.confidence;
      questions[questionIndex].sources = result.sources;
      questions[questionIndex].status = 'draft';
      questions[questionIndex].generatedAt = result.generatedAt;

      await docClient.send(
        new UpdateCommand({
          TableName: TABLES.PROPOSALS,
          Key: { id: proposalId },
          UpdateExpression: 'SET questions = :questions, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':questions': questions,
            ':updatedAt': new Date().toISOString(),
          },
        })
      );
    }

    // Update search count
    await docClient.send(
      new UpdateCommand({
        TableName: TABLES.COMPANIES,
        Key: { id: req.user.companyId },
        UpdateExpression: 'SET #limits.#searchesUsed = #limits.#searchesUsed + :inc',
        ExpressionAttributeNames: {
          '#limits': 'limits',
          '#searchesUsed': 'searchesUsed',
        },
        ExpressionAttributeValues: {
          ':inc': 1,
        },
      })
    );

    res.json({
      message: 'Answer generated successfully',
      ...result,
    });
  })
);

/**
 * @route   POST /api/v1/ai/improve-answer
 * @desc    Improve existing answer based on feedback
 * @access  Private
 */
router.post(
  '/improve-answer',
  checkLimit('searches'),
  asyncHandler(async (req, res) => {
    const { currentAnswer, feedback, question } = req.body;

    if (!currentAnswer || !feedback || !question) {
      throw new AppError('currentAnswer, feedback, and question are required', 400);
    }

    // Generate improved answer
    const improvedAnswer = await improveAnswer(currentAnswer, feedback, question);

    // Update search count
    await docClient.send(
      new UpdateCommand({
        TableName: TABLES.COMPANIES,
        Key: { id: req.user.companyId },
        UpdateExpression: 'SET #limits.#searchesUsed = #limits.#searchesUsed + :inc',
        ExpressionAttributeNames: {
          '#limits': 'limits',
          '#searchesUsed': 'searchesUsed',
        },
        ExpressionAttributeValues: {
          ':inc': 1,
        },
      })
    );

    res.json({
      message: 'Answer improved successfully',
      improvedAnswer,
      improvedAt: new Date().toISOString(),
    });
  })
);

/**
 * @route   POST /api/v1/ai/generate-summary
 * @desc    Generate executive summary for proposal
 * @access  Private
 */
router.post(
  '/generate-summary',
  checkLimit('searches'),
  asyncHandler(async (req, res) => {
    const { proposalId } = req.body;

    if (!proposalId) {
      throw new AppError('proposalId is required', 400);
    }

    // Get proposal
    const proposalResponse = await docClient.send(
      new GetCommand({
        TableName: TABLES.PROPOSALS,
        Key: { id: proposalId },
      })
    );

    if (!proposalResponse.Item) {
      throw new AppError('Proposal not found', 404);
    }

    const proposal = proposalResponse.Item;

    // Check access
    if (proposal.companyId !== req.user.companyId && req.user.role !== 'superadmin') {
      throw new AppError('Access denied', 403);
    }

    // Generate summary
    const summary = await generateSummary(proposal);

    // Update proposal with summary
    await docClient.send(
      new UpdateCommand({
        TableName: TABLES.PROPOSALS,
        Key: { id: proposalId },
        UpdateExpression: 'SET executiveSummary = :summary, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':summary': summary,
          ':updatedAt': new Date().toISOString(),
        },
      })
    );

    // Update search count
    await docClient.send(
      new UpdateCommand({
        TableName: TABLES.COMPANIES,
        Key: { id: req.user.companyId },
        UpdateExpression: 'SET #limits.#searchesUsed = #limits.#searchesUsed + :inc',
        ExpressionAttributeNames: {
          '#limits': 'limits',
          '#searchesUsed': 'searchesUsed',
        },
        ExpressionAttributeValues: {
          ':inc': 1,
        },
      })
    );

    res.json({
      message: 'Summary generated successfully',
      summary,
    });
  })
);

/**
 * @route   POST /api/v1/ai/bulk-generate
 * @desc    Generate answers for all pending questions
 * @access  Private
 */
router.post(
  '/bulk-generate',
  checkLimit('searches'),
  asyncHandler(async (req, res) => {
    const { proposalId } = req.body;

    if (!proposalId) {
      throw new AppError('proposalId is required', 400);
    }

    // Get proposal
    const proposalResponse = await docClient.send(
      new GetCommand({
        TableName: TABLES.PROPOSALS,
        Key: { id: proposalId },
      })
    );

    if (!proposalResponse.Item) {
      throw new AppError('Proposal not found', 404);
    }

    const proposal = proposalResponse.Item;

    // Check access
    if (proposal.companyId !== req.user.companyId && req.user.role !== 'superadmin') {
      throw new AppError('Access denied', 403);
    }

    const questions = proposal.questions || [];
    const pendingQuestions = questions.filter(q => q.status === 'pending');

    if (pendingQuestions.length === 0) {
      throw new AppError('No pending questions found', 400);
    }

    // Generate answers for all pending questions
    const results = [];

    for (const question of pendingQuestions) {
      try {
        const result = await generateAnswer(question.question, '');
        
        // Update question
        const index = questions.findIndex(q => q.id === question.id);
        if (index !== -1) {
          questions[index].draftAnswer = result.answer;
          questions[index].confidence = result.confidence;
          questions[index].sources = result.sources;
          questions[index].status = 'draft';
          questions[index].generatedAt = result.generatedAt;
        }

        results.push({
          questionId: question.id,
          success: true,
        });
      } catch (error) {
        results.push({
          questionId: question.id,
          success: false,
          error: error.message,
        });
      }
    }

    // Update proposal
    await docClient.send(
      new UpdateCommand({
        TableName: TABLES.PROPOSALS,
        Key: { id: proposalId },
        UpdateExpression: 'SET questions = :questions, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':questions': questions,
          ':updatedAt': new Date().toISOString(),
        },
      })
    );

    // Update search count
    await docClient.send(
      new UpdateCommand({
        TableName: TABLES.COMPANIES,
        Key: { id: req.user.companyId },
        UpdateExpression: 'SET #limits.#searchesUsed = #limits.#searchesUsed + :inc',
        ExpressionAttributeNames: {
          '#limits': 'limits',
          '#searchesUsed': 'searchesUsed',
        },
        ExpressionAttributeValues: {
          ':inc': pendingQuestions.length,
        },
      })
    );

    const successCount = results.filter(r => r.success).length;

    res.json({
      message: `Generated ${successCount}/${pendingQuestions.length} answers`,
      results,
    });
  })
);

export default router;