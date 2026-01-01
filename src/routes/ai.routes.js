import express from 'express';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { aiService } from '../services/ai.service.js';
import { searchService } from '../services/search.service.js';
import { proposalService } from '../services/proposal.service.js';

const router = express.Router();

router.post(
  '/generate-answer',
  authenticate,
  asyncHandler(async (req, res) => {
    const { proposalId, questionId, question } = req.body;

    if (!proposalId || !questionId || !question) {
      throw new AppError('Proposal ID, question ID, and question text are required', 400);
    }

    const proposal = await proposalService.getProposal(proposalId);
    if (!proposal || proposal.userId !== req.user.id) {
      throw new AppError('Proposal not found or unauthorized', 403);
    }

    const relevantContext = await searchService.searchRelevantContext(question, 5);
    const draftAnswer = await aiService.generateDraftAnswer(question, relevantContext);

    const updatedQuestions = proposal.questions.map(q => {
      if (q.id === questionId) {
        return {
          ...q,
          draftAnswer: draftAnswer.answer,
          confidence: draftAnswer.confidence,
          sources: draftAnswer.sources,
          status: 'drafted',
        };
      }
      return q;
    });

    await proposalService.updateProposal(proposalId, {
      questions: updatedQuestions,
    });

    res.status(200).json({
      message: 'Draft answer generated successfully',
      answer: draftAnswer.answer,
      confidence: draftAnswer.confidence,
      sources: draftAnswer.sources,
    });
  })
);

router.post(
  '/improve-answer',
  authenticate,
  asyncHandler(async (req, res) => {
    const { currentAnswer, feedback, question } = req.body;

    if (!currentAnswer || !feedback || !question) {
      throw new AppError('Current answer, feedback, and question are required', 400);
    }

    const improvedAnswer = await aiService.improveDraftAnswer(
      currentAnswer,
      feedback,
      question
    );

    res.status(200).json({
      message: 'Answer improved successfully',
      improvedAnswer,
    });
  })
);

router.post(
  '/generate-summary',
  authenticate,
  asyncHandler(async (req, res) => {
    const { proposalId } = req.body;

    if (!proposalId) {
      throw new AppError('Proposal ID is required', 400);
    }

    const proposal = await proposalService.getProposal(proposalId);
    if (!proposal || proposal.userId !== req.user.id) {
      throw new AppError('Proposal not found or unauthorized', 403);
    }

    const sections = proposal.questions
      .filter(q => q.finalAnswer || q.draftAnswer)
      .map(q => ({
        title: q.section,
        content: q.finalAnswer || q.draftAnswer,
      }));

    const summary = await aiService.summarizeProposal(sections);

    res.status(200).json({
      message: 'Executive summary generated successfully',
      summary,
    });
  })
);

router.post(
  '/bulk-generate',
  authenticate,
  asyncHandler(async (req, res) => {
    const { proposalId } = req.body;

    if (!proposalId) {
      throw new AppError('Proposal ID is required', 400);
    }

    const proposal = await proposalService.getProposal(proposalId);
    if (!proposal || proposal.userId !== req.user.id) {
      throw new AppError('Proposal not found or unauthorized', 403);
    }

    const pendingQuestions = proposal.questions.filter(q => q.status === 'pending');
    let processedCount = 0;

    for (const question of pendingQuestions) {
      try {
        const relevantContext = await searchService.searchRelevantContext(
          question.question,
          5
        );
        
        const draftAnswer = await aiService.generateDraftAnswer(
          question.question,
          relevantContext
        );

        question.draftAnswer = draftAnswer.answer;
        question.confidence = draftAnswer.confidence;
        question.sources = draftAnswer.sources;
        question.status = 'drafted';
        
        processedCount++;
      } catch (error) {
        console.error(`Failed to generate answer for question ${question.id}:`, error);
      }
    }

    await proposalService.updateProposal(proposalId, {
      questions: proposal.questions,
    });

    res.status(200).json({
      message: 'Bulk generation completed',
      totalQuestions: pendingQuestions.length,
      processedCount,
    });
  })
);

export default router;