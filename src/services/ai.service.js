import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient } from '../config/aws.config.js';

/**
 * Invoke Claude model via AWS Bedrock
 * @param {string} prompt - The prompt to send to the model
 * @param {Object} options - Additional options
 * @returns {Promise<string>} Model response
 */
export const invokeModel = async (prompt, options = {}) => {
  try {
    const {
      maxTokens = 2000,
      temperature = 0.7,
      topP = 0.9,
      modelId = 'anthropic.claude-v2',
    } = options;

    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      temperature,
      top_p: topP,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    };

    const command = new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload),
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    return responseBody.content[0].text;
  } catch (error) {
    console.error('Error invoking Bedrock model:', error);
    
    // Fallback response if Bedrock is not available
    if (error.name === 'ResourceNotFoundException' || error.code === 'ENOTFOUND') {
      console.warn('⚠️  Bedrock not available, using fallback response');
      return generateFallbackResponse(prompt);
    }
    
    throw new Error('Failed to generate AI response');
  }
};

/**
 * Generate fallback response when Bedrock is not available
 * @param {string} prompt - Original prompt
 * @returns {string} Fallback response
 */
const generateFallbackResponse = (prompt) => {
  // Simple pattern-based fallback
  if (prompt.toLowerCase().includes('security')) {
    return 'We implement industry-standard security measures including encryption, access controls, and regular security audits to protect your data.';
  } else if (prompt.toLowerCase().includes('experience')) {
    return 'Our team has extensive experience in delivering similar projects with proven track records of success.';
  } else if (prompt.toLowerCase().includes('timeline')) {
    return 'We can deliver the project within the specified timeline with proper resource allocation and project management.';
  } else if (prompt.toLowerCase().includes('cost') || prompt.toLowerCase().includes('price')) {
    return 'Our pricing is competitive and transparent, with no hidden costs. We offer flexible payment terms.';
  } else {
    return 'Thank you for your question. Our team will provide detailed information addressing all aspects of your inquiry.';
  }
};

/**
 * Generate answer for RFP question
 * @param {string} question - RFP question
 * @param {string} context - Additional context from knowledge base
 * @returns {Promise<Object>} Generated answer with metadata
 */
export const generateAnswer = async (question, context = '') => {
  const prompt = `
You are an expert RFP response writer. Generate a professional, detailed answer to the following question.

${context ? `Context from knowledge base:\n${context}\n` : ''}

Question: ${question}

Provide a comprehensive answer that:
1. Directly addresses the question
2. Demonstrates expertise and capability
3. Includes specific details and examples when appropriate
4. Maintains a professional tone
5. Is concise but thorough (200-400 words)

Answer:`;

  try {
    const answer = await invokeModel(prompt, {
      maxTokens: 1500,
      temperature: 0.7,
    });

    return {
      answer: answer.trim(),
      confidence: 0.85,
      sources: context ? ['Knowledge Base'] : ['AI Generated'],
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error generating answer:', error);
    throw error;
  }
};

/**
 * Improve existing answer based on feedback
 * @param {string} currentAnswer - Current answer
 * @param {string} feedback - Improvement feedback
 * @param {string} question - Original question
 * @returns {Promise<string>} Improved answer
 */
export const improveAnswer = async (currentAnswer, feedback, question) => {
  const prompt = `
You are an expert RFP response editor. Improve the following answer based on the feedback provided.

Original Question: ${question}

Current Answer:
${currentAnswer}

Feedback for improvement:
${feedback}

Please provide an improved version that:
1. Addresses the feedback
2. Maintains the professional tone
3. Keeps the same overall structure
4. Enhances clarity and impact

Improved Answer:`;

  try {
    const improvedAnswer = await invokeModel(prompt, {
      maxTokens: 1500,
      temperature: 0.6,
    });

    return improvedAnswer.trim();
  } catch (error) {
    console.error('Error improving answer:', error);
    throw error;
  }
};

/**
 * Generate executive summary for proposal
 * @param {Object} proposal - Proposal object with questions and answers
 * @returns {Promise<string>} Executive summary
 */
export const generateSummary = async (proposal) => {
  const answeredQuestions = proposal.questions.filter(q => q.finalAnswer || q.draftAnswer);
  
  const questionsText = answeredQuestions
    .map(q => `Q: ${q.question}\nA: ${q.finalAnswer || q.draftAnswer}`)
    .join('\n\n');

  const prompt = `
You are an expert at writing executive summaries for RFP responses.

Create a compelling executive summary (300-500 words) for this proposal based on the following questions and answers:

${questionsText}

The summary should:
1. Highlight key capabilities and strengths
2. Address main client concerns
3. Demonstrate value proposition
4. Be persuasive and professional
5. Follow a clear structure (Introduction, Key Highlights, Conclusion)

Executive Summary:`;

  try {
    const summary = await invokeModel(prompt, {
      maxTokens: 2000,
      temperature: 0.7,
    });

    return summary.trim();
  } catch (error) {
    console.error('Error generating summary:', error);
    throw error;
  }
};

/**
 * Search knowledge base for relevant information
 * @param {string} query - Search query
 * @param {Array} knowledgeBase - Array of knowledge base documents
 * @returns {string} Relevant context
 */
export const searchKnowledgeBase = (query, knowledgeBase) => {
  if (!knowledgeBase || knowledgeBase.length === 0) {
    return '';
  }

  // Simple keyword-based search (can be enhanced with vector search)
  const queryWords = query.toLowerCase().split(/\s+/);
  
  const scoredDocuments = knowledgeBase.map(doc => {
    const content = (doc.content || '').toLowerCase();
    const title = (doc.title || '').toLowerCase();
    
    let score = 0;
    queryWords.forEach(word => {
      if (content.includes(word)) score += 2;
      if (title.includes(word)) score += 5;
    });
    
    return { doc, score };
  });

  const relevantDocs = scoredDocuments
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(item => item.doc);

  if (relevantDocs.length === 0) {
    return '';
  }

  return relevantDocs
    .map(doc => `${doc.title}:\n${doc.content.substring(0, 500)}...`)
    .join('\n\n');
};

/**
 * Analyze question complexity
 * @param {string} question - Question text
 * @returns {Object} Complexity analysis
 */
export const analyzeQuestionComplexity = (question) => {
  const wordCount = question.split(/\s+/).length;
  const hasMultipleParts = question.includes('and') || question.includes('or');
  const isTechnical = /technical|architecture|integration|api|database|security/i.test(question);
  
  let complexity = 'simple';
  
  if (wordCount > 20 || hasMultipleParts || isTechnical) {
    complexity = 'complex';
  } else if (wordCount > 10) {
    complexity = 'moderate';
  }
  
  return {
    complexity,
    wordCount,
    hasMultipleParts,
    isTechnical,
    estimatedAnswerLength: complexity === 'complex' ? 'long' : complexity === 'moderate' ? 'medium' : 'short',
  };
};

export default {
  invokeModel,
  generateAnswer,
  improveAnswer,
  generateSummary,
  searchKnowledgeBase,
  analyzeQuestionComplexity,
};