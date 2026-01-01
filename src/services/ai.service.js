import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient } from '../config/aws.config.js';
import { logger } from '../utils/logger.js';

class AIService {
  constructor() {
    this.modelId = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-sonnet-20240229-v1:0';
  }

  async invokeModel(messages, maxTokens = 4096) {
    try {
      const payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: maxTokens,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
      };

      const command = new InvokeModelCommand({
        modelId: this.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload),
      });

      const response = await bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      logger.info('AI model invoked successfully');
      return responseBody.content[0].text;
    } catch (error) {
      logger.error('Error invoking AI model:', error);
      throw error;
    }
  }

  async extractQuestionsFromRFP(rfpText) {
    try {
      const prompt = `You are an expert at analyzing RFP (Request for Proposal) documents. 
Extract all questions and requirements from the following RFP document. 
For each question, provide:
1. A unique identifier
2. The question text
3. The section it belongs to
4. The category (technical, financial, experience, etc.)

Format your response as a JSON array of objects with fields: id, question, section, category.

RFP Document:
${rfpText}

Return only the JSON array, no additional text.`;

      const messages = [
        {
          role: 'user',
          content: prompt,
        },
      ];

      const response = await this.invokeModel(messages);
      
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      throw new Error('Failed to extract questions from AI response');
    } catch (error) {
      logger.error('Error extracting questions from RFP:', error);
      throw error;
    }
  }

  async generateDraftAnswer(question, knowledgeContext) {
    try {
      const contextText = knowledgeContext.join('\n\n');
      
      const prompt = `You are an expert proposal writer. Based on the following context from our company's knowledge base, 
provide a comprehensive answer to the RFP question.

Context:
${contextText}

Question:
${question}

Provide your answer in the following JSON format:
{
  "answer": "your comprehensive answer here",
  "confidence": 0.0-1.0,
  "sources": ["source1", "source2"]
}

Be specific, professional, and directly address the question. If the context doesn't provide enough information, 
indicate that in your answer and suggest what additional information might be needed.`;

      const messages = [
        {
          role: 'user',
          content: prompt,
        },
      ];

      const response = await this.invokeModel(messages);
      
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          questionId: '',
          ...parsed,
        };
      }

      throw new Error('Failed to generate draft answer');
    } catch (error) {
      logger.error('Error generating draft answer:', error);
      throw error;
    }
  }

  async improveDraftAnswer(currentAnswer, feedback, question) {
    try {
      const prompt = `You are an expert proposal writer. Improve the following draft answer based on the feedback provided.

Question:
${question}

Current Answer:
${currentAnswer}

Feedback:
${feedback}

Provide an improved version of the answer that addresses the feedback while maintaining professionalism and clarity.`;

      const messages = [
        {
          role: 'user',
          content: prompt,
        },
      ];

      return await this.invokeModel(messages);
    } catch (error) {
      logger.error('Error improving draft answer:', error);
      throw error;
    }
  }

  async summarizeProposal(proposalSections) {
    try {
      const sectionsText = proposalSections
        .map(section => `Section: ${section.title}\n${section.content}`)
        .join('\n\n---\n\n');

      const prompt = `Create an executive summary for the following proposal. The summary should be concise, 
highlight key strengths, and provide an overview of our capabilities.

Proposal Sections:
${sectionsText}

Provide a professional executive summary (200-300 words).`;

      const messages = [
        {
          role: 'user',
          content: prompt,
        },
      ];

      return await this.invokeModel(messages, 2048);
    } catch (error) {
      logger.error('Error summarizing proposal:', error);
      throw error;
    }
  }
}

export const aiService = new AIService();