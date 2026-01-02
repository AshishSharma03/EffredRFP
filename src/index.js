import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import routes
import authRoutes from './routes/auth.routes.js';
import adminRoutes from './routes/admin.routes.js';
import superadminRoutes from './routes/superadmin.routes.js';
import userRoutes from './routes/user.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import proposalRoutes from './routes/proposal.routes.js';
import aiRoutes from './routes/ai.routes.js';
import knowledgeRoutes from './routes/knowledge.routes.js';

// Import middleware
import { errorHandler } from './middleware/error.middleware.js';

// Import email verification (optional)
import { verifyEmailConfig } from './utils/email.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version: '2.0.0',
  });
});

// API Documentation
app.get('/api-docs', (req, res) => {
  res.json({
    message: 'Effred RFP API Documentation',
    version: '2.0.0',
    endpoints: {
      authentication: {
        'POST /api/v1/auth/register': 'Register new user',
        'POST /api/v1/auth/login': 'Login',
        'POST /api/v1/auth/forgot-password': 'Request password reset',
        'POST /api/v1/auth/reset-password': 'Reset password with token',
      },
      superadmin: {
        'GET /api/v1/superadmin/companies': 'List all companies',
        'POST /api/v1/superadmin/companies': 'Create company',
        'POST /api/v1/superadmin/companies/:id/deactivate': 'Deactivate company',
        'POST /api/v1/superadmin/companies/:id/activate': 'Activate company',
        'PATCH /api/v1/superadmin/companies/:id/limits': 'Update company limits',
        'GET /api/v1/superadmin/companies/:id/usage': 'Get company usage',
        'POST /api/v1/superadmin/company-admins': 'Create company admin',
        'POST /api/v1/superadmin/company-admins/:id/enable-login': 'Enable admin login',
        'POST /api/v1/superadmin/company-admins/:id/disable-login': 'Disable admin login',
        'POST /api/v1/superadmin/company-admins/:id/reset-password': 'Reset admin password',
        'GET /api/v1/superadmin/search': 'Search companies/admins',
      },
      admin: {
        'POST /api/v1/admin/users': 'Create user',
        'GET /api/v1/admin/users': 'List users',
        'POST /api/v1/admin/users/:id/reset-password': 'Reset user password',
        'POST /api/v1/admin/users/:id/disable-login': 'Disable user login',
        'POST /api/v1/admin/users/:id/enable-login': 'Enable user login',
        'GET /api/v1/admin/usage/summary': 'Get usage summary',
        'POST /api/v1/admin/logo': 'Upload company logo',
        'POST /api/v1/admin/rfp/bulk-upload': 'Bulk upload RFPs',
        'POST /api/v1/admin/search-qa': 'AI-powered Q&A search',
        'POST /api/v1/admin/export': 'Export data',
      },
      user: {
        'GET /api/v1/user/profile': 'Get own profile',
        'PATCH /api/v1/user/profile': 'Update own profile',
        'GET /api/v1/user/company-admin-contact': 'Get admin contact',
        'POST /api/v1/user/upload-rfp': 'Upload RFP',
        'POST /api/v1/user/search-qa': 'Search Q&A',
        'GET /api/v1/user/usage': 'Get own usage',
        'POST /api/v1/user/export': 'Export data',
      },
      upload: {
        'POST /api/v1/upload/rfp': 'Upload RFP document',
        'POST /api/v1/upload/knowledge': 'Upload knowledge document',
        'POST /api/v1/upload/attachment': 'Upload attachment',
      },
      proposals: {
        'GET /api/v1/proposals': 'List proposals',
        'GET /api/v1/proposals/:id': 'Get proposal',
        'PATCH /api/v1/proposals/:id': 'Update proposal',
        'PUT /api/v1/proposals/:id/questions/:questionId/answer': 'Update answer',
        'DELETE /api/v1/proposals/:id': 'Delete proposal',
      },
      ai: {
        'POST /api/v1/ai/generate-answer': 'Generate answer',
        'POST /api/v1/ai/improve-answer': 'Improve answer',
        'POST /api/v1/ai/generate-summary': 'Generate summary',
        'POST /api/v1/ai/bulk-generate': 'Bulk generate answers',
      },
      knowledge: {
        'POST /api/v1/knowledge/search': 'Search knowledge base',
        'GET /api/v1/knowledge': 'List knowledge documents',
        'GET /api/v1/knowledge/:id': 'Get knowledge document',
        'POST /api/v1/knowledge': 'Create knowledge document',
        'PUT /api/v1/knowledge/:id': 'Update knowledge document',
        'DELETE /api/v1/knowledge/:id': 'Delete knowledge document',
      },
    },
  });
});

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/superadmin', superadminRoutes);
app.use('/api/v1/user', userRoutes);
app.use('/api/v1/upload', uploadRoutes);
app.use('/api/v1/proposals', proposalRoutes);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/knowledge', knowledgeRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.path,
    method: req.method,
  });
});

// Error handler (must be last)
app.use(errorHandler);

// Verify email configuration on startup
verifyEmailConfig().catch(err => {
  console.warn('⚠️  Email service not configured:', err.message);
});

// Start server
// const PORT = process.env.PORT || 3001;
// app.listen(PORT, () => {
//   console.log('═══════════════════════════════════════════════');
//   console.log('   🚀 Effred RFP Backend Server');
//   console.log('═══════════════════════════════════════════════');
//   console.log(`📡 Server: http://localhost:${PORT}`);
//   console.log(`📚 API Docs: http://localhost:${PORT}/api-docs`);
//   console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
//   console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
//   console.log(`📍 Region: ${process.env.AWS_REGION}`);
//   console.log('═══════════════════════════════════════════════');
//   console.log('');
//   console.log('✅ All routes loaded:');
//   console.log('   → Authentication');
//   console.log('   → SuperAdmin Management');
//   console.log('   → Company Admin');
//   console.log('   → User Portal');
//   console.log('   → File Upload');
//   console.log('   → Proposals');
//   console.log('   → AI Services');
//   console.log('   → Knowledge Base');
//   console.log('');
//   console.log('🔐 Create SuperAdmin: node scripts/create-superadmin.js');
//   console.log('');
// });

export default app;