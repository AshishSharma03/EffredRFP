import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, BUCKETS } from '../config/aws.config.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

class S3Service {
  async uploadFile(
    file,
    folder = 'uploads',
    bucket = BUCKETS.DOCUMENTS
  ) {
    try {
      const fileExtension = file.originalname.split('.').pop();
      const key = `${folder}/${uuidv4()}.${fileExtension}`;

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: {
          originalName: file.originalname,
          uploadedAt: new Date().toISOString(),
        },
      });

      await s3Client.send(command);

      logger.info(`File uploaded to S3: ${key}`);

      return {
        key,
        url: `https://${bucket}.s3.amazonaws.com/${key}`,
      };
    } catch (error) {
      logger.error('Error uploading file to S3:', error);
      throw error;
    }
  }

  async getSignedUrl(
    key,
    bucket = BUCKETS.DOCUMENTS,
    expiresIn = 3600
  ) {
    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      return await getSignedUrl(s3Client, command, { expiresIn });
    } catch (error) {
      logger.error('Error generating signed URL:', error);
      throw error;
    }
  }

  async getFileBuffer(
    key,
    bucket = BUCKETS.DOCUMENTS
  ) {
    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      const response = await s3Client.send(command);
      const stream = response.Body;

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      return Buffer.concat(chunks);
    } catch (error) {
      logger.error('Error getting file from S3:', error);
      throw error;
    }
  }

  async deleteFile(
    key,
    bucket = BUCKETS.DOCUMENTS
  ) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      await s3Client.send(command);
      logger.info(`File deleted from S3: ${key}`);
    } catch (error) {
      logger.error('Error deleting file from S3:', error);
      throw error;
    }
  }

  async fileExists(
    key,
    bucket = BUCKETS.DOCUMENTS
  ) {
    try {
      const command = new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      await s3Client.send(command);
      return true;
    } catch {
      return false;
    }
  }
}

export const s3Service = new S3Service();
