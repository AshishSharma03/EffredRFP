import { openSearchClient } from '../config/aws.config.js';
import { logger } from '../utils/logger.js';

class SearchService {
  constructor() {
    this.indexName = process.env.OPENSEARCH_INDEX || 'knowledge-base';
  }

  async createIndex() {
    try {
      const indexExists = await openSearchClient.indices.exists({
        index: this.indexName,
      });

      if (!indexExists.body) {
        await openSearchClient.indices.create({
          index: this.indexName,
          body: {
            settings: {
              number_of_shards: 1,
              number_of_replicas: 1,
              analysis: {
                analyzer: {
                  custom_analyzer: {
                    type: 'custom',
                    tokenizer: 'standard',
                    filter: ['lowercase', 'stop', 'snowball'],
                  },
                },
              },
            },
            mappings: {
              properties: {
                title: { type: 'text', analyzer: 'custom_analyzer' },
                content: { type: 'text', analyzer: 'custom_analyzer' },
                category: { type: 'keyword' },
                tags: { type: 'keyword' },
                createdAt: { type: 'date' },
                updatedAt: { type: 'date' },
              },
            },
          },
        });

        logger.info(`Index created: ${this.indexName}`);
      }
    } catch (error) {
      logger.error('Error creating index:', error);
      throw error;
    }
  }

  async indexDocument(document) {
    try {
      await openSearchClient.index({
        index: this.indexName,
        id: document.id,
        body: document,
        refresh: true,
      });

      logger.info(`Document indexed: ${document.id}`);
    } catch (error) {
      logger.error('Error indexing document:', error);
      throw error;
    }
  }

  async searchDocuments(query, filters = {}, size = 10) {
    try {
      const must = [
        {
          multi_match: {
            query: query,
            fields: ['title^3', 'content'],
            type: 'best_fields',
            operator: 'or',
            fuzziness: 'AUTO',
          },
        },
      ];

      if (filters.category) {
        must.push({ term: { category: filters.category } });
      }

      if (filters.tags && filters.tags.length > 0) {
        must.push({ terms: { tags: filters.tags } });
      }

      const response = await openSearchClient.search({
        index: this.indexName,
        body: {
          query: { bool: { must } },
          highlight: {
            fields: {
              content: {
                fragment_size: 150,
                number_of_fragments: 3,
              },
            },
          },
          size,
        },
      });

      const results = response.body.hits.hits.map((hit) => ({
        id: hit._id,
        title: hit._source.title,
        content: hit._source.content,
        score: hit._score,
        highlights: hit.highlight?.content || [],
      }));

      logger.info(`Search completed: ${results.length} results found`);
      return results;
    } catch (error) {
      logger.error('Error searching documents:', error);
      throw error;
    }
  }

  async searchRelevantContext(question, topK = 5) {
    try {
      const results = await this.searchDocuments(question, {}, topK);
      return results.map(r => {
        const highlights = r.highlights?.join('... ') || '';
        return `Title: ${r.title}\nContent: ${highlights || r.content.substring(0, 500)}`;
      });
    } catch (error) {
      logger.error('Error searching relevant context:', error);
      throw error;
    }
  }

  async deleteDocument(id) {
    try {
      await openSearchClient.delete({
        index: this.indexName,
        id,
        refresh: true,
      });

      logger.info(`Document deleted: ${id}`);
    } catch (error) {
      logger.error('Error deleting document:', error);
      throw error;
    }
  }

  async updateDocument(id, updates) {
    try {
      await openSearchClient.update({
        index: this.indexName,
        id,
        body: {
          doc: {
            ...updates,
            updatedAt: new Date().toISOString(),
          },
        },
        refresh: true,
      });

      logger.info(`Document updated: ${id}`);
    } catch (error) {
      logger.error('Error updating document:', error);
      throw error;
    }
  }
}

export const searchService = new SearchService();