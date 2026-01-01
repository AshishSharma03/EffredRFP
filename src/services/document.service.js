import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { logger } from '../utils/logger.js';

class DocumentProcessorService {
  async extractTextFromPDF(buffer) {
    try {
      const data = await pdfParse(buffer);
      logger.info(`Extracted ${data.numpages} pages from PDF`);
      return data.text;
    } catch (error) {
      logger.error('Error extracting text from PDF:', error);
      throw new Error('Failed to extract text from PDF');
    }
  }

  async extractTextFromDocx(buffer) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      logger.info('Extracted text from DOCX');
      return result.value;
    } catch (error) {
      logger.error('Error extracting text from DOCX:', error);
      throw new Error('Failed to extract text from DOCX');
    }
  }

  async processDocument(buffer, mimeType) {
    try {
      if (mimeType === 'application/pdf') {
        return await this.extractTextFromPDF(buffer);
      } else if (
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        return await this.extractTextFromDocx(buffer);
      } else {
        throw new Error(`Unsupported file type: ${mimeType}`);
      }
    } catch (error) {
      logger.error('Error processing document:', error);
      throw error;
    }
  }

  cleanText(text) {
    let cleaned = text.replace(/\s+/g, ' ');
    cleaned = cleaned.replace(/\f/g, '\n');
    cleaned = cleaned.replace(/[\r\n]{3,}/g, '\n\n');
    return cleaned.trim();
  }

  splitIntoSections(text) {
    const sections = {};
    
    const sectionPatterns = [
      /(?:^|\n)((?:Section|SECTION)\s+\d+[:\.\s]+[^\n]+)/gi,
      /(?:^|\n)(\d+\.\s+[A-Z][^\n]+)/gm,
      /(?:^|\n)((?:PART|Part)\s+[A-Z0-9]+[:\.\s]+[^\n]+)/gi,
    ];

    let currentSection = 'Introduction';
    let currentContent = '';

    const lines = text.split('\n');
    
    for (const line of lines) {
      let isHeader = false;
      
      for (const pattern of sectionPatterns) {
        const match = line.match(pattern);
        if (match) {
          if (currentContent.trim()) {
            sections[currentSection] = this.cleanText(currentContent);
          }
          
          currentSection = line.trim();
          currentContent = '';
          isHeader = true;
          break;
        }
      }
      
      if (!isHeader) {
        currentContent += line + '\n';
      }
    }

    if (currentContent.trim()) {
      sections[currentSection] = this.cleanText(currentContent);
    }

    return sections;
  }

  extractQuestions(text) {
    const questions = [];
    
    const questionPatterns = [
      /(?:^|\n)(\d+[\.\)]\s*[^\n]*\?)/gm,
      /(?:^|\n)([A-Z][^\n]*\?)/gm,
      /(?:Describe|Explain|Provide|List|Detail|How|What|When|Where|Why|Who)[^\n]*\?/gi,
    ];

    for (const pattern of questionPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const question = match[1] || match[0];
        if (question.length > 10 && question.length < 500) {
          questions.push(question.trim());
        }
      }
    }

    return Array.from(new Set(questions));
  }
}

export const documentProcessor = new DocumentProcessorService();