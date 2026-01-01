import express from 'express';
import multer from 'multer';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { s3Service } from '../services/s3.service.js';
import { documentProcessor } from '../services/document.service.js';
import { aiService } from '../services/ai.service.js';
import { proposalService } from '../services/proposal.service.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760'),
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = process.env.ALLOWED_FILE_TYPES?.split(',') || [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  },
});

router.post(
  '/rfp',
  authenticate,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    if (!req.body.title || !req.body.clientName) {
      throw new AppError('Title and client name are required', 400);
    }

    const { key, url } = await s3Service.uploadFile(req.file, 'rfp-documents');
    const text = await documentProcessor.processDocument(req.file.buffer, req.file.mimetype);
    const questions = await aiService.extractQuestionsFromRFP(text);

    const proposal = await proposalService.createProposal({
      userId: req.user.id,
      title: req.body.title,
      clientName: req.body.clientName,
      rfpFileKey: key,
      questions: questions.map(q => ({ ...q, status: 'pending' })),
    });

    res.status(200).json({
      message: 'RFP uploaded and processed successfully',
      proposal,
      fileUrl: url,
      questionsExtracted: questions.length,
    });
  })
);

router.post(
  '/knowledge',
  authenticate,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const { key, url } = await s3Service.uploadFile(req.file, 'knowledge-base');

    res.status(200).json({
      message: 'Knowledge document uploaded successfully',
      fileKey: key,
      fileUrl: url,
    });
  })
);

export default router;