import { PutCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from '../config/aws.config.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

class BillingService {
  constructor() {
    this.planPricing = {
      free: 0,
      starter: 49,
      professional: 149,
      enterprise: 499,
    };
  }

  async createInvoice(data) {
    try {
      const baseAmount = this.planPricing[data.planType] || 0;
      
      const lineItems = [
        {
          description: `${data.planType.charAt(0).toUpperCase() + data.planType.slice(1)} Plan`,
          quantity: 1,
          unitPrice: baseAmount,
          amount: baseAmount,
        },
      ];

      if (data.additionalCharges) {
        data.additionalCharges.forEach(charge => {
          lineItems.push({
            description: charge.description,
            quantity: 1,
            unitPrice: charge.amount,
            amount: charge.amount,
          });
        });
      }

      const totalAmount = lineItems.reduce((sum, item) => sum + item.amount, 0);

      const invoice = {
        id: uuidv4(),
        companyId: data.companyId,
        invoiceNumber: this.generateInvoiceNumber(),
        amount: totalAmount,
        currency: 'USD',
        status: 'pending',
        billingPeriodStart: data.billingPeriodStart,
        billingPeriodEnd: data.billingPeriodEnd,
        dueDate: this.calculateDueDate(data.billingPeriodEnd),
        lineItems,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const command = new PutCommand({
        TableName: TABLES.INVOICES,
        Item: invoice,
      });

      await docClient.send(command);
      logger.info(`Invoice created: ${invoice.id}`);

      return invoice;
    } catch (error) {
      logger.error('Error creating invoice:', error);
      throw error;
    }
  }

  async getInvoice(id) {
    try {
      const command = new GetCommand({
        TableName: TABLES.INVOICES,
        Key: { id },
      });

      const response = await docClient.send(command);
      return response.Item || null;
    } catch (error) {
      logger.error('Error getting invoice:', error);
      throw error;
    }
  }

  async listCompanyInvoices(companyId, limit = 50) {
    try {
      const command = new QueryCommand({
        TableName: TABLES.INVOICES,
        IndexName: 'CompanyIdIndex',
        KeyConditionExpression: 'companyId = :companyId',
        ExpressionAttributeValues: {
          ':companyId': companyId,
        },
        ScanIndexForward: false,
        Limit: limit,
      });

      const response = await docClient.send(command);
      return response.Items || [];
    } catch (error) {
      logger.error('Error listing company invoices:', error);
      throw error;
    }
  }

  async markInvoiceAsPaid(invoiceId, paymentMethod) {
    try {
      const command = new UpdateCommand({
        TableName: TABLES.INVOICES,
        Key: { id: invoiceId },
        UpdateExpression: 'SET #status = :status, #paidDate = :paidDate, #paymentMethod = :paymentMethod, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#paidDate': 'paidDate',
          '#paymentMethod': 'paymentMethod',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':status': 'paid',
          ':paidDate': new Date().toISOString(),
          ':paymentMethod': paymentMethod,
          ':updatedAt': new Date().toISOString(),
        },
        ReturnValues: 'ALL_NEW',
      });

      const response = await docClient.send(command);
      logger.info(`Invoice marked as paid: ${invoiceId}`);

      return response.Attributes;
    } catch (error) {
      logger.error('Error marking invoice as paid:', error);
      throw error;
    }
  }

  generateInvoiceNumber() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `INV-${year}${month}-${random}`;
  }

  calculateDueDate(billingPeriodEnd) {
    const endDate = new Date(billingPeriodEnd);
    endDate.setDate(endDate.getDate() + 15);
    return endDate.toISOString();
  }
}

export const billingService = new BillingService();