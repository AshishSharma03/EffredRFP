import express from 'express';
import multer from 'multer';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { userService } from '../services/user.service.js';
import { companyService } from '../services/company.service.js';
import { billingService } from '../services/billing.service.js';
import { analyticsService } from '../services/analytics.service.js';
import { documentExportService } from '../services/export.service.js';
import { searchService } from '../services/search.service.js';
import { s3Service } from '../services/s3.service.js';
import { documentProcessor } from '../services/document.service.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '52428800'),
  },
});

// All admin routes require admin role
router.use(authenticate, authorize('admin'));

// ========================================
// USER MANAGEMENT
// ========================================

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const users = await userService.listCompanyUsers(req.user.companyId);
    res.status(200).json({ users, count: users.length });
  })
);

router.post(
  '/users',
  asyncHandler(async (req, res) => {
    const { email, name, password, role, department, jobTitle, phone } = req.body;

    if (!email || !name || !password) {
      throw new AppError('Email, name, and password are required', 400);
    }

    const user = await userService.createUser({
      email,
      name,
      password,
      role: role || 'user',
      companyId: req.user.companyId,
      department,
      jobTitle,
      phone,
      createdBy: req.user.id,
    });

    res.status(201).json({
      message: 'User created successfully',
      user,
    });
  })
);

router.post(
  '/users/bulk',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const csvText = req.file.buffer.toString('utf-8');
    const lines = csvText.split('\n').filter(line => line.trim());
    const headers = lines[0].split(',').map(h => h.trim());

    const users = lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim());
      const user = {};
      headers.forEach((header, index) => {
        user[header] = values[index];
      });
      return user;
    });

    const result = await userService.bulkCreateUsers(
      users,
      req.user.companyId,
      req.user.id
    );

    res.status(200).json({
      message: 'Bulk user creation completed',
      successful: result.successful.length,
      failed: result.failed.length,
      details: result,
    });
  })
);

router.patch(
  '/users/:email',
  asyncHandler(async (req, res) => {
    const user = await userService.updateUser(req.params.email, req.body);
    res.status(200).json({
      message: 'User updated successfully',
      user,
    });
  })
);

router.post(
  '/users/:email/deactivate',
  asyncHandler(async (req, res) => {
    await userService.deactivateUser(req.params.email);
    res.status(200).json({
      message: 'User deactivated successfully',
    });
  })
);

router.post(
  '/users/:email/activate',
  asyncHandler(async (req, res) => {
    await userService.activateUser(req.params.email);
    res.status(200).json({
      message: 'User activated successfully',
    });
  })
);

// ========================================
// COMPANY SETTINGS
// ========================================

router.get(
  '/company',
  asyncHandler(async (req, res) => {
    const company = await companyService.getCompany(req.user.companyId);
    if (!company) {
      throw new AppError('Company not found', 404);
    }
    res.status(200).json({ company });
  })
);

router.patch(
  '/company',
  asyncHandler(async (req, res) => {
    const company = await companyService.updateCompany(
      req.user.companyId,
      req.body
    );
    res.status(200).json({
      message: 'Company updated successfully',
      company,
    });
  })
);

router.post(
  '/company/logo',
  upload.single('logo'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('No logo file uploaded', 400);
    }

    const { logoUrl, logoS3Key } = await companyService.uploadLogo(
      req.user.companyId,
      req.file
    );

    res.status(200).json({
      message: 'Logo uploaded successfully',
      logoUrl,
      logoS3Key,
    });
  })
);

router.patch(
  '/company/branding',
  asyncHandler(async (req, res) => {
    const { primaryColor, secondaryColor } = req.body;

    const company = await companyService.updateBranding(req.user.companyId, {
      primaryColor,
      secondaryColor,
    });

    res.status(200).json({
      message: 'Branding updated successfully',
      company,
    });
  })
);

router.patch(
  '/company/settings',
  asyncHandler(async (req, res) => {
    const company = await companyService.updateSettings(
      req.user.companyId,
      req.body
    );

    res.status(200).json({
      message: 'Settings updated successfully',
      settings: company.settings,
    });
  })
);

// ========================================
// KNOWLEDGE BASE MANAGEMENT
// ========================================

router.post(
  '/knowledge/bulk-upload',
  upload.array('files', 50),
  asyncHandler(async (req, res) => {
    const files = req.files;
    
    if (!files || files.length === 0) {
      throw new AppError('No files uploaded', 400);
    }

    const { category, tags } = req.body;
    const parsedTags = tags ? JSON.parse(tags) : [];

    const results = {
      successful: [],
      failed: [],
    };

    for (const file of files) {
      try {
        const { key, url } = await s3Service.uploadFile(
          file,
          `knowledge-base/${req.user.companyId}`
        );

        const content = await documentProcessor.processDocument(
          file.buffer,
          file.mimetype
        );

        const cleanedContent = documentProcessor.cleanText(content);

        const document = {
          id: uuidv4(),
          title: file.originalname,
          content: cleanedContent,
          category: category || 'General',
          tags: parsedTags,
          fileKey: key,
          companyId: req.user.companyId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await searchService.indexDocument(document);

        await companyService.updateStorageUsed(
          req.user.companyId,
          file.size
        );

        results.successful.push({
          filename: file.originalname,
          key,
          url,
        });
      } catch (error) {
        results.failed.push({
          filename: file.originalname,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    res.status(200).json({
      message: 'Bulk upload completed',
      successful: results.successful.length,
      failed: results.failed.length,
      results,
    });
  })
);

// ========================================
// ANALYTICS & REPORTING
// ========================================

router.get(
  '/analytics/summary',
  asyncHandler(async (req, res) => {
    const summary = await analyticsService.getCompanySummary(req.user.companyId);
    res.status(200).json({ summary });
  })
);

router.get(
  '/analytics/proposals',
  asyncHandler(async (req, res) => {
    const { status, startDate, endDate } = req.query;

    const analytics = await analyticsService.getDetailedProposalAnalytics(
      req.user.companyId,
      {
        status,
        startDate,
        endDate,
      }
    );

    res.status(200).json({ analytics });
  })
);

router.get(
  '/analytics/export',
  asyncHandler(async (req, res) => {
    const format = req.query.format || 'json';

    const exported = await analyticsService.exportAnalytics(
      req.user.companyId,
      format
    );

    res.status(200).json(exported);
  })
);

// ========================================
// BILLING & USAGE
// ========================================

router.get(
  '/billing/invoices',
  asyncHandler(async (req, res) => {
    const invoices = await billingService.listCompanyInvoices(req.user.companyId);
    res.status(200).json({ invoices });
  })
);

router.get(
  '/billing/usage',
  asyncHandler(async (req, res) => {
    const usage = await companyService.getUsageStats(req.user.companyId);
    res.status(200).json({ usage });
  })
);

router.post(
  '/billing/invoice/:id/pay',
  asyncHandler(async (req, res) => {
    const { paymentMethod } = req.body;

    const invoice = await billingService.markInvoiceAsPaid(
      req.params.id,
      paymentMethod
    );

    res.status(200).json({
      message: 'Invoice marked as paid',
      invoice,
    });
  })
);

// ========================================
// DOCUMENT EXPORT
// ========================================

router.get(
  '/export/proposal/:id',
  asyncHandler(async (req, res) => {
    const format = req.query.format || 'pdf';

    const { url, key } = await documentExportService.exportAndUpload(
      req.params.id,
      format
    );

    res.status(200).json({
      message: 'Proposal exported successfully',
      downloadUrl: url,
      fileKey: key,
      format,
    });
  })
);

export default router;