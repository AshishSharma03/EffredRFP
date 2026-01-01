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
          averageResponseTime: 250,
          successRate: 98.5,
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

      const response = await docClient.send(command);
      const proposals = response.Items || [];

      const byStatus = {};
      const byMonth = {};
      let totalCompletionTime = 0;
      let completedCount = 0;

      proposals.forEach((proposal) => {
        byStatus[proposal.status] = (byStatus[proposal.status] || 0) + 1;

        const month = proposal.createdAt.substring(0, 7);
        byMonth[month] = (byMonth[month] || 0) + 1;

        if (proposal.completedAt) {
          const created = new Date(proposal.createdAt).getTime();
          const completed = new Date(proposal.completedAt).getTime();
          const hours = (completed - created) / (1000 * 60 * 60);
          totalCompletionTime += hours;
          completedCount++;
        }
      });

      const byMonthArray = Object.entries(byMonth)
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-12);

      return {
        total: proposals.length,
        byStatus,
        byMonth: byMonthArray,
        averageCompletionTime: completedCount > 0 ? totalCompletionTime / completedCount : 0,
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

      const response = await docClient.send(command);
      const users = response.Items || [];

      const byRole = {};
      const byDepartment = {};
      let activeCount = 0;

      users.forEach((user) => {
        byRole[user.role] = (byRole[user.role] || 0) + 1;
        
        if (user.department) {
          byDepartment[user.department] = (byDepartment[user.department] || 0) + 1;
        }
        
        if (user.isActive) {
          activeCount++;
        }
      });

      return {
        total: users.length,
        active: activeCount,
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

      const response = await docClient.send(command);
      const documents = response.Items || [];

      const byCategory = {};
      let totalSize = 0;

      documents.forEach((doc) => {
        byCategory[doc.category] = (byCategory[doc.category] || 0) + 1;
        totalSize += doc.size || 0;
      });

      return {
        totalDocuments: documents.length,
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
      const proposalsCommand = new QueryCommand({
        TableName: TABLES.PROPOSALS,
        IndexName: 'CompanyIdIndex',
        KeyConditionExpression: 'companyId = :companyId',
        ExpressionAttributeValues: {
          ':companyId': companyId,
        },
      });

      const proposalsResponse = await docClient.send(proposalsCommand);
      const proposals = proposalsResponse.Items || [];

      let totalGenerations = 0;
      let totalConfidence = 0;
      let confidenceCount = 0;
      const categoryCount = {};

      proposals.forEach((proposal) => {
        if (proposal.questions) {
          proposal.questions.forEach((q) => {
            if (q.draftAnswer) totalGenerations++;
            if (q.confidence) {
              totalConfidence += q.confidence;
              confidenceCount++;
            }
            if (q.category) {
              categoryCount[q.category] = (categoryCount[q.category] || 0) + 1;
            }
          });
        }
      });

      const topCategories = Object.entries(categoryCount)
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      return {
        totalGenerations,
        averageConfidence: confidenceCount > 0 ? totalConfidence / confidenceCount : 0,
        topCategories,
      };
    } catch (error) {
      logger.error('Error getting AI stats:', error);
      throw error;
    }
  }

  async getDetailedProposalAnalytics(companyId, filters = {}) {
    try {
      let filterExpression = '';
      const expressionAttributeValues = {
        ':companyId': companyId,
      };

      if (filters.status) {
        filterExpression = '#status = :status';
        expressionAttributeValues[':status'] = filters.status;
      }

      const command = new QueryCommand({
        TableName: TABLES.PROPOSALS,
        IndexName: 'CompanyIdIndex',
        KeyConditionExpression: 'companyId = :companyId',
        FilterExpression: filterExpression || undefined,
        ExpressionAttributeNames: filterExpression ? { '#status': 'status' } : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
      });

      const response = await docClient.send(command);
      const proposals = response.Items || [];

      return proposals.map((proposal) => {
        const questionCount = proposal.questions?.length || 0;
        const approvedAnswers = proposal.questions?.filter(q => q.status === 'approved').length || 0;
        const aiGeneratedAnswers = proposal.questions?.filter(q => q.draftAnswer).length || 0;
        const humanEditedAnswers = proposal.questions?.filter(
          q => q.finalAnswer && q.finalAnswer !== q.draftAnswer
        ).length || 0;

        let completionTime;
        if (proposal.completedAt) {
          const created = new Date(proposal.createdAt).getTime();
          const completed = new Date(proposal.completedAt).getTime();
          completionTime = (completed - created) / (1000 * 60 * 60);
        }

        return {
          id: proposal.id,
          title: proposal.title,
          clientName: proposal.clientName,
          createdAt: proposal.createdAt,
          completedAt: proposal.completedAt,
          status: proposal.status,
          questionCount,
          approvedAnswers,
          aiGeneratedAnswers,
          humanEditedAnswers,
          completionTime,
          assignedTo: proposal.assignedTo,
        };
      });
    } catch (error) {
      logger.error('Error getting detailed proposal analytics:', error);
      throw error;
    }
  }

  async exportAnalytics(companyId, format) {
    try {
      const summary = await this.getCompanySummary(companyId);
      const detailedProposals = await this.getDetailedProposalAnalytics(companyId);

      const data = {
        summary,
        detailedProposals,
        generatedAt: new Date().toISOString(),
      };

      const filename = nalytics--.;

      return {
        data,
        filename,
      };
    } catch (error) {
      logger.error('Error exporting analytics:', error);
      throw error;
    }
  }
}

export const analyticsService = new AnalyticsService();
