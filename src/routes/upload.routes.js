import express from 'express';
import multer from 'multer';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { s3Client, docClient, TABLES } from '../config/aws.config.js';
import { extractTextFromFile, extractQuestionsFromText } from '../services/document.service.js';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain',
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOCX, DOC, and TXT files are allowed.'));
    }
  },
});

// Apply authentication to all routes
router.use(authenticate);

/**
 * @route   POST /api/v1/upload/rfp
 * @desc    Upload RFP document and extract questions
 * @access  Private
 */
router.post(
  '/rfp',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const { title, clientName, description } = req.body;

    if (!title) {
      throw new AppError('Title is required', 400);
    }

    // Generate unique file key
    const fileKey = `rfps/${req.user.companyId}/${req.user.id}/${uuidv4()}-${req.file.originalname}`;

    // Upload to S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        Metadata: {
          uploadedBy: req.user.id,
          companyId: req.user.companyId,
        },
      })
    );

    const fileUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;

    // Extract text from document
    let extractedText = '';
    let questions = [];

    try {
      extractedText = await extractTextFromFile(req.file.buffer, req.file.mimetype);
      questions = extractQuestionsFromText(extractedText);
    } catch (error) {
      console.error('Error extracting text:', error);
      // Continue without extraction if it fails
    }

    // Create proposal
    const proposalId = uuidv4();
    const proposal = {
      id: proposalId,
      title,
      clientName: clientName || '',
      description: description || '',
      userId: req.user.id,
      companyId: req.user.companyId,
      status: 'draft',
      fileKey,
      fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      extractedText: extractedText.substring(0, 5000), // Store first 5000 chars
      questions,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.user.id,
    };

    // Save to DynamoDB
    await docClient.send(
      new PutCommand({
        TableName: TABLES.PROPOSALS,
        Item: proposal,
      })
    );

    // Remove full extracted text from response
    const { extractedText: _, ...proposalResponse } = proposal;

    res.status(201).json({
      message: 'RFP uploaded successfully',
      proposal: proposalResponse,
      questionsExtracted: questions.length,
    });
  })
);

/**
 * @route   POST /api/v1/upload/knowledge
 * @desc    Upload knowledge base document
 * @access  Private (Admin+)
 */
router.post(
  '/knowledge',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const { title, category, tags, description } = req.body;

    if (!title) {
      throw new AppError('Title is required', 400);
    }

    // Generate unique file key
    const fileKey = `knowledge/${req.user.companyId}/${uuidv4()}-${req.file.originalname}`;

    // Upload to S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_KNOWLEDGE_BASE_BUCKET || process.env.S3_BUCKET_NAME,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        Metadata: {
          uploadedBy: req.user.id,
          companyId: req.user.companyId,
          category: category || 'general',
        },
      })
    );

    const fileUrl = `https://${process.env.S3_KNOWLEDGE_BASE_BUCKET || process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;

    // Extract text from document
    let content = '';
    try {
      content = await extractTextFromFile(req.file.buffer, req.file.mimetype);
    } catch (error) {
      console.error('Error extracting text:', error);
      content = 'Text extraction failed';
    }

    // Create knowledge base entry
    const knowledgeId = uuidv4();
    const knowledgeEntry = {
      id: knowledgeId,
      title,
      description: description || '',
      category: category || 'general',
      tags: tags ? tags.split(',').map(t => t.trim()) : [],
      content: content.substring(0, 10000), // Store first 10000 chars
      fileKey,
      fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      companyId: req.user.companyId,
      uploadedBy: req.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Save to DynamoDB
    await docClient.send(
      new PutCommand({
        TableName: TABLES.KNOWLEDGE,
        Item: knowledgeEntry,
      })
    );

    res.status(201).json({
      message: 'Knowledge document uploaded successfully',
      knowledge: knowledgeEntry,
    });
  })
);

/**
 * @route   POST /api/v1/upload/attachment
 * @desc    Upload generic attachment/file
 * @access  Private
 */
router.post(
  '/attachment',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const { proposalId, type } = req.body;

    // Generate unique file key
    const fileKey = `attachments/${req.user.companyId}/${proposalId || 'general'}/${uuidv4()}-${req.file.originalname}`;

    // Upload to S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        Metadata: {
          uploadedBy: req.user.id,
          companyId: req.user.companyId,
          type: type || 'attachment',
        },
      })
    );

    const fileUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;

    res.status(201).json({
      message: 'File uploaded successfully',
      file: {
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        fileKey,
        fileUrl,
        uploadedAt: new Date().toISOString(),
      },
    });
  })
);

export default router;