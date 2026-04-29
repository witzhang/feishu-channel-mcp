import * as lark from '@larksuiteoapi/node-sdk';
import { McpTool } from '../../../../types';
import { z } from 'zod';
import * as fs from 'fs';

// 工具名称类型
export type imBuiltinToolName =
  | 'im.builtin.batchSend'
  | 'im.builtin.imageUpload'
  | 'im.builtin.fileUpload';

export const larkImBuiltinBatchSendTool: McpTool = {
  project: 'im',
  name: 'im.builtin.batchSend',
  accessTokens: ['tenant'],
  description: '[飞书/Lark] - 批量发送消息 - 支持给多个用户、部门批量发送消息，支持文本和卡片',
  schema: {
    data: z.object({
      msg_type: z
        .enum(['text', 'post', 'image', 'interactive', 'share_chat'])
        .describe(
          '消息类型,如果 msg_type 取值为 text、image、post 或者 share_chat，则消息内容需要传入 content 参数内。如果 msg_type 取值为 interactive，则消息内容需要传入 card 参数内。富文本类型（post）的消息，不支持使用 md 标签。',
        ),
      content: z
        .any()
        .describe(
          '消息内容，JSON 结构。该参数的取值与 msg_type 对应，例如 msg_type 取值为 text，则该参数需要传入文本类型的内容。',
        )
        .optional(),
      card: z
        .any()
        .describe(
          '卡片内容，JSON 结构。该参数的取值与 msg_type 对应，仅当 msg_type 取值为 interactive 时，需要将卡片内容传入当前参数。当 msg_type 取值不为 interactive 时，消息内容需要传入到 content 参数。',
        )
        .optional(),
      open_ids: z.array(z.string()).describe('接收者open_id列表').optional(),
      user_ids: z.array(z.string()).describe('接收者user_id列表').optional(),
      union_ids: z.array(z.string()).describe('接收者union_id列表').optional(),
      department_ids: z
        .array(z.string())
        .describe('部门 ID 列表。列表内支持传入部门 department_id 和 open_department_id')
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
    '[飞书/Lark] - 上传图片 - 上传图片到飞书/Lark IM 并返回 image_key。支持通过 file_path 传入本地文件路径或通过 image_base64 传入 base64 编码内容。最大 10MB。上传后使用 im.v1.message.create（msg_type="image"）发送图片消息。',
  schema: {
    data: z
      .object({
        image_type: z
          .enum(['message', 'avatar'])
          .describe('图片用途类型: "message" 用于聊天图片, "avatar" 用于机器人头像'),
        file_path: z
          .string()
          .describe('图片文件的本地路径。与 image_base64 二选一。')
          .optional(),
        image_base64: z
          .string()
          .describe('Base64 编码的图片内容。与 file_path 二选一。')
          .optional(),
      })
      .describe('请求体'),
    useUAT: z
      .boolean()
      .describe('是否使用用户身份发起请求，false 表示使用应用身份')
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
              text: JSON.stringify({ error: '必须提供 file_path 或 image_base64 其中一个参数' }),
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
              text: JSON.stringify({ error: 'file_path 和 image_base64 只能提供一个，不能同时提供' }),
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
                text: JSON.stringify({ error: `文件不存在: ${data.file_path}` }),
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
                text: JSON.stringify({ error: `图片文件过大: ${(stats.size / 1024 / 1024).toFixed(2)}MB，最大 10MB` }),
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
                text: JSON.stringify({ error: `图片数据过大: ${(imageBuffer.length / 1024 / 1024).toFixed(2)}MB，最大 10MB` }),
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
          content: [{ type: 'text' as const, text: JSON.stringify({ error: '图片上传失败：无响应' }) }],
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
    '[飞书/Lark] - 上传文件 - 上传文件到飞书/Lark IM 并返回 file_key。支持通过 file_path 传入本地文件路径或通过 file_base64 传入 base64 编码内容。最大 30MB。上传后使用 im.v1.message.create（msg_type="file"/"audio"/"media"）发送文件消息。',
  schema: {
    data: z
      .object({
        file_type: z
          .enum(['opus', 'mp4', 'pdf', 'doc', 'xls', 'ppt', 'stream'])
          .describe(
            '文件类型: opus=音频（opus格式）, mp4=视频, pdf=PDF文档, doc=Word文档, xls=Excel表格, ppt=PowerPoint演示文稿, stream=其他文件类型',
          ),
        file_name: z.string().describe('文件名（含扩展名），例如 "report.pdf"'),
        file_path: z
          .string()
          .describe('文件的本地路径。与 file_base64 二选一。')
          .optional(),
        file_base64: z
          .string()
          .describe('Base64 编码的文件内容。与 file_path 二选一。')
          .optional(),
        duration: z
          .number()
          .describe('音频/视频时长（毫秒），音频和视频文件需要提供此参数')
          .optional(),
      })
      .describe('请求体'),
    useUAT: z
      .boolean()
      .describe('是否使用用户身份发起请求，false 表示使用应用身份')
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
              text: JSON.stringify({ error: '必须提供 file_path 或 file_base64 其中一个参数' }),
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
              text: JSON.stringify({ error: 'file_path 和 file_base64 只能提供一个，不能同时提供' }),
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
                text: JSON.stringify({ error: `文件不存在: ${data.file_path}` }),
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
                text: JSON.stringify({ error: `文件过大: ${(stats.size / 1024 / 1024).toFixed(2)}MB，最大 30MB` }),
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
                text: JSON.stringify({ error: `文件数据过大: ${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB，最大 30MB` }),
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
          content: [{ type: 'text' as const, text: JSON.stringify({ error: '文件上传失败：无响应' }) }],
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
