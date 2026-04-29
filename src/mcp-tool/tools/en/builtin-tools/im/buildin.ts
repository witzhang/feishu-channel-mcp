import * as lark from '@larksuiteoapi/node-sdk';
import { McpTool } from '../../../../types';
import { z } from 'zod';
import * as fs from 'fs';

export type imBuiltinToolName =
  | 'im.builtin.batchSend'
  | 'im.builtin.imageUpload'
  | 'im.builtin.fileUpload';

export const larkImBuiltinBatchSendTool: McpTool = {
  project: 'im',
  name: 'im.builtin.batchSend',
  accessTokens: ['tenant'],
  description:
    '[Feishu/Lark] - Batch send messages - Supports batch sending messages to multiple users and departments, supports text and card',
  schema: {
    data: z.object({
      msg_type: z
        .enum(['text', 'post', 'image', 'interactive', 'share_chat'])
        .describe(
          'Message type. If msg_type is text, image, post, or share_chat, the message content should be passed in the content parameter. If msg_type is interactive, the message content should be passed in the card parameter. Rich text type (post) messages do not support md tags.',
        ),
      content: z
        .any()
        .describe(
          'Message content, JSON structure. The value of this parameter corresponds to msg_type. For example, if msg_type is text, this parameter should be the text content.',
        )
        .optional(),
      card: z
        .any()
        .describe(
          'Card content, JSON structure. The value of this parameter corresponds to msg_type. Only when msg_type is interactive, the card content should be passed in this parameter. When msg_type is not interactive, the message content should be passed in the content parameter.',
        )
        .optional(),
      open_ids: z.array(z.string()).describe('List of recipient open_ids').optional(),
      user_ids: z.array(z.string()).describe('List of recipient user_ids').optional(),
      union_ids: z.array(z.string()).describe('List of recipient union_ids').optional(),
      department_ids: z
        .array(z.string())
        .describe('List of department IDs. The list supports both department_id and open_department_id')
        .optional(),
    }),
  },
  customHandler: async (client, params): Promise<any> => {
    try {
      const { data } = params;
      const response = await client.request({
        method: 'POST',
        url: '/open-apis/message/v4/batch_send',
        data,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(response.data ?? response),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify((error as any)?.response?.data || error),
          },
        ],
      };
    }
  },
};

export const larkImBuiltinImageUploadTool: McpTool = {
  project: 'im',
  name: 'im.builtin.imageUpload',
  accessTokens: ['tenant'],
  supportFileUpload: true,
  description:
    '[Feishu/Lark] - Upload image - Upload an image to Feishu/Lark IM and return an image_key. Use file_path for local files or image_base64 for base64-encoded content. Max 10MB. After uploading, use im.v1.message.create with msg_type="image" to send it.',
  schema: {
    data: z
      .object({
        image_type: z
          .enum(['message', 'avatar'])
          .describe('Image usage type: "message" for chat images, "avatar" for bot avatar'),
        file_path: z
          .string()
          .describe('Local file path to the image file. Mutually exclusive with image_base64.')
          .optional(),
        image_base64: z
          .string()
          .describe('Base64-encoded image content. Mutually exclusive with file_path.')
          .optional(),
      })
      .describe('Request body'),
    useUAT: z
      .boolean()
      .describe('Whether to use user identity for the request, false means using application identity')
      .optional(),
  },
  customHandler: async (client, params, options): Promise<any> => {
    try {
      const { data } = params;
      const { userAccessToken } = options || {};

      if (!data.file_path && !data.image_base64) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Either file_path or image_base64 must be provided' }),
            },
          ],
        };
      }

      if (data.file_path && data.image_base64) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Only one of file_path or image_base64 should be provided, not both' }),
            },
          ],
        };
      }

      let imageBuffer: Buffer;

      if (data.file_path) {
        if (!fs.existsSync(data.file_path)) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: `File not found: ${data.file_path}` }),
              },
            ],
          };
        }
        const stats = fs.statSync(data.file_path);
        if (stats.size > 10 * 1024 * 1024) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: `Image file too large: ${(stats.size / 1024 / 1024).toFixed(2)}MB, max 10MB` }),
              },
            ],
          };
        }
        imageBuffer = fs.readFileSync(data.file_path);
      } else {
        imageBuffer = Buffer.from(data.image_base64, 'base64');
        if (imageBuffer.length > 10 * 1024 * 1024) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: `Image data too large: ${(imageBuffer.length / 1024 / 1024).toFixed(2)}MB, max 10MB` }),
              },
            ],
          };
        }
      }

      const uploadData = {
        image_type: data.image_type as 'message' | 'avatar',
        image: imageBuffer,
      };

      const response =
        userAccessToken && params.useUAT
          ? await client.im.image.create({ data: uploadData }, lark.withUserAccessToken(userAccessToken))
          : await client.im.image.create({ data: uploadData });

      if (!response) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Image upload failed: no response' }) }],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(response),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify((error as any)?.response?.data || (error as any)?.message || error),
          },
        ],
      };
    }
  },
};

