import express from 'express';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { proposalService } from '../services/proposal.service.js';

const router = express.Router();

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const proposals = await proposalService.listUserProposals(req.user.id);
    res.status(200).json({ proposals, count: proposals.length });
  })
);

router.get(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const proposal = await proposalService.getProposal(req.params.id);

    if (!proposal) {
      throw new AppError('Proposal not found', 404);
    }

    if (proposal.userId !== req.user.id) {
      throw new AppError('Not authorized to access this proposal', 403);
    }

    res.status(200).json({ proposal });
  })
);

router.patch(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const proposal = await proposalService.getProposal(req.params.id);

    if (!proposal) {
      throw new AppError('Proposal not found', 404);
    }

    if (proposal.userId !== req.user.id) {
      throw new AppError('Not authorized to update this proposal', 403);
    }

    const updatedProposal = await proposalService.updateProposal(
      req.params.id,
      req.body
    );

    res.status(200).json({
      message: 'Proposal updated successfully',
      proposal: updatedProposal,
    });
  })
);

router.put(
  '/:id/questions/:questionId/answer',
  authenticate,
  asyncHandler(async (req, res) => {
    const { answer, status } = req.body;

    if (!answer || !status) {
      throw new AppError('Answer and status are required', 400);
    }

    const proposal = await proposalService.getProposal(req.params.id);

    if (!proposal) {
      throw new AppError('Proposal not found', 404);
    }

    if (proposal.userId !== req.user.id) {
      throw new AppError('Not authorized', 403);
    }

    const updatedProposal = await proposalService.updateQuestionAnswer(
      req.params.id,
      req.params.questionId,
      answer,
      status
    );

    res.status(200).json({
      message: 'Answer updated successfully',
      proposal: updatedProposal,
    });
  })
);

router.delete(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const proposal = await proposalService.getProposal(req.params.id);

    if (!proposal) {
      throw new AppError('Proposal not found', 404);
    }

    if (proposal.userId !== req.user.id) {
      throw new AppError('Not authorized to delete this proposal', 403);
    }

    await proposalService.deleteProposal(req.params.id);

    res.status(200).json({
      message: 'Proposal deleted successfully',
    });
  })
);

export default router;