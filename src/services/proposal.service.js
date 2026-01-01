import {
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from '../config/aws.config.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

class ProposalService {
  async createProposal(data) {
    try {
      const proposal = {
        id: uuidv4(),
        userId: data.userId,
        title: data.title,
        clientName: data.clientName,
        rfpFileKey: data.rfpFileKey,
        status: 'draft',
        questions: data.questions || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const command = new PutCommand({
        TableName: TABLES.PROPOSALS,
        Item: proposal,
      });

      await docClient.send(command);
      logger.info(`Proposal created: ${proposal.id}`);

      return proposal;
    } catch (error) {
      logger.error('Error creating proposal:', error);
      throw error;
    }
  }

  async getProposal(id) {
    try {
      const command = new GetCommand({
        TableName: TABLES.PROPOSALS,
        Key: { id },
      });

      const response = await docClient.send(command);
      return response.Item || null;
    } catch (error) {
      logger.error('Error getting proposal:', error);
      throw error;
    }
  }

  async updateProposal(id, updates) {
    try {
      const updateExpressions = [];
      const expressionAttributeNames = {};
      const expressionAttributeValues = {};

      Object.entries(updates).forEach(([key, value], index) => {
        if (key !== 'id' && key !== 'userId' && key !== 'createdAt') {
          updateExpressions.push(`#attr${index} = :val${index}`);
          expressionAttributeNames[`#attr${index}`] = key;
          expressionAttributeValues[`:val${index}`] = value;
        }
      });

      updateExpressions.push('#updatedAt = :updatedAt');
      expressionAttributeNames['#updatedAt'] = 'updatedAt';
      expressionAttributeValues[':updatedAt'] = new Date().toISOString();

      const command = new UpdateCommand({
        TableName: TABLES.PROPOSALS,
        Key: { id },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      });

      const response = await docClient.send(command);
      logger.info(`Proposal updated: ${id}`);

      return response.Attributes;
    } catch (error) {
      logger.error('Error updating proposal:', error);
      throw error;
    }
  }

  async deleteProposal(id) {
    try {
      const command = new DeleteCommand({
        TableName: TABLES.PROPOSALS,
        Key: { id },
      });

      await docClient.send(command);
      logger.info(`Proposal deleted: ${id}`);
    } catch (error) {
      logger.error('Error deleting proposal:', error);
      throw error;
    }
  }

  async listUserProposals(userId) {
    try {
      const command = new QueryCommand({
        TableName: TABLES.PROPOSALS,
        IndexName: 'UserIdIndex',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
      });

      const response = await docClient.send(command);
      return response.Items || [];
    } catch (error) {
      logger.error('Error listing user proposals:', error);
      throw error;
    }
  }

  async updateQuestionAnswer(proposalId, questionId, answer, status) {
    try {
      const proposal = await this.getProposal(proposalId);
      if (!proposal) {
        throw new Error('Proposal not found');
      }

      const updatedQuestions = proposal.questions.map(q => {
        if (q.id === questionId) {
          return {
            ...q,
            finalAnswer: answer,
            status,
          };
        }
        return q;
      });

      return await this.updateProposal(proposalId, {
        questions: updatedQuestions,
      });
    } catch (error) {
      logger.error('Error updating question answer:', error);
      throw error;
    }
  }
}

export const proposalService = new ProposalService();