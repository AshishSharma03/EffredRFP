import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../config/aws.config.js';

/**
 * Extract text from PDF buffer
 * @param {Buffer} buffer - PDF file buffer
 * @returns {Promise<string>} Extracted text
 */
export const extractTextFromPDF = async (buffer) => {
  try {
    const data = await pdf(buffer);
    return data.text;
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw new Error('Failed to extract text from PDF');
  }
};

/**
 * Extract text from DOCX buffer
 * @param {Buffer} buffer - DOCX file buffer
 * @returns {Promise<string>} Extracted text
 */
export const extractTextFromDocx = async (buffer) => {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    console.error('Error extracting text from DOCX:', error);
    throw new Error('Failed to extract text from DOCX');
  }
};

/**
 * Extract text from file based on mime type
 * @param {Buffer} buffer - File buffer
 * @param {string} mimeType - File mime type
 * @returns {Promise<string>} Extracted text
 */
export const extractTextFromFile = async (buffer, mimeType) => {
  if (mimeType === 'application/pdf') {
    return await extractTextFromPDF(buffer);
  } else if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  ) {
    return await extractTextFromDocx(buffer);
  } else if (mimeType === 'text/plain') {
    return buffer.toString('utf-8');
  } else {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }
};

/**
 * Extract text from S3 file
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @param {string} mimeType - File mime type
 * @returns {Promise<string>} Extracted text
 */
export const extractTextFromS3File = async (bucket, key, mimeType) => {
  try {
    // Get file from S3
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await s3Client.send(command);
    const buffer = Buffer.from(await response.Body.transformToByteArray());

    // Extract text based on mime type
    return await extractTextFromFile(buffer, mimeType);
  } catch (error) {
    console.error('Error extracting text from S3 file:', error);
    throw new Error('Failed to extract text from S3 file');
  }
};

/**
 * Extract questions from RFP text using simple pattern matching
 * @param {string} text - RFP document text
 * @returns {Array<Object>} Array of extracted questions
 */
export const extractQuestionsFromText = (text) => {
  const questions = [];
  const lines = text.split('\n');
  
  let questionNumber = 0;
  let currentSection = 'General';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!line) continue;

    // Detect section headers (all caps or ends with colon)
    if (line === line.toUpperCase() && line.length > 3 && line.length < 50) {
      currentSection = line;
      continue;
    }

    // Detect questions (starts with number, bullet, or ends with ?)
    const isQuestion = 
      /^\d+[\.)]\s/.test(line) || // 1. or 1)
      /^[a-z][\.)]\s/i.test(line) || // a. or a)
      /^[•\-\*]\s/.test(line) || // bullet points
      line.endsWith('?'); // ends with question mark

    if (isQuestion) {
      questionNumber++;
      
      // Clean the question text
      let questionText = line
        .replace(/^\d+[\.)]\s*/, '') // Remove numbering
        .replace(/^[a-z][\.)]\s*/i, '') // Remove letter numbering
        .replace(/^[•\-\*]\s*/, '') // Remove bullets
        .trim();

      // Skip if too short or too long
      if (questionText.length < 10 || questionText.length > 500) continue;

      questions.push({
        id: `q${questionNumber}`,
        question: questionText,
        section: currentSection,
        category: categorizQuestion(questionText),
        status: 'pending',
        draftAnswer: null,
        finalAnswer: null,
        confidence: null,
        sources: [],
      });
    }
  }

  return questions;
};

/**
 * Categorize question based on keywords
 * @param {string} question - Question text
 * @returns {string} Category
 */
const categorizQuestion = (question) => {
  const lowerQuestion = question.toLowerCase();

  if (
    lowerQuestion.includes('price') ||
    lowerQuestion.includes('cost') ||
    lowerQuestion.includes('budget') ||
    lowerQuestion.includes('payment')
  ) {
    return 'pricing';
  } else if (
    lowerQuestion.includes('technical') ||
    lowerQuestion.includes('technology') ||
    lowerQuestion.includes('architecture') ||
    lowerQuestion.includes('integration')
  ) {
    return 'technical';
  } else if (
    lowerQuestion.includes('timeline') ||
    lowerQuestion.includes('schedule') ||
    lowerQuestion.includes('delivery') ||
    lowerQuestion.includes('deadline')
  ) {
    return 'timeline';
  } else if (
    lowerQuestion.includes('experience') ||
    lowerQuestion.includes('qualification') ||
    lowerQuestion.includes('reference') ||
    lowerQuestion.includes('portfolio')
  ) {
    return 'experience';
  } else if (
    lowerQuestion.includes('security') ||
    lowerQuestion.includes('compliance') ||
    lowerQuestion.includes('privacy') ||
    lowerQuestion.includes('gdpr')
  ) {
    return 'security';
  } else if (
    lowerQuestion.includes('support') ||
    lowerQuestion.includes('maintenance') ||
    lowerQuestion.includes('warranty') ||
    lowerQuestion.includes('sla')
  ) {
    return 'support';
  } else {
    return 'general';
  }
};

/**
 * Split document into chunks for processing
 * @param {string} text - Document text
 * @param {number} chunkSize - Size of each chunk in characters
 * @returns {Array<string>} Array of text chunks
 */
export const chunkText = (text, chunkSize = 2000) => {
  const chunks = [];
  const sentences = text.split(/[.!?]+/).filter(s => s.trim());
  
  let currentChunk = '';
  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > chunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = sentence;
    } else {
      currentChunk += sentence + '. ';
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
};

/**
 * Clean and normalize text
 * @param {string} text - Raw text
 * @returns {string} Cleaned text
 */
export const cleanText = (text) => {
  return text
    .replace(/\r\n/g, '\n') // Normalize line endings
    .replace(/\n{3,}/g, '\n\n') // Remove excessive newlines
    .replace(/\s{2,}/g, ' ') // Remove excessive spaces
    .replace(/[^\S\n]+/g, ' ') // Normalize whitespace
    .trim();
};

export default {
  extractTextFromPDF,
  extractTextFromDocx,
  extractTextFromFile,
  extractTextFromS3File,
  extractQuestionsFromText,
  chunkText,
  cleanText,
};