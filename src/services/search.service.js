import {
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from '../config/aws.config.js';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { logger } from '../utils/logger.js';

class UserService {
  async createUser(data) {
    try {
      const existingUser = await this.getUserByEmail(data.email);
      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      const hashedPassword = await bcrypt.hash(data.password, 10);

      const user = {
        id: uuidv4(),
        email: data.email,
        name: data.name,
        password: hashedPassword,
        role: data.role,
        companyId: data.companyId,
        department: data.department,
        jobTitle: data.jobTitle,
        phone: data.phone,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: data.createdBy,
      };

      const command = new PutCommand({
        TableName: TABLES.USERS,
        Item: user,
      });

      await docClient.send(command);
      logger.info(`User created: ${user.id}`);

      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    } catch (error) {
      logger.error('Error creating user:', error);
      throw error;
    }
  }

  async getUserByEmail(email) {
    try {
      const command = new GetCommand({
        TableName: TABLES.USERS,
        Key: { email },
      });

      const response = await docClient.send(command);
      return response.Item || null;
    } catch (error) {
      logger.error('Error getting user by email:', error);
      throw error;
    }
  }

  async getUserById(id) {
    try {
      const command = new QueryCommand({
        TableName: TABLES.USERS,
        IndexName: 'UserIdIndex',
        KeyConditionExpression: 'id = :id',
        ExpressionAttributeValues: {
          ':id': id,
        },
      });

      const response = await docClient.send(command);
      return response.Items?.[0] || null;
    } catch (error) {
      logger.error('Error getting user by ID:', error);
      throw error;
    }
  }

  async listCompanyUsers(companyId) {
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

      return users.map(({ password, ...user }) => user);
    } catch (error) {
      logger.error('Error listing company users:', error);
      throw error;
    }
  }

  async updateUser(email, updates) {
    try {
      const updateExpressions = [];
      const expressionAttributeNames = {};
      const expressionAttributeValues = {};

      if (updates.password) {
        updates.password = await bcrypt.hash(updates.password, 10);
      }

      Object.entries(updates).forEach(([key, value], index) => {
        if (key !== 'email' && key !== 'createdAt') {
          updateExpressions.push(`#attr${index} = :val${index}`);
          expressionAttributeNames[`#attr${index}`] = key;
          expressionAttributeValues[`:val${index}`] = value;
        }
      });

      updateExpressions.push('#updatedAt = :updatedAt');
      expressionAttributeNames['#updatedAt'] = 'updatedAt';
      expressionAttributeValues[':updatedAt'] = new Date().toISOString();

      const command = new UpdateCommand({
        TableName: TABLES.USERS,
        Key: { email },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      });

      const response = await docClient.send(command);
      logger.info(`User updated: ${email}`);

      const { password, ...userWithoutPassword } = response.Attributes;
      return userWithoutPassword;
    } catch (error) {
      logger.error('Error updating user:', error);
      throw error;
    }
  }

  async deleteUser(email) {
    try {
      const command = new DeleteCommand({
        TableName: TABLES.USERS,
        Key: { email },
      });

      await docClient.send(command);
      logger.info(`User deleted: ${email}`);
    } catch (error) {
      logger.error('Error deleting user:', error);
      throw error;
    }
  }

  async deactivateUser(email) {
    try {
      await this.updateUser(email, { isActive: false });
      logger.info(`User deactivated: ${email}`);
    } catch (error) {
      logger.error('Error deactivating user:', error);
      throw error;
    }
  }

  async activateUser(email) {
    try {
      await this.updateUser(email, { isActive: true });
      logger.info(`User activated: ${email}`);
    } catch (error) {
      logger.error('Error activating user:', error);
      throw error;
    }
  }

  async validateCredentials(email, password) {
    try {
      const user = await this.getUserByEmail(email);
      if (!user || !user.isActive) {
        return null;
      }

      const isValid = await bcrypt.compare(password, user.password);
      return isValid ? user : null;
    } catch (error) {
      logger.error('Error validating credentials:', error);
      throw error;
    }
  }

  async bulkCreateUsers(users, companyId, createdBy) {
    const successful = [];
    const failed = [];

    const defaultPassword = 'ChangeMe@123';

    for (const userData of users) {
      try {
        const user = await this.createUser({
          ...userData,
          password: defaultPassword,
          companyId,
          createdBy,
        });
        successful.push(user);
      } catch (error) {
        failed.push({
          email: userData.email,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info(
      `Bulk user creation: ${successful.length} successful, ${failed.length} failed`
    );

    return { successful, failed };
  }
}

export const userService = new UserService();