import express from 'express';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { searchService } from '../services/search.service.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

router.post(
  '/search',
  authenticate,
  asyncHandler(async (req, res) => {
    const { query, category, tags, limit = 10 } = req.body;

    if (!query) {
      throw new AppError('Search query is required', 400);
    }

    const results = await searchService.searchDocuments(
      query,
      { category, tags },
      limit
    );

    res.status(200).json({
      results,
      count: results.length,
    });
  })
);

router.post(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const { title, content, category, tags, fileKey } = req.body;

    if (!title || !content || !category) {
      throw new AppError('Title, content, and category are required', 400);
    }

    const document = {
      id: uuidv4(),
      title,
      content,
      category,
      tags: tags || [],
      fileKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await searchService.indexDocument(document);

    res.status(201).json({
      message: 'Document added to knowledge base successfully',
      document,
    });
  })
);

router.put(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const { title, content, category, tags } = req.body;

    await searchService.updateDocument(req.params.id, {
      title,
      content,
      category,
      tags,
    });

    res.status(200).json({
      message: 'Document updated successfully',
    });
  })
);

router.delete(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    await searchService.deleteDocument(req.params.id);

    res.status(200).json({
      message: 'Document deleted successfully',
    });
  })
);

export default router;