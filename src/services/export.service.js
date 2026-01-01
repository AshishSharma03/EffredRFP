import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { logger } from '../utils/logger.js';
import { proposalService } from './proposal.service.js';
import { s3Service } from './s3.service.js';

class DocumentExportService {
  async exportProposalToPDF(proposalId) {
    try {
      const proposal = await proposalService.getProposal(proposalId);
      if (!proposal) throw new Error('Proposal not found');

      return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 50, bottom: 50, left: 50, right: 50 },
        });

        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);

        // Title
        doc.fontSize(24).font('Helvetica-Bold').text(proposal.title, {
          align: 'center',
        });

        doc.moveDown();
        doc.fontSize(12).font('Helvetica').text(
          `Client: ${proposal.clientName || 'N/A'}`,
          { align: 'center' }
        );

        doc.moveDown();
        doc.fontSize(10).text(
          `Created: ${new Date(proposal.createdAt).toDateString()}`,
          { align: 'center' }
        );

        doc.moveDown(2);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(2);

        const questionsBySection = this.groupBySection(proposal.questions);

        Object.entries(questionsBySection).forEach(([section, questions]) => {
          doc.fontSize(16).font('Helvetica-Bold').text(section);
          doc.moveDown();

          questions.forEach((q, index) => {
            doc.fontSize(12).font('Helvetica-Bold').text(
              `${index + 1}. ${q.question || ''}`
            );

            doc.moveDown(0.5);

            const answer =
              q.finalAnswer || q.draftAnswer || 'No answer provided';

            doc.fontSize(11)
              .font('Helvetica')
              .text(answer, { indent: 20, align: 'justify' });

            if (q.sources?.length) {
              doc.moveDown(0.3);
              doc.fontSize(9)
                .font('Helvetica-Oblique')
                .text(`Sources: ${q.sources.join(', ')}`, { indent: 20 });
            }

            doc.moveDown(1.5);
            if (doc.y > 700) doc.addPage();
          });
        });

        const pages = doc.bufferedPageRange();
        for (let i = 0; i < pages.count; i++) {
          doc.switchToPage(i);
          doc.fontSize(8).text(
            `Page ${i + 1} of ${pages.count}`,
            50,
            750,
            { align: 'center' }
          );
        }

        doc.end();
      });
    } catch (error) {
      logger.error('Error exporting proposal to PDF:', error);
      throw error;
    }
  }

  async exportProposalToDOCX(proposalId) {
    try {
      const proposal = await proposalService.getProposal(proposalId);
      if (!proposal) throw new Error('Proposal not found');

      const sections = [
        new Paragraph({
          text: proposal.title,
          heading: HeadingLevel.HEADING_1,
          alignment: 'center',
        }),
        new Paragraph({
          text: `Client: ${proposal.clientName || 'N/A'}`,
          alignment: 'center',
        }),
        new Paragraph({
          text: `Created: ${new Date(proposal.createdAt).toDateString()}`,
          italics: true,
          alignment: 'center',
        }),
      ];

      const questionsBySection = this.groupBySection(proposal.questions);

      Object.entries(questionsBySection).forEach(([section, questions]) => {
        sections.push(
          new Paragraph({
            text: section,
            heading: HeadingLevel.HEADING_2,
          })
        );

        questions.forEach((q, index) => {
          sections.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `${index + 1}. ${q.question || ''}`,
                  bold: true,
                }),
              ],
            })
          );

          sections.push(
            new Paragraph({
              text:
                q.finalAnswer ||
                q.draftAnswer ||
                'No answer provided',
              indent: { left: 720 },
            })
          );
        });
      });

      const doc = new Document({
        sections: [{ children: sections }],
      });

      return await Packer.toBuffer(doc);
    } catch (error) {
      logger.error('Error exporting proposal to DOCX:', error);
      throw error;
    }
  }

  async exportProposalToTXT(proposalId) {
    try {
      const proposal = await proposalService.getProposal(proposalId);
      if (!proposal) throw new Error('Proposal not found');

      let content = `${proposal.title}\n`;
      content += `${'='.repeat(proposal.title.length)}\n\n`;
      content += `Client: ${proposal.clientName || 'N/A'}\n`;
      content += `Created: ${new Date(proposal.createdAt).toDateString()}\n\n`;
      content += `${'-'.repeat(80)}\n\n`;

      const questionsBySection = this.groupBySection(proposal.questions);

      Object.entries(questionsBySection).forEach(([section, questions]) => {
        content += `\n${section}\n${'='.repeat(section.length)}\n\n`;

        questions.forEach((q, index) => {
          content += `${index + 1}. ${q.question || ''}\n`;
          content += `${
            q.finalAnswer || q.draftAnswer || 'No answer provided'
          }\n\n`;
          content += `${'-'.repeat(80)}\n\n`;
        });
      });

      return Buffer.from(content, 'utf-8');
    } catch (error) {
      logger.error('Error exporting proposal to TXT:', error);
      throw error;
    }
  }

  async exportAndUpload(proposalId, format) {
    try {
      let buffer, contentType, extension;

      if (format === 'pdf') {
        buffer = await this.exportProposalToPDF(proposalId);
        contentType = 'application/pdf';
        extension = 'pdf';
      } else if (format === 'docx') {
        buffer = await this.exportProposalToDOCX(proposalId);
        contentType =
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        extension = 'docx';
      } else if (format === 'txt') {
        buffer = await this.exportProposalToTXT(proposalId);
        contentType = 'text/plain';
        extension = 'txt';
      } else {
        throw new Error('Unsupported export format');
      }

      const mockFile = {
        buffer,
        originalname: `proposal-${proposalId}.${extension}`,
        mimetype: contentType,
      };

      const { key, url } = await s3Service.uploadFile(
        mockFile,
        'exports'
      );

      logger.info(`Proposal exported: ${key}`);
      return { key, url };
    } catch (error) {
      logger.error('Error exporting and uploading proposal:', error);
      throw error;
    }
  }

  groupBySection(questions = []) {
    return questions.reduce((acc, q) => {
      const section = q.section || 'General';
      acc[section] = acc[section] || [];
      acc[section].push(q);
      return acc;
    }, {});
  }
}

export const documentExportService = new DocumentExportService();