export const larkImBuiltinFileUploadTool: McpTool = {
  project: 'im',
  name: 'im.builtin.fileUpload',
  accessTokens: ['tenant'],
  supportFileUpload: true,
  description:
    '[Feishu/Lark] - Upload file - Upload a file to Feishu/Lark IM and return a file_key. Use file_path for local files or file_base64 for base64-encoded content. Max 30MB. After uploading, use im.v1.message.create with msg_type="file"/"audio"/"media" to send it.',
  schema: {
    data: z
      .object({
        file_type: z
          .enum(['opus', 'mp4', 'pdf', 'doc', 'xls', 'ppt', 'stream'])
          .describe(
            'File type: opus=audio (opus format), mp4=video, pdf=PDF document, doc=Word document, xls=Excel spreadsheet, ppt=PowerPoint, stream=other file types',
          ),
        file_name: z.string().describe('File name with extension, e.g. "report.pdf"'),
        file_path: z
          .string()
          .describe('Local file path. Mutually exclusive with file_base64.')
          .optional(),
        file_base64: z
          .string()
          .describe('Base64-encoded file content. Mutually exclusive with file_path.')
          .optional(),
        duration: z
          .number()
          .describe('Duration in milliseconds, required for audio/video files')
          .optional(),
      })
      .describe('Request body'),
    useUAT: z
      .boolean()
      .describe('Whether to use user identity for the request, false means using application identity')
      .optional(),
  },
  customHandler: async (client, params, options): Promise<any> => {
    try {
      const { data } = params;
      const { userAccessToken } = options || {};

      if (!data.file_path && !data.file_base64) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Either file_path or file_base64 must be provided' }),
            },
          ],
        };
      }

      if (data.file_path && data.file_base64) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Only one of file_path or file_base64 should be provided, not both' }),
            },
          ],
        };
      }

      let fileBuffer: Buffer;

      if (data.file_path) {
        if (!fs.existsSync(data.file_path)) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: `File not found: ${data.file_path}` }),
              },
            ],
          };
        }
        const stats = fs.statSync(data.file_path);
        if (stats.size > 30 * 1024 * 1024) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: `File too large: ${(stats.size / 1024 / 1024).toFixed(2)}MB, max 30MB` }),
              },
            ],
          };
        }
        fileBuffer = fs.readFileSync(data.file_path);
      } else {
        fileBuffer = Buffer.from(data.file_base64, 'base64');
        if (fileBuffer.length > 30 * 1024 * 1024) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: `File data too large: ${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB, max 30MB` }),
              },
            ],
          };
        }
      }

      const uploadData = {
        file_type: data.file_type as 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream',
        file_name: data.file_name,
        file: fileBuffer,
        ...(data.duration !== undefined ? { duration: data.duration } : {}),
      };

      const response =
        userAccessToken && params.useUAT
          ? await client.im.file.create({ data: uploadData }, lark.withUserAccessToken(userAccessToken))
          : await client.im.file.create({ data: uploadData });

      if (!response) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'File upload failed: no response' }) }],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(response),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify((error as any)?.response?.data || (error as any)?.message || error),
          },
        ],
      };
    }
  },
};

export const imBuiltinTools = [larkImBuiltinBatchSendTool, larkImBuiltinImageUploadTool, larkImBuiltinFileUploadTool];
