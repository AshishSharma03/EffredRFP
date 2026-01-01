import {
  PutCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from '../config/aws.config.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { s3Service } from './s3.service.js';

class CompanyService {
  constructor() {
    this.planPricing = {
      free: { limit: 5, name: 'Free' },
      starter: { limit: 25, name: 'Starter' },
      professional: { limit: 100, name: 'Professional' },
      enterprise: { limit: 999999, name: 'Enterprise' },
    };
  }

  async createCompany(data) {
    try {
      const company = {
        id: uuidv4(),
        name: data.name,
        email: data.email,
        phone: data.phone,
        website: data.website,
        address: data.address,
        industry: data.industry,
        planType: data.planType || 'free',
        subscriptionStatus: 'trial',
        monthlyProposalLimit: this.getProposalLimit(data.planType || 'free'),
        monthlyProposalsUsed: 0,
        totalProposalsCreated: 0,
        totalStorageUsed: 0,
        settings: {
          allowBulkUpload: true,
          maxFileSize: 10,
          allowedFileTypes: [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
          ],
          enableAnalytics: true,
          requireApproval: true,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const command = new PutCommand({
        TableName: TABLES.COMPANIES,
        Item: company,
      });

      await docClient.send(command);
      logger.info(`Company created: ${company.id}`);

      return company;
    } catch (error) {
      logger.error('Error creating company:', error);
      throw error;
    }
  }

  async getCompany(id) {
    try {
      const command = new GetCommand({
        TableName: TABLES.COMPANIES,
        Key: { id },
      });

      const response = await docClient.send(command);
      return response.Item || null;
    } catch (error) {
      logger.error('Error getting company:', error);
      throw error;
    }
  }

  async updateCompany(id, updates) {
    try {
      const updateExpressions = [];
      const expressionAttributeNames = {};
      const expressionAttributeValues = {};

      Object.entries(updates).forEach(([key, value], index) => {
        if (key !== 'id' && key !== 'createdAt') {
          updateExpressions.push(`#attr${index} = :val${index}`);
          expressionAttributeNames[`#attr${index}`] = key;
          expressionAttributeValues[`:val${index}`] = value;
        }
      });

      updateExpressions.push('#updatedAt = :updatedAt');
      expressionAttributeNames['#updatedAt'] = 'updatedAt';
      expressionAttributeValues[':updatedAt'] = new Date().toISOString();

      const command = new UpdateCommand({
        TableName: TABLES.COMPANIES,
        Key: { id },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      });

      const response = await docClient.send(command);
      logger.info(`Company updated: ${id}`);

      return response.Attributes;
    } catch (error) {
      logger.error('Error updating company:', error);
      throw error;
    }
  }

  async uploadLogo(companyId, file) {
    try {
      const { key, url } = await s3Service.uploadFile(
        file,
        `companies/${companyId}/logos`
      );

      await this.updateCompany(companyId, {
        logoUrl: url,
        logoS3Key: key,
      });

      logger.info(`Company logo uploaded: ${companyId}`);

      return { logoUrl: url, logoS3Key: key };
    } catch (error) {
      logger.error('Error uploading company logo:', error);
      throw error;
    }
  }

  async updateBranding(companyId, branding) {
    try {
      return await this.updateCompany(companyId, branding);
    } catch (error) {
      logger.error('Error updating company branding:', error);
      throw error;
    }
  }

  async updateSettings(companyId, settings) {
    try {
      const company = await this.getCompany(companyId);
      if (!company) {
        throw new Error('Company not found');
      }

      const updatedSettings = {
        ...company.settings,
        ...settings,
      };

      return await this.updateCompany(companyId, { settings: updatedSettings });
    } catch (error) {
      logger.error('Error updating company settings:', error);
      throw error;
    }
  }

  async incrementProposalCount(companyId) {
    try {
      const company = await this.getCompany(companyId);
      if (!company) {
        throw new Error('Company not found');
      }

      if (company.monthlyProposalsUsed >= company.monthlyProposalLimit) {
        throw new Error('Monthly proposal limit reached. Please upgrade your plan.');
      }

      await this.updateCompany(companyId, {
        monthlyProposalsUsed: company.monthlyProposalsUsed + 1,
        totalProposalsCreated: company.totalProposalsCreated + 1,
      });
    } catch (error) {
      logger.error('Error incrementing proposal count:', error);
      throw error;
    }
  }

  async updateStorageUsed(companyId, bytes) {
    try {
      const company = await this.getCompany(companyId);
      if (!company) {
        throw new Error('Company not found');
      }

      await this.updateCompany(companyId, {
        totalStorageUsed: company.totalStorageUsed + bytes,
      });
    } catch (error) {
      logger.error('Error updating storage used:', error);
      throw error;
    }
  }

  async resetMonthlyUsage(companyId) {
    try {
      await this.updateCompany(companyId, {
        monthlyProposalsUsed: 0,
      });
      logger.info(`Monthly usage reset for company: ${companyId}`);
    } catch (error) {
      logger.error('Error resetting monthly usage:', error);
      throw error;
    }
  }

  getProposalLimit(planType) {
    return this.planPricing[planType]?.limit || 5;
  }

  async getUsageStats(companyId) {
    try {
      const company = await this.getCompany(companyId);
      if (!company) {
        throw new Error('Company not found');
      }

      return {
        proposals: {
          monthly: company.monthlyProposalsUsed,
          total: company.totalProposalsCreated,
          limit: company.monthlyProposalLimit,
          remaining: company.monthlyProposalLimit - company.monthlyProposalsUsed,
        },
        storage: {
          used: company.totalStorageUsed,
          usedMB: company.totalStorageUsed / (1024 * 1024),
          usedGB: company.totalStorageUsed / (1024 * 1024 * 1024),
        },
        plan: {
          type: company.planType,
          status: company.subscriptionStatus,
        },
      };
    } catch (error) {
      logger.error('Error getting usage stats:', error);
      throw error;
    }
  }
}

export const companyService = new CompanyService();