import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from '../config/aws.config.js';
import { logger } from '../utils/logger.js';

class AnalyticsService {
  async getCompanySummary(companyId) {
    try {
      const [proposals, users, knowledge, aiStats] = await Promise.all([
        this.getProposalStats(companyId),
        this.getUserStats(companyId),
        this.getKnowledgeStats(companyId),
        this.getAIStats(companyId),
      ]);

      return {
        proposals,
        users,
        knowledge,
        ai: aiStats,
        performance: {
          averageResponseTime: 250, // ms (mock)
          successRate: 98.5,        // %
          apiCalls: 15420,
        },
      };
    } catch (error) {
      logger.error('Error getting company summary:', error);
      throw error;
    }
  }

  async getProposalStats(companyId) {
    try {
      const command = new QueryCommand({
        TableName: TABLES.PROPOSALS,
        IndexName: 'CompanyIdIndex',
        KeyConditionExpression: 'companyId = :companyId',
        ExpressionAttributeValues: {
          ':companyId': companyId,
        },
      });

      const { Items = [] } = await docClient.send(command);

      const byStatus = {};
      const byMonth = {};
      let totalCompletionTime = 0;
      let completedCount = 0;

      Items.forEach((proposal) => {
        if (proposal.status) {
          byStatus[proposal.status] = (byStatus[proposal.status] || 0) + 1;
        }

        if (proposal.createdAt) {
          const month = proposal.createdAt.substring(0, 7);
          byMonth[month] = (byMonth[month] || 0) + 1;
        }

        if (proposal.completedAt && proposal.createdAt) {
          const created = new Date(proposal.createdAt).getTime();
          const completed = new Date(proposal.completedAt).getTime();
          totalCompletionTime += (completed - created) / (1000 * 60 * 60);
          completedCount++;
        }
      });

      const byMonthArray = Object.entries(byMonth)
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-12);

      return {
        total: Items.length,
        byStatus,
        byMonth: byMonthArray,
        averageCompletionTime:
          completedCount > 0 ? totalCompletionTime / completedCount : 0,
      };
    } catch (error) {
      logger.error('Error getting proposal stats:', error);
      throw error;
    }
  }

  async getUserStats(companyId) {
    try {
      const command = new QueryCommand({
        TableName: TABLES.USERS,
        IndexName: 'CompanyIdIndex',
        KeyConditionExpression: 'companyId = :companyId',
        ExpressionAttributeValues: {
          ':companyId': companyId,
        },
      });

      const { Items = [] } = await docClient.send(command);

      const byRole = {};
      const byDepartment = {};
      let active = 0;

      Items.forEach((user) => {
        if (user.role) {
          byRole[user.role] = (byRole[user.role] || 0) + 1;
        }

        if (user.department) {
          byDepartment[user.department] =
            (byDepartment[user.department] || 0) + 1;
        }

        if (user.isActive) active++;
      });

      return {
        total: Items.length,
        active,
        byRole,
        byDepartment,
      };
    } catch (error) {
      logger.error('Error getting user stats:', error);
      throw error;
    }
  }

  async getKnowledgeStats(companyId) {
    try {
      const command = new QueryCommand({
        TableName: TABLES.KNOWLEDGE,
        IndexName: 'CompanyIdIndex',
        KeyConditionExpression: 'companyId = :companyId',
        ExpressionAttributeValues: {
          ':companyId': companyId,
        },
      });

      const { Items = [] } = await docClient.send(command);

      const byCategory = {};
      let totalSize = 0;

      Items.forEach((doc) => {
        const category = doc.category || 'Uncategorized';
        byCategory[category] = (byCategory[category] || 0) + 1;
        totalSize += doc.size || 0;
      });

      return {
        totalDocuments: Items.length,
        byCategory,
        totalSize,
      };
    } catch (error) {
      logger.error('Error getting knowledge stats:', error);
      throw error;
    }
  }

  async getAIStats(companyId) {
    try {
      const command = new QueryCommand({
        TableName: TABLES.PROPOSALS,
        IndexName: 'CompanyIdIndex',
        KeyConditionExpression: 'companyId = :companyId',
        ExpressionAttributeValues: {
          ':companyId': companyId,
        },
      });

      const { Items = [] } = await docClient.send(command);

      let totalGenerations = 0;
      let totalConfidence = 0;
      let confidenceCount = 0;
      const categoryCount = {};

      Items.forEach((proposal) => {
        (proposal.questions || []).forEach((q) => {
          if (q.draftAnswer) totalGenerations++;
          if (typeof q.confidence === 'number') {
            totalConfidence += q.confidence;
            confidenceCount++;
          }
          if (q.category) {
            categoryCount[q.category] =
              (categoryCount[q.category] || 0) + 1;
          }
        });
      });

      const topCategories = Object.entries(categoryCount)
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      return {
        totalGenerations,
        averageConfidence:
          confidenceCount > 0 ? totalConfidence / confidenceCount : 0,
        topCategories,
      };
    } catch (error) {
      logger.error('Error getting AI stats:', error);
      throw error;
    }
  }

  async getDetailedProposalAnalytics(companyId, filters = {}) {
    try {
      let filterExpression;
      const values = { ':companyId': companyId };
      const names = {};

      if (filters.status) {
        filterExpression = '#status = :status';
        values[':status'] = filters.status;
        names['#status'] = 'status';
      }

      const command = new QueryCommand({
        TableName: TABLES.PROPOSALS,
        IndexName: 'CompanyIdIndex',
        KeyConditionExpression: 'companyId = :companyId',
        FilterExpression: filterExpression,
        ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
        ExpressionAttributeValues: values,
      });

      const { Items = [] } = await docClient.send(command);

      return Items.map((proposal) => {
        const questions = proposal.questions || [];

        const completionTime =
          proposal.completedAt && proposal.createdAt
            ? (new Date(proposal.completedAt) -
                new Date(proposal.createdAt)) /
              (1000 * 60 * 60)
            : null;

        return {
          id: proposal.id,
          title: proposal.title,
          clientName: proposal.clientName,
          createdAt: proposal.createdAt,
          completedAt: proposal.completedAt,
          status: proposal.status,
          questionCount: questions.length,
          approvedAnswers: questions.filter(q => q.status === 'approved').length,
          aiGeneratedAnswers: questions.filter(q => q.draftAnswer).length,
          humanEditedAnswers: questions.filter(
            q => q.finalAnswer && q.finalAnswer !== q.draftAnswer
          ).length,
          completionTime,
          assignedTo: proposal.assignedTo,
        };
      });
    } catch (error) {
      logger.error('Error getting detailed proposal analytics:', error);
      throw error;
    }
  }

  async exportAnalytics(companyId) {
    try {
      const summary = await this.getCompanySummary(companyId);
      const detailedProposals =
        await this.getDetailedProposalAnalytics(companyId);

      return {
        data: {
          summary,
          detailedProposals,
          generatedAt: new Date().toISOString(),
        },
        filename: `analytics-${companyId}-${Date.now()}.json`,
      };
    } catch (error) {
      logger.error('Error exporting analytics:', error);
      throw error;
    }
  }
}

export const analyticsService = new AnalyticsService();
